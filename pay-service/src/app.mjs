import express from "express";
import { BOARD_HOST, BODY_LIMIT_BYTES, PAY_HOST, SERVICE_ID } from "./constants.mjs";
import { configErrors, loadConfig } from "./config.mjs";
import { log } from "./logger.mjs";
import { discoveryDocument, offerDocument } from "./offer.mjs";
import { openApiDocument } from "./openapi.mjs";
import { adminAuthorized, clientIp, hashIp, publicInquiry, publicOrder, publicReceipt, publicReservation } from "./privacy.mjs";
import { createFileStore } from "./store.mjs";
import { draftPrMatchesRepo, publicGithubPr, validateInquiry } from "./validation.mjs";
import { RECONCILIATION_STATES } from "./constants.mjs";
import { createX402HttpServer, hasPaymentSignature, isExplicitFinalSettleFailure, processOfficialPayment, sendX402Result } from "./x402-server.mjs";
import { bearerAuthorized } from "./privacy.mjs";
import { createPublicFitVerifier } from "./fit-verifier.mjs";
import { createGithubPrVerifier } from "./github-pr-verifier.mjs";
import { createAgentOperations } from "./agent-operations.mjs";
import { handleScoreboardAgentMcp } from "./agent-mcp.mjs";
import { createScoreboardOAuth } from "./oauth.mjs";

function requireAdmin(config) {
  return (req, res, next) => {
    if (!adminAuthorized(req, config.adminToken)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return next();
  };
}

function requireAgent(config) {
  return (req, res, next) => {
    if (!bearerAuthorized(req, config.agentToken)) {
      res.set("www-authenticate", `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp", scope="scoreboard:operate"`);
      return res.status(401).json({ error: "unauthorized" });
    }
    return next();
  };
}

export async function createApp(options = {}) {
  const config = loadConfig(options.env || process.env);
  const store = options.store || await createFileStore(config.dataDir, { payTo: config.payTo });
  const clock = options.clock || (() => Date.now());
  const fitVerifier = options.fitVerifier || createPublicFitVerifier();
  const githubPrVerifier = options.githubPrVerifier || createGithubPrVerifier({ actor: config.githubActor });
  const agentOperations = createAgentOperations({
    store,
    clock,
    publicBaseUrl: config.publicBaseUrl,
    reservationTtlMs: config.reservationTtlMs,
    fitVerifier,
    githubPrVerifier
  });
  const oauth = createScoreboardOAuth({ config, clock });
  const httpServer = options.httpServer || await createX402HttpServer({
    facilitator: options.facilitator,
    payTo: config.payTo,
    cdpApiKeyId: config.cdpApiKeyId,
    cdpApiKeySecret: config.cdpApiKeySecret,
    initialize: options.initializeX402 !== false
  });

  const app = express();
  app.locals.store = store;
  app.locals.config = config;
  app.disable("x-powered-by");
  app.use(express.json({ limit: BODY_LIMIT_BYTES }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT_BYTES }));
  app.use((req, res, next) => {
    log.info("request", { method: req.method, path: req.path });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      service: SERVICE_ID,
      host: PAY_HOST,
      board: BOARD_HOST,
      offer: "/api/offer",
      openapi: "/openapi.json",
      mcp: "/mcp",
      x402: "/.well-known/x402",
      independence: "Payment never buys rank, score, editorial treatment, security, merge, deploy, or publication."
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", async (_req, res) => {
    const errors = configErrors(config);
    try {
      await store.probeWrite();
    } catch {
      errors.push("store_unwritable");
    }
    if (errors.length) return res.status(503).json({ status: "not_ready", errors });
    return res.json({ status: "ready" });
  });

  app.get("/api/offer", async (_req, res) => {
    const used = await store.usedSlots(clock());
    res.json(offerDocument({ payTo: config.payTo, capacityUsed: used }));
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument());
  });

  app.get("/.well-known/x402", (_req, res) => {
    res.json(discoveryDocument({ payTo: config.payTo }));
  });

  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(oauth.protectedResourceMetadata());
  });
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json(oauth.protectedResourceMetadata());
  });
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(oauth.authorizationServerMetadata());
  });
  app.get("/oauth/authorize", (req, res) => oauth.authorizePage(req, res));
  app.post("/oauth/authorize", (req, res) => oauth.authorizeDecision(req, res));
  app.post("/oauth/token", (req, res) => oauth.token(req, res));

  app.post("/mcp", requireAgent(config), async (req, res) => {
    await handleScoreboardAgentMcp(req, res, agentOperations);
  });
  app.get("/mcp", requireAgent(config), (_req, res) => {
    res.status(405).set("allow", "POST").json({ error: "method_not_allowed" });
  });
  app.delete("/mcp", requireAgent(config), (_req, res) => {
    res.status(405).set("allow", "POST").json({ error: "method_not_allowed" });
  });

  app.post("/api/inquiry", async (req, res) => {
    const parsed = validateInquiry(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const result = await store.createInquiry({
      value: parsed.value,
      ipHash: hashIp(clientIp(req, { trustProxy: config.trustProxy })),
      now: clock(),
      idempotencyKey: req.get("idempotency-key") || null
    });
    if (result.conflict) return res.status(409).json({ error: "idempotency_conflict" });
    if (result.limited) return res.status(429).json({ error: "rate_limited" });
    log.info("inquiry_received", { inquiry_code: result.response.inquiry_code });
    return res.status(201).json(result.response);
  });

  app.get("/api/inquiry/:code", async (req, res) => {
    const row = await store.getInquiry(req.params.code);
    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(publicInquiry(row));
  });

  app.post("/api/fit/approve", requireAdmin(config), async (req, res) => {
    const inquiryCode = req.body?.inquiry_code;
    const result = await store.approve({
      inquiryCode,
      now: clock(),
      ttlMs: config.reservationTtlMs
    });
    if (result.error === "not_found") return res.status(404).json({ error: "not_found" });
    if (result.error === "capacity_exhausted") return res.status(409).json({ error: "capacity_exhausted" });
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    log.info("fit_approved", { reservation_code: result.reservation.reservation_code });
    return res.status(result.created ? 201 : 200).json({
      inquiry_code: result.reservation.inquiry_code,
      reservation_code: result.reservation.reservation_code,
      state: result.reservation.state,
      expires_at: result.reservation.expires_at,
      reservation_url: `/api/reservation/${result.reservation.reservation_code}`,
      pay_route: `${config.publicBaseUrl}/api/pay/${result.reservation.reservation_code}`,
      capacity: result.capacity
    });
  });

  app.get("/api/reservation/:code", async (req, res) => {
    const row = await store.getReservation(req.params.code, clock());
    if (!row) return res.status(404).json({ error: "not_found" });
    if (row.state === "reservation_expired") {
      return res.status(410).json(publicReservation(row, { includePayRoute: false }));
    }
    return res.json(publicReservation(row, {
      includePayRoute: row.state === "payment_pending",
      publicBaseUrl: config.publicBaseUrl
    }));
  });

  app.post("/api/pay/:reservation", async (req, res) => {
    const now = clock();
    const reservation = await store.getReservation(req.params.reservation, now);
    if (!reservation) return res.status(404).json({ error: "not_found" });
    if (reservation.state === "reservation_expired") return res.status(410).json({ error: "expired" });
    if (RECONCILIATION_STATES.has(reservation.state)) {
      return res.status(409).json({ error: "reconciliation_required", state: reservation.state });
    }
    if (reservation.order_id) {
      const existing = await store.getOrder(reservation.order_id);
      if (existing) return res.json({ ...publicOrder(existing), order_id: existing.order_id });
    }
    if (reservation.state !== "payment_pending") {
      return res.status(409).json({ error: "not_payable", state: reservation.state });
    }

    if (!hasPaymentSignature(req)) {
      const { result } = await processOfficialPayment(httpServer, req);
      if (result.type === "payment-error") return sendX402Result(res, result.response);
      return res.status(500).json({ error: "payment_processing_failed" });
    }

    const claim = await store.claimPay({
      reservationCode: reservation.reservation_code,
      now
    });
    if (claim.existing) {
      return res.json({ ...publicOrder(claim.existing), order_id: claim.existing.order_id });
    }
    if (claim.busy) {
      const waited = await store.waitForOrder(reservation.reservation_code);
      if (waited?.reconciliation) {
        return res.status(409).json({ error: "reconciliation_required", state: waited.state });
      }
      if (waited) return res.json({ ...publicOrder(waited), order_id: waited.order_id });
      return res.status(409).json({ error: "pay_in_progress" });
    }
    if (claim.error === "reconciliation_required") {
      return res.status(409).json({ error: "reconciliation_required", state: claim.state });
    }
    if (claim.error) return res.status(409).json({ error: claim.error, state: claim.state });

    let result;
    let settleResult;
    let settleStarted = false;
    try {
      ({ result, settleResult, settleStarted } = await processOfficialPayment(httpServer, req));
    } catch (error) {
      if (error.settleStarted) {
        await store.markReconciliationRequired({
          reservationCode: reservation.reservation_code,
          now,
          reason: error.message || "settlement_interrupted"
        });
        return res.status(409).json({ error: "reconciliation_required", state: "payment_reconciliation_required" });
      }
      await store.releasePayClaim(reservation.reservation_code);
      throw error;
    }
    if (result.type === "payment-error") {
      await store.releasePayClaim(reservation.reservation_code);
      return sendX402Result(res, result.response);
    }
    if (result.type !== "payment-verified") {
      await store.releasePayClaim(reservation.reservation_code);
      return res.status(500).json({ error: "payment_processing_failed" });
    }
    if (settleResult?.success && settleResult.transaction) {
      // continue to createOrder
    } else if (settleStarted && isExplicitFinalSettleFailure(settleResult)) {
      await store.releasePayClaim(reservation.reservation_code);
      return res.status(402).json({ error: "settlement_unverified" });
    } else {
      await store.markReconciliationRequired({
        reservationCode: reservation.reservation_code,
        now,
        reason: settleResult?.errorReason || "settlement_unknown"
      });
      return res.status(409).json({ error: "reconciliation_required", state: "payment_reconciliation_required" });
    }

    let created;
    try {
      created = await store.createOrder({
        reservationCode: reservation.reservation_code,
        now,
        settlement: {
          network: settleResult.network,
          transaction: settleResult.transaction,
          amount: settleResult.amount || result.paymentRequirements?.amount,
          asset: result.paymentRequirements?.asset,
          pay_to: result.paymentRequirements?.payTo,
          payer: settleResult.payer || null,
          scheme: result.paymentRequirements?.scheme
        }
      });
    } catch (error) {
      try {
        await store.markReconciliationRequired({
          reservationCode: reservation.reservation_code,
          now,
          reason: error.message || "create_order_persist_failed"
        });
        return res.status(409).json({
          error: "reconciliation_required",
          state: "payment_reconciliation_required"
        });
      } catch (persistError) {
        log.warn("fatal_persist_after_settle", { message: persistError?.message || "persist_failed" });
        if (typeof options.onFatalPersist === "function") {
          await options.onFatalPersist(persistError);
          return res.status(500).json({ error: "internal_error" });
        }
        process.exit(1);
      }
    }
    if (created.error) {
      await store.markReconciliationRequired({
        reservationCode: reservation.reservation_code,
        now,
        reason: created.error
      });
      return res.status(409).json({ error: "reconciliation_required", state: "payment_reconciliation_required" });
    }
    log.info("paid", { order_id: created.order.order_id });
    for (const [key, value] of Object.entries(settleResult.headers || {})) {
      res.setHeader(key, value);
    }
    return res.json({ ...publicOrder(created.order), order_id: created.order.order_id });
  });

  app.get("/api/order/:id", async (req, res) => {
    const row = await store.getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(publicOrder(row));
  });

  app.get("/api/receipt/:id", async (req, res) => {
    const row = await store.getReceipt(req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(publicReceipt(row));
  });

  const admin = requireAdmin(config);

  app.get("/api/admin/inquiries", admin, async (_req, res) => {
    const inquiries = await store.listInquiries();
    res.json({
      inquiries: inquiries.map((row) => ({
        inquiry_code: row.inquiry_code,
        state: row.state,
        npm_package: row.npm_package,
        public_repository_url: row.public_repository_url,
        scoreboard_url: row.scoreboard_url,
        reply_email: row.reply_email,
        created_at: row.created_at
      }))
    });
  });

  app.get("/api/admin/orders", admin, async (_req, res) => {
    const orders = await store.listOrders();
    res.json({ orders: orders.map((row) => publicOrder(row)) });
  });

  app.get("/api/admin/metrics", admin, async (_req, res) => {
    res.json(await store.metrics());
  });

  app.post("/api/admin/delivery/start", admin, async (req, res) => {
    const result = await store.transitionOrder({
      orderId: req.body?.order_id,
      from: "paid",
      to: "delivery_in_progress",
      now: clock()
    });
    if (result.error === "not_found") return res.status(409).json({ error: "conflict" });
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    return res.json(publicOrder(result.order));
  });

  app.post("/api/admin/delivery/complete", admin, async (req, res) => {
    const draft = req.body?.draft_pr_url;
    if (draft && !publicGithubPr(draft)) return res.status(400).json({ error: "draft_pr_url_invalid" });
    if (draft) {
      const order = await store.getOrder(req.body?.order_id);
      if (order && !draftPrMatchesRepo(draft, order.public_repository_url)) {
        return res.status(400).json({ error: "draft_pr_repo_mismatch" });
      }
    }
    const result = await store.transitionOrder({
      orderId: req.body?.order_id,
      from: "delivery_in_progress",
      to: "delivered",
      now: clock(),
      draftPrUrl: draft || null
    });
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    return res.json(publicOrder(result.order));
  });

  app.post("/api/admin/cancel", admin, async (req, res) => {
    const result = await store.cancel({
      inquiryCode: req.body?.inquiry_code,
      reservationCode: req.body?.reservation_code,
      orderId: req.body?.order_id,
      now: clock()
    });
    if (result.error === "not_found") return res.status(404).json({ error: "not_found" });
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    return res.json({ state: "cancelled", inquiry_code: result.inquiry_code });
  });

  app.post("/api/admin/refund", admin, async (req, res) => {
    const result = await store.refund({
      orderId: req.body?.order_id,
      reason: req.body?.reason,
      now: clock(),
      proof: req.body?.refund
    });
    if (result.error === "not_found") return res.status(404).json({ error: "not_found" });
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    if (!result.verified) {
      return res.status(202).json({
        state: "refund_pending",
        order_id: result.order.order_id,
        receipt_id: result.receipt.receipt_id,
        disclaimer: result.receipt.disclaimer
      });
    }
    return res.status(201).json({
      state: "refunded",
      order_id: result.order.order_id,
      receipt_id: result.receipt.receipt_id,
      disclaimer: result.receipt.disclaimer
    });
  });

  app.post("/api/admin/reconcile", admin, async (req, res) => {
    const result = await store.reconcile({
      reservationCode: req.body?.reservation_code,
      decision: req.body?.decision,
      settlement: req.body?.settlement,
      now: clock(),
      note: req.body?.note
    });
    if (result.error === "not_found") return res.status(404).json({ error: "not_found" });
    if (result.error === "invalid_decision" || result.error === "settlement_invalid") {
      return res.status(400).json({ error: result.error });
    }
    if (result.error) return res.status(409).json({ error: result.error, state: result.state });
    if (result.decision === "paid") {
      return res.status(201).json({
        state: "paid",
        decision: "paid",
        order_id: result.order.order_id,
        reservation_code: result.reservation.reservation_code
      });
    }
    return res.json({
      state: "cancelled",
      decision: "release",
      reservation_code: result.reservation.reservation_code
    });
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.too.large" || error?.status === 413) {
      return res.status(413).json({ error: "payload_too_large" });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid_json" });
    }
    log.warn("unhandled", { message: error?.message || "error" });
    return res.status(500).json({ error: "internal_error" });
  });

  return app;
}
