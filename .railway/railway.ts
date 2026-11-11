import { defineRailway, preserve, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const agentArenaVolume = volume("agent-arena-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 5000 });
  const database = postgres("agent-arena-postgres", { region: "sfo" });
  const agentArena = service("agent-arena", {
    replicas: { "sfo": 1 },
    healthcheck: "/api/ready",
    healthcheckTimeout: 120,
    volumeMounts: { "/app/.data": agentArenaVolume },
    env: { DATABASE_URL: database.env.DATABASE_URL, ARC_CHAIN_ID: preserve(), ARC_RPC_URL: preserve(), ARC_USDC_ADDRESS: preserve(),
      ARENA_FACTORY_ADDRESS: preserve(), ARENA_OPERATOR_ADDRESS: preserve(), ARENA_OPERATOR_WALLET_ID: preserve(),
      CIRCLE_API_KEY: preserve(), CIRCLE_ENTITY_SECRET: preserve(), CIRCLE_WALLET_SET_ID: preserve(),
      MODEL_API_KEY: preserve(), MODEL_BASE_URL: preserve(), MODEL_ALLOWED_MODELS: preserve(),
      PUBLIC_ORIGIN: "https://agent-arena-production-7923.up.railway.app", PUBLIC_HOSTNAME: "agent-arena-production-7923.up.railway.app", HOST: preserve() },
  });

  return project("agent-arena", {
    resources: [agentArena, agentArenaVolume, database],
  });
});
