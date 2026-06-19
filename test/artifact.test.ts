import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAdapterArtifact } from '../src/artifact';

const directories: string[] = [];
const hash = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function artifact() {
  const directory = await mkdtemp(join(tmpdir(), 'imprint-artifact-'));
  directories.push(directory);
  const contents = {
    'adapter_model.safetensors': 'weights',
    'adapter_config.json': '{}\n',
    'receipt.json': '{}\n',
  };
  for (const [name, value] of Object.entries(contents))
    await writeFile(join(directory, name), value);
  const manifest = {
    schema: 'imprint.adapter.v1',
    id: 'imp_adapter_test',
    backend: 'test',
    createdAt: new Date(0).toISOString(),
    baseModel: { id: 'base', revision: 'revision' },
    source: { repository: 'owner/repo', commit: 'abc' },
    adapter: { format: 'test', rank: 1, alpha: 1, targetModules: ['q_proj'] },
    files: Object.fromEntries(
      await Promise.all(
        Object.entries(contents).map(async ([name, value]) => [
          name,
          { bytes: new TextEncoder().encode(value).byteLength, sha256: await hash(value) },
        ]),
      ),
    ),
  };
  manifest.files['manifest.json'] = { bytes: 0, sha256: null };
  while (true) {
    const value = `${JSON.stringify(manifest, null, 2)}\n`;
    if (manifest.files['manifest.json'].bytes === value.length) {
      await writeFile(join(directory, 'manifest.json'), value);
      break;
    }
    manifest.files['manifest.json'].bytes = value.length;
  }
  return directory;
}

describe('adapter artifacts', () => {
  test('opens a complete backend-neutral artifact', async () => {
    const directory = await artifact();
    expect((await openAdapterArtifact(directory)).backend).toBe('test');
  });

  test('rejects modified adapter bytes', async () => {
    const directory = await artifact();
    await writeFile(join(directory, 'adapter_model.safetensors'), 'changed');
    expect(openAdapterArtifact(directory)).rejects.toThrow('mismatch');
  });
});
