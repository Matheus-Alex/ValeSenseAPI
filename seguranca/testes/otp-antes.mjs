import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3333";
const email = process.env.OTP_TEST_EMAIL;
const password = process.env.OTP_TEST_PASSWORD;

if (!email || !password) {
  throw new Error("Defina OTP_TEST_EMAIL e OTP_TEST_PASSWORD no ambiente.");
}

const response = await fetch(new URL("/api/auth/login", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const payload = await response.json();

assert.equal(response.status, 200);
assert.equal(typeof payload.token, "string", "A versao-base deve devolver uma sessao apos senha correta.");
assert.equal(payload.otpRequired, undefined);
console.log(`login sem OTP na versao-base: HTTP ${response.status}`);
