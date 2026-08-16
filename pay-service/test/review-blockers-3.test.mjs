import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFileStore } from "../src/store.mjs";
import {
  PRICE_ATOMIC,
  TEST_PAY_TO,
  TEST_PAYER,
  USDC_BASE,
  approveInquiry,
  createMockFacilitator,
  inquiryBody,
  openInquiry,
  payReservation,
  request,
  startService
} from "./helpers.mjs";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

async function claimedReservation(dataDir) {
  const store = await createFileStore(dataDir, { payTo: TEST_PAY_TO });
  const created = await store.createInquiry({
    value: inquiryBody({ npm_package: "orphan-claim-mcp" }),
    ipHash: "testhash",
    now: NOW
  });
  const approved = await store.approve({
    inquiryCode: created.row.inquiry_code,
    now: NOW,
    ttlMs: 86_400_000
  });
  const claimed = await store.claimPay({
    reservationCode: approved.reservation.reservation_code,
    now: NOW
  });
  assert.equal(claimed.claimed, true);
  await store.close();
  return {
    inquiryCode: created.row.inquiry_code,
    reservationCode: approved.reservation.reservation_code
  };
}

test("12. orphan pay_claim after reopen becomes reconciliation_required", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-pay-orphan-"));
  const { reservationCode } = await claimedReservation(dataDir);
  const reopened = await createFileStore(dataDir, { payTo: TEST_PAY_TO });
  try {
    const reservation = await reopened.getReservation(reservationCode, NOW);
    assert.equal(reservation.state, "payment_reconciliation_required");
    assert.equal(reservation.settlement_unknown, true);
    assert.ok(reservation.pay_claim?.claimed_at);
    const claim = await reopened.claimPay({ reservationCode, now: NOW });
    assert.equal(claim.error, "reconciliation_required");
  } finally {
    await reopened.close();
  }
});

test("13. restart after claim does not settle; admin release frees the seat", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-pay-orphan-http-"));
  const { reservationCode } = await claimedReservation(dataDir);
  const facilitator = createMockFacilitator();
  const isolated = await startService({ dataDir, facilitator });
  try {
    const retry = await payReservation(isolated, reservationCode);
    assert.equal(retry.status, 409, retry.text);
    assert.equal(retry.json.error, "reconciliation_required");
    assert.equal(facilitator.calls.settle.length, 0);

    const released = await request(isolated, "/api/admin/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${isolated.token}` },
      body: { reservation_code: reservationCode, decision: "release", note: "startup orphan" }
    });
    assert.equal(released.status, 200, released.text);
    assert.equal(released.json.decision, "release");
    assert.equal(released.json.state, "cancelled");

    const reservation = await request(isolated, `/api/reservation/${reservationCode}`);
    assert.ok([200, 409].includes(reservation.status));
    assert.notEqual(reservation.json?.state, "payment_pending");
  } finally {
    await isolated.close();
  }
});

test("14. admin paid with invalid settlement does not create an order", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-pay-bad-settle-"));
  const { reservationCode } = await claimedReservation(dataDir);
  const isolated = await startService({ dataDir });
  try {
    const invalid = await request(isolated, "/api/admin/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${isolated.token}` },
      body: {
        reservation_code: reservationCode,
        decision: "paid",
        settlement: {
          transaction: "0xnot-a-hash",
          network: "eip155:1",
          amount: "1",
          asset: "ETH",
          pay_to: TEST_PAYER,
          payer: "not-an-address"
        }
      }
    });
    assert.ok([400, 409].includes(invalid.status), invalid.text);
    assert.notEqual(invalid.json?.state, "paid");

    const validShapeMissingTx = await request(isolated, "/api/admin/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${isolated.token}` },
      body: {
        reservation_code: reservationCode,
        decision: "paid",
        settlement: {
          transaction: `0x${"ab".repeat(32)}`,
          network: "eip155:8453",
          amount: PRICE_ATOMIC,
          asset: USDC_BASE,
          pay_to: TEST_PAY_TO,
          payer: "0xnot40"
        }
      }
    });
    assert.ok([400, 409].includes(validShapeMissingTx.status), validShapeMissingTx.text);

    const orders = await request(isolated, "/api/admin/orders", {
      headers: { authorization: `Bearer ${isolated.token}` }
    });
    assert.equal(orders.json.orders.filter((row) => row.reservation_code === reservationCode).length, 0);
  } finally {
    await isolated.close();
  }
});
