import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Library, LibraryError } from './library.js';
import { parseBooksCsv, toCsv } from './csv.js';
import { seedDemo } from './demo-seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(lib) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  // Wraps a handler so LibraryErrors become clean JSON errors with the right HTTP status.
  // Works for both the synchronous SQLite service and the async Supabase/Postgres service.
  const fail = (res, err) => {
    if (err instanceof LibraryError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error. See the server log for details.' });
  };
  const h = (fn, status = 200) => async (req, res) => {
    try {
      res.status(status).json((await fn(req, res)) ?? { ok: true });
    } catch (err) { fail(res, err); }
  };

  // Dashboard & analytics
  app.get('/api/dashboard', h(() => lib.dashboard()));
  app.get('/api/stats', h((req) => lib.stats({ days: Math.min(90, Math.max(7, Number(req.query.days) || 14)) })));
  app.get('/api/activity', h((req) => lib.recentActivity(Math.min(200, Number(req.query.limit) || 50))));
  app.get('/api/fines', h((req) => lib.listFines({ status: req.query.status || 'all' })));

  const sendCsv = async (res, name, headers, rowsPromise) => {
    let rows;
    try { rows = await rowsPromise; } catch (err) { return fail(res, err); }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${lib.today()}.csv"`);
    res.send(`﻿${toCsv(headers, rows)}`);
  };
  app.get('/api/reports/books.csv', (req, res) => sendCsv(res, 'books',
    ['title', 'author', 'isbn', 'category', 'total_copies', 'available_copies', 'on_loan', 'held', 'waiting'],
    Promise.resolve(lib.searchBooks({})).then((list) => list.map((b) => [b.title, b.author, b.isbn, b.category, b.total_copies, b.available_copies, b.issued_copies, b.held_copies, b.queue_length]))));
  app.get('/api/reports/members.csv', (req, res) => sendCsv(res, 'members',
    ['Member ID', 'Name', 'Phone', 'Email', 'Join date', 'Status', 'Books on loan', 'Unpaid fines (INR)'],
    Promise.resolve(lib.listMembers({})).then((list) => list.map((m) => [m.member_code, m.name, m.phone, m.email, m.join_date, m.active ? 'Active' : 'Inactive', m.active_issues, m.unpaid_fines]))));
  app.get('/api/reports/fines.csv', (req, res) => sendCsv(res, 'fines',
    ['Member ID', 'Member name', 'Book title', 'Due on', 'Returned on', 'Fine (INR)', 'Status', 'Paid on'],
    Promise.resolve(lib.listFines({})).then((f) => f.rows.map((r) => [r.member_code, r.member_name, r.title, r.due_on, r.returned_on, r.fine, r.fine_paid ? 'Paid' : 'Unpaid', r.paid_on]))));
  app.get('/api/reports/books-template.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="books-import-template.csv"');
    res.send('title,author,isbn,category,total_copies\r\nThe Hobbit,J.R.R. Tolkien,9780261102217,Fantasy,3\r\n');
  });

  // Books
  app.get('/api/books', h((req) => lib.searchBooks({
    q: req.query.q, field: req.query.field || 'all', availableOnly: req.query.available,
  })));
  app.get('/api/books/:id', h((req) => lib.getBook(req.params.id)));
  app.get('/api/books/:id/history', h((req) => lib.bookHistory(req.params.id)));
  app.post('/api/books', h((req) => lib.addBook(req.body ?? {}), 201));
  app.put('/api/books/:id', h((req) => lib.updateBook(req.params.id, req.body ?? {})));
  app.delete('/api/books/:id', h((req) => lib.deleteBook(req.params.id)));
  app.post('/api/books/import', h((req) => {
    let rows;
    try { rows = parseBooksCsv(req.body?.csv); } catch (e) { throw new LibraryError(e.message); }
    if (!rows.length) throw new LibraryError('The CSV file has a header but no book rows.');
    return lib.importBooks(rows);
  }));

  // Members
  app.get('/api/members', h((req) => lib.listMembers({ q: req.query.q, activeOnly: req.query.active })));
  app.get('/api/members/:id', h((req) => lib.memberDetails(req.params.id)));
  app.post('/api/members', h((req) => lib.addMember(req.body ?? {}), 201));
  app.put('/api/members/:id', h((req) => lib.updateMember(req.params.id, req.body ?? {})));
  app.post('/api/members/:id/pay-fine', h((req) => lib.payFines(req.params.id)));

  // Issues & returns
  app.get('/api/issues', h((req) => lib.listIssues({ status: req.query.status || 'active' })));
  app.post('/api/issues', h((req) => lib.issueBook(req.body ?? {}), 201));
  app.post('/api/issues/:id/return', h((req) => lib.returnBook(req.params.id, req.body ?? {})));
  app.post('/api/issues/:id/renew', h((req) => lib.renewIssue(req.params.id)));

  // Reservations
  app.get('/api/reservations', h((req) => lib.listReservations({ status: req.query.status || 'open' })));
  app.post('/api/reservations', h((req) => lib.reserveBook(req.body ?? {}), 201));
  app.post('/api/reservations/:id/cancel', h((req) => lib.cancelReservation(req.params.id)));

  // Overdue list export (CSV)
  app.get('/api/reports/overdue.csv', (req, res) => sendCsv(res, 'overdue',
    ['Member ID', 'Member name', 'Phone', 'Email', 'Book title', 'ISBN', 'Issued on', 'Due on', 'Days overdue', 'Fine (INR)'],
    Promise.resolve(lib.listIssues({ status: 'overdue' })).then((list) => list.map((r) =>
      [r.member_code, r.member_name, r.phone, r.email, r.title, r.isbn, r.issued_on, r.due_on, r.days_overdue, r.accrued_fine]))));

  app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` }));
  // Malformed JSON bodies and other middleware errors -> JSON
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Request body is not valid JSON.' : err.message });
  });
  return app;
}

// ---------------------------------------------------------------- default app
// Database choice:
//  • DATABASE_URL set  -> Supabase / PostgreSQL (permanent storage; run the supabase/*.sql scripts first)
//  • otherwise         -> SQLite file. On Vercel the project folder is read-only, so the SQLite file lives
//                         in /tmp (temporary) and is filled with demo data when empty.
const onVercel = !!process.env.VERCEL;
let lib;
let dbLabel;
if (process.env.DATABASE_URL) {
  const { PgLibrary } = await import('./pg-library.js');
  lib = new PgLibrary(process.env.DATABASE_URL.trim());
  dbLabel = 'PostgreSQL (DATABASE_URL)';
} else {
  const dbFile = process.env.DB_FILE || (onVercel ? '/tmp/library.db' : path.join(here, '..', 'data', 'library.db'));
  const db = openDb(dbFile);
  if (onVercel || process.env.SEED_DEMO === '1') seedDemo(db);
  lib = new Library(db);
  dbLabel = dbFile;
}
const app = createApp(lib);
export default app;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !onVercel) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Library Management System running at http://localhost:${port}`);
    console.log(`Database: ${dbLabel}`);
  });
}
