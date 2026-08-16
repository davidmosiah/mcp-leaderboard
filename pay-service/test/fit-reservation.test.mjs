import assert from "node:assert/strict";
import { after, test } from "node:test";
import { approveInquiry, openInquiry, request, startService } from "./helpers.mjs";

const service = await startService();
after(() => service.close());

test("fit approve is privileged and timing-safe", async () => {
  const created = await openInquiry(service);
  const denied = await request(service, "/api/fit/approve", {
    method: "POST",
    headers: { authorization: "Bearer wrong-token-value-that-is-long-enough" },
    body: { inquiry_code: created.json.inquiry_code }
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.json.reservation_code, undefined);

  const missing = await request(service, "/api/fit/approve", {
    method: "POST",
    body: { inquiry_code: created.json.inquiry_code }
  });
  assert.equal(missing.status, 401);
});

test("human approval creates an unguessable reservation and exposes pay_route only then", async () => {
  const created = await openInquiry(service);
  const before = await request(service, `/api/reservation/${created.json.inquiry_code}`);
  assert.ok([404, 409].includes(before.status));
  assert.equal(before.json?.pay_route, undefined);

  const approved = await approveInquiry(service, created.json.inquiry_code);
  assert.equal(approved.status, 201);
  assert.equal(approved.json.state, "payment_pending");
  assert.match(approved.json.reservation_code, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(approved.json.reservation_code, created.json.inquiry_code);
  assert.match(approved.json.pay_route, /\/api\/pay\//);

  const publicReservation = await request(service, `/api/reservation/${approved.json.reservation_code}`);
  assert.equal(publicReservation.status, 200);
  assert.equal(publicReservation.json.state, "payment_pending");
  assert.match(publicReservation.json.pay_route, new RegExp(approved.json.reservation_code));
  assert.equal(publicReservation.json.reply_email, undefined);
  assert.doesNotMatch(JSON.stringify(publicReservation.json), /maintainer@example\.com/);
});

test("capacity is 5 and expiry frees the slot; inquiries do not hold a slot", async () => {
  const isolated = await startService({ ttlSeconds: 60 });
  try {
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      const created = await openInquiry(isolated, { body: { npm_package: `cap-${i}` } });
      const approved = await approveInquiry(isolated, created.json.inquiry_code);
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      codes.push(approved.json.reservation_code);
    }
    const sixthInquiry = await openInquiry(isolated, { body: { npm_package: "cap-6" } });
    assert.equal(sixthInquiry.status, 201, "inquiries must not consume capacity");
    const sixth = await approveInquiry(isolated, sixthInquiry.json.inquiry_code);
    assert.equal(sixth.status, 409);

    isolated.clockState.now += 61_000;
    const expired = await request(isolated, `/api/reservation/${codes[0]}`);
    assert.equal(expired.status, 410);
    assert.equal(expired.json.pay_route, undefined);

    const retry = await approveInquiry(isolated, sixthInquiry.json.inquiry_code);
    assert.equal(retry.status, 201);
  } finally {
    await isolated.close();
  }
});
