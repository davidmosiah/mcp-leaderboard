import { BOARD_HOST, SECRET_KEY } from "./constants.mjs";

const REPO = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]+\/?$/;
const NPM = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function scoreboardAllowed(url, npmPackage) {
  if (typeof url !== "string" || !url.startsWith(`${BOARD_HOST}/servers/`)) return false;
  const rest = url.slice(`${BOARD_HOST}/servers/`.length).replace(/\/+$/, "");
  const decoded = decodeURIComponent(rest);
  return decoded === npmPackage || rest === npmPackage;
}

export function validateInquiry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_body" };
  }
  for (const key of Object.keys(body)) {
    if (SECRET_KEY.test(key)) return { error: "secrets_not_accepted" };
  }
  const allowed = ["public_repository_url", "npm_package", "scoreboard_url", "reply_email"];
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) return { error: "unexpected_fields" };
  if (body.visibility === "private") return { error: "private_repos_not_accepted" };

  const repo = String(body.public_repository_url || "");
  if (/[?#]|@|token=|\.git$/i.test(repo) || !REPO.test(repo)) {
    return { error: "public_repository_url_invalid" };
  }
  const npmPackage = String(body.npm_package || "");
  if (!NPM.test(npmPackage)) return { error: "npm_package_invalid" };
  if (!scoreboardAllowed(String(body.scoreboard_url || ""), npmPackage)) {
    return { error: "scoreboard_url_invalid" };
  }
  const email = String(body.reply_email || "");
  if (!EMAIL.test(email)) return { error: "reply_email_invalid" };
  return {
    value: {
      public_repository_url: repo.replace(/\/+$/, ""),
      npm_package: npmPackage,
      scoreboard_url: String(body.scoreboard_url),
      reply_email: email
    }
  };
}

export function publicGithubPr(url) {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9._-]+\/pull\/\d+\/?$/.test(String(url || ""));
}

export function githubOwnerRepo(url) {
  const match = String(url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  const owner = match[1].toLowerCase();
  const repo = match[2].replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

export function draftPrMatchesRepo(draftPrUrl, publicRepositoryUrl) {
  const draft = githubOwnerRepo(draftPrUrl);
  const purchased = githubOwnerRepo(publicRepositoryUrl);
  return Boolean(draft && purchased && draft === purchased);
}
