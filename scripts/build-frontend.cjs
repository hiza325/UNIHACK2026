const { spawnSync } = require('child_process');
const fs = require('fs');
const result = spawnSync('npx esbuild app.js --bundle --splitting --format=esm --outdir=build --entry-names=[name] --chunk-names=chunks/[name]-[hash] --sourcemap --target=es2020', { stdio: 'inherit', shell: true });
if (result.status !== 0) { console.error('esbuild failed', result.status); process.exit(result.status || 1); }
if (fs.existsSync('build/assets')) fs.rmSync('build/assets', { recursive: true });
fs.cpSync('assets', 'build/assets', { recursive: true });
console.log('build done');
