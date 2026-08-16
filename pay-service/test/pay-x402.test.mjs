import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  PRICE_ATOMIC,
  SETTLEMENT_TX,
  USDC_BASE,
  approveInquiry,
  decodePaymentRequired,
  openInquiry,
  payReservation,
  request,
  startService
} from "./helpers.mjs";

const service = await startService();
after(() => service.close());

async function approvedReservation(target = service) {
  const created = await openInquiry(target, { body: { npm_package: `pay-${Math.random().toString(16).slice(2)}` } });
  const approved = await approveInquiry(target, created.json.inquiry_code);
  assert.equal(approved.status, 201, JSON.stringify(approved.json));
  return approved.json.reservation_code;
}

test("missing, unapproved, and expired reservations fail without a 402", async () => {
  const missing = await request(service, "/api/pay/not-a-real-reservation", { method: "POST" });
  assert.notEqual(missing.status, 402);
  assert.equal(missing.status, 404);

  const created = await openInquiry(service, { body: { npm_package: "unapproved-mcp" } });
  const unapproved = await request(service, `/api/pay/${created.json.inquiry_code}`, { method: "POST" });
  assert.notEqual(unapproved.status, 402);
  assert.ok([404, 409].includes(unapproved.status));

  const short = await startService({ ttlSeconds: 30 });
  try {
    const code = await approvedReservation(short);
    short.clockState.now += 31_000;
    const expired = await request(short, `/api/pay/${code}`, { method: "POST" });
    assert.notEqual(expired.status, 402);
    assert.equal(expired.status, 410);
  } finally {
    await short.close();
  }
});

test("an approved unpaid reservation returns official x402 v2 402 for exactly 49 USDC on Base", async () => {
  const code = await approvedReservation();
  const unpaid = await request(service, `/api/pay/${code}`, { method: "POST" });
  assert.equal(unpaid.status, 402);
  const decoded = decodePaymentRequired(unpaid.headers);
  assert.ok(decoded, "official PAYMENT-REQUIRED header must be present");
  assert.equal(decoded.x402Version, 2);
  const accept = decoded.accepts[0];
  assert.equal(accept.scheme, "exact");
  assert.equal(accept.network, "eip155:8453");
  assert.equal(accept.amount, PRICE_ATOMIC);
  assert.equal(String(accept.asset).toLowerCase(), USDC_BASE.toLowerCase());
});

test("a forged PAYMENT-SIGNATURE does not create an order", async () => {
  const code = await approvedReservation();
  const forged = await payReservation(service, code, {
    signature: "0xforgeddeadbeef",
    extraHeaders: { "X-Simulate-Paid": "1" }
  });
  assert.notEqual(forged.status, 200);
  assert.equal(service.facilitator.calls.verify.length >= 1, true);
  assert.equal(service.facilitator.calls.settle.length, 0);

  const orders = await request(service, "/api/admin/orders", {
    headers: { authorization: `Bearer ${service.token}` }
  });
  assert.equal(orders.status, 200);
  assert.equal(orders.json.orders.filter((order) => order.reservation_code === code).length, 0);
});

test("X-Simulate-Paid never marks paid without verified settlement", async () => {
  const code = await approvedReservation();
  const simulated = await request(service, `/api/pay/${code}`, {
    method: "POST",
    headers: { "X-Simulate-Paid": "true", "X-Payment-Settled": "1" }
  });
  assert.equal(simulated.status, 402);
  const reservation = await request(service, `/api/reservation/${code}`);
  assert.equal(reservation.json.state, "payment_pending");
});

test("verified settlement creates one order and retries do not duplicate", async () => {
  const code = await approvedReservation();
  const first = await payReservation(service, code);
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.state, "paid");
  assert.match(first.json.order_id, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(first.json.settlement.transaction, SETTLEMENT_TX);
  assert.equal(first.json.reply_email, undefined);

  const replay = await payReservation(service, code);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.order_id, first.json.order_id);

  const orders = await request(service, "/api/admin/orders", {
    headers: { authorization: `Bearer ${service.token}` }
  });
  assert.equal(orders.json.orders.filter((order) => order.reservation_code === code).length, 1);
});
