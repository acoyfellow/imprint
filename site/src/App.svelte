<script lang="ts">
  import { onMount } from 'svelte';

  type StageNum = 1 | 2 | 3 | 4;
  type QueryId = 'symbol' | 'deps' | 'budget' | 'changed';
  type TokenKind = 'plain' | 'kw' | 'str' | 'num' | 'fn' | 'prop' | 'cmt' | 'flag' | 'cmd';
  type CodeToken = { kind: TokenKind; text: string };

  let stage = $state<StageNum>(4);
  let manualHold = $state(false);
  let activeQuery = $state<QueryId>('deps');
  let copiedKey = $state<string | null>(null);

  const installCmd = 'bun add github:acoyfellow/imprint';

  const stages: Array<{
    num: StageNum;
    short: string;
    name: string;
    metric: string;
    summary: string;
    ascii: string;
  }> = [
    {
      num: 1,
      short: 'index',
      name: '1. COMPLETE MANIFEST',
      metric: '2,304 / 2,304 TRACKED',
      summary:
        'git ls-tree -r -l -z indexes every tracked blob at the exact SHA and isolates generated trees.',
      ascii: `░▒▓ STAGE 01 // MANIFEST ▓▒░
┌──────────────────────────────────┐
│ commit   b8602d6d5ce5            │
│ tracked  2,304 blobs (53.0 MB)   │
│ ├─ src/       60 files  [SOURCE] │
│ ├─ tests/     56 files  [TEST]   │
│ └─ generated/ 2,148     [MUTED]  │
└──────────────────────────────────┘`,
    },
    {
      num: 2,
      short: 'map',
      name: '2. AST SYMBOL + IMPORT MAP',
      metric: '22.5 KB · 0 PARSE ERRORS',
      summary:
        'oxc-parser maps exports, declarations, and resolved local import edges across every source file.',
      ascii: `░▒▓ STAGE 02 // AST MAP ▓▒░
┌──────────────────────────────────┐
│ src/index.ts                     │
│  ├─ exp: GlobalOutbound, default │
│  ├─▶ src/mcp-handler.ts          │
│  ├─▶ src/tools/execute.ts        │
│  └─▶ src/auth/oauth-handler.ts   │
│ total: 350 exp · 365 local edges │
└──────────────────────────────────┘`,
    },
    {
      num: 3,
      short: 'slice',
      name: '3. ON-DEMAND GRAPH SLICING',
      metric: 'git cat-file --batch',
      summary:
        'Compose symbols, globs, regex grep, N-hop imports, and diffs with explicit byte budgets.',
      ascii: `░▒▓ STAGE 03 // OID SLICE ▓▒░
┌──────────────────────────────────┐
│ query   depsOf("src/index.ts",2) │
│ stream  git cat-file --batch     │
│ result  37 files · 0 generated   │
│ budget  [████████░░] 248/400 KB  │
│ drops   0 silent (omitted[] log) │
└──────────────────────────────────┘`,
    },
    {
      num: 4,
      short: 'verified',
      name: '4. COMMIT PROOF GATE',
      metric: 'VERIFIED · 188 MS',
      summary:
        'Lean release JSON stores manifest, AST map, digests, and repo-wide checks—zero file blobs.',
      ascii: `░▒▓ STAGE 04 // PROOF GATE ▓▒░
┌──────────────────────────────────┐
│ [✓] commit-resolved   b8602d6    │
│ [✓] manifest-complete 2304/2304  │
│ [✓] source-coverage   60/60 src  │
│ [✓] map-bound         22.5 KB    │
│ [✓] no-broken-marker  repo-wide  │
└──────────────┬───────────────────┘
               ▼ promote -> ACTIVE`,
    },
  ];

  const footerAscii = [
    ' ___ __  __ ___ ___ ___ _  _ _____ ',
    '|_ _|  \\/  | _ \\ _ \\_ _| \\| |_   _|',
    ' | || |\\/| |  _/   /| || .` | | |  ',
    '|___|_|  |_|_| |_|_\\___|_|\\_| |_|  ',
  ].join('\n');

  const TS_KEYWORDS = new Set([
    'import',
    'from',
    'const',
    'let',
    'new',
    'await',
    'async',
    'return',
    'export',
    'type',
  ]);

  function tokenizeTs(code: string): CodeToken[] {
    const tokens: CodeToken[] = [];
    const re =
      /(\/\/[^\n]*|'[^']*'|"[^"]*"|\b\d[\d_]*\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*:)|\b[A-Za-z_$][A-Za-z0-9_$]*\b)/g;
    let last = 0;
    for (const match of code.matchAll(re)) {
      const idx = match.index ?? 0;
      if (idx > last) tokens.push({ kind: 'plain', text: code.slice(last, idx) });
      const text = match[0];
      let kind: TokenKind = 'plain';
      if (text.startsWith('//')) kind = 'cmt';
      else if (text.startsWith("'") || text.startsWith('"')) kind = 'str';
      else if (/^\d/.test(text)) kind = 'num';
      else if (TS_KEYWORDS.has(text)) kind = 'kw';
      else if (code[idx + text.length] === '(') kind = 'fn';
      else if (code[idx + text.length] === ':') kind = 'prop';
      tokens.push({ kind, text });
      last = idx + text.length;
    }
    if (last < code.length) tokens.push({ kind: 'plain', text: code.slice(last) });
    return tokens;
  }

  function tokenizeCli(command: string): CodeToken[] {
    const tokens: CodeToken[] = [];
    const re = /('[^']*'|"[^"]*"|--[a-z-]+|\b\d+\b|\S+)/g;
    let last = 0;
    let wordIndex = 0;
    for (const match of command.matchAll(re)) {
      const idx = match.index ?? 0;
      if (idx > last) tokens.push({ kind: 'plain', text: command.slice(last, idx) });
      const text = match[0];
      let kind: TokenKind = 'plain';
      if (wordIndex === 0) kind = 'cmd';
      else if (wordIndex === 1 && !text.startsWith('-')) kind = 'fn';
      else if (text.startsWith('--')) kind = 'flag';
      else if (text.startsWith("'") || text.startsWith('"')) kind = 'str';
      else if (/^\d+$/.test(text)) kind = 'num';
      tokens.push({ kind, text });
      last = idx + text.length;
      wordIndex += 1;
    }
    if (last < command.length) tokens.push({ kind: 'plain', text: command.slice(last) });
    return tokens;
  }

  const sdkMapSnippet = `import { Imprint } from '@acoyfellow/imprint';

const imprint = new Imprint({ directory: './repo' });
const repo = await imprint.open('HEAD');

console.log(repo.renderMap());
const slice = await repo.slice({
  symbols: ['GlobalOutbound'],
  depsOf: 'src/index.ts',
  depth: 2,
  maxBytes: 32_000,
});`;

  const sdkGateSnippet = `const release = await imprint.imprint('HEAD');
if (!release.proof.verified) {
  throw new Error('Commit failed proof gate');
}

await imprint.promote(release.commit);
await imprint.rollback('HEAD~1');
const diff = await imprint.diff('HEAD~1', 'HEAD');`;

  const queries: Record<
    QueryId,
    {
      chip: string;
      cli: string;
      sdk: string;
      matched: string;
      usedPct: number;
      budgetLabel: string;
      files: string[];
      note: string;
    }
  > = {
    symbol: {
      chip: '--symbol GlobalOutbound',
      cli: 'imprint slice HEAD --symbol GlobalOutbound --symbol oauthMcpHandler',
      sdk: "await repo.slice({ symbols: ['GlobalOutbound', 'oauthMcpHandler'] })",
      matched: '3 FILES',
      usedPct: 18,
      budgetLabel: '19.4 KB / 400 KB',
      files: ['src/index.ts', 'src/mcp-handler.ts', 'src/tools/execute.ts'],
      note: 'Instant AST symbol lookup at the exact commit—zero blind directory scans.',
    },
    deps: {
      chip: '--deps-of src/index.ts',
      cli: 'imprint slice HEAD --deps-of src/index.ts --depth 2',
      sdk: "await repo.slice({ depsOf: 'src/index.ts', depth: 2 })",
      matched: '37 FILES',
      usedPct: 62,
      budgetLabel: '248 KB / 400 KB',
      files: [
        'src/index.ts',
        'src/mcp-handler.ts',
        'src/tools/execute.ts',
        'src/auth/oauth-handler.ts',
        'src/skills/sync.ts',
        '+32 transitive local imports',
      ],
      note: 'BFS traversal over resolved local AST edges; hop-0 entrypoints prioritized first.',
    },
    budget: {
      chip: '--max-bytes 8000',
      cli: "imprint slice HEAD --path 'src/tools/*.ts' --max-bytes 8000",
      sdk: "await repo.slice({ paths: ['src/tools/*.ts'], maxBytes: 8_000 })",
      matched: '3 / 10 FILES',
      usedPct: 77,
      budgetLabel: '6,168 B / 8,000 B (7 OMITTED)',
      files: [
        'src/tools/api-call-result.ts  [INCLUDED]',
        'src/tools/response-body.ts    [INCLUDED]',
        'src/tools/tool-error.ts       [INCLUDED]',
        'src/tools/execute.ts          [OMITTED: budget]',
        '+6 more reported in truncation.omitted',
      ],
      note: 'Hard byte or token cap with explicit truncation.omitted reporting.',
    },
    changed: {
      chip: '--changed HEAD~1',
      cli: 'imprint slice HEAD --changed HEAD~1 --text',
      sdk: "await repo.slice({ changed: 'HEAD~1' })",
      matched: '7 FILES',
      usedPct: 24,
      budgetLabel: '31.2 KB / 400 KB',
      files: [
        'src/server.ts',
        'src/tools/forge-tools.ts',
        'src/tools/submit-feedback.ts',
        'src/tools/tool-error.ts',
        'src/tools/tool-list-response.ts',
        'tests/submit-feedback.test.ts',
        'wrangler.jsonc',
      ],
      note: 'Commit-to-commit diff automatically filters out generated noise.',
    },
  };

  function pickStage(next: StageNum) {
    manualHold = true;
    stage = next;
  }

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      stage = 4;
      return;
    }
    stage = 1;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const waitMs = stage === 4 ? 3200 : 1500;
      timer = setTimeout(() => {
        if (manualHold) return;
        stage = (stage === 4 ? 1 : stage + 1) as StageNum;
        schedule();
      }, waitMs);
    };
    schedule();
    return () => clearTimeout(timer);
  });

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    copiedKey = key;
    setTimeout(() => {
      if (copiedKey === key) copiedKey = null;
    }, 1400);
  }
</script>

<svelte:head>
  <title>IMPRINT — commit-bound repo artifact</title>
</svelte:head>

<div class="app">
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/" aria-label="Imprint home">
        <span class="stamp" aria-hidden="true">▓</span>
        <strong>IMPRINT</strong>
        <span class="rev">V2</span>
      </a>
      <div class="top-meta">
        <span class="chip-live"><i aria-hidden="true"></i> 0 SILENT DROPS</span>
        <nav>
          <a href="#capabilities">SPEC</a>
          <a href="#query">SLICE</a>
          <a href="#sdk">SDK</a>
          <a href="https://github.com/acoyfellow/imprint">GITHUB ↗</a>
        </nav>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="hero-left">
        <p class="eyebrow">░▒▓ COMMIT-BOUND REPO ARTIFACT</p>
        <h1>
          TURN ANY GIT<br />
          COMMIT INTO A<br />
          <em>QUERYABLE MAP.</em>
        </h1>
        <p class="sub">
          Index 100% of tracked files, compile a compact <code>oxc-parser</code> AST symbol
          &amp; import map, and slice exact blobs on demand by <code>oid</code>—with honest
          proof gates on every release.
        </p>

        <ol class="step-rail" aria-label="Imprint lifecycle stages">
          {#each stages as s}
            <li>
              <button
                type="button"
                class:on={stage === s.num}
                class:done={stage > s.num}
                onclick={() => pickStage(s.num)}
              >
                <span class="tick" class:on={stage === s.num} class:done={stage > s.num}></span>
                {s.num} {s.short}
              </button>
            </li>
          {/each}
        </ol>

        <div class="install-box">
          <span class="sig">$</span>
          <code>{#each tokenizeCli(installCmd) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code>
          <button type="button" onclick={() => copyText('install', installCmd)}>
            {copiedKey === 'install' ? 'COPIED ✓' : 'COPY'}
          </button>
        </div>

        <div class="actions">
          <a
            class="cta warm"
            href="https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/imprint"
          >
            DEPLOY WORKER ↗
          </a>
          <button
            type="button"
            class="cta"
            onclick={() => copyText('prove', 'bun run prove')}
          >
            {copiedKey === 'prove' ? 'COPIED: bun run prove ✓' : 'RUN: bun run prove'}
          </button>
          <a class="cta dim" href="https://github.com/acoyfellow/imprint">SOURCE ↗</a>
        </div>
      </div>

      <div class="hero-right">
        <div class="die-bench" data-stage={stage}>
          <div class="bench-head">
            <span>COMMIT STACK · {stages[stage - 1].short.toUpperCase()}</span>
            <span class="sha" class:verified={stage === 4}>
              {stage === 4 ? 'PROOF VERIFIED ✓' : 'SHA b8602d6'}
            </span>
          </div>

          <div class="strata-wrap dither-field">
            <svg
              class="strata-svg"
              viewBox="0 0 384 268"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              shape-rendering="crispEdges"
              aria-label="Animated dithered isometric Imprint commit layers"
            >
              <defs>
                <pattern id="ditherSage" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="4" height="4" fill="#1b2622" />
                  <rect x="0" y="0" width="2" height="2" fill="#7ec4a0" fill-opacity="0.22" />
                  <rect x="2" y="2" width="2" height="2" fill="#7ec4a0" fill-opacity="0.22" />
                </pattern>
                <pattern id="ditherAmber" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="4" height="4" fill="#282019" />
                  <rect x="0" y="0" width="2" height="2" fill="#e28743" fill-opacity="0.26" />
                  <rect x="2" y="2" width="2" height="2" fill="#e28743" fill-opacity="0.26" />
                </pattern>
                <pattern id="ditherSky" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="4" height="4" fill="#1d242e" />
                  <rect x="0" y="0" width="2" height="2" fill="#8eb2d9" fill-opacity="0.24" />
                  <rect x="2" y="2" width="2" height="2" fill="#8eb2d9" fill-opacity="0.24" />
                </pattern>
                <pattern id="ditherDim" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="4" height="4" fill="#1b1f25" />
                  <rect x="0" y="0" width="1" height="1" fill="#6f7270" fill-opacity="0.28" />
                  <rect x="2" y="2" width="1" height="1" fill="#6f7270" fill-opacity="0.28" />
                </pattern>
              </defs>

              <g opacity="0.35" stroke="#75787a" stroke-width="1">
                <path
                  class="rail-draw"
                  class:on={stage >= 2}
                  pathLength="1"
                  d="M216 198 L216 132"
                  stroke="#7ec4a0"
                />
                <path
                  class="rail-draw"
                  class:on={stage >= 3}
                  pathLength="1"
                  d="M216 132 L216 66"
                  stroke="#e28743"
                />
                <line x1="108" y1="74" x2="108" y2="198" stroke-dasharray="2 4" />
                <line x1="324" y1="74" x2="324" y2="198" stroke-dasharray="2 4" />
              </g>

              <g
                class="layer-group"
                class:lit={stage >= 1}
                class:focus={stage === 1 || stage === 4}
                role="button"
                tabindex="0"
                aria-label="Stage 1 Complete Manifest"
                onclick={() => pickStage(1)}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pickStage(1)}
              >
                <polygon
                  class="slab-draw"
                  class:on={stage >= 1}
                  pathLength="1"
                  points="216,150 324,198 216,246 108,198"
                  fill={stage >= 1 ? 'url(#ditherSage)' : 'url(#ditherDim)'}
                  stroke={stage >= 1 ? '#7ec4a0' : '#525760'}
                  stroke-width={stage === 1 || stage === 4 ? '1.8' : '1.2'}
                />
                <polygon
                  points="108,198 216,246 216,256 108,208"
                  fill="#151d1a"
                  stroke={stage >= 1 ? '#7ec4a0' : '#525760'}
                  stroke-width="1.1"
                />
                <polygon
                  points="216,246 324,198 324,208 216,256"
                  fill="#1e2c26"
                  stroke={stage >= 1 ? '#7ec4a0' : '#525760'}
                  stroke-width="1.1"
                />
                <g class="fade-in" class:on={stage >= 1} fill="#7ec4a0">
                  <polygon points="216,174 236,183 216,192 196,183" opacity="0.85" />
                  <polygon points="188,187 208,196 188,205 168,196" opacity="0.55" />
                  <polygon points="244,187 264,196 244,205 224,196" opacity="0.55" />
                  <polygon points="216,200 236,209 216,218 196,209" opacity="0.78" />
                </g>
                <text x="12" y="203" fill={stage >= 1 ? '#7ec4a0' : '#7b7d78'} font-family="IBM Plex Mono, monospace" font-size="10">L1 MANIFEST</text>
              </g>

              <g
                class="layer-group"
                class:lit={stage >= 2}
                class:focus={stage === 2 || stage === 4}
                role="button"
                tabindex="0"
                aria-label="Stage 2 AST Symbol Map"
                onclick={() => pickStage(2)}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pickStage(2)}
              >
                <polygon
                  class="slab-draw"
                  class:on={stage >= 2}
                  pathLength="1"
                  points="216,84 324,132 216,180 108,132"
                  fill={stage >= 2 ? 'url(#ditherAmber)' : 'url(#ditherDim)'}
                  stroke={stage >= 2 ? '#e28743' : '#525760'}
                  stroke-width={stage === 2 || stage === 4 ? '1.8' : '1.2'}
                />
                <polygon
                  points="108,132 216,180 216,190 108,142"
                  fill="#211a14"
                  stroke={stage >= 2 ? '#e28743' : '#525760'}
                  stroke-width="1.1"
                />
                <polygon
                  points="216,180 324,132 324,142 216,190"
                  fill="#30241b"
                  stroke={stage >= 2 ? '#e28743' : '#525760'}
                  stroke-width="1.1"
                />
                <g class="fade-in" class:on={stage >= 2}>
                  <path
                    class="rail-draw"
                    class:on={stage >= 2}
                    pathLength="1"
                    d="M216 110 L176 130 L216 152 L256 130 Z"
                    stroke="#f0ad74"
                    stroke-width="1.5"
                  />
                  <rect class="node-pop" class:on={stage >= 2} style="transition-delay:0ms" x="212" y="106" width="8" height="8" fill="#e28743" />
                  <rect class="node-pop" class:on={stage >= 2} style="transition-delay:110ms" x="172" y="126" width="8" height="8" fill="#e28743" />
                  <rect class="node-pop" class:on={stage >= 2} style="transition-delay:220ms" x="252" y="126" width="8" height="8" fill="#e28743" />
                  <rect class="node-pop" class:on={stage >= 2} style="transition-delay:330ms" x="212" y="148" width="8" height="8" fill="#7ec4a0" />
                </g>
                <text x="12" y="137" fill={stage >= 2 ? '#e8a269' : '#7b7d78'} font-family="IBM Plex Mono, monospace" font-size="10">L2 AST MAP</text>
              </g>

              <g
                class="layer-group"
                class:lit={stage >= 3}
                class:focus={stage === 3 || stage === 4}
                role="button"
                tabindex="0"
                aria-label="Stage 3 On-Demand Slice"
                onclick={() => pickStage(3)}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pickStage(3)}
              >
                <polygon
                  class="slab-draw"
                  class:on={stage >= 3}
                  pathLength="1"
                  points="216,18 324,66 216,114 108,66"
                  fill={stage >= 3 ? 'url(#ditherSky)' : 'url(#ditherDim)'}
                  stroke={stage >= 3 ? '#8eb2d9' : '#525760'}
                  stroke-width={stage === 3 || stage === 4 ? '1.8' : '1.2'}
                />
                <polygon
                  points="108,66 216,114 216,124 108,76"
                  fill="#171d26"
                  stroke={stage >= 3 ? '#8eb2d9' : '#525760'}
                  stroke-width="1.1"
                />
                <polygon
                  points="216,114 324,66 324,76 216,124"
                  fill="#212b38"
                  stroke={stage >= 3 ? '#8eb2d9' : '#525760'}
                  stroke-width="1.1"
                />
                <g class="fade-in" class:on={stage >= 3}>
                  <polygon
                    points="216,42 270,66 216,90 162,66"
                    fill="none"
                    stroke="#8eb2d9"
                    stroke-width="1.4"
                    stroke-dasharray="4 3"
                  />
                  <rect x="211" y="61" width="10" height="10" fill="#eae5d9" />
                </g>
                <text x="12" y="71" fill={stage >= 3 ? '#8eb2d9' : '#7b7d78'} font-family="IBM Plex Mono, monospace" font-size="10">L3 SLICE</text>
              </g>

              {#if stage >= 3}
                <circle r="3.5" fill="#7ec4a0" class="signal-dot">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M216 198 L216 132 L216 66" />
                </circle>
              {/if}
              {#if stage === 4}
                <circle r="3.5" fill="#e28743" class="signal-dot">
                  <animateMotion dur="2s" begin="1s" repeatCount="indefinite" path="M216 66 L216 132 L216 198" />
                </circle>
              {/if}
            </svg>
          </div>

          <div class="layer-readout">
            <div class="readout-top">
              <strong>{stages[stage - 1].name}</strong>
              <span class="pill">{stages[stage - 1].metric}</span>
            </div>
            <p>{stages[stage - 1].summary}</p>
            <pre class="ascii-panel"><code>{stages[stage - 1].ascii}</code></pre>
          </div>
        </div>
      </div>
    </section>

    <div class="dither-divider" aria-hidden="true"></div>

    <section class="surface-band" id="capabilities">
      <div class="container">
        <div class="sec-head">
          <span class="tag">░▒▓ 01 · WHAT EVERY COMMIT SHIPS</span>
          <h2>COMPLETE. COMPACT. VERIFIED.</h2>
        </div>

        <div class="cap-grid">
          <article>
            <div class="cap-top">
              <span>01 / MANIFEST</span>
              <b>2,304 / 2,304</b>
            </div>
            <h3>ZERO SILENT DROPS</h3>
            <p>
              Indexes every tracked blob at the exact Git commit via
              <code>git ls-tree -r -l -z</code>, classifies source, tests, generated trees,
              config, and docs, and records full coverage stats.
            </p>
            <div class="card-dither" aria-hidden="true"></div>
          </article>

          <article>
            <div class="cap-top">
              <span>02 / AST MAP</span>
              <b>22.5 KB</b>
            </div>
            <h3>WHOLE REPO IN ONE READ</h3>
            <p>
              <code>oxc-parser</code> extracts exports, top-level declarations, and resolved local
              import edges for TS/JS (with fallback parsers for Python, Go, Rust, SQL, and more).
            </p>
            <div class="card-dither" aria-hidden="true"></div>
          </article>

          <article>
            <div class="cap-top">
              <span>03 / SLICING</span>
              <b>ON-DEMAND OID</b>
            </div>
            <h3>GRAPH + SYMBOL QUERIES</h3>
            <p>
              Compose <code>symbols</code>, <code>paths</code> globs, literal or regex
              <code>grep</code>, <code>depsOf</code> import traversal, and <code>changed</code>
              diffs—streamed via <code>git cat-file --batch</code> under strict byte budgets.
            </p>
            <div class="card-dither" aria-hidden="true"></div>
          </article>

          <article>
            <div class="cap-top">
              <span>04 / PROOF GATE</span>
              <b>188 MS</b>
            </div>
            <h3>LEAN ARTIFACT. HARD GATE.</h3>
            <p>
              Persists manifest, AST map, digests, and whole-repo checks to
              <code>.imprint/releases/&lt;sha&gt;.json</code> with zero duplicated file blobs.
              <code>promote</code> refuses any unverified commit.
            </p>
            <div class="card-dither" aria-hidden="true"></div>
          </article>
        </div>
      </div>
    </section>

    <div class="dither-divider flip" aria-hidden="true"></div>

    <section class="base-band" id="query">
      <div class="container">
        <div class="sec-head">
          <span class="tag">░▒▓ 02 · INTERACTIVE SLICE SIMULATOR</span>
          <h2>QUERY THE EXACT COMMIT.</h2>
        </div>

        <div class="query-chips" role="tablist" aria-label="Slice queries">
          {#each Object.entries(queries) as [id, item]}
            <button
              type="button"
              role="tab"
              aria-selected={activeQuery === id}
              class:active={activeQuery === id}
              onclick={() => (activeQuery = id as QueryId)}
            >
              {item.chip}
            </button>
          {/each}
        </div>

        <div class="query-deck">
          <div class="deck-left">
            <div class="kv">
              <span>CLI</span>
              <code>{#each tokenizeCli(queries[activeQuery].cli) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code>
              <button
                type="button"
                class="mini-copy"
                onclick={() => copyText(activeQuery, queries[activeQuery].cli)}
              >
                {copiedKey === activeQuery ? '✓' : 'COPY'}
              </button>
            </div>
            <div class="kv">
              <span>SDK</span>
              <code>{#each tokenizeTs(queries[activeQuery].sdk) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code>
            </div>
            <div class="budget-meter">
              <div class="budget-top">
                <span>MATCHED: <b>{queries[activeQuery].matched}</b></span>
                <span>{queries[activeQuery].budgetLabel}</span>
              </div>
              <div class="meter-track">
                <div class="meter-fill" style={`width:${queries[activeQuery].usedPct}%`}></div>
              </div>
              <p class="deck-note">{queries[activeQuery].note}</p>
            </div>
          </div>

          <div class="deck-right">
            <div class="file-head">┌─ COMMIT-BOUND FILES (VIA GIT OID)</div>
            <ul class="file-list">
              {#each queries[activeQuery].files as file}
                <li>{file}</li>
              {/each}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <div class="dither-divider" aria-hidden="true"></div>

    <section class="surface-band" id="sdk">
      <div class="container">
        <div class="sec-head">
          <span class="tag">░▒▓ 03 · INSTALL FROM GITHUB</span>
          <h2>TWO CALLS TO START.</h2>
        </div>

        <div class="sdk-grid">
          <article>
            <div class="card-top">
              <span>01 / MAP &amp; SLICE</span>
              <em>OFFLINE · NO API KEY NEEDED</em>
            </div>
            <pre><code>{#each tokenizeTs(sdkMapSnippet) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code></pre>
          </article>

          <article>
            <div class="card-top">
              <span>02 / VERIFY &amp; GATE</span>
              <em>REFUSES UNVERIFIED COMMITS</em>
            </div>
            <pre><code>{#each tokenizeTs(sdkGateSnippet) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code></pre>
          </article>
        </div>

        <div class="gh-bar">
          <span>GITHUB PACKAGE</span>
          <code>{#each tokenizeCli(installCmd) as tok}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}</code>
          <button type="button" onclick={() => copyText('gh-foot', installCmd)}>
            {copiedKey === 'gh-foot' ? 'COPIED ✓' : 'COPY'}
          </button>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <pre class="ascii-logo" aria-hidden="true">{footerAscii}</pre>
      <div class="footer-meta">
        <span>IMPRINT · MIT · GITHUB:ACOYFELLOW/IMPRINT</span>
        <span>BUILT ON CLOUDFLARE <i aria-hidden="true"></i></span>
      </div>
    </div>
  </footer>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Silkscreen:wght@400;700&display=swap');

  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    scroll-behavior: smooth;
    background: #16191d;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #16191d;
    color: #eae5d9;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    -webkit-font-smoothing: antialiased;
  }

  :global(::selection) {
    background: #e28743;
    color: #16191d;
  }

  .app {
    min-height: 100vh;
    overflow-x: clip;
    background-color: #16191d;
    background-image: radial-gradient(rgba(234, 229, 217, 0.055) 1px, transparent 1px);
    background-size: 16px 16px;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    background: rgba(22, 25, 29, 0.92);
    border-bottom: 1px solid #30353d;
    backdrop-filter: blur(8px);
  }

  .topbar-inner {
    max-width: 1140px;
    margin: 0 auto;
    height: 60px;
    padding: 0 clamp(16px, 4vw, 40px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #eae5d9;
    text-decoration: none;
    letter-spacing: 0.16em;
    font-size: 13px;
  }

  .stamp {
    color: #e28743;
    font-size: 16px;
    line-height: 1;
  }

  .rev {
    padding: 2px 6px;
    border: 1px solid #3b414b;
    color: #9e9a8e;
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  .top-meta {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .chip-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 8px;
    border: 1px solid #334a40;
    background: #1b2521;
    color: #7ec4a0;
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  .chip-live i {
    width: 6px;
    height: 6px;
    background: #7ec4a0;
    display: block;
  }

  nav {
    display: flex;
    gap: 20px;
  }

  nav a {
    color: #a6a296;
    text-decoration: none;
    font-size: 11px;
    letter-spacing: 0.14em;
  }

  nav a:hover {
    color: #e28743;
  }

  .hero {
    max-width: 1140px;
    margin: 0 auto;
    padding: clamp(40px, 6vh, 72px) clamp(16px, 4vw, 40px) clamp(48px, 6vh, 76px);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(28px, 4vw, 52px);
    align-items: center;
  }

  .hero-left,
  .hero-right,
  .die-bench,
  .deck-left,
  .deck-right,
  .cap-grid article,
  .sdk-grid article {
    min-width: 0;
  }

  .eyebrow {
    margin: 0 0 18px;
    font-size: 10px;
    letter-spacing: 0.18em;
    color: #7ec4a0;
  }

  h1 {
    margin: 0;
    font-family: 'Silkscreen', 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: clamp(28px, 4vw, 48px);
    line-height: 1.15;
    letter-spacing: 0.04em;
    color: #f0ebe0;
  }

  h1 em {
    font-style: normal;
    color: #e28743;
  }

  .sub {
    margin: 18px 0 20px;
    max-width: 520px;
    font-size: 13px;
    line-height: 1.82;
    color: #b0aba0;
  }

  .sub code {
    padding: 1px 5px;
    border: 1px solid #353b44;
    background: #1d2127;
    color: #eae5d9;
    font-size: 12px;
    white-space: nowrap;
  }

  .step-rail {
    list-style: none;
    padding: 0;
    margin: 0 0 22px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
  }

  .step-rail button {
    appearance: none;
    cursor: pointer;
    border: 0;
    padding: 0;
    background: transparent;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: 500 11px/1 'IBM Plex Mono', monospace;
    letter-spacing: 0.08em;
    color: #7d7a72;
    transition: color 180ms ease;
  }

  .step-rail button.done {
    color: #aba69b;
  }

  .step-rail button.on {
    color: #f0ebe0;
    font-weight: 700;
  }

  .tick {
    width: 7px;
    height: 7px;
    border: 1.5px solid #595e66;
    display: inline-block;
    transition: background 180ms ease, border-color 180ms ease;
  }

  .tick.done {
    border-color: #7ec4a0;
    background: rgba(126, 196, 160, 0.35);
  }

  .tick.on {
    border-color: #e28743;
    background: #e28743;
  }

  .install-box {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 500px;
    padding: 8px 8px 8px 14px;
    margin-bottom: 16px;
    border: 1.5px solid #484f5a;
    background: #1b1f25;
    box-shadow: 4px 4px 0 #0e1013;
  }

  .install-box .sig {
    color: #7ec4a0;
    font-weight: 700;
    flex-shrink: 0;
  }

  .install-box code {
    flex: 1;
    min-width: 0;
    overflow: auto;
    white-space: nowrap;
    font-size: 12px;
  }

  .install-box button {
    appearance: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 8px 12px;
    border: 1px solid #16191d;
    background: #e28743;
    color: #16191d;
    font: 700 10px/1 'IBM Plex Mono', monospace;
    letter-spacing: 0.14em;
  }

  .install-box button:hover {
    background: #eba064;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .cta {
    appearance: none;
    cursor: pointer;
    padding: 11px 15px;
    border: 1.5px solid #3c424d;
    background: #1d2127;
    color: #eae5d9;
    text-decoration: none;
    font: 600 11px/1 'IBM Plex Mono', monospace;
    letter-spacing: 0.12em;
    box-shadow: 3px 3px 0 #0e1013;
    transition: transform 80ms steps(2), border-color 80ms steps(2);
  }

  .cta:hover {
    transform: translate(-2px, -2px);
    border-color: #c9c3b6;
  }

  .cta.warm {
    background: #eae5d9;
    border-color: #eae5d9;
    color: #16191d;
  }

  .cta.dim {
    background: transparent;
  }

  .die-bench {
    border: 1.5px solid #3a404a;
    background: #1b1f25;
    box-shadow: 6px 6px 0 #0e1013;
  }

  .bench-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #2e333c;
    background: #20252c;
    font-size: 10px;
    letter-spacing: 0.14em;
    color: #a6a296;
  }

  .bench-head .sha {
    color: #e28743;
    font-weight: 600;
    transition: color 220ms ease;
  }

  .bench-head .sha.verified {
    color: #7ec4a0;
  }

  .dither-field {
    background-color: #171a1f;
    background-image:
      linear-gradient(45deg, rgba(234, 229, 217, 0.03) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(234, 229, 217, 0.03) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(234, 229, 217, 0.03) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(234, 229, 217, 0.03) 75%);
    background-size: 6px 6px;
    background-position: 0 0, 0 3px, 3px -3px, -3px 0;
  }

  .strata-wrap {
    padding: 12px 12px 6px;
    display: grid;
    place-items: center;
  }

  .strata-svg {
    width: 100%;
    max-width: 384px;
    height: auto;
  }

  .layer-group {
    cursor: pointer;
    opacity: 0.48;
    transition: opacity 280ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .layer-group.lit {
    opacity: 1;
  }

  .layer-group.focus {
    transform: translateY(-4px);
  }

  .slab-draw,
  .rail-draw {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 520ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .slab-draw.on,
  .rail-draw.on {
    stroke-dashoffset: 0;
  }

  .fade-in {
    opacity: 0;
    transition: opacity 320ms ease 140ms;
  }

  .fade-in.on {
    opacity: 1;
  }

  .node-pop {
    opacity: 0;
    transition: opacity 260ms ease;
  }

  .node-pop.on {
    opacity: 1;
  }

  .layer-readout {
    padding: 16px 18px 18px;
    border-top: 1px solid #2e333c;
  }

  .readout-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .readout-top strong {
    font-size: 12px;
    letter-spacing: 0.1em;
    color: #f0ebe0;
  }

  .pill {
    padding: 3px 7px;
    border: 1px solid #354c42;
    background: #1b2521;
    color: #7ec4a0;
    font-size: 10px;
    letter-spacing: 0.08em;
  }

  .layer-readout p {
    margin: 0 0 12px;
    font-size: 11.5px;
    line-height: 1.65;
    color: #a6a296;
  }

  .ascii-panel {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid #2e333c;
    background: #14171b;
    color: #ded8ca;
    font-size: 11px;
    line-height: 1.55;
    overflow: auto;
  }

  .dither-divider {
    height: 18px;
    background-color: #16191d;
    background-image:
      radial-gradient(#242931 1px, transparent 1px),
      radial-gradient(#242931 1px, transparent 1px),
      radial-gradient(#242931 1.5px, transparent 1.5px);
    background-size: 8px 6px, 4px 6px, 4px 6px;
    background-position: 0 0, 2px 6px, 0 12px;
    background-repeat: repeat-x;
  }

  .dither-divider.flip {
    transform: scaleY(-1);
  }

  .surface-band {
    background: #1d2127;
  }

  .base-band {
    background: #16191d;
  }

  .container {
    max-width: 1140px;
    margin: 0 auto;
    padding: 64px clamp(16px, 4vw, 40px);
  }

  .sec-head {
    margin-bottom: 30px;
  }

  .tag {
    display: inline-block;
    padding: 4px 8px;
    margin-bottom: 12px;
    border: 1px solid #3b414b;
    background: #16191d;
    color: #e28743;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
  }

  h2 {
    margin: 0;
    font-family: 'Silkscreen', 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: clamp(20px, 2.7vw, 30px);
    letter-spacing: 0.06em;
    color: #f0ebe0;
  }

  .cap-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }

  .cap-grid article {
    position: relative;
    padding: 22px 22px 28px;
    border: 1.5px solid #363c46;
    background: #171a1f;
    box-shadow: 4px 4px 0 #0e1013;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
  }

  .card-dither {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 8px;
    background-image:
      linear-gradient(45deg, rgba(226, 135, 67, 0.24) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(226, 135, 67, 0.24) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(226, 135, 67, 0.24) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(226, 135, 67, 0.24) 75%);
    background-size: 4px 4px;
    background-position: 0 0, 0 2px, 2px -2px, -2px 0;
  }

  .cap-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: #9e9a8e;
  }

  .cap-top b {
    padding: 3px 7px;
    border: 1px solid #354c42;
    background: #1b2521;
    color: #7ec4a0;
    font-size: 10px;
    letter-spacing: 0.1em;
  }

  .cap-grid h3 {
    margin: 0;
    font-family: 'Silkscreen', 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 15px;
    letter-spacing: 0.06em;
    color: #f0ebe0;
  }

  .cap-grid p {
    margin: 0;
    font-size: 12px;
    line-height: 1.78;
    color: #b0aba0;
  }

  .cap-grid code {
    padding: 1px 4px;
    border: 1px solid #30353d;
    background: #20252c;
    color: #eae5d9;
    font-size: 11px;
    white-space: nowrap;
  }

  .query-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 18px;
  }

  .query-chips button {
    appearance: none;
    cursor: pointer;
    padding: 10px 14px;
    border: 1.5px solid #363c46;
    background: #1d2127;
    color: #b8b3a8;
    font: 600 11px/1 'IBM Plex Mono', monospace;
    letter-spacing: 0.05em;
    box-shadow: 3px 3px 0 #0e1013;
  }

  .query-chips button.active {
    background: #e28743;
    border-color: #f0ebe0;
    color: #16191d;
  }

  .query-deck {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    border: 1.5px solid #363c46;
    background: #1b1f25;
    box-shadow: 6px 6px 0 #0e1013;
  }

  .deck-left {
    padding: 22px;
    border-right: 1px solid #2e333c;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .kv {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid #2e333c;
    background: #14171b;
    min-width: 0;
  }

  .kv > span {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #e28743;
    flex-shrink: 0;
  }

  .kv code {
    flex: 1;
    min-width: 0;
    overflow: auto;
    white-space: nowrap;
    font-size: 11.5px;
  }

  .mini-copy {
    appearance: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 5px 8px;
    border: 1px solid #454c57;
    background: transparent;
    color: #eae5d9;
    font: 600 10px/1 'IBM Plex Mono', monospace;
  }

  .budget-meter {
    margin-top: auto;
    padding-top: 8px;
  }

  .budget-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
    margin-bottom: 8px;
    color: #a6a296;
  }

  .budget-top b {
    color: #7ec4a0;
  }

  .meter-track {
    height: 12px;
    border: 1px solid #3c424d;
    background: #14171b;
    padding: 1px;
  }

  .meter-fill {
    height: 100%;
    background-color: #7ec4a0;
    background-image:
      linear-gradient(45deg, rgba(22, 25, 29, 0.22) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(22, 25, 29, 0.22) 25%, transparent 25%);
    background-size: 4px 4px;
    transition: width 200ms steps(6);
  }

  .deck-note {
    margin: 12px 0 0;
    font-size: 11.5px;
    line-height: 1.65;
    color: #a6a296;
  }

  .deck-right {
    padding: 22px;
    background: #16191d;
  }

  .file-head {
    font-size: 10px;
    letter-spacing: 0.14em;
    color: #7ec4a0;
    margin-bottom: 14px;
  }

  .file-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }

  .file-list li {
    padding: 8px 10px;
    border: 1px solid #2b3038;
    background: #1c2026;
    font-size: 11.5px;
    color: #eae5d9;
    overflow-wrap: anywhere;
  }

  .sdk-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    margin-bottom: 18px;
  }

  .sdk-grid article {
    border: 1.5px solid #363c46;
    background: #16191d;
    box-shadow: 4px 4px 0 #0e1013;
    display: flex;
    flex-direction: column;
  }

  .card-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    padding: 12px 16px;
    border-bottom: 1px solid #2e333c;
    background: #20252c;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #f0ebe0;
  }

  .card-top em {
    font-style: normal;
    font-size: 10px;
    font-weight: 500;
    color: #9e9a8e;
  }

  .sdk-grid pre {
    margin: 0;
    padding: 18px;
    flex: 1;
    background: #14171b;
    overflow: auto;
    font-size: 11.5px;
    line-height: 1.78;
  }

  .gh-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    border: 1.5px solid #363c46;
    background: #16191d;
    box-shadow: 4px 4px 0 #0e1013;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #a6a296;
  }

  .gh-bar code {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    overflow: auto;
    white-space: nowrap;
  }

  .gh-bar button {
    appearance: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 8px 14px;
    border: 1px solid #16191d;
    background: #e28743;
    color: #16191d;
    font: 700 10px/1 'IBM Plex Mono', monospace;
    letter-spacing: 0.14em;
  }

  .footer {
    background: #121519;
    border-top: 1px solid #2c313a;
    color: #8f8b80;
  }

  .footer-inner {
    max-width: 1140px;
    margin: 0 auto;
    padding: 32px clamp(16px, 4vw, 40px) 44px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .ascii-logo {
    margin: 0;
    font-size: 10px;
    line-height: 1.25;
    color: #6b685f;
    overflow: auto;
  }

  .footer-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 10px;
    letter-spacing: 0.16em;
  }

  .footer i {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #e28743;
    margin-left: 8px;
  }

  .tok-plain {
    color: #eae5d9;
  }

  .tok-kw {
    color: #e28743;
    font-weight: 600;
  }

  .tok-str {
    color: #7ec4a0;
  }

  .tok-num {
    color: #e6c675;
  }

  .tok-fn {
    color: #8eb2d9;
  }

  .tok-prop {
    color: #c5a8d4;
  }

  .tok-cmt {
    color: #73777f;
    font-style: italic;
  }

  .tok-flag {
    color: #e6c675;
  }

  .tok-cmd {
    color: #e28743;
    font-weight: 600;
  }

  @media (max-width: 920px) {
    .chip-live,
    nav {
      display: none;
    }
    .hero,
    .cap-grid,
    .query-deck,
    .sdk-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .deck-left {
      border-right: 0;
      border-bottom: 1px solid #2e333c;
    }
  }

  @media (max-width: 560px) {
    .hero {
      padding-top: 28px;
    }
    h1 {
      font-size: clamp(22px, 7.2vw, 30px);
    }
    .install-box {
      max-width: 100%;
    }
    .actions {
      flex-direction: column;
      align-items: stretch;
    }
    .cta {
      text-align: center;
    }
    .gh-bar,
    .footer-meta {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    .kv {
      flex-wrap: wrap;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html) {
      scroll-behavior: auto;
    }
    .layer-group,
    .slab-draw,
    .rail-draw,
    .fade-in,
    .node-pop,
    .meter-fill {
      transition: none;
    }
    .signal-dot {
      display: none;
    }
  }
</style>
