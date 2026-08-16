import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  approveInquiry,
  openInquiry,
  payReservation,
  request,
  startService
} from "./helpers.mjs";

const service = await startService({
  fitVerifier: async () => ({ qualified: true, evidence: ["github", "npm", "scoreboard"] }),
  githubPrVerifier: async ({ orderId, phase }) => ({
    verified: true,
    evidence: { order_id: orderId, phase, author: "davidmosiah", draft: true }
  })
});
after(() => service.close());

async function mcp(body, token = service.agentToken) {
  return request(service, "/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream"
    },
    body
  });
}

async function callTool(name, args = {}) {
  return mcp({
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1_000_000),
    method: "tools/call",
    params: { name, arguments: args }
  });
}

test("agent MCP uses a separate bearer and exposes no admin or money-moving tools", async () => {
  const denied = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, "wrong-token");
  assert.equal(denied.status, 401);

  const adminDenied = await mcp(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    service.token
  );
  assert.equal(adminDenied.status, 401);

  const listed = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  assert.equal(listed.status, 200, listed.text);
  const names = listed.json.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "scoreboard_complete_delivery",
    "scoreboard_get_status",
    "scoreboard_list_work",
    "scoreboard_qualify_inquiry",
    "scoreboard_start_delivery"
  ]);
  assert.ok(names.every((name) => !/refund|reconcile|cancel|deploy|wallet|admin/.test(name)));
  assert.doesNotMatch(listed.text, /PAY_SERVICE_|CDP_API|reply_email/i);
});

test("agent qualifies a public inquiry only through the deterministic verifier", async () => {
  const inquiry = await openInquiry(service, { body: { npm_package: "agent-qualified-mcp" } });
  const qualified = await callTool("scoreboard_qualify_inquiry", {
    inquiry_code: inquiry.json.inquiry_code
  });
  assert.equal(qualified.status, 200, qualified.text);
  assert.equal(qualified.json.result.structuredContent.state, "payment_pending");
  assert.match(qualified.json.result.structuredContent.pay_route, /^https:\/\/pay\.leaderboard\.delx\.ai\/api\/pay\//);
  const replay = await callTool("scoreboard_qualify_inquiry", {
    inquiry_code: inquiry.json.inquiry_code
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(
    replay.json.result.structuredContent.reservation_code,
    qualified.json.result.structuredContent.reservation_code
  );
});

test("agent delivery mutations require a live matching GitHub draft PR proof", async () => {
  const inquiry = await openInquiry(service, { body: { npm_package: "agent-delivery-mcp" } });
  const approved = await approveInquiry(service, inquiry.json.inquiry_code);
  const paid = await payReservation(service, approved.json.reservation_code);
  assert.equal(paid.status, 200, paid.text);

  const draftPrUrl = "https://github.com/octocat/Hello-World/pull/42";
  const started = await callTool("scoreboard_start_delivery", {
    order_id: paid.json.order_id,
    draft_pr_url: draftPrUrl
  });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.result.structuredContent.state, "delivery_in_progress");

  const completed = await callTool("scoreboard_complete_delivery", {
    order_id: paid.json.order_id,
    draft_pr_url: draftPrUrl
  });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.json.result.structuredContent.state, "delivered");

  const work = await callTool("scoreboard_list_work");
  assert.equal(work.status, 200, work.text);
  assert.ok(work.json.result.structuredContent.orders.some((row) => row.order_id === paid.json.order_id));
  assert.doesNotMatch(work.text, /maintainer@example\.com|PAY_SERVICE_|CDP_API/i);
});
