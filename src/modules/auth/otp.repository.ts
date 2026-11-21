export type OtpState = {
  active: boolean;
  encryptedSecret: string | null;
  lastStep: number | null;
};

export type RecoveryCodeHash = {
  id: string;
  codeHash: string;
};

export interface OtpRepository {
  getState(userId: string): Promise<OtpState | null>;
  setPendingSecret(userId: string, encryptedSecret: string): Promise<boolean>;
  activateWithRecoveryCodes(userId: string, step: number, codes: string[]): Promise<boolean>;
  consumeStep(userId: string, step: number, usedAt: Date): Promise<boolean>;
  listUnusedRecoveryCodes(userId: string): Promise<RecoveryCodeHash[]>;
  consumeRecoveryCode(userId: string, codeId: string, usedAt: Date): Promise<boolean>;
  disableWithStep(userId: string, step: number): Promise<boolean>;
  replaceRecoveryCodesWithStep(userId: string, step: number, codes: string[]): Promise<boolean>;
}
