import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const message = { error: "Muitas tentativas. Tente novamente em alguns minutos." };
const emailSchema = z.string().trim().email();

function getNormalizedEmail(request: Request) {
  const email = request.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

const limiterOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message,
};

export function createAuthIpLimiters() {
  return {
    register: rateLimit({ ...limiterOptions, limit: 10 }),
    login: rateLimit({
      ...limiterOptions,
      limit: 10,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (request, response) => response.statusCode < 400 && request.loginSessionIssued === true,
    }),
    forgotPassword: rateLimit({ ...limiterOptions, limit: 10 }),
    resetPassword: rateLimit({ ...limiterOptions, limit: 10 }),
  };
}

const authIpLimiters = createAuthIpLimiters();

export const registerIpLimiter = authIpLimiters.register;
export const loginIpLimiter = authIpLimiters.login;
export const forgotPasswordIpLimiter = authIpLimiters.forgotPassword;
export const resetPasswordIpLimiter = authIpLimiters.resetPassword;

export const loginAccountLimiter = rateLimit({
  ...limiterOptions,
  limit: 5,
  skipSuccessfulRequests: true,
  skip: (request) => !emailSchema.safeParse(getNormalizedEmail(request)).success,
  keyGenerator: getNormalizedEmail,
});

export const otpIpLimiter = rateLimit({
  ...limiterOptions,
  limit: 20,
  skipSuccessfulRequests: true,
});

export const otpUserLimiter = rateLimit({
  ...limiterOptions,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (request) => request.otpChallengeUserId ?? request.user?.id ?? "sem-usuario",
});
