import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/valesense_test?schema=public";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.OTP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.OTP_STORE = "memory";
process.env.OTP_CHALLENGE_EXPIRES_SECONDS = "300";
process.env.OTP_WINDOW = "1";
process.env.OTP_RECOVERY_CODES_COUNT = "4";

const [{ default: express }, { default: rateLimit, ipKeyGenerator }, { default: jwt }, { default: bcrypt }, { MemoryOtpRepository }, { createOtpService }, tokenModule, otpRoutes, authenticateModule, cryptoModule, envModule, authRateLimitModule] = await Promise.all([
  import("express"),
  import("express-rate-limit"),
  import("jsonwebtoken"),
  import("bcryptjs"),
  import("../src/modules/auth/memory-otp.repository.js"),
  import("../src/modules/auth/otp.service.js"),
  import("../src/modules/auth/token.js"),
  import("../src/modules/auth/otp.routes.js"),
  import("../src/middleware/authenticate.js"),
  import("../src/modules/auth/otp-crypto.js"),
  import("../src/config/env.js"),
  import("../src/middleware/rate-limit.js"),
]);

const testUserA = {
  id: "64a1b2c3-d4e5-4789-a012-345678901251",
  name: "Produtor OTP A",
  email: "otp-a@example.invalid",
  passwordHash: "",
  role: "PRODUTOR_EXPORTADOR" as const,
  status: "ACTIVE" as const,
};
const testUserB = {
  ...testUserA,
  id: "64a1b2c3-d4e5-4789-a012-345678901252",
  email: "otp-b@example.invalid",
};
const encryptionKey = process.env.OTP_ENCRYPTION_KEY!;
const testPassword = randomBytes(32).toString("hex");
testUserA.passwordHash = await bcrypt.hash(testPassword, 4);
const baseConfig = {
  encryptionKey,
  issuer: "ValeSense-Test",
  window: 1,
  recoveryCodesCount: 4,
};
const startedServers: Array<{ close(callback: (error?: Error) => void): void }> = [];

function noLimit(_request: unknown, _response: unknown, next: () => void) {
  next();
}

function buildRateLimiter(limit: number, key: "ip" | "user") {
  return rateLimit({
    windowMs: 60_000,
    limit,
    skipSuccessfulRequests: true,
    keyGenerator: (request) => key === "user"
      ? request.otpChallengeUserId ?? request.user?.id ?? "sem-usuario"
      : ipKeyGenerator(request.ip ?? "127.0.0.1"),
  });
}

async function createHarness(options: {
  now?: number;
  ipLimiter?: typeof noLimit;
  userLimiter?: typeof noLimit;
} = {}) {
  let now = options.now ?? 1_700_000_000_000;
  const repository = new MemoryOtpRepository();
  const otpService = createOtpService(repository, baseConfig, () => now);
  const users = new Map([
    [testUserA.id, testUserA],
    [testUserB.id, testUserB],
  ]);
  const accessEvents: Array<{ userId: string | null; action: string; result: string }> = [];
  const securityEvents: Array<{ reason: string; userId: string }> = [];
  const app = express();
  app.use(express.json());
  app.use("/api/auth", otpRoutes.createOtpRouter({
    otpService,
    users: { async findById(id: string) { return users.get(id) ?? null; } },
    authenticate(_request, response, next) {
      const request = _request as import("express").Request;
      const sessionId = request.header("authorization")?.replace(/^Bearer session:/, "");
      const user = sessionId ? users.get(sessionId) : undefined;
      if (!user) return response.status(401).json({ error: "unauthorized" });
      request.user = { id: user.id, email: user.email, role: user.role };
      return next();
    },
    ipLimiter: options.ipLimiter ?? noLimit,
    userLimiter: options.userLimiter ?? noLimit,
    verifyChallenge: tokenModule.verifyOtpChallenge,
    signSession: (user) => `session:${user.id}`,
    async recordAccess(_request, userId, action, result) {
      accessEvents.push({ userId, action, result });
    },
    logFailure: ({ reason, userId }) => securityEvents.push({ reason, userId }),
  }));
  app.use((error: unknown, _request: unknown, response: import("express").Response, _next: unknown) => {
    response.status(500).json({ error: "internal" });
  });
  const server = app.listen(0);
  startedServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as import("node:net").AddressInfo;

  return {
    repository,
    otpService,
    accessEvents,
    securityEvents,
    setNow(value: number) { now = value; },
    async request(path: string, body: unknown, sessionId?: string) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionId ? { authorization: `Bearer session:${sessionId}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { error: text };
      }
      return { status: response.status, body: parsed };
    },
  };
}

async function enroll(
  harness: Awaited<ReturnType<typeof createHarness>>,
  user = testUserA,
) {
  const setup = await harness.otpService.setup(user.id, user.email);
  if (!setup.ok) throw new Error("Falha ao preparar OTP no teste.");
  const uri = new URL(setup.value.otpauthUrl);
  const secret = uri.searchParams.get("secret");
  if (!secret) throw new Error("URI de teste sem segredo OTP.");
  const code = await harness.otpService.generateCode(secret, 1_700_000_000_000);
  const activation = await harness.otpService.activate(user.id, code);
  if (!activation.ok) throw new Error("Falha ao ativar OTP no teste.");
  return { secret, recoveryCodes: activation.value.recoveryCodes };
}

function validDifferentCode(code: string): string {
  return `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
}

after(async () => {
  await Promise.all(startedServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("fluxo OTP", () => {
  it("senha validada com 2FA ativo inicia desafio e login sem 2FA segue com sessao", async () => {
    const harness = await createHarness();
    await enroll(harness);
    const challenge = await tokenModule.signOtpChallenge(testUserA, 300);
    assert.equal(tokenModule.verifyOtpChallenge(challenge), testUserA.id);

    const { beginOtpLogin } = await import("../src/modules/auth/otp-login.js");
    const pending = await beginOtpLogin(testUserA, harness.repository, 300);
    assert.equal(pending.otpRequired, true);
    if (pending.otpRequired) {
      assert.equal("token" in pending, false);
      assert.equal(tokenModule.verifyOtpChallenge(pending.challengeToken), testUserA.id);
    }

    const ordinary = await beginOtpLogin(testUserB, harness.repository, 300);
    assert.equal(ordinary.otpRequired, false);
    if (!ordinary.otpRequired) assert.ok(ordinary.token);
  });

  it("setup cifra o segredo, devolve URI e QR e ativacao devolve recuperacoes uma vez", async () => {
    const repository = new MemoryOtpRepository();
    const service = createOtpService(repository, baseConfig, () => 1_700_000_000_000);
    const setup = await service.setup(testUserA.id, testUserA.email);
    assert.equal(setup.ok, true);
    if (!setup.ok) return;
    assert.match(setup.value.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.match(setup.value.qrCode, /^data:image\/png;base64,/);

    const secret = new URL(setup.value.otpauthUrl).searchParams.get("secret")!;
    const state = await repository.getState(testUserA.id);
    assert.ok(state?.encryptedSecret);
    assert.notEqual(state?.encryptedSecret, secret);
    assert.equal(cryptoModule.decryptOtpSecret(state!.encryptedSecret!, encryptionKey), secret);

    const code = await service.generateCode(secret, 1_700_000_000_000);
    const activation = await service.activate(testUserA.id, code);
    assert.equal(activation.ok, true);
    if (activation.ok) {
      assert.equal(activation.value.recoveryCodes.length, baseConfig.recoveryCodesCount);
      const records = await repository.listUnusedRecoveryCodes(testUserA.id);
      assert.equal(records.length, baseConfig.recoveryCodesCount);
      assert.equal(records.some((record) => activation.value.recoveryCodes.includes(record.codeHash)), false);
    }
  });

  it("expõe setup, ativacao, regeneracao e desativacao autenticados", async () => {
    const harness = await createHarness();
    const setup = await harness.request("/otp/setup", {}, testUserA.id);
    assert.equal(setup.status, 200);
    const otpauthUrl = setup.body.otpauthUrl as string;
    const secret = new URL(otpauthUrl).searchParams.get("secret")!;
    const activationCode = await harness.otpService.generateCode(secret, 1_700_000_000_000);
    const activation = await harness.request("/otp/activate", { code: activationCode }, testUserA.id);
    assert.equal(activation.status, 200);
    const oldRecoveryCodes = activation.body.recoveryCodes as string[];
    assert.equal(oldRecoveryCodes.length, baseConfig.recoveryCodesCount);

    const firstNextStep = (Math.floor(1_700_000_000_000 / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(firstNextStep);
    const regenerateCode = await harness.otpService.generateCode(secret, firstNextStep);
    const regenerated = await harness.request(
      "/otp/recovery-codes/regenerate",
      { code: regenerateCode },
      testUserA.id,
    );
    assert.equal(regenerated.status, 200);
    assert.equal((regenerated.body.recoveryCodes as string[]).length, baseConfig.recoveryCodesCount);
    assert.equal((await harness.otpService.verifyRecoveryCode(testUserA.id, oldRecoveryCodes[0])).ok, false);

    const secondNextStep = (Math.floor(firstNextStep / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(secondNextStep);
    const disableCode = await harness.otpService.generateCode(secret, secondNextStep);
    const wrongPassword = await harness.request(
      "/otp/disable",
      { password: randomBytes(24).toString("hex"), code: disableCode },
      testUserA.id,
    );
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, { error: "Senha ou código inválido" });

    const disabled = await harness.request(
      "/otp/disable",
      { password: testPassword, code: disableCode },
      testUserA.id,
    );
    assert.equal(disabled.status, 200);
    assert.equal((await harness.repository.getState(testUserA.id))?.active, false);
  });

  it("aceita codigo de recuperacao uma vez no endpoint de login", async () => {
    const harness = await createHarness();
    const { recoveryCodes } = await enroll(harness);
    const challenge = tokenModule.signOtpChallenge(testUserA, 300);
    const firstUse = await harness.request("/login/otp", {
      challengeToken: challenge,
      recoveryCode: recoveryCodes[0],
    });
    assert.equal(firstUse.status, 200);

    const secondChallenge = tokenModule.signOtpChallenge(testUserA, 300);
    const secondUse = await harness.request("/login/otp", {
      challengeToken: secondChallenge,
      recoveryCode: recoveryCodes[0],
    });
    assert.equal(secondUse.status, 401);
    assert.deepEqual(secondUse.body, { error: "Código inválido" });
  });

  it("aceita codigo valido, rejeita codigo errado, vencido e reutilizado", async () => {
    const harness = await createHarness();
    const { secret } = await enroll(harness);
    const now = (Math.floor(1_700_000_000_000 / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(now);
    const validCode = await harness.otpService.generateCode(secret, now);
    const valid = await harness.otpService.verifyCode(testUserA.id, validCode);
    assert.equal(valid.ok, true);

    const reused = await harness.otpService.verifyCode(testUserA.id, validCode);
    assert.equal(reused.ok, false);
    if (!reused.ok) assert.equal(reused.reason, "step_reused");

    const wrongCode = validDifferentCode(validCode);
    const wrong = await harness.otpService.verifyCode(testUserA.id, wrongCode);
    assert.equal(wrong.ok, false);

    const oldStepCode = await harness.otpService.generateCode(secret, now - 90_000);
    const expired = await harness.otpService.verifyCode(testUserA.id, oldStepCode);
    assert.equal(expired.ok, false);
  });

  it("consome codigo de recuperacao uma unica vez e substitui os anteriores", async () => {
    const harness = await createHarness();
    const { recoveryCodes } = await enroll(harness);
    const recoveryCode = recoveryCodes[0];
    const firstUse = await harness.otpService.verifyRecoveryCode(testUserA.id, recoveryCode);
    assert.equal(firstUse.ok, true);
    const secondUse = await harness.otpService.verifyRecoveryCode(testUserA.id, recoveryCode);
    assert.equal(secondUse.ok, false);

    const nextStep = (Math.floor(1_700_000_000_000 / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(nextStep);
    const state = await harness.repository.getState(testUserA.id);
    const secret = cryptoModule.decryptOtpSecret(state!.encryptedSecret!, encryptionKey);
    const code = await harness.otpService.generateCode(secret, nextStep);
    const regenerated = await harness.otpService.regenerateRecoveryCodes(testUserA.id, code);
    assert.equal(regenerated.ok, true);
    if (regenerated.ok) {
      const oldCodeUse = await harness.otpService.verifyRecoveryCode(testUserA.id, recoveryCodes[1]);
      assert.equal(oldCodeUse.ok, false);
    }
  });

  it("serializa duas requisicoes concorrentes para um mesmo passo TOTP", async () => {
    const harness = await createHarness();
    const { secret } = await enroll(harness);
    const nextStep = (Math.floor(1_700_000_000_000 / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(nextStep);
    const code = await harness.otpService.generateCode(secret, nextStep);
    const results = await Promise.all([
      harness.otpService.verifyCode(testUserA.id, code),
      harness.otpService.verifyCode(testUserA.id, code),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
  });

  it("usa OTP_WINDOW configuravel para aceitar um passo anterior", async () => {
    const repository = new MemoryOtpRepository();
    const now = 1_700_000_000_000;
    const service = createOtpService(repository, baseConfig, () => now);
    const setup = await service.setup(testUserA.id, testUserA.email);
    if (!setup.ok) throw new Error("Falha ao preparar OTP no teste.");
    const secret = new URL(setup.value.otpauthUrl).searchParams.get("secret")!;
    const activationCode = await service.generateCode(secret, now);
    assert.equal((await service.activate(testUserA.id, activationCode)).ok, true);

    const currentStep = Math.floor(now / 30_000) + 2;
    const laterNow = currentStep * 30_000 + 10_000;
    const previousStepCode = await service.generateCode(secret, (currentStep - 1) * 30_000);
    const { envSchema } = await import("../src/config/env.js");
    const zeroWindowConfig = envSchema.parse({ ...process.env, OTP_WINDOW: "0" });
    const zeroWindow = createOtpService(
      repository,
      { ...baseConfig, window: zeroWindowConfig.OTP_WINDOW },
      () => laterNow,
    );
    const rejected = await zeroWindow.verifyCode(testUserA.id, previousStepCode);
    assert.equal(rejected.ok, false);

    const oneStepWindow = createOtpService(repository, baseConfig, () => laterNow);
    const accepted = await oneStepWindow.verifyCode(testUserA.id, previousStepCode);
    assert.equal(accepted.ok, true);
  });

  it("rejeita codigo do usuario B com desafio do usuario A e desafios expirados", async () => {
    const harness = await createHarness();
    const { secret: secretB } = await enroll(harness, testUserB);
    await enroll(harness, testUserA);
    const challenge = tokenModule.signOtpChallenge(testUserA, 300);
    const codeB = await harness.otpService.generateCode(secretB, 1_700_000_000_000);
    const mismatch = await harness.request("/login/otp", { challengeToken: challenge, code: codeB });
    assert.equal(mismatch.status, 401);
    assert.deepEqual(mismatch.body, { error: "Código inválido" });

    const expiredToken = jwt.sign(
      { email: testUserA.email, role: testUserA.role, purpose: "otp" },
      process.env.JWT_SECRET!,
      { subject: testUserA.id, expiresIn: -1 },
    );
    const expired = await harness.request("/login/otp", { challengeToken: expiredToken, code: "000000" });
    assert.equal(expired.status, 401);
    assert.deepEqual(expired.body, { error: "Código inválido" });
  });

  it("completa login OTP com 200, registra sucesso/falha e usa resposta generica", async () => {
    const harness = await createHarness();
    const { secret } = await enroll(harness);
    const challenge = tokenModule.signOtpChallenge(testUserA, 300);
    const invalidCode = validDifferentCode(await harness.otpService.generateCode(secret, 1_700_000_000_000));
    const invalid = await harness.request("/login/otp", { challengeToken: challenge, code: invalidCode });
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, { error: "Código inválido" });
    assert.equal(harness.accessEvents.at(-1)?.result, "FALHA");

    const nextStep = (Math.floor(1_700_000_000_000 / 30_000) + 1) * 30_000 + 1_000;
    harness.setNow(nextStep);
    const currentState = await harness.repository.getState(testUserA.id);
    const currentSecret = cryptoModule.decryptOtpSecret(currentState!.encryptedSecret!, encryptionKey);
    const validCode = await harness.otpService.generateCode(currentSecret, nextStep);
    const valid = await harness.request("/login/otp", { challengeToken: challenge, code: validCode });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.token, `session:${testUserA.id}`);
    assert.equal(harness.accessEvents.at(-1)?.result, "SUCESSO");
    assert.equal(JSON.stringify(harness.securityEvents).includes(validCode), false);
  });

  it("rejeita challengeToken como sessao protegida", async () => {
    const challenge = tokenModule.signOtpChallenge(testUserA, 300);
    const response = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };
    let nextCalled = false;
    await authenticateModule.authenticate(
      { header: () => `Bearer ${challenge}`, ip: "127.0.0.1" } as import("express").Request,
      response as unknown as import("express").Response,
      (() => { nextCalled = true; }) as import("express").NextFunction,
    );
    assert.equal(response.statusCode, 401);
    assert.equal(nextCalled, false);
  });

  it("aplica limite de tentativas por usuario e por IP", async () => {
    const accountHarness = await createHarness({ userLimiter: buildRateLimiter(1, "user") });
    const { secret } = await enroll(accountHarness);
    const challenge = tokenModule.signOtpChallenge(testUserA, 300);
    const wrongCode = validDifferentCode(await accountHarness.otpService.generateCode(secret, 1_700_000_000_000));
    assert.equal((await accountHarness.request("/login/otp", { challengeToken: challenge, code: wrongCode })).status, 401);
    assert.equal((await accountHarness.request("/login/otp", { challengeToken: challenge, code: wrongCode })).status, 429);

    const ipHarness = await createHarness({ ipLimiter: buildRateLimiter(1, "ip") });
    const ipEnroll = await enroll(ipHarness, testUserB);
    const ipChallenge = tokenModule.signOtpChallenge(testUserB, 300);
    const ipWrongCode = validDifferentCode(await ipHarness.otpService.generateCode(ipEnroll.secret, 1_700_000_000_000));
    assert.equal((await ipHarness.request("/login/otp", { challengeToken: ipChallenge, code: ipWrongCode })).status, 401);
    assert.equal((await ipHarness.request("/login/otp", { challengeToken: ipChallenge, code: ipWrongCode })).status, 429);
  });

  it("separa limites por rota e nao conta sessoes de login bem-sucedidas por IP", async () => {
    const limiters = authRateLimitModule.createAuthIpLimiters();
    const app = express();
    app.get("/login", limiters.login, (request, response) => {
      if (request.query.kind === "session") request.loginSessionIssued = true;
      response.sendStatus(200);
    });
    app.get("/register", limiters.register, (_request, response) => response.sendStatus(200));
    const server = app.listen(0);
    startedServers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as import("node:net").AddressInfo;
    const requestStatus = async (path: string) => (await fetch(`http://127.0.0.1:${address.port}${path}`)).status;

    for (let attempt = 0; attempt < 11; attempt += 1) {
      assert.equal(await requestStatus("/login?kind=session"), 200);
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(await requestStatus("/login?kind=challenge"), 200);
    }
    assert.equal(await requestStatus("/login?kind=challenge"), 429);
    assert.equal(await requestStatus("/register"), 200);
  });

  it("recusa repositorio em memoria em producao", async () => {
    const { createOtpRepository } = await import("../src/modules/auth/otp.repository-provider.js");
    assert.throws(() => createOtpRepository("memory", "production"), /não é permitido em produção/);
  });

  it("falha na inicializacao se OTP_ENCRYPTION_KEY estiver vazia", () => {
    assert.throws(
      () => envModule.envSchema.parse({ ...process.env, OTP_ENCRYPTION_KEY: "" }),
      /OTP_ENCRYPTION_KEY/,
    );
    const childEnv = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://127.0.0.1:5432/valesense_test?schema=public",
      JWT_SECRET: randomBytes(32).toString("hex"),
      OTP_ENCRYPTION_KEY: "",
      DOTENV_CONFIG_PATH: "arquivo-de-ambiente-inexistente",
    };
    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "await import('./src/config/env.ts')",
    ], { cwd: process.cwd(), env: childEnv, encoding: "utf8" });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /OTP_ENCRYPTION_KEY/);
  });
});
