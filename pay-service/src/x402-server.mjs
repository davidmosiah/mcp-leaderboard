import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExpressAdapter, x402HTTPResourceServer, x402ResourceServer } from "@x402/express";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { NETWORK, PRICE_SDK, SERVICE_NAME } from "./constants.mjs";

export async function createX402HttpServer({
  facilitator,
  payTo,
  initialize = true,
  cdpApiKeyId,
  cdpApiKeySecret
} = {}) {
  const client = facilitator || createCdpFacilitatorClient({
    apiKeyId: cdpApiKeyId,
    apiKeySecret: cdpApiKeySecret
  });
  const resourceServer = new x402ResourceServer(client).register(NETWORK, new ExactEvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  const routes = {
    "POST /api/pay/:reservation": {
      accepts: {
        scheme: "exact",
        price: PRICE_SDK,
        network: NETWORK,
        payTo,
        maxTimeoutSeconds: 60
      },
      description: SERVICE_NAME,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: ["mcp", "scorecard", "remediation"],
      extensions: declareDiscoveryExtension({
        bodyType: "json",
        inputSchema: { type: "object" }
      })
    }
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  if (initialize) await httpServer.initialize();
  return httpServer;
}

export async function processOfficialPayment(httpServer, req) {
  const adapter = new ExpressAdapter(req);
  const context = {
    adapter,
    path: req.path,
    method: req.method,
    paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment")
  };
  const result = await httpServer.processHTTPRequest(context);
  if (result.type !== "payment-verified") return { result };
  const settleResult = await httpServer.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
    { request: context },
    undefined,
    result.beforeHandlerSettlement
  );
  return { result, settleResult };
}

export function sendX402Result(res, response) {
  res.status(response.status);
  for (const [key, value] of Object.entries(response.headers || {})) {
    res.setHeader(key, value);
  }
  if (response.isHtml) return res.send(response.body);
  return res.json(response.body || {});
}

export function hasPaymentSignature(req) {
  return Boolean(req.get("payment-signature") || req.get("x-payment"));
}
