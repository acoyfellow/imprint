import { Hono } from 'hono';
import { attachSvelteRoutes, svelteRenderer } from 'svelte-hono';
import { bundles } from './bundles.generated.js';
// @ts-expect-error generated Svelte module
import App from './src/App.svelte';

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
const app = new Hono<{ Bindings: Env }>();
attachSvelteRoutes(app as unknown as Hono, { bundles });

const title = 'Imprint — Turn any Git commit into a queryable map';
const description =
  'Index 100% of tracked files at a Git commit, compile a compact oxc-parser AST symbol and import map, and slice exact blobs on demand by oid with verified proof gates.';
const siteUrl = 'https://imprint.coey.dev/';
const ogImage = 'https://imprint.coey.dev/og.png';
const ogAlt =
  'Imprint: Turn any Git commit into a queryable map. Three isometric dithered layers for L1 Manifest, L2 AST Map, and L3 Slice with verified proof readout.';

const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Imprint',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux, Windows',
  url: siteUrl,
  description,
  softwareVersion: '2.0.0',
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: 'https://github.com/acoyfellow/imprint',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
});

const head = [
  `<meta name="description" content="${description}">`,
  '<meta name="robots" content="index,follow">',
  '<meta name="author" content="acoyfellow">',
  `<link rel="canonical" href="${siteUrl}">`,
  '<meta name="theme-color" content="#16191d">',
  '<meta name="color-scheme" content="dark">',
  '<meta name="application-name" content="Imprint">',
  '<meta name="apple-mobile-web-app-title" content="Imprint">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon.ico" sizes="48x48">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Imprint">',
  `<meta property="og:url" content="${siteUrl}">`,
  `<meta property="og:title" content="${title}">`,
  `<meta property="og:description" content="${description}">`,
  `<meta property="og:image" content="${ogImage}">`,
  '<meta property="og:image:type" content="image/png">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  `<meta property="og:image:alt" content="${ogAlt}">`,
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${title}">`,
  `<meta name="twitter:description" content="${description}">`,
  `<meta name="twitter:image" content="${ogImage}">`,
  `<meta name="twitter:image:alt" content="${ogAlt}">`,
  `<script type="application/ld+json">${jsonLd}</script>`,
].join('\n');

app.get(
  '/',
  svelteRenderer(App, {
    hydrateAs: 'app',
    title,
    head,
    props: {},
  }),
);
app.get('*', (context) => context.env.ASSETS.fetch(context.req.raw));
export default app;
