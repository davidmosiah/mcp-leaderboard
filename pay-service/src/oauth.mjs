import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { log } from "./logger.mjs";

const SCOPE = "scoreboard:operate";
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const EXACT_CURSOR_CALLBACKS = new Set([
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "http://localhost:8787/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback"
]);

function sameSecret(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  if (!expected || right.length < 32 || left.length !== right.length) {
    timingSafeEqual(right.length ? right : Buffer.alloc(32), Buffer.alloc(right.length || 32));
    return false;
  }
  return timingSafeEqual(left, right);
}

function safeRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (EXACT_CURSOR_CALLBACKS.has(url.toString())) return url.toString();
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    const host = url.hostname.toLowerCase();
    const trustedGrok = host === "grok.com" || host.endsWith(".grok.com") || host === "x.ai" || host.endsWith(".x.ai");
    return trustedGrok ? url.toString() : null;
  } catch {
    return null;
  }
}

function isExactCursorCallback(value) {
  return EXACT_CURSOR_CALLBACKS.has(String(value || ""));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function oauthError(res, status, error, description) {
  res.set("cache-control", "no-store").set("pragma", "no-cache");
  return res.status(status).json({ error, error_description: description });
}

function clientCredentials(req) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1))
        };
      }
    } catch {
      // Fall through to form credentials.
    }
  }
  return {
    clientId: req.body?.client_id,
    clientSecret: req.body?.client_secret
  };
}

export function createScoreboardOAuth({ config, clock = () => Date.now() }) {
  const pendingConsents = new Map();
  const authorizationCodes = new Map();

  function prune() {
    const now = clock();
    for (const [key, row] of pendingConsents) if (row.expiresAt <= now) pendingConsents.delete(key);
    for (const [key, row] of authorizationCodes) if (row.expiresAt <= now) authorizationCodes.delete(key);
  }

  function parseAuthorization(input) {
    if (input.response_type !== "code") return { error: "unsupported_response_type" };
    if (input.client_id !== config.oauthClientId) return { error: "invalid_client" };
    const redirectUri = safeRedirectUri(input.redirect_uri);
    if (!redirectUri) return { error: "invalid_redirect_uri" };
    if (input.scope !== SCOPE) return { error: "invalid_scope" };
    if (input.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(input.code_challenge || "")) {
      return { error: "invalid_code_challenge" };
    }
    if (!input.state || String(input.state).length > 500) return { error: "invalid_state" };
    return {
      value: {
        clientId: input.client_id,
        redirectUri,
        scope: SCOPE,
        state: String(input.state),
        codeChallenge: input.code_challenge
      }
    };
  }

  return {
    scope: SCOPE,

    protectedResourceMetadata() {
      return {
        resource: `${config.publicBaseUrl}/mcp`,
        authorization_servers: [config.publicBaseUrl],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ["header"]
      };
    },

    authorizationServerMetadata() {
      return {
        issuer: config.publicBaseUrl,
        authorization_endpoint: `${config.publicBaseUrl}/oauth/authorize`,
        token_endpoint: `${config.publicBaseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: [SCOPE],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
      };
    },

    authorizePage(req, res) {
      prune();
      const parsed = parseAuthorization(req.query || {});
      if (parsed.error) return oauthError(res, 400, "invalid_request", parsed.error);
      const nonce = randomBytes(32).toString("base64url");
      const requiresOwnerApproval = isExactCursorCallback(parsed.value.redirectUri);
      pendingConsents.set(nonce, { ...parsed.value, requiresOwnerApproval, expiresAt: clock() + FIVE_MINUTES_MS });
      const ownerApprovalField = requiresOwnerApproval
        ? '<label for="owner_secret">Owner approval code</label><input id="owner_secret" name="owner_secret" type="password" required autocomplete="off">'
        : "";
      res.set("cache-control", "no-store").set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      return res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize MCP Scoreboard Ops</title><style>body{font:16px system-ui;max-width:620px;margin:64px auto;padding:0 24px;color:#151515}main{border:1px solid #ddd;border-radius:16px;padding:28px}label,input{display:block}input{box-sizing:border-box;width:100%;margin:8px 0 18px;padding:10px;border:1px solid #bbb;border-radius:8px}button{padding:12px 18px;border-radius:10px;border:0;background:#111;color:#fff;font-weight:650}p{line-height:1.5}.muted{color:#666}</style></head>
<body><main><h1>Authorize MCP Scoreboard Ops</h1><p>Grant Grok persistent access to five isolated Scoreboard tools: read status and work, qualify a public inquiry, and start or complete delivery only with verified public draft-PR evidence.</p><p class="muted">No wallet signing, refund, admin, server, Delx Commerce, merge, deploy, ranking, email inbox, or private-repository access.</p>
<form method="post" action="/oauth/authorize"><input type="hidden" name="consent_nonce" value="${escapeHtml(nonce)}">${ownerApprovalField}<button type="submit" name="decision" value="approve">Authorize</button></form></main></body></html>`);
    },

    authorizeDecision(req, res) {
      prune();
      const nonce = String(req.body?.consent_nonce || "");
      const pending = pendingConsents.get(nonce);
      pendingConsents.delete(nonce);
      if (!pending) return oauthError(res, 400, "invalid_request", "consent_expired");
      const ownerApproved = pending.requiresOwnerApproval && sameSecret(req.body?.owner_secret, config.oauthClientSecret);
      if (pending.requiresOwnerApproval && !ownerApproved) {
        log.warn("oauth_consent_rejected", { reason: "owner_approval_required" });
        return oauthError(res, 401, "access_denied", "owner approval required");
      }
      const callback = new URL(pending.redirectUri);
      callback.searchParams.set("state", pending.state);
      if (req.body?.decision !== "approve") {
        callback.searchParams.set("error", "access_denied");
        return res.redirect(302, callback.toString());
      }
      const code = randomBytes(32).toString("base64url");
      authorizationCodes.set(code, { ...pending, ownerApproved, expiresAt: clock() + FIVE_MINUTES_MS });
      callback.searchParams.set("code", code);
      return res.redirect(302, callback.toString());
    },

    token(req, res) {
      prune();
      const credentials = clientCredentials(req);
      const authMethod = String(req.headers.authorization || "").startsWith("Basic ") ? "client_secret_basic" : "client_secret_post";
      if (credentials.clientId !== config.oauthClientId) {
        log.warn("oauth_token_rejected", { reason: "invalid_client", auth_method: authMethod });
        res.set("www-authenticate", 'Basic realm="mcp-scoreboard-oauth"');
        return oauthError(res, 401, "invalid_client", "client authentication failed");
      }
      if (req.body?.grant_type !== "authorization_code") {
        log.warn("oauth_token_rejected", { reason: "unsupported_grant_type", auth_method: authMethod });
        return oauthError(res, 400, "unsupported_grant_type", "authorization_code required");
      }
      const code = String(req.body?.code || "");
      const row = authorizationCodes.get(code);
      if (!row) {
        log.warn("oauth_token_rejected", { reason: "unknown_or_used_code", auth_method: authMethod });
        return oauthError(res, 400, "invalid_grant", "authorization code is invalid");
      }
      if (!row.ownerApproved && !sameSecret(credentials.clientSecret, config.oauthClientSecret)) {
        log.warn("oauth_token_rejected", { reason: "invalid_client", auth_method: authMethod });
        res.set("www-authenticate", 'Basic realm="mcp-scoreboard-oauth"');
        return oauthError(res, 401, "invalid_client", "client authentication failed");
      }
      if (row.clientId !== credentials.clientId || row.redirectUri !== safeRedirectUri(req.body?.redirect_uri)) {
        log.warn("oauth_token_rejected", { reason: "client_or_redirect_mismatch", auth_method: authMethod });
        return oauthError(res, 400, "invalid_grant", "authorization code is invalid");
      }
      const verifier = String(req.body?.code_verifier || "");
      const calculated = createHash("sha256").update(verifier).digest("base64url");
      if (!verifier || calculated !== row.codeChallenge) {
        log.warn("oauth_token_rejected", { reason: "pkce_mismatch", auth_method: authMethod });
        return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
      }
      authorizationCodes.delete(code);
      log.info("oauth_token_issued", { auth_method: authMethod, scope: SCOPE, owner_approved: Boolean(row.ownerApproved) });
      res.set("cache-control", "no-store").set("pragma", "no-cache");
      return res.json({
        access_token: config.agentToken,
        token_type: "Bearer",
        scope: SCOPE
      });
    }
  };
}
