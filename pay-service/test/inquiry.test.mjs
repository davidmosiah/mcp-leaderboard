import assert from "node:assert/strict";
import { after, test } from "node:test";
import { inquiryBody, openInquiry, request, startService } from "./helpers.mjs";

const service = await startService();
after(() => service.close());

test("POST /api/inquiry accepts a public package and hides email on the public read", async () => {
  const created = await openInquiry(service);
  assert.equal(created.status, 201);
  assert.equal(created.json.state, "inquiry_received");
  assert.match(created.json.inquiry_code, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(created.json.reservation_code, undefined);
  assert.equal(created.json.pay_route, undefined);
  assert.equal(created.json.reply_email, undefined);

  const read = await request(service, `/api/inquiry/${created.json.inquiry_code}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.state, "inquiry_received");
  assert.equal(read.json.npm_package, "hello-mcp");
  assert.equal(read.json.reply_email, undefined);
  assert.equal(read.json.email, undefined);
  assert.equal(read.json.ip, undefined);
  assert.doesNotMatch(JSON.stringify(read.json), /maintainer@example\.com/);
});

test("POST /api/inquiry rejects secrets, private repos, and extra fields", async () => {
  const secretField = await request(service, "/api/inquiry", {
    method: "POST",
    body: { ...inquiryBody(), github_token: "placeholder-not-a-secret" }
  });
  assert.equal(secretField.status, 400);

  const privateUrl = await request(service, "/api/inquiry", {
    method: "POST",
    body: inquiryBody({ public_repository_url: "https://github.com/octocat/Hello-World.git?token=abc" })
  });
  assert.equal(privateUrl.status, 400);

  const ssh = await request(service, "/api/inquiry", {
    method: "POST",
    body: inquiryBody({ public_repository_url: "git@github.com:octocat/Hello-World.git" })
  });
  assert.equal(ssh.status, 400);

  const privateFlag = await request(service, "/api/inquiry", {
    method: "POST",
    body: inquiryBody({ visibility: "private" })
  });
  assert.equal(privateFlag.status, 400);

  const badBoard = await request(service, "/api/inquiry", {
    method: "POST",
    body: inquiryBody({ scoreboard_url: "https://example.net/servers/hello-mcp/" })
  });
  assert.equal(badBoard.status, 400);
});

test("POST /api/inquiry enforces body size, rate limit, and idempotency", async () => {
  const huge = await request(service, "/api/inquiry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from(`{"pad":"${"x".repeat(9 * 1024)}"}`)
  });
  assert.equal(huge.status, 413);

  const key = "inquiry-key-1";
  const first = await openInquiry(service, { headers: { "idempotency-key": key } });
  const replay = await openInquiry(service, { headers: { "idempotency-key": key } });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(replay.json.inquiry_code, first.json.inquiry_code);

  const limited = await startService();
  try {
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(limited, "/api/inquiry", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9" },
        body: inquiryBody({ npm_package: `pkg-${i}` })
      });
    }
    assert.equal(last.status, 429);
  } finally {
    await limited.close();
  }
});
