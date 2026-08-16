import { resolve } from "node:path";
import { DEFAULT_TTL_SECONDS, PAY_HOST } from "./constants.mjs";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function loadConfig(env = process.env) {
  const adminToken = env.PAY_SERVICE_ADMIN_TOKEN || "";
  const agentToken = env.PAY_SERVICE_AGENT_TOKEN || "";
  const oauthClientSecret = env.PAY_SERVICE_OAUTH_CLIENT_SECRET || "";
  const payTo = env.PAY_SERVICE_PAY_TO || "";
  return {
    payTo,
    adminToken,
    agentToken,
    oauthClientId: env.PAY_SERVICE_OAUTH_CLIENT_ID || "mcp-scoreboard-grok",
    oauthClientSecret,
    githubActor: env.PAY_SERVICE_GITHUB_ACTOR || "davidmosiah",
    cdpApiKeyId: env.CDP_API_KEY_ID || "",
    cdpApiKeySecret: env.CDP_API_KEY_SECRET || "",
    trustProxy: env.PAY_SERVICE_TRUSTED_PROXY === "1",
    publicBaseUrl: (env.PAY_SERVICE_PUBLIC_BASE_URL || PAY_HOST).replace(/\/+$/, ""),
    dataDir: resolve(env.PAY_SERVICE_DATA_DIR || new URL("../var", import.meta.url).pathname),
    reservationTtlMs: Number(env.PAY_SERVICE_RESERVATION_TTL_SECONDS || DEFAULT_TTL_SECONDS) * 1000,
    port: Number(env.PAY_SERVICE_PORT || 8787)
  };
}

export function configErrors(config) {
  const errors = [];
  if (!ADDRESS.test(config.payTo)) errors.push("pay_to_invalid");
  if (!config.adminToken || Buffer.byteLength(config.adminToken) < 32) errors.push("admin_token_missing");
  if (!config.agentToken || Buffer.byteLength(config.agentToken) < 32) errors.push("agent_token_missing");
  if (config.agentToken && config.agentToken === config.adminToken) errors.push("agent_token_not_isolated");
  if (!config.oauthClientId) errors.push("oauth_client_id_missing");
  if (!config.oauthClientSecret || Buffer.byteLength(config.oauthClientSecret) < 32) errors.push("oauth_client_secret_missing");
  if ([config.adminToken, config.agentToken].includes(config.oauthClientSecret)) errors.push("oauth_client_secret_not_isolated");
  if (!config.cdpApiKeyId) errors.push("cdp_api_key_id_missing");
  if (!config.cdpApiKeySecret) errors.push("cdp_api_key_secret_missing");
  return errors;
}
