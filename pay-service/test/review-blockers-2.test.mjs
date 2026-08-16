import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import {
  approveInquiry,
  createMockFacilitator,
  openInquiry,
  payReservation,
  startService
} from "./helpers.mjs";

const service = await startService();
after(() => service.close());

test("10. pay-service pins axios 1.19.0 over the CDP SDK 1.16.0 advisory", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@coinbase/cdp-sdk"], "1.55.0");
  assert.equal(pkg.dependencies["@x402/core"], "2.22.0");
  assert.equal(pkg.overrides?.axios, "1.19.0");

  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const axiosEntries = Object.entries(lock.packages)
    .filter(([name]) => name === "node_modules/axios" || name.endsWith("/node_modules/axios"));
  assert.ok(axiosEntries.length >= 1);
  assert.ok(axiosEntries.every(([, meta]) => meta.version === "1.19.0"));
  assert.doesNotMatch(JSON.stringify(lock), /"axios": "1\.16\.0"/);
  assert.equal(lock.packages["node_modules/@coinbase/cdp-sdk"]?.version, "1.55.0");
});

test("11. crash after settle starts requires reconciliation and must not settle again", async () => {
  const facilitator = createMockFacilitator();
  const innerSettle = facilitator.settle.bind(facilitator);
  facilitator.settle = async (...args) => {
    await innerSettle(...args);
    throw new Error("facilitator_settle_interrupted");
  };
  const isolated = await startService({ facilitator });
  try {
    const created = await openInquiry(isolated, { body: { npm_package: "reconcile-mcp" } });
    const approved = await approveInquiry(isolated, created.json.inquiry_code);
    const code = approved.json.reservation_code;
    await payReservation(isolated, code);
    assert.equal(facilitator.calls.settle.length, 1);

    const retry = await payReservation(isolated, code);
    assert.equal(retry.status, 409, retry.text);
    assert.equal(retry.json.error, "reconciliation_required");
    assert.equal(facilitator.calls.settle.length, 1);
  } finally {
    await isolated.close();
  }
});
