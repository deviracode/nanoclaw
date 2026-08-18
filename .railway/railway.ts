import { defineRailway, github, group, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  const db = postgres("nanoclaw-db");
  const hostVolume = volume("nanoclaw-volume", { sizeMB: 50000, region: "europe-west4-drams3a" });
  const gatewayVolume = volume("nanoclaw-onecli-volume", { sizeMB: 50000, region: "europe-west4-drams3a" });

  const gateway = service("nanoclaw-onecli", {
    source: github("deviracode/nanoclaw", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "railway/Dockerfile.onecli",
    },
    deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    volumeMounts: {
      "/app/data": gatewayVolume,
    },
    env: {
      DATABASE_URL: "${{nanoclaw-db.DATABASE_URL}}",
      APP_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254",
      GATEWAY_API_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10255",
      INTERNAL_API_URL: "http://localhost:10254",
      NEXTAUTH_SECRET: preserve(),
    },
  });

  const host = service("nanoclaw", {
    source: github("deviracode/nanoclaw", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "railway/Dockerfile.railway",
    },
    healthcheckPath: "/healthz",
    deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    volumeMounts: {
      "/data": hostVolume,
    },
    env: {
      NODE_ENV: "production",
      NANOCLAW_RUNTIME: "host",
      NANOCLAW_HOME: "/data",
      NANOCLAW_BOOTSTRAP: preserve(),
      NANOCLAW_OWNER_ID: preserve(),
      NANOCLAW_OWNER_DISPLAY_NAME: preserve(),
      NANOCLAW_AGENT_NAME: preserve(),
      NANOCLAW_BOOTSTRAP_CHANNELS: preserve(),
      NANOCLAW_PICKED_PROVIDER: "opencode",
      OPENCODE_PROVIDER: preserve(),
      OPENCODE_MODEL: preserve(),
      OPENCODE_SMALL_MODEL: preserve(),
      ANTHROPIC_BASE_URL: preserve(),
      TELEGRAM_BOT_TOKEN: preserve(),
      WHATSAPP_PHONE_NUMBER: preserve(),
      WHATSAPP_ENABLED: preserve(),
      ONECLI_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254",
      ONECLI_API_KEY: preserve(),
      TZ: preserve(),
    },
  });

  return project("nanoclaw", {
    resources: [group("NanoClaw", [host, gateway]), db, hostVolume, gatewayVolume],
  });
});
