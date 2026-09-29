import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Library, LibraryError, addDays, computeFine } from '../src/library.js';
import { parseBooksCsv, toCsv } from '../src/csv.js';

// A library with a controllable clock.
let clock;
let lib;
const setToday = (d) => { clock = d; };
const advance = (n) => { clock = addDays(clock, n); };

const rejects = (fn, re) => assert.throws(fn, (err) => err instanceof LibraryError && re.test(err.message), `expected error matching ${re}`);

let seq = 0;
const book = (copies = 1, extra = {}) =>
  lib.addBook({ title: `Book ${++seq}`, author: 'Author', isbn: String(9780000000000 + seq), category: 'Fiction', total_copies: copies, ...extra });
const member = (name = `Member ${++seq}`, extra = {}) => lib.addMember({ name, phone: '9876543210', email: `${seq}@x.com`, ...extra });
const issue = (m, b, extra = {}) => lib.issueBook({ memberId: m.id, bookId: b.id, ...extra });
const ret = (i, extra = {}) => lib.returnBook(i.id, extra);
const reserve = (m, b) => lib.reserveBook({ memberId: m.id, bookId: b.id });
const avail = (b) => lib.getBook(b.id).available_copies;
const res = (r) => lib.listReservations({ status: 'all' }).find((x) => x.id === r.id);

beforeEach(() => {
  setToday('2026-01-10');
  lib = new Library(openDb(':memory:'), { today: () => clock });
});
afterEach(() => {
  assert.deepEqual(lib.checkInvariants(), [], 'copy accounting invariant must hold after every test');
});

describe('fine calculation', () => {
  test('₹5 per day late; returning on or before the due date is free', () => {
    assert.deepEqual(computeFine('2026-01-24', '2026-01-24'), { daysLate: 0, fine: 0 });
    assert.deepEqual(computeFine('2026-01-24', '2026-01-20'), { daysLate: 0, fine: 0 });
    assert.deepEqual(computeFine('2026-01-24', '2026-01-25'), { daysLate: 1, fine: 5 });
    assert.deepEqual(computeFine('2026-01-24', '2026-02-03'), { daysLate: 10, fine: 50 });
    assert.deepEqual(computeFine('2026-02-27', '2026-03-02'), { daysLate: 3, fine: 15 }); // across month end
  });
});

describe('books', () => {
  test('add sets available = total; ISBN normalised and unique', () => {
    const b = lib.addBook({ title: 'Clean Code', author: 'Martin', isbn: '978-0-13-235088-4', category: 'Tech', total_copies: 3 });
    assert.equal(b.isbn, '9780132350884');
    assert.equal(b.available_copies, 3);
    rejects(() => lib.addBook({ title: 'Dup', author: 'X', isbn: '9780132350884', total_copies: 1 }), /already belongs/);
    rejects(() => lib.addBook({ title: 'Bad', author: 'X', isbn: '123', total_copies: 1 }), /ISBN .* invalid/);
    rejects(() => lib.addBook({ title: '', author: 'X', isbn: '9780132350885', total_copies: 1 }), /Title is required/);
    rejects(() => lib.addBook({ title: 'T', author: 'X', isbn: '9780132350885', total_copies: 0 }), /Total copies/);
  });

  test('editing total copies adjusts availability and cannot drop below copies in use', () => {
    const b = book(3);
    const m = member();
    issue(m, b);
    issue(member(), b);
    assert.equal(avail(b), 1);
    assert.equal(lib.updateBook(b.id, { total_copies: 5 }).available_copies, 3);
    rejects(() => lib.updateBook(b.id, { total_copies: 1 }), /minimum is 2/);
    assert.equal(lib.updateBook(b.id, { total_copies: 2 }).available_copies, 0);
  });

  test('deleting a book that is currently issued is refused with a clear message', () => {
    const b = book(2);
    const m = member('Asha');
    const i = issue(m, b);
    rejects(() => lib.deleteBook(b.id), /Cannot delete "Book \d+": 1 copy is currently issued to Asha/);
    ret(i);
    assert.equal(lib.deleteBook(b.id).deleted, true);
    rejects(() => lib.getBook(b.id), /not found/);
    // Soft delete: ISBN can be reused and history is kept.
    assert.equal(lib.listIssues({ status: 'all' }).length, 1);
  });

  test('deleting a book with open reservations is refused', () => {
    const b = book(1);
    issue(member(), b);
    const m2 = member();
    reserve(m2, b);
    const [i] = lib.listIssues();
    ret(i);
    rejects(() => lib.deleteBook(b.id), /open reservation/);
  });

  test('search by title, author, ISBN, category; available only', () => {
    const a = lib.addBook({ title: 'The Hobbit', author: 'J.R.R. Tolkien', isbn: '9780261102217', category: 'Fantasy', total_copies: 1 });
    lib.addBook({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', category: 'Sci-Fi', total_copies: 1 });
    const titles = (o) => lib.searchBooks(o).map((b) => b.title);
    assert.deepEqual(titles({ q: 'hobb' }), ['The Hobbit']);
    assert.deepEqual(titles({ q: 'herbert', field: 'author' }), ['Dune']);
    assert.deepEqual(titles({ q: 'hobbit', field: 'author' }), []);
    assert.deepEqual(titles({ q: '978-0441', field: 'isbn' }), ['Dune']);
    assert.deepEqual(titles({ q: 'fantasy', field: 'category' }), ['The Hobbit']);
    assert.deepEqual(titles({ q: '%' }), []); // LIKE wildcards are escaped
    issue(member(), a);
    assert.deepEqual(titles({ availableOnly: true }), ['Dune']);
  });
});

describe('members', () => {
  test('auto member ID, validation, unique ID', () => {
    const a = lib.addMember({ name: 'Asha' });
    const b = lib.addMember({ name: 'Ravi' });
    assert.equal(a.member_code, 'M0001');
    assert.equal(b.member_code, 'M0002');
    assert.equal(a.join_date, '2026-01-10');
    assert.equal(a.active, 1);
    rejects(() => lib.addMember({ name: 'X', member_code: 'm0001' }), /already in use/);
    rejects(() => lib.addMember({ name: 'X', email: 'nope' }), /not a valid email/);
    rejects(() => lib.addMember({ name: 'X', phone: 'abc' }), /not a valid phone/);
    rejects(() => lib.addMember({ name: '' }), /Name is required/);
    rejects(() => lib.addMember({ name: 'X', join_date: '2026-02-30' }), /valid date/);
  });
});

describe('issuing', () => {
  test('default due date is 14 days; available copies drop by 1', () => {
    const b = book(2);
    const i = issue(member(), b);
    assert.equal(i.issued_on, '2026-01-10');
    assert.equal(i.due_on, '2026-01-24');
    assert.equal(avail(b), 1);
  });

  test('custom due date allowed but not before issue date', () => {
    const b = book(2);
    assert.equal(issue(member(), b, { dueOn: '2026-01-15' }).due_on, '2026-01-15');
    rejects(() => issue(member(), b, { dueOn: '2026-01-09' }), /before the issue date/);
    rejects(() => issue(member(), b, { issuedOn: '2026-01-11' }), /future/);
  });

  test('a member may hold at most 3 books', () => {
    const m = member('Asha');
    const books = [book(), book(), book(), book()];
    books.slice(0, 3).forEach((b) => issue(m, b));
    rejects(() => issue(m, books[3]), /already holds 3 books — the limit is 3/);
    assert.equal(avail(books[3]), 1, 'refused issue must not change availability');
    ret(lib.listIssues()[0]);
    issue(m, books[3]);
  });

  test('cannot issue when no copies available, or the same title twice, or to an inactive member', () => {
    const b = book(1);
    const m = member();
    issue(m, b);
    rejects(() => issue(member(), b), /No copies .* available/);
    const b2 = book(2);
    issue(m, b2);
    rejects(() => issue(m, b2), /already has a copy/);
    const inactive = member('Old', { active: false });
    rejects(() => issue(inactive, book()), /inactive/);
  });
});

describe('returns and fines', () => {
  test('on-time return: no fine, copy back on shelf', () => {
    const b = book(1);
    const i = issue(member(), b);
    advance(14);
    const r = ret(i);
    assert.equal(r.fine, 0);
    assert.equal(r.returned_on, '2026-01-24');
    assert.equal(avail(b), 1);
  });

  test('late return records ₹5/day against the member', () => {
    const m = member();
    const i = issue(m, book(1));
    advance(17); // due 01-24, returned 01-27
    const r = ret(i);
    assert.equal(r.daysLate, 3);
    assert.equal(r.fine, 15);
    assert.equal(lib.getMember(m.id).unpaid_fines, 15);
  });

  test('fines accumulate and block new issues until paid', () => {
    const m = member('Asha');
    const i1 = issue(m, book());
    const i2 = issue(m, book());
    advance(16);
    ret(i1); // 2 days late
    ret(i2); // 2 days late
    assert.equal(lib.getMember(m.id).unpaid_fines, 20);
    const b = book();
    rejects(() => issue(m, b), /unpaid fines of ₹20/);
    assert.equal(avail(b), 1);
    assert.equal(lib.payFines(m.id).paid, 20);
    assert.equal(lib.getMember(m.id).unpaid_fines, 0);
    issue(m, b);
    rejects(() => lib.payFines(m.id), /no unpaid fines/);
  });

  test('cannot return twice; return date validated', () => {
    const i = issue(member(), book());
    rejects(() => ret(i, { returnedOn: '2026-01-09' }), /before the issue date/);
    rejects(() => ret(i, { returnedOn: '2026-01-11' }), /future/);
    ret(i);
    rejects(() => ret(i), /already returned/);
  });

  test('backdated return date computes fine from that date', () => {
    const i = issue(member(), book());
    advance(30);
    assert.equal(ret(i, { returnedOn: '2026-01-26' }).fine, 10);
  });

  test('overdue list shows accruing fine for unreturned books', () => {
    const m = member();
    issue(m, book());
    advance(20); // 6 days overdue
    const d = lib.dashboard();
    assert.equal(d.overdue.length, 1);
    assert.equal(d.overdue[0].days_overdue, 6);
    assert.equal(d.overdue[0].accrued_fine, 30);
    assert.equal(lib.getMember(m.id).unpaid_fines, 0, 'fine is only recorded on return');
  });
});

describe('reservations queue', () => {
  test('can only reserve when no copy is available; no duplicates', () => {
    const b = book(1);
    const [a, c] = [member('A'), member('C')];
    rejects(() => reserve(a, b), /available — issue it directly/);
    issue(a, b);
    rejects(() => reserve(a, b), /currently has .* on loan/);
    const r = reserve(c, b);
    assert.equal(r.status, 'waiting');
    assert.equal(r.queue_position, 1);
    rejects(() => reserve(c, b), /already has a reservation/);
  });

  test('on return, the FIRST in queue is moved to ready-for-pickup and the copy is held 2 days', () => {
    const b = book(1);
    const [holder, first, second] = [member('Holder'), member('First'), member('Second')];
    const i = issue(holder, b);
    const r1 = reserve(first, b);
    const r2 = reserve(second, b);
    assert.equal(res(r2).queue_position, 2);

    advance(3);
    const out = ret(i);
    assert.equal(out.readyFor.memberName, 'First');
    assert.equal(res(r1).status, 'ready');
    assert.equal(res(r1).hold_until, '2026-01-15');
    assert.equal(res(r2).status, 'waiting');
    assert.equal(res(r2).queue_position, 1);
    assert.equal(avail(b), 0, 'held copy is not available to others');

    const d = lib.dashboard();
    assert.deepEqual(d.readyForPickup.map((r) => r.member_name), ['First']);
    assert.deepEqual(d.pendingReservations.map((r) => r.member_name), ['Second']);
  });

  test('a book with a queue cannot be issued to someone who is not first in the queue', () => {
    const b = book(1);
    const [holder, first, second, outsider] = [member('Holder'), member('First'), member('Second'), member('Outsider')];
    const i = issue(holder, b);
    reserve(first, b);
    reserve(second, b);
    rejects(() => issue(second, b), /only be issued to the first in the queue: First .* Second is number 2/);
    rejects(() => issue(outsider, b), /only be issued to the first in the queue/);
    rejects(() => issue(first, b), /first in the queue .* no copy has been returned yet/);

    ret(i); // copy now held for First; Second is now head of the waiting queue
    rejects(() => issue(outsider, b), /only be issued to the first in the queue: Second/);
    rejects(() => issue(second, b), /Second is first in the queue .* no copy has been returned yet/);
    const got = issue(first, b);
    assert.equal(got.fromReservation, true);
    assert.equal(avail(b), 0);
    assert.equal(lib.listReservations({ status: 'all' }).find((r) => r.member_name === 'First').status, 'fulfilled');
  });

  test('hold lasts 2 days, then passes to the next person in the queue', () => {
    const b = book(1);
    const [holder, first, second] = [member('Holder'), member('First'), member('Second')];
    const i = issue(holder, b);
    const r1 = reserve(first, b);
    const r2 = reserve(second, b);
    ret(i); // 01-10, held until 01-12

    advance(2); // 01-12: last day of hold, still held
    assert.equal(res(r1).status, 'ready');
    advance(1); // 01-13: expired
    assert.equal(res(r1).status, 'expired');
    assert.equal(res(r2).status, 'ready');
    assert.equal(res(r2).hold_until, '2026-01-15');
    rejects(() => issue(first, b), /only be issued|No copies/);

    advance(3); // 01-16: second also fails to collect -> back to the shelf
    assert.equal(res(r2).status, 'expired');
    assert.equal(avail(b), 1);
    issue(member('Walk-in'), b);
  });

  test('ready-for-pickup member is still subject to the fine and 3-book rules', () => {
    const b = book(1);
    const [holder, first] = [member('Holder'), member('First')];
    const i = issue(holder, b);
    reserve(first, b);
    const late = issue(first, book());
    advance(16);
    ret(late); // First now owes ₹10
    ret(i);
    rejects(() => issue(first, b), /unpaid fines of ₹10/);
    lib.payFines(first.id);
    issue(first, b);
  });

  test('cancelling a held reservation releases the copy to the next in queue', () => {
    const b = book(1);
    const [holder, first, second] = [member('Holder'), member('First'), member('Second')];
    const i = issue(holder, b);
    const r1 = reserve(first, b);
    const r2 = reserve(second, b);
    ret(i);
    const out = lib.cancelReservation(r1.id);
    assert.equal(out.readyFor.memberName, 'Second');
    assert.equal(res(r2).status, 'ready');
    rejects(() => lib.cancelReservation(r1.id), /already cancelled/);
    lib.cancelReservation(r2.id);
    assert.equal(avail(b), 1);
  });

  test('deactivating a member cancels their reservations and releases held copies', () => {
    const b = book(1);
    const [holder, first, second] = [member('Holder'), member('First'), member('Second')];
    const i = issue(holder, b);
    reserve(first, b);
    const r2 = reserve(second, b);
    ret(i);
    const upd = lib.updateMember(first.id, { active: false });
    assert.equal(upd.cancelledReservations, 1);
    assert.equal(res(r2).status, 'ready');
  });

  test('adding copies to a book serves the waiting queue first', () => {
    const b = book(1);
    issue(member(), b);
    const r = reserve(member('Waiter'), b);
    const upd = lib.updateBook(b.id, { total_copies: 3 });
    assert.equal(upd.promoted[0].memberName, 'Waiter');
    assert.equal(res(r).status, 'ready');
    assert.equal(avail(b), 1);
  });

  test('multiple copies: each returned copy goes to the next person in order', () => {
    const b = book(2);
    const i1 = issue(member(), b);
    const i2 = issue(member(), b);
    const [ra, rb, rc] = [reserve(member('A'), b), reserve(member('B'), b), reserve(member('C'), b)];
    ret(i2);
    assert.deepEqual([res(ra).status, res(rb).status, res(rc).status], ['ready', 'waiting', 'waiting']);
    ret(i1);
    assert.deepEqual([res(ra).status, res(rb).status, res(rc).status], ['ready', 'ready', 'waiting']);
    assert.equal(res(rc).queue_position, 1);
  });
});

describe('renewals', () => {
  test('renew extends due date to today + 14, at most twice', () => {
    const i = issue(member(), book(1));
    advance(10); // 01-20, due 01-24
    const r1 = lib.renewIssue(i.id);
    assert.equal(r1.due_on, '2026-02-03');
    assert.equal(r1.renewals, 1);
    assert.equal(r1.previousDue, '2026-01-24');
    advance(10);
    assert.equal(lib.renewIssue(i.id).renewals, 2);
    advance(1);
    rejects(() => lib.renewIssue(i.id), /renewed 2 times/);
  });

  test('cannot renew an overdue loan, with unpaid fines, or when someone is waiting', () => {
    const b = book(1);
    const m = member('Asha');
    const i = issue(m, b);
    const w = member('Waiter');
    const r = reserve(w, b);
    rejects(() => lib.renewIssue(i.id), /1 member is waiting/);
    lib.cancelReservation(r.id);
    advance(15);
    rejects(() => lib.renewIssue(i.id), /overdue and cannot be renewed/);
    const other = issue(m, book(1)); // issued 01-25, due 02-08
    advance(1);
    ret(i); // 01-26, 2 days late -> Asha owes ₹10
    rejects(() => lib.renewIssue(other.id), /unpaid fines of ₹10/);
    lib.payFines(m.id);
    assert.equal(lib.renewIssue(other.id).due_on, '2026-02-09');
    rejects(() => lib.renewIssue(i.id), /already been returned/);
  });

  test('cannot renew on the same day it was issued (no later due date)', () => {
    const i = issue(member(), book());
    rejects(() => lib.renewIssue(i.id), /already due on/);
  });
});

describe('fines ledger & stats', () => {
  test('ledger totals and stats', () => {
    const m = member('Asha');
    const i = issue(m, book());
    advance(16);
    ret(i); // ₹10
    let f = lib.listFines();
    assert.equal(f.totals.outstanding, 10);
    assert.equal(f.totals.members_owing, 1);
    assert.equal(lib.listFines({ status: 'unpaid' }).rows.length, 1);
    lib.payFines(m.id);
    f = lib.listFines();
    assert.equal(f.totals.collected, 10);
    assert.equal(f.totals.collected_this_month, 10);
    assert.equal(lib.listFines({ status: 'unpaid' }).rows.length, 0);

    const s = lib.stats();
    assert.equal(s.activity.length, 14);
    assert.equal(s.activity.at(-1).date, clock);
    assert.equal(s.activity.at(-1).returned, 1);
    assert.equal(s.onTimeRate, 0);
    assert.ok(s.recent.some((e) => e.type === 'fine_paid'));
    assert.equal(s.topBooks[0].loans, 1);
  });

  test('book history lists all loans', () => {
    const b = book(1);
    ret(issue(member(), b));
    issue(member(), b);
    assert.equal(lib.bookHistory(b.id).issues.length, 2);
  });
});

describe('staff', () => {
  test('a default Admin exists; staff get auto IDs and are validated', () => {
    const [admin] = lib.listStaff();
    assert.equal(admin.role, 'Admin');
    assert.equal(admin.staff_code, 'S001');
    const s = lib.addStaff({ name: 'Kavitha Rao', role: 'Librarian', shift: 'Morning', email: 'kavitha@example.com' });
    assert.equal(s.staff_code, 'S002');
    rejects(() => lib.addStaff({ name: 'X', role: 'Boss' }), /Role must be one of/);
    rejects(() => lib.addStaff({ name: 'X', shift: 'Night' }), /Shift must be one of/);
    rejects(() => lib.addStaff({ name: 'X', staff_code: 's002' }), /already in use/);
    rejects(() => lib.addStaff({ name: '' }), /Name is required/);
  });

  test('actions record which staff member performed them', () => {
    const lib1 = lib.addStaff({ name: 'Kavitha Rao', role: 'Librarian' });
    const asst = lib.addStaff({ name: 'Rakesh Kumar', role: 'Assistant' });
    const m = member('Asha');
    const i = issue(m, book(1), { staffId: lib1.id });
    assert.equal(i.issued_by, lib1.id);
    assert.equal(i.issued_by_name, 'Kavitha Rao');
    advance(16);
    const r = lib.returnBook(i.id, { staffId: asst.id });
    assert.equal(r.returned_by_name, 'Rakesh Kumar');
    lib.payFines(m.id, { staffId: lib1.id });
    const acts = lib.recentActivity(10);
    assert.deepEqual(acts.filter((e) => e.type !== 'reserved').map((e) => [e.type, e.staff_name]),
      [['fine_paid', 'Kavitha Rao'], ['returned', 'Rakesh Kumar'], ['issued', 'Kavitha Rao']]);
    const k = lib.getStaff(lib1.id);
    assert.equal(k.staff.issued_total, 1);
    assert.equal(k.staff.fines_collected, 10);
    assert.equal(k.recent.length, 2);
  });

  test('inactive staff cannot act; the last active Admin cannot be demoted or deactivated', () => {
    const [admin] = lib.listStaff();
    const s = lib.addStaff({ name: 'Old Hand', role: 'Assistant', active: false });
    rejects(() => issue(member(), book(), { staffId: s.id }), /inactive and cannot perform/);
    rejects(() => lib.updateStaff(admin.id, { role: 'Librarian' }), /at least one active Admin/);
    rejects(() => lib.updateStaff(admin.id, { active: false }), /at least one active Admin/);
    const second = lib.addStaff({ name: 'New Admin', role: 'Admin' });
    assert.equal(lib.updateStaff(admin.id, { role: 'Librarian' }).role, 'Librarian');
    rejects(() => lib.updateStaff(second.id, { active: false }), /at least one active Admin/);
  });
});

describe('CSV', () => {
  test('parses quoted fields and header aliases', () => {
    const rows = parseBooksCsv('﻿Title,Author,ISBN,Category,Copies\r\n"Hello, World","O\'Neil ""Jr""",9780000000017,Tech,2\r\n\r\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Hello, World');
    assert.equal(rows[0].author, 'O\'Neil "Jr"');
    assert.equal(rows[0].total_copies, '2');
    assert.throws(() => parseBooksCsv('title,author\nx,y'), /missing column/);
  });

  test('import reports bad rows and imports good ones', () => {
    lib.addBook({ title: 'Existing', author: 'A', isbn: '9780000000024', total_copies: 1 });
    const rows = parseBooksCsv([
      'title,author,isbn,category,total_copies',
      'Good,A,9780000000031,X,2',
      ',A,9780000000048,X,1',
      'Dup,A,9780000000024,X,1',
      'BadIsbn,A,12,X,1',
      'BadCopies,A,9780000000055,X,-1',
      'Also good,B,0306406152,,1',
    ].join('\n'));
    const r = lib.importBooks(rows);
    assert.equal(r.imported, 2);
    assert.deepEqual(r.skipped.map((s) => s.line), [3, 4, 5, 6]);
    assert.equal(lib.searchBooks({ q: 'Also good' })[0].category, 'General');
  });

  test('CSV export escapes quotes/commas and defuses formulas', () => {
    const csv = toCsv(['a', 'b'], [['x,y', '=SUM(1)'], ['say "hi"', 5]]);
    assert.equal(csv, 'a,b\r\n"x,y",\'=SUM(1)\r\n"say ""hi""",5\r\n');
  });
});
