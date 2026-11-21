import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3333";
const email = process.env.OTP_TEST_EMAIL;
const password = process.env.OTP_TEST_PASSWORD;
const windowSteps = Number(process.env.OTP_TEST_WINDOW ?? "1");
const totp = new TOTP({
  digits: 6,
  period: 30,
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

if (!email || !password || !Number.isInteger(windowSteps) || windowSteps < 0) {
  throw new Error("Defina OTP_TEST_EMAIL, OTP_TEST_PASSWORD e um OTP_TEST_WINDOW inteiro válido.");
}

async function request(path, method, body, token) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

async function login() {
  return request("/api/auth/login", "POST", { email, password });
}

async function newChallenge() {
  const response = await login();
  assert.equal(response.status, 200);
  assert.equal(response.payload?.otpRequired, true);
  assert.equal(response.payload?.token, undefined);
  return response.payload.challengeToken;
}

async function codeAt(epoch) {
  return totp.generate({ secret, epoch: epoch / 1000 });
}

const initialLogin = await login();
assert.equal(initialLogin.status, 200);
assert.equal(typeof initialLogin.payload?.token, "string", "Use uma conta de teste ainda sem OTP ativo.");

const setup = await request("/api/auth/otp/setup", "POST", {}, initialLogin.payload.token);
assert.equal(setup.status, 200);
assert.match(setup.payload?.otpauthUrl, /^otpauth:\/\/totp\//);
assert.match(setup.payload?.qrCode, /^data:image\/png;base64,/);

const secret = new URL(setup.payload.otpauthUrl).searchParams.get("secret");
assert.ok(secret);
const activationCode = await codeAt(Date.now());
const activation = await request(
  "/api/auth/otp/activate",
  "POST",
  { code: activationCode },
  initialLogin.payload.token,
);
assert.equal(activation.status, 200);
assert.ok(Array.isArray(activation.payload?.recoveryCodes));
const recoveryCode = activation.payload.recoveryCodes[0];

const challenge = await newChallenge();
const challengeAsSession = await request("/api/auth/me", "GET", undefined, challenge);
assert.equal(challengeAsSession.status, 401);

const waitUntilNextStep = async () => {
  await sleep(30_000 - (Date.now() % 30_000) + 150);
};
await waitUntilNextStep();

const validCode = await codeAt(Date.now());
const wrongCode = `${(Number(validCode[0]) + 1) % 10}${validCode.slice(1)}`;
const wrong = await request("/api/auth/login/otp", "POST", { challengeToken: challenge, code: wrongCode });
assert.equal(wrong.status, 401);
assert.deepEqual(wrong.payload, { error: "Código inválido" });

const expiredCode = await codeAt(Date.now() - (windowSteps + 2) * 30_000);
const expired = await request("/api/auth/login/otp", "POST", { challengeToken: challenge, code: expiredCode });
assert.equal(expired.status, 401);
assert.deepEqual(expired.payload, { error: "Código inválido" });

const valid = await request("/api/auth/login/otp", "POST", { challengeToken: challenge, code: validCode });
assert.equal(valid.status, 200);
assert.equal(typeof valid.payload?.token, "string");
assert.equal(valid.payload?.recoveryCodes, undefined);

const replay = await request("/api/auth/login/otp", "POST", { challengeToken: challenge, code: validCode });
assert.equal(replay.status, 401);

const recoveryChallenge = await newChallenge();
const recoveryFirstUse = await request("/api/auth/login/otp", "POST", {
  challengeToken: recoveryChallenge,
  recoveryCode,
});
assert.equal(recoveryFirstUse.status, 200);

const recoveryAgainChallenge = await newChallenge();
const recoverySecondUse = await request("/api/auth/login/otp", "POST", {
  challengeToken: recoveryAgainChallenge,
  recoveryCode,
});
assert.equal(recoverySecondUse.status, 401);
assert.deepEqual(recoverySecondUse.payload, { error: "Código inválido" });

const limitChallenge = await newChallenge();
const invalidAgain = async () => request("/api/auth/login/otp", "POST", {
  challengeToken: limitChallenge,
  code: "inválido",
});
const fifthFailure = await invalidAgain();
if (fifthFailure.status !== 429) assert.equal(fifthFailure.status, 401);
const rateLimited = await invalidAgain();
assert.equal(rateLimited.status, 429);

console.log("setup/QR e ativacao: HTTP 200");
console.log("senha correta sem OTP: challenge, sem sessao");
console.log(`challenge como sessao: HTTP ${challengeAsSession.status}`);
console.log(`codigo errado/vencido/reutilizado: HTTP ${wrong.status}/${expired.status}/${replay.status}`);
console.log(`codigo valido e recuperacao (uso unico): HTTP ${valid.status}/${recoveryFirstUse.status}/${recoverySecondUse.status}`);
console.log(`limite por tentativas: HTTP ${rateLimited.status}`);
