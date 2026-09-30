-- =====================================================================
-- Library Management System — Supabase (PostgreSQL) schema
-- Run this first in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: it drops and recreates the four tables.
-- =====================================================================

drop table if exists reservations cascade;
drop table if exists issues cascade;
drop table if exists members cascade;
drop table if exists books cascade;

-- ---------------------------------------------------------------------
-- books
-- available_copies = copies on the shelf that anyone may borrow.
-- Copies that are issued, or held for a "ready for pickup" reservation, are NOT counted.
-- Invariant: total_copies = available_copies + issued copies + held copies
-- ---------------------------------------------------------------------
create table books (
  id               bigint generated always as identity primary key,
  title            text    not null check (length(trim(title)) > 0),
  author           text    not null check (length(trim(author)) > 0),
  isbn             text    not null check (isbn ~ '^([0-9]{9}[0-9X]|[0-9]{13})$'),  -- normalised: no hyphens/spaces
  category         text    not null default 'General',
  total_copies     integer not null check (total_copies >= 1),
  available_copies integer not null check (available_copies >= 0 and available_copies <= total_copies),
  deleted          boolean not null default false,   -- soft delete keeps loan & fine history
  created_at       timestamptz not null default now()
);
-- ISBN must be unique among books that are not deleted
create unique index ux_books_isbn on books (isbn) where not deleted;
create index ix_books_title on books (lower(title));
create index ix_books_author on books (lower(author));
create index ix_books_category on books (category);

-- ---------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------
create table members (
  id          bigint generated always as identity primary key,
  member_code text    not null unique,               -- human-facing "Member ID", e.g. M0001
  name        text    not null check (length(trim(name)) > 0),
  phone       text    not null default '',
  email       text    not null default '' check (email = '' or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  join_date   date    not null default current_date,
  active      boolean not null default true
);
create index ix_members_name on members (lower(name));

-- ---------------------------------------------------------------------
-- issues (loans)
-- fine is set when the book is returned: ₹5 × days late. fine_paid clears it.
-- ---------------------------------------------------------------------
create table issues (
  id          bigint generated always as identity primary key,
  book_id     bigint  not null references books (id),
  member_id   bigint  not null references members (id),
  issued_on   date    not null default current_date,
  due_on      date    not null default (current_date + 14),
  returned_on date,
  fine        integer not null default 0 check (fine >= 0),   -- rupees
  fine_paid   boolean not null default false,
  paid_on     date,
  renewals    integer not null default 0 check (renewals between 0 and 2),
  check (due_on >= issued_on),
  check (returned_on is null or returned_on >= issued_on)
);
create index ix_issues_member on issues (member_id) where returned_on is null;
create index ix_issues_book   on issues (book_id)   where returned_on is null;
create index ix_issues_due    on issues (due_on)    where returned_on is null;
-- A member cannot hold two copies of the same book at once
create unique index ux_issues_one_copy on issues (book_id, member_id) where returned_on is null;

-- ---------------------------------------------------------------------
-- reservations
-- status: waiting   -> in the queue, no copy yet
--         ready     -> a copy is held for this member until hold_until (inclusive, 2 days)
--         fulfilled -> the held copy was issued to the member
--         cancelled -> cancelled by librarian (or member deactivated)
--         expired   -> not collected within the hold period
-- Queue order = id (first come, first served).
-- ---------------------------------------------------------------------
create table reservations (
  id          bigint generated always as identity primary key,
  book_id     bigint not null references books (id),
  member_id   bigint not null references members (id),
  reserved_on date   not null default current_date,
  status      text   not null default 'waiting'
              check (status in ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')),
  ready_on    date,
  hold_until  date,
  closed_on   date,
  check (status <> 'ready' or hold_until is not null)
);
create index ix_res_book on reservations (book_id, status);
-- At most one open reservation per member per book
create unique index ux_res_open on reservations (book_id, member_id) where status in ('waiting', 'ready');

-- ---------------------------------------------------------------------
-- Security: turn on Row Level Security with NO public policies.
-- The anon/public API key can then read or write nothing; the app's server
-- connects with the service_role key (or the database connection string),
-- which bypasses RLS. Never put the service_role key in browser code.
-- ---------------------------------------------------------------------
alter table books        enable row level security;
alter table members      enable row level security;
alter table issues       enable row level security;
alter table reservations enable row level security;
