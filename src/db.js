import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  author           TEXT    NOT NULL,
  isbn             TEXT    NOT NULL,
  category         TEXT    NOT NULL DEFAULT 'General',
  total_copies     INTEGER NOT NULL CHECK (total_copies >= 1),
  -- Copies on the shelf that anyone may borrow. Copies that are issued, or held
  -- for a reservation ("ready for pickup"), are NOT counted here.
  available_copies INTEGER NOT NULL CHECK (available_copies >= 0 AND available_copies <= total_copies),
  deleted          INTEGER NOT NULL DEFAULT 0,  -- soft delete keeps issue/fine history intact
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- ISBN must be unique among books that have not been deleted.
CREATE UNIQUE INDEX IF NOT EXISTS ux_books_isbn ON books(isbn) WHERE deleted = 0;

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_code TEXT    NOT NULL UNIQUE,       -- the human-facing "Member ID", e.g. M0001
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  join_date   TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  issued_on   TEXT    NOT NULL,
  due_on      TEXT    NOT NULL,
  returned_on TEXT,
  fine        INTEGER NOT NULL DEFAULT 0 CHECK (fine >= 0),  -- rupees, set on return
  fine_paid   INTEGER NOT NULL DEFAULT 0 CHECK (fine_paid IN (0, 1)),
  paid_on     TEXT,
  renewals    INTEGER NOT NULL DEFAULT 0,
  CHECK (due_on >= issued_on)
);
CREATE INDEX IF NOT EXISTS ix_issues_member ON issues(member_id, returned_on);
CREATE INDEX IF NOT EXISTS ix_issues_book   ON issues(book_id, returned_on);

-- status: waiting   -> in the queue, no copy yet
--         ready     -> a copy is held for this member until hold_until (inclusive)
--         fulfilled -> the held copy was issued to the member
--         cancelled -> cancelled by librarian (or member deactivated)
--         expired   -> member did not collect within the hold period
CREATE TABLE IF NOT EXISTS reservations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  reserved_on TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')),
  ready_on    TEXT,
  hold_until  TEXT,
  closed_on   TEXT
);
CREATE INDEX IF NOT EXISTS ix_res_book ON reservations(book_id, status);
-- A member can have at most one open reservation per book.
CREATE UNIQUE INDEX IF NOT EXISTS ux_res_open ON reservations(book_id, member_id)
  WHERE status IN ('waiting', 'ready');

-- Acquisition: buying new titles or extra copies.
-- status: requested -> ordered -> received   (or cancelled before it is received)
-- Receiving adds the copies to the catalogue (new book, or extra copies of an existing ISBN).
CREATE TABLE IF NOT EXISTS acquisitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  author       TEXT    NOT NULL,
  isbn         TEXT    NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'General',
  vendor       TEXT    NOT NULL DEFAULT '',
  quantity     INTEGER NOT NULL CHECK (quantity >= 1),
  unit_cost    INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),   -- rupees per copy
  status       TEXT    NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ordered', 'received', 'cancelled')),
  requested_on TEXT    NOT NULL,
  ordered_on   TEXT,
  received_on  TEXT,
  notes        TEXT    NOT NULL DEFAULT '',
  book_id      INTEGER REFERENCES books(id)                        -- set when received
);

-- Digital resources: e-books, journals, audiobooks, videos, websites, databases.
CREATE TABLE IF NOT EXISTS digital_resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  author      TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL DEFAULT 'E-book' CHECK (type IN ('E-book', 'Journal', 'Audiobook', 'Video', 'Website', 'Database')),
  url         TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'General',
  access      TEXT    NOT NULL DEFAULT 'Open' CHECK (access IN ('Open', 'Members only')),
  description TEXT    NOT NULL DEFAULT '',
  added_on    TEXT    NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);
`;

// Columns added after the first version: [table, column, definition]
const MIGRATIONS = [
  ['issues', 'renewals', 'INTEGER NOT NULL DEFAULT 0'],
  ['books', 'publisher', "TEXT NOT NULL DEFAULT ''"],
  ['books', 'year', 'INTEGER'],
  ['books', 'shelf', "TEXT NOT NULL DEFAULT ''"],                   // rack / shelf location, e.g. A-3
  ['members', 'membership_type', "TEXT NOT NULL DEFAULT 'General'"], // Student / Faculty / General / Senior
  ['members', 'valid_until', 'TEXT'],                                 // membership expiry (null = no expiry)
];

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Migrations for databases created by earlier versions.
  for (const [table, column, def] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
  return db;
}
