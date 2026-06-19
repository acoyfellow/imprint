import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Miniflare } from 'miniflare';
import type { AdapterArtifact } from '../src/types';

let mf: Miniflare;
const hash = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function formFor(id: string) {
  const values = {
    'adapter_model.safetensors': `weights-${id}`,
    'adapter_config.json': '{}\n',
    'receipt.json': '{}\n',
  };
  const manifest: AdapterArtifact = {
    schema: 'imprint.adapter.v1',
    id,
    backend: 'local-test',
    createdAt: new Date(0).toISOString(),
    baseModel: { id: 'base', revision: null },
    source: { repository: 'owner/repo', commit: 'abc' },
    adapter: { format: 'safetensors', rank: 1, alpha: 1, targetModules: ['q_proj'] },
    files: {},
  };
  for (const [name, value] of Object.entries(values))
    manifest.files[name] = { bytes: value.length, sha256: await hash(value) };
  manifest.files['manifest.json'] = { bytes: 0, sha256: null };
  let text = '';
  do {
    text = `${JSON.stringify(manifest, null, 2)}\n`;
    manifest.files['manifest.json'].bytes = text.length;
  } while (`${JSON.stringify(manifest, null, 2)}\n`.length !== text.length);
  text = `${JSON.stringify(manifest, null, 2)}\n`;
  const form = new FormData();
  form.set('manifest', new File([text], 'manifest.json'));
  for (const [name, value] of Object.entries(values)) form.set(name, new File([value], name));
  return form;
}

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ['src/worker.ts'],
    target: 'browser',
    format: 'esm',
  });
  if (!build.success) throw new Error('worker bundle failed');
  const script = await build.outputs[0].text();
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['ADAPTERS'],
    durableObjects: { ADAPTER_RELEASES: 'AdapterReleases' },
    bindings: { DEV_MODE: 'true' },
  });
});
afterAll(() => mf.dispose());

describe('Cloudflare adapter lifecycle', () => {
  test('stores immutable files and performs CAS promotion and rollback', async () => {
    for (const id of ['adapter-a', 'adapter-b']) {
      const upload = await mf.dispatchFetch('http://localhost/v1/adapters', {
        method: 'POST',
        // @ts-expect-error Miniflare's undici BodyInit differs from the DOM FormData type.
        body: await formFor(id),
      });
      expect(upload.status).toBe(201);
    }
    expect((await mf.dispatchFetch('http://localhost/v1/adapters/adapter-a/manifest')).status).toBe(
      200,
    );
    expect(
      (
        await mf.dispatchFetch('http://localhost/v1/adapters', {
          method: 'POST',
          // @ts-expect-error Miniflare's undici BodyInit differs from the DOM FormData type.
          body: await formFor('adapter-a'),
        })
      ).status,
    ).toBe(409);

    const promoteA = await mf.dispatchFetch('http://localhost/v1/releases/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'adapter-a', expectedActive: null }),
    });
    expect(promoteA.status).toBe(200);
    const conflict = await mf.dispatchFetch('http://localhost/v1/releases/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'adapter-b', expectedActive: null }),
    });
    expect(conflict.status).toBe(409);
    await mf.dispatchFetch('http://localhost/v1/releases/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'adapter-b', expectedActive: 'adapter-a' }),
    });
    const rollback = await mf.dispatchFetch('http://localhost/v1/releases/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedActive: 'adapter-b' }),
    });
    expect(((await rollback.json()) as { active: string }).active).toBe('adapter-a');
  });
});
