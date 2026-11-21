import { randomUUID } from "node:crypto";
import type { OtpRepository, OtpState, RecoveryCodeHash } from "./otp.repository.js";

type StoredRecoveryCode = RecoveryCodeHash & { usedAt: Date | null };

export class MemoryOtpRepository implements OtpRepository {
  private readonly states = new Map<string, OtpState>();
  private readonly recoveryCodes = new Map<string, StoredRecoveryCode[]>();

  async getState(userId: string): Promise<OtpState | null> {
    const state = this.states.get(userId);
    return state ? { ...state } : { active: false, encryptedSecret: null, lastStep: null };
  }

  async setPendingSecret(userId: string, encryptedSecret: string): Promise<boolean> {
    const state = await this.getState(userId);
    if (!state || state.active) return false;
    this.states.set(userId, { active: false, encryptedSecret, lastStep: null });
    return true;
  }

  async activateWithRecoveryCodes(userId: string, step: number, codes: string[]): Promise<boolean> {
    const state = this.states.get(userId) ?? { active: false, encryptedSecret: null, lastStep: null };
    if (!state || state.active || !state.encryptedSecret || (state.lastStep !== null && step <= state.lastStep)) {
      return false;
    }
    this.states.set(userId, { ...state, active: true, lastStep: step });
    this.replaceCodes(userId, codes);
    return true;
  }

  async consumeStep(userId: string, step: number, _usedAt: Date): Promise<boolean> {
    const state = this.states.get(userId) ?? { active: false, encryptedSecret: null, lastStep: null };
    if (!state?.active || (state.lastStep !== null && step <= state.lastStep)) return false;
    this.states.set(userId, { ...state, lastStep: step });
    return true;
  }

  async listUnusedRecoveryCodes(userId: string): Promise<RecoveryCodeHash[]> {
    return (this.recoveryCodes.get(userId) ?? [])
      .filter((code) => code.usedAt === null)
      .map(({ id, codeHash }) => ({ id, codeHash }));
  }

  async consumeRecoveryCode(userId: string, codeId: string, usedAt: Date): Promise<boolean> {
    const code = (this.recoveryCodes.get(userId) ?? []).find((item) => item.id === codeId && item.usedAt === null);
    if (!code) return false;
    code.usedAt = usedAt;
    return true;
  }

  async disableWithStep(userId: string, step: number): Promise<boolean> {
    const state = this.states.get(userId) ?? { active: false, encryptedSecret: null, lastStep: null };
    if (!state?.active || (state.lastStep !== null && step <= state.lastStep)) return false;
    this.states.set(userId, { active: false, encryptedSecret: null, lastStep: null });
    this.recoveryCodes.delete(userId);
    return true;
  }

  async replaceRecoveryCodesWithStep(userId: string, step: number, codes: string[]): Promise<boolean> {
    const state = this.states.get(userId) ?? { active: false, encryptedSecret: null, lastStep: null };
    if (!state?.active || (state.lastStep !== null && step <= state.lastStep)) return false;
    this.states.set(userId, { ...state, lastStep: step });
    this.replaceCodes(userId, codes);
    return true;
  }

  private replaceCodes(userId: string, codes: string[]): void {
    this.recoveryCodes.set(userId, codes.map((codeHash) => ({
      id: randomUUID(),
      codeHash,
      usedAt: null,
    })));
  }
}
