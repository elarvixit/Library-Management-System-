// All business rules live here. The REST layer (server.js) only translates HTTP <-> these calls.
//
// Copy accounting invariant (checked by tests):
//   total_copies = available_copies + (copies currently issued) + (copies held for 'ready' reservations)
//
// Queue invariant: if a book has any 'waiting' reservation, available_copies is 0.
// Whenever a copy comes back to the shelf (return, hold expiry, cancelled hold, total copies
// increased) it is first offered to the head of the waiting queue, and only goes to the open
// shelf when nobody is waiting.

export const RULES = Object.freeze({
  LOAN_DAYS: 14,        // default due date = issue date + 14 days
  MAX_ACTIVE_ISSUES: 3, // a member may hold at most 3 books at a time
  FINE_PER_DAY: 5,      // ₹5 per day late
  HOLD_DAYS: 2,         // a returned copy is held for the next reserver for 2 days
  MAX_RENEWALS: 2,      // a loan can be extended at most twice
  DUE_SOON_DAYS: 3,     // "due soon" window on the dashboard
});

export const STAFF_ROLES = ['Admin', 'Librarian', 'Assistant'];
export const STAFF_SHIFTS = ['Morning', 'Evening', 'Full day'];

export class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'LibraryError';
    this.status = status;
  }
}
const notFound = (what) => new LibraryError(`${what} not found.`, 404);
const conflict = (msg) => new LibraryError(msg, 409);

// ---------------------------------------------------------------- dates (YYYY-MM-DD strings)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export function parseDate(value, field) {
  const s = typeof value === 'string' ? value.trim() : value;
  if (typeof s !== 'string' || !DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || addDays(s, 0) !== s) {
    throw new LibraryError(`${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return s;
}
/** Fine for returning on `returnedOn` an item due on `dueOn`. Returning on the due date is not late. */
export function computeFine(dueOn, returnedOn) {
  const daysLate = Math.max(0, daysBetween(dueOn, returnedOn));
  return { daysLate, fine: daysLate * RULES.FINE_PER_DAY };
}

// ---------------------------------------------------------------- input validation helpers
export function requiredText(value, field, max = 200) {
  const s = String(value ?? '').trim();
  if (!s) throw new LibraryError(`${field} is required.`);
  if (s.length > max) throw new LibraryError(`${field} must be at most ${max} characters.`);
  return s;
}
export function optionalText(value, max = 200) {
  const s = String(value ?? '').trim();
  if (s.length > max) throw new LibraryError(`Value "${s.slice(0, 20)}…" is too long.`);
  return s;
}
export function positiveInt(value, field, min = 1) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min) throw new LibraryError(`${field} must be a whole number of at least ${min}.`);
  if (n > 100000) throw new LibraryError(`${field} is unrealistically large.`);
  return n;
}
function id(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new LibraryError(`A valid ${what} must be selected.`);
  return n;
}
export function normalizeIsbn(raw) {
  const s = String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!s) throw new LibraryError('ISBN is required.');
  if (!/^(\d{9}[\dX]|\d{13})$/.test(s)) {
    throw new LibraryError(`ISBN "${raw}" is invalid — it must be 10 characters (last may be X) or 13 digits.`);
  }
  return s;
}
export function validEmail(value) {
  const s = optionalText(value, 120).toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new LibraryError(`Email "${s}" is not a valid email address.`);
  return s;
}
export function validPhone(value) {
  const s = optionalText(value, 30);
  if (s && !/^\+?[\d\s()-]{7,20}$/.test(s)) throw new LibraryError(`Phone "${s}" is not a valid phone number.`);
  if (s && s.replace(/\D/g, '').length < 7) throw new LibraryError(`Phone "${s}" needs at least 7 digits.`);
  return s;
}
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rupees = (n) => `₹${n}`;

// ---------------------------------------------------------------- the service
export class Library {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {{ today?: () => string }} [opts] injectable clock (tests use a fake one)
   */
  constructor(db, { today = localToday } = {}) {
    this.db = db;
    this.today = today;
    this.inTx = false;
  }

  // --- infrastructure ----------------------------------------------------------------------
  q(sql, ...params) { return this.db.prepare(sql).all(...params); }
  one(sql, ...params) { return this.db.prepare(sql).get(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }

  /** Runs fn in a transaction, after first expiring stale holds so every operation sees fresh state. */
  tx(fn) {
    if (this.inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      this.#expireHolds();
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTx = false;
    }
  }

  #book(bookId) {
    const b = this.one('SELECT * FROM books WHERE id = ? AND deleted = 0', id(bookId, 'book'));
    if (!b) throw notFound('Book');
    return b;
  }
  #member(memberId) {
    const m = this.one('SELECT * FROM members WHERE id = ?', id(memberId, 'member'));
    if (!m) throw notFound('Member');
    return m;
  }
  #unpaidFines(memberId) {
    return this.one('SELECT COALESCE(SUM(fine), 0) AS t FROM issues WHERE member_id = ? AND fine > 0 AND fine_paid = 0', memberId).t;
  }
  #activeIssueCount(memberId) {
    return this.one('SELECT COUNT(*) AS c FROM issues WHERE member_id = ? AND returned_on IS NULL', memberId).c;
  }
  #heldCount(bookId) {
    return this.one("SELECT COUNT(*) AS c FROM reservations WHERE book_id = ? AND status = 'ready'", bookId).c;
  }
  #issuedCount(bookId) {
    return this.one('SELECT COUNT(*) AS c FROM issues WHERE book_id = ? AND returned_on IS NULL', bookId).c;
  }
  /** Waiting reservations in FIFO order (id is insertion order, so ties on the same day are fair). */
  #waitingQueue(bookId) {
    return this.q(
      `SELECT r.*, m.name AS member_name, m.member_code FROM reservations r JOIN members m ON m.id = r.member_id
        WHERE r.book_id = ? AND r.status = 'waiting' ORDER BY r.id`, bookId);
  }

  /**
   * Hands shelf copies to the waiting queue: while there is an available copy and someone waiting,
   * the head of the queue becomes "ready for pickup" and the copy is held for HOLD_DAYS days.
   * Returns the reservations that were just made ready.
   */
  #drainQueue(bookId) {
    const today = this.today();
    const promoted = [];
    let { available_copies: available } = this.one('SELECT available_copies FROM books WHERE id = ?', bookId);
    for (const r of this.#waitingQueue(bookId)) {
      if (available <= 0) break;
      this.run(
        "UPDATE reservations SET status = 'ready', ready_on = ?, hold_until = ? WHERE id = ?",
        today, addDays(today, RULES.HOLD_DAYS), r.id);
      available -= 1;
      promoted.push({ reservationId: r.id, memberId: r.member_id, memberName: r.member_name, memberCode: r.member_code, holdUntil: addDays(today, RULES.HOLD_DAYS) });
    }
    this.run('UPDATE books SET available_copies = ? WHERE id = ?', available, bookId);
    return promoted;
  }

  /** A copy came back to the library (return / expired hold / cancelled hold): shelf it, then offer it to the queue. */
  #copyBackToShelf(bookId) {
    this.run('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', bookId);
    return this.#drainQueue(bookId);
  }

  /** Holds are kept through hold_until inclusive; from the next day the copy passes to the next person. */
  #expireHolds() {
    const today = this.today();
    const stale = this.q("SELECT * FROM reservations WHERE status = 'ready' AND hold_until < ? ORDER BY id", today);
    for (const r of stale) {
      this.run("UPDATE reservations SET status = 'expired', closed_on = ? WHERE id = ?", today, r.id);
      this.#copyBackToShelf(r.book_id);
    }
  }

  // --- books -------------------------------------------------------------------------------
  #bookInput(input) {
    return {
      title: requiredText(input.title, 'Title'),
      author: requiredText(input.author, 'Author'),
      isbn: normalizeIsbn(input.isbn),
      category: optionalText(input.category, 80) || 'General',
      total: positiveInt(input.totalCopies ?? input.total_copies, 'Total copies'),
    };
  }
  #assertIsbnFree(isbn, exceptId = 0) {
    const dup = this.one('SELECT id, title FROM books WHERE isbn = ? AND deleted = 0 AND id <> ?', isbn, exceptId);
    if (dup) throw conflict(`ISBN ${isbn} already belongs to "${dup.title}".`);
  }

  addBook(input) {
    return this.tx(() => {
      const b = this.#bookInput(input);
      this.#assertIsbnFree(b.isbn);
      const { lastInsertRowid } = this.run(
        'INSERT INTO books (title, author, isbn, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?, ?)',
        b.title, b.author, b.isbn, b.category, b.total, b.total);
      return this.getBook(Number(lastInsertRowid));
    });
  }

  updateBook(bookId, input) {
    return this.tx(() => {
      const existing = this.#book(bookId);
      const b = this.#bookInput({ ...existing, ...input });
      this.#assertIsbnFree(b.isbn, existing.id);
      const issued = this.#issuedCount(existing.id);
      const held = this.#heldCount(existing.id);
      const available = b.total - issued - held;
      if (available < 0) {
        throw conflict(
          `Total copies cannot be ${b.total}: ${plural(issued, 'copy')} ${issued === 1 ? 'is' : 'are'} issued` +
          `${held ? ` and ${held} held for pickup` : ''}. The minimum is ${issued + held}.`);
      }
      this.run(
        'UPDATE books SET title = ?, author = ?, isbn = ?, category = ?, total_copies = ?, available_copies = ? WHERE id = ?',
        b.title, b.author, b.isbn, b.category, b.total, available, existing.id);
      const promoted = this.#drainQueue(existing.id); // extra copies go to anyone waiting first
      return { ...this.getBook(existing.id), promoted };
    });
  }

  deleteBook(bookId) {
    return this.tx(() => {
      const book = this.#book(bookId);
      const holders = this.q(
        `SELECT m.name, m.member_code FROM issues i JOIN members m ON m.id = i.member_id
          WHERE i.book_id = ? AND i.returned_on IS NULL`, book.id);
      if (holders.length) {
        const who = holders.map((h) => `${h.name} (${h.member_code})`).join(', ');
        throw conflict(`Cannot delete "${book.title}": ${plural(holders.length, 'copy')} ${holders.length === 1 ? 'is' : 'are'} currently issued to ${who}. The book must be returned first.`);
      }
      const openRes = this.one("SELECT COUNT(*) AS c FROM reservations WHERE book_id = ? AND status IN ('waiting','ready')", book.id).c;
      if (openRes) {
        throw conflict(`Cannot delete "${book.title}": it has ${plural(openRes, 'open reservation')}. Cancel the reservations first.`);
      }
      // Soft delete: issue history and any fines recorded against members stay intact.
      this.run('UPDATE books SET deleted = 1 WHERE id = ?', book.id);
      return { deleted: true, id: book.id, title: book.title };
    });
  }

  getBook(bookId) {
    const b = this.one(`${BOOK_SELECT} WHERE b.id = ? AND b.deleted = 0`, id(bookId, 'book'));
    if (!b) throw notFound('Book');
    return b;
  }

  /** Search by title/author/ISBN/category (or all), optionally only books with an available copy. */
  searchBooks({ q = '', field = 'all', availableOnly = false } = {}) {
    return this.tx(() => {
      const where = ['b.deleted = 0'];
      const params = [];
      const term = String(q ?? '').trim();
      if (term) {
        const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const isbnLike = `%${term.replace(/[\s-]/g, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const cols = { title: 'b.title', author: 'b.author', category: 'b.category', isbn: 'b.isbn' };
        if (field !== 'all' && !cols[field]) throw new LibraryError('Search field must be one of: all, title, author, isbn, category.');
        const chosen = field === 'all' ? Object.keys(cols) : [field];
        where.push(`(${chosen.map((f) => `${cols[f]} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        for (const f of chosen) params.push(f === 'isbn' ? isbnLike : like);
      }
      if (bool(availableOnly)) where.push('b.available_copies > 0');
      return this.q(`${BOOK_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.title COLLATE NOCASE`, ...params);
    });
  }

  /** Bulk import from parsed CSV rows. Each row is validated independently; bad rows are reported, good ones imported. */
  importBooks(rows) {
    return this.tx(() => {
      const imported = [];
      const skipped = [];
      rows.forEach((row, i) => {
        const line = row.__line ?? i + 2;
        try {
          const b = this.#bookInput(row);
          this.#assertIsbnFree(b.isbn);
          this.run(
            'INSERT INTO books (title, author, isbn, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?, ?)',
            b.title, b.author, b.isbn, b.category, b.total, b.total);
          imported.push({ line, title: b.title, isbn: b.isbn });
        } catch (err) {
          if (!(err instanceof LibraryError)) throw err;
          skipped.push({ line, reason: err.message });
        }
      });
      return { imported: imported.length, skipped, importedBooks: imported };
    });
  }

  // --- members -----------------------------------------------------------------------------
  #memberInput(input) {
    return {
      name: requiredText(input.name, 'Name', 120),
      code: optionalText(input.member_code ?? input.memberCode, 30).toUpperCase(),
      phone: validPhone(input.phone),
      email: validEmail(input.email),
      joinDate: input.join_date ? parseDate(input.join_date, 'Join date') : this.today(),
      active: input.active === undefined ? true : bool(input.active),
    };
  }
  #nextMemberCode() {
    const rows = this.q("SELECT member_code FROM members WHERE member_code GLOB 'M[0-9]*'");
    const max = rows.reduce((acc, r) => Math.max(acc, Number(r.member_code.slice(1)) || 0), 0);
    return `M${String(max + 1).padStart(4, '0')}`;
  }

  addMember(input) {
    return this.tx(() => {
      const m = this.#memberInput(input);
      if (m.joinDate > this.today()) throw new LibraryError('Join date cannot be in the future.');
      const code = m.code || this.#nextMemberCode();
      if (this.one('SELECT 1 FROM members WHERE member_code = ?', code)) throw conflict(`Member ID ${code} is already in use.`);
      const { lastInsertRowid } = this.run(
        'INSERT INTO members (member_code, name, phone, email, join_date, active) VALUES (?, ?, ?, ?, ?, ?)',
        code, m.name, m.phone, m.email, m.joinDate, m.active ? 1 : 0);
      return this.getMember(Number(lastInsertRowid));
    });
  }

  updateMember(memberId, input) {
    return this.tx(() => {
      const existing = this.#member(memberId);
      const m = this.#memberInput({ ...existing, active: !!existing.active, ...input });
      if (m.joinDate > this.today()) throw new LibraryError('Join date cannot be in the future.');
      const code = m.code || existing.member_code;
      if (this.one('SELECT 1 FROM members WHERE member_code = ? AND id <> ?', code, existing.id)) {
        throw conflict(`Member ID ${code} is already in use.`);
      }
      this.run(
        'UPDATE members SET member_code = ?, name = ?, phone = ?, email = ?, join_date = ?, active = ? WHERE id = ?',
        code, m.name, m.phone, m.email, m.joinDate, m.active ? 1 : 0, existing.id);
      const cancelled = [];
      if (existing.active && !m.active) {
        // An inactive member can't borrow, so their place in any queue (and any held copy) is released.
        for (const r of this.q("SELECT * FROM reservations WHERE member_id = ? AND status IN ('waiting','ready')", existing.id)) {
          this.#closeReservation(r, 'cancelled');
          cancelled.push(r.id);
        }
      }
      return { ...this.getMember(existing.id), cancelledReservations: cancelled.length };
    });
  }

  getMember(memberId) {
    const m = this.one(`${MEMBER_SELECT} WHERE m.id = ?`, id(memberId, 'member'));
    if (!m) throw notFound('Member');
    return m;
  }

  memberDetails(memberId) {
    return this.tx(() => {
      const member = this.getMember(memberId);
      return {
        member,
        activeIssues: this.#issueRows('i.member_id = ? AND i.returned_on IS NULL', member.id),
        history: this.#issueRows('i.member_id = ? AND i.returned_on IS NOT NULL', member.id),
        reservations: this.#reservationRows("r.member_id = ? AND r.status IN ('waiting','ready')", member.id),
      };
    });
  }

  listMembers({ q = '', activeOnly = false } = {}) {
    return this.tx(() => {
      const where = ['1 = 1'];
      const params = [];
      const term = String(q ?? '').trim();
      if (term) {
        const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push("(m.name LIKE ? ESCAPE '\\' OR m.member_code LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\')");
        params.push(like, like, like, like);
      }
      if (bool(activeOnly)) where.push('m.active = 1');
      return this.q(`${MEMBER_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.name COLLATE NOCASE`, ...params);
    });
  }

  payFines(memberId, { staffId } = {}) {
    return this.tx(() => {
      const member = this.#member(memberId);
      const by = this.#actor(staffId);
      const amount = this.#unpaidFines(member.id);
      if (amount === 0) throw new LibraryError(`${member.name} has no unpaid fines.`);
      this.run('UPDATE issues SET fine_paid = 1, paid_on = ?, paid_by = ? WHERE member_id = ? AND fine > 0 AND fine_paid = 0', this.today(), by, member.id);
      return { paid: amount, member: this.getMember(member.id) };
    });
  }

  // --- issue / return ----------------------------------------------------------------------
  /**
   * Issue a book. Checks, in order:
   *  1. member exists and is active; book exists
   *  2. member has no unpaid fines (fines block new issues until paid)
   *  3. member holds fewer than MAX_ACTIVE_ISSUES books and doesn't already hold this title
   *  4. if the member has a copy held for them ("ready for pickup") -> issue that held copy
   *  5. otherwise, if people are waiting in the reservation queue, only the first in the queue
   *     may borrow; everyone else is refused
   *  6. otherwise a shelf copy must be available
   */
  issueBook({ memberId, bookId, issuedOn, dueOn, staffId } = {}) {
    return this.tx(() => {
      const today = this.today();
      const member = this.#member(memberId);
      const book = this.#book(bookId);
      const by = this.#actor(staffId);
      const issueDate = issuedOn ? parseDate(issuedOn, 'Issue date') : today;
      if (issueDate > today) throw new LibraryError('Issue date cannot be in the future.');
      const dueDate = dueOn ? parseDate(dueOn, 'Due date') : addDays(issueDate, RULES.LOAN_DAYS);
      if (dueDate < issueDate) throw new LibraryError('Due date cannot be before the issue date.');

      if (!member.active) throw conflict(`${member.name} is inactive and cannot borrow books.`);
      const owed = this.#unpaidFines(member.id);
      if (owed > 0) throw conflict(`${member.name} has unpaid fines of ${rupees(owed)}. The fine must be paid before a new book can be issued.`);
      const holding = this.#activeIssueCount(member.id);
      if (holding >= RULES.MAX_ACTIVE_ISSUES) {
        throw conflict(`${member.name} already holds ${holding} books — the limit is ${RULES.MAX_ACTIVE_ISSUES}. A book must be returned first.`);
      }
      if (this.one('SELECT 1 FROM issues WHERE member_id = ? AND book_id = ? AND returned_on IS NULL', member.id, book.id)) {
        throw conflict(`${member.name} already has a copy of "${book.title}".`);
      }

      const ownHold = this.one("SELECT * FROM reservations WHERE book_id = ? AND member_id = ? AND status = 'ready'", book.id, member.id);
      if (ownHold) {
        // The held copy is not counted in available_copies, so availability does not change here.
        this.run("UPDATE reservations SET status = 'fulfilled', closed_on = ? WHERE id = ?", today, ownHold.id);
      } else {
        const queue = this.#waitingQueue(book.id);
        if (queue.length) {
          const pos = queue.findIndex((r) => r.member_id === member.id);
          const first = queue[0];
          if (pos === 0) {
            throw conflict(`${member.name} is first in the queue for "${book.title}", but no copy has been returned yet. They will appear on the "Ready for pickup" list when one is.`);
          }
          throw conflict(
            `"${book.title}" has a reservation queue (${queue.length === 1 ? '1 person' : `${queue.length} people`} waiting). ` +
            `It can only be issued to the first in the queue: ${first.member_name} (${first.member_code}).` +
            (pos > 0 ? ` ${member.name} is number ${pos + 1} in the queue.` : ` ${member.name} can place a reservation.`));
        }
        if (book.available_copies <= 0) {
          const held = this.#heldCount(book.id);
          throw conflict(`No copies of "${book.title}" are available${held ? ` (${held} held for pickup by other members)` : ''}. ${member.name} can place a reservation.`);
        }
        this.run('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?', book.id);
      }
      const { lastInsertRowid } = this.run(
        'INSERT INTO issues (book_id, member_id, issued_on, due_on, issued_by) VALUES (?, ?, ?, ?, ?)', book.id, member.id, issueDate, dueDate, by);
      return { ...this.getIssue(Number(lastInsertRowid)), fromReservation: !!ownHold };
    });
  }

  returnBook(issueId, { returnedOn, staffId } = {}) {
    return this.tx(() => {
      const by = this.#actor(staffId);
      const today = this.today();
      const issue = this.one('SELECT * FROM issues WHERE id = ?', id(issueId, 'issue'));
      if (!issue) throw notFound('Issue record');
      if (issue.returned_on) throw conflict(`This book was already returned on ${issue.returned_on}.`);
      const returnDate = returnedOn ? parseDate(returnedOn, 'Return date') : today;
      if (returnDate > today) throw new LibraryError('Return date cannot be in the future.');
      if (returnDate < issue.issued_on) throw new LibraryError(`Return date cannot be before the issue date (${issue.issued_on}).`);

      const { daysLate, fine } = computeFine(issue.due_on, returnDate);
      this.run('UPDATE issues SET returned_on = ?, fine = ?, returned_by = ? WHERE id = ?', returnDate, fine, by, issue.id);
      const promoted = this.#copyBackToShelf(issue.book_id);
      return { ...this.getIssue(issue.id), daysLate, fine, readyFor: promoted[0] ?? null };
    });
  }

  /**
   * Renew (extend) a loan: new due date = today + LOAN_DAYS. Refused when
   *  - the loan is already returned or overdue (an overdue book must be returned and its fine paid),
   *  - the member has unpaid fines,
   *  - someone is waiting in the reservation queue for this book (they get it first),
   *  - the loan was already renewed MAX_RENEWALS times.
   */
  renewIssue(issueId) {
    return this.tx(() => {
      const today = this.today();
      const issue = this.one('SELECT * FROM issues WHERE id = ?', id(issueId, 'issue'));
      if (!issue) throw notFound('Issue record');
      if (issue.returned_on) throw conflict('This book has already been returned.');
      const member = this.#member(issue.member_id);
      const book = this.one('SELECT * FROM books WHERE id = ?', issue.book_id);
      if (issue.due_on < today) {
        throw conflict(`"${book.title}" is ${plural(daysBetween(issue.due_on, today), 'day')} overdue and cannot be renewed. It must be returned and the fine paid.`);
      }
      const owed = this.#unpaidFines(member.id);
      if (owed > 0) throw conflict(`${member.name} has unpaid fines of ${rupees(owed)}. Loans cannot be renewed until the fine is paid.`);
      const waiting = this.#waitingQueue(book.id).length;
      if (waiting) throw conflict(`"${book.title}" cannot be renewed: ${waiting === 1 ? '1 member is' : `${waiting} members are`} waiting for it in the reservation queue.`);
      if (issue.renewals >= RULES.MAX_RENEWALS) throw conflict(`This loan has already been renewed ${RULES.MAX_RENEWALS} times (the maximum).`);
      const newDue = addDays(today, RULES.LOAN_DAYS);
      if (newDue <= issue.due_on) throw conflict(`This loan is already due on ${issue.due_on}, which is later than a renewal would give.`);
      this.run('UPDATE issues SET due_on = ?, renewals = renewals + 1 WHERE id = ?', newDue, issue.id);
      return { ...this.getIssue(issue.id), previousDue: issue.due_on };
    });
  }

  /** Full loan history of one book (newest first). */
  bookHistory(bookId) {
    return this.tx(() => {
      const book = this.getBook(bookId);
      return { book, issues: this.#issueRows('i.book_id = ?', book.id).reverse() };
    });
  }

  /** Fines ledger: every loan that produced a fine. */
  listFines({ status = 'all' } = {}) {
    return this.tx(() => {
      const where = { unpaid: 'i.fine > 0 AND i.fine_paid = 0', paid: 'i.fine > 0 AND i.fine_paid = 1', all: 'i.fine > 0' }[status];
      if (!where) throw new LibraryError('Status must be one of: unpaid, paid, all.');
      const rows = this.#issueRows(where).sort((a, b) => (b.returned_on || '').localeCompare(a.returned_on || '') || b.id - a.id);
      const t = this.one(`SELECT COALESCE(SUM(CASE WHEN fine_paid = 0 THEN fine END), 0) AS outstanding,
          COALESCE(SUM(CASE WHEN fine_paid = 1 THEN fine END), 0) AS collected,
          COALESCE(SUM(CASE WHEN fine_paid = 1 AND substr(paid_on, 1, 7) = ? THEN fine END), 0) AS collected_this_month,
          COUNT(DISTINCT CASE WHEN fine_paid = 0 THEN member_id END) AS members_owing
        FROM issues WHERE fine > 0`, this.today().slice(0, 7));
      return { totals: t, rows };
    });
  }

  getIssue(issueId) {
    const [row] = this.#issueRows('i.id = ?', id(issueId, 'issue'));
    if (!row) throw notFound('Issue record');
    return row;
  }

  listIssues({ status = 'active' } = {}) {
    return this.tx(() => {
      const where = { active: 'i.returned_on IS NULL', returned: 'i.returned_on IS NOT NULL', overdue: 'i.returned_on IS NULL AND i.due_on < ?', all: '1 = 1' }[status];
      if (!where) throw new LibraryError('Status must be one of: active, returned, overdue, all.');
      return this.#issueRows(where, ...(status === 'overdue' ? [this.today()] : []));
    });
  }

  #issueRows(where, ...params) {
    const today = this.today();
    return this.q(
      `SELECT i.*, b.title, b.author, b.isbn, m.name AS member_name, m.member_code, m.phone, m.email,
              s1.name AS issued_by_name, s2.name AS returned_by_name, s3.name AS paid_by_name
         FROM issues i JOIN books b ON b.id = i.book_id JOIN members m ON m.id = i.member_id
         LEFT JOIN staff s1 ON s1.id = i.issued_by LEFT JOIN staff s2 ON s2.id = i.returned_by LEFT JOIN staff s3 ON s3.id = i.paid_by
        WHERE ${where} ORDER BY i.due_on, i.id`, ...params)
      .map((r) => {
        if (r.returned_on) return { ...r, overdue: false, days_overdue: 0, accrued_fine: r.fine };
        const { daysLate, fine } = computeFine(r.due_on, today);
        return { ...r, overdue: daysLate > 0, days_overdue: daysLate, accrued_fine: fine };
      });
  }

  // --- reservations ------------------------------------------------------------------------
  reserveBook({ memberId, bookId, staffId } = {}) {
    return this.tx(() => {
      const member = this.#member(memberId);
      const book = this.#book(bookId);
      const by = this.#actor(staffId);
      if (!member.active) throw conflict(`${member.name} is inactive and cannot reserve books.`);
      const open = this.one("SELECT * FROM reservations WHERE book_id = ? AND member_id = ? AND status IN ('waiting','ready')", book.id, member.id);
      if (open) {
        throw conflict(open.status === 'ready'
          ? `A copy of "${book.title}" is already held for ${member.name} until ${open.hold_until}.`
          : `${member.name} already has a reservation for "${book.title}".`);
      }
      if (this.one('SELECT 1 FROM issues WHERE member_id = ? AND book_id = ? AND returned_on IS NULL', member.id, book.id)) {
        throw conflict(`${member.name} currently has "${book.title}" on loan.`);
      }
      if (book.available_copies > 0) {
        throw conflict(`"${book.title}" has ${plural(book.available_copies, 'copy')} available — issue it directly instead of reserving.`);
      }
      const { lastInsertRowid } = this.run(
        "INSERT INTO reservations (book_id, member_id, reserved_on, status, created_by) VALUES (?, ?, ?, 'waiting', ?)", book.id, member.id, this.today(), by);
      return this.#reservationRows('r.id = ?', Number(lastInsertRowid))[0];
    });
  }

  cancelReservation(reservationId) {
    return this.tx(() => {
      const r = this.one('SELECT * FROM reservations WHERE id = ?', id(reservationId, 'reservation'));
      if (!r) throw notFound('Reservation');
      if (!['waiting', 'ready'].includes(r.status)) throw conflict(`This reservation is already ${r.status}.`);
      const promoted = this.#closeReservation(r, 'cancelled');
      return { cancelled: true, id: r.id, readyFor: promoted[0] ?? null };
    });
  }

  #closeReservation(r, status) {
    this.run('UPDATE reservations SET status = ?, closed_on = ? WHERE id = ?', status, this.today(), r.id);
    // A cancelled hold releases its copy to the next person in the queue (or the shelf).
    return r.status === 'ready' ? this.#copyBackToShelf(r.book_id) : [];
  }

  listReservations({ status = 'open' } = {}) {
    return this.tx(() => {
      const where = {
        open: "r.status IN ('waiting','ready')", waiting: "r.status = 'waiting'", ready: "r.status = 'ready'",
        closed: "r.status IN ('fulfilled','cancelled','expired')", all: '1 = 1',
      }[status];
      if (!where) throw new LibraryError('Status must be one of: open, waiting, ready, closed, all.');
      return this.#reservationRows(where);
    });
  }

  #reservationRows(where, ...params) {
    return this.q(
      `SELECT r.*, b.title, b.isbn, m.name AS member_name, m.member_code, m.phone, m.email,
              CASE WHEN r.status = 'waiting' THEN
                (SELECT COUNT(*) FROM reservations r2 WHERE r2.book_id = r.book_id AND r2.status = 'waiting' AND r2.id <= r.id)
              END AS queue_position,
              (SELECT MIN(i.due_on) FROM issues i WHERE i.book_id = r.book_id AND i.returned_on IS NULL) AS next_due_on
         FROM reservations r JOIN books b ON b.id = r.book_id JOIN members m ON m.id = r.member_id
        WHERE ${where} ORDER BY r.book_id, r.id`, ...params);
  }

  // --- dashboard ---------------------------------------------------------------------------
  dashboard() {
    return this.tx(() => {
      const today = this.today();
      const overdue = this.#issueRows('i.returned_on IS NULL AND i.due_on < ?', today);
      const readyForPickup = this.#reservationRows("r.status = 'ready'").sort((a, b) => a.hold_until.localeCompare(b.hold_until));
      const pendingReservations = this.#reservationRows("r.status = 'waiting'");
      const issuedToday = this.#issueRows('i.issued_on = ?', today);
      const s = this.one(`SELECT
          (SELECT COUNT(*) FROM books WHERE deleted = 0) AS titles,
          (SELECT COALESCE(SUM(total_copies), 0) FROM books WHERE deleted = 0) AS copies,
          (SELECT COALESCE(SUM(available_copies), 0) FROM books WHERE deleted = 0) AS available,
          (SELECT COUNT(*) FROM members WHERE active = 1) AS active_members,
          (SELECT COUNT(*) FROM issues WHERE returned_on IS NULL) AS on_loan,
          (SELECT COALESCE(SUM(fine), 0) FROM issues WHERE fine > 0 AND fine_paid = 0) AS unpaid_fines`);
      return {
        today,
        rules: RULES,
        stats: {
          ...s,
          issued_today: issuedToday.length,
          overdue: overdue.length,
          overdue_fines_accruing: overdue.reduce((t, r) => t + r.accrued_fine, 0),
          pending_reservations: pendingReservations.length,
          ready_for_pickup: readyForPickup.length,
        },
        issuedToday,
        overdue,
        readyForPickup,
        pendingReservations,
      };
    });
  }

  /** Analytics for the dashboard: 14-day activity, categories, top books, due soon, fines, recent activity. */
  stats({ days = 14 } = {}) {
    return this.tx(() => {
      const today = this.today();
      const from = addDays(today, -(days - 1));
      const issued = new Map(this.q('SELECT issued_on AS d, COUNT(*) AS c FROM issues WHERE issued_on >= ? GROUP BY issued_on', from).map((r) => [r.d, r.c]));
      const returned = new Map(this.q('SELECT returned_on AS d, COUNT(*) AS c FROM issues WHERE returned_on >= ? GROUP BY returned_on', from).map((r) => [r.d, r.c]));
      const activity = Array.from({ length: days }, (_, i) => {
        const d = addDays(from, i);
        return { date: d, issued: issued.get(d) ?? 0, returned: returned.get(d) ?? 0 };
      });
      const categories = this.q(`
        SELECT b.category, COUNT(*) AS titles, SUM(b.total_copies) AS copies,
               (SELECT COUNT(*) FROM issues i JOIN books b2 ON b2.id = i.book_id WHERE b2.category = b.category AND b2.deleted = 0) AS loans
          FROM books b WHERE b.deleted = 0 GROUP BY b.category ORDER BY loans DESC, copies DESC`);
      const topBooks = this.q(`
        SELECT b.id, b.title, b.author, COUNT(i.id) AS loans FROM books b JOIN issues i ON i.book_id = b.id
         WHERE b.deleted = 0 GROUP BY b.id ORDER BY loans DESC, b.title LIMIT 5`);
      const dueSoon = this.#issueRows('i.returned_on IS NULL AND i.due_on >= ? AND i.due_on <= ?', today, addDays(today, RULES.DUE_SOON_DAYS));
      const f = this.one(`SELECT COALESCE(SUM(CASE WHEN fine_paid = 1 AND substr(paid_on, 1, 7) = ? THEN fine END), 0) AS collected_this_month,
          COALESCE(SUM(CASE WHEN fine_paid = 1 THEN fine END), 0) AS collected_total FROM issues WHERE fine > 0`, today.slice(0, 7));
      const s = this.one(`SELECT
          (SELECT COALESCE(SUM(total_copies), 0) FROM books WHERE deleted = 0) AS copies,
          (SELECT COUNT(*) FROM issues WHERE returned_on IS NULL) AS on_loan,
          (SELECT COUNT(*) FROM issues WHERE returned_on >= ? AND returned_on <= due_on) AS on_time_returns,
          (SELECT COUNT(*) FROM issues WHERE returned_on >= ?) AS returns_in_period`, from, from);
      return {
        today, from, activity, categories, topBooks, dueSoon,
        fines: f,
        utilisation: s.copies ? Math.round((s.on_loan / s.copies) * 100) : 0,
        onTimeRate: s.returns_in_period ? Math.round((s.on_time_returns / s.returns_in_period) * 100) : null,
        recent: this.recentActivity(12),
      };
    });
  }

  /** Recent events derived from the issue/reservation tables (newest first). */
  recentActivity(limit = 20) {
    const rows = this.q(`
      SELECT * FROM (
        SELECT 'issued' AS type, i.issued_on AS date, i.id AS seq, b.title, m.name AS member_name, NULL AS amount, i.issued_by AS staff_id
          FROM issues i JOIN books b ON b.id = i.book_id JOIN members m ON m.id = i.member_id
        UNION ALL
        SELECT 'returned', i.returned_on, i.id, b.title, m.name, i.fine, i.returned_by
          FROM issues i JOIN books b ON b.id = i.book_id JOIN members m ON m.id = i.member_id WHERE i.returned_on IS NOT NULL
        UNION ALL
        SELECT 'fine_paid', i.paid_on, i.id, b.title, m.name, i.fine, i.paid_by
          FROM issues i JOIN books b ON b.id = i.book_id JOIN members m ON m.id = i.member_id WHERE i.paid_on IS NOT NULL
        UNION ALL
        SELECT 'reserved', r.reserved_on, r.id, b.title, m.name, NULL, r.created_by
          FROM reservations r JOIN books b ON b.id = r.book_id JOIN members m ON m.id = r.member_id
        UNION ALL
        SELECT 'ready', r.ready_on, r.id, b.title, m.name, NULL, NULL
          FROM reservations r JOIN books b ON b.id = r.book_id JOIN members m ON m.id = r.member_id WHERE r.ready_on IS NOT NULL
        UNION ALL
        SELECT r.status, r.closed_on, r.id, b.title, m.name, NULL, NULL
          FROM reservations r JOIN books b ON b.id = r.book_id JOIN members m ON m.id = r.member_id
         WHERE r.closed_on IS NOT NULL AND r.status IN ('expired', 'cancelled')
      ) e LEFT JOIN (SELECT id AS sid, name AS staff_name, role AS staff_role FROM staff) s ON s.sid = e.staff_id
      ORDER BY date DESC,
               CASE type WHEN 'fine_paid' THEN 3 WHEN 'returned' THEN 2 WHEN 'expired' THEN 2 WHEN 'cancelled' THEN 2 WHEN 'ready' THEN 2 ELSE 1 END DESC,
               seq DESC LIMIT ?`, limit);
    return rows.map(({ sid, ...r }) => r);
  }

  // --- staff -------------------------------------------------------------------------------
  /** Staff id recorded on an action. Null is allowed (e.g. scripts); if given it must be active staff. */
  #actor(staffId) {
    if (staffId === undefined || staffId === null || staffId === '') return null;
    const s = this.one('SELECT * FROM staff WHERE id = ?', id(staffId, 'staff member'));
    if (!s) throw notFound('Staff member');
    if (!s.active) throw conflict(`${s.name} is inactive and cannot perform library actions. Choose another staff member on duty.`);
    return s.id;
  }
  #staffInput(input, { checkJoinDate = true } = {}) {
    const role = String(input.role ?? 'Librarian').trim();
    if (!STAFF_ROLES.includes(role)) throw new LibraryError(`Role must be one of: ${STAFF_ROLES.join(', ')}.`);
    const shift = String(input.shift ?? 'Full day').trim();
    if (!STAFF_SHIFTS.includes(shift)) throw new LibraryError(`Shift must be one of: ${STAFF_SHIFTS.join(', ')}.`);
    const joinDate = input.join_date ? parseDate(input.join_date, 'Join date') : this.today();
    if (checkJoinDate && joinDate > this.today()) throw new LibraryError('Join date cannot be in the future.');
    return {
      name: requiredText(input.name, 'Name', 120),
      code: optionalText(input.staff_code ?? input.staffCode, 20).toUpperCase(),
      role, shift, joinDate,
      email: validEmail(input.email),
      phone: validPhone(input.phone),
      active: input.active === undefined ? true : bool(input.active),
    };
  }
  #staffRow(where, ...params) {
    const today = this.today();
    return this.q(`${STAFF_SELECT} WHERE ${where} ORDER BY CASE s.role WHEN 'Admin' THEN 0 WHEN 'Librarian' THEN 1 ELSE 2 END, s.name COLLATE NOCASE`,
      today, today, ...params);
  }
  /** At least one active Admin must always remain. */
  #assertAdminRemains(exceptId) {
    const n = this.one("SELECT COUNT(*) AS c FROM staff WHERE role = 'Admin' AND active = 1 AND id <> ?", exceptId).c;
    if (!n) throw conflict('The library must keep at least one active Admin. Make another staff member an Admin first.');
  }

  listStaff() { return this.tx(() => this.#staffRow('1 = 1')); }

  getStaff(staffId) {
    return this.tx(() => {
      const [s] = this.#staffRow('s.id = ?', id(staffId, 'staff member'));
      if (!s) throw notFound('Staff member');
      const recent = this.recentActivity(200).filter((e) => e.staff_id === s.id).slice(0, 25);
      return { staff: s, recent };
    });
  }

  addStaff(input) {
    return this.tx(() => {
      const s = this.#staffInput(input);
      let code = s.code;
      if (!code) {
        const max = this.q("SELECT staff_code FROM staff WHERE staff_code GLOB 'S[0-9]*'").reduce((a, r) => Math.max(a, Number(r.staff_code.slice(1)) || 0), 0);
        code = `S${String(max + 1).padStart(3, '0')}`;
      }
      if (this.one('SELECT 1 FROM staff WHERE staff_code = ?', code)) throw conflict(`Staff ID ${code} is already in use.`);
      const { lastInsertRowid } = this.run(
        'INSERT INTO staff (staff_code, name, role, email, phone, shift, join_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        code, s.name, s.role, s.email, s.phone, s.shift, s.joinDate, s.active ? 1 : 0);
      return this.#staffRow('s.id = ?', Number(lastInsertRowid))[0];
    });
  }

  updateStaff(staffId, input) {
    return this.tx(() => {
      const existing = this.one('SELECT * FROM staff WHERE id = ?', id(staffId, 'staff member'));
      if (!existing) throw notFound('Staff member');
      // only validate the join date when it is being changed
      const s = this.#staffInput({ ...existing, active: !!existing.active, ...input },
        { checkJoinDate: input.join_date !== undefined && input.join_date !== existing.join_date });
      const code = s.code || existing.staff_code;
      if (this.one('SELECT 1 FROM staff WHERE staff_code = ? AND id <> ?', code, existing.id)) throw conflict(`Staff ID ${code} is already in use.`);
      if (existing.role === 'Admin' && existing.active && (s.role !== 'Admin' || !s.active)) this.#assertAdminRemains(existing.id);
      this.run('UPDATE staff SET staff_code = ?, name = ?, role = ?, email = ?, phone = ?, shift = ?, join_date = ?, active = ? WHERE id = ?',
        code, s.name, s.role, s.email, s.phone, s.shift, s.joinDate, s.active ? 1 : 0, existing.id);
      return this.#staffRow('s.id = ?', existing.id)[0];
    });
  }

  /** Test/diagnostic helper: true when every book satisfies the copy accounting invariant. */
  checkInvariants() {
    const bad = this.q(
      `SELECT b.id, b.title, b.total_copies, b.available_copies,
              (SELECT COUNT(*) FROM issues i WHERE i.book_id = b.id AND i.returned_on IS NULL) AS issued,
              (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status = 'ready') AS held,
              (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status = 'waiting') AS waiting
         FROM books b`)
      .filter((b) => b.total_copies !== b.available_copies + b.issued + b.held || (b.waiting > 0 && b.available_copies > 0));
    return bad;
  }
}

const BOOK_SELECT = `
  SELECT b.id, b.title, b.author, b.isbn, b.category, b.total_copies, b.available_copies,
         (SELECT COUNT(*) FROM issues i WHERE i.book_id = b.id AND i.returned_on IS NULL) AS issued_copies,
         (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status = 'ready') AS held_copies,
         (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status = 'waiting') AS queue_length
    FROM books b`;

const MEMBER_SELECT = `
  SELECT m.*,
         (SELECT COUNT(*) FROM issues i WHERE i.member_id = m.id AND i.returned_on IS NULL) AS active_issues,
         (SELECT COALESCE(SUM(fine), 0) FROM issues i WHERE i.member_id = m.id AND i.fine > 0 AND i.fine_paid = 0) AS unpaid_fines,
         (SELECT COUNT(*) FROM reservations r WHERE r.member_id = m.id AND r.status IN ('waiting','ready')) AS open_reservations
    FROM members m`;

// Two parameters: today (issued today), today (returned today).
const STAFF_SELECT = `
  SELECT s.*,
         (SELECT COUNT(*) FROM issues i WHERE i.issued_by = s.id) AS issued_total,
         (SELECT COUNT(*) FROM issues i WHERE i.returned_by = s.id) AS returned_total,
         (SELECT COALESCE(SUM(fine), 0) FROM issues i WHERE i.paid_by = s.id) AS fines_collected,
         (SELECT COUNT(*) FROM issues i WHERE i.issued_by = s.id AND i.issued_on = ?) AS issued_today,
         (SELECT COUNT(*) FROM issues i WHERE i.returned_by = s.id AND i.returned_on = ?) AS returned_today
    FROM staff s`;
