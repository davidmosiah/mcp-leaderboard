import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.mjs";

export const TEST_PAY_TO = "0x1111111111111111111111111111111111111111";
export const TEST_PAYER = "0x2222222222222222222222222222222222222222";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const PRICE_ATOMIC = "49000000";
export const SETTLEMENT_TX = `0x${"ab".repeat(32)}`;

export function adminToken() {
  return randomBytes(32).toString("base64url");
}

export function createMockFacilitator() {
  const calls = { verify: [], settle: [], supported: 0 };
  return {
    calls,
    async getSupported() {
      calls.supported += 1;
      return {
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
        extensions: ["bazaar"],
        signers: {}
      };
    },
    async verify(paymentPayload, paymentRequirements) {
      calls.verify.push({ paymentPayload, paymentRequirements });
      const signature = paymentPayload?.payload?.signature;
      if (typeof signature === "string" && signature.startsWith("0xvalid")) {
        return { isValid: true, payer: paymentPayload.payload?.authorization?.from || TEST_PAYER };
      }
      return { isValid: false, invalidReason: "invalid_signature" };
    },
    async settle(paymentPayload, paymentRequirements) {
      calls.settle.push({ paymentPayload, paymentRequirements });
      const signature = paymentPayload?.payload?.signature;
      if (typeof signature !== "string" || !signature.startsWith("0xvalid")) {
        return {
          success: false,
          errorReason: "invalid_signature",
          transaction: "",
          network: "eip155:8453"
        };
      }
      return {
        success: true,
        transaction: SETTLEMENT_TX,
        network: "eip155:8453",
        payer: paymentPayload.payload?.authorization?.from || TEST_PAYER,
        amount: paymentRequirements.amount || PRICE_ATOMIC
      };
    }
  };
}

export function encodePayment(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function paymentPayload({ resourceUrl, signature = "0xvalidsettlement", payTo = TEST_PAY_TO, accepted } = {}) {
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: "MCP Score Improvement PR",
      mimeType: "application/json"
    },
    accepted: accepted || {
      scheme: "exact",
      network: "eip155:8453",
      amount: PRICE_ATOMIC,
      asset: USDC_BASE,
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" }
    },
    payload: {
      signature,
      authorization: {
        from: TEST_PAYER,
        to: payTo,
        value: PRICE_ATOMIC,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"12".repeat(32)}`
      }
    }
  };
}

export function decodePaymentRequired(headers) {
  const required = headers.get("payment-required") || headers.get("PAYMENT-REQUIRED");
  if (!required) return null;
  return JSON.parse(Buffer.from(required, "base64").toString("utf8"));
}

export async function challengePay(service, code) {
  return request(service, `/api/pay/${code}`, { method: "POST" });
}

export async function payReservation(service, code, { signature = "0xvalidsettlement", extraHeaders = {} } = {}) {
  const challenge = await challengePay(service, code);
  const decoded = decodePaymentRequired(challenge.headers);
  const accepted = decoded?.accepts?.[0];
  const resourceUrl = decoded?.resource?.url || `${service.base}/api/pay/${code}`;
  return request(service, `/api/pay/${code}`, {
    method: "POST",
    headers: {
      "PAYMENT-SIGNATURE": encodePayment(paymentPayload({ resourceUrl, signature, accepted })),
      ...extraHeaders
    }
  });
}

export async function startService(overrides = {}) {
  const clockState = { now: overrides.now || Date.parse("2026-08-16T12:00:00.000Z") };
  const token = overrides.adminToken || adminToken();
  const facilitator = overrides.facilitator || createMockFacilitator();
  const dataDir = overrides.dataDir || mkdtempSync(join(tmpdir(), "mcp-pay-service-"));
  const app = await createApp({
    env: {
      PAY_SERVICE_PAY_TO: TEST_PAY_TO,
      PAY_SERVICE_ADMIN_TOKEN: token,
      PAY_SERVICE_PUBLIC_BASE_URL: "https://pay.leaderboard.delx.ai",
      PAY_SERVICE_DATA_DIR: dataDir,
      PAY_SERVICE_RESERVATION_TTL_SECONDS: String(overrides.ttlSeconds || 86400),
      PAY_SERVICE_FACILITATOR_URL: "https://x402.org/facilitator",
      ...overrides.env
    },
    facilitator,
    clock: () => clockState.now,
    initializeX402: overrides.initializeX402 !== false
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    app,
    server,
    port,
    base: `http://127.0.0.1:${port}`,
    token,
    facilitator,
    dataDir,
    clockState,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

export async function request(service, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    headers["content-type"] = headers["content-type"] || "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(`${service.base}${path}`, {
    method: options.method || "GET",
    headers,
    body
  });
  const text = await response.text();
  let jsonBody = null;
  try {
    jsonBody = text ? JSON.parse(text) : null;
  } catch {
    jsonBody = null;
  }
  return { status: response.status, headers: response.headers, text, json: jsonBody };
}

export function inquiryBody(overrides = {}) {
  const npmPackage = overrides.npm_package || "hello-mcp";
  const encoded = npmPackage.split("/").map(encodeURIComponent).join("/");
  return {
    public_repository_url: "https://github.com/octocat/Hello-World",
    npm_package: npmPackage,
    scoreboard_url: `https://leaderboard.delx.ai/servers/${encoded}/`,
    reply_email: "maintainer@example.com",
    ...overrides
  };
}

export async function openInquiry(service, overrides = {}) {
  const created = await request(service, "/api/inquiry", {
    method: "POST",
    body: inquiryBody(overrides.body),
    headers: overrides.headers
  });
  return created;
}

export async function approveInquiry(service, inquiryCode) {
  return request(service, "/api/fit/approve", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { inquiry_code: inquiryCode }
  });
}

export function hashIp(ip) {
  return createHash("sha256").update(ip).digest("hex");
}
