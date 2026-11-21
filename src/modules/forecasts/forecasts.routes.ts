import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { prisma } from "../../lib/prisma.js";
import { logSecurityAdminAccess } from "../../lib/security-log.js";

export const forecastsRouter = Router();

forecastsRouter.get("/alerts", authenticate, async (request, response, next) => {
  try {
    if (request.user!.role !== "ADMIN" && request.user!.role !== "PRODUTOR_EXPORTADOR") {
      return response.status(403).json({ error: "Acesso não autorizado" });
    }
    if (request.user!.role === "ADMIN") {
      logSecurityAdminAccess({
        control: "IDOR",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: "alertas:*",
      });
    }
    const alerts = await prisma.alerta.findMany({
      where: request.user!.role === "PRODUTOR_EXPORTADOR"
        ? { previsao: { talhao: { propriedade: { usuarioId: request.user!.id } } } }
        : undefined,
      orderBy: { criadoEm: "desc" },
      take: 100,
      include: {
        previsao: {
          select: {
            tipo: true,
            dataInicio: true,
            dataFim: true,
            talhao: {
              select: {
                id: true,
                nome: true,
                propriedade: { select: { nome: true } },
              },
            },
          },
        },
      },
    });

    return response.status(200).json({
      data: alerts.map((alert) => ({
        id: alert.id,
        tipo: alert.tipo,
        mensagem: alert.mensagem,
        nivel: alert.nivel,
        status: alert.status,
        criadoEm: alert.criadoEm.toISOString(),
        previsao: {
          tipo: alert.previsao.tipo,
          dataInicio: alert.previsao.dataInicio.toISOString().slice(0, 10),
          dataFim: alert.previsao.dataFim.toISOString().slice(0, 10),
          talhao: alert.previsao.talhao,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
});

forecastsRouter.get("/", authenticate, async (request, response, next) => {
  try {
    const hoje = new Date();
    const inicioHoje = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
    if (request.user!.role === "ADMIN") {
      logSecurityAdminAccess({
        control: "IDOR",
        userId: request.user!.id,
        ip: request.ip ?? "desconhecido",
        resource: "previsoes:*",
      });
    }
    const forecasts = await prisma.previsao.findMany({
      where: {
        dataFim: { gte: inicioHoje },
        ...(request.user!.role !== "ADMIN" && {
          talhao: { propriedade: { usuarioId: request.user!.id } },
        }),
      },
      orderBy: { dataInicio: "asc" },
      take: 100,
      include: {
        talhao: {
          select: {
            id: true,
            nome: true,
            propriedade: { select: { nome: true } },
          },
        },
      },
    });

    return response.status(200).json({
      data: forecasts.map((forecast) => ({
        id: forecast.id,
        tipo: forecast.tipo,
        dataInicio: forecast.dataInicio.toISOString().slice(0, 10),
        dataFim: forecast.dataFim.toISOString().slice(0, 10),
        confianca: forecast.confianca === null ? null : Number(forecast.confianca),
        talhao: forecast.talhao,
      })),
    });
  } catch (error) {
    next(error);
  }
});
