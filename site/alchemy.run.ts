import alchemy from 'alchemy';
import { Assets, CustomDomain, Worker } from 'alchemy/cloudflare';

const stage = process.env.STAGE ?? 'prod';
const hostname = process.env.SITE_HOSTNAME ?? 'imprint.coey.dev';
const app = await alchemy('imprint-site', { stage });
const assets = await Assets({ path: './public' });
const worker = await Worker(`imprint-site-${stage}`, {
  entrypoint: './build/worker.bundled.mjs',
  compatibilityDate: '2026-06-18',
  compatibility: 'node',
  url: false,
  adopt: true,
  bindings: { ASSETS: assets },
});
if (stage === 'prod') {
  await CustomDomain('imprint-domain', { name: hostname, workerName: worker.name, adopt: true });
}
console.log(stage === 'prod' ? `https://${hostname}` : worker.url);
await app.finalize();
