import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-leaderboard-infra-test-'));
const fakeBin = join(fixtureRoot, 'node_modules/.bin/mcp-scorecard');
const leaderboardPath = join(fixtureRoot, 'data/leaderboard.json');
const sentinel = '{"sentinel":"must survive"}\n';

try {
  mkdirSync(dirname(fakeBin), { recursive: true });
  mkdirSync(dirname(leaderboardPath), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'data/corpus.json'),
    JSON.stringify([{ name: 'fixture', npm: 'fixture-mcp', repo: null }])
  );
  writeFileSync(leaderboardPath, sentinel);
  writeFileSync(fakeBin, '#!/bin/sh\necho "ENOSPC: no space left on device" >&2\nexit 1\n');
  chmodSync(fakeBin, 0o755);

  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/run-leaderboard.mjs')],
    { cwd: fixtureRoot, encoding: 'utf8', timeout: 15_000 }
  );

  assert.notEqual(result.status, 0, 'infrastructure failure must fail the run');
  assert.match(result.stderr, /infrastructure failure/i);
  assert.equal(readFileSync(leaderboardPath, 'utf8'), sentinel);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('infrastructure failure gate: ok');
