// Bundles the renderer entry (src/renderer/renderer.ts) into a single
// dist/renderer/renderer.js via esbuild.
//
// LOGAN v2 Phase 0 (issue #15): the renderer is being split into ES modules. tsc
// (CommonJS) can't emit browser-loadable modules, so esbuild bundles them into one
// IIFE script — the same single <script src="renderer.js"> the HTML already loads.
// Type-checking still happens via `tsc --noEmit`; this step only produces the bundle
// and overwrites whatever tsc emitted for the renderer.

const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/renderer/renderer.ts'],
    bundle: true,
    outfile: 'dist/renderer/renderer.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  })
  .then(() => console.log('renderer bundled → dist/renderer/renderer.js'))
  .catch((err) => {
    console.error('renderer bundle failed:', err);
    process.exit(1);
  });
