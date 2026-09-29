// Fills an EMPTY database with demo data that exercises every dashboard panel:
// overdue loans, a paid-off and an unpaid fine, a reservation queue and a copy ready for pickup.
// Used by `npm run seed` and automatically on Vercel (where the database starts empty).
import { Library, addDays, localToday } from './library.js';
import { SAMPLE_MEMBERS, SAMPLE_BOOKS, SAMPLE_STAFF, emailFor } from './sample-data.js';

/** Returns false (and does nothing) if the database already has books. */
export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS c FROM books').get().c > 0) return false;
  const today = localToday();
  let clock = addDays(today, -30);
  const lib = new Library(db, { today: () => clock });

  // Staff (S001 Elarvix, Admin, already exists). Each demo action is attributed to someone on duty.
  const [admin] = lib.listStaff();
  const st = Object.fromEntries(SAMPLE_STAFF.map(([name, role, shift, email, phone, joined, active]) =>
    [name.split(' ')[0].toLowerCase(), lib.addStaff({ name, role, shift, email, phone, join_date: addDays(today, -joined), active }).id]));
  const kav = { staffId: st.kavitha };
  const rak = { staffId: st.rakesh };
  const ani = { staffId: st.anita };

  lib.importBooks(SAMPLE_BOOKS.map(([title, author, isbn, category, total_copies]) => ({ title, author, isbn, category, total_copies })));
  const book = (title) => lib.searchBooks({ q: title, field: 'title' })[0];
  const m = Object.fromEntries(
    [['asha', 'Asha Rao', '9876500001'], ['ravi', 'Ravi Kumar', '9876500002'], ['meera', 'Meera Iyer', '9876500003'],
      ['arjun', 'Arjun Singh', '9876500004'], ['fatima', 'Fatima Sheikh', '9876500005']]
      .map(([k, name, phone]) => [k, lib.addMember({ name, phone, email: `${k}@example.com`, join_date: addDays(today, -60) })]));
  lib.addMember({ name: 'Old Member', phone: '9876500006', join_date: addDays(today, -400), active: false });

  // 30 days ago: Asha borrows Dune and The Hobbit (both will be overdue).
  lib.issueBook({ memberId: m.asha.id, bookId: book('Dune').id, ...kav });
  lib.issueBook({ memberId: m.asha.id, bookId: book('The Hobbit').id, ...kav });
  // Ravi borrows Clean Code and returns it 4 days late (₹20 unpaid fine).
  const ravi = lib.issueBook({ memberId: m.ravi.id, bookId: book('Clean Code').id, ...kav });
  clock = addDays(today, -12);
  lib.returnBook(ravi.id, rak);

  // 10 days ago: Meera borrows the only Pragmatic Programmer; Arjun and Fatima queue for it.
  clock = addDays(today, -10);
  lib.issueBook({ memberId: m.meera.id, bookId: book('Pragmatic').id, ...rak });
  lib.reserveBook({ memberId: m.arjun.id, bookId: book('Pragmatic').id, ...ani });
  lib.reserveBook({ memberId: m.fatima.id, bookId: book('Pragmatic').id, ...ani });

  // The only Atomic Habits: Fatima borrows it, Meera reserves, Fatima returns it yesterday -> ready for Meera.
  lib.issueBook({ memberId: m.fatima.id, bookId: book('Atomic Habits').id, ...rak });
  lib.reserveBook({ memberId: m.meera.id, bookId: book('Atomic Habits').id, ...ani });
  clock = addDays(today, -1);
  lib.returnBook(lib.listIssues().find((i) => i.title === 'Atomic Habits').id, kav);

  // Today
  clock = today;
  lib.issueBook({ memberId: m.arjun.id, bookId: book('Sapiens').id, staffId: admin.id });

  // More members (some borrowing) so lists, search and the assistant have realistic data.
  const extra = SAMPLE_MEMBERS.map(([name, phone, joined, active]) =>
    lib.addMember({ name, phone, email: emailFor(name), join_date: addDays(today, -joined), active }));
  lib.issueBook({ memberId: extra[0].id, bookId: book('Clean Code').id, ...kav });
  lib.issueBook({ memberId: extra[1].id, bookId: book('Wings of Fire').id, ...ani });
  lib.issueBook({ memberId: extra[2].id, bookId: book('The God of Small Things').id, staffId: admin.id });
  return true;
}
