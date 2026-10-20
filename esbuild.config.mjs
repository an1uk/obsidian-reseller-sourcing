import esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { collectLegalNotices } from './scripts/legal-notices.mjs';
const notices = await collectLegalNotices(process.cwd());
const worker = await esbuild.build({entryPoints:['node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',legalComments:'inline'});
await esbuild.build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, external: ['obsidian', 'electron'], platform: 'browser', format: 'cjs', target: 'es2022', define:{__MAP_WORKER_CODE__:JSON.stringify(worker.outputFiles[0].text),__THIRD_PARTY_NOTICES__:JSON.stringify(notices.text)}, legalComments:'inline', sourcemap: true, logLevel: 'info' });
await writeFile('styles.css', (await Promise.all(['node_modules/maplibre-gl/dist/maplibre-gl.css', 'map.css', 'ui.css', 'visit-insights.css', 'visit-shortcuts.css', 'short-trip.css', 'outing-focus.css'].map(p => readFile(p, 'utf8')))).join('\n'));
