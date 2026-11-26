import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { computeCoverage } from './classify';
import {
  commitParents,
  grepCommitPaths,
  listCommitBlobs,
  readBlobsByOid,
  readManifestEntries,
  repositoryIdentity,
  resolveCommit,
} from './git';
import { buildRepoMap } from './map';
import { computeSliceKey, executeSlice, isSliceEmpty } from './slice';
import type {
  Answer,
  CommitRef,
  ImprintCheck,
  ImprintOptions,
  ImprintRelease,
  ImprintSlice,
  ManifestEntry,
  SliceResult,
  SourceFile,
} from './types';

const encoder = new TextEncoder();
const BROKEN = 'IMPRINT_BROKEN';
const DEFAULT_MAX_SOURCE_BYTES = 400_000;
const DEFAULT_MAX_FILE_BYTES = 512_000;

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function releaseDirectory(directory: string): string {
  return join(directory, '.imprint', 'releases');
}

function releasePath(directory: string, commit: string): string {
  return join(releaseDirectory(directory), `${commit}.json`);
}

function activePath(directory: string): string {
  return join(directory, '.imprint', 'active');
}

function citations(text: string, manifest: ManifestEntry[]): string[] {
  return manifest.filter((entry) => text.includes(entry.path)).map((entry) => entry.path);
}

export function defaultChecks(files: SourceFile[]): ImprintCheck[] {
  const hit = files.find((file) => file.content.includes(BROKEN));
  return [
    {
      name: 'no-broken-marker',
      passed: !hit,
      detail: hit ? `${hit.path} contains ${BROKEN}` : 'no broken marker',
    },
  ];
}

async function buildSliceRelease(
  base: ImprintRelease,
  sliceResult: SliceResult,
): Promise<ImprintRelease> {
  const sliceEntries: ManifestEntry[] = sliceResult.files.map((file) => ({
    path: file.path,
    oid: file.oid,
    bytes: file.bytes,
    kind: file.kind ?? 'source',
  }));
  const sliceSourceDigest = await digest(
    JSON.stringify({
      repository: base.repository,
      commit: base.commit,
      slice: sliceResult.sliceKey,
      files: sliceEntries,
    }),
  );
  const adapterDigest = await digest(sliceResult.text);
  return {
    ...base,
    id: `imp_${sliceSourceDigest.slice(0, 20)}`,
    sourceDigest: sliceSourceDigest,
    files: sliceEntries,
    slice: {
      key: sliceResult.sliceKey,
      spec: sliceResult.slice,
      truncation: sliceResult.truncation,
    },
    adapter: {
      kind: 'repository-slice',
      digest: adapterDigest,
      text: sliceResult.text,
    },
  };
}

export class Imprint {
  readonly directory: string;
  private readonly options: ImprintOptions;

  constructor(options: ImprintOptions = {}) {
    this.directory = resolve(options.directory ?? process.cwd());
    this.options = options;
  }

  private get maxSourceBytes(): number {
    return this.options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  }

  private get maxFileBytes(): number {
    return this.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async imprint(ref: CommitRef = 'HEAD', slice?: ImprintSlice): Promise<ImprintRelease> {
    const commit = await resolveCommit(this.directory, ref);
    const fullRelease = await this.buildFullRelease(commit);
    if (!isSliceEmpty(slice) && slice) {
      const sliceResult = await executeSlice({
        directory: this.directory,
        release: fullRelease,
        slice,
        defaultMaxBytes: this.maxSourceBytes,
        maxFileBytes: this.maxFileBytes,
      });
      return buildSliceRelease(fullRelease, sliceResult);
    }
    return fullRelease;
  }

  private async buildFullRelease(commit: string): Promise<ImprintRelease> {
    const [repository, parents, manifest] = await Promise.all([
      repositoryIdentity(this.directory),
      commitParents(this.directory, commit),
      listCommitBlobs(this.directory, commit),
    ]);
    if (!manifest.length) {
      throw new Error(`commit ${commit} contains no supported source files`);
    }

    const codeEntries = manifest.filter(
      (entry) =>
        (entry.kind === 'source' || entry.kind === 'test') && entry.bytes <= this.maxFileBytes,
    );
    const docEntries = manifest
      .filter((entry) => entry.kind === 'doc' && entry.bytes <= 64_000)
      .sort((left, right) => {
        const leftReadme = left.path.toLowerCase() === 'readme.md' ? 0 : 1;
        const rightReadme = right.path.toLowerCase() === 'readme.md' ? 0 : 1;
        if (leftReadme !== rightReadme) return leftReadme - rightReadme;
        const leftDepth = left.path.split('/').length;
        const rightDepth = right.path.split('/').length;
        return leftDepth - rightDepth || left.path.localeCompare(right.path);
      })
      .slice(0, 12);
    const pkgEntry = manifest.find(
      (entry) => entry.path === 'package.json' && entry.bytes <= 128_000,
    );

    const oidsToRead = [
      ...codeEntries.map((entry) => entry.oid),
      ...docEntries.map((entry) => entry.oid),
      ...(pkgEntry ? [pkgEntry.oid] : []),
    ];
    const blobs = await readBlobsByOid(this.directory, oidsToRead);

    const codeFiles: SourceFile[] = [];
    for (const entry of codeEntries) {
      const content = blobs.get(entry.oid);
      if (content === undefined) continue;
      codeFiles.push({ ...entry, content });
    }
    const docs: SourceFile[] = [];
    for (const entry of docEntries) {
      const content = blobs.get(entry.oid);
      if (content === undefined) continue;
      docs.push({ ...entry, content });
    }
    const packageJson = pkgEntry ? blobs.get(pkgEntry.oid) : undefined;

    const includedEntries = manifest.filter(
      (entry) => entry.kind !== 'generated' && entry.kind !== 'binary',
    );
    const coverage = computeCoverage(
      manifest,
      codeFiles.length,
      includedEntries.length,
      this.maxFileBytes,
    );

    const map = await buildRepoMap({
      repository,
      commit,
      manifest,
      coverage,
      codeFiles,
      ...(packageJson !== undefined ? { packageJson } : {}),
      docs,
    });

    const sourceDigest = await digest(
      JSON.stringify({
        repository,
        commit,
        manifest: manifest.map(({ path, oid, bytes, kind }) => ({ path, oid, bytes, kind })),
      }),
    );

    const eligibleSources = manifest.filter(
      (entry) => entry.kind === 'source' && entry.bytes <= this.maxFileBytes,
    );
    const mappedSources = map.files.filter((entry) => entry.kind === 'source');

    let extraChecks: ImprintCheck[];
    if (this.options.checks) {
      const loadedForChecks = await readManifestEntries(
        this.directory,
        includedEntries.filter((entry) => entry.bytes <= this.maxFileBytes),
      );
      extraChecks = await this.options.checks(loadedForChecks, {
        commit,
        manifest,
        coverage,
        map,
      });
    } else {
      const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));
      const brokenHits = (await grepCommitPaths(this.directory, commit, BROKEN)).filter((path) => {
        const entry = manifestByPath.get(path);
        return entry && entry.kind !== 'generated' && entry.kind !== 'binary';
      });
      extraChecks = [
        {
          name: 'no-broken-marker',
          passed: brokenHits.length === 0,
          detail: brokenHits.length
            ? `${brokenHits[0]} contains ${BROKEN}`
            : 'no broken marker across all non-generated tracked files',
        },
      ];
    }

    const checks: ImprintCheck[] = [
      { name: 'commit-resolved', passed: /^[0-9a-f]{40}$/i.test(commit), detail: commit },
      {
        name: 'manifest-complete',
        passed:
          coverage.tracked > 0 &&
          coverage.indexed === coverage.tracked &&
          coverage.silentlyDropped === 0,
        detail: `${coverage.indexed}/${coverage.tracked} tracked files indexed (${coverage.silentlyDropped} silent drops)`,
      },
      { name: 'source-bound', passed: true, detail: sourceDigest },
      {
        name: 'map-bound',
        passed: map.digest.length === 64,
        detail: `${map.stats.mappedFiles} mapped, ${map.stats.exportCount} exports, ${map.stats.localEdgeCount} local edges, ${map.stats.textBytes}B`,
      },
      {
        name: 'source-coverage',
        passed: mappedSources.length === eligibleSources.length,
        detail: `${mappedSources.length}/${eligibleSources.length} non-generated source files mapped`,
      },
      ...extraChecks,
    ];

    const release: ImprintRelease = {
      schema: 'imprint.release.v2',
      id: `imp_${sourceDigest.slice(0, 20)}`,
      repository,
      commit,
      parents,
      createdAt: new Date().toISOString(),
      sourceDigest,
      manifest,
      coverage,
      map,
      files: includedEntries,
      adapter: {
        kind: 'repository-map',
        digest: map.digest,
        text: map.text,
      },
      proof: {
        verified: checks.every((check) => check.passed),
        checks,
      },
      status: 'candidate',
    };

    await mkdir(releaseDirectory(this.directory), { recursive: true });
    await writeFile(releasePath(this.directory, commit), JSON.stringify(release), 'utf8');
    return release;
  }

  async open(ref?: CommitRef, slice?: ImprintSlice): Promise<RepositoryImprint> {
    const commit = ref
      ? await resolveCommit(this.directory, ref)
      : (await readFile(activePath(this.directory), 'utf8').catch(() => '')).trim() ||
        (await resolveCommit(this.directory, 'HEAD'));
    const fullRelease = await this.readRelease(commit).catch(() => this.buildFullRelease(commit));
    if (!isSliceEmpty(slice) && slice) {
      const sliceResult = await executeSlice({
        directory: this.directory,
        release: fullRelease,
        slice,
        defaultMaxBytes: this.maxSourceBytes,
        maxFileBytes: this.maxFileBytes,
      });
      const slicedRelease = await buildSliceRelease(fullRelease, sliceResult);
      return new RepositoryImprint(slicedRelease, this.options, this.directory, sliceResult);
    }
    return new RepositoryImprint(fullRelease, this.options, this.directory);
  }

  async promote(ref: CommitRef): Promise<ImprintRelease> {
    const commit = await resolveCommit(this.directory, ref);
    const release = await this.readRelease(commit);
    if (!release.proof.verified) throw new Error(`release ${release.id} did not verify`);
    release.status = 'active';
    await writeFile(releasePath(this.directory, commit), JSON.stringify(release), 'utf8');
    await mkdir(join(this.directory, '.imprint'), { recursive: true });
    await writeFile(activePath(this.directory), `${commit}\n`, 'utf8');
    return release;
  }

  async rollback(ref: CommitRef): Promise<ImprintRelease> {
    return this.promote(ref);
  }

  async diff(from: CommitRef, to: CommitRef) {
    const [left, right] = await Promise.all([this.open(from), this.open(to)]);
    const before = new Map(left.release.manifest.map((file) => [file.path, file.oid]));
    const after = new Map(right.release.manifest.map((file) => [file.path, file.oid]));
    return {
      from: left.release.commit,
      to: right.release.commit,
      added: [...after.keys()].filter((path) => !before.has(path)),
      deleted: [...before.keys()].filter((path) => !after.has(path)),
      changed: [...after.keys()].filter(
        (path) => before.has(path) && before.get(path) !== after.get(path),
      ),
    };
  }

  private async readRelease(commit: string): Promise<ImprintRelease> {
    const parsed = JSON.parse(
      await readFile(releasePath(this.directory, commit), 'utf8'),
    ) as ImprintRelease;
    if (parsed.schema !== 'imprint.release.v2') {
      throw new Error('stale release schema');
    }
    return parsed;
  }
}

export class RepositoryImprint {
  constructor(
    readonly release: ImprintRelease,
    private readonly options: ImprintOptions,
    private readonly directory: string,
    readonly sliceResult?: SliceResult,
  ) {}

  renderMap(): string {
    return this.release.map.text;
  }

  async readFile(path: string): Promise<SourceFile> {
    const entry = this.release.manifest.find((item) => item.path === path);
    if (!entry) {
      throw new Error(`path ${path} not found in commit ${this.release.commit}`);
    }
    const files = await readManifestEntries(this.directory, [entry]);
    const file = files[0];
    if (!file) {
      throw new Error(`blob ${entry.oid} missing for ${path}`);
    }
    return file;
  }

  async readFiles(paths?: string[]): Promise<SourceFile[]> {
    if (!paths && this.sliceResult) {
      return this.sliceResult.files;
    }
    const entries = paths
      ? this.release.manifest.filter((entry) => paths.includes(entry.path))
      : this.release.files;
    return readManifestEntries(this.directory, entries);
  }

  async slice(slice: ImprintSlice): Promise<SliceResult> {
    return executeSlice({
      directory: this.directory,
      release: this.release,
      slice,
      defaultMaxBytes: this.options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
      maxFileBytes: this.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    });
  }

  async ask(question: string): Promise<Answer> {
    if (!this.options.provider) throw new Error('ask requires a model provider');
    const contextText = this.sliceResult ? this.sliceResult.text : this.release.adapter.text;
    const result = await this.options.provider.generate({
      system: [
        `You answer about repository ${this.release.repository} at exact commit ${this.release.commit}.`,
        'Use only the repository imprint below. Cite relevant file paths. Say when the answer is absent.',
        contextText,
      ].join('\n\n'),
      prompt: question,
    });
    return {
      text: result.text,
      citations: citations(result.text, this.release.manifest),
      release: {
        id: this.release.id,
        repository: this.release.repository,
        commit: this.release.commit,
        sourceDigest: this.release.sourceDigest,
      },
      model: result.model,
      ...(result.usage !== undefined ? { usage: result.usage } : {}),
    };
  }

  inspect(): ImprintRelease {
    return this.release;
  }
}

export { computeSliceKey };
