import { randomBytes } from "node:crypto";
import { generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";
import QRCode from "qrcode";
import { assertEncryptionKey, decryptOtpSecret, encryptOtpSecret, hashRecoveryCode, recoveryCodeMatches } from "./otp-crypto.js";
import type { OtpRepository, OtpState } from "./otp.repository.js";

export type OtpServiceConfig = {
  encryptionKey: string;
  issuer: string;
  window: number;
  recoveryCodesCount: number;
};

export type OtpFailure = {
  ok: false;
  reason: "not_enabled" | "invalid_code" | "invalid_or_expired" | "step_reused" | "recovery_invalid" | "already_enabled";
};

export type OtpSuccess<T> = { ok: true; value: T };
export type OtpResult<T> = OtpSuccess<T> | OtpFailure;

function formatRecoveryCode(): string {
  const value = randomBytes(10).toString("hex").toUpperCase();
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().replace(/-/g, "").toUpperCase();
}

function makeRecoveryCodes(count: number) {
  const codes = Array.from({ length: count }, formatRecoveryCode);
  return { codes, hashes: codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code))) };
}

export function createOtpService(
  repository: OtpRepository,
  config: OtpServiceConfig,
  now: () => number = Date.now,
) {
  assertEncryptionKey(config.encryptionKey);

  async function validateTotp(state: OtpState, code: string): Promise<OtpResult<number>> {
    if (!state.encryptedSecret) return { ok: false, reason: "not_enabled" };
    if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid_code" };

    const secret = decryptOtpSecret(state.encryptedSecret, config.encryptionKey);
    // Include complete adjacent time steps while excluding steps beyond OTP_WINDOW.
    const tolerance = config.window === 0 ? 0 : config.window * 30 + 29;
    const result = await new TOTP({
      secret,
      digits: 6,
      period: 30,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    }).verify(code, {
      epoch: now() / 1000,
      epochTolerance: tolerance,
    });
    if (!result.valid) return { ok: false, reason: "invalid_or_expired" };
    if (state.lastStep !== null && result.timeStep <= state.lastStep) {
      return { ok: false, reason: "step_reused" };
    }
    return { ok: true, value: result.timeStep };
  }

  async function recoveryCodes() {
    const generated = makeRecoveryCodes(config.recoveryCodesCount);
    return { plaintext: generated.codes, hashes: generated.hashes };
  }

  return {
    async setup(userId: string, email: string): Promise<OtpResult<{ otpauthUrl: string; qrCode: string }>> {
      const state = await repository.getState(userId);
      if (!state) return { ok: false, reason: "not_enabled" };
      if (state.active) return { ok: false, reason: "already_enabled" };
      const secret = generateSecret();
      const otpauthUrl = generateURI({
        issuer: config.issuer,
        label: email,
        secret,
        digits: 6,
        period: 30,
        algorithm: "sha1",
      });
      const qrCode = await QRCode.toDataURL(otpauthUrl);
      const saved = await repository.setPendingSecret(
        userId,
        encryptOtpSecret(secret, config.encryptionKey),
      );
      if (!saved) return { ok: false, reason: "already_enabled" };
      return { ok: true, value: { otpauthUrl, qrCode } };
    },

    async activate(userId: string, code: string): Promise<OtpResult<{ recoveryCodes: string[] }>> {
      const state = await repository.getState(userId);
      if (!state || state.active) return { ok: false, reason: state?.active ? "already_enabled" : "not_enabled" };
      const result = await validateTotp(state, code);
      if (!result.ok) return result;
      const generated = await recoveryCodes();
      const activated = await repository.activateWithRecoveryCodes(userId, result.value, generated.hashes);
      if (!activated) return { ok: false, reason: "step_reused" };
      return { ok: true, value: { recoveryCodes: generated.plaintext } };
    },

    async verifyCode(userId: string, code: string): Promise<OtpResult<{ step: number }>> {
      const state = await repository.getState(userId);
      if (!state?.active) return { ok: false, reason: "not_enabled" };
      const result = await validateTotp(state, code);
      if (!result.ok) return result;
      const consumed = await repository.consumeStep(userId, result.value, new Date(now()));
      return consumed
        ? { ok: true, value: { step: result.value } }
        : { ok: false, reason: "step_reused" };
    },

    async verifyRecoveryCode(userId: string, recoveryCode: string): Promise<OtpResult<null>> {
      const state = await repository.getState(userId);
      if (!state?.active) return { ok: false, reason: "not_enabled" };
      const normalized = normalizeRecoveryCode(recoveryCode);
      const inputHash = hashRecoveryCode(normalized);
      const unusedCodes = await repository.listUnusedRecoveryCodes(userId);
      let matchedId: string | null = null;
      for (const storedCode of unusedCodes) {
        if (recoveryCodeMatches(inputHash, storedCode.codeHash)) matchedId = storedCode.id;
      }
      if (!matchedId) return { ok: false, reason: "recovery_invalid" };
      const consumed = await repository.consumeRecoveryCode(userId, matchedId, new Date(now()));
      return consumed
        ? { ok: true, value: null }
        : { ok: false, reason: "recovery_invalid" };
    },

    async disable(userId: string, code: string): Promise<OtpResult<null>> {
      const state = await repository.getState(userId);
      if (!state?.active) return { ok: false, reason: "not_enabled" };
      const result = await validateTotp(state, code);
      if (!result.ok) return result;
      const disabled = await repository.disableWithStep(userId, result.value);
      return disabled
        ? { ok: true, value: null }
        : { ok: false, reason: "step_reused" };
    },

    async regenerateRecoveryCodes(userId: string, code: string): Promise<OtpResult<{ recoveryCodes: string[] }>> {
      const state = await repository.getState(userId);
      if (!state?.active) return { ok: false, reason: "not_enabled" };
      const result = await validateTotp(state, code);
      if (!result.ok) return result;
      const generated = await recoveryCodes();
      const replaced = await repository.replaceRecoveryCodesWithStep(userId, result.value, generated.hashes);
      if (!replaced) return { ok: false, reason: "step_reused" };
      return { ok: true, value: { recoveryCodes: generated.plaintext } };
    },

    generateCode(secret: string, at: number) {
      return new TOTP({
        secret,
        digits: 6,
        period: 30,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      }).generate({ epoch: at / 1000 });
    },
  };
}
