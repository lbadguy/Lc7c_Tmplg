import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outFile = resolve(root, 'dist/qr-scanner.user.js');
const metadata = `// ==UserScript==
// @name         QR Scanner (offline)
// @namespace    local.qr-scanner
// @version      1.0.0
// @description  Scan QR codes from the visible page or a selected region.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

`;

await mkdir(dirname(outFile), { recursive: true });
const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  sourcemap: false,
  write: false,
  legalComments: 'none'
});
const bundled = result.outputFiles[0].text;
await writeFile(outFile, metadata + bundled, 'utf8');
console.log(`Built ${outFile} (${(Buffer.byteLength(metadata + bundled) / 1024).toFixed(1)} KiB)`);
