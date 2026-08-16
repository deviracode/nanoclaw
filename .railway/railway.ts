import { defineRailway, github, group, image, postgres, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const db = postgres("nanoclaw-db");

  const gateway = service("nanoclaw-onecli", {
    source: image("ghcr.io/onecli/onecli@sha256:d0177458b1f9ecece4abbe9abb6c5f925475357c1734f50a675d83a2ef9c8687"), // re-pin via: docker buildx imagetools inspect ghcr.io/onecli/onecli:latest
    deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
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
    resources: [group("NanoClaw", [host, gateway]), db],
  });
});
