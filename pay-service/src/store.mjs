import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPACITY, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, SLOT_STATES } from "./constants.mjs";
import { unguessableCode } from "./ids.mjs";
import { publicOrder, publicReceipt } from "./privacy.mjs";

const emptyState = () => ({
  version: 1,
  inquiries: {},
  reservations: {},
  orders: {},
  receipts: {},
  idempotency: {},
  rateLimits: {},
  metrics: { inquiries: 0, approvals: 0, paid: 0, refunds: 0, cancelled: 0 }
});

export async function createFileStore(dataDir) {
  const privateDir = join(dataDir, "private");
  const publicDir = join(dataDir, "public");
  const statePath = join(privateDir, "state.json");
  const publicPath = join(publicDir, "receipts.json");
  const lockPath = join(privateDir, "STATE.lock");
  await mkdir(privateDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  let state = emptyState();
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    await persist(state);
  }

  let chain = Promise.resolve();
  const withLock = (fn) => {
    const run = chain.then(() => fn(state), () => fn(state));
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  async function persist(next) {
    await writeFile(lockPath, `${process.pid}\n`, "utf8");
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

  const expireLocked = (now) => {
    for (const reservation of Object.values(state.reservations)) {
      if (reservation.state === "payment_pending" && now >= Date.parse(reservation.expires_at)) {
        reservation.state = "reservation_expired";
        const inquiry = state.inquiries[reservation.inquiry_code];
        if (inquiry && inquiry.state === "payment_pending") inquiry.state = "reservation_expired";
      }
    }
  };

  const usedSlots = () =>
    Object.values(state.reservations).filter((row) => SLOT_STATES.has(row.state)).length +
    Object.values(state.orders).filter((row) => SLOT_STATES.has(row.state) && !state.reservations[row.reservation_code]).length;

  return {
    dataDir,
    withLock,
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
        if (idempotencyKey && state.idempotency[idempotencyKey]) {
          return { replay: true, response: state.idempotency[idempotencyKey] };
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
        if (idempotencyKey) state.idempotency[idempotencyKey] = response;
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
          order_id: null
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
    async createOrder({ reservationCode, settlement, now }) {
      return withLock(async () => {
        expireLocked(now);
        const reservation = state.reservations[reservationCode];
        if (!reservation) return { error: "not_found" };
        if (reservation.order_id && state.orders[reservation.order_id]) {
          return { order: state.orders[reservation.order_id], replay: true };
        }
        if (reservation.state !== "payment_pending") return { error: "conflict", state: reservation.state };
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
        if (inquiry) inquiry.state = "paid";
        state.metrics.paid += 1;
        await persist(state);
        return { order, receipt };
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
        if (receipt && to !== "refunded") receipt.state = to;
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
        if (inquiry) inquiry.state = "cancelled";
        if (reservation && reservation.state === "payment_pending") reservation.state = "cancelled";
        if (order && (order.state === "paid" || order.state === "delivery_in_progress")) {
          return { error: "conflict", state: order.state };
        }
        state.metrics.cancelled += 1;
        await persist(state);
        return { state: "cancelled", inquiry_code: inquiry?.inquiry_code };
      });
    },
    async refund({ orderId, reason, now }) {
      return withLock(async () => {
        const order = state.orders[orderId];
        if (!order) return { error: "not_found" };
        if (!["paid", "delivery_in_progress", "delivered"].includes(order.state)) {
          return { error: "conflict", state: order.state };
        }
        const receipt_id = unguessableCode();
        order.state = "refunded";
        order.updated_at = new Date(now).toISOString();
        const inquiry = state.inquiries[order.inquiry_code];
        if (inquiry) inquiry.state = "refunded";
        const reservation = state.reservations[order.reservation_code];
        if (reservation) reservation.state = "refunded";
        const receipt = {
          receipt_id,
          type: "refund",
          order_id: receipt_id,
          original_order_id: order.order_id,
          state: "refunded",
          npm_package: order.npm_package,
          settlement: order.settlement,
          disclaimer: "Manual operator refund recorded on the ledger. This is not an automatic on-chain refund.",
          reason: reason || "manual operator refund",
          created_at: new Date(now).toISOString()
        };
        state.receipts[receipt_id] = receipt;
        state.metrics.refunds += 1;
        await persist(state);
        return { order, receipt };
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
