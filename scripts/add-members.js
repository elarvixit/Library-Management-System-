// Adds the sample members and sample books to a RUNNING library through its REST API
// (safe while the server runs). Existing members (by name) and books (by ISBN) are skipped,
// so it can be run more than once.
//   npm run add-samples                 (uses http://localhost:3000)
//   npm run add-samples -- http://localhost:3001
import fs from 'node:fs';
import { SAMPLE_MEMBERS, emailFor } from './sample-members.js';
import { SAMPLE_STAFF } from '../src/sample-data.js';

const base = (process.argv[2] || process.env.LIBRARY_URL || 'http://localhost:3000').replace(/\/$/, '');
const pad = (n) => String(n).padStart(2, '0');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

let existing;
try {
  existing = await fetch(`${base}/api/members`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
} catch (err) {
  console.error(`Could not reach the library at ${base} (${err.message}). Start it with "npm start" first.`);
  process.exit(1);
}
const names = new Set(existing.map((m) => m.name.toLowerCase()));
let added = 0;
for (const [name, phone, joined, active] of SAMPLE_MEMBERS) {
  if (names.has(name.toLowerCase())) continue;
  const res = await fetch(`${base}/api/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, email: emailFor(name), join_date: daysAgo(joined), active }),
  });
  const body = await res.json();
  if (!res.ok) { console.warn(`  skipped ${name}: ${body.error}`); continue; }
  console.log(`  + ${body.member_code}  ${name}`);
  added++;
}
console.log(`Added ${added} member(s); ${SAMPLE_MEMBERS.length - added} already existed or were skipped.`);

// Sample staff (skipped if a staff member with the same name exists; needs a server with /api/staff).
const staffRes = await fetch(`${base}/api/staff`);
if (staffRes.ok) {
  const have = new Set((await staffRes.json()).map((s) => s.name.toLowerCase()));
  let addedStaff = 0;
  for (const [name, role, shift, email, phone, joined, active] of SAMPLE_STAFF) {
    if (have.has(name.toLowerCase())) continue;
    const r = await fetch(`${base}/api/staff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, shift, email, phone, join_date: daysAgo(joined), active }),
    });
    const body = await r.json();
    if (r.ok) { console.log(`  + ${body.staff_code}  ${name} (${role})`); addedStaff++; } else console.warn(`  skipped ${name}: ${body.error}`);
  }
  console.log(`Added ${addedStaff} staff member(s).`);
} else console.warn('This server has no /api/staff yet — restart it with the latest code to add staff.');

// Sample books: the server's CSV import skips any ISBN that is already in the catalogue.
const csv = fs.readFileSync(new URL('../sample-data/books.csv', import.meta.url), 'utf8');
const imp = await fetch(`${base}/api/books/import`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
}).then((r) => r.json());
if (imp.error) console.warn(`Book import failed: ${imp.error}`);
else {
  for (const b of imp.importedBooks) console.log(`  + ${b.title}`);
  console.log(`Added ${imp.imported} book(s); ${imp.skipped.length} already in the catalogue.`);
}
