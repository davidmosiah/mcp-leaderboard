import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("production manifest activates an isolated immutable service on port 8797", () => {
  const manifest = JSON.parse(read("pay-service/manifests/mcp-scoreboard-pay.production.json"));
  assert.equal(manifest.unit, "mcp-scoreboard-pay");
  assert.equal(manifest.phase, "production");
  assert.equal(manifest.do_not_deploy, false);
  assert.equal(manifest.listener.host, "127.0.0.1");
  assert.equal(manifest.listener.port, 8797);
  assert.equal(manifest.state.path, "/var/lib/mcp-scoreboard-pay");
  assert.equal(manifest.backup.id, "mcp-scoreboard-pay-state");
  assert.equal(manifest.isolation.delx_commerce, false);
});

test("systemd unit runs as a dedicated user with a private state directory", () => {
  const unit = read("pay-service/ops/mcp-scoreboard-pay.service");
  assert.match(unit, /^User=mcp-scoreboard-pay$/m);
  assert.match(unit, /^Group=mcp-scoreboard-pay$/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/mcp-scoreboard-pay\/pay\.env$/m);
  assert.match(unit, /^LoadCredential=cdp-api-key\.pem:\/etc\/mcp-scoreboard-pay\/cdp-api-key\.pem$/m);
  assert.match(unit, /^LoadCredential=agent-token:\/etc\/mcp-scoreboard-pay\/agent-token$/m);
  assert.match(unit, /^LoadCredential=oauth-client-secret:\/etc\/mcp-scoreboard-pay\/oauth-client-secret$/m);
  assert.match(unit, /^Environment=NODE_OPTIONS=--dns-result-order=ipv4first$/m);
  assert.match(unit, /CDP_API_KEY_SECRET=.*CREDENTIALS_DIRECTORY\/cdp-api-key\.pem/);
  assert.match(unit, /PAY_SERVICE_AGENT_TOKEN=.*CREDENTIALS_DIRECTORY\/agent-token/);
  assert.match(unit, /PAY_SERVICE_OAUTH_CLIENT_SECRET=.*CREDENTIALS_DIRECTORY\/oauth-client-secret/);
  assert.match(unit, /^WorkingDirectory=\/opt\/mcp-scoreboard-pay\/current\/pay-service$/m);
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/mcp-scoreboard-pay$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.doesNotMatch(unit, /delx-agent-commerce|api\.delx\.ai|commerce\.delx\.ai/);
});

test("Caddy route owns only pay.leaderboard.delx.ai and overwrites forwarded IP", () => {
  const route = read("pay-service/ops/mcp-scoreboard-pay.caddy");
  assert.match(route, /^pay\.leaderboard\.delx\.ai\s*\{/m);
  assert.match(route, /reverse_proxy\s+127\.0\.0\.1:8797/);
  assert.match(route, /header_up\s+X-Forwarded-For\s+\{remote_host\}/);
  assert.doesNotMatch(route, /api\.delx\.ai|commerce\.delx\.ai/);
});

test("deploy script pins a commit, verifies dependencies, and never embeds secrets", () => {
  const deploy = read("pay-service/ops/deploy-production.sh");
  assert.match(deploy, /git(?: -C "[^"]+")? archive/);
  assert.match(deploy, /cd "\$work".*sha256sum "\$\{service\}-\$\{commit\}\.tar\.gz"/s);
  assert.match(deploy, /npm ci --omit=dev --ignore-scripts/);
  assert.match(deploy, /npm audit --omit=dev --audit-level=high/);
  assert.match(deploy, /chown root:\"\$service\" \/etc\/mcp-scoreboard-pay\/pay\.env/);
  assert.match(deploy, /chmod 0640 \/etc\/mcp-scoreboard-pay\/pay\.env/);
  assert.match(deploy, /chmod 0640 \/etc\/mcp-scoreboard-pay\/cdp-api-key\.pem/);
  assert.match(deploy, /chmod 0640 \/etc\/mcp-scoreboard-pay\/agent-token/);
  assert.match(deploy, /chmod 0640 \/etc\/mcp-scoreboard-pay\/oauth-client-secret/);
  assert.match(deploy, /agent credential must be at least 32 bytes/);
  assert.match(deploy, /OAuth client credential must be at least 32 bytes/);
  assert.match(deploy, /grep -qx -- '-----BEGIN PRIVATE KEY-----' \/etc\/mcp-scoreboard-pay\/cdp-api-key\.pem/);
  assert.match(deploy, /systemctl restart mcp-scoreboard-pay\.service/);
  assert.match(deploy, /curl -fsS http:\/\/127\.0\.0\.1:8797\/readyz/);
  assert.doesNotMatch(deploy, /CDP_API_KEY_SECRET=|PAY_SERVICE_ADMIN_TOKEN=|PAY_SERVICE_AGENT_TOKEN=|PAY_SERVICE_OAUTH_CLIENT_SECRET=/);
  assert.doesNotMatch(deploy, /rm -rf "\$release"/, "published release directories are immutable");
});
