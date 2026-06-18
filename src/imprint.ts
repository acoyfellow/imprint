import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { commitParents, readCommitFiles, repositoryIdentity, resolveCommit } from './git';
import type { Answer, CommitRef, ImprintOptions, ImprintRelease } from './types';

const encoder = new TextEncoder();

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

function adapterText(files: ImprintRelease['files']): string {
  return files.map((file) => `\n--- ${file.path} @ ${file.oid} ---\n${file.content}`).join('\n');
}

function citations(text: string, files: ImprintRelease['files']): string[] {
  return files.filter((file) => text.includes(file.path)).map((file) => file.path);
}

export class Imprint {
  readonly directory: string;
  private readonly options: ImprintOptions;

  constructor(options: ImprintOptions = {}) {
    this.directory = resolve(options.directory ?? process.cwd());
    this.options = options;
  }

  async imprint(ref: CommitRef = 'HEAD'): Promise<ImprintRelease> {
    const commit = await resolveCommit(this.directory, ref);
    const repository = await repositoryIdentity(this.directory);
    const parents = await commitParents(this.directory, commit);
    const files = await readCommitFiles(
      this.directory,
      commit,
      this.options.maxSourceBytes ?? 400_000,
    );
    if (!files.length) throw new Error(`commit ${commit} contains no supported source files`);
    const manifest = files.map(({ path, oid, bytes }) => ({ path, oid, bytes }));
    const sourceDigest = await digest(JSON.stringify({ repository, commit, manifest }));
    const text = adapterText(files);
    const adapterDigest = await digest(text);
    const release: ImprintRelease = {
      schema: 'imprint.release.v1',
      id: `imp_${sourceDigest.slice(0, 20)}`,
      repository,
      commit,
      parents,
      createdAt: new Date().toISOString(),
      sourceDigest,
      files,
      adapter: { kind: 'repository-context', digest: adapterDigest, text },
      proof: {
        verified: true,
        checks: [
          { name: 'commit-resolved', passed: true, detail: commit },
          { name: 'source-bound', passed: true, detail: sourceDigest },
          { name: 'adapter-bound', passed: true, detail: adapterDigest },
        ],
      },
      status: 'candidate',
    };
    await mkdir(releaseDirectory(this.directory), { recursive: true });
    await writeFile(releasePath(this.directory, commit), JSON.stringify(release, null, 2), 'utf8');
    return release;
  }

  async open(ref?: CommitRef): Promise<RepositoryImprint> {
    const commit = ref
      ? await resolveCommit(this.directory, ref)
      : (await readFile(activePath(this.directory), 'utf8').catch(() => '')).trim() ||
        (await resolveCommit(this.directory, 'HEAD'));
    const release = await this.readRelease(commit).catch(() => this.imprint(commit));
    return new RepositoryImprint(release, this.options);
  }

  async promote(ref: CommitRef): Promise<ImprintRelease> {
    const commit = await resolveCommit(this.directory, ref);
    const release = await this.readRelease(commit);
    if (!release.proof.verified) throw new Error(`release ${release.id} did not verify`);
    release.status = 'active';
    await writeFile(releasePath(this.directory, commit), JSON.stringify(release, null, 2), 'utf8');
    await mkdir(join(this.directory, '.imprint'), { recursive: true });
    await writeFile(activePath(this.directory), `${commit}\n`, 'utf8');
    return release;
  }

  async rollback(ref: CommitRef): Promise<ImprintRelease> {
    return this.promote(ref);
  }

  async diff(from: CommitRef, to: CommitRef) {
    const [left, right] = await Promise.all([this.open(from), this.open(to)]);
    const before = new Map(left.release.files.map((file) => [file.path, file.oid]));
    const after = new Map(right.release.files.map((file) => [file.path, file.oid]));
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
    return JSON.parse(
      await readFile(releasePath(this.directory, commit), 'utf8'),
    ) as ImprintRelease;
  }
}

export class RepositoryImprint {
  constructor(
    readonly release: ImprintRelease,
    private readonly options: ImprintOptions,
  ) {}

  async ask(question: string): Promise<Answer> {
    if (!this.options.provider) throw new Error('ask requires a model provider');
    const result = await this.options.provider.generate({
      system: [
        `You answer about repository ${this.release.repository} at exact commit ${this.release.commit}.`,
        'Use only the repository imprint below. Cite relevant file paths. Say when the answer is absent.',
        this.release.adapter.text,
      ].join('\n\n'),
      prompt: question,
    });
    return {
      text: result.text,
      citations: citations(result.text, this.release.files),
      release: {
        id: this.release.id,
        repository: this.release.repository,
        commit: this.release.commit,
        sourceDigest: this.release.sourceDigest,
      },
      model: result.model,
      usage: result.usage,
    };
  }

  inspect(): ImprintRelease {
    return this.release;
  }
}
