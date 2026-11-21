import { prisma } from "../../lib/prisma.js";
import type { OtpRepository, OtpState, RecoveryCodeHash } from "./otp.repository.js";

function stepCondition(step: number) {
  return {
    OR: [
      { otpUltimoPasso: null },
      { otpUltimoPasso: { lt: step } },
    ],
  };
}

export class PrismaOtpRepository implements OtpRepository {
  async getState(userId: string): Promise<OtpState | null> {
    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { otpAtivo: true, otpSegredoCifrado: true, otpUltimoPasso: true },
    });
    if (!user) return null;
    return {
      active: user.otpAtivo,
      encryptedSecret: user.otpSegredoCifrado,
      lastStep: user.otpUltimoPasso,
    };
  }

  async setPendingSecret(userId: string, encryptedSecret: string): Promise<boolean> {
    const result = await prisma.usuario.updateMany({
      where: { id: userId, otpAtivo: false },
      data: { otpSegredoCifrado: encryptedSecret, otpUltimoPasso: null },
    });
    return result.count === 1;
  }

  async activateWithRecoveryCodes(userId: string, step: number, codes: string[]): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.usuario.updateMany({
        where: {
          id: userId,
          otpAtivo: false,
          otpSegredoCifrado: { not: null },
          ...stepCondition(step),
        },
        data: { otpAtivo: true, otpUltimoPasso: step },
      });
      if (result.count !== 1) return false;
      await transaction.codigoRecuperacao.deleteMany({ where: { usuarioId: userId } });
      await transaction.codigoRecuperacao.createMany({
        data: codes.map((codigoHash) => ({ usuarioId: userId, codigoHash })),
      });
      return true;
    });
  }

  async consumeStep(userId: string, step: number, _usedAt: Date): Promise<boolean> {
    const result = await prisma.usuario.updateMany({
      where: { id: userId, otpAtivo: true, ...stepCondition(step) },
      data: { otpUltimoPasso: step },
    });
    return result.count === 1;
  }

  async listUnusedRecoveryCodes(userId: string): Promise<RecoveryCodeHash[]> {
    return prisma.codigoRecuperacao.findMany({
      where: { usuarioId: userId, usadoEm: null },
      select: { id: true, codigoHash: true },
    }).then((codes) => codes.map(({ id, codigoHash }) => ({ id, codeHash: codigoHash })));
  }

  async consumeRecoveryCode(userId: string, codeId: string, usedAt: Date): Promise<boolean> {
    const result = await prisma.codigoRecuperacao.updateMany({
      where: { id: codeId, usuarioId: userId, usadoEm: null },
      data: { usadoEm: usedAt },
    });
    return result.count === 1;
  }

  async disableWithStep(userId: string, step: number): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.usuario.updateMany({
        where: { id: userId, otpAtivo: true, ...stepCondition(step) },
        data: { otpAtivo: false, otpSegredoCifrado: null, otpUltimoPasso: null },
      });
      if (result.count !== 1) return false;
      await transaction.codigoRecuperacao.deleteMany({ where: { usuarioId: userId } });
      return true;
    });
  }

  async replaceRecoveryCodesWithStep(userId: string, step: number, codes: string[]): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.usuario.updateMany({
        where: { id: userId, otpAtivo: true, ...stepCondition(step) },
        data: { otpUltimoPasso: step },
      });
      if (result.count !== 1) return false;
      await transaction.codigoRecuperacao.deleteMany({ where: { usuarioId: userId } });
      await transaction.codigoRecuperacao.createMany({
        data: codes.map((codigoHash) => ({ usuarioId: userId, codigoHash })),
      });
      return true;
    });
  }
}
