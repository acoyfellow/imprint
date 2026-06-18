import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Imprint } from '../src/imprint';

const directories: string[] = [];

async function git(directory: string, ...args: string[]) {
  const process = Bun.spawn(['git', ...args], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text());
  return (await new Response(process.stdout).text()).trim();
}

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'imprint-test-'));
  directories.push(directory);
  await git(directory, 'init', '-q', '-b', 'main');
  await git(directory, 'config', 'user.email', 'test@imprint.local');
  await git(directory, 'config', 'user.name', 'Imprint Test');
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('Imprint', () => {
  test('binds a release to exact commit content', async () => {
    const directory = await repository();
    await writeFile(join(directory, 'api.ts'), 'export const oldApi = true;\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '-qm', 'old');
    const oldCommit = await git(directory, 'rev-parse', 'HEAD');
    await writeFile(join(directory, 'api.ts'), 'export const newApi = true;\n');
    await git(directory, 'commit', '-qam', 'new');
    const newCommit = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    const oldRelease = await imprint.imprint(oldCommit);
    const newRelease = await imprint.imprint(newCommit);

    expect(oldRelease.adapter.text).toContain('oldApi');
    expect(oldRelease.adapter.text).not.toContain('newApi');
    expect(newRelease.adapter.text).toContain('newApi');
    expect(oldRelease.sourceDigest).not.toBe(newRelease.sourceDigest);
  });

  test('promotes and rolls back the complete release pointer', async () => {
    const directory = await repository();
    await writeFile(join(directory, 'api.ts'), 'export const version = 1;\n');
    await git(directory, 'add', '.');
    await git(directory, 'commit', '-qm', 'one');
    const one = await git(directory, 'rev-parse', 'HEAD');
    await writeFile(join(directory, 'api.ts'), 'export const version = 2;\n');
    await git(directory, 'commit', '-qam', 'two');
    const two = await git(directory, 'rev-parse', 'HEAD');

    const imprint = new Imprint({ directory });
    await imprint.imprint(one);
    await imprint.imprint(two);
    await imprint.promote(two);
    expect((await imprint.open()).release.commit).toBe(two);
    await imprint.rollback(one);
    expect((await imprint.open()).release.commit).toBe(one);
  });
});
