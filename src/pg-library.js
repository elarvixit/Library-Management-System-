// PostgreSQL / Supabase implementation of the library service.
//
// Used automatically when the DATABASE_URL environment variable is set. It exposes the same methods
// and returns the same shapes as the SQLite `Library` (src/library.js), so the REST API and the
// frontend work unchanged. The rule-critical writes (issue, return, renew, reserve, cancel, pay,
// delete) call the PL/pgSQL functions from supabase/functions.sql, so the rules live in the database.
import pg from 'pg';
import {
  RULES, LibraryError, addDays, daysBetween, computeFine, parseDate, requiredText, optionalText,
  positiveInt, normalizeIsbn, validEmail, validPhone, bool,
} from './library.js';

// Return DATE columns as 'YYYY-MM-DD' strings and counts/sums as numbers (not strings).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const notFound = (what) => new LibraryError(`${what} not found.`, 404);
const conflict = (msg) => new LibraryError(msg, 409);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const id = (value, what) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new LibraryError(`A valid ${what} must be selected.`);
  return n;
};
const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
// SQLite returned 0/1 for flags; keep that shape for the frontend.
const flags = (r) => {
  if (!r) return r;
  for (const k of ['active', 'fine_paid', 'deleted']) if (typeof r[k] === 'boolean') r[k] = r[k] ? 1 : 0;
  return r;
};

/** Converts database errors into LibraryErrors with a sensible HTTP status. */
function translate(err) {
  if (err instanceof LibraryError) return err;
  if (err.code === 'P0001') return new LibraryError(err.message, /not found/i.test(err.message) ? 404 : 409);
  if (err.code === '23505') return new LibraryError('That value is already in use (duplicate).', 409);
  if (err.code === '23514') return new LibraryError(`Invalid value (${err.constraint || 'check failed'}).`, 400);
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return new LibraryError('Invalid input value.', 400);
  if (err.code === '42883' || err.code === '42P01') {
    return new LibraryError('The Supabase database is not set up yet. Run supabase/schema.sql and supabase/functions.sql in the SQL Editor.', 500);
  }
  return err;
}

const BOOK_SELECT = 'select * from v_books b';
const MEMBER_SELECT = `
  select m.*,
         (select count(*) from issues i where i.member_id = m.id and i.returned_on is null) as active_issues,
         (select coalesce(sum(fine), 0) from issues i where i.member_id = m.id and i.fine > 0 and not i.fine_paid) as unpaid_fines,
         (select count(*) from reservations r where r.member_id = m.id and r.status in ('waiting','ready')) as open_reservations
    from members m`;

export class PgLibrary {
  /**
   * @param {string} connectionString  e.g. the Supabase "Transaction pooler" URI
   * @param {{ timeZone?: string, pool?: { connect(): Promise<any> } }} [opts] `pool` lets tests inject a client pool
   */
  constructor(connectionString, { timeZone = process.env.LIBRARY_TIMEZONE || 'Asia/Kolkata', pool } = {}) {
    this.timeZone = timeZone;
    if (pool) { this.pool = pool; return; }
    // Common mistake: pasting the Supabase "Data API" project URL (https://….supabase.co) instead of the
    // database connection string. Report it clearly instead of failing with an obscure driver error.
    if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
      this.configError = new LibraryError('DATABASE_URL is not a PostgreSQL connection string. In Supabase click Connect → '
        + '"Transaction pooler" and copy the URI that starts with postgresql:// (not the https://…supabase.co project URL).', 500);
      console.error(this.configError.message);
      return;
    }
    {
      const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
      this.pool = new pg.Pool({
        connectionString,
        max: Number(process.env.PG_POOL_MAX) || 3, // serverless-friendly
        idleTimeoutMillis: 10_000,
        ssl: local || process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      });
      // Supabase/pgbouncer may close idle connections; without this handler that would crash the server.
      this.pool.on('error', (err) => console.warn('PostgreSQL idle connection closed:', err.message));
    }
  }

  /** Library-local date (used for CSV file names). */
  today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  /** Runs fn(tx) in a transaction with the library's time zone, after expiring stale holds. */
  async tx(fn) {
    if (this.configError) throw this.configError;
    let client;
    try {
      client = await this.pool.connect();
    } catch (err) {
      console.error('Could not connect to PostgreSQL:', err.message);
      throw new LibraryError(/password authentication/i.test(err.message)
        ? 'Could not sign in to the database: the password in DATABASE_URL is wrong.'
        : `Could not connect to the database (${err.code || err.message}). Check DATABASE_URL.`, 500);
    }
    try {
      // One round trip instead of four: start the transaction, set the library time zone,
      // release uncollected holds and read today's date. (Matters when the database is far away.)
      const tz = this.timeZone.replace(/[^A-Za-z0-9_/+-]/g, '');
      const res = await client.query(
        `begin; select set_config('TimeZone', '${tz}', true); select expire_holds(); select current_date::text as d`);
      const { d } = (Array.isArray(res) ? res.at(-1) : res).rows[0];
      const t = {
        today: d,
        q: async (sql, params = []) => (await client.query(sql, params)).rows.map(flags),
        one: async (sql, params = []) => flags((await client.query(sql, params)).rows[0]),
      };
      const result = await fn(t);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw translate(err);
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------- shared row builders
  async #issueRows(t, where, params = []) {
    const rows = await t.q(
      `select i.*, b.title, b.author, b.isbn, m.name as member_name, m.member_code, m.phone, m.email
         from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
        where ${where} order by i.due_on, i.id`, params);
    return rows.map((r) => {
      if (r.returned_on) return { ...r, overdue: false, days_overdue: 0, accrued_fine: r.fine };
      const { daysLate, fine } = computeFine(r.due_on, t.today);
      return { ...r, overdue: daysLate > 0, days_overdue: daysLate, accrued_fine: fine };
    });
  }
  #reservationRows(t, where, params = []) {
    return t.q(
      `select r.*, b.title, b.isbn, m.name as member_name, m.member_code, m.phone, m.email,
              case when r.status = 'waiting' then
                (select count(*) from reservations r2 where r2.book_id = r.book_id and r2.status = 'waiting' and r2.id <= r.id)
              end as queue_position,
              (select min(i.due_on) from issues i where i.book_id = r.book_id and i.returned_on is null)::text as next_due_on
         from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id
        where ${where} order by r.book_id, r.id`, params);
  }
  async #book(t, bookId) {
    const b = await t.one(`${BOOK_SELECT} where b.id = $1`, [id(bookId, 'book')]);
    if (!b) throw notFound('Book');
    return b;
  }
  async #member(t, memberId) {
    const m = await t.one(`${MEMBER_SELECT} where m.id = $1`, [id(memberId, 'member')]);
    if (!m) throw notFound('Member');
    return m;
  }
  async #readyIds(t, bookId) {
    return new Set((await t.q(`select id from reservations where book_id = $1 and status = 'ready'`, [bookId])).map((r) => r.id));
  }
  async #promotedSince(t, bookId, before) {
    const rows = await t.q(
      `select r.id, r.member_id, r.hold_until, m.name, m.member_code from reservations r join members m on m.id = r.member_id
        where r.book_id = $1 and r.status = 'ready' order by r.id`, [bookId]);
    return rows.filter((r) => !before.has(r.id)).map((r) => ({
      reservationId: r.id, memberId: r.member_id, memberName: r.name, memberCode: r.member_code, holdUntil: r.hold_until,
    }));
  }

  // ---------------------------------------------------------------- books
  #bookInput(input) {
    return {
      title: requiredText(input.title, 'Title'),
      author: requiredText(input.author, 'Author'),
      isbn: normalizeIsbn(input.isbn),
      category: optionalText(input.category, 80) || 'General',
      total: positiveInt(input.totalCopies ?? input.total_copies, 'Total copies'),
    };
  }
  async #assertIsbnFree(t, isbn, exceptId = 0) {
    const dup = await t.one('select id, title from books where isbn = $1 and not deleted and id <> $2', [isbn, exceptId]);
    if (dup) throw conflict(`ISBN ${isbn} already belongs to "${dup.title}".`);
  }

  getBook(bookId) { return this.tx((t) => this.#book(t, bookId)); }

  searchBooks({ q = '', field = 'all', availableOnly = false } = {}) {
    return this.tx(async (t) => {
      const where = ['true'];
      const params = [];
      const term = String(q ?? '').trim();
      if (term) {
        const cols = { title: 'b.title', author: 'b.author', category: 'b.category', isbn: 'b.isbn' };
        if (field !== 'all' && !cols[field]) throw new LibraryError('Search field must be one of: all, title, author, isbn, category.');
        const chosen = field === 'all' ? Object.keys(cols) : [field];
        where.push(`(${chosen.map((f) => {
          params.push(`%${esc(f === 'isbn' ? term.replace(/[\s-]/g, '') : term)}%`);
          return `${cols[f]} ilike $${params.length}`;
        }).join(' or ')})`);
      }
      if (bool(availableOnly)) where.push('b.available_copies > 0');
      return t.q(`${BOOK_SELECT} where ${where.join(' and ')} order by lower(b.title)`, params);
    });
  }

  bookHistory(bookId) {
    return this.tx(async (t) => {
      const book = await this.#book(t, bookId);
      return { book, issues: (await this.#issueRows(t, 'i.book_id = $1', [book.id])).reverse() };
    });
  }

  addBook(input) {
    return this.tx(async (t) => {
      const b = this.#bookInput(input);
      await this.#assertIsbnFree(t, b.isbn);
      const { id: newId } = await t.one(
        `insert into books (title, author, isbn, category, total_copies, available_copies) values ($1,$2,$3,$4,$5,$5) returning id`,
        [b.title, b.author, b.isbn, b.category, b.total]);
      return this.#book(t, newId);
    });
  }

  updateBook(bookId, input) {
    return this.tx(async (t) => {
      const existing = await this.#book(t, bookId);
      const b = this.#bookInput({ ...existing, ...input });
      await this.#assertIsbnFree(t, b.isbn, existing.id);
      const issued = existing.issued_copies;
      const held = existing.held_copies;
      const available = b.total - issued - held;
      if (available < 0) {
        throw conflict(`Total copies cannot be ${b.total}: ${plural(issued, 'copy')} ${issued === 1 ? 'is' : 'are'} issued`
          + `${held ? ` and ${held} held for pickup` : ''}. The minimum is ${issued + held}.`);
      }
      const before = await this.#readyIds(t, existing.id);
      await t.q('update books set title=$1, author=$2, isbn=$3, category=$4, total_copies=$5, available_copies=$6 where id=$7',
        [b.title, b.author, b.isbn, b.category, b.total, available, existing.id]);
      await t.q('select _drain_queue($1)', [existing.id]); // extra copies go to anyone waiting first
      const promoted = await this.#promotedSince(t, existing.id, before);
      return { ...(await this.#book(t, existing.id)), promoted };
    });
  }

  deleteBook(bookId) {
    return this.tx(async (t) => {
      const b = await t.one('select * from delete_book($1)', [id(bookId, 'book')]);
      return { deleted: true, id: b.id, title: b.title };
    });
  }

  importBooks(rows) {
    return this.tx(async (t) => {
      const imported = [];
      const skipped = [];
      for (const [i, row] of rows.entries()) {
        const line = row.__line ?? i + 2;
        try {
          const b = this.#bookInput(row);
          await this.#assertIsbnFree(t, b.isbn);
          await t.q('savepoint row_import');
          try {
            await t.q('insert into books (title, author, isbn, category, total_copies, available_copies) values ($1,$2,$3,$4,$5,$5)',
              [b.title, b.author, b.isbn, b.category, b.total]);
            await t.q('release savepoint row_import');
          } catch (err) {
            await t.q('rollback to savepoint row_import');
            throw translate(err);
          }
          imported.push({ line, title: b.title, isbn: b.isbn });
        } catch (err) {
          if (!(err instanceof LibraryError)) throw err;
          skipped.push({ line, reason: err.message });
        }
      }
      return { imported: imported.length, skipped, importedBooks: imported };
    });
  }

  // ---------------------------------------------------------------- members
  #memberInput(input, today) {
    const m = {
      name: requiredText(input.name, 'Name', 120),
      code: optionalText(input.member_code ?? input.memberCode, 30).toUpperCase(),
      phone: validPhone(input.phone),
      email: validEmail(input.email),
      joinDate: input.join_date ? parseDate(String(input.join_date).slice(0, 10), 'Join date') : today,
      active: input.active === undefined ? true : bool(input.active),
    };
    if (m.joinDate > today) throw new LibraryError('Join date cannot be in the future.');
    return m;
  }

  getMember(memberId) { return this.tx((t) => this.#member(t, memberId)); }

  listMembers({ q = '', activeOnly = false } = {}) {
    return this.tx((t) => {
      const where = ['true'];
      const params = [];
      const term = String(q ?? '').trim();
      if (term) {
        params.push(`%${esc(term)}%`);
        where.push('(m.name ilike $1 or m.member_code ilike $1 or m.email ilike $1 or m.phone ilike $1)');
      }
      if (bool(activeOnly)) where.push('m.active');
      return t.q(`${MEMBER_SELECT} where ${where.join(' and ')} order by lower(m.name)`, params);
    });
  }

  memberDetails(memberId) {
    return this.tx(async (t) => {
      const member = await this.#member(t, memberId);
      return {
        member,
        activeIssues: await this.#issueRows(t, 'i.member_id = $1 and i.returned_on is null', [member.id]),
        history: await this.#issueRows(t, 'i.member_id = $1 and i.returned_on is not null', [member.id]),
        reservations: await this.#reservationRows(t, `r.member_id = $1 and r.status in ('waiting','ready')`, [member.id]),
      };
    });
  }

  addMember(input) {
    return this.tx(async (t) => {
      const m = this.#memberInput(input, t.today);
      let code = m.code;
      if (!code) {
        const { n } = await t.one(`select coalesce(max(substring(member_code from 2)::int), 0) + 1 as n from members where member_code ~ '^M[0-9]+$'`);
        code = `M${String(n).padStart(4, '0')}`;
      }
      if (await t.one('select 1 from members where member_code = $1', [code])) throw conflict(`Member ID ${code} is already in use.`);
      const { id: newId } = await t.one(
        'insert into members (member_code, name, phone, email, join_date, active) values ($1,$2,$3,$4,$5,$6) returning id',
        [code, m.name, m.phone, m.email, m.joinDate, m.active]);
      return this.#member(t, newId);
    });
  }

  updateMember(memberId, input) {
    return this.tx(async (t) => {
      const existing = await this.#member(t, memberId);
      const m = this.#memberInput({ ...existing, active: !!existing.active, ...input }, t.today);
      const code = m.code || existing.member_code;
      if (await t.one('select 1 from members where member_code = $1 and id <> $2', [code, existing.id])) {
        throw conflict(`Member ID ${code} is already in use.`);
      }
      await t.q('update members set member_code=$1, name=$2, phone=$3, email=$4, join_date=$5, active=$6 where id=$7',
        [code, m.name, m.phone, m.email, m.joinDate, m.active, existing.id]);
      let cancelled = 0;
      if (existing.active && !m.active) {
        // An inactive member can't borrow: release their queue places and any held copy.
        for (const r of await t.q(`select id from reservations where member_id = $1 and status in ('waiting','ready') order by id`, [existing.id])) {
          await t.q('select cancel_reservation($1)', [r.id]);
          cancelled++;
        }
      }
      return { ...(await this.#member(t, existing.id)), cancelledReservations: cancelled };
    });
  }

  payFines(memberId) {
    return this.tx(async (t) => {
      const member = await this.#member(t, memberId);
      if (!member.unpaid_fines) throw new LibraryError(`${member.name} has no unpaid fines.`);
      const { paid } = await t.one('select pay_fines($1) as paid', [member.id]);
      return { paid, member: await this.#member(t, member.id) };
    });
  }

  // ---------------------------------------------------------------- issue / return / renew
  getIssue(issueId) {
    return this.tx(async (t) => {
      const [row] = await this.#issueRows(t, 'i.id = $1', [id(issueId, 'issue')]);
      if (!row) throw notFound('Issue record');
      return row;
    });
  }

  listIssues({ status = 'active' } = {}) {
    return this.tx((t) => {
      const where = { active: 'i.returned_on is null', returned: 'i.returned_on is not null', overdue: 'i.returned_on is null and i.due_on < current_date', all: 'true' }[status];
      if (!where) throw new LibraryError('Status must be one of: active, returned, overdue, all.');
      return this.#issueRows(t, where);
    });
  }

  issueBook({ memberId, bookId, issuedOn, dueOn } = {}) {
    return this.tx(async (t) => {
      const mid = id(memberId, 'member');
      const bid = id(bookId, 'book');
      const issueDate = issuedOn ? parseDate(issuedOn, 'Issue date') : t.today;
      const dueDate = dueOn ? parseDate(dueOn, 'Due date') : null;
      const ownHold = await t.one(`select 1 from reservations where book_id = $1 and member_id = $2 and status = 'ready'`, [bid, mid]);
      const row = await t.one('select * from issue_book($1, $2, $3, $4)', [mid, bid, dueDate, issueDate]);
      const [full] = await this.#issueRows(t, 'i.id = $1', [row.id]);
      return { ...full, fromReservation: !!ownHold };
    });
  }

  returnBook(issueId, { returnedOn } = {}) {
    return this.tx(async (t) => {
      const iid = id(issueId, 'issue');
      const issue = await t.one('select book_id from issues where id = $1', [iid]);
      if (!issue) throw notFound('Issue record');
      const date = returnedOn ? parseDate(returnedOn, 'Return date') : t.today;
      const before = await this.#readyIds(t, issue.book_id);
      await t.q('select return_book($1, $2)', [iid, date]);
      const [full] = await this.#issueRows(t, 'i.id = $1', [iid]);
      const promoted = await this.#promotedSince(t, issue.book_id, before);
      return { ...full, daysLate: Math.max(0, daysBetween(full.due_on, full.returned_on)), fine: full.fine, readyFor: promoted[0] ?? null };
    });
  }

  renewIssue(issueId) {
    return this.tx(async (t) => {
      const iid = id(issueId, 'issue');
      const prev = await t.one('select due_on from issues where id = $1', [iid]);
      if (!prev) throw notFound('Issue record');
      await t.q('select renew_issue($1)', [iid]);
      const [full] = await this.#issueRows(t, 'i.id = $1', [iid]);
      return { ...full, previousDue: prev.due_on };
    });
  }

  // ---------------------------------------------------------------- reservations
  reserveBook({ memberId, bookId } = {}) {
    return this.tx(async (t) => {
      const r = await t.one('select * from reserve_book($1, $2)', [id(memberId, 'member'), id(bookId, 'book')]);
      return (await this.#reservationRows(t, 'r.id = $1', [r.id]))[0];
    });
  }

  cancelReservation(reservationId) {
    return this.tx(async (t) => {
      const rid = id(reservationId, 'reservation');
      const r = await t.one('select book_id from reservations where id = $1', [rid]);
      if (!r) throw notFound('Reservation');
      const before = await this.#readyIds(t, r.book_id);
      before.delete(rid);
      await t.q('select cancel_reservation($1)', [rid]);
      const promoted = await this.#promotedSince(t, r.book_id, before);
      return { cancelled: true, id: rid, readyFor: promoted[0] ?? null };
    });
  }

  listReservations({ status = 'open' } = {}) {
    return this.tx((t) => {
      const where = {
        open: `r.status in ('waiting','ready')`, waiting: `r.status = 'waiting'`, ready: `r.status = 'ready'`,
        closed: `r.status in ('fulfilled','cancelled','expired')`, all: 'true',
      }[status];
      if (!where) throw new LibraryError('Status must be one of: open, waiting, ready, closed, all.');
      return this.#reservationRows(t, where);
    });
  }

  // ---------------------------------------------------------------- fines, dashboard, stats
  listFines({ status = 'all' } = {}) {
    return this.tx(async (t) => {
      const where = { unpaid: 'i.fine > 0 and not i.fine_paid', paid: 'i.fine > 0 and i.fine_paid', all: 'i.fine > 0' }[status];
      if (!where) throw new LibraryError('Status must be one of: unpaid, paid, all.');
      const rows = (await this.#issueRows(t, where)).sort((a, b) => (b.returned_on || '').localeCompare(a.returned_on || '') || b.id - a.id);
      const totals = await t.one(`select
          coalesce(sum(case when not fine_paid then fine end), 0) as outstanding,
          coalesce(sum(case when fine_paid then fine end), 0) as collected,
          coalesce(sum(case when fine_paid and to_char(paid_on, 'YYYY-MM') = to_char(current_date, 'YYYY-MM') then fine end), 0) as collected_this_month,
          count(distinct case when not fine_paid then member_id end) as members_owing
        from issues where fine > 0`);
      return { totals, rows };
    });
  }

  dashboard() {
    return this.tx(async (t) => {
      const overdue = await this.#issueRows(t, 'i.returned_on is null and i.due_on < current_date');
      const readyForPickup = (await this.#reservationRows(t, `r.status = 'ready'`)).sort((a, b) => a.hold_until.localeCompare(b.hold_until));
      const pendingReservations = await this.#reservationRows(t, `r.status = 'waiting'`);
      const issuedToday = await this.#issueRows(t, 'i.issued_on = current_date');
      const s = await t.one(`select
          (select count(*) from books where not deleted) as titles,
          (select coalesce(sum(total_copies), 0) from books where not deleted) as copies,
          (select coalesce(sum(available_copies), 0) from books where not deleted) as available,
          (select count(*) from members where active) as active_members,
          (select count(*) from issues where returned_on is null) as on_loan,
          (select coalesce(sum(fine), 0) from issues where fine > 0 and not fine_paid) as unpaid_fines`);
      return {
        today: t.today,
        rules: RULES,
        stats: {
          ...s,
          issued_today: issuedToday.length,
          overdue: overdue.length,
          overdue_fines_accruing: overdue.reduce((sum, r) => sum + r.accrued_fine, 0),
          pending_reservations: pendingReservations.length,
          ready_for_pickup: readyForPickup.length,
        },
        issuedToday, overdue, readyForPickup, pendingReservations,
      };
    });
  }

  stats({ days = 14 } = {}) {
    return this.tx(async (t) => {
      const from = addDays(t.today, -(days - 1));
      const issued = new Map((await t.q('select issued_on as d, count(*) as c from issues where issued_on >= $1 group by issued_on', [from])).map((r) => [r.d, r.c]));
      const returned = new Map((await t.q('select returned_on as d, count(*) as c from issues where returned_on >= $1 group by returned_on', [from])).map((r) => [r.d, r.c]));
      const activity = Array.from({ length: days }, (_, i) => {
        const d = addDays(from, i);
        return { date: d, issued: issued.get(d) ?? 0, returned: returned.get(d) ?? 0 };
      });
      const categories = await t.q(`
        select b.category, count(*) as titles, sum(b.total_copies) as copies,
               (select count(*) from issues i join books b2 on b2.id = i.book_id where b2.category = b.category and not b2.deleted) as loans
          from books b where not b.deleted group by b.category order by loans desc, copies desc`);
      const topBooks = await t.q(`
        select b.id, b.title, b.author, count(i.id) as loans from books b join issues i on i.book_id = b.id
         where not b.deleted group by b.id order by loans desc, b.title limit 5`);
      const dueSoon = await this.#issueRows(t, 'i.returned_on is null and i.due_on >= current_date and i.due_on <= current_date + $1::int', [RULES.DUE_SOON_DAYS]);
      const fines = await t.one(`select
          coalesce(sum(case when fine_paid and to_char(paid_on, 'YYYY-MM') = to_char(current_date, 'YYYY-MM') then fine end), 0) as collected_this_month,
          coalesce(sum(case when fine_paid then fine end), 0) as collected_total from issues where fine > 0`);
      const s = await t.one(`select
          (select coalesce(sum(total_copies), 0) from books where not deleted) as copies,
          (select count(*) from issues where returned_on is null) as on_loan,
          (select count(*) from issues where returned_on >= $1 and returned_on <= due_on) as on_time_returns,
          (select count(*) from issues where returned_on >= $1) as returns_in_period`, [from]);
      return {
        today: t.today, from, activity, categories, topBooks, dueSoon, fines,
        utilisation: s.copies ? Math.round((s.on_loan / s.copies) * 100) : 0,
        onTimeRate: s.returns_in_period ? Math.round((s.on_time_returns / s.returns_in_period) * 100) : null,
        recent: await this.#recent(t, 12),
      };
    });
  }

  recentActivity(limit = 20) { return this.tx((t) => this.#recent(t, limit)); }

  #recent(t, limit) {
    return t.q(`
      select * from (
        select 'issued' as type, i.issued_on::text as date, i.id as seq, b.title, m.name as member_name, null::int as amount
          from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
        union all
        select 'returned', i.returned_on::text, i.id, b.title, m.name, i.fine
          from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id where i.returned_on is not null
        union all
        select 'fine_paid', i.paid_on::text, i.id, b.title, m.name, i.fine
          from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id where i.paid_on is not null
        union all
        select 'reserved', r.reserved_on::text, r.id, b.title, m.name, null
          from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id
        union all
        select 'ready', r.ready_on::text, r.id, b.title, m.name, null
          from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id where r.ready_on is not null
        union all
        select r.status, r.closed_on::text, r.id, b.title, m.name, null
          from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id
         where r.closed_on is not null and r.status in ('expired', 'cancelled')
      ) e order by date desc, seq desc limit $1`, [limit]);
  }
}
