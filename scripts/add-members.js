// Adds the sample members to a RUNNING library through its REST API (safe while the server runs).
// Members whose name already exists are skipped, so it can be run more than once.
//   npm run add-members                 (uses http://localhost:3000)
//   npm run add-members -- http://localhost:3001
import { SAMPLE_MEMBERS, emailFor } from './sample-members.js';

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
