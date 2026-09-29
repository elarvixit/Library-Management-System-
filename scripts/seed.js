// Fills a fresh database with demo data that exercises every dashboard panel:
// overdue loans, a paid-off and an unpaid fine, a reservation queue and a copy ready for pickup.
//   npm run seed            (uses data/library.db)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { Library, addDays, localToday } from '../src/library.js';
import { parseBooksCsv } from '../src/csv.js';
import { SAMPLE_MEMBERS, emailFor } from './sample-members.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'data', 'library.db');
const db = openDb(dbFile);
if (db.prepare('SELECT COUNT(*) AS c FROM books').get().c > 0) {
  console.log(`${dbFile} already has data — delete it first to reseed.`);
  process.exit(0);
}

const today = localToday();
let clock = addDays(today, -30);
const lib = new Library(db, { today: () => clock });

lib.importBooks(parseBooksCsv(fs.readFileSync(path.join(root, 'sample-data', 'books.csv'), 'utf8')));
const book = (title) => lib.searchBooks({ q: title, field: 'title' })[0];
const m = Object.fromEntries(
  [['asha', 'Asha Rao', '9876500001'], ['ravi', 'Ravi Kumar', '9876500002'], ['meera', 'Meera Iyer', '9876500003'],
    ['arjun', 'Arjun Singh', '9876500004'], ['fatima', 'Fatima Sheikh', '9876500005']]
    .map(([k, name, phone]) => [k, lib.addMember({ name, phone, email: `${k}@example.com`, join_date: addDays(today, -60) })]));
lib.addMember({ name: 'Old Member', phone: '9876500006', join_date: addDays(today, -400), active: false });

// 30 days ago: Asha borrows Dune and The Hobbit (both will be overdue).
lib.issueBook({ memberId: m.asha.id, bookId: book('Dune').id });
lib.issueBook({ memberId: m.asha.id, bookId: book('The Hobbit').id });
// Ravi borrows Clean Code and returns it 4 days late (₹20 unpaid fine).
const ravi = lib.issueBook({ memberId: m.ravi.id, bookId: book('Clean Code').id });
clock = addDays(today, -12);
lib.returnBook(ravi.id);

// 10 days ago: Meera borrows the only Pragmatic Programmer; Arjun and Fatima queue for it.
clock = addDays(today, -10);
lib.issueBook({ memberId: m.meera.id, bookId: book('Pragmatic').id });
lib.reserveBook({ memberId: m.arjun.id, bookId: book('Pragmatic').id });
lib.reserveBook({ memberId: m.fatima.id, bookId: book('Pragmatic').id });

// The only Atomic Habits: Fatima borrows it, Meera reserves, Fatima returns it yesterday -> ready for Meera.
lib.issueBook({ memberId: m.fatima.id, bookId: book('Atomic Habits').id });
lib.reserveBook({ memberId: m.meera.id, bookId: book('Atomic Habits').id });
clock = addDays(today, -1);
lib.returnBook(lib.listIssues().find((i) => i.title === 'Atomic Habits').id);

// Today
clock = today;
lib.issueBook({ memberId: m.arjun.id, bookId: book('Sapiens').id });

// More members (some borrowing) so lists, search and the assistant have realistic data.
const extra = SAMPLE_MEMBERS.map(([name, phone, joined, active]) =>
  lib.addMember({ name, phone, email: emailFor(name), join_date: addDays(today, -joined), active }));
lib.issueBook({ memberId: extra[0].id, bookId: book('Clean Code').id });
lib.issueBook({ memberId: extra[1].id, bookId: book('Wings of Fire').id });
lib.issueBook({ memberId: extra[2].id, bookId: book('The God of Small Things').id });

console.log(`Seeded demo data into ${dbFile}`);
