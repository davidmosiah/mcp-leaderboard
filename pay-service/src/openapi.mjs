import { PAY_HOST, PRICE_ATOMIC, SERVICE_NAME } from "./constants.mjs";

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: SERVICE_NAME,
      version: "0.1.0",
      description:
        "Isolated MCP Score Improvement contract on pay.leaderboard.delx.ai. Payment never buys rank or publication."
    },
    servers: [{ url: PAY_HOST }],
    paths: {
      "/": { get: { summary: "Service identity", responses: { 200: { description: "Identity" } } } },
      "/healthz": { get: { summary: "Liveness", responses: { 200: { description: "OK" } } } },
      "/readyz": { get: { summary: "Readiness", responses: { 200: { description: "Ready" }, 503: { description: "Not ready" } } } },
      "/api/offer": { get: { summary: "Machine-readable catalog", responses: { 200: { description: "Offer" } } } },
      "/api/inquiry": {
        post: {
          summary: "Free public inquiry",
          responses: { 201: { description: "Recorded" }, 400: { description: "Rejected" }, 429: { description: "Rate limited" } }
        }
      },
      "/api/inquiry/{code}": {
        get: { summary: "Sanitized inquiry", parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Public inquiry" } } }
      },
      "/api/fit/approve": {
        post: { summary: "Human fit approval", security: [{ bearerAuth: [] }], responses: { 201: { description: "Reservation created" }, 401: { description: "Unauthorized" } } }
      },
      "/api/reservation/{code}": {
        get: { summary: "Sanitized reservation", parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Reservation" }, 410: { description: "Expired" } } }
      },
      "/api/pay/{reservation}": {
        post: {
          summary: "Official x402 v2 settlement for an approved reservation",
          description: `Exactly 49 USDC on Base (${PRICE_ATOMIC} atomic). Missing or expired reservations do not return 402.`,
          parameters: [{ name: "reservation", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Paid" }, 402: { description: "Payment required" }, 404: { description: "Unknown reservation" }, 410: { description: "Expired" } }
        }
      },
      "/api/order/{id}": {
        get: { summary: "Sanitized order", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Order" } } }
      },
      "/api/receipt/{id}": {
        get: { summary: "Sanitized receipt", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Receipt" } } }
      },
      "/mcp": {
        post: {
          summary: "Restricted Grok operations over MCP Streamable HTTP",
          description: "Exactly five least-privilege tools. No admin, refund, reconcile, wallet, deploy, merge, or publish capability.",
          security: [{ agentBearerAuth: [] }],
          responses: { 200: { description: "MCP JSON-RPC response" }, 401: { description: "Unauthorized" } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Runtime admin token from env. No production secret is stored in the repository." },
        agentBearerAuth: { type: "http", scheme: "bearer", description: "Separate least-privilege agent credential loaded by systemd. It is rejected by admin routes." }
      }
    }
  };
}
