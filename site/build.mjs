import { buildHonoSvelte } from 'svelte-hono/build';

const result = await buildHonoSvelte({
  workerEntry: './worker.ts',
  outDir: './build',
  components: { app: './src/App.svelte' },
});

console.log(`✓ worker ${(result.workerBytes / 1024).toFixed(1)} KB`);
