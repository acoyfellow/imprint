<script lang="ts">
  let copied = $state(false);
  const proofCommand = 'bun run prove';
  async function copyProof() {
    await navigator.clipboard.writeText(proofCommand);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
</script>

<svelte:head><title>Imprint — every commit gets its own repository-aware LLM</title></svelte:head>

<header>
  <a class="brand" href="/" aria-label="Imprint home"><span class="mark">I</span><strong>Imprint</strong></a>
  <nav><a href="#proof">Proof</a><a href="#examples">Examples</a><a href="#how">How</a><a href="https://github.com/acoyfellow/imprint">GitHub ↗</a></nav>
</header>

<main>
  <section class="hero">
    <div class="grid"></div>
    <div class="orb orb-one"></div><div class="orb orb-two"></div>
    <div class="hero-copy">
      <p class="eyebrow">Repository intelligence / 0.0.1</p>
      <h1>Every commit gets its own<br /><em>repository-aware LLM.</em></h1>
      <p class="lede">Turn a Git commit into repository context an LLM can use—and prove exactly which source it learned.</p>
      <div class="hero-snippet"><pre><code><span class="blue">import</span> &#123; Imprint, WorkersAiProvider &#125; <span class="blue">from</span> <span class="orange">'imprint'</span>;

<span class="blue">const</span> imprint = <span class="blue">new</span> Imprint(&#123;
  directory: <span class="orange">'./repo'</span>,
  provider: <span class="blue">new</span> WorkersAiProvider(&#123; accountId, apiToken &#125;),
&#125;);

<span class="blue">const</span> repo = <span class="blue">await</span> imprint.open(<span class="orange">'abc123'</span>);
<span class="blue">await</span> repo.ask(<span class="orange">'How do sessions work?'</span>);</code></pre></div>
      <div class="actions"><a class="primary" href="https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/imprint">Install in your Cloudflare account <span>↗</span></a><a href="https://github.com/acoyfellow/imprint">Read the source</a></div>
    </div>
    <div class="artifact" aria-hidden="true">
      <div class="glass back"></div><div class="glass middle"></div><div class="glass front"><span>commit</span><b>abc123</b><i></i><small>source selected<br />context bound<br />digests recorded</small></div>
    </div>
    <p class="coordinate">IMP–001<br />COMMIT → CONTEXT → INFERENCE</p>
  </section>

  <section class="proof" id="proof">
    <div class="section-head"><div><p class="eyebrow">01 / What ships</p><h2>One repository.<br />Two commits. Two answers.</h2></div><p>The included check changes an API, imprints both commits, promotes the new release, then rolls back. Each release remains bound to its own source.</p></div>
    <div class="terminal">
      <div class="terminal-bar"><span></span><span></span><span></span><b>imprint · proof</b></div>
      <pre><code><span class="muted">$</span> {proofCommand}

<span class="orange">old</span>   a9c49d7  <span class="green">✓ knows createSession</span>
<span class="blue">next</span>  591f70d  <span class="green">✓ knows openSession</span>
<span class="muted">diff</span>             session.ts changed
<span class="muted">rollback</span>         <span class="green">✓ exact old release active</span></code></pre>
      <button onclick={copyProof}>{copied ? 'Copied' : 'Copy command'}</button>
    </div>
  </section>

  <section class="examples" id="examples">
    <div class="section-head"><div><p class="eyebrow">02 / Use it</p><h2>Start with one commit.<br />Add the lifecycle when needed.</h2></div><p>Each example adds one operation. The release remains tied to the commit selected in the first line.</p></div>
    <div class="example-stack">
      <article>
        <div><span>01</span><strong>Ask one commit</strong><p>Read committed source and answer with Workers AI.</p></div>
        <pre><code><span class="blue">const</span> release = <span class="blue">await</span> imprint.imprint(<span class="orange">'HEAD'</span>);
<span class="blue">const</span> repo = <span class="blue">await</span> imprint.open(release.commit);
<span class="blue">await</span> repo.ask(<span class="orange">'Where is authentication implemented?'</span>);</code></pre>
      </article>
      <article>
        <div><span>02</span><strong>Compare commits</strong><p>See which committed files changed between releases.</p></div>
        <pre><code><span class="blue">await</span> imprint.imprint(<span class="orange">'HEAD~1'</span>);
<span class="blue">await</span> imprint.imprint(<span class="orange">'HEAD'</span>);

<span class="blue">const</span> diff = <span class="blue">await</span> imprint.diff(<span class="orange">'HEAD~1'</span>, <span class="orange">'HEAD'</span>);</code></pre>
      </article>
      <article>
        <div><span>03</span><strong>Promote and roll back</strong><p>Move the local active pointer between verified releases.</p></div>
        <pre><code><span class="blue">await</span> imprint.promote(<span class="orange">'HEAD'</span>);
<span class="blue">await</span> imprint.rollback(<span class="orange">'HEAD~1'</span>);

<span class="blue">const</span> active = <span class="blue">await</span> imprint.open();</code></pre>
      </article>
    </div>
    <div class="install-note"><span>Install from GitHub</span><code>bun add github:acoyfellow/imprint</code></div>
  </section>

  <section class="system" id="how">
    <div class="section-head"><div><p class="eyebrow">03 / System</p><h2>Ask against<br />an exact commit.</h2></div><p>The current release stores selected source from one commit and sends it to Workers AI. The release records which files and digests produced the answer.</p></div>
    <div class="flow">
      <article><span>01</span><strong>Commit</strong><p>Resolve immutable source and parents.</p></article>
      <article><span>02</span><strong>Imprint</strong><p>Select committed source and build bounded context.</p></article>
      <article><span>03</span><strong>Record</strong><p>Record source and context digests.</p></article>
      <article><span>04</span><strong>Ask</strong><p>Run inference against that exact release.</p></article>
    </div>
  </section>

</main>

<footer><span>Imprint · MIT · 0.0.1</span><span>Built on Cloudflare <i></i></span></footer>

<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
  :global(*){box-sizing:border-box} :global(html){scroll-behavior:smooth;background:#07111a} :global(body){margin:0;min-width:320px;background:#07111a;color:#f7f9fb;font-family:Inter,system-ui,sans-serif} :global(::selection){background:#f6821f;color:#170900}
  header{height:68px;padding:0 clamp(20px,4vw,64px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(174,196,216,.14);position:sticky;top:0;z-index:20;background:rgba(7,17,26,.84);backdrop-filter:blur(18px)}
  .brand{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}.mark{width:30px;height:30px;display:grid;place-items:center;background:#f6821f;color:#160900;font:800 16px/1 Inter}.brand strong{font-size:14px}.brand strong::after{content:'.';color:#71b8d8}nav{display:flex;gap:24px}nav a{color:#9baaba;text-decoration:none;font:500 11px IBM Plex Mono}nav a:hover{color:#f6821f}
  .hero{min-height:720px;position:relative;overflow:hidden;display:grid;grid-template-columns:1.08fr .92fr;align-items:center;padding:90px clamp(24px,7vw,112px);isolation:isolate;background:radial-gradient(circle at 72% 52%,#15475f 0,rgba(21,71,95,.45) 22%,transparent 47%),linear-gradient(130deg,#07111a 34%,#0b2634 100%)}
  .grid{position:absolute;inset:0;z-index:-2;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to right,transparent,black 35%,black)}.orb{position:absolute;border-radius:50%;filter:blur(60px);z-index:-1}.orb-one{width:340px;height:340px;right:12%;top:34%;background:rgba(246,130,31,.16)}.orb-two{width:260px;height:260px;right:32%;bottom:10%;background:rgba(38,120,164,.25)}
  .hero-copy{max-width:780px}.eyebrow{display:inline-flex;margin:0 0 24px;padding:8px 10px;border-left:1px solid #f6821f;border-top:1px solid #f6821f;color:#f6821f;font:600 10px IBM Plex Mono;letter-spacing:.16em;text-transform:uppercase}h1{font-size:clamp(48px,6vw,92px);line-height:.98;letter-spacing:-.065em;margin:0;max-width:12ch}h1 em{font-style:normal;color:#71b8d8}.lede{max-width:620px;color:#c4d0d9;font-size:clamp(16px,1.6vw,21px);line-height:1.65;margin:26px 0 20px}.hero-snippet{width:min(100%,560px);margin-top:10px;border:1px solid rgba(174,196,216,.18);background:rgba(8,13,19,.72);color:#f7f9fb}.hero-snippet pre{margin:0;padding:15px;overflow:auto;font:10px/1.65 IBM Plex Mono}.actions{display:flex;align-items:center;gap:14px;margin-top:18px}.actions a{padding:13px 18px;border:1px solid rgba(174,196,216,.27);color:#f7f9fb;text-decoration:none;font:600 12px IBM Plex Mono}.actions .primary{background:#f6821f;border-color:#f6821f;color:#1b0b00}.actions span{margin-left:20px}
  .artifact{position:relative;width:min(33vw,460px);aspect-ratio:1;margin:auto;perspective:900px}.glass{position:absolute;width:68%;height:68%;left:16%;top:16%;border:1px solid rgba(113,184,216,.65);background:linear-gradient(145deg,rgba(113,184,216,.12),rgba(246,130,31,.08));box-shadow:0 28px 90px rgba(0,0,0,.28),inset 0 0 40px rgba(113,184,216,.08);transform:rotateY(-12deg) rotateX(8deg)}.back{transform:translate(48px,-38px) rotateY(-12deg) rotateX(8deg);opacity:.25}.middle{transform:translate(24px,-19px) rotateY(-12deg) rotateX(8deg);opacity:.5}.front{padding:18%;display:flex;flex-direction:column;justify-content:center}.front span,.front small{color:#9ccfe2;font:500 9px/1.8 IBM Plex Mono;text-transform:uppercase;letter-spacing:.12em}.front b{color:#f6821f;font:600 clamp(22px,3vw,44px) IBM Plex Mono}.front i{height:1px;background:linear-gradient(90deg,#f6821f,transparent);margin:16px 0}.coordinate{position:absolute;right:30px;bottom:24px;color:#667888;font:9px/1.6 IBM Plex Mono;letter-spacing:.1em}
  section:not(.hero){padding:110px clamp(24px,8vw,128px);border-top:1px solid rgba(174,196,216,.14)}.section-head{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:end;margin-bottom:58px}.section-head h2,.code-grid h2{font-size:clamp(36px,5vw,68px);line-height:1;letter-spacing:-.055em;margin:0}.section-head>p{max-width:550px;color:#9baaba;line-height:1.75;margin:0}
  .terminal{max-width:960px;margin:auto;border:1px solid rgba(174,196,216,.2);background:#080d13;box-shadow:0 30px 100px rgba(0,0,0,.35)}.terminal-bar{height:42px;display:flex;align-items:center;gap:7px;padding:0 15px;border-bottom:1px solid rgba(174,196,216,.14)}.terminal-bar span{width:8px;height:8px;border-radius:50%;background:#223141}.terminal-bar span:first-child{background:#f6821f}.terminal-bar b{margin-left:auto;color:#667888;font:500 9px IBM Plex Mono}.terminal pre{padding:38px;margin:0;overflow:auto;font:13px/1.9 IBM Plex Mono}.terminal button{margin:0 38px 30px;padding:9px 12px;background:transparent;border:1px solid rgba(174,196,216,.27);color:#c4d0d9;font:10px IBM Plex Mono}.orange{color:#f6821f}.blue{color:#71b8d8}.green{color:#63d5a2}.muted{color:#667888}
  .examples{background:#f4f7f9;color:#17212b}.examples .eyebrow{color:#b9530a;border-color:#b9530a}.examples .section-head>p{color:#5e6d79}.example-stack{border-top:1px solid rgba(39,58,73,.18)}.example-stack article{display:grid;grid-template-columns:minmax(220px,.7fr) 1.3fr;gap:48px;padding:30px 0;border-bottom:1px solid rgba(39,58,73,.18);align-items:center}.example-stack article>div{display:grid}.example-stack span{color:#b9530a;font:600 9px IBM Plex Mono}.example-stack strong{margin-top:12px;font-size:19px}.example-stack p{margin:7px 0 0;color:#5e6d79;font-size:12px;line-height:1.55}.example-stack pre{margin:0;padding:22px;background:#0b1118;color:#f7f9fb;overflow:auto;font:11px/1.75 IBM Plex Mono}.install-note{margin-top:28px;display:flex;align-items:center;gap:18px;color:#5e6d79;font:600 9px IBM Plex Mono;text-transform:uppercase;letter-spacing:.09em}.install-note code{padding:11px 13px;background:#e5ebef;color:#17212b;font:11px IBM Plex Mono;text-transform:none;letter-spacing:0}.system{background:#0b151f}.flow{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(174,196,216,.14)}.flow article{min-height:220px;padding:28px;border-right:1px solid rgba(174,196,216,.14)}.flow article:last-child{border:0}.flow span{color:#f6821f;font:10px IBM Plex Mono}.flow strong{display:block;margin:60px 0 10px;font-size:20px}.flow p{color:#9baaba;font-size:13px;line-height:1.6}
  footer{height:88px;padding:0 clamp(24px,5vw,80px);display:flex;align-items:center;justify-content:space-between;color:#667888;font:9px IBM Plex Mono;text-transform:uppercase;letter-spacing:.1em}footer i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#f6821f;margin-left:8px}
  @media(max-width:850px){nav{display:none}.hero{grid-template-columns:1fr;padding-top:120px}.artifact{width:70vw;margin-top:50px}.section-head{grid-template-columns:1fr;gap:28px}.example-stack article{grid-template-columns:1fr;gap:18px}.flow{grid-template-columns:1fr 1fr}.flow article:nth-child(2){border-right:0}.flow article{min-height:170px}.coordinate{display:none}}@media(max-width:520px){h1{font-size:46px}.actions{align-items:stretch;flex-direction:column}.actions a{text-align:center}.install-note{align-items:flex-start;flex-direction:column;gap:8px}.install-note code{width:100%;overflow:auto}.flow{grid-template-columns:1fr}.flow article{border-right:0;border-bottom:1px solid rgba(174,196,216,.14)}.section-head h2{font-size:40px}.terminal pre{padding:22px;font-size:10px}footer{flex-direction:column;justify-content:center;gap:8px}}
  @media(prefers-reduced-motion:reduce){:global(html){scroll-behavior:auto}}
</style>
