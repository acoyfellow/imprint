#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Imprint } from './imprint';
import { AiGatewayProvider, WorkersAiProvider } from './provider';
import { isSliceEmpty } from './slice';
import type { FileKind, ImprintSlice, ModelProvider } from './types';

async function run(cwd: string, command: string[]) {
  const process = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await process.exited) !== 0) throw new Error(`${command[0]} failed`);
}

function gatewayToken(): string | undefined {
  return process.env.AI_GATEWAY_TOKEN ?? process.env.CF_ACCESS_TOKEN;
}

function resolveProvider(): ModelProvider | undefined {
  const gatewayUrl = process.env.AI_GATEWAY_URL;
  const gatewayTokenValue = gatewayToken();
  const gatewayModel = process.env.AI_GATEWAY_MODEL ?? 'grok-4.6';
  if (gatewayUrl && gatewayTokenValue) {
    return new AiGatewayProvider({
      baseUrl: gatewayUrl,
      apiToken: gatewayTokenValue,
      model: gatewayModel,
      headers: {
        'cf-access-token': gatewayTokenValue,
        'X-Requested-With': 'xmlhttprequest',
      },
    });
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (accountId && apiToken) {
    return new WorkersAiProvider({
      accountId,
      apiToken,
      model: process.env.WORKERS_AI_MODEL,
    });
  }
  return undefined;
}

function client(directory = process.cwd(), requireProvider = false): Imprint {
  const provider = resolveProvider();
  if (requireProvider && !provider) {
    throw new Error(
      'ask needs AI_GATEWAY_URL + AI_GATEWAY_TOKEN (or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)',
    );
  }
  return new Imprint({ directory, provider });
}

function parseSliceFlags(args: string[]): {
  slice: ImprintSlice;
  rest: string[];
  asText: boolean;
} {
  const slice: ImprintSlice = {};
  const rest: string[] = [];
  let asText = false;

  const pushPath = (value: string) => {
    slice.paths = [...(slice.paths ?? []), value];
  };
  const pushSymbol = (value: string) => {
    slice.symbols = [...(slice.symbols ?? []), value];
  };
  const pushDepsOf = (value: string) => {
    const existing = Array.isArray(slice.depsOf)
      ? slice.depsOf
      : slice.depsOf
        ? [slice.depsOf]
        : [];
    slice.depsOf = [...existing, value];
  };
  const pushKind = (value: string) => {
    slice.kinds = [...(slice.kinds ?? []), value as FileKind];
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--grep' && next !== undefined) {
      slice.grep = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--grep=')) {
      slice.grep = arg.slice('--grep='.length);
      continue;
    }
    if (arg === '--regex') {
      slice.grepRegex = true;
      continue;
    }
    if (arg === '--path' && next !== undefined) {
      pushPath(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--path=')) {
      pushPath(arg.slice('--path='.length));
      continue;
    }
    if (arg === '--symbol' && next !== undefined) {
      pushSymbol(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--symbol=')) {
      pushSymbol(arg.slice('--symbol='.length));
      continue;
    }
    if (arg === '--deps-of' && next !== undefined) {
      pushDepsOf(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--deps-of=')) {
      pushDepsOf(arg.slice('--deps-of='.length));
      continue;
    }
    if (arg === '--depth' && next !== undefined) {
      slice.depth = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--depth=')) {
      slice.depth = Number(arg.slice('--depth='.length));
      continue;
    }
    if (arg === '--direction' && next !== undefined) {
      slice.direction = next as ImprintSlice['direction'];
      index += 1;
      continue;
    }
    if (arg.startsWith('--direction=')) {
      slice.direction = arg.slice('--direction='.length) as ImprintSlice['direction'];
      continue;
    }
    if (arg === '--changed' && next !== undefined) {
      slice.changed = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--changed=')) {
      slice.changed = arg.slice('--changed='.length);
      continue;
    }
    if (arg === '--kind' && next !== undefined) {
      pushKind(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--kind=')) {
      pushKind(arg.slice('--kind='.length));
      continue;
    }
    if (arg === '--include-generated') {
      slice.includeGenerated = true;
      continue;
    }
    if (arg === '--max-bytes' && next !== undefined) {
      slice.maxBytes = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-bytes=')) {
      slice.maxBytes = Number(arg.slice('--max-bytes='.length));
      continue;
    }
    if (arg === '--max-tokens' && next !== undefined) {
      slice.maxTokens = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-tokens=')) {
      slice.maxTokens = Number(arg.slice('--max-tokens='.length));
      continue;
    }
    if (arg === '--text') {
      asText = true;
      continue;
    }
    rest.push(arg);
  }
  return { slice, rest, asText };
}

async function prove() {
  const directory = await mkdtemp(join(tmpdir(), 'imprint-proof-'));
  try {
    await run(directory, ['git', 'init', '-q', '-b', 'main']);
    await run(directory, ['git', 'config', 'core.hooksPath', '/dev/null']);
    await run(directory, ['git', 'config', 'user.email', 'proof@imprint.local']);
    await run(directory, ['git', 'config', 'user.name', 'Imprint Proof']);
    await mkdir(join(directory, 'src', 'generated'), { recursive: true });
    await writeFile(
      join(directory, 'src', 'generated', 'huge.ts'),
      `export const blob = "${'x'.repeat(20_000)}";\n`,
    );
    await writeFile(
      join(directory, 'src', 'token.ts'),
      'export function issueToken(user: string) { return "tok:" + user; }\n',
    );
    await writeFile(
      join(directory, 'src', 'session.ts'),
      'import { issueToken } from "./token";\nexport const createSession = (user: string) => ({ token: issueToken(user) });\n',
    );
    await run(directory, ['git', 'add', '.']);
    await run(directory, ['git', 'commit', '--no-verify', '-qm', 'old api']);
    const oldCommit = (await Bun.$`git -C ${directory} rev-parse HEAD`.text()).trim();

    await writeFile(
      join(directory, 'src', 'session.ts'),
      'import { issueToken } from "./token";\nexport const openSession = (user: string) => ({ token: issueToken(user) });\n',
    );
    await run(directory, ['git', 'add', '.']);
    await run(directory, ['git', 'commit', '--no-verify', '-qm', 'rename api']);
    const newCommit = (await Bun.$`git -C ${directory} rev-parse HEAD`.text()).trim();

    const imprint = client(directory);
    const [before, after] = await Promise.all([
      imprint.imprint(oldCommit),
      imprint.imprint(newCommit),
    ]);
    const diff = await imprint.diff(oldCommit, newCommit);
    const depSlice = await imprint.open(newCommit, { depsOf: 'openSession', depth: 1 });
    await imprint.promote(newCommit);
    const rolledBack = await imprint.rollback(oldCommit);
    const proof = {
      old: {
        commit: before.commit,
        knows: before.adapter.text.includes('createSession'),
        coverage: before.coverage,
      },
      next: {
        commit: after.commit,
        knows: after.adapter.text.includes('openSession'),
        depsOfOpenSession: depSlice.release.files.map((file) => file.path),
      },
      diff,
      rollback: rolledBack.commit === oldCommit,
    };
    if (
      !proof.old.knows ||
      !proof.next.knows ||
      !proof.rollback ||
      before.coverage.silentlyDropped !== 0 ||
      !proof.next.depsOfOpenSession.includes('src/token.ts')
    ) {
      throw new Error('proof failed');
    }
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'prove') {
    await prove();
  } else if (command === 'imprint') {
    console.log(JSON.stringify(await client().imprint(args[0] ?? 'HEAD'), null, 2));
  } else if (command === 'inspect') {
    console.log(JSON.stringify((await client().open(args[0])).inspect(), null, 2));
  } else if (command === 'map') {
    const opened = await client().open(args[0]);
    process.stdout.write(opened.renderMap());
  } else if (command === 'slice') {
    const { slice, rest, asText } = parseSliceFlags(args);
    const ref = rest[0];
    const opened = await client().open(ref, isSliceEmpty(slice) ? undefined : slice);
    if (asText) {
      process.stdout.write(`${opened.release.adapter.text}\n`);
    } else {
      console.log(
        JSON.stringify(
          opened.sliceResult ?? {
            commit: opened.release.commit,
            files: opened.release.files,
            text: opened.release.adapter.text,
          },
          null,
          2,
        ),
      );
    }
  } else if (command === 'ask') {
    const { slice, rest } = parseSliceFlags(args);
    const first = rest[0];
    const ref = first?.startsWith('@') ? first.slice(1) : undefined;
    if (ref) rest.shift();
    const opened = await client(process.cwd(), true).open(
      ref,
      isSliceEmpty(slice) ? undefined : slice,
    );
    console.log(JSON.stringify(await opened.ask(rest.join(' ')), null, 2));
  } else if (command === 'diff') {
    console.log(JSON.stringify(await client().diff(args[0], args[1]), null, 2));
  } else if (command === 'promote') {
    console.log(JSON.stringify(await client().promote(args[0]), null, 2));
  } else if (command === 'rollback') {
    console.log(JSON.stringify(await client().rollback(args[0]), null, 2));
  } else {
    console.log(
      'usage: imprint <imprint|inspect|map|slice|ask|diff|promote|rollback|prove> [...args]',
    );
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
