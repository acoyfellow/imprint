import { dirname, posix } from 'node:path';
import { parseSync } from 'oxc-parser';
import { fileExtension } from './classify';
import type {
  CoverageStats,
  FileMapEntry,
  ImportEdge,
  ManifestEntry,
  RepoMap,
  SourceFile,
  SymbolEntry,
  SymbolKind,
} from './types';

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildLineIndex(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function lineForOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(1, high + 1);
}

function resolveLocalSpecifier(
  fromPath: string,
  specifier: string,
  allPaths: Set<string>,
): string | null {
  let candidateBase: string | null = null;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const dir = dirname(fromPath);
    candidateBase = posix.normalize(dir === '.' ? specifier : posix.join(dir, specifier));
  } else if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
    candidateBase = posix.normalize(`src/${specifier.slice(2)}`);
  } else {
    return null;
  }

  if (allPaths.has(candidateBase)) return candidateBase;

  const swappedBases = [candidateBase];
  if (/\.(?:mjs|cjs|jsx|js)$/i.test(candidateBase)) {
    swappedBases.push(candidateBase.replace(/\.(?:mjs|cjs|jsx|js)$/i, ''));
  }

  for (const base of swappedBases) {
    for (const ext of RESOLVE_EXTS) {
      const withExt = `${base}${ext}`;
      if (allPaths.has(withExt)) return withExt;
    }
    for (const ext of RESOLVE_EXTS) {
      const indexFile = `${base}/index${ext}`;
      if (allPaths.has(indexFile)) return indexFile;
    }
  }
  return null;
}

type AstNode = Record<string, unknown>;

function collectPatternNames(pattern: AstNode | null | undefined, out: string[]): void {
  if (!pattern || typeof pattern !== 'object') return;
  const type = pattern.type as string | undefined;
  if (type === 'Identifier' && typeof pattern.name === 'string') {
    out.push(pattern.name);
    return;
  }
  if (type === 'ObjectPattern' && Array.isArray(pattern.properties)) {
    for (const prop of pattern.properties as AstNode[]) {
      if (prop.type === 'RestElement') {
        collectPatternNames(prop.argument as AstNode, out);
      } else {
        collectPatternNames(prop.value as AstNode, out);
      }
    }
    return;
  }
  if (type === 'ArrayPattern' && Array.isArray(pattern.elements)) {
    for (const elem of pattern.elements as Array<AstNode | null>) {
      if (!elem) continue;
      if (elem.type === 'RestElement') {
        collectPatternNames(elem.argument as AstNode, out);
      } else {
        collectPatternNames(elem, out);
      }
    }
    return;
  }
  if (type === 'AssignmentPattern') {
    collectPatternNames(pattern.left as AstNode, out);
  }
}

function extractDeclarationSymbols(
  node: AstNode,
  exported: boolean,
  lineOffsets: number[],
  out: SymbolEntry[],
  exportedNames?: Set<string>,
): void {
  const type = node.type as string | undefined;
  const start = typeof node.start === 'number' ? node.start : 0;
  const line = lineForOffset(lineOffsets, start);

  if (type === 'FunctionDeclaration' || type === 'TSDeclareFunction') {
    const id = node.id as AstNode | null | undefined;
    if (id && typeof id.name === 'string') {
      out.push({
        name: id.name,
        kind: 'function',
        line,
        exported: exported || Boolean(exportedNames?.has(id.name)),
      });
    }
    return;
  }
  if (type === 'ClassDeclaration') {
    const id = node.id as AstNode | null | undefined;
    if (id && typeof id.name === 'string') {
      out.push({
        name: id.name,
        kind: 'class',
        line,
        exported: exported || Boolean(exportedNames?.has(id.name)),
      });
    }
    return;
  }
  if (type === 'VariableDeclaration' && Array.isArray(node.declarations)) {
    const rawKind = node.kind as string;
    const defaultKind: SymbolKind =
      rawKind === 'let' || rawKind === 'var' || rawKind === 'const' ? rawKind : 'const';
    for (const decl of node.declarations as AstNode[]) {
      const initType = (decl.init as AstNode | null | undefined)?.type as string | undefined;
      const isFnExpr = initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression';
      const names: string[] = [];
      collectPatternNames(decl.id as AstNode, names);
      const declLine = lineForOffset(
        lineOffsets,
        typeof decl.start === 'number' ? decl.start : start,
      );
      const kind: SymbolKind = isFnExpr ? 'function' : defaultKind;
      for (const name of names) {
        const isExported = exported || Boolean(exportedNames?.has(name));
        if (!isExported && !isFnExpr) continue;
        out.push({ name, kind, line: declLine, exported: isExported });
      }
    }
    return;
  }
  if (type === 'TSTypeAliasDeclaration') {
    const id = node.id as AstNode | undefined;
    if (id && typeof id.name === 'string') {
      out.push({ name: id.name, kind: 'type', line, exported });
    }
    return;
  }
  if (type === 'TSInterfaceDeclaration') {
    const id = node.id as AstNode | undefined;
    if (id && typeof id.name === 'string') {
      out.push({ name: id.name, kind: 'interface', line, exported });
    }
    return;
  }
  if (type === 'TSEnumDeclaration') {
    const id = node.id as AstNode | undefined;
    if (id && typeof id.name === 'string') {
      out.push({ name: id.name, kind: 'enum', line, exported });
    }
    return;
  }
  if (type === 'TSModuleDeclaration') {
    const id = node.id as AstNode | undefined;
    const name =
      id && typeof id.name === 'string'
        ? id.name
        : id && typeof id.value === 'string'
          ? id.value
          : null;
    if (name) {
      out.push({ name, kind: 'namespace', line, exported });
    }
  }
}

function addImportEdge(
  edges: Map<string, ImportEdge>,
  fromPath: string,
  specifier: string,
  names: string[],
  allPaths: Set<string>,
  isTypeOnly = false,
): void {
  const resolved = resolveLocalSpecifier(fromPath, specifier, allPaths);
  const existing = edges.get(specifier);
  if (existing) {
    for (const name of names) {
      if (!existing.names.includes(name)) existing.names.push(name);
    }
    if (!isTypeOnly) existing.isTypeOnly = false;
    return;
  }
  edges.set(specifier, {
    specifier,
    resolved,
    names: [...new Set(names)],
    ...(isTypeOnly ? { isTypeOnly: true } : {}),
  });
}

function parseJsTsFile(file: SourceFile, allPaths: Set<string>): FileMapEntry {
  const result = parseSync(file.path, file.content, { sourceType: 'unambiguous' });
  const lineOffsets = buildLineIndex(file.content);
  const symbols: SymbolEntry[] = [];
  const edges = new Map<string, ImportEdge>();
  const exportedNames = new Set<string>();

  for (const imp of result.module.staticImports) {
    const names: string[] = [];
    let allTypeOnly = imp.entries.length > 0;
    for (const entry of imp.entries) {
      if (!entry.isType) allTypeOnly = false;
      if (entry.importName.kind === 'Name' && entry.importName.name) {
        names.push(entry.importName.name);
      } else if (entry.importName.kind === 'Default') {
        names.push('default');
      } else if (entry.importName.kind === 'NamespaceObject') {
        names.push('*');
      }
    }
    addImportEdge(edges, file.path, imp.moduleRequest.value, names, allPaths, allTypeOnly);
  }

  const body = (result.program?.body ?? []) as unknown as AstNode[];
  for (const node of body) {
    if (node.type === 'ExportNamedDeclaration' && !node.source && Array.isArray(node.specifiers)) {
      for (const spec of node.specifiers as AstNode[]) {
        const localNode = spec.local as AstNode | undefined;
        const localName =
          (localNode?.name as string | undefined) ?? (localNode?.value as string | undefined);
        if (localName) exportedNames.add(localName);
      }
    }
  }
  for (const node of body) {
    const type = node.type as string | undefined;
    if (type === 'ExportNamedDeclaration') {
      const source = node.source as AstNode | null | undefined;
      const specifiers = (node.specifiers ?? []) as AstNode[];
      const declaration = node.declaration as AstNode | null | undefined;
      if (declaration) {
        extractDeclarationSymbols(declaration, true, lineOffsets, symbols);
      }
      if (source && typeof source.value === 'string') {
        const names: string[] = [];
        for (const spec of specifiers) {
          const exportedNode = spec.exported as AstNode | undefined;
          const localNode = spec.local as AstNode | undefined;
          const exportedName =
            (exportedNode?.name as string | undefined) ??
            (exportedNode?.value as string | undefined);
          const localName =
            (localNode?.name as string | undefined) ?? (localNode?.value as string | undefined);
          if (localName) names.push(localName);
          if (exportedName) {
            const line = lineForOffset(
              lineOffsets,
              typeof spec.start === 'number' ? spec.start : ((node.start as number) ?? 0),
            );
            symbols.push({ name: exportedName, kind: 'reexport', line, exported: true });
          }
        }
        addImportEdge(edges, file.path, source.value, names, allPaths, node.exportKind === 'type');
      } else {
        for (const spec of specifiers) {
          const exportedNode = spec.exported as AstNode | undefined;
          const localNode = spec.local as AstNode | undefined;
          const exportedName =
            (exportedNode?.name as string | undefined) ??
            (exportedNode?.value as string | undefined);
          const localName =
            (localNode?.name as string | undefined) ?? (localNode?.value as string | undefined);
          if (localName) exportedNames.add(localName);
          if (exportedName && exportedName !== localName) {
            const line = lineForOffset(
              lineOffsets,
              typeof spec.start === 'number' ? spec.start : ((node.start as number) ?? 0),
            );
            symbols.push({ name: exportedName, kind: 'reexport', line, exported: true });
          }
        }
      }
      continue;
    }

    if (type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration as AstNode | null | undefined;
      const line = lineForOffset(lineOffsets, typeof node.start === 'number' ? node.start : 0);
      const id = declaration?.id as AstNode | null | undefined;
      const name = id && typeof id.name === 'string' ? id.name : 'default';
      const declType = declaration?.type as string | undefined;
      const kind: SymbolKind =
        declType === 'FunctionDeclaration'
          ? 'function'
          : declType === 'ClassDeclaration'
            ? 'class'
            : 'default';
      symbols.push({ name, kind, line, exported: true });
      continue;
    }

    if (type === 'ExportAllDeclaration') {
      const source = node.source as AstNode | null | undefined;
      const exported = node.exported as AstNode | null | undefined;
      const line = lineForOffset(lineOffsets, typeof node.start === 'number' ? node.start : 0);
      const exportName =
        exported && typeof exported.name === 'string'
          ? exported.name
          : source && typeof source.value === 'string'
            ? `* from ${source.value}`
            : '*';
      symbols.push({ name: exportName, kind: 'reexport', line, exported: true });
      if (source && typeof source.value === 'string') {
        addImportEdge(edges, file.path, source.value, ['*'], allPaths, node.exportKind === 'type');
      }
      continue;
    }

    extractDeclarationSymbols(node, false, lineOffsets, symbols, exportedNames);
  }

  for (const sym of symbols) {
    if (exportedNames.has(sym.name)) sym.exported = true;
  }

  const dedupedSymbols: SymbolEntry[] = [];
  const seen = new Set<string>();
  for (const sym of symbols) {
    const key = `${sym.name}:${sym.kind}:${sym.exported}:${sym.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedSymbols.push(sym);
  }

  const exports = dedupedSymbols.filter((sym) => sym.exported);
  const imports = [...edges.values()].sort((a, b) => a.specifier.localeCompare(b.specifier));
  const parseError = result.errors.length > 0 ? result.errors[0].message.slice(0, 160) : undefined;

  return {
    path: file.path,
    kind: file.kind ?? 'source',
    bytes: file.bytes,
    exports,
    symbols: dedupedSymbols,
    imports,
    ...(parseError ? { parseError } : {}),
  };
}

function parseFallbackFile(file: SourceFile, allPaths: Set<string>): FileMapEntry {
  const ext = fileExtension(file.path);
  const lines = file.content.split('\n');
  const symbols: SymbolEntry[] = [];
  const edges = new Map<string, ImportEdge>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (ext === '.py') {
      const fn = line.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (fn) {
        symbols.push({
          name: fn[1],
          kind: 'function',
          line: lineNumber,
          exported: !fn[1].startsWith('_'),
        });
        continue;
      }
      const cls = line.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (cls) {
        symbols.push({
          name: cls[1],
          kind: 'class',
          line: lineNumber,
          exported: !cls[1].startsWith('_'),
        });
        continue;
      }
      const pyImp = line.match(/^from\s+(\.[A-Za-z0-9_.]*)\s+import\s+(.+)$/);
      if (pyImp) {
        const rel = pyImp[1].replace(/^\./, './').replace(/\./g, '/');
        addImportEdge(
          edges,
          file.path,
          rel,
          pyImp[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]),
          allPaths,
        );
      }
    } else if (ext === '.go') {
      const fn = line.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (fn) {
        symbols.push({
          name: fn[1],
          kind: 'function',
          line: lineNumber,
          exported: /^[A-Z]/.test(fn[1]),
        });
        continue;
      }
      const tp = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)/);
      if (tp) {
        symbols.push({
          name: tp[1],
          kind: tp[2] === 'interface' ? 'interface' : 'struct',
          line: lineNumber,
          exported: /^[A-Z]/.test(tp[1]),
        });
      }
    } else if (ext === '.rs') {
      const rs = line.match(
        /^(pub\s+)?(?:async\s+)?(fn|struct|enum|trait|mod|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (rs) {
        const mapKind: Record<string, SymbolKind> = {
          fn: 'function',
          struct: 'struct',
          enum: 'enum',
          trait: 'trait',
          mod: 'module',
          type: 'type',
          const: 'const',
        };
        symbols.push({
          name: rs[3],
          kind: mapKind[rs[2]] ?? 'const',
          line: lineNumber,
          exported: Boolean(rs[1]),
        });
      }
    } else if (ext === '.sh') {
      const sh = line.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/);
      if (sh) {
        symbols.push({ name: sh[1], kind: 'function', line: lineNumber, exported: true });
      }
    } else if (ext === '.ex' || ext === '.exs') {
      const exMod = line.match(/^\s*defmodule\s+([A-Za-z0-9_.]+)/);
      if (exMod) {
        symbols.push({ name: exMod[1], kind: 'module', line: lineNumber, exported: true });
        continue;
      }
      const exFn = line.match(/^\s*(defp?)\s+([a-z_][A-Za-z0-9_?!]*)/);
      if (exFn) {
        symbols.push({
          name: exFn[2],
          kind: 'function',
          line: lineNumber,
          exported: exFn[1] === 'def',
        });
      }
    } else if (ext === '.rb') {
      const rb = line.match(/^\s*(class|module|def)\s+([A-Za-z_][A-Za-z0-9_:?!]*)/);
      if (rb) {
        symbols.push({
          name: rb[2],
          kind: rb[1] === 'def' ? 'function' : rb[1] === 'class' ? 'class' : 'module',
          line: lineNumber,
          exported: true,
        });
      }
    } else if (ext === '.sql') {
      const sql = line.match(
        /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_."]*)/i,
      );
      if (sql) {
        symbols.push({ name: sql[1], kind: 'const', line: lineNumber, exported: true });
      }
    }
  }

  if (ext === '.json') {
    symbols.push({ name: 'default', kind: 'default', line: 1, exported: true });
  }

  return {
    path: file.path,
    kind: file.kind ?? 'source',
    bytes: file.bytes,
    exports: symbols.filter((s) => s.exported),
    symbols,
    imports: [...edges.values()],
  };
}

export function extractFileMap(file: SourceFile, allPaths: Set<string>): FileMapEntry {
  const ext = fileExtension(file.path);
  if (JS_TS_EXTS.has(ext)) {
    return parseJsTsFile(file, allPaths);
  }
  return parseFallbackFile(file, allPaths);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${bytes}B`;
}

function extractPackageScripts(packageJsonContent: string | undefined): string | null {
  if (!packageJsonContent) return null;
  try {
    const parsed = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
    if (!parsed.scripts) return null;
    const entries = Object.entries(parsed.scripts)
      .slice(0, 12)
      .map(([name, cmd]) => `${name}=${cmd}`);
    return entries.length ? entries.join(' | ') : null;
  } catch {
    return null;
  }
}

function extractDocOutline(docFile: SourceFile): string {
  const headings: string[] = [];
  const commands: string[] = [];
  for (const rawLine of docFile.content.split('\n')) {
    const line = rawLine.trim();
    if (/^#{1,2}\s+/.test(line) && headings.length < 6) {
      headings.push(line.replace(/^#+\s+/, ''));
    } else if (/^(?:bun|npm|pnpm|yarn|cargo|go|pytest)\s+/.test(line) && commands.length < 4) {
      commands.push(line);
    }
  }
  const parts: string[] = [];
  if (headings.length) parts.push(`headings: ${headings.join(', ')}`);
  if (commands.length) parts.push(`cmds: ${commands.join('; ')}`);
  return parts.length
    ? `${docFile.path} (${formatBytes(docFile.bytes)}) — ${parts.join(' | ')}`
    : `${docFile.path} (${formatBytes(docFile.bytes)})`;
}

function formatSymbolList(symbols: SymbolEntry[], limit: number): string {
  const shown = symbols.slice(0, limit).map((sym) => {
    const tag =
      sym.kind === 'function'
        ? 'fn'
        : sym.kind === 'interface'
          ? 'iface'
          : sym.kind === 'reexport'
            ? 'reexp'
            : sym.kind;
    return `${sym.name}:${tag}`;
  });
  if (symbols.length > limit) {
    shown.push(`+${symbols.length - limit}`);
  }
  return shown.join(', ');
}

export function renderRepoMapText(input: {
  repository: string;
  commit: string;
  coverage: CoverageStats;
  files: FileMapEntry[];
  packageJson?: string;
  docs?: SourceFile[];
  configs?: ManifestEntry[];
}): string {
  const { repository, commit, coverage, files, packageJson, docs, configs } = input;
  const lines: string[] = [
    `# Imprint Map @ ${commit.slice(0, 12)} (${repository})`,
    `Tracked: ${coverage.tracked} | source: ${coverage.byKind.source.count} | test: ${coverage.byKind.test.count} | generated: ${coverage.byKind.generated.count} | config: ${coverage.byKind.config.count} | doc: ${coverage.byKind.doc.count} | binary: ${coverage.byKind.binary.count} | silent-drops: ${coverage.silentlyDropped}`,
  ];

  if (coverage.generatedGroups.length) {
    const groups = coverage.generatedGroups
      .slice(0, 8)
      .map((group) => `${group.prefix} (${group.count}, ${formatBytes(group.bytes)})`);
    if (coverage.generatedGroups.length > 8) {
      groups.push(`+${coverage.generatedGroups.length - 8} groups`);
    }
    lines.push(`Generated: ${groups.join(', ')}`);
  }

  const scripts = extractPackageScripts(packageJson);
  if (scripts) {
    lines.push(`Scripts: ${scripts}`);
  }

  if (docs?.length) {
    lines.push('');
    lines.push(`## Docs (${docs.length})`);
    for (const doc of docs.slice(0, 12)) {
      lines.push(`- ${extractDocOutline(doc)}`);
    }
    if (docs.length > 12) {
      lines.push(`- +${docs.length - 12} more docs`);
    }
  }

  const sourceFiles = files.filter((file) => file.kind === 'source');
  if (sourceFiles.length) {
    lines.push('');
    lines.push(`## Source (${sourceFiles.length})`);
    for (const file of sourceFiles) {
      const localDeps = [
        ...new Set(
          file.imports.map((edge) => edge.resolved).filter((p): p is string => Boolean(p)),
        ),
      ];
      lines.push(`${file.path} (${formatBytes(file.bytes)})`);
      if (file.exports.length) {
        lines.push(`  exp: ${formatSymbolList(file.exports, 18)}`);
      } else if (file.symbols.length) {
        lines.push(`  sym: ${formatSymbolList(file.symbols, 12)}`);
      }
      if (localDeps.length) {
        lines.push(`  -> ${localDeps.join(', ')}`);
      }
      if (file.parseError) {
        lines.push(`  !parse: ${file.parseError}`);
      }
    }
  }

  const testFiles = files.filter((file) => file.kind === 'test');
  if (testFiles.length) {
    lines.push('');
    lines.push(`## Tests (${testFiles.length})`);
    for (const file of testFiles) {
      const localDeps = [
        ...new Set(
          file.imports.map((edge) => edge.resolved).filter((p): p is string => Boolean(p)),
        ),
      ];
      const depText = localDeps.length ? ` -> ${localDeps.join(', ')}` : '';
      lines.push(`- ${file.path}${depText}`);
    }
  }

  if (configs?.length) {
    lines.push('');
    lines.push(
      `## Config (${configs.length}): ${configs
        .slice(0, 20)
        .map((c) => c.path)
        .join(', ')}${configs.length > 20 ? `, +${configs.length - 20}` : ''}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function buildRepoMap(input: {
  repository: string;
  commit: string;
  manifest: ManifestEntry[];
  coverage: CoverageStats;
  codeFiles: SourceFile[];
  packageJson?: string;
  docs?: SourceFile[];
}): Promise<RepoMap> {
  const allPaths = new Set(input.manifest.map((entry) => entry.path));
  const files = input.codeFiles
    .map((file) => extractFileMap(file, allPaths))
    .sort((left, right) => left.path.localeCompare(right.path));

  const configs = input.manifest.filter((entry) => entry.kind === 'config');
  const text = renderRepoMapText({
    repository: input.repository,
    commit: input.commit,
    coverage: input.coverage,
    files,
    packageJson: input.packageJson,
    docs: input.docs,
    configs,
  });

  let symbolCount = 0;
  let exportCount = 0;
  let localEdgeCount = 0;
  let parseErrorCount = 0;
  for (const file of files) {
    symbolCount += file.symbols.length;
    exportCount += file.exports.length;
    localEdgeCount += file.imports.filter((edge) => edge.resolved !== null).length;
    if (file.parseError) parseErrorCount += 1;
  }

  const digest = await sha256(
    JSON.stringify({
      commit: input.commit,
      files: files.map((file) => ({
        path: file.path,
        exports: file.exports.map((s) => [s.name, s.kind, s.line]),
        imports: file.imports.map((e) => [e.specifier, e.resolved]),
      })),
      text,
    }),
  );

  return {
    digest,
    files,
    text,
    stats: {
      mappedFiles: files.length,
      symbolCount,
      exportCount,
      localEdgeCount,
      parseErrorCount,
      textBytes: encoder.encode(text).byteLength,
    },
  };
}
