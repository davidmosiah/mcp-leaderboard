import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { join } from "node:path";
import { approveInquiry, openInquiry, request, startService } from "./helpers.mjs";

const logs = [];
const originalLog = console.log;
const originalInfo = console.info;
console.log = (...args) => {
  logs.push(args.map(String).join(" "));
  originalLog(...args);
};
console.info = (...args) => {
  logs.push(args.map(String).join(" "));
  originalInfo(...args);
};

const service = await startService();
after(async () => {
  console.log = originalLog;
  console.info = originalInfo;
  await service.close();
});

test("private store keeps email; public projection and logs do not", async () => {
  const created = await openInquiry(service, { body: { npm_package: "privacy-mcp" } });
  await approveInquiry(service, created.json.inquiry_code);

  const privateState = JSON.parse(readFileSync(join(service.dataDir, "private", "state.json"), "utf8"));
  const publicState = JSON.parse(readFileSync(join(service.dataDir, "public", "receipts.json"), "utf8"));
  assert.ok(Object.values(privateState.inquiries).some((row) => row.reply_email === "maintainer@example.com"));
  assert.doesNotMatch(JSON.stringify(publicState), /maintainer@example\.com/);
  assert.doesNotMatch(JSON.stringify(publicState), /"ip":/);
  assert.ok(!logs.some((line) => line.includes("maintainer@example.com")));
  assert.ok(!logs.some((line) => /203\.0\.113|127\.0\.0\.1/.test(line) && line.includes("inquiry")));
});

test("unguessable codes are not sequential and admin metrics omit PII", async () => {
  const first = await openInquiry(service, { body: { npm_package: "code-a" } });
  const second = await openInquiry(service, { body: { npm_package: "code-b" } });
  assert.notEqual(first.json.inquiry_code, second.json.inquiry_code);
  assert.match(first.json.inquiry_code, /[A-Za-z_-]/);
  assert.match(second.json.inquiry_code, /[A-Za-z_-]/);

  const metrics = await request(service, "/api/admin/metrics", {
    headers: { authorization: `Bearer ${service.token}` }
  });
  assert.doesNotMatch(JSON.stringify(metrics.json), /maintainer@example\.com|github_token|PAYMENT-SIGNATURE/i);
});
