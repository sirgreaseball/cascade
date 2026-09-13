// Applies exact-text edits from a spec file. Every OLD block must occur exactly once in its file
// (after earlier edits in the same spec), or nothing at all is written. Line endings follow the file.
//   @@FILE path
//   @@OLD
//   ...
//   @@NEW
//   ...
//   @@END
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n').split('\n');
const edits = [];
let i = 0;
const need = (cond, msg) => { if (!cond) { console.error('SPEC ERROR: ' + msg); process.exit(2); } };
while (i < lines.length) {
  if (!lines[i].startsWith('@@FILE ')) { i++; continue; }
  const file = lines[i].slice(7).trim();
  i++;
  need(lines[i] === '@@OLD', 'expected @@OLD for ' + file);
  i++;
  const old = [];
  while (i < lines.length && lines[i] !== '@@NEW') old.push(lines[i++]);
  need(i < lines.length, 'unterminated OLD in ' + file);
  i++;
  const neu = [];
  while (i < lines.length && lines[i] !== '@@END') neu.push(lines[i++]);
  need(i < lines.length, 'unterminated NEW in ' + file);
  i++;
  edits.push({ file, old: old.join('\n'), neu: neu.join('\n') });
}
const files = new Map();
for (const e of edits) {
  if (!files.has(e.file)) {
    const raw = fs.readFileSync(e.file, 'utf8');
    files.set(e.file, { crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') });
  }
  const f = files.get(e.file);
  const count = e.old.length === 0 ? 0 : f.text.split(e.old).length - 1;
  if (count !== 1) {
    console.error(`NO CHANGES WRITTEN: in ${e.file} the OLD block matched ${count} times:\n---\n${e.old.slice(0, 400)}\n---`);
    process.exit(1);
  }
  f.text = f.text.replace(e.old, () => e.neu);
}
for (const [file, f] of files) fs.writeFileSync(file, f.crlf ? f.text.replace(/\n/g, '\r\n') : f.text);
console.log(`applied ${edits.length} edit(s) across ${files.size} file(s)`);
