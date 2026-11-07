const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (fs.existsSync('build')) fs.rmSync('build', { recursive: true, force: true });

const result = spawnSync('npx esbuild app.js --bundle --splitting --format=esm --outdir=build --entry-names=[name] --chunk-names=chunks/[name]-[hash] --target=es2020', { stdio: 'inherit', shell: true });
if (result.status !== 0) { console.error('esbuild failed', result.status); process.exit(result.status || 1); }

// Copy the complete static site into the Vercel output directory. The source
// index.html references build/app.js, while the deployed copy is served from
// build/ and must reference app.js directly.
if (fs.existsSync('build/assets')) fs.rmSync('build/assets', { recursive: true });
fs.cpSync('assets', 'build/assets', { recursive: true });

const rootFiles = [
  'index.html',
  'verify.html',
  'robots.txt',
  'sitemap.xml',
  'logo-mark.svg',
  'chatbot-avatar.png',
  'chatbot-logo.png',
  'social-preview.png',
  'fonts.css',
  'styles.css',
  'views.css',
  'redesign.css',
  'homepage.css',
  'dashboard.css',
  'audit-silver.css',
  'history-silver.css',
  'practice-silver.css',
  'profile-silver.css',
  'passport-silver.css',
  'about-silver.css',
  'settings-silver.css',
  'admin-silver.css',
  'avatar.css',
  'competency-passport.css',
  'editorial.css',
  'liquid-chrome.css',
  'support-ai-config.js',
];
for (const file of rootFiles) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join('build', file));
}

for (const dir of ['fonts', 'vendor']) {
  const destination = path.join('build', dir);
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true });
  if (fs.existsSync(dir)) fs.cpSync(dir, destination, { recursive: true });
}

const indexPath = path.join('build', 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(indexPath, html.replace(/src="build\/app\.js"/, 'src="app.js"'));
}

console.log('build done');
