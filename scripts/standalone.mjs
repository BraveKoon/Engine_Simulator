// Inline the Vite build (dist/) into a single self-contained HTML file.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'dist/engine-simulator.html';
const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8');
const css = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');

// 3D car models (dist/models/*.glb) are embedded as base64 so the file works offline.
const models = {};
// --no-models: leave the models as separate files next to the page (loaded with fetch)
if (existsSync('dist/models') && !process.argv.includes('--no-models')) {
  for (const f of readdirSync('dist/models').filter((n) => n.endsWith('.glb'))) {
    models[`models/${f}`] = readFileSync(`dist/models/${f}`).toString('base64');
  }
}
// --models-as-text: models are published separately as models/<name>.glb.txt (base64)
const embed = Object.keys(models).length
  ? `<script>window.__EMBEDDED_MODELS=${JSON.stringify(models)}</script>\n`
  : process.argv.includes('--models-as-text')
    ? '<script>window.__MODELS_AS_TEXT=true</script>\n'
    : '';

const page = html
  .replace(/<script[^>]*src="[^"]*assets\/[^"]*"[^>]*><\/script>/, () => '')
  .replace(/<link rel="stylesheet"[^>]*assets\/[^>]*>/, () => `<style>${css}</style>`)
  .replace('</body>', () => `${embed}<script type="module">${js.replaceAll('</script', '<\\/script')}</script>\n</body>`);

writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
