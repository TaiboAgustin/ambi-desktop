// Verifica la sintaxis de todos los .js del proyecto (proceso principal, preloads, UI y tests).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(root, 'src'));
for (const extra of ['scripts', 'test']) {
  const d = path.join(root, extra);
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) files.push(path.join(d, f));
}

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${path.relative(root, f)}\n${e.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} archivos sin errores de sintaxis`);
process.exit(failed ? 1 : 0);
