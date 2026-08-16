import { createHash, timingSafeEqual } from "node:crypto";

export function hashIp(ip) {
  return createHash("sha256").update(String(ip || "unknown")).digest("hex");
}

export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "unknown";
}

export function adminAuthorized(req, token) {
  const header = String(req.headers.authorization || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(token || "");
  const given = Buffer.from(provided);
  if (!token || expected.length < 32) return false;
  if (given.length !== expected.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(given, expected);
}

export function publicInquiry(row) {
  if (!row) return null;
  return {
    inquiry_code: row.inquiry_code,
    state: row.state,
    npm_package: row.npm_package,
    public_repository_url: row.public_repository_url,
    scoreboard_url: row.scoreboard_url,
    created_at: row.created_at
  };
}

export function publicReservation(row, { includePayRoute = false, publicBaseUrl } = {}) {
  if (!row) return null;
  const body = {
    reservation_code: row.reservation_code,
    state: row.state,
    npm_package: row.npm_package,
    public_repository_url: row.public_repository_url,
    expires_at: row.expires_at,
    created_at: row.created_at
  };
  if (includePayRoute && row.state === "payment_pending") {
    body.pay_route = `${publicBaseUrl}/api/pay/${row.reservation_code}`;
  }
  return body;
}

export function publicOrder(row) {
  if (!row) return null;
  return {
    order_id: row.order_id,
    reservation_code: row.reservation_code,
    state: row.state,
    npm_package: row.npm_package,
    public_repository_url: row.public_repository_url,
    scoreboard_url: row.scoreboard_url,
    draft_pr_url: row.draft_pr_url || null,
    settlement: row.settlement,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function publicReceipt(row) {
  if (!row) return null;
  return {
    receipt_id: row.receipt_id,
    type: row.type,
    order_id: row.order_id,
    original_order_id: row.original_order_id || null,
    state: row.state,
    npm_package: row.npm_package,
    settlement: row.settlement,
    disclaimer: row.disclaimer || null,
    created_at: row.created_at
  };
}
