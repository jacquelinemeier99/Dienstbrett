// Baut die App als möglichst wenige Dateien (alles in index.html), damit man sie
// ohne Werkzeuge per Webspace-Oberfläche hochladen kann. Ergebnis: deploy/app/
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = 'deploy/app';
rmSync(out, { recursive: true, force: true });
await build({
  logLevel: 'warn',
  base: './',
  build: {
    outDir: out, assetsInlineLimit: 1e9, cssCodeSplit: false, modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const assets = join(out, 'assets');
let html = readFileSync(join(out, 'index.html'), 'utf8');
for (const f of readdirSync(assets)) {
  const body = readFileSync(join(assets, f), 'utf8');
  if (f.endsWith('.js')) html = html.replace(new RegExp(`<script[^>]*src="\\./assets/${f}"[^>]*></script>`), () => `<script type="module">${body}</script>`);
  if (f.endsWith('.css')) html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f}"[^>]*>`), () => `<style>${body}</style>`);
}
rmSync(assets, { recursive: true, force: true });
writeFileSync(join(out, 'index.html'), html);
console.log(readdirSync(out).map(f => `${f}`).join('\n'));
