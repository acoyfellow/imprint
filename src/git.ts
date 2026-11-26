import { resolve } from 'node:path';
import { classifyFile } from './classify';
import type { ManifestEntry, SourceFile } from './types';

const decoder = new TextDecoder('utf-8', { fatal: false });

async function git(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `git ${args[0]} failed`);
  return stdout;
}

export async function resolveCommit(directory: string, ref: string): Promise<string> {
  return (await git(directory, ['rev-parse', `${ref}^{commit}`])).trim();
}

export async function repositoryIdentity(directory: string): Promise<string> {
  const remote = await git(directory, ['remote', 'get-url', 'origin']).catch(() => '');
  return remote.trim() || resolve(directory);
}

export async function commitParents(directory: string, commit: string): Promise<string[]> {
  const line = (await git(directory, ['show', '-s', '--format=%P', commit])).trim();
  return line ? line.split(' ') : [];
}

export async function listCommitBlobs(directory: string, commit: string): Promise<ManifestEntry[]> {
  const listing = await git(directory, ['ls-tree', '-r', '-l', '-z', commit]);
  const entries: ManifestEntry[] = [];
  for (const record of listing.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const header = record.slice(0, tab);
    const path = record.slice(tab + 1);
    const parts = header.trim().split(/\s+/);
    if (parts.length < 4 || parts[1] !== 'blob') continue;
    const oid = parts[2];
    const bytes = Number(parts[3]);
    if (!oid || !Number.isFinite(bytes)) continue;
    entries.push({ path, oid, bytes, kind: classifyFile(path, bytes) });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export async function readBlobsByOid(
  directory: string,
  oids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(oids)];
  const result = new Map<string, string>();
  if (!unique.length) return result;

  const input = `${unique.join('\n')}\n`;
  const proc = Bun.spawn(['git', 'cat-file', '--batch'], {
    cwd: directory,
    stdin: new Response(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [rawBuffer, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || 'git cat-file --batch failed');

  const bytes = new Uint8Array(rawBuffer);
  let offset = 0;
  for (const requestedOid of unique) {
    if (offset >= bytes.length) break;
    let lineEnd = offset;
    while (lineEnd < bytes.length && bytes[lineEnd] !== 0x0a) lineEnd += 1;
    const header = decoder.decode(bytes.subarray(offset, lineEnd));
    offset = lineEnd + 1;
    if (header.endsWith(' missing')) continue;
    const parts = header.split(' ');
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0) continue;
    const contentBytes = bytes.subarray(offset, offset + size);
    result.set(requestedOid, decoder.decode(contentBytes));
    offset += size + 1;
  }
  return result;
}

export async function readManifestEntries(
  directory: string,
  entries: ManifestEntry[],
): Promise<SourceFile[]> {
  const blobs = await readBlobsByOid(
    directory,
    entries.map((entry) => entry.oid),
  );
  const files: SourceFile[] = [];
  for (const entry of entries) {
    const content = blobs.get(entry.oid);
    if (content === undefined) continue;
    files.push({
      path: entry.path,
      oid: entry.oid,
      bytes: entry.bytes,
      kind: entry.kind,
      content,
    });
  }
  return files;
}

function toPosixEre(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === 's') {
        out += inClass ? '[:space:]' : '[[:space:]]';
        i += 1;
        continue;
      }
      if (next === 'S' && !inClass) {
        out += '[^[:space:]]';
        i += 1;
        continue;
      }
      if (next === 'd') {
        out += inClass ? '0-9' : '[0-9]';
        i += 1;
        continue;
      }
      if (next === 'D' && !inClass) {
        out += '[^0-9]';
        i += 1;
        continue;
      }
      if (next === 'w') {
        out += inClass ? '[:alnum:]_' : '[[:alnum:]_]';
        i += 1;
        continue;
      }
      if (next === 'W' && !inClass) {
        out += '[^[:alnum:]_]';
        i += 1;
        continue;
      }
      out += ch + next;
      i += 1;
      continue;
    }
    if (ch === '[' && !inClass) inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    out += ch;
  }
  return out;
}

export async function grepCommitPaths(
  directory: string,
  commit: string,
  pattern: string,
  options: { regex?: boolean } = {},
): Promise<string[]> {
  const flags = options.regex ? ['-l', '-E'] : ['-l', '-F'];
  const effectivePattern = options.regex ? toPosixEre(pattern) : pattern;
  const stdout = await git(directory, ['grep', ...flags, '--', effectivePattern, commit]).catch(
    () => '',
  );
  return [
    ...new Set(
      stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.replace(/^[^:]+:/, '')),
    ),
  ];
}

export async function diffCommitPaths(
  directory: string,
  fromCommit: string,
  toCommit: string,
): Promise<string[]> {
  const stdout = await git(directory, [
    'diff',
    '--name-only',
    '--diff-filter=ACMRT',
    fromCommit,
    toCommit,
  ]);
  return [...new Set(stdout.split('\n').filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function readCommitFiles(
  directory: string,
  commit: string,
  maxBytes: number,
  onlyPaths?: string[],
): Promise<SourceFile[]> {
  const manifest = await listCommitBlobs(directory, commit);
  const allow = onlyPaths ? new Set(onlyPaths) : null;
  const candidates = manifest
    .filter((entry) => !allow || allow.has(entry.path))
    .filter((entry) => entry.kind !== 'binary' && (allow ? true : entry.kind !== 'generated'));
  let used = 0;
  const selected: ManifestEntry[] = [];
  for (const entry of candidates) {
    if (used + entry.bytes > maxBytes) continue;
    selected.push(entry);
    used += entry.bytes;
  }
  return readManifestEntries(directory, selected);
}
