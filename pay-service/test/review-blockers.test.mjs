import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createFileStore } from "../src/store.mjs";
import {
  PRICE_ATOMIC,
  SETTLEMENT_TX,
  TEST_PAY_TO,
  TEST_PAYER,
  approveInquiry,
  createMockFacilitator,
  inquiryBody,
  openInquiry,
  payReservation,
  request,
  startService
} from "./helpers.mjs";

const service = await startService();
after(() => service.close());

async function paidOrder(target = service, npm = `blk-${Math.random().toString(16).slice(2)}`) {
  const created = await openInquiry(target, { body: { npm_package: npm } });
  const approved = await approveInquiry(target, created.json.inquiry_code);
  assert.equal(approved.status, 201, approved.text);
  const paid = await payReservation(target, approved.json.reservation_code);
  assert.equal(paid.status, 200, paid.text);
  return { created, approved, paid };
}

test("1. production wiring uses createCdpFacilitatorClient and readyz requires CDP secrets", async () => {
  const src = readFileSync(new URL("../src/x402-server.mjs", import.meta.url), "utf8");
  assert.match(src, /createCdpFacilitatorClient/);
  assert.match(src, /@coinbase\/cdp-sdk\/x402/);
  assert.doesNotMatch(src, /new HTTPFacilitatorClient\(\{\s*url:/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@x402/core"], "2.22.0");
  assert.equal(pkg.dependencies["@x402/evm"], "2.22.0");
  assert.equal(pkg.dependencies["@x402/express"], "2.22.0");
  assert.equal(pkg.dependencies["@x402/extensions"], "2.22.0");
  assert.ok(pkg.dependencies["@coinbase/cdp-sdk"]);

  const isolated = await startService({
    env: { CDP_API_KEY_ID: "", CDP_API_KEY_SECRET: "" }
  });
  try {
    const res = await request(isolated, "/readyz");
    assert.equal(res.status, 503);
    assert.ok(res.json.errors.includes("cdp_api_key_id_missing"));
    assert.ok(res.json.errors.includes("cdp_api_key_secret_missing"));
    assert.doesNotMatch(JSON.stringify(res.json), /CDP_API_KEY_SECRET|sk-/);
  } finally {
    await isolated.close();
  }
});

test("2. cancel after payment returns 409 and leaves inquiry+order unchanged", async () => {
  const { created, paid } = await paidOrder();
  const before = await request(service, `/api/inquiry/${created.json.inquiry_code}`);
  assert.equal(before.json.state, "paid");
  const cancel = await request(service, "/api/admin/cancel", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: paid.json.order_id }
  });
  assert.equal(cancel.status, 409);
  assert.equal(cancel.json.state, "paid");
  const after = await request(service, `/api/inquiry/${created.json.inquiry_code}`);
  assert.equal(after.json.state, "paid");
  const order = await request(service, `/api/order/${paid.json.order_id}`);
  assert.equal(order.json.state, "paid");
});

test("3. corrupted private state fails closed without rewriting the file", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-pay-corrupt-"));
  const privateDir = join(dataDir, "private");
  mkdirSync(privateDir, { recursive: true });
  const statePath = join(privateDir, "state.json");
  const corrupt = "{ this is not json\n";
  writeFileSync(statePath, corrupt);
  await assert.rejects(() => createFileStore(dataDir), /corrupt|JSON|parse/i);
  assert.equal(readFileSync(statePath, "utf8"), corrupt);
});

test("4. concurrent valid pays settle once and create one order", async () => {
  const facilitator = createMockFacilitator({ settleDelayMs: 80 });
  const isolated = await startService({ facilitator });
  try {
    const created = await openInquiry(isolated, { body: { npm_package: "concurrent-mcp" } });
    const approved = await approveInquiry(isolated, created.json.inquiry_code);
    const code = approved.json.reservation_code;
    const [first, second] = await Promise.all([
      payReservation(isolated, code),
      payReservation(isolated, code)
    ]);
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    assert.equal(first.json.order_id, second.json.order_id);
    assert.equal(facilitator.calls.settle.length, 1);
    const orders = await request(isolated, "/api/admin/orders", {
      headers: { authorization: `Bearer ${isolated.token}` }
    });
    assert.equal(orders.json.orders.filter((row) => row.reservation_code === code).length, 1);
  } finally {
    await isolated.close();
  }
});

test("5. refund without transfer proof is not terminal refunded", async () => {
  const { paid } = await paidOrder();
  const pending = await request(service, "/api/admin/refund", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: paid.json.order_id, reason: "manual operator refund" }
  });
  assert.ok([200, 201, 202].includes(pending.status));
  assert.notEqual(pending.json.state, "refunded");
  assert.equal(pending.json.state, "refund_pending");
  const requestReceipt = await request(service, `/api/receipt/${pending.json.receipt_id}`);
  assert.equal(requestReceipt.json.type, "refund_request");

  const verified = await request(service, "/api/admin/refund", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: {
      order_id: paid.json.order_id,
      reason: "manual operator refund",
      refund: {
        transaction: `0x${"cd".repeat(32)}`,
        network: "eip155:8453",
        amount: PRICE_ATOMIC,
        payer: TEST_PAY_TO,
        recipient: TEST_PAYER
      }
    }
  });
  assert.equal(verified.status, 201);
  assert.equal(verified.json.state, "refunded");
  const refundReceipt = await request(service, `/api/receipt/${verified.json.receipt_id}`);
  assert.equal(refundReceipt.json.type, "refund");
  assert.equal(refundReceipt.json.settlement.transaction, `0x${"cd".repeat(32)}`);
});

test("6. founding capacity is 5 total seats including delivered", async () => {
  const isolated = await startService();
  try {
    for (let i = 0; i < 5; i += 1) {
      const { paid } = await paidOrder(isolated, `seat-${i}`);
      const start = await request(isolated, "/api/admin/delivery/start", {
        method: "POST",
        headers: { authorization: `Bearer ${isolated.token}` },
        body: { order_id: paid.json.order_id }
      });
      assert.equal(start.status, 200);
      const complete = await request(isolated, "/api/admin/delivery/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${isolated.token}` },
        body: {
          order_id: paid.json.order_id,
          draft_pr_url: "https://github.com/octocat/Hello-World/pull/1"
        }
      });
      assert.equal(complete.status, 200, complete.text);
    }
    const sixth = await openInquiry(isolated, { body: { npm_package: "seat-6" } });
    const approved = await approveInquiry(isolated, sixth.json.inquiry_code);
    assert.equal(approved.status, 409);
    assert.equal(approved.json.error, "capacity_exhausted");
  } finally {
    await isolated.close();
  }
});

test("7. delivered draft PR must belong to the purchased repository", async () => {
  const { paid } = await paidOrder();
  await request(service, "/api/admin/delivery/start", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: { order_id: paid.json.order_id }
  });
  const wrong = await request(service, "/api/admin/delivery/complete", {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}` },
    body: {
      order_id: paid.json.order_id,
      draft_pr_url: "https://github.com/other-org/other-repo/pull/9"
    }
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, "draft_pr_repo_mismatch");
  const order = await request(service, `/api/order/${paid.json.order_id}`);
  assert.equal(order.json.state, "delivery_in_progress");
});

test("8. Idempotency-Key binds to payload hash and untrusted X-Forwarded-For is ignored", async () => {
  const key = "shared-idem-key";
  const first = await openInquiry(service, { headers: { "idempotency-key": key } });
  assert.equal(first.status, 201);
  const conflict = await request(service, "/api/inquiry", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: inquiryBody({ npm_package: "other-idem-mcp" })
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, "idempotency_conflict");

  const limited = await startService();
  try {
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(limited, "/api/inquiry", {
        method: "POST",
        headers: { "x-forwarded-for": `203.0.113.${i}` },
        body: inquiryBody({ npm_package: `xff-${i}` })
      });
    }
    assert.equal(last.status, 429);
  } finally {
    await limited.close();
  }
});

test("9. second process cannot open the same durable store", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-pay-lock-"));
  const first = await createFileStore(dataDir);
  await assert.rejects(() => createFileStore(dataDir), /already running|lock|exclusive/i);
  await first.close();
  const third = await createFileStore(dataDir);
  await third.close();
});
