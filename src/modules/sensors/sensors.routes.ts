import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { authorize } from "../../middleware/authorize.js";
import { idSchema } from "../../lib/ids.js";
import { prisma } from "../../lib/prisma.js";
import { assertCanAccessResource } from "../../lib/ownership-prisma.js";
import { logSecurityAdminAccess, logSecurityBlocked } from "../../lib/security-log.js";
import { recordAccess } from "../access-log/access-log.js";

const sensorStatusSchema = z.object({
  status: z.enum(["ATIVO", "INATIVO", "MANUTENCAO"]),
});

const createSensorSchema = z.object({
  talhaoId: idSchema,
  identificador: z.string().trim().min(1).max(50),
  canalThingSpeak: z.string().trim().max(50).optional(),
});

const commandSchema = z.object({
  comando: z.enum(["LIGAR", "DESLIGAR"]),
});

export const sensorsRouter = Router();
sensorsRouter.use(authenticate);

sensorsRouter.get("/plots", async (request, response, next) => {
  try {
    if (request.user!.role !== "ADMIN" && request.user!.role !== "PRODUTOR_EXPORTADOR") {
      return response.status(403).json({ error: "Acesso não autorizado" });
    }
    if (request.user!.role === "ADMIN") {
      logSecurityAdminAccess({
        control: "IDOR",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: "talhoes:*",
      });
    }
    const plots = await prisma.talhao.findMany({
      where: request.user!.role === "PRODUTOR_EXPORTADOR"
        ? { propriedade: { usuarioId: request.user!.id } }
        : undefined,
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        area: true,
        unidadeArea: true,
        propriedade: { select: { nome: true } },
      },
    });
    return response.status(200).json({ data: plots });
  } catch (error) {
    next(error);
  }
});

sensorsRouter.get("/", async (request, response, next) => {
  try {
    if (request.user!.role === "ADMIN") {
      logSecurityAdminAccess({
        control: "IDOR",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: "sensores:*",
      });
    }
    const sensors = await prisma.sensor.findMany({
      where: request.user!.role !== "ADMIN"
        ? { talhao: { propriedade: { usuarioId: request.user!.id } } }
        : undefined,
      orderBy: { identificador: "asc" },
      include: {
        talhao: {
          select: {
            id: true,
            nome: true,
            propriedade: { select: { nome: true } },
          },
        },
        leituras: { orderBy: { dataHora: "desc" }, take: 1 },
      },
    });
    return response.status(200).json({
      data: sensors.map((sensor) => ({
        id: sensor.id,
        identificador: sensor.identificador,
        status: sensor.status,
        canalThingSpeak: sensor.canalThingSpeak,
        talhao: sensor.talhao,
        ultimaLeitura: sensor.leituras[0]
          ? {
              temperatura: Number(sensor.leituras[0].temperatura),
              umidade: Number(sensor.leituras[0].umidade),
              timestamp: sensor.leituras[0].dataHora.toISOString(),
            }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

sensorsRouter.post("/", authorize("ADMIN", "PRODUTOR_EXPORTADOR"), async (request, response, next) => {
  try {
    const input = createSensorSchema.parse(request.body);
    await assertCanAccessResource(request.user!, "talhao", input.talhaoId, request.ip ?? "desconhecido");
    const sensor = await prisma.sensor.create({
      data: {
        talhaoId: input.talhaoId,
        identificador: input.identificador,
        canalThingSpeak: input.canalThingSpeak || null,
      },
    });
    await recordAccess(request, request.user!.id, "SENSOR", "SUCESSO");
    return response.status(201).json({ sensor });
  } catch (error) {
    next(error);
  }
});

sensorsRouter.patch("/:id/status", authorize("ADMIN", "PRODUTOR_EXPORTADOR"), async (request, response, next) => {
  try {
    const id = idSchema.parse(request.params.id);
    const { status } = sensorStatusSchema.parse(request.body);
    await assertCanAccessResource(request.user!, "sensor", id, request.ip ?? "desconhecido");
    const result = await prisma.sensor.updateMany({ where: { id }, data: { status } });
    if (!result.count) {
      logSecurityBlocked({
        control: "IDOR",
        reason: "recurso_removido",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: `sensor:${id}`,
      });
      return response.status(404).json({ error: "Recurso não encontrado" });
    }
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    await recordAccess(request, request.user!.id, "SENSOR", "SUCESSO");
    return response.status(200).json({ sensor });
  } catch (error) {
    next(error);
  }
});

sensorsRouter.post("/:id/comandos", async (request, response, next) => {
  try {
    const id = idSchema.parse(request.params.id);
    const { comando } = commandSchema.parse(request.body);
    await assertCanAccessResource(request.user!, "sensor", id, request.ip ?? "desconhecido");
    const status = comando === "LIGAR" ? "ATIVO" : "INATIVO";
    const result = await prisma.sensor.updateMany({ where: { id }, data: { status } });
    if (!result.count) {
      logSecurityBlocked({
        control: "IDOR",
        reason: "recurso_removido",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: `sensor:${id}`,
      });
      return response.status(404).json({ error: "Recurso não encontrado" });
    }
    const sensor = await prisma.sensor.findUnique({ where: { id } });
    await recordAccess(request, request.user!.id, "SENSOR", "SUCESSO");
    return response.status(200).json({ message: "Comando registrado", sensor });
  } catch (error) {
    next(error);
  }
});
