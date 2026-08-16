import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicFitVerifier } from "../src/fit-verifier.mjs";
import { createGithubPrVerifier } from "../src/github-pr-verifier.mjs";

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; }
  };
}

const inquiry = {
  public_repository_url: "https://github.com/octocat/Hello-World",
  npm_package: "hello-mcp",
  scoreboard_url: "https://leaderboard.delx.ai/servers/hello-mcp/"
};

test("public fit requires the live GitHub, npm, and Scoreboard identities to agree", async () => {
  const verifier = createPublicFitVerifier({
    fetchImpl: async (url) => {
      if (url.startsWith("https://api.github.com/")) {
        return response({ full_name: "octocat/Hello-World", private: false, archived: false, disabled: false });
      }
      if (url.startsWith("https://registry.npmjs.org/")) {
        return response({ repository: { url: "git+https://github.com/octocat/Hello-World.git" } });
      }
      return response("scorecard");
    }
  });
  assert.deepEqual(await verifier(inquiry), {
    qualified: true,
    evidence: ["public_github_repository", "npm_repository_match", "scorecard_live"]
  });

  const mismatch = createPublicFitVerifier({
    fetchImpl: async (url) => {
      if (url.startsWith("https://api.github.com/")) {
        return response({ full_name: "octocat/Hello-World", private: false, archived: false, disabled: false });
      }
      if (url.startsWith("https://registry.npmjs.org/")) {
        return response({ repository: { url: "https://github.com/someone/else" } });
      }
      return response("scorecard");
    }
  });
  assert.equal((await mismatch(inquiry)).reason, "npm_repository_mismatch");
});

test("delivery proof requires David's open draft PR, exact repository, order marker, and completion marker", async () => {
  const base = {
    state: "open",
    draft: true,
    number: 42,
    user: { login: "davidmosiah" },
    base: { repo: { full_name: "octocat/Hello-World" } },
    body: "MCP-Scoreboard-Order: order-123\nMCP-Scoreboard-Delivery: complete"
  };
  const verifier = createGithubPrVerifier({ fetchImpl: async () => response(base), actor: "davidmosiah" });
  const order = { order_id: "order-123", public_repository_url: inquiry.public_repository_url };
  assert.equal((await verifier({
    order,
    draftPrUrl: "https://github.com/octocat/Hello-World/pull/42",
    phase: "complete"
  })).verified, true);

  const wrongAuthor = createGithubPrVerifier({
    fetchImpl: async () => response({ ...base, user: { login: "attacker" } }),
    actor: "davidmosiah"
  });
  assert.equal((await wrongAuthor({
    order,
    draftPrUrl: "https://github.com/octocat/Hello-World/pull/42",
    phase: "complete"
  })).reason, "draft_pr_author_mismatch");

  const missingComplete = createGithubPrVerifier({
    fetchImpl: async () => response({ ...base, body: "MCP-Scoreboard-Order: order-123" }),
    actor: "davidmosiah"
  });
  assert.equal((await missingComplete({
    order,
    draftPrUrl: "https://github.com/octocat/Hello-World/pull/42",
    phase: "complete"
  })).reason, "completion_marker_missing");
});
