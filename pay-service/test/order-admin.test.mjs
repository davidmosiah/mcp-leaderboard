import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  SETTLEMENT_TX,
  approveInquiry,
  openInquiry,
  payReservation,
  request,
  startService
} from "./helpers.mjs";

const service = await startService();
after(() => service.close());

async function paidOrder() {
  const created = await openInquiry(service, { body: { npm_package: `ord-${Math.random().toString(16).slice(2)}` } });
  const approved = await approveInquiry(service, created.json.inquiry_code);
  const code = approved.json.reservation_code;
  const paid = await payReservation(service, code);
  assert.equal(paid.status, 200, paid.text);
  return { inquiry: created.json, reservation: approved.json, order: paid.json };
}

test("public order and receipt expose settlement and hide contact", async () => {
  const { order } = await paidOrder();
  const publicOrder = await request(service, `/api/order/${order.order_id}`);
  assert.equal(publicOrder.status, 200);
  assert.equal(publicOrder.json.state, "paid");
  assert.equal(publicOrder.json.settlement.transaction, SETTLEMENT_TX);
  assert.equal(publicOrder.json.settlement.network, "eip155:8453");
  assert.equal(publicOrder.json.reply_email, undefined);
  assert.doesNotMatch(JSON.stringify(publicOrder.json), /maintainer@example\.com/);

  const receipt = await request(service, `/api/receipt/${order.order_id}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.type, "payment");
  assert.equal(receipt.json.settlement.transaction, SETTLEMENT_TX);
  assert.equal(receipt.json.reply_email, undefined);
});

test("admin list, delivery, cancel, and manual refund with a separate receipt", async () => {
  const pending = await openInquiry(service, { body: { npm_package: "pending-admin" } });
  const listed = await request(service, "/api/admin/inquiries", {
    headers: { authorization: `Bearer ${service.token}` }
  });
  assert.equal(listed.status, 200);
  assert.ok(listed.json.inquiries.some((row) => row.inquiry_code === pending.json.inquiry_code));
  assert.ok(listed.json.inquiries.some((row) => row.reply_email === "maintainer@example.com"));

  const { order } = await paidOrder();
  const start = await request(service, "/api/admin/delivery/start", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: order.order_id }
  });
  assert.equal(start.status, 200);
  assert.equal(start.json.state, "delivery_in_progress");

  const complete = await request(service, "/api/admin/delivery/complete", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: {
      order_id: order.order_id,
      draft_pr_url: "https://github.com/octocat/Hello-World/pull/1"
    }
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.json.state, "delivered");

  const refund = await request(service, "/api/admin/refund", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: order.order_id, reason: "manual operator refund" }
  });
  assert.equal(refund.status, 201);
  assert.equal(refund.json.state, "refunded");
  assert.notEqual(refund.json.receipt_id, order.order_id);
  assert.match(refund.json.disclaimer, /not an automatic/i);

  const refundReceipt = await request(service, `/api/receipt/${refund.json.receipt_id}`);
  assert.equal(refundReceipt.status, 200);
  assert.equal(refundReceipt.json.type, "refund");
  assert.equal(refundReceipt.json.original_order_id, order.order_id);
  assert.equal(refundReceipt.json.reply_email, undefined);

  const cancelInquiry = await openInquiry(service, { body: { npm_package: "cancel-me" } });
  const cancel = await request(service, "/api/admin/cancel", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { inquiry_code: cancelInquiry.json.inquiry_code }
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.state, "cancelled");
});

test("state machine rejects illegal transitions and never marks paid from a header", async () => {
  const created = await openInquiry(service, { body: { npm_package: "illegal-transition" } });
  const deliverTooSoon = await request(service, "/api/admin/delivery/start", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: created.json.inquiry_code }
  });
  assert.equal(deliverTooSoon.status, 409);

  const metrics = await request(service, "/api/admin/metrics", {
    headers: { authorization: `Bearer ${service.token}` }
  });
  assert.equal(metrics.status, 200);
  assert.equal(typeof metrics.json.inquiries, "number");
  assert.doesNotMatch(JSON.stringify(metrics.json), /@example\.com/);
});
