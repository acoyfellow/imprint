export type CommitRef = string;

export interface SourceFile {
  path: string;
  oid: string;
  bytes: number;
  content: string;
}

export interface ImprintRelease {
  schema: 'imprint.release.v1';
  id: string;
  repository: string;
  commit: string;
  parents: string[];
  createdAt: string;
  sourceDigest: string;
  files: SourceFile[];
  adapter: {
    kind: 'repository-context';
    digest: string;
    text: string;
  };
  proof: {
    verified: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
  };
  status: 'candidate' | 'active' | 'rejected' | 'revoked';
}

export interface AdapterArtifact {
  schema: 'imprint.adapter.v1';
  id: string;
  backend: string;
  createdAt: string;
  baseModel: { id: string; revision: string | null };
  source: { repository: string; commit: string; digest?: string };
  adapter: { format: string; rank: number; alpha: number; targetModules: string[] };
  files: Record<string, { bytes: number; sha256: string | null }>;
}

export interface ModelProvider {
  generate(input: {
    system: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; usage?: Record<string, number> }>;
}

export interface Answer {
  text: string;
  citations: string[];
  release: Pick<ImprintRelease, 'id' | 'repository' | 'commit' | 'sourceDigest'>;
  model: string;
  usage?: Record<string, number>;
}

export interface ImprintOptions {
  directory?: string;
  provider?: ModelProvider;
  maxSourceBytes?: number;
}
