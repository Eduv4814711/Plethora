import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { config } from "../../lib/config.js";

const GRAPH_URL = "https://graph.facebook.com";
const CONNECTIVITY_TIMEOUT_MS = 5000;

export async function healthRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.get("/health", { preHandler: protect }, async (request, reply) => {
    const phoneNumberConfigured = Boolean(config.whatsapp.phoneNumberId);
    const wabaConfigured = Boolean(config.whatsapp.wabaId);
    const accessTokenConfigured = Boolean(config.whatsapp.accessToken);
    const appSecretConfigured = Boolean(config.whatsapp.appSecret);
    const verifyTokenConfigured = Boolean(config.whatsapp.verifyToken);

    const configured =
      phoneNumberConfigured &&
      wabaConfigured &&
      accessTokenConfigured &&
      appSecretConfigured &&
      verifyTokenConfigured;

    const response: {
      enabled: boolean;
      configured: boolean;
      phoneNumberConfigured: boolean;
      wabaConfigured: boolean;
      accessTokenConfigured: boolean;
      appSecretConfigured: boolean;
      verifyTokenConfigured: boolean;
      apiVersion: string;
      metaApiReachable?: boolean;
    } = {
      enabled: config.whatsapp.enabled,
      configured,
      phoneNumberConfigured,
      wabaConfigured,
      accessTokenConfigured,
      appSecretConfigured,
      verifyTokenConfigured,
      apiVersion: config.whatsapp.apiVersion,
    };

    const q = request.query as { connectivity?: string } | undefined;
    if (q?.connectivity === "true" && config.whatsapp.accessToken && config.whatsapp.phoneNumberId) {
      try {
        const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}`;
        const metaRes = await fetch(url, {
          headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
          signal: AbortSignal.timeout(CONNECTIVITY_TIMEOUT_MS),
        });
        response.metaApiReachable = metaRes.ok;
      } catch {
        response.metaApiReachable = false;
      }
    }

    return reply.send(response);
  });
}
