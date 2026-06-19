import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AdapterArtifact } from './types';

const REQUIRED_FILES = [
  'adapter_model.safetensors',
  'adapter_config.json',
  'manifest.json',
  'receipt.json',
] as const;

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Read and structurally verify a backend-neutral adapter artifact directory. */
export async function openAdapterArtifact(directory: string): Promise<AdapterArtifact> {
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as AdapterArtifact;
  if (manifest.schema !== 'imprint.adapter.v1')
    throw new Error('unsupported adapter manifest schema');
  if (
    !manifest.id ||
    !manifest.backend ||
    !manifest.baseModel?.id ||
    !manifest.source?.repository
  ) {
    throw new Error('adapter manifest is missing identity fields');
  }
  for (const name of REQUIRED_FILES) {
    const file = manifest.files[name];
    if (
      !file ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      (name === 'manifest.json' ? file.sha256 !== null : !isHexDigest(file.sha256))
    ) {
      throw new Error(`adapter manifest has invalid file metadata for ${name}`);
    }
    const path = resolve(root, name);
    if (!path.startsWith(`${root}/`) || (await stat(path)).size !== file.bytes) {
      throw new Error(`adapter file size mismatch for ${name}`);
    }
    if (file.sha256) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await readFile(path)));
      const actual = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (actual !== file.sha256) throw new Error(`adapter file digest mismatch for ${name}`);
    }
  }
  return manifest;
}

export const adapterArtifactFiles = REQUIRED_FILES;
