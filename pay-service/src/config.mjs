import { resolve } from "node:path";
import { DEFAULT_TTL_SECONDS, PAY_HOST } from "./constants.mjs";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function loadConfig(env = process.env) {
  const adminToken = env.PAY_SERVICE_ADMIN_TOKEN || "";
  const payTo = env.PAY_SERVICE_PAY_TO || "";
  return {
    payTo,
    adminToken,
    facilitatorUrl: env.PAY_SERVICE_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402",
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
  return errors;
}
