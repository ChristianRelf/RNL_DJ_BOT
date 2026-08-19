/**
 * Guards the protocol mirror.
 *
 * `server/src/protocol.ts` and `web/src/protocol.ts` are the same file, kept in
 * step by hand - the server has no business importing from the web workspace
 * and the web build has no business pulling in the server's. Both compile
 * cleanly when they drift, and the failure shows up at runtime as a field the
 * other side silently ignores.
 *
 * So it is checked here instead, on every typecheck. Cheap, and it only has to
 * catch this once to have paid for itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['server/src/protocol.ts', 'web/src/protocol.ts'];

const [a, b] = files.map((file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch (err) {
    console.error(`check-protocol: cannot read ${file} - ${err.message}`);
    process.exit(2);
  }
});

if (a === b) process.exit(0);

/** The first line that differs, which is almost always the whole story. */
const left = a.split('\n');
const right = b.split('\n');
let line = 0;
while (line < left.length && line < right.length && left[line] === right[line]) line++;

console.error(`check-protocol: ${files[0]} and ${files[1]} have drifted apart.`);
console.error(`  first difference at line ${line + 1}:`);
console.error(`    ${files[0]}: ${left[line] ?? '(end of file)'}`);
console.error(`    ${files[1]}: ${right[line] ?? '(end of file)'}`);
if (left.length !== right.length) {
  console.error(`  lengths differ: ${left.length} vs ${right.length} lines`);
}
console.error('  Copy whichever is correct over the other - they are one file in two places.');
process.exit(1);
