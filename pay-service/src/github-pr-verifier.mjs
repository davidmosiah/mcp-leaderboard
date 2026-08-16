import { githubOwnerRepo, publicGithubPr } from "./validation.mjs";

const TIMEOUT_MS = 8_000;

export function createGithubPrVerifier({ fetchImpl = fetch, actor = "davidmosiah" } = {}) {
  return async function verifyGithubPr({ order, draftPrUrl, phase }) {
    if (!publicGithubPr(draftPrUrl)) return { verified: false, reason: "draft_pr_url_invalid" };
    const match = String(draftPrUrl).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i);
    const purchasedRepo = githubOwnerRepo(order.public_repository_url);
    if (!match || `${match[1]}/${match[2]}`.toLowerCase() !== purchasedRepo) {
      return { verified: false, reason: "draft_pr_repo_mismatch" };
    }
    try {
      const response = await fetchImpl(
        `https://api.github.com/repos/${match[1]}/${match[2]}/pulls/${match[3]}`,
        {
          headers: { accept: "application/vnd.github+json", "user-agent": "mcp-scoreboard-pay" },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        }
      );
      if (!response.ok) return { verified: false, reason: `github_http_${response.status}` };
      const pr = await response.json();
      const body = String(pr.body || "");
      if (String(pr.base?.repo?.full_name || "").toLowerCase() !== purchasedRepo) {
        return { verified: false, reason: "draft_pr_repo_mismatch" };
      }
      if (String(pr.user?.login || "").toLowerCase() !== actor.toLowerCase()) {
        return { verified: false, reason: "draft_pr_author_mismatch" };
      }
      if (pr.state !== "open" || pr.draft !== true) {
        return { verified: false, reason: "draft_pr_must_be_open_draft" };
      }
      if (!body.includes(`MCP-Scoreboard-Order: ${order.order_id}`)) {
        return { verified: false, reason: "order_marker_missing" };
      }
      if (phase === "complete" && !body.includes("MCP-Scoreboard-Delivery: complete")) {
        return { verified: false, reason: "completion_marker_missing" };
      }
      return {
        verified: true,
        evidence: {
          author: pr.user.login,
          draft: pr.draft,
          number: pr.number,
          phase
        }
      };
    } catch {
      return { verified: false, reason: "github_verification_unavailable", retryable: true };
    }
  };
}
