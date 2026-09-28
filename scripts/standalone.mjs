// Inline the Vite build (dist/) into a single self-contained HTML file.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const out = process.argv[2] || 'dist/engine-simulator.html';
const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8');
const css = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');

// 3D car models (dist/models/*.glb) are embedded as base64 so the file works offline.
const models = {};
if (existsSync('dist/models')) {
  for (const f of readdirSync('dist/models').filter((n) => n.endsWith('.glb'))) {
    models[`models/${f}`] = readFileSync(`dist/models/${f}`).toString('base64');
  }
}
const embed = Object.keys(models).length ? `<script>window.__EMBEDDED_MODELS=${JSON.stringify(models)}</script>\n` : '';

const page = html
  .replace(/<script[^>]*src="[^"]*assets\/[^"]*"[^>]*><\/script>/, () => '')
  .replace(/<link rel="stylesheet"[^>]*assets\/[^>]*>/, () => `<style>${css}</style>`)
  .replace('</body>', () => `${embed}<script type="module">${js.replaceAll('</script', '<\\/script')}</script>\n</body>`);

writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
