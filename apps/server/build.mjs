// Bundles the server into dist/, two entries: the server and the worker each
// plugin runs in. Native and large packages stay in node_modules.
import { build } from 'esbuild'

await build({
  entryPoints: { index: 'src/index.ts', 'plugin-worker': 'src/plugins/worker.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  // The protocol package is TypeScript source in the workspace: bundle it in.
  alias: { '@antwen-music/protocol': '../../packages/protocol/src/index.ts' },
})
console.log('built apps/server/dist')
