const path = require('path');
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const r = JSON.parse(s);
  const byRule = {};
  const rows = [];
  for (const f of r) for (const m of f.messages) {
    const rel = path.relative(process.cwd(), f.filePath).split(path.sep).join('/');
    byRule[m.ruleId] = (byRule[m.ruleId] || 0) + 1;
    rows.push(rel + ':' + m.line + '  [' + (m.severity === 2 ? 'E' : 'W') + '] ' + m.ruleId + '  ' + m.message.split('\n')[0].slice(0, 110));
  }
  console.log('--- by rule ---');
  for (const [k, v] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(3), k);
  console.log('--- all ---');
  for (const x of [...new Set(rows)]) console.log(x);
});
