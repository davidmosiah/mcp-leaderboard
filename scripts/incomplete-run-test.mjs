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
const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-leaderboard-incomplete-test-'));
const fakeBin = join(fixtureRoot, 'node_modules/.bin/mcp-scorecard');
const leaderboardPath = join(fixtureRoot, 'data/leaderboard.json');
const sentinel = '{"sentinel":"must survive"}\n';

try {
  mkdirSync(dirname(fakeBin), { recursive: true });
  mkdirSync(dirname(leaderboardPath), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'data/corpus.json'),
    JSON.stringify([
      { name: 'one', npm: 'fixture-one', repo: null },
      { name: 'two', npm: 'fixture-two', repo: null }
    ])
  );
  writeFileSync(leaderboardPath, sentinel);
  writeFileSync(
    fakeBin,
    `#!/bin/sh
sleep 0.05
printf '%s\n' '{"totalScore":100,"target":{"serverName":"fixture"},"checks":[]}'
`
  );
  chmodSync(fakeBin, 0o755);

  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/run-leaderboard.mjs')],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, CONCURRENCY: '1', RUN_BUDGET_MS: '10' }
    }
  );

  assert.notEqual(result.status, 0, 'incomplete run must fail');
  assert.match(result.stderr, /incomplete run/i);
  assert.equal(readFileSync(leaderboardPath, 'utf8'), sentinel);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('incomplete run gate: ok');
