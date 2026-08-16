import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPACITY, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, RECONCILIATION_STATES } from "./constants.mjs";
import { unguessableCode } from "./ids.mjs";
import { publicOrder, publicReceipt } from "./privacy.mjs";
import { validateReconcileSettlement } from "./validation.mjs";

const POST_PAYMENT_STATES = new Set([
  "paid",
  "delivery_in_progress",
  "delivered",
  "refunded",
  "refund_pending",
  "settlement_unknown",
  "payment_reconciliation_required"
]);
const ORDERABLE_STATES = new Set([
  "payment_pending",
  "settlement_unknown",
  "payment_reconciliation_required"
]);

const emptyState = () => ({
  version: 1,
  inquiries: {},
  reservations: {},
  orders: {},
  receipts: {},
  idempotency: {},
  rateLimits: {},
  reconciliations: [],
  metrics: { inquiries: 0, approvals: 0, paid: 0, refunds: 0, cancelled: 0, reconciliations: 0 }
});

export function inquiryPayloadHash(value) {
  return createHash("sha256")
    .update(JSON.stringify({
      public_repository_url: value.public_repository_url,
      npm_package: value.npm_package,
      scoreboard_url: value.scoreboard_url,
      reply_email: value.reply_email
    }))
    .digest("hex");
}

function isValidRefundProof(proof, order) {
  if (!proof || typeof proof !== "object") return false;
  const transaction = String(proof.transaction || "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(transaction)) return false;
  if (String(proof.network || "") !== String(order.settlement?.network || "")) return false;
  if (String(proof.amount || "") !== String(order.settlement?.amount || "")) return false;
  const merchant = String(order.settlement?.pay_to || "").toLowerCase();
  const originalPayer = String(order.settlement?.payer || "").toLowerCase();
  if (!merchant || String(proof.payer || "").toLowerCase() !== merchant) return false;
  if (!originalPayer || String(proof.recipient || "").toLowerCase() !== originalPayer) return false;
  return true;
}

async function acquireInstanceLock(lockPath) {
  try {
    const handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR);
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  let stale = false;
  try {
    const raw = (await readFile(lockPath, "utf8")).trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (killError) {
        if (killError.code === "ESRCH") stale = true;
        else throw new Error("pay-service already running: exclusive STATE.lock held");
      }
    } else {
      stale = true;
    }
  } catch (error) {
    if (error.message?.includes("already running")) throw error;
    if (error.code === "ENOENT") stale = true;
    else throw new Error("pay-service already running: exclusive STATE.lock held");
  }

  if (!stale) {
    throw new Error("pay-service already running: exclusive STATE.lock held");
  }

  try {
    await unlink(lockPath);
  } catch {
    // raced with another recoverer
  }
  const handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR);
  await handle.writeFile(`${process.pid}\n`);
  await handle.close();
}

async function releaseInstanceLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function createFileStore(dataDir, { payTo } = {}) {
  const privateDir = join(dataDir, "private");
  const publicDir = join(dataDir, "public");
  const statePath = join(privateDir, "state.json");
  const publicPath = join(publicDir, "receipts.json");
  const lockPath = join(privateDir, "STATE.lock");
  await mkdir(privateDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await acquireInstanceLock(lockPath);

  let state = emptyState();
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      await persist(state);
    } else {
      await releaseInstanceLock(lockPath);
      if (error instanceof SyntaxError) {
        throw new Error(`corrupted state.json: JSON parse failed: ${error.message}`);
      }
      throw error;
    }
  }

  if (!state.reservations) state.reservations = {};
  if (!state.orders) state.orders = {};
  if (!state.inquiries) state.inquiries = {};
  if (!Array.isArray(state.reconciliations)) state.reconciliations = [];
  if (!state.metrics) state.metrics = emptyState().metrics;
  if (typeof state.metrics.reconciliations !== "number") state.metrics.reconciliations = 0;

  let chain = Promise.resolve();
  const withLock = (fn) => {
    const run = chain.then(() => fn(state), () => fn(state));
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  async function persist(next) {
    const tmp = `${statePath}.tmp`;
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, statePath);
    const projection = {
      version: 1,
      receipts: Object.values(next.receipts).map(publicReceipt),
      orders: Object.values(next.orders).map(publicOrder)
    };
    const publicTmp = `${publicPath}.tmp`;
    await writeFile(publicTmp, `${JSON.stringify(projection, null, 2)}\n`);
    await rename(publicTmp, publicPath);
    state = next;
  }

  const applyReconciliationLocked = (reservation, now, reason, type = "settlement_unknown") => {
    reservation.state = "payment_reconciliation_required";
    reservation.settlement_unknown = true;
    reservation.reconciliation_reason = reason;
    reservation.updated_at = new Date(now).toISOString();
    const inquiry = state.inquiries[reservation.inquiry_code];
    if (inquiry) inquiry.state = "payment_reconciliation_required";
    state.reconciliations.push({
      id: unguessableCode(),
      type,
      reservation_code: reservation.reservation_code,
      created_at: new Date(now).toISOString(),
      reason
    });
    state.metrics.reconciliations += 1;
  };

  let orphanClaims = 0;
  for (const reservation of Object.values(state.reservations)) {
    const hasClaim = Boolean(reservation.pay_claim?.claimed_at);
    const hasOrder = Boolean(reservation.order_id && state.orders[reservation.order_id]);
    if (reservation.state === "payment_pending" && hasClaim && !hasOrder) {
      applyReconciliationLocked(
        reservation,
        Date.now(),
        "orphan_pay_claim_on_startup",
        "startup_orphan_claim"
      );
      orphanClaims += 1;
    }
  }
  if (orphanClaims) await persist(state);

  const expireLocked = (now) => {
    for (const reservation of Object.values(state.reservations)) {
      if (
        reservation.state === "payment_pending"
        && !reservation.pay_claim
        && now >= Date.parse(reservation.expires_at)
      ) {
        reservation.state = "reservation_expired";
        const inquiry = state.inquiries[reservation.inquiry_code];
        if (inquiry && inquiry.state === "payment_pending") inquiry.state = "reservation_expired";
      }
    }
  };

  const usedSlots = () => {
    const heldReservations = Object.values(state.reservations)
      .filter((row) => row.state === "payment_pending" || RECONCILIATION_STATES.has(row.state)).length;
    return heldReservations + Object.values(state.orders).length;
  };

  const createOrderLocked = ({ reservationCode, settlement, now }) => {
    const reservation = state.reservations[reservationCode];
    if (!reservation) return { error: "not_found" };
    if (reservation.order_id && state.orders[reservation.order_id]) {
      reservation.pay_claim = null;
      return { order: state.orders[reservation.order_id], replay: true };
    }
    if (!ORDERABLE_STATES.has(reservation.state)) return { error: "conflict", state: reservation.state };
    if (!settlement?.transaction) return { error: "settlement_missing" };
    const order_id = unguessableCode();
    const inquiry = state.inquiries[reservation.inquiry_code];
    const order = {
      order_id,
      reservation_code: reservationCode,
      inquiry_code: reservation.inquiry_code,
      state: "paid",
      npm_package: reservation.npm_package,
      public_repository_url: reservation.public_repository_url,
      scoreboard_url: reservation.scoreboard_url,
      draft_pr_url: null,
      settlement,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString()
    };
    const receipt = {
      receipt_id: order_id,
      type: "payment",
      order_id,
      state: "paid",
      npm_package: order.npm_package,
      settlement,
      created_at: order.created_at
    };
    state.orders[order_id] = order;
    state.receipts[order_id] = receipt;
    reservation.state = "paid";
    reservation.order_id = order_id;
    reservation.pay_claim = null;
    reservation.settlement_unknown = false;
    if (inquiry) inquiry.state = "paid";
    state.metrics.paid += 1;
    return { order, receipt };
  };

  const existingIdempotency = (key) => {
    const stored = state.idempotency[key];
    if (!stored) return null;
    if (stored && typeof stored === "object" && stored.payload_hash && stored.response) {
      return stored;
    }
    return { payload_hash: null, response: stored };
  };

  return {
    dataDir,
    withLock,
    async close() {
      await releaseInstanceLock(lockPath);
    },
    async expire(now) {
      return withLock(async () => {
        expireLocked(now);
        await persist(state);
      });
    },
    async usedSlots(now) {
      return withLock(async () => {
        expireLocked(now);
        return usedSlots();
      });
    },
    async createInquiry({ value, ipHash, now, idempotencyKey }) {
      return withLock(async () => {
        expireLocked(now);
        const payloadHash = inquiryPayloadHash(value);
        if (idempotencyKey) {
          const existing = existingIdempotency(idempotencyKey);
          if (existing) {
            if (existing.payload_hash && existing.payload_hash !== payloadHash) {
              return { conflict: true };
            }
            if (existing.payload_hash === payloadHash) {
              return { replay: true, response: existing.response };
            }
            return { conflict: true };
          }
        }
        const windowStart = now - RATE_LIMIT_WINDOW_MS;
        const hits = (state.rateLimits[ipHash] || []).filter((ts) => ts >= windowStart);
        if (hits.length >= RATE_LIMIT_MAX) return { limited: true };
        hits.push(now);
        state.rateLimits[ipHash] = hits;
        const inquiry_code = unguessableCode();
        const row = {
          inquiry_code,
          state: "inquiry_received",
          ...value,
          ip_hash: ipHash,
          created_at: new Date(now).toISOString(),
          reservation_code: null
        };
        state.inquiries[inquiry_code] = row;
        state.metrics.inquiries += 1;
        const response = {
          inquiry_code,
          state: row.state,
          inquiry_url: `/api/inquiry/${inquiry_code}`,
          message: "Fit review required before any reservation or payment."
        };
        if (idempotencyKey) {
          state.idempotency[idempotencyKey] = { payload_hash: payloadHash, response };
        }
        await persist(state);
        return { row, response };
      });
    },
    async getInquiry(code) {
      return withLock(async () => state.inquiries[code] || null);
    },
    async listInquiries() {
      return withLock(async () => Object.values(state.inquiries));
    },
    async approve({ inquiryCode, now, ttlMs }) {
      return withLock(async () => {
        expireLocked(now);
        const inquiry = state.inquiries[inquiryCode];
        if (!inquiry) return { error: "not_found" };
        if (inquiry.state === "cancelled") return { error: "conflict", state: inquiry.state };
        const existing = inquiry.reservation_code && state.reservations[inquiry.reservation_code];
        if (existing && existing.state === "payment_pending") {
          return { reservation: existing, capacity: { used: usedSlots(), limit: CAPACITY } };
        }
        if (usedSlots() >= CAPACITY) return { error: "capacity_exhausted" };
        const reservation_code = unguessableCode();
        const reservation = {
          reservation_code,
          inquiry_code: inquiryCode,
          state: "payment_pending",
          npm_package: inquiry.npm_package,
          public_repository_url: inquiry.public_repository_url,
          scoreboard_url: inquiry.scoreboard_url,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + ttlMs).toISOString(),
          order_id: null,
          pay_claim: null
        };
        state.reservations[reservation_code] = reservation;
        inquiry.state = "payment_pending";
        inquiry.reservation_code = reservation_code;
        state.metrics.approvals += 1;
        await persist(state);
        return { reservation, created: true, capacity: { used: usedSlots(), limit: CAPACITY } };
      });
    },
    async getReservation(code, now) {
      return withLock(async () => {
        expireLocked(now);
        return state.reservations[code] || null;
      });
    },
    async claimPay({ reservationCode, now }) {
      return withLock(async () => {
        expireLocked(now);
        const reservation = state.reservations[reservationCode];
        if (!reservation) return { error: "not_found" };
        if (reservation.order_id && state.orders[reservation.order_id]) {
          return { existing: state.orders[reservation.order_id] };
        }
        if (RECONCILIATION_STATES.has(reservation.state)) {
          return { error: "reconciliation_required", state: reservation.state };
        }
        if (reservation.state !== "payment_pending") {
          return { error: "not_payable", state: reservation.state };
        }
        if (reservation.pay_claim?.claimed_at) {
          return { busy: true };
        }
        reservation.pay_claim = { claimed_at: new Date(now).toISOString(), pid: process.pid };
        await persist(state);
        return { claimed: true };
      });
    },
    async releasePayClaim(reservationCode) {
      return withLock(async () => {
        const reservation = state.reservations[reservationCode];
        if (reservation?.pay_claim) {
          reservation.pay_claim = null;
          await persist(state);
        }
      });
    },
    async waitForOrder(reservationCode, timeoutMs = 8000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const snapshot = await withLock(async () => {
          const reservation = state.reservations[reservationCode];
          if (reservation?.order_id) {
            const order = state.orders[reservation.order_id];
            if (order) return { order };
          }
          if (RECONCILIATION_STATES.has(reservation?.state)) {
            return { reconciliation: true, state: reservation.state };
          }
          return null;
        });
        if (snapshot?.order) return snapshot.order;
        if (snapshot?.reconciliation) return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return null;
    },
    async markReconciliationRequired({ reservationCode, now, reason }) {
      return withLock(async () => {
        const reservation = state.reservations[reservationCode];
        if (!reservation) return { error: "not_found" };
        if (reservation.order_id && state.orders[reservation.order_id]) {
          return { order: state.orders[reservation.order_id] };
        }
        applyReconciliationLocked(
          reservation,
          now,
          reason || "settlement_interrupted",
          "settlement_unknown"
        );
        await persist(state);
        return { reservation };
      });
    },
    async reconcile({ reservationCode, decision, settlement, now, note }) {
      return withLock(async () => {
        const reservation = state.reservations[reservationCode];
        if (!reservation) return { error: "not_found" };
        if (!RECONCILIATION_STATES.has(reservation.state)) {
          return { error: "conflict", state: reservation.state };
        }
        if (decision === "paid") {
          const valid = validateReconcileSettlement(settlement, payTo);
          if (valid.error) return { error: valid.error };
          const created = createOrderLocked({ reservationCode, settlement, now });
          if (created.error) return created;
          state.reconciliations.push({
            id: unguessableCode(),
            type: "admin_paid",
            reservation_code: reservationCode,
            order_id: created.order.order_id,
            created_at: new Date(now).toISOString(),
            note: note || "admin_reconcile_paid",
            settlement
          });
          await persist(state);
          return { decision: "paid", order: created.order, reservation };
        }
        if (decision === "release") {
          reservation.state = "cancelled";
          reservation.pay_claim = null;
          const inquiry = state.inquiries[reservation.inquiry_code];
          if (inquiry) inquiry.state = "cancelled";
          state.metrics.cancelled += 1;
          state.reconciliations.push({
            id: unguessableCode(),
            type: "admin_release",
            reservation_code: reservationCode,
            created_at: new Date(now).toISOString(),
            note: note || "admin_reconcile_release"
          });
          await persist(state);
          return { decision: "release", reservation, inquiry };
        }
        return { error: "invalid_decision" };
      });
    },
    async createOrder({ reservationCode, settlement, now }) {
      return withLock(async () => {
        expireLocked(now);
        const created = createOrderLocked({ reservationCode, settlement, now });
        if (created.error) return created;
        await persist(state);
        return created;
      });
    },
    async getOrder(id) {
      return withLock(async () => state.orders[id] || null);
    },
    async getReceipt(id) {
      return withLock(async () => state.receipts[id] || null);
    },
    async listOrders() {
      return withLock(async () => Object.values(state.orders));
    },
    async transitionOrder({ orderId, from, to, now, draftPrUrl }) {
      return withLock(async () => {
        const order = state.orders[orderId];
        if (!order) return { error: "not_found" };
        if (order.state !== from) return { error: "conflict", state: order.state };
        order.state = to;
        order.updated_at = new Date(now).toISOString();
        if (draftPrUrl) order.draft_pr_url = draftPrUrl;
        const inquiry = state.inquiries[order.inquiry_code];
        if (inquiry) inquiry.state = to;
        const reservation = state.reservations[order.reservation_code];
        if (reservation) reservation.state = to;
        const receipt = state.receipts[order.order_id];
        if (receipt && to !== "refunded" && to !== "refund_pending") receipt.state = to;
        await persist(state);
        return { order };
      });
    },
    async cancel({ inquiryCode, reservationCode, orderId, now }) {
      return withLock(async () => {
        expireLocked(now);
        const order = orderId ? state.orders[orderId] : null;
        const reservation = reservationCode
          ? state.reservations[reservationCode]
          : order
            ? state.reservations[order.reservation_code]
            : null;
        const inquiry = inquiryCode
          ? state.inquiries[inquiryCode]
          : reservation
            ? state.inquiries[reservation.inquiry_code]
            : order
              ? state.inquiries[order.inquiry_code]
              : null;
        if (!inquiry && !reservation && !order) return { error: "not_found" };
        if (order && POST_PAYMENT_STATES.has(order.state)) {
          return { error: "conflict", state: order.state };
        }
        if (reservation && POST_PAYMENT_STATES.has(reservation.state)) {
          return { error: "conflict", state: reservation.state };
        }
        if (inquiry?.state === "inquiry_received") {
          inquiry.state = "cancelled";
          state.metrics.cancelled += 1;
          await persist(state);
          return { state: "cancelled", inquiry_code: inquiry.inquiry_code };
        }
        if (reservation?.state === "payment_pending") {
          reservation.state = "cancelled";
          if (inquiry) inquiry.state = "cancelled";
          state.metrics.cancelled += 1;
          await persist(state);
          return { state: "cancelled", inquiry_code: inquiry?.inquiry_code };
        }
        return { error: "conflict", state: reservation?.state || inquiry?.state || "unknown" };
      });
    },
    async refund({ orderId, reason, now, proof }) {
      return withLock(async () => {
        const order = state.orders[orderId];
        if (!order) return { error: "not_found" };
        if (order.state === "refunded") return { error: "conflict", state: order.state };
        if (!["paid", "delivery_in_progress", "delivered", "refund_pending"].includes(order.state)) {
          return { error: "conflict", state: order.state };
        }
        const verified = isValidRefundProof(proof, order);
        if (verified) {
          order.state = "refunded";
          order.updated_at = new Date(now).toISOString();
          const inquiry = state.inquiries[order.inquiry_code];
          if (inquiry) inquiry.state = "refunded";
          const reservation = state.reservations[order.reservation_code];
          if (reservation) reservation.state = "refunded";
          const receipt_id = unguessableCode();
          const receipt = {
            receipt_id,
            type: "refund",
            order_id: receipt_id,
            original_order_id: order.order_id,
            state: "refunded",
            npm_package: order.npm_package,
            settlement: {
              network: proof.network,
              transaction: proof.transaction,
              amount: proof.amount,
              payer: proof.payer,
              recipient: proof.recipient
            },
            disclaimer: "Operator-verified on-chain refund recorded. The service did not broadcast this transfer.",
            reason: reason || "manual operator refund",
            created_at: new Date(now).toISOString()
          };
          state.receipts[receipt_id] = receipt;
          state.metrics.refunds += 1;
          await persist(state);
          return { order, receipt, verified: true };
        }
        if (order.state === "refund_pending") {
          const existing = Object.values(state.receipts).find((row) => (
            row.original_order_id === order.order_id && row.type === "refund_request"
          ));
          if (existing) return { order, receipt: existing, verified: false };
        }
        order.state = "refund_pending";
        order.updated_at = new Date(now).toISOString();
        const inquiry = state.inquiries[order.inquiry_code];
        if (inquiry) inquiry.state = "refund_pending";
        const reservation = state.reservations[order.reservation_code];
        if (reservation) reservation.state = "refund_pending";
        const receipt_id = unguessableCode();
        const receipt = {
          receipt_id,
          type: "refund_request",
          order_id: receipt_id,
          original_order_id: order.order_id,
          state: "refund_pending",
          npm_package: order.npm_package,
          settlement: null,
          disclaimer: "Refund requested on the ledger. This is not a verified on-chain refund.",
          reason: reason || "manual operator refund",
          created_at: new Date(now).toISOString()
        };
        state.receipts[receipt_id] = receipt;
        await persist(state);
        return { order, receipt, verified: false };
      });
    },
    async metrics() {
      return withLock(async () => ({ ...state.metrics, capacity_used: usedSlots() }));
    },
    async probeWrite() {
      return withLock(async () => {
        await persist(state);
        return true;
      });
    }
  };
}
