import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Library, LibraryError } from './library.js';
import { parseBooksCsv, toCsv } from './csv.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(lib) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  // Wraps a handler so LibraryErrors become clean JSON errors with the right HTTP status.
  const h = (fn, status = 200) => (req, res) => {
    try {
      res.status(status).json(fn(req, res) ?? { ok: true });
    } catch (err) {
      if (err instanceof LibraryError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Unexpected server error. See the server log for details.' });
    }
  };

  // Dashboard
  app.get('/api/dashboard', h(() => lib.dashboard()));

  // Books
  app.get('/api/books', h((req) => lib.searchBooks({
    q: req.query.q, field: req.query.field || 'all', availableOnly: req.query.available,
  })));
  app.get('/api/books/:id', h((req) => lib.getBook(req.params.id)));
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

  // Reservations
  app.get('/api/reservations', h((req) => lib.listReservations({ status: req.query.status || 'open' })));
  app.post('/api/reservations', h((req) => lib.reserveBook(req.body ?? {}), 201));
  app.post('/api/reservations/:id/cancel', h((req) => lib.cancelReservation(req.params.id)));

  // Overdue list export (CSV)
  app.get('/api/reports/overdue.csv', (req, res) => {
    const rows = lib.listIssues({ status: 'overdue' });
    const csv = toCsv(
      ['Member ID', 'Member name', 'Phone', 'Email', 'Book title', 'ISBN', 'Issued on', 'Due on', 'Days overdue', 'Fine (INR)'],
      rows.map((r) => [r.member_code, r.member_name, r.phone, r.email, r.title, r.isbn, r.issued_on, r.due_on, r.days_overdue, r.accrued_fine]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="overdue-${lib.today()}.csv"`);
    res.send(`﻿${csv}`); // BOM so Excel opens UTF-8 correctly
  });

  app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` }));
  // Malformed JSON bodies and other middleware errors -> JSON
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Request body is not valid JSON.' : err.message });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dbFile = process.env.DB_FILE || path.join(here, '..', 'data', 'library.db');
  const lib = new Library(openDb(dbFile));
  const port = Number(process.env.PORT) || 3000;
  createApp(lib).listen(port, () => {
    console.log(`Library Management System running at http://localhost:${port}`);
    console.log(`Database: ${dbFile}`);
  });
}
