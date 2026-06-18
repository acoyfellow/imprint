#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Imprint } from './imprint';
import { WorkersAiProvider } from './provider';

async function run(cwd: string, command: string[]) {
  const process = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await process.exited) !== 0) throw new Error(`${command[0]} failed`);
}

function client(directory = process.cwd()) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_PERSONAL_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_PERSONAL_API_TOKEN;
  return new Imprint({
    directory,
    provider: accountId && apiToken ? new WorkersAiProvider({ accountId, apiToken }) : undefined,
  });
}

async function prove() {
  const directory = await mkdtemp(join(tmpdir(), 'imprint-proof-'));
  try {
    await run(directory, ['git', 'init', '-q', '-b', 'main']);
    await run(directory, ['git', 'config', 'user.email', 'proof@imprint.local']);
    await run(directory, ['git', 'config', 'user.name', 'Imprint Proof']);
    await writeFile(
      join(directory, 'session.ts'),
      'export const createSession = (options: object) => ({ options });\n',
    );
    await run(directory, ['git', 'add', '.']);
    await run(directory, ['git', 'commit', '-qm', 'old api']);
    const oldCommit = (await Bun.$`git -C ${directory} rev-parse HEAD`.text()).trim();
    await writeFile(
      join(directory, 'session.ts'),
      'export const openSession = (config: object) => ({ config });\n',
    );
    await run(directory, ['git', 'add', '.']);
    await run(directory, ['git', 'commit', '-qm', 'rename api']);
    const newCommit = (await Bun.$`git -C ${directory} rev-parse HEAD`.text()).trim();

    const imprint = client(directory);
    const [before, after] = await Promise.all([
      imprint.imprint(oldCommit),
      imprint.imprint(newCommit),
    ]);
    const diff = await imprint.diff(oldCommit, newCommit);
    await imprint.promote(newCommit);
    const rolledBack = await imprint.rollback(oldCommit);
    const proof = {
      old: { commit: before.commit, knows: before.adapter.text.includes('createSession') },
      next: { commit: after.commit, knows: after.adapter.text.includes('openSession') },
      diff,
      rollback: rolledBack.commit === oldCommit,
    };
    if (!proof.old.knows || !proof.next.knows || !proof.rollback) throw new Error('proof failed');
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const [command, ...args] = process.argv.slice(2);
const imprint = client();

try {
  if (command === 'imprint')
    console.log(JSON.stringify(await imprint.imprint(args[0] ?? 'HEAD'), null, 2));
  else if (command === 'inspect')
    console.log(JSON.stringify((await imprint.open(args[0])).inspect(), null, 2));
  else if (command === 'ask') {
    const first = args[0];
    const ref = first?.startsWith('@') ? first.slice(1) : undefined;
    if (ref) args.shift();
    console.log(JSON.stringify(await (await imprint.open(ref)).ask(args.join(' ')), null, 2));
  } else if (command === 'diff')
    console.log(JSON.stringify(await imprint.diff(args[0], args[1]), null, 2));
  else if (command === 'promote')
    console.log(JSON.stringify(await imprint.promote(args[0]), null, 2));
  else if (command === 'rollback')
    console.log(JSON.stringify(await imprint.rollback(args[0]), null, 2));
  else if (command === 'prove') await prove();
  else console.log('usage: imprint <imprint|inspect|ask|diff|promote|rollback|prove> [...args]');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
