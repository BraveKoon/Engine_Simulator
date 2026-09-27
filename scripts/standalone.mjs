// Inline the Vite build (dist/) into a single self-contained HTML file.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const out = process.argv[2] || 'dist/engine-simulator.html';
const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8');
const css = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');

const page = html
  .replace(/<script[^>]*src="[^"]*assets\/[^"]*"[^>]*><\/script>/, () => '')
  .replace(/<link rel="stylesheet"[^>]*assets\/[^>]*>/, () => `<style>${css}</style>`)
  .replace('</body>', () => `<script type="module">${js.replaceAll('</script', '<\\/script')}</script>\n</body>`);

writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
