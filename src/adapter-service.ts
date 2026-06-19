import type { AdapterArtifact } from './types';

export interface AdapterEnv {
  ADAPTERS: R2Bucket;
  ADAPTER_RELEASES: DurableObjectNamespace;
  ADAPTER_API_TOKEN?: string;
  DEV_MODE?: string;
}

const files = [
  'adapter_model.safetensors',
  'adapter_config.json',
  'manifest.json',
  'receipt.json',
] as const;
const jsonHeaders = { 'content-type': 'application/json' };
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: jsonHeaders });

function authorized(request: Request, env: AdapterEnv) {
  if (env.DEV_MODE === 'true') return true;
  const token = request.headers.get('authorization');
  return !!env.ADAPTER_API_TOKEN && token === `Bearer ${env.ADAPTER_API_TOKEN}`;
}

async function sha256(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validManifest(value: unknown): value is AdapterArtifact {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as AdapterArtifact;
  return (
    manifest.schema === 'imprint.adapter.v1' &&
    /^[A-Za-z0-9._-]{1,160}$/.test(manifest.id) &&
    !!manifest.backend &&
    !!manifest.baseModel?.id &&
    !!manifest.source?.repository &&
    !!manifest.source?.commit &&
    files.every((name) => {
      const item = manifest.files?.[name];
      return (
        !!item &&
        Number.isSafeInteger(item.bytes) &&
        item.bytes >= 0 &&
        (name === 'manifest.json' ? item.sha256 === null : /^[a-f0-9]{64}$/.test(item.sha256 ?? ''))
      );
    })
  );
}

function releaseStub(env: AdapterEnv) {
  return env.ADAPTER_RELEASES.get(env.ADAPTER_RELEASES.idFromName('global'));
}

export async function handleAdapterRequest(
  request: Request,
  env: AdapterEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/adapters') && !url.pathname.startsWith('/v1/releases')) return;
  if (!authorized(request, env)) return response({ error: 'unauthorized' }, 401);

  if (url.pathname === '/v1/adapters' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const manifestPart = form?.get('manifest');
    if (!(manifestPart instanceof File))
      return response({ error: 'multipart manifest file is required' }, 400);
    const manifestBytes = await manifestPart.arrayBuffer();
    let manifest: unknown;
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
      return response({ error: 'invalid manifest JSON' }, 400);
    }
    if (!validManifest(manifest))
      return response({ error: 'invalid imprint.adapter.v1 manifest' }, 400);
    if (manifest.files['manifest.json'].bytes !== manifestBytes.byteLength)
      return response({ error: 'manifest size mismatch' }, 400);

    const bodies = new Map<string, ArrayBuffer>([['manifest.json', manifestBytes]]);
    for (const name of files.filter((name) => name !== 'manifest.json')) {
      const part = form?.get(name);
      if (!(part instanceof File)) return response({ error: `missing ${name}` }, 400);
      const bytes = await part.arrayBuffer();
      const expected = manifest.files[name];
      if (bytes.byteLength !== expected.bytes || (await sha256(bytes)) !== expected.sha256)
        return response({ error: `${name} integrity mismatch` }, 400);
      bodies.set(name, bytes);
    }
    const prefix = `artifacts/${manifest.id}/`;
    for (const name of files) {
      if (await env.ADAPTERS.head(prefix + name))
        return response({ error: 'artifact id already exists' }, 409);
    }
    for (const name of files) {
      const body = bodies.get(name);
      if (!body) return response({ error: `missing ${name}` }, 400);
      await env.ADAPTERS.put(prefix + name, body, {
        customMetadata: { artifact: manifest.id, schema: manifest.schema },
      });
    }
    const registered = await releaseStub(env).fetch('https://do/register', {
      method: 'POST',
      body: JSON.stringify({ id: manifest.id }),
    });
    if (!registered.ok) return registered;
    return response({ id: manifest.id, candidate: manifest.id }, 201);
  }

  const manifestMatch = url.pathname.match(/^\/v1\/adapters\/([^/]+)\/manifest$/);
  if (manifestMatch && request.method === 'GET') {
    const object = await env.ADAPTERS.get(
      `artifacts/${encodeURIComponent(manifestMatch[1])}/manifest.json`,
    );
    return object
      ? new Response(object.body, {
          headers: { 'content-type': 'application/json', etag: object.httpEtag },
        })
      : response({ error: 'not found' }, 404);
  }
  if (url.pathname === '/v1/releases' && request.method === 'GET')
    return releaseStub(env).fetch('https://do/state');
  if (url.pathname === '/v1/releases/promote' && request.method === 'POST')
    return releaseStub(env).fetch('https://do/promote', request);
  if (url.pathname === '/v1/releases/rollback' && request.method === 'POST')
    return releaseStub(env).fetch('https://do/rollback', request);
  return response({ error: 'not found' }, 404);
}

interface ReleaseState {
  active: string | null;
  candidate: string | null;
  history: string[];
  artifacts: string[];
  version: number;
}
const initial = (): ReleaseState => ({
  active: null,
  candidate: null,
  history: [],
  artifacts: [],
  version: 0,
});

export class AdapterReleases implements DurableObject {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    const current = (await this.state.storage.get<ReleaseState>('release')) ?? initial();
    if (path === '/state') return response(current);
    const input: Record<string, unknown> = await request
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    if (path === '/register') {
      const id = String(input.id ?? '');
      if (!current.artifacts.includes(id)) current.artifacts.push(id);
      current.candidate = id;
      current.version++;
    } else if (path === '/promote') {
      const id = String(input.id ?? current.candidate ?? '');
      if (!current.artifacts.includes(id)) return response({ error: 'unknown artifact' }, 404);
      if ((input.expectedActive ?? null) !== current.active)
        return response({ error: 'compare-and-swap conflict', state: current }, 409);
      if (current.active && current.active !== id) current.history.push(current.active);
      current.active = id;
      current.candidate = current.candidate === id ? null : current.candidate;
      current.version++;
    } else if (path === '/rollback') {
      if ((input.expectedActive ?? null) !== current.active)
        return response({ error: 'compare-and-swap conflict', state: current }, 409);
      const target = typeof input.id === 'string' ? input.id : current.history.at(-1);
      if (!target || !current.artifacts.includes(target))
        return response({ error: 'no rollback target' }, 409);
      current.history = current.history.filter((id) => id !== target);
      if (current.active && current.active !== target) current.history.push(current.active);
      current.active = target;
      current.version++;
    } else return response({ error: 'not found' }, 404);
    await this.state.storage.put('release', current);
    return response(current);
  }
}
