import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("OTP_ENCRYPTION_KEY deve ser uma chave Base64 válida de 32 bytes.");
  }
  return key;
}

export function assertEncryptionKey(encodedKey: string): void {
  encryptionKey(encodedKey);
}

export function encryptOtpSecret(secret: string, encodedKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptOtpSecret(encryptedSecret: string, encodedKey: string): string {
  const [version, encodedIv, encodedTag, encodedData, extra] = encryptedSecret.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedData || extra !== undefined) {
    throw new Error("Formato de segredo OTP cifrado inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function recoveryCodeMatches(inputHash: string, storedHash: string): boolean {
  const input = Buffer.from(inputHash, "hex");
  const stored = Buffer.from(storedHash, "hex");
  return input.length === stored.length && timingSafeEqual(input, stored);
}
