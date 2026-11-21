import { env } from "../../config/env.js";
import { MemoryOtpRepository } from "./memory-otp.repository.js";
import { PrismaOtpRepository } from "./prisma-otp.repository.js";
import type { OtpRepository } from "./otp.repository.js";

export function createOtpRepository(store: "memory" | "prisma", nodeEnv: string): OtpRepository {
  if (store === "memory") {
    if (nodeEnv === "production") {
      console.error("OTP_STORE=memory não pode ser usado em produção; configure OTP_STORE=prisma.");
      throw new Error("OTP_STORE=memory não é permitido em produção.");
    }
    console.warn("OTP_STORE=memory: dados OTP são temporários e serão perdidos ao reiniciar a API.");
    return new MemoryOtpRepository();
  }
  return new PrismaOtpRepository();
}

export const otpRepository = createOtpRepository(env.OTP_STORE, env.NODE_ENV);
