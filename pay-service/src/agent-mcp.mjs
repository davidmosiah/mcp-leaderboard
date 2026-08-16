import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

function success(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function blocked(error) {
  const value = {
    status: "blocked",
    error: error?.code || "operation_failed",
    ...(error?.state ? { state: error.state } : {}),
    ...(error?.retryable ? { retryable: true } : {})
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}

function registerTool(server, name, definition, handler) {
  server.registerTool(name, definition, async (input) => {
    try {
      return success(await handler(input));
    } catch (error) {
      return blocked(error);
    }
  });
}

export function createScoreboardAgentMcp(operations) {
  const server = new McpServer({
    name: "scoreboard-ops-mcp-server",
    version: "1.0.0"
  });

  registerTool(server, "scoreboard_get_status", {
    title: "Get Scoreboard Pay Status",
    description:
      "Read the isolated MCP Score Improvement capacity and counters. Returns no contact, credential, wallet secret, or Delx Commerce data.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, () => operations.status());

  registerTool(server, "scoreboard_list_work", {
    title: "List Scoreboard Work",
    description:
      "List sanitized pending inquiries and paid delivery work for the isolated Scoreboard laboratory. Use this before any mutation. It never returns reply email or credentials.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, () => operations.listWork());

  registerTool(server, "scoreboard_qualify_inquiry", {
    title: "Qualify Scoreboard Inquiry",
    description:
      "Qualify one inquiry using live public GitHub, npm, and neutral Scoreboard evidence, then reserve one founding seat only if every deterministic check passes. Cannot override a failed check.",
    inputSchema: {
      inquiry_code: z.string().min(32).max(128).describe("Unguessable inquiry code returned by the pay-service")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ inquiry_code }) => operations.qualifyInquiry(inquiry_code));

  const deliveryInput = {
    order_id: z.string().min(32).max(128).describe("Verified paid order id"),
    draft_pr_url: z.string().url().max(500).describe("Public GitHub draft PR URL in the purchased repository")
  };

  registerTool(server, "scoreboard_start_delivery", {
    title: "Start Scoreboard Delivery",
    description:
      "Move a verified paid order into delivery only after live GitHub proves an open draft PR by the allowlisted operator on the purchased repository with the exact order marker.",
    inputSchema: deliveryInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ order_id, draft_pr_url }) => operations.startDelivery(order_id, draft_pr_url));

  registerTool(server, "scoreboard_complete_delivery", {
    title: "Complete Scoreboard Delivery",
    description:
      "Mark delivery complete only after live GitHub proves the matching open draft PR carries the exact order marker and MCP-Scoreboard-Delivery: complete marker. Does not merge or publish.",
    inputSchema: deliveryInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ order_id, draft_pr_url }) => operations.completeDelivery(order_id, draft_pr_url));

  return server;
}

export async function handleScoreboardAgentMcp(req, res, operations) {
  const server = createScoreboardAgentMcp(operations);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
