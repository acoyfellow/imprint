import { Hono } from 'hono';
import { attachSvelteRoutes, svelteRenderer } from 'svelte-hono';
import { bundles } from './bundles.generated.js';
// @ts-expect-error generated Svelte module
import App from './src/App.svelte';

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
const app = new Hono<{ Bindings: Env }>();
attachSvelteRoutes(app as unknown as Hono, { bundles });

const description =
  'Imprint binds repository knowledge to an exact Git commit so an LLM can answer against that version of the codebase.';
const head = [
  `<meta name="description" content="${description}">`,
  '<link rel="canonical" href="https://imprint.coey.dev/">',
  '<meta name="theme-color" content="#07111a">',
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="Imprint — every commit gets its own repository-aware LLM">',
  `<meta property="og:description" content="${description}">`,
  '<meta property="og:url" content="https://imprint.coey.dev/">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
].join('\n');

app.get(
  '/',
  svelteRenderer(App, {
    hydrateAs: 'app',
    title: 'Imprint — every commit gets its own repository-aware LLM',
    head,
    props: {},
  }),
);
app.get('*', (context) => context.env.ASSETS.fetch(context.req.raw));
export default app;
