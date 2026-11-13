import { defineRailway, preserve, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const agentArenaVolume = volume("agent-arena-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 5000 });
  const database = postgres("agent-arena-postgres", { region: "sfo" });
  const agentArena = service("agent-arena", {
    replicas: { "sfo": 1 },
    healthcheck: "/api/ready",
    healthcheckTimeout: 120,
    volumeMounts: { "/app/.data": agentArenaVolume },
    env: { DATABASE_URL: database.env.DATABASE_URL, NEAR_NETWORK: preserve(), NEAR_RPC_URL: preserve(),
      ARENA_CONTRACT_ID: preserve(), ARENA_OPERATOR_ID: preserve(), ARENA_OPERATOR_PRIVATE_KEY: preserve(), AGENT_KEY_SECRET: preserve(),
      NEARAI_API_KEY: preserve(), NEARAI_BASE_URL: preserve(), NEARAI_MODELS: preserve(), AGENT_TIMEOUT_MS: preserve(), ARENA_DECISION_POLICY: preserve(),
      INTENTS_QUOTE_RECIPIENT: preserve(), ONECLICK_JWT: preserve(), AGENT_MARKET_TOKEN: preserve(), AGENT_MARKET_LISTING_URL: preserve(),
      RELAYER_ID: preserve(), RELAYER_PRIVATE_KEY: preserve(), SPONSOR_NEAR: preserve(), SPONSOR_DAILY_CAP: preserve(), AGENT_CREATE_HOURLY_CAP: preserve(),
      FASTAUTH_CLIENT_ID: preserve(), FASTAUTH_CONTRACT_ID: preserve(), FASTAUTH_MPC_CONTRACT_ID: preserve(), HOUSE_AGENTS: preserve(), HOUSE_MAX_ENTRY_NEAR: preserve(), TRUST_PROXY: preserve(),
      PUBLIC_ORIGIN: "https://holecard.fun", PUBLIC_HOSTNAME: "holecard.fun", HOST: preserve() },
  });

  return project("agent-arena", {
    resources: [agentArena, agentArenaVolume, database],
  });
});
