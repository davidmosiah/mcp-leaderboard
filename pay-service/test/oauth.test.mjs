import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { request, startService } from "./helpers.mjs";

const service = await startService();
after(() => service.close());

const redirectUri = "https://grok.com/connectors/oauth/callback";
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

function form(path, values) {
  return request(service, path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
    redirect: "manual"
  });
}

test("protected MCP advertises isolated OAuth discovery", async () => {
  const denied = await request(service, "/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
  });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate") || "", /resource_metadata=/);

  const resource = await request(service, "/.well-known/oauth-protected-resource/mcp");
  assert.equal(resource.status, 200, resource.text);
  assert.deepEqual(resource.json.scopes_supported, ["scoreboard:operate"]);
  assert.equal(resource.json.resource, "https://pay.leaderboard.delx.ai/mcp");

  const metadata = await request(service, "/.well-known/oauth-authorization-server");
  assert.equal(metadata.status, 200, metadata.text);
  assert.equal(metadata.json.authorization_endpoint, "https://pay.leaderboard.delx.ai/oauth/authorize");
  assert.equal(metadata.json.token_endpoint, "https://pay.leaderboard.delx.ai/oauth/token");
  assert.deepEqual(metadata.json.code_challenge_methods_supported, ["S256"]);
  assert.ok(metadata.json.token_endpoint_auth_methods_supported.includes("client_secret_post"));
  assert.doesNotMatch(metadata.text, new RegExp(service.oauthClientSecret));
});

test("OAuth authorization code is consented, PKCE-bound, client-bound, and single-use", async () => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: service.oauthClientId,
    redirect_uri: redirectUri,
    scope: "scoreboard:operate",
    state: "grok-state-1",
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  const consent = await request(service, `/oauth/authorize?${query}`);
  assert.equal(consent.status, 200, consent.text);
  assert.match(consent.headers.get("content-type") || "", /text\/html/);
  assert.match(consent.text, /Authorize MCP Scoreboard Ops/);
  assert.doesNotMatch(consent.text, new RegExp(service.oauthClientSecret));
  const nonce = consent.text.match(/name="consent_nonce" value="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(nonce, consent.text);

  const approved = await form("/oauth/authorize", {
    consent_nonce: nonce,
    decision: "approve"
  });
  assert.equal(approved.status, 302, approved.text);
  const callback = new URL(approved.headers.get("location"));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get("state"), "grok-state-1");
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const wrongSecret = await form("/oauth/token", {
    grant_type: "authorization_code",
    client_id: service.oauthClientId,
    client_secret: "wrong-secret",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  assert.equal(wrongSecret.status, 401);

  const wrongVerifier = await form("/oauth/token", {
    grant_type: "authorization_code",
    client_id: service.oauthClientId,
    client_secret: service.oauthClientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: "wrong-verifier"
  });
  assert.equal(wrongVerifier.status, 400);

  const token = await form("/oauth/token", {
    grant_type: "authorization_code",
    client_id: service.oauthClientId,
    client_secret: service.oauthClientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  assert.equal(token.status, 200, token.text);
  assert.equal(token.json.token_type, "Bearer");
  assert.equal(token.json.scope, "scoreboard:operate");
  assert.equal(token.json.access_token, service.agentToken);
  assert.doesNotMatch(token.text, new RegExp(service.oauthClientSecret));

  const replay = await form("/oauth/token", {
    grant_type: "authorization_code",
    client_id: service.oauthClientId,
    client_secret: service.oauthClientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  assert.equal(replay.status, 400);

  const listed = await request(service, "/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.json.access_token}`,
      accept: "application/json, text/event-stream"
    },
    body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  });
  assert.equal(listed.status, 200, listed.text);
  assert.equal(listed.json.result.tools.length, 5);
});

test("OAuth rejects untrusted redirect origins and non-PKCE requests", async () => {
  const untrusted = new URLSearchParams({
    response_type: "code",
    client_id: service.oauthClientId,
    redirect_uri: "https://attacker.example/callback",
    scope: "scoreboard:operate",
    state: "state",
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  assert.equal((await request(service, `/oauth/authorize?${untrusted}`)).status, 400);

  const noPkce = new URLSearchParams({
    response_type: "code",
    client_id: service.oauthClientId,
    redirect_uri: redirectUri,
    scope: "scoreboard:operate",
    state: "state"
  });
  assert.equal((await request(service, `/oauth/authorize?${noPkce}`)).status, 400);
});

test("OAuth permits only the exact Cursor callbacks used by Grok Bot", async () => {
  function authorizationQuery(redirectUri) {
    return new URLSearchParams({
      response_type: "code",
      client_id: service.oauthClientId,
      redirect_uri: redirectUri,
      scope: "scoreboard:operate",
      state: "grok-bot-state",
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
  }

  for (const callback of [
    "https://www.cursor.com/agents/mcp/oauth/callback",
    "http://localhost:8787/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback"
  ]) {
    assert.equal(
      (await request(service, `/oauth/authorize?${authorizationQuery(callback)}`)).status,
      200,
      callback
    );
  }

  for (const rejected of [
    "https://cursor.com/agents/mcp/oauth/callback",
    "https://www.cursor.com/agents/mcp/oauth/callback/extra",
    "https://attacker.cursor.com/agents/mcp/oauth/callback",
    "http://127.0.0.1:8787/callback",
    "http://localhost:8788/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback/extra"
  ]) {
    assert.equal(
      (await request(service, `/oauth/authorize?${authorizationQuery(rejected)}`)).status,
      400,
      rejected
    );
  }
});
