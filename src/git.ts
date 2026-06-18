import { resolve } from 'node:path';
import type { SourceFile } from './types';

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.ex',
  '.exs',
  '.go',
  '.h',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
  '.zig',
]);

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

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
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

export async function readCommitFiles(
  directory: string,
  commit: string,
  maxBytes: number,
): Promise<SourceFile[]> {
  const listing = await git(directory, ['ls-tree', '-r', '-l', commit]);
  const candidates = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/);
      return match ? { oid: match[1], bytes: Number(match[2]), path: match[3] } : null;
    })
    .filter((entry): entry is { oid: string; bytes: number; path: string } => Boolean(entry))
    .filter((entry) => TEXT_EXTENSIONS.has(extension(entry.path)))
    .filter((entry) => entry.bytes <= 128_000)
    .sort((a, b) => a.path.localeCompare(b.path));

  const files: SourceFile[] = [];
  let used = 0;
  for (const entry of candidates) {
    if (used + entry.bytes > maxBytes) continue;
    const content = await git(directory, ['show', `${commit}:${entry.path}`]);
    files.push({ ...entry, content });
    used += entry.bytes;
  }
  return files;
}
