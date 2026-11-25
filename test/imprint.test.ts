import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Imprint } from '../src/imprint';

const directories: string[] = [];

async function git(directory: string, ...args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if ((await child.exited) !== 0) throw new Error(await new Response(child.stderr).text());
  return (await new Response(child.stdout).text()).trim();
}

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'imprint-test-'));
  directories.push(directory);
  await git(directory, 'init', '-q', '-b', 'main');
  await git(directory, 'config', 'core.hooksPath', '/dev/null');
  await git(directory, 'config', 'user.email', 'test@imprint.local');
  await git(directory, 'config', 'user.name', 'Imprint Test');
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('Imprint', () => {
  test('binds a release to exact commit content and writes lean JSON without raw file blobs', async () => {
    const directory = await repository();
    await writeFile(join(directory, 'api.ts'), 'export const oldApi = "SECRET_BODY_OLD";\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'old');
    const oldCommit = await git(directory, 'rev-parse', 'HEAD');
    await writeFile(join(directory, 'api.ts'), 'export const newApi = "SECRET_BODY_NEW";\n');
    await git(directory, 'add', 'api.ts');
    await git(directory, 'commit', '--no-verify', '-qm', 'new');
    const newCommit = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    const oldRelease = await imprint.imprint(oldCommit);
    const newRelease = await imprint.imprint(newCommit);

    expect(oldRelease.adapter.text).toContain('oldApi');
    expect(oldRelease.adapter.text).not.toContain('newApi');
    expect(newRelease.adapter.text).toContain('newApi');
    expect(oldRelease.sourceDigest).not.toBe(newRelease.sourceDigest);

    const persistedRaw = await readFile(
      join(directory, '.imprint', 'releases', `${oldCommit}.json`),
      'utf8',
    );
    expect(persistedRaw).not.toContain('SECRET_BODY_OLD');

    const reopened = await imprint.open(oldCommit);
    const loaded = await reopened.readFile('api.ts');
    expect(loaded.content).toContain('SECRET_BODY_OLD');
  }, 20_000);

  test('promotes and rolls back the complete release pointer', async () => {
    const directory = await repository();
    await writeFile(join(directory, 'api.ts'), 'export const version = 1;\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'one');
    const one = await git(directory, 'rev-parse', 'HEAD');
    await writeFile(join(directory, 'api.ts'), 'export const version = 2;\n');
    await git(directory, 'add', 'api.ts');
    await git(directory, 'commit', '--no-verify', '-qm', 'two');
    const two = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    await imprint.imprint(one);
    await imprint.imprint(two);
    await imprint.promote(two);
    expect((await imprint.open()).release.commit).toBe(two);
    await imprint.rollback(one);
    expect((await imprint.open()).release.commit).toBe(one);
  }, 20_000);

  test('refuses a commit that carries the broken marker even past 400KB of generated files', async () => {
    const directory = await repository();
    await mkdir(join(directory, 'src', 'generated'), { recursive: true });
    for (let i = 0; i < 6; i += 1) {
      await writeFile(
        join(directory, 'src', 'generated', `gen_${i}.ts`),
        `export const pad${i} = "${'a'.repeat(90_000)}";\n`,
      );
    }
    await writeFile(join(directory, 'src', 'zzz-entry.ts'), 'export const ok = true;\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'good');
    const good = await git(directory, 'rev-parse', 'HEAD');

    await writeFile(
      join(directory, 'src', 'zzz-entry.ts'),
      'export const ok = "IMPRINT_BROKEN";\n',
    );
    await git(directory, 'add', 'src/zzz-entry.ts');
    await git(directory, 'commit', '--no-verify', '-qm', 'bad');
    const bad = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    const goodRelease = await imprint.imprint(good);
    const badRelease = await imprint.imprint(bad);
    expect(goodRelease.coverage.tracked).toBe(7);
    expect(goodRelease.coverage.indexed).toBe(7);
    expect(goodRelease.coverage.silentlyDropped).toBe(0);
    expect(goodRelease.coverage.generated).toBe(6);
    expect(goodRelease.proof.verified).toBe(true);
    expect(badRelease.proof.verified).toBe(false);
    await expect(imprint.promote(bad)).rejects.toThrow('did not verify');
    await imprint.promote(good);
    expect((await imprint.open()).release.commit).toBe(good);
  }, 20_000);

  test('grep slice binds only matching files and a distinct digest', async () => {
    const directory = await repository();
    await writeFile(join(directory, 'aaa.ts'), 'export const early = true;\n');
    await writeFile(join(directory, 'zzz.ts'), 'export const plant = "SLICE_ONLY";\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'both');
    const commit = await git(directory, 'rev-parse', 'HEAD');
    const imprint = new Imprint({ directory, maxSourceBytes: 400_000 });
    const full = await imprint.imprint(commit);
    const slice = await imprint.open(commit, { grep: 'SLICE_ONLY' });
    expect(full.files.map((file) => file.path)).toContain('aaa.ts');
    expect(slice.release.files.map((file) => file.path)).toEqual(['zzz.ts']);
    expect(slice.release.sourceDigest).not.toBe(full.sourceDigest);
    await expect(imprint.open(commit, { grep: 'NO_SUCH_PLANT' })).rejects.toThrow(
      'slice matched no source files',
    );
  }, 20_000);

  test('supports symbols, depsOf graph traversal, globs, regex grep, changed, and budget truncation', async () => {
    const directory = await repository();
    await mkdir(join(directory, 'src', 'core'), { recursive: true });
    await mkdir(join(directory, 'src', 'tools'), { recursive: true });
    await mkdir(join(directory, 'tests'), { recursive: true });

    await writeFile(
      join(directory, 'src', 'core', 'leaf.ts'),
      'export function computeLeaf(n: number) { return n * 2; }\n',
    );
    await writeFile(
      join(directory, 'src', 'core', 'mid.ts'),
      'import { computeLeaf } from "./leaf";\nexport function runMid(n: number) { return computeLeaf(n) + 1; }\n',
    );
    await writeFile(
      join(directory, 'src', 'tools', 'exec.ts'),
      'import { runMid } from "../core/mid";\nexport class ExecTool { run() { return runMid(5); } }\n',
    );
    await writeFile(
      join(directory, 'src', 'index.ts'),
      'export { ExecTool } from "./tools/exec";\nexport const VERSION = "1.0.0";\n',
    );
    await writeFile(
      join(directory, 'tests', 'exec.test.ts'),
      'import { ExecTool } from "../src/tools/exec";\nexport const check = new ExecTool();\n',
    );
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'v1');
    const v1 = await git(directory, 'rev-parse', 'HEAD');

    await writeFile(
      join(directory, 'src', 'core', 'leaf.ts'),
      `export function computeLeaf(n: number) { return n * 3; }\nexport const pad = "${'z'.repeat(200)}";\n`,
    );
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--no-verify', '-qm', 'v2');
    const v2 = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    const repo = await imprint.open(v2);

    const bySymbol = await repo.slice({ symbols: ['ExecTool'] });
    expect(bySymbol.files.map((f) => f.path)).toEqual(['src/index.ts', 'src/tools/exec.ts']);

    const depth1 = await repo.slice({ depsOf: 'src/index.ts', depth: 1 });
    expect(depth1.files.map((f) => f.path)).toEqual(['src/index.ts', 'src/tools/exec.ts']);

    const depth3 = await repo.slice({ depsOf: 'src/index.ts', depth: 3 });
    expect(depth3.files.map((f) => f.path)).toEqual([
      'src/index.ts',
      'src/tools/exec.ts',
      'src/core/mid.ts',
      'src/core/leaf.ts',
    ]);

    const dependents = await repo.slice({
      depsOf: 'src/tools/exec.ts',
      depth: 1,
      direction: 'dependents',
    });
    expect(dependents.files.map((f) => f.path)).toEqual([
      'src/tools/exec.ts',
      'src/index.ts',
      'tests/exec.test.ts',
    ]);

    const byGlob = await repo.slice({ paths: ['src/core/*.ts'] });
    expect(byGlob.files.map((f) => f.path)).toEqual(['src/core/leaf.ts', 'src/core/mid.ts']);

    const byRegex = await repo.slice({ grep: 'computeLeaf\\(n\\)', grepRegex: true });
    expect(byRegex.files.map((f) => f.path)).toEqual(['src/core/mid.ts']);

    const byChanged = await repo.slice({ changed: v1 });
    expect(byChanged.files.map((f) => f.path)).toEqual(['src/core/leaf.ts']);

    const budgeted = await repo.slice({ paths: ['src/**/*.ts'], maxBytes: 180 });
    expect(budgeted.truncation.truncated).toBe(true);
    expect(budgeted.truncation.usedBytes).toBeLessThanOrEqual(180);
    expect(budgeted.truncation.omitted.some((item) => item.reason === 'budget')).toBe(true);
  }, 20_000);
});
