import bcrypt from "bcryptjs";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { UserRepository } from "./user.repository.js";
import { toPublicUser } from "./auth.types.js";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { otpIpLimiter, otpUserLimiter } from "../../middleware/rate-limit.js";
import { logSecurityBlocked } from "../../lib/security-log.js";
import { otpRepository } from "./otp.repository-provider.js";
import { createOtpService } from "./otp.service.js";
import { userRepository } from "./user.repository.js";
import { recordAccess } from "../access-log/access-log.js";
import { signToken, verifyOtpChallenge } from "./token.js";

type OtpService = ReturnType<typeof createOtpService>;

type OtpRouterDependencies = {
  otpService: OtpService;
  users: Pick<UserRepository, "findById">;
  authenticate: RequestHandler;
  ipLimiter: RequestHandler;
  userLimiter: RequestHandler;
  verifyChallenge: typeof verifyOtpChallenge;
  signSession: typeof signToken;
  recordAccess: typeof recordAccess;
  logFailure: typeof logSecurityBlocked;
};

const challengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().optional(),
  recoveryCode: z.string().optional(),
}).strict();

const codeSchema = z.object({ code: z.string() }).strict();
const disableSchema = z.object({
  password: z.string().min(1),
  code: z.string(),
}).strict();
const recoveryCodeSchema = z.object({ code: z.string() }).strict();

function logFailure(request: Request, userId: string, reason: string, resource: string) {
  return {
    control: "OTP" as const,
    reason,
    userId,
    ip: request.ip ?? "desconhecido",
    resource,
  };
}

function rejectOtp(
  request: Request,
  response: Response,
  logger: OtpRouterDependencies["logFailure"],
  userId: string,
  reason: string,
) {
  logger(logFailure(request, userId, reason, "autenticacao"));
  return response.status(401).json({ error: "Código inválido" });
}

export function createOtpRouter(dependencies: OtpRouterDependencies) {
  const router = Router();

  router.post(
    "/login/otp",
    dependencies.ipLimiter,
    (request, response, next) => {
      const parsed = challengeSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Dados de entrada inválidos" });
      }
      if (Boolean(parsed.data.code) === Boolean(parsed.data.recoveryCode)) {
        return rejectOtp(request, response, dependencies.logFailure, "desconhecido", "fator_ausente_ou_duplicado");
      }
      try {
        request.otpChallengeUserId = dependencies.verifyChallenge(parsed.data.challengeToken);
        return next();
      } catch {
        dependencies.logFailure(logFailure(request, "desconhecido", "desafio_invalido_ou_expirado", "desafio"));
        return response.status(401).json({ error: "Código inválido" });
      }
    },
    dependencies.userLimiter,
    async (request, response, next) => {
      try {
        const parsed = challengeSchema.parse(request.body);
        const userId = request.otpChallengeUserId!;
        const user = await dependencies.users.findById(userId);
        if (!user || user.status !== "ACTIVE") {
          dependencies.logFailure(logFailure(request, userId, "usuario_inativo_ou_ausente", "autenticacao"));
          return response.status(401).json({ error: "Código inválido" });
        }

        const result = parsed.code !== undefined
          ? await dependencies.otpService.verifyCode(userId, parsed.code)
          : await dependencies.otpService.verifyRecoveryCode(userId, parsed.recoveryCode!);
        if (!result.ok) {
          dependencies.logFailure(logFailure(request, userId, result.reason, "autenticacao"));
          await dependencies.recordAccess(request, userId, "LOGIN_OTP", "FALHA");
          return response.status(401).json({ error: "Código inválido" });
        }

        await dependencies.recordAccess(request, userId, "LOGIN_OTP", "SUCESSO");
        return response.status(200).json({
          token: dependencies.signSession(user),
          user: toPublicUser(user),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/otp/setup",
    dependencies.authenticate,
    dependencies.ipLimiter,
    dependencies.userLimiter,
    async (request, response, next) => {
      try {
        const result = await dependencies.otpService.setup(request.user!.id, request.user!.email);
        if (!result.ok) {
          if (result.reason === "already_enabled") {
            return response.status(409).json({ error: "Autenticação em duas etapas já está ativa" });
          }
          return response.status(404).json({ error: "Usuário não encontrado" });
        }
        return response.status(200).json(result.value);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/otp/activate",
    dependencies.authenticate,
    dependencies.ipLimiter,
    dependencies.userLimiter,
    async (request, response, next) => {
      try {
        const { code } = codeSchema.parse(request.body);
        const userId = request.user!.id;
        const result = await dependencies.otpService.activate(userId, code);
        if (!result.ok) {
          if (result.reason === "already_enabled") {
            return response.status(409).json({ error: "Autenticação em duas etapas já está ativa" });
          }
          return rejectOtp(request, response, dependencies.logFailure, userId, result.reason);
        }
        return response.status(200).json({ recoveryCodes: result.value.recoveryCodes });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/otp/disable",
    dependencies.authenticate,
    dependencies.ipLimiter,
    dependencies.userLimiter,
    async (request, response, next) => {
      try {
        const { password, code } = disableSchema.parse(request.body);
        const userId = request.user!.id;
        const user = await dependencies.users.findById(userId);
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
          dependencies.logFailure(logFailure(request, userId, "senha_invalida", "otp/disable"));
          return response.status(401).json({ error: "Senha ou código inválido" });
        }
        const result = await dependencies.otpService.disable(userId, code);
        if (!result.ok) {
          return rejectOtp(request, response, dependencies.logFailure, userId, result.reason);
        }
        return response.status(200).json({ message: "Autenticação em duas etapas desativada" });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/otp/recovery-codes/regenerate",
    dependencies.authenticate,
    dependencies.ipLimiter,
    dependencies.userLimiter,
    async (request, response, next) => {
      try {
        const { code } = recoveryCodeSchema.parse(request.body);
        const userId = request.user!.id;
        const result = await dependencies.otpService.regenerateRecoveryCodes(userId, code);
        if (!result.ok) {
          return rejectOtp(request, response, dependencies.logFailure, userId, result.reason);
        }
        return response.status(200).json({ recoveryCodes: result.value.recoveryCodes });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

const otpService = createOtpService(otpRepository, {
  encryptionKey: env.OTP_ENCRYPTION_KEY,
  issuer: env.OTP_ISSUER,
  window: env.OTP_WINDOW,
  recoveryCodesCount: env.OTP_RECOVERY_CODES_COUNT,
});

export const otpRouter = createOtpRouter({
  otpService,
  users: userRepository,
  authenticate,
  ipLimiter: otpIpLimiter,
  userLimiter: otpUserLimiter,
  verifyChallenge: verifyOtpChallenge,
  signSession: signToken,
  recordAccess,
  logFailure: logSecurityBlocked,
});
