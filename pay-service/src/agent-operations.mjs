import { CAPACITY } from "./constants.mjs";
import { publicOrder } from "./privacy.mjs";

function operationError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, detail);
  return error;
}

export function createAgentOperations({ store, clock, publicBaseUrl, reservationTtlMs, fitVerifier, githubPrVerifier }) {
  return {
    async status() {
      const metrics = await store.metrics();
      return {
        service: "mcp-score-improvement",
        ready: true,
        capacity: { used: metrics.capacity_used, limit: CAPACITY, remaining: CAPACITY - metrics.capacity_used },
        metrics
      };
    },

    async listWork() {
      const [inquiries, orders, metrics] = await Promise.all([
        store.listInquiries(),
        store.listOrders(),
        store.metrics()
      ]);
      return {
        capacity: { used: metrics.capacity_used, limit: CAPACITY, remaining: CAPACITY - metrics.capacity_used },
        inquiries: inquiries
          .filter((row) => row.state === "inquiry_received")
          .map((row) => ({
            inquiry_code: row.inquiry_code,
            state: row.state,
            npm_package: row.npm_package,
            public_repository_url: row.public_repository_url,
            scoreboard_url: row.scoreboard_url,
            created_at: row.created_at
          })),
        orders: orders.map((row) => ({
          ...publicOrder(row),
          action:
            row.state === "paid"
              ? "open_one_focused_draft_pr"
              : row.state === "delivery_in_progress"
                ? "finish_and_mark_draft_pr_complete"
                : row.state === "delivered"
                  ? "neutral_rescore_due_within_7_days"
                  : "fail_closed"
        }))
      };
    },

    async qualifyInquiry(inquiryCode) {
      const inquiry = await store.getInquiry(inquiryCode);
      if (!inquiry) throw operationError("not_found");
      if (inquiry.state === "payment_pending" && inquiry.reservation_code) {
        const reservation = await store.getReservation(inquiry.reservation_code, clock());
        if (reservation?.state === "payment_pending") {
          const metrics = await store.metrics();
          return {
            inquiry_code: inquiryCode,
            reservation_code: reservation.reservation_code,
            state: reservation.state,
            expires_at: reservation.expires_at,
            pay_route: `${publicBaseUrl}/api/pay/${reservation.reservation_code}`,
            capacity: { used: metrics.capacity_used, limit: CAPACITY },
            fit_evidence: ["previously_verified"]
          };
        }
      }
      if (inquiry.state !== "inquiry_received") throw operationError("conflict", { state: inquiry.state });
      const fit = await fitVerifier(inquiry);
      if (!fit?.qualified) throw operationError(fit?.reason || "not_qualified", { retryable: Boolean(fit?.retryable) });
      const result = await store.approve({
        inquiryCode,
        now: clock(),
        ttlMs: reservationTtlMs
      });
      if (result.error) throw operationError(result.error, { state: result.state });
      return {
        inquiry_code: inquiryCode,
        reservation_code: result.reservation.reservation_code,
        state: result.reservation.state,
        expires_at: result.reservation.expires_at,
        pay_route: `${publicBaseUrl}/api/pay/${result.reservation.reservation_code}`,
        capacity: result.capacity,
        fit_evidence: fit.evidence || []
      };
    },

    async startDelivery(orderId, draftPrUrl) {
      const order = await store.getOrder(orderId);
      if (!order) throw operationError("not_found");
      if (order.state !== "paid") throw operationError("conflict", { state: order.state });
      const proof = await githubPrVerifier({ order, orderId, draftPrUrl, phase: "start" });
      if (!proof?.verified) throw operationError(proof?.reason || "draft_pr_unverified", { retryable: Boolean(proof?.retryable) });
      const result = await store.transitionOrder({
        orderId,
        from: "paid",
        to: "delivery_in_progress",
        now: clock(),
        draftPrUrl
      });
      if (result.error) throw operationError(result.error, { state: result.state });
      return { ...publicOrder(result.order), verification: proof.evidence };
    },

    async completeDelivery(orderId, draftPrUrl) {
      const order = await store.getOrder(orderId);
      if (!order) throw operationError("not_found");
      if (order.state !== "delivery_in_progress") throw operationError("conflict", { state: order.state });
      const proof = await githubPrVerifier({ order, orderId, draftPrUrl, phase: "complete" });
      if (!proof?.verified) throw operationError(proof?.reason || "draft_pr_unverified", { retryable: Boolean(proof?.retryable) });
      const result = await store.transitionOrder({
        orderId,
        from: "delivery_in_progress",
        to: "delivered",
        now: clock(),
        draftPrUrl
      });
      if (result.error) throw operationError(result.error, { state: result.state });
      return { ...publicOrder(result.order), verification: proof.evidence };
    }
  };
}
