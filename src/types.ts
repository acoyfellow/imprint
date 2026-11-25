export type CommitRef = string;

export type FileKind = 'source' | 'test' | 'generated' | 'config' | 'doc' | 'binary';

export interface ManifestEntry {
  path: string;
  oid: string;
  bytes: number;
  kind: FileKind;
}

export interface SourceFile {
  path: string;
  oid: string;
  bytes: number;
  kind?: FileKind;
  content: string;
}

export interface KindCoverage {
  count: number;
  bytes: number;
}

export interface GeneratedGroup {
  prefix: string;
  count: number;
  bytes: number;
}

export type OmitReason = 'generated' | 'oversized' | 'binary' | 'budget';

export interface OmittedEntry {
  path: string;
  bytes: number;
  reason: OmitReason;
}

export interface CoverageStats {
  tracked: number;
  indexed: number;
  mapped: number;
  included: number;
  excluded: number;
  generated: number;
  oversized: number;
  silentlyDropped: number;
  byKind: Record<FileKind, KindCoverage>;
  generatedGroups: GeneratedGroup[];
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'const'
  | 'let'
  | 'var'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'reexport'
  | 'default'
  | 'struct'
  | 'trait'
  | 'module';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
}

export interface ImportEdge {
  specifier: string;
  resolved: string | null;
  names: string[];
  isTypeOnly?: boolean;
}

export interface FileMapEntry {
  path: string;
  kind: FileKind;
  bytes: number;
  exports: SymbolEntry[];
  symbols: SymbolEntry[];
  imports: ImportEdge[];
  parseError?: string;
}

export interface RepoMapStats {
  mappedFiles: number;
  symbolCount: number;
  exportCount: number;
  localEdgeCount: number;
  parseErrorCount: number;
  textBytes: number;
}

export interface RepoMap {
  digest: string;
  files: FileMapEntry[];
  text: string;
  stats: RepoMapStats;
}

export interface SliceTruncation {
  truncated: boolean;
  budgetBytes: number;
  usedBytes: number;
  matchedFiles: number;
  includedFiles: number;
  omitted: OmittedEntry[];
}

export interface ImprintSlice {
  paths?: string[];
  symbols?: string[];
  grep?: string;
  grepRegex?: boolean;
  depsOf?: string | string[];
  depth?: number;
  direction?: 'deps' | 'dependents' | 'both';
  changed?: CommitRef;
  kinds?: FileKind[];
  includeGenerated?: boolean;
  maxBytes?: number;
  maxTokens?: number;
}

export interface SliceResult {
  commit: string;
  sliceKey: string;
  slice: ImprintSlice;
  files: SourceFile[];
  digest: string;
  text: string;
  truncation: SliceTruncation;
}

export type ImprintCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export interface ImprintRelease {
  schema: 'imprint.release.v2';
  id: string;
  repository: string;
  commit: string;
  parents: string[];
  createdAt: string;
  sourceDigest: string;
  manifest: ManifestEntry[];
  coverage: CoverageStats;
  map: RepoMap;
  files: ManifestEntry[];
  slice?: {
    key: string;
    spec: ImprintSlice;
    truncation: SliceTruncation;
  };
  adapter: {
    kind: 'repository-map' | 'repository-slice';
    digest: string;
    text: string;
  };
  proof: {
    verified: boolean;
    checks: ImprintCheck[];
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
  maxFileBytes?: number;
  checks?: (
    files: SourceFile[],
    context?: {
      commit: string;
      manifest: ManifestEntry[];
      coverage: CoverageStats;
      map: RepoMap;
    },
  ) => ImprintCheck[] | Promise<ImprintCheck[]>;
}
