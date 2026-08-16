import { githubOwnerRepo } from "./validation.mjs";

const TIMEOUT_MS = 8_000;

function repositoryFromNpm(value) {
  const raw = typeof value === "string" ? value : value?.url;
  if (!raw) return null;
  return githubOwnerRepo(
    String(raw)
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^git@github\.com:/, "https://github.com/")
  );
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "mcp-scoreboard-pay" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) return { error: `http_${response.status}` };
  return { value: await response.json() };
}

export function createPublicFitVerifier({ fetchImpl = fetch } = {}) {
  return async function verifyPublicFit(inquiry) {
    const expectedRepo = githubOwnerRepo(inquiry.public_repository_url);
    if (!expectedRepo) return { qualified: false, reason: "repository_invalid" };

    try {
      const [github, npm, scorecard] = await Promise.all([
        fetchJson(fetchImpl, `https://api.github.com/repos/${expectedRepo}`),
        fetchJson(fetchImpl, `https://registry.npmjs.org/${encodeURIComponent(inquiry.npm_package)}/latest`),
        fetchImpl(inquiry.scoreboard_url, {
          method: "GET",
          headers: { accept: "text/html", "user-agent": "mcp-scoreboard-pay" },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      ]);
      if (github.error || github.value?.private || github.value?.archived || github.value?.disabled) {
        return { qualified: false, reason: "public_repository_unavailable" };
      }
      if (String(github.value?.full_name || "").toLowerCase() !== expectedRepo) {
        return { qualified: false, reason: "repository_identity_mismatch" };
      }
      if (npm.error) return { qualified: false, reason: "npm_package_unavailable" };
      if (repositoryFromNpm(npm.value?.repository) !== expectedRepo) {
        return { qualified: false, reason: "npm_repository_mismatch" };
      }
      if (!scorecard.ok) return { qualified: false, reason: "scorecard_unavailable" };
      return {
        qualified: true,
        evidence: ["public_github_repository", "npm_repository_match", "scorecard_live"]
      };
    } catch {
      return { qualified: false, reason: "fit_verification_unavailable", retryable: true };
    }
  };
}
