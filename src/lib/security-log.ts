import { env } from "../config/env.js";

const missionCode = env.MISSION_CODE ?? "SEM-CODIGO";

if (!env.MISSION_CODE) {
  console.warn("[SEGURANCA][SEM-CODIGO] MISSION_CODE nao configurado.");
}

function safeLogValue(value: string): string {
  return value.replace(/[\r\n]/g, "_").slice(0, 160);
}

export function logSecurityBlocked(input: {
  control: "IDOR" | "OTP";
  reason: string;
  userId: string;
  ip: string;
  resource: string;
}): void {
  console.warn(
    `[SEGURANCA][${missionCode}] ${input.control} bloqueado: motivo=${safeLogValue(input.reason)} usuario=${safeLogValue(input.userId)} ip=${safeLogValue(input.ip)} recurso=${safeLogValue(input.resource)}`,
  );
}

export function logSecurityAdminAccess(input: {
  control: "IDOR" | "OTP";
  userId: string;
  ip: string;
  resource: string;
}): void {
  console.info(
    `[SEGURANCA][${missionCode}] ${input.control} acesso-admin: usuario=${safeLogValue(input.userId)} ip=${safeLogValue(input.ip)} recurso=${safeLogValue(input.resource)}`,
  );
}
