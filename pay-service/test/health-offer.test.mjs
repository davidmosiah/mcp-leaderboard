import assert from "node:assert/strict";
import { after, test } from "node:test";
import { request, startService, TEST_PAY_TO, USDC_BASE, PRICE_ATOMIC } from "./helpers.mjs";

const service = await startService();
after(() => service.close());

test("GET / identifies the isolated pay host and never Delx Commerce", async () => {
  const res = await request(service, "/");
  assert.equal(res.status, 200);
  assert.equal(res.json.service, "mcp-score-improvement");
  assert.equal(res.json.host, "https://pay.leaderboard.delx.ai");
  assert.equal(res.json.board, "https://leaderboard.delx.ai");
  assert.equal(res.json.offer, "/api/offer");
  assert.equal(res.json.openapi, "/openapi.json");
  assert.equal(res.json.mcp, "/mcp");
  assert.doesNotMatch(JSON.stringify(res.json), /commerce\.delx\.ai|api\.delx\.ai/);
});

test("GET /healthz is live", async () => {
  const res = await request(service, "/healthz");
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "ok");
});

test("GET /readyz is ready when store and config are present", async () => {
  const res = await request(service, "/readyz");
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "ready");
  assert.doesNotMatch(JSON.stringify(res.json), /PAY_SERVICE_|Bearer|admin/i);
});

test("GET /api/offer is the single 49 USDC Base catalog", async () => {
  const res = await request(service, "/api/offer");
  assert.equal(res.status, 200);
  assert.equal(res.json.id, "mcp-score-improvement");
  assert.equal(res.json.price.amount, "49");
  assert.equal(res.json.price.asset, "USDC");
  assert.equal(res.json.price.network, "eip155:8453");
  assert.equal(res.json.price.atomic, PRICE_ATOMIC);
  assert.equal(res.json.price.asset_address, USDC_BASE);
  assert.equal(res.json.price.pay_to, TEST_PAY_TO);
  assert.equal(res.json.capacity.limit, 5);
  assert.ok(res.json.limitations.length >= 4);
  assert.match(res.json.independence, /never buys rank/i);
  assert.doesNotMatch(JSON.stringify(res.json), /commerce\.delx\.ai|api\.delx\.ai/);
});

test("OpenAPI and x402 discovery are on the pay host", async () => {
  const openapi = await request(service, "/openapi.json");
  assert.equal(openapi.status, 200);
  assert.equal(openapi.json.openapi, "3.1.0");
  assert.equal(openapi.json.servers[0].url, "https://pay.leaderboard.delx.ai");
  assert.ok(openapi.json.paths["/api/pay/{reservation}"]);
  assert.ok(openapi.json.paths["/mcp"]);
  assert.ok(openapi.json.components.securitySchemes.agentBearerAuth);
  assert.doesNotMatch(JSON.stringify(openapi.json), /commerce\.delx\.ai|api\.delx\.ai/);

  const discovery = await request(service, "/.well-known/x402");
  assert.equal(discovery.status, 200);
  assert.equal(discovery.json.x402Version, 2);
  assert.equal(discovery.json.resources[0].accepts[0].amount, PRICE_ATOMIC);
  assert.equal(discovery.json.resources[0].accepts[0].network, "eip155:8453");
});
