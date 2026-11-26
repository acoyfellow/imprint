import { diffCommitPaths, grepCommitPaths, readManifestEntries, resolveCommit } from './git';
import type {
  FileKind,
  FileMapEntry,
  ImprintRelease,
  ImprintSlice,
  ManifestEntry,
  OmittedEntry,
  SliceResult,
  SourceFile,
} from './types';

const encoder = new TextEncoder();

const KIND_RANK: Record<FileKind, number> = {
  source: 0,
  config: 1,
  doc: 2,
  test: 3,
  generated: 4,
  binary: 5,
};

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isSliceEmpty(slice?: ImprintSlice): boolean {
  if (!slice) return true;
  return !(
    slice.paths?.length ||
    slice.symbols?.length ||
    slice.grep ||
    (Array.isArray(slice.depsOf) ? slice.depsOf.length > 0 : Boolean(slice.depsOf)) ||
    slice.changed ||
    slice.kinds?.length ||
    slice.includeGenerated ||
    slice.maxBytes !== undefined ||
    slice.maxTokens !== undefined
  );
}

export async function computeSliceKey(slice?: ImprintSlice): Promise<string> {
  if (isSliceEmpty(slice)) return 'full';
  const normalized = {
    paths: slice?.paths ?? [],
    symbols: slice?.symbols ?? [],
    grep: slice?.grep ?? '',
    grepRegex: Boolean(slice?.grepRegex),
    depsOf: Array.isArray(slice?.depsOf) ? slice.depsOf : slice?.depsOf ? [slice.depsOf] : [],
    depth: slice?.depth ?? 2,
    direction: slice?.direction ?? 'deps',
    changed: slice?.changed ?? '',
    kinds: slice?.kinds ?? [],
    includeGenerated: Boolean(slice?.includeGenerated),
    maxBytes: slice?.maxBytes ?? null,
    maxTokens: slice?.maxTokens ?? null,
  };
  return (await sha256(JSON.stringify(normalized))).slice(0, 16);
}

function isGlobPattern(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function matchPathPatterns(patterns: string[], manifest: ManifestEntry[]): Map<string, number> {
  const matched = new Map<string, number>();
  const pathSet = new Set(manifest.map((entry) => entry.path));
  for (const pattern of patterns) {
    if (pathSet.has(pattern)) {
      matched.set(pattern, 0);
      continue;
    }
    const glob = new Bun.Glob(pattern);
    for (const entry of manifest) {
      if (glob.match(entry.path) && !matched.has(entry.path)) {
        matched.set(entry.path, 0);
      }
    }
  }
  return matched;
}

function matchSymbols(symbolQueries: string[], mapFiles: FileMapEntry[]): Map<string, number> {
  const matched = new Map<string, number>();
  for (const query of symbolQueries) {
    const glob = isGlobPattern(query) ? new Bun.Glob(query) : null;
    for (const file of mapFiles) {
      for (const symbol of file.symbols) {
        const hit = glob ? glob.match(symbol.name) : symbol.name === query;
        if (!hit) continue;
        const score = symbol.exported ? 0 : 1;
        const current = matched.get(file.path);
        if (current === undefined || score < current) {
          matched.set(file.path, score);
        }
      }
    }
  }
  return matched;
}

function buildGraph(mapFiles: FileMapEntry[]): {
  forward: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
} {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const file of mapFiles) {
    const deps = forward.get(file.path) ?? new Set<string>();
    for (const edge of file.imports) {
      if (!edge.resolved || edge.resolved === file.path) continue;
      deps.add(edge.resolved);
      const rev = reverse.get(edge.resolved) ?? new Set<string>();
      rev.add(file.path);
      reverse.set(edge.resolved, rev);
    }
    forward.set(file.path, deps);
  }
  return { forward, reverse };
}

function traverseDeps(
  targets: string[],
  depth: number,
  direction: 'deps' | 'dependents' | 'both',
  manifest: ManifestEntry[],
  mapFiles: FileMapEntry[],
): Map<string, number> {
  const seeds = new Set<string>();
  const pathMatches = matchPathPatterns(targets, manifest);
  for (const path of pathMatches.keys()) seeds.add(path);

  const unresolvedTargets = targets.filter(
    (target) => !manifest.some((entry) => entry.path === target) && !isGlobPattern(target),
  );
  if (unresolvedTargets.length) {
    const symMatches = matchSymbols(unresolvedTargets, mapFiles);
    for (const path of symMatches.keys()) seeds.add(path);
  }

  const visited = new Map<string, number>();
  const queue: Array<{ path: string; dist: number }> = [];
  for (const seed of [...seeds].sort((a, b) => a.localeCompare(b))) {
    visited.set(seed, 0);
    queue.push({ path: seed, dist: 0 });
  }

  const { forward, reverse } = buildGraph(mapFiles);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (!current || current.dist >= depth) continue;

    const neighbors = new Set<string>();
    if (direction === 'deps' || direction === 'both') {
      for (const next of forward.get(current.path) ?? []) neighbors.add(next);
    }
    if (direction === 'dependents' || direction === 'both') {
      for (const next of reverse.get(current.path) ?? []) neighbors.add(next);
    }

    for (const next of [...neighbors].sort((a, b) => a.localeCompare(b))) {
      if (visited.has(next)) continue;
      visited.set(next, current.dist + 1);
      queue.push({ path: next, dist: current.dist + 1 });
    }
  }
  return visited;
}

export function formatSliceText(
  commit: string,
  files: SourceFile[],
  omitted: OmittedEntry[],
  budgetBytes: number,
  usedBytes: number,
): string {
  const header = [
    `# Imprint Slice @ ${commit.slice(0, 12)} (${files.length} files, ${usedBytes}/${budgetBytes} bytes${omitted.length ? `, ${omitted.length} omitted` : ''})`,
  ];
  if (omitted.length) {
    const summary = omitted
      .slice(0, 10)
      .map((item) => `${item.path} (${item.reason}, ${item.bytes}B)`)
      .join(', ');
    header.push(
      `Omitted: ${summary}${omitted.length > 10 ? `, +${omitted.length - 10} more` : ''}`,
    );
  }
  const body = files
    .map((file) => `\n--- ${file.path} @ ${file.oid} ---\n${file.content}`)
    .join('\n');
  return `${header.join('\n')}\n${body}`;
}

export async function executeSlice(input: {
  directory: string;
  release: ImprintRelease;
  slice: ImprintSlice;
  defaultMaxBytes: number;
  maxFileBytes: number;
}): Promise<SliceResult> {
  const { directory, release, slice, defaultMaxBytes, maxFileBytes } = input;
  const manifestByPath = new Map(release.manifest.map((entry) => [entry.path, entry]));
  const explicitPaths = new Set((slice.paths ?? []).filter((p) => !isGlobPattern(p)));
  const allowGenerated =
    Boolean(slice.includeGenerated) ||
    Boolean(slice.kinds?.includes('generated')) ||
    [...explicitPaths].some((p) => manifestByPath.get(p)?.kind === 'generated');

  const pathMatches = slice.paths?.length ? matchPathPatterns(slice.paths, release.manifest) : null;
  const symbolMatches = slice.symbols?.length
    ? matchSymbols(slice.symbols, release.map.files)
    : null;

  let grepMatches: Map<string, number> | null = null;
  if (slice.grep) {
    const hits = await grepCommitPaths(
      directory,
      release.commit,
      slice.grep,
      slice.grepRegex !== undefined ? { regex: slice.grepRegex } : undefined,
    );
    grepMatches = new Map<string, number>();
    for (const path of hits) {
      if (manifestByPath.has(path)) grepMatches.set(path, 0);
    }
  }

  let depsMatches: Map<string, number> | null = null;
  const depsTargets = Array.isArray(slice.depsOf)
    ? slice.depsOf.filter(Boolean)
    : slice.depsOf
      ? [slice.depsOf]
      : [];
  if (depsTargets.length) {
    depsMatches = traverseDeps(
      depsTargets,
      slice.depth ?? 2,
      slice.direction ?? 'deps',
      release.manifest,
      release.map.files,
    );
  }

  let changedMatches: Map<string, number> | null = null;
  if (slice.changed) {
    const baseCommit = await resolveCommit(directory, slice.changed);
    const changedPaths = await diffCommitPaths(directory, baseCommit, release.commit);
    changedMatches = new Map<string, number>();
    for (const path of changedPaths) {
      if (manifestByPath.has(path)) changedMatches.set(path, 0);
    }
  }

  const activeSelectors = [
    pathMatches,
    symbolMatches,
    grepMatches,
    depsMatches,
    changedMatches,
  ].filter((map): map is Map<string, number> => map !== null);

  const scores = new Map<string, number>();
  if (!activeSelectors.length) {
    for (const entry of release.manifest) {
      scores.set(entry.path, 0);
    }
  } else if (pathMatches && !symbolMatches && !depsMatches && (grepMatches || changedMatches)) {
    for (const [path, score] of pathMatches) {
      const okGrep = !grepMatches || grepMatches.has(path);
      const okChanged = !changedMatches || changedMatches.has(path);
      if (okGrep && okChanged) scores.set(path, score);
    }
  } else {
    for (const selector of activeSelectors) {
      for (const [path, score] of selector) {
        const current = scores.get(path);
        if (current === undefined || score < current) {
          scores.set(path, score);
        }
      }
    }
  }

  const allowedKinds = slice.kinds?.length ? new Set<FileKind>(slice.kinds) : null;
  const candidates: Array<{ entry: ManifestEntry; score: number }> = [];
  const omitted: OmittedEntry[] = [];

  for (const [path, score] of scores) {
    const entry = manifestByPath.get(path);
    if (!entry) continue;
    if (allowedKinds && !allowedKinds.has(entry.kind)) continue;
    if (entry.kind === 'binary') {
      omitted.push({ path: entry.path, bytes: entry.bytes, reason: 'binary' });
      continue;
    }
    if (entry.kind === 'generated' && !allowGenerated && !explicitPaths.has(entry.path)) {
      omitted.push({ path: entry.path, bytes: entry.bytes, reason: 'generated' });
      continue;
    }
    candidates.push({ entry, score });
  }

  candidates.sort(
    (left, right) =>
      left.score - right.score ||
      KIND_RANK[left.entry.kind] - KIND_RANK[right.entry.kind] ||
      left.entry.path.localeCompare(right.entry.path),
  );

  const budgetBytes =
    slice.maxBytes ?? (slice.maxTokens !== undefined ? slice.maxTokens * 4 : defaultMaxBytes);
  let usedBytes = 0;
  const includedEntries: ManifestEntry[] = [];

  for (const { entry } of candidates) {
    if (entry.bytes > maxFileBytes && !explicitPaths.has(entry.path)) {
      omitted.push({ path: entry.path, bytes: entry.bytes, reason: 'oversized' });
      continue;
    }
    if (usedBytes + entry.bytes > budgetBytes) {
      omitted.push({ path: entry.path, bytes: entry.bytes, reason: 'budget' });
      continue;
    }
    includedEntries.push(entry);
    usedBytes += entry.bytes;
  }

  if (!includedEntries.length) {
    throw new Error(`commit ${release.commit} slice matched no source files`);
  }

  const files = await readManifestEntries(directory, includedEntries);
  const key = await computeSliceKey(slice);
  const text = formatSliceText(release.commit, files, omitted, budgetBytes, usedBytes);
  const digest = await sha256(
    JSON.stringify({
      commit: release.commit,
      sliceKey: key,
      files: includedEntries.map(({ path, oid, bytes }) => ({ path, oid, bytes })),
      omitted,
    }),
  );

  return {
    commit: release.commit,
    sliceKey: key,
    slice,
    files,
    digest,
    text,
    truncation: {
      truncated: omitted.length > 0,
      budgetBytes,
      usedBytes,
      matchedFiles:
        candidates.length +
        omitted.filter((item) => item.reason === 'generated' || item.reason === 'binary').length,
      includedFiles: files.length,
      omitted,
    },
  };
}
