import type { CoverageStats, FileKind, GeneratedGroup, KindCoverage, ManifestEntry } from './types';

const GENERATED_DIRS = new Set([
  'generated',
  '__generated__',
  'dist',
  'build',
  'out',
  '.next',
  'vendor',
  'node_modules',
]);
const GENERATED_FILE_RE =
  /(?:\.generated\.[^/]+|\.min\.(?:js|css)|\.map$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|worker-configuration\.d\.ts))$/i;

const TEST_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  '__mocks__',
  '__fixtures__',
  'fixtures',
]);
const TEST_FILE_RE = /\.(?:test|spec)\.[^/]+$/i;

const DOC_DIRS = new Set(['doc', 'docs']);
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const DOC_NAMES = new Set([
  'license',
  'license.md',
  'readme',
  'changelog',
  'contributing',
  'security',
  'authors',
  'notice',
]);

const CONFIG_EXTS = new Set([
  '.json',
  '.jsonc',
  '.toml',
  '.yaml',
  '.yml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.xml',
  '.tf',
  '.tfvars',
  '.tfstate',
  '.hcl',
]);
const CONFIG_DIRS = new Set(['.github', '.vscode', '.devcontainer', 'infra']);
const SRC_DIRS = new Set(['src']);

function hasDirSegment(path: string, dirs: Set<string>): boolean {
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const segment = parts[i];
    if (segment && dirs.has(segment.toLowerCase())) return true;
  }
  return false;
}
const CONFIG_FILE_RE =
  /(?:^|\/)(?:\.[a-z0-9_.-]+|dockerfile|makefile|justfile|procfile|wrangler\.[^/]+|tsconfig\.[^/]+|vitest\.config\.[^/]+|vite\.config\.[^/]+|biome\.json|bunfig\.toml|package\.json)$/i;

const CODE_EXTS = new Set([
  '.astro',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.css',
  '.cts',
  '.ex',
  '.exs',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.lua',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.zig',
]);

export function fileExtension(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot <= slash) return '';
  return path.slice(dot).toLowerCase();
}

export function fileBaseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path.toLowerCase() : path.slice(slash + 1).toLowerCase();
}

export function isTextKind(kind: FileKind): boolean {
  return kind !== 'binary';
}

export function isGeneratedPath(path: string, bytes: number): boolean {
  if (hasDirSegment(path, GENERATED_DIRS)) return true;
  if (GENERATED_FILE_RE.test(path)) return true;
  if (path.endsWith('.d.ts') && bytes >= 64_000) return true;
  return false;
}

export function classifyFile(path: string, bytes: number): FileKind {
  if (isGeneratedPath(path, bytes)) return 'generated';

  const ext = fileExtension(path);
  const base = fileBaseName(path);

  if (hasDirSegment(path, TEST_DIRS) || TEST_FILE_RE.test(path)) {
    if (CODE_EXTS.has(ext) || CONFIG_EXTS.has(ext) || DOC_EXTS.has(ext)) return 'test';
  }

  if (DOC_EXTS.has(ext) || DOC_NAMES.has(base)) return 'doc';
  if (hasDirSegment(path, DOC_DIRS) && !CODE_EXTS.has(ext)) return 'doc';

  if (ext === '.json' && hasDirSegment(path, SRC_DIRS) && !CONFIG_FILE_RE.test(path)) {
    return 'source';
  }

  if (CONFIG_EXTS.has(ext) || hasDirSegment(path, CONFIG_DIRS) || CONFIG_FILE_RE.test(path)) {
    if (CODE_EXTS.has(ext) && !hasDirSegment(path, CONFIG_DIRS) && !CONFIG_FILE_RE.test(path)) {
      return 'source';
    }
    if (ext === '.json' || ext === '.jsonc') return 'config';
    if (CODE_EXTS.has(ext) && CONFIG_FILE_RE.test(path)) return 'config';
    if (CONFIG_EXTS.has(ext) || hasDirSegment(path, CONFIG_DIRS) || CONFIG_FILE_RE.test(path)) {
      return 'config';
    }
  }

  if (CODE_EXTS.has(ext)) return 'source';
  return 'binary';
}

export function summarizeGeneratedGroups(entries: ManifestEntry[]): GeneratedGroup[] {
  const buckets = new Map<string, { count: number; bytes: number }>();
  for (const entry of entries) {
    if (entry.kind !== 'generated') continue;
    const parts = entry.path.split('/');
    let prefix = entry.path;
    const genIndex = parts.findIndex((segment) =>
      /^(?:generated|__generated__|dist|build|out|\.next|vendor)$/i.test(segment),
    );
    if (genIndex >= 0) {
      prefix = `${parts.slice(0, genIndex + 1).join('/')}/`;
    } else if (parts.length > 2) {
      prefix = `${parts.slice(0, 2).join('/')}/`;
    }
    const existing = buckets.get(prefix) ?? { count: 0, bytes: 0 };
    existing.count += 1;
    existing.bytes += entry.bytes;
    buckets.set(prefix, existing);
  }
  return [...buckets.entries()]
    .map(([prefix, stats]) => ({ prefix, count: stats.count, bytes: stats.bytes }))
    .sort((left, right) => right.count - left.count || left.prefix.localeCompare(right.prefix));
}

export function computeCoverage(
  manifest: ManifestEntry[],
  mappedCount: number,
  includedCount: number,
  maxFileBytes: number,
): CoverageStats {
  const byKind: Record<FileKind, KindCoverage> = {
    source: { count: 0, bytes: 0 },
    test: { count: 0, bytes: 0 },
    generated: { count: 0, bytes: 0 },
    config: { count: 0, bytes: 0 },
    doc: { count: 0, bytes: 0 },
    binary: { count: 0, bytes: 0 },
  };
  let oversized = 0;
  for (const entry of manifest) {
    byKind[entry.kind].count += 1;
    byKind[entry.kind].bytes += entry.bytes;
    if (entry.kind !== 'generated' && entry.kind !== 'binary' && entry.bytes > maxFileBytes) {
      oversized += 1;
    }
  }
  const tracked = manifest.length;
  const indexed = manifest.length;
  const generated = byKind.generated.count;
  const excluded = tracked - includedCount;
  return {
    tracked,
    indexed,
    mapped: mappedCount,
    included: includedCount,
    excluded,
    generated,
    oversized,
    silentlyDropped: tracked - indexed,
    byKind,
    generatedGroups: summarizeGeneratedGroups(manifest),
  };
}
