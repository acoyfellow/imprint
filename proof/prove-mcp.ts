import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Imprint } from '../src/imprint';

const targetDir = resolve(process.argv[2] ?? '/Users/jcoeyman/cloudflare/.tmp-mcp');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MCP proof failed: ${message}`);
}

const t0 = performance.now();
const imprint = new Imprint({ directory: targetDir });
const release = await imprint.imprint('HEAD');
const imprintMs = Math.round(performance.now() - t0);

const releaseFilePath = join(targetDir, '.imprint', 'releases', `${release.commit}.json`);
const releaseFileBytes = (await stat(releaseFilePath)).size;
const releaseRaw = await readFile(releaseFilePath, 'utf8');

const realSrcEntries = release.manifest.filter(
  (entry) => entry.path.startsWith('src/') && !entry.path.startsWith('src/generated/'),
);
const realSrcMapped = release.map.files.filter(
  (entry) => entry.path.startsWith('src/') && !entry.path.startsWith('src/generated/'),
);
const nonJsonRealSrc = realSrcEntries.filter((entry) => entry.kind === 'source');

assert(release.proof.verified === true, 'release.proof.verified must be true');
assert(release.coverage.tracked === 2304, `expected 2304 tracked, got ${release.coverage.tracked}`);
assert(
  release.coverage.indexed === release.coverage.tracked,
  `indexed ${release.coverage.indexed} !== tracked ${release.coverage.tracked}`,
);
assert(
  release.coverage.silentlyDropped === 0,
  `silentlyDropped must be 0, got ${release.coverage.silentlyDropped}`,
);
assert(
  release.coverage.generated >= 2148,
  `expected >= 2148 generated files, got ${release.coverage.generated}`,
);
assert(
  realSrcMapped.length === nonJsonRealSrc.length,
  `expected all ${nonJsonRealSrc.length} real src code files mapped, got ${realSrcMapped.length}`,
);
assert(
  realSrcMapped.length === 60 && realSrcMapped.length === realSrcEntries.length,
  `expected all 60/60 real src/ files mapped, got ${realSrcMapped.length}/${realSrcEntries.length}`,
);
assert(
  release.map.stats.textBytes < 60_000,
  `expected map text < 60KB, got ${release.map.stats.textBytes}B`,
);
assert(
  !releaseRaw.includes('OPENAI_APPS_CHALLENGE_TOKEN') &&
    !releaseRaw.includes('dQ0VUqjILNASTqFl73Rc8kt2ttMpEMmpqEZWsRhlpfc') &&
    !releaseRaw.includes('"content":') &&
    release.files.every((entry) => !('content' in entry)) &&
    release.manifest.every((entry) => !('content' in entry)),
  'release JSON must not embed raw source file contents',
);

const repo = await imprint.open(release.commit);

const symbolSlice = await repo.slice({ symbols: ['GlobalOutbound', 'oauthMcpHandler'] });
const symbolPaths = symbolSlice.files.map((file) => file.path);
assert(symbolPaths.includes('src/index.ts'), 'symbol slice missing src/index.ts');
assert(symbolPaths.includes('src/tools/execute.ts'), 'symbol slice missing src/tools/execute.ts');
assert(symbolPaths.includes('src/mcp-handler.ts'), 'symbol slice missing src/mcp-handler.ts');

const depsSlice = await repo.slice({ depsOf: 'src/index.ts', depth: 2 });
const depPaths = depsSlice.files.map((file) => file.path);
assert(depPaths.includes('src/index.ts'), 'depsOf missing root src/index.ts');
assert(depPaths.includes('src/mcp-handler.ts'), 'depsOf missing src/mcp-handler.ts');
assert(depPaths.includes('src/tools/execute.ts'), 'depsOf missing src/tools/execute.ts');
assert(depPaths.includes('src/auth/oauth-handler.ts'), 'depsOf missing src/auth/oauth-handler.ts');
assert(depPaths.includes('src/skills/sync.ts'), 'depsOf missing src/skills/sync.ts');

const globSlice = await repo.slice({ paths: ['src/tools/*.ts'] });
assert(
  globSlice.files.length >= 10,
  `expected >= 10 src/tools/*.ts files, got ${globSlice.files.length}`,
);

const regexSlice = await repo.slice({ grep: 'export\\s+class\\s+GlobalOutbound', grepRegex: true });
assert(
  regexSlice.files.map((file) => file.path).includes('src/tools/execute.ts'),
  'regex grep slice missing src/tools/execute.ts',
);

const budgetedSlice = await repo.slice({ paths: ['src/tools/*.ts'], maxBytes: 8_000 });
assert(budgetedSlice.truncation.truncated === true, 'budgeted slice must report truncation');
assert(
  budgetedSlice.truncation.usedBytes <= 8_000,
  `budgeted slice exceeded 8000B: ${budgetedSlice.truncation.usedBytes}`,
);
assert(
  budgetedSlice.truncation.omitted.some((item) => item.reason === 'budget'),
  'budgeted slice must report budget-omitted files',
);

let changedCount = 0;
if (release.parents.length > 0) {
  const changedSlice = await repo.slice({ changed: release.parents[0] });
  changedCount = changedSlice.files.length;
  assert(changedCount > 0, 'changed slice against parent commit should match at least 1 file');
}

const receipt = {
  target: targetDir,
  commit: release.commit,
  imprintMs,
  releaseFileBytes,
  mapTextBytes: release.map.stats.textBytes,
  mapStats: release.map.stats,
  coverage: release.coverage,
  realSrcTotal: realSrcEntries.length,
  realSrcCodeMapped: realSrcMapped.length,
  proofVerified: release.proof.verified,
  checks: release.proof.checks,
  slices: {
    symbols: symbolPaths,
    depsOfIndexDepth2Count: depPaths.length,
    toolsGlobCount: globSlice.files.length,
    regexMatch: regexSlice.files.map((file) => file.path),
    budgeted: {
      included: budgetedSlice.truncation.includedFiles,
      omitted: budgetedSlice.truncation.omitted.length,
      usedBytes: budgetedSlice.truncation.usedBytes,
    },
    changedVsParentCount: changedCount,
  },
};

console.log(JSON.stringify(receipt, null, 2));
