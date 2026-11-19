import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = new URL('../open_pr.sh', import.meta.url).pathname;
const BRANCH = 'bot/node-26.13.2';

// Stub gh: logs argv (one line per call). GH_STUB_EXISTS=1 makes the branch probe succeed,
// GH_STUB_FAIL_ON=<text> fails any call whose argv contains it.
const STUB = `#!/usr/bin/env bash
line="$*"
printf '%s\\n' "$line" >> "$GH_STUB_LOG"
if [[ -n "\${GH_STUB_FAIL_ON:-}" && "$line" == *"$GH_STUB_FAIL_ON"* ]]; then exit 1; fi
if [[ "$line" == *"/git/ref/heads/"* ]]; then [[ "\${GH_STUB_EXISTS:-}" == 1 ]]; exit; fi
if [[ "$line" == *"/contents/.node-version?ref="* ]]; then echo filesha; fi
exit 0
`;

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'open_pr-'));
  const log = join(dir, 'gh.log');
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_LOG: log,
      REPO: 'o/r',
      BASE_SHA: 'basesha',
      VERSION: '26.13.2',
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, calls };
}

const writes = (calls: string[]) => calls.filter((c) => /-X (PUT|DELETE)|git\/refs |pr create|workflow run/.test(c));

describe('open_pr.sh', () => {
  it('an existing bump branch skips the run', () => {
    const { status, calls } = run({ GH_STUB_EXISTS: '1' });
    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(writes(calls)).toEqual([]);
  });

  it('a failed bump write deletes the bump branch', () => {
    for (const failOn of ['-X PUT', 'pr create']) {
      const { status, calls } = run({ GH_STUB_FAIL_ON: failOn });
      expect(status).not.toBe(0);
      expect(calls.at(-1)).toContain(`-X DELETE repos/o/r/git/refs/heads/${BRANCH}`);
      expect(calls.some((c) => c.includes('workflow run'))).toBe(false);
    }
  });

  it('a new patch opens a bump PR and starts CI', () => {
    const { status, calls } = run({});
    expect(status).toBe(0);
    const find = (text: string) => calls.find((c) => c.includes(text)) ?? '';
    expect(find('git/refs ')).toContain(`ref=refs/heads/${BRANCH}`);
    expect(find('git/refs ')).toContain('sha=basesha');
    const put = find('-X PUT');
    expect(put).toContain('repos/o/r/contents/.node-version');
    expect(put).toContain(`content=${Buffer.from('26.13.2\n').toString('base64')}`);
    expect(put).toContain('sha=filesha');
    expect(put).toContain(`branch=${BRANCH}`);
    expect(find('pr create')).toContain(`--base trunk --head ${BRANCH}`);
    expect(find('workflow run')).toContain(`ci.yaml --repo o/r --ref ${BRANCH}`);
    expect(calls.some((c) => c.includes('-X DELETE'))).toBe(false);
    // order: ref, PUT, PR, dispatch
    const order = ['git/refs ', '-X PUT', 'pr create', 'workflow run'].map((t) => calls.findIndex((c) => c.includes(t)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('an invalid version is refused before any write', () => {
    for (const version of ['', '26.13', 'v26.13.2', '26.13.2; echo x', '26.13.2\n26.13.3', '../26.13.2']) {
      const { status, calls } = run({ VERSION: version });
      expect(status).not.toBe(0);
      expect(calls).toEqual([]);
    }
  });
});
