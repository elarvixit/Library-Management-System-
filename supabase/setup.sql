-- =====================================================================
-- Library Management System — ONE-SHOT SUPABASE SETUP
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It creates the tables, the business-rule functions and views, and loads demo data.
-- WARNING: it DROPS and recreates the library tables (books, members, issues, reservations).
-- =====================================================================

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


-- =====================================================================
-- Library Management System — business rules as PostgreSQL functions + views
-- Run AFTER schema.sql (before or after seed.sql). Safe to re-run.
--
-- Every write goes through a function, so the rules hold no matter who calls them
-- (the app's server, the Supabase SQL editor, or supabase.rpc('issue_book', …)):
--   • max 3 books per member, no two copies of the same title
--   • unpaid fines block new issues and renewals
--   • ₹5 per day late, recorded on return
--   • a book with a reservation queue can only be issued to the first person in it
--   • a returned copy is held 2 days for the first person in the queue, then passes on
--   • a book that is on loan (or reserved) cannot be deleted
-- Errors are raised with readable messages (SQLSTATE P0001).
-- =====================================================================

-- ---------------------------------------------------------------- helpers
-- Offer shelf copies to the waiting queue (first come, first served).
create or replace function _drain_queue(p_book bigint) returns void
language plpgsql as $$
declare
  r record;
  avail integer;
begin
  select available_copies into avail from books where id = p_book for update;
  for r in select id from reservations where book_id = p_book and status = 'waiting' order by id loop
    exit when avail <= 0;
    update reservations set status = 'ready', ready_on = current_date, hold_until = current_date + 2 where id = r.id;
    avail := avail - 1;
  end loop;
  update books set available_copies = avail where id = p_book;
end $$;

-- A copy came back (return / expired hold / cancelled hold): shelf it, then offer it to the queue.
create or replace function _copy_back(p_book bigint) returns void
language plpgsql as $$
begin
  update books set available_copies = available_copies + 1 where id = p_book;
  perform _drain_queue(p_book);
end $$;

-- Holds last through hold_until (inclusive); from the next day the copy passes to the next person.
create or replace function expire_holds() returns integer
language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id, book_id from reservations where status = 'ready' and hold_until < current_date order by id for update loop
    update reservations set status = 'expired', closed_on = current_date where id = r.id;
    perform _copy_back(r.book_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- issue a book
drop function if exists issue_book(bigint, bigint, date);
create or replace function issue_book(p_member bigint, p_book bigint, p_due date default null, p_issued date default current_date)
returns issues language plpgsql as $$
declare
  m members;
  b books;
  owed integer;
  holding integer;
  own_hold bigint;
  first_waiting record;
  my_pos integer;
  waiting_count integer;
  result issues;
begin
  perform expire_holds();

  select * into m from members where id = p_member for update;
  if not found then raise exception 'Member not found.'; end if;
  select * into b from books where id = p_book and not deleted for update;
  if not found then raise exception 'Book not found.'; end if;

  if not m.active then raise exception '% is inactive and cannot borrow books.', m.name; end if;

  select coalesce(sum(fine), 0) into owed from issues where member_id = m.id and fine > 0 and not fine_paid;
  if owed > 0 then
    raise exception '% has unpaid fines of ₹%. The fine must be paid before a new book can be issued.', m.name, owed;
  end if;

  select count(*) into holding from issues where member_id = m.id and returned_on is null;
  if holding >= 3 then
    raise exception '% already holds % books — the limit is 3. A book must be returned first.', m.name, holding;
  end if;

  if exists (select 1 from issues where member_id = m.id and book_id = b.id and returned_on is null) then
    raise exception '% already has a copy of "%".', m.name, b.title;
  end if;

  p_issued := coalesce(p_issued, current_date);
  if p_issued > current_date then raise exception 'Issue date cannot be in the future.'; end if;
  if p_due is not null and p_due < p_issued then
    raise exception 'Due date cannot be before the issue date.';
  end if;

  select id into own_hold from reservations where book_id = b.id and member_id = m.id and status = 'ready';
  if own_hold is not null then
    -- the held copy is not counted in available_copies, so availability does not change
    update reservations set status = 'fulfilled', closed_on = current_date where id = own_hold;
  else
    select count(*) into waiting_count from reservations where book_id = b.id and status = 'waiting';
    if waiting_count > 0 then
      select r.member_id, mm.name, mm.member_code into first_waiting
        from reservations r join members mm on mm.id = r.member_id
       where r.book_id = b.id and r.status = 'waiting' order by r.id limit 1;
      if first_waiting.member_id = m.id then
        raise exception '% is first in the queue for "%", but no copy has been returned yet.', m.name, b.title;
      end if;
      select pos into my_pos from (
        select member_id, row_number() over (order by id) as pos from reservations where book_id = b.id and status = 'waiting'
      ) q where q.member_id = m.id;
      raise exception '"%" has a reservation queue (% waiting). It can only be issued to the first in the queue: % (%).%',
        b.title, waiting_count, first_waiting.name, first_waiting.member_code,
        case when my_pos is not null then format(' %s is number %s in the queue.', m.name, my_pos) else '' end;
    end if;
    if b.available_copies <= 0 then
      raise exception 'No copies of "%" are available. % can place a reservation.', b.title, m.name;
    end if;
    update books set available_copies = available_copies - 1 where id = b.id;
  end if;

  insert into issues (book_id, member_id, issued_on, due_on)
  values (b.id, m.id, p_issued, coalesce(p_due, p_issued + 14))
  returning * into result;
  return result;
end $$;

-- ---------------------------------------------------------------- return a book
create or replace function return_book(p_issue bigint, p_returned date default current_date)
returns issues language plpgsql as $$
declare
  i issues;
  days_late integer;
  result issues;
begin
  perform expire_holds();
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue record not found.'; end if;
  if i.returned_on is not null then raise exception 'This book was already returned on %.', i.returned_on; end if;
  if p_returned > current_date then raise exception 'Return date cannot be in the future.'; end if;
  if p_returned < i.issued_on then raise exception 'Return date cannot be before the issue date (%).', i.issued_on; end if;

  days_late := greatest(0, p_returned - i.due_on);   -- returning on the due date is not late
  update issues set returned_on = p_returned, fine = days_late * 5 where id = i.id returning * into result;
  perform _copy_back(i.book_id);                     -- goes to the first person in the queue, if any
  return result;
end $$;

-- ---------------------------------------------------------------- renew a loan
create or replace function renew_issue(p_issue bigint) returns issues
language plpgsql as $$
declare
  i issues;
  owed integer;
  result issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue record not found.'; end if;
  if i.returned_on is not null then raise exception 'This book has already been returned.'; end if;
  if i.due_on < current_date then raise exception 'This loan is overdue and cannot be renewed. It must be returned and the fine paid.'; end if;
  select coalesce(sum(fine), 0) into owed from issues where member_id = i.member_id and fine > 0 and not fine_paid;
  if owed > 0 then raise exception 'The member has unpaid fines of ₹%. Loans cannot be renewed until the fine is paid.', owed; end if;
  if exists (select 1 from reservations where book_id = i.book_id and status = 'waiting') then
    raise exception 'This book cannot be renewed: other members are waiting for it.';
  end if;
  if i.renewals >= 2 then raise exception 'This loan has already been renewed 2 times (the maximum).'; end if;
  if current_date + 14 <= i.due_on then raise exception 'This loan is already due later than a renewal would give.'; end if;
  update issues set due_on = current_date + 14, renewals = renewals + 1 where id = i.id returning * into result;
  return result;
end $$;

-- ---------------------------------------------------------------- reservations
create or replace function reserve_book(p_member bigint, p_book bigint) returns reservations
language plpgsql as $$
declare
  m members;
  b books;
  result reservations;
begin
  perform expire_holds();
  select * into m from members where id = p_member;
  if not found then raise exception 'Member not found.'; end if;
  select * into b from books where id = p_book and not deleted for update;
  if not found then raise exception 'Book not found.'; end if;
  if not m.active then raise exception '% is inactive and cannot reserve books.', m.name; end if;
  if exists (select 1 from reservations where book_id = b.id and member_id = m.id and status in ('waiting', 'ready')) then
    raise exception '% already has a reservation for "%".', m.name, b.title;
  end if;
  if exists (select 1 from issues where member_id = m.id and book_id = b.id and returned_on is null) then
    raise exception '% currently has "%" on loan.', m.name, b.title;
  end if;
  if b.available_copies > 0 then
    raise exception '"%" has % available — issue it directly instead of reserving.', b.title, b.available_copies;
  end if;
  insert into reservations (book_id, member_id) values (b.id, m.id) returning * into result;
  return result;
end $$;

create or replace function cancel_reservation(p_reservation bigint) returns reservations
language plpgsql as $$
declare
  r reservations;
  result reservations;
begin
  select * into r from reservations where id = p_reservation for update;
  if not found then raise exception 'Reservation not found.'; end if;
  if r.status not in ('waiting', 'ready') then raise exception 'This reservation is already %.', r.status; end if;
  update reservations set status = 'cancelled', closed_on = current_date where id = r.id returning * into result;
  if r.status = 'ready' then perform _copy_back(r.book_id); end if;   -- held copy passes to the next person
  return result;
end $$;

-- ---------------------------------------------------------------- fines
create or replace function pay_fines(p_member bigint) returns integer
language plpgsql as $$
declare
  amount integer;
begin
  select coalesce(sum(fine), 0) into amount from issues where member_id = p_member and fine > 0 and not fine_paid;
  if amount = 0 then raise exception 'This member has no unpaid fines.'; end if;
  update issues set fine_paid = true, paid_on = current_date where member_id = p_member and fine > 0 and not fine_paid;
  return amount;
end $$;

-- ---------------------------------------------------------------- delete a book (soft)
create or replace function delete_book(p_book bigint) returns books
language plpgsql as $$
declare
  b books;
  holders text;
  result books;
begin
  select * into b from books where id = p_book and not deleted for update;
  if not found then raise exception 'Book not found.'; end if;
  select string_agg(m.name || ' (' || m.member_code || ')', ', ') into holders
    from issues i join members m on m.id = i.member_id where i.book_id = b.id and i.returned_on is null;
  if holders is not null then
    raise exception 'Cannot delete "%": it is currently issued to %. The book must be returned first.', b.title, holders;
  end if;
  if exists (select 1 from reservations where book_id = b.id and status in ('waiting', 'ready')) then
    raise exception 'Cannot delete "%": it has open reservations. Cancel them first.', b.title;
  end if;
  update books set deleted = true where id = b.id returning * into result;
  return result;
end $$;

-- ---------------------------------------------------------------- views for the dashboard
create or replace view v_books as
select b.*,
       (select count(*) from issues i where i.book_id = b.id and i.returned_on is null)             as issued_copies,
       (select count(*) from reservations r where r.book_id = b.id and r.status = 'ready')          as held_copies,
       (select count(*) from reservations r where r.book_id = b.id and r.status = 'waiting')        as queue_length
  from books b where not b.deleted;

create or replace view v_members as
select m.*,
       (select count(*) from issues i where i.member_id = m.id and i.returned_on is null)                      as active_issues,
       (select coalesce(sum(fine), 0) from issues i where i.member_id = m.id and i.fine > 0 and not i.fine_paid) as unpaid_fines
  from members m;

create or replace view v_overdue as
select i.id as issue_id, b.title, b.isbn, m.member_code, m.name as member_name, m.phone,
       i.issued_on, i.due_on, (current_date - i.due_on) as days_overdue, (current_date - i.due_on) * 5 as fine_so_far
  from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
 where i.returned_on is null and i.due_on < current_date
 order by i.due_on;

create or replace view v_issued_today as
select i.id as issue_id, b.title, m.member_code, m.name as member_name, i.due_on, i.returned_on
  from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
 where i.issued_on = current_date;

create or replace view v_ready_for_pickup as
select r.id as reservation_id, b.title, m.member_code, m.name as member_name, m.phone, r.ready_on, r.hold_until,
       (r.hold_until - current_date) as days_left
  from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id
 where r.status = 'ready' order by r.hold_until;

create or replace view v_pending_reservations as
select r.id as reservation_id, b.title, m.member_code, m.name as member_name, r.reserved_on,
       row_number() over (partition by r.book_id order by r.id) as queue_position
  from reservations r join books b on b.id = r.book_id join members m on m.id = r.member_id
 where r.status = 'waiting' order by b.title, queue_position;

create or replace view v_dashboard as
select (select count(*) from issues where issued_on = current_date)                                   as issued_today,
       (select count(*) from issues where returned_on is null)                                        as on_loan,
       (select count(*) from issues where returned_on is null and due_on < current_date)             as overdue,
       (select coalesce(sum((current_date - due_on) * 5), 0) from issues where returned_on is null and due_on < current_date) as overdue_fines_accruing,
       (select count(*) from reservations where status = 'ready')                                     as ready_for_pickup,
       (select count(*) from reservations where status = 'waiting')                                   as pending_reservations,
       (select coalesce(sum(fine), 0) from issues where fine > 0 and not fine_paid)                   as unpaid_fines,
       (select count(*) from books where not deleted)                                                 as titles,
       (select coalesce(sum(total_copies), 0) from books where not deleted)                           as copies,
       (select count(*) from members where active)                                                    as active_members;

-- Views run with the caller's permissions, so RLS on the tables still protects them.
alter view v_books set (security_invoker = true);
alter view v_members set (security_invoker = true);
alter view v_overdue set (security_invoker = true);
alter view v_issued_today set (security_invoker = true);
alter view v_ready_for_pickup set (security_invoker = true);
alter view v_pending_reservations set (security_invoker = true);
alter view v_dashboard set (security_invoker = true);

-- Only the server (service_role) may call the write functions — not the public anon key.
revoke execute on function issue_book(bigint, bigint, date, date), return_book(bigint, date), renew_issue(bigint),
  reserve_book(bigint, bigint), cancel_reservation(bigint), pay_fines(bigint), delete_book(bigint),
  expire_holds(), _drain_queue(bigint), _copy_back(bigint) from public, anon, authenticated;


-- =====================================================================
-- Library Management System — demo data for Supabase
-- Run AFTER schema.sql. Dates are relative to today (current_date), so the demo
-- always has overdue loans, an unpaid fine, a reservation queue and a copy ready for pickup.
-- =====================================================================

begin;

-- 33 books (available_copies is recalculated at the end)
insert into books (title, author, isbn, category, total_copies, available_copies) values
  ('The Hobbit', 'J.R.R. Tolkien', '9780261102217', 'Fantasy', 3, 3),
  ('Dune', 'Frank Herbert', '9780441013593', 'Science Fiction', 2, 2),
  ('Clean Code', 'Robert C. Martin', '9780132350884', 'Technology', 2, 2),
  ('The Pragmatic Programmer', 'Andrew Hunt, David Thomas', '9780135957059', 'Technology', 1, 1),
  ('Wings of Fire', 'A.P.J. Abdul Kalam', '9788173711466', 'Biography', 2, 2),
  ('The God of Small Things', 'Arundhati Roy', '9780006550686', 'Fiction', 1, 1),
  ('Sapiens', 'Yuval Noah Harari', '9780099590088', 'History', 2, 2),
  ('Atomic Habits', 'James Clear', '9781847941831', 'Self-help', 1, 1),
  ('Harry Potter and the Philosopher''s Stone', 'J.K. Rowling', '9780747532699', 'Children', 4, 4),
  ('The Jungle Book', 'Rudyard Kipling', '9780141325293', 'Children', 2, 2),
  ('Panchatantra Stories', 'Vishnu Sharma', '9788171676996', 'Children', 3, 3),
  ('Charlotte''s Web', 'E.B. White', '9780064400558', 'Children', 2, 2),
  ('The Little Prince', 'Antoine de Saint-Exupery', '9780156012195', 'Children', 2, 2),
  ('Wonder', 'R.J. Palacio', '9780375869020', 'Children', 2, 2),
  ('Malgudi Days', 'R.K. Narayan', '9780143039655', 'Fiction', 2, 2),
  ('The Alchemist', 'Paulo Coelho', '9780062315007', 'Fiction', 3, 3),
  ('To Kill a Mockingbird', 'Harper Lee', '9780061120084', 'Classics', 2, 2),
  ('Pride and Prejudice', 'Jane Austen', '9780141439518', 'Classics', 2, 2),
  ('Animal Farm', 'George Orwell', '9780451526342', 'Classics', 2, 2),
  ('The Diary of a Young Girl', 'Anne Frank', '9780553296983', 'Biography', 2, 2),
  ('The Story of My Experiments with Truth', 'Mahatma Gandhi', '9780807059098', 'Biography', 2, 2),
  ('Rich Dad Poor Dad', 'Robert Kiyosaki', '9781612680194', 'Business', 3, 3),
  ('Think and Grow Rich', 'Napoleon Hill', '9781585424337', 'Business', 2, 2),
  ('The Monk Who Sold His Ferrari', 'Robin Sharma', '9788179921623', 'Self-help', 2, 2),
  ('Ikigai', 'Hector Garcia', '9780143130727', 'Self-help', 2, 2),
  ('The Power of Your Subconscious Mind', 'Joseph Murphy', '9780735204317', 'Self-help', 1, 1),
  ('A Brief History of Time', 'Stephen Hawking', '9780553380163', 'Science', 2, 2),
  ('Cosmos', 'Carl Sagan', '9780345539434', 'Science', 1, 1),
  ('Gitanjali', 'Rabindranath Tagore', '9788171676415', 'Poetry', 2, 2),
  ('The Discovery of India', 'Jawaharlal Nehru', '9780143031031', 'History', 1, 1),
  ('Let Us C', 'Yashavant Kanetkar', '9789388511391', 'Technology', 3, 3),
  ('Introduction to Algorithms', 'Thomas H. Cormen', '9780262033848', 'Technology', 1, 1),
  ('Computer Networks', 'Andrew S. Tanenbaum', '9780132126953', 'Technology', 1, 1);

-- 60 members (M0001 … M0060)
insert into members (member_code, name, phone, email, join_date, active) values
  ('M0001', 'Asha Rao', '9876500001', 'asha@example.com', current_date - 60, true),
  ('M0002', 'Ravi Kumar', '9876500002', 'ravi@example.com', current_date - 60, true),
  ('M0003', 'Meera Iyer', '9876500003', 'meera@example.com', current_date - 60, true),
  ('M0004', 'Arjun Singh', '9876500004', 'arjun@example.com', current_date - 60, true),
  ('M0005', 'Fatima Sheikh', '9876500005', 'fatima@example.com', current_date - 60, true),
  ('M0006', 'Old Member', '9876500006', '', current_date - 400, false),
  ('M0007', 'Priya Sharma', '9845012345', 'priya.sharma@example.com', current_date - 320, true),
  ('M0008', 'Rahul Verma', '9812345670', 'rahul.verma@example.com', current_date - 290, true),
  ('M0009', 'Ananya Gupta', '9900112233', 'ananya.gupta@example.com', current_date - 260, true),
  ('M0010', 'Vikram Reddy', '9876012398', 'vikram.reddy@example.com', current_date - 240, true),
  ('M0011', 'Sneha Patel', '9822334455', 'sneha.patel@example.com', current_date - 210, true),
  ('M0012', 'Karthik Nair', '9447012345', 'karthik.nair@example.com', current_date - 200, true),
  ('M0013', 'Divya Menon', '9495567788', 'divya.menon@example.com', current_date - 185, true),
  ('M0014', 'Rohan Das', '9831098765', 'rohan.das@example.com', current_date - 170, true),
  ('M0015', 'Pooja Joshi', '9767123456', 'pooja.joshi@example.com', current_date - 150, true),
  ('M0016', 'Aditya Kulkarni', '9890456123', 'aditya.kulkarni@example.com', current_date - 140, true),
  ('M0017', 'Kavya Pillai', '9746123789', 'kavya.pillai@example.com', current_date - 120, true),
  ('M0018', 'Neha Kapoor', '9811987654', 'neha.kapoor@example.com', current_date - 110, true),
  ('M0019', 'Lakshmi Srinivasan', '9840765432', 'lakshmi.srinivasan@example.com', current_date - 95, true),
  ('M0020', 'Manish Agarwal', '9829012345', 'manish.agarwal@example.com', current_date - 80, true),
  ('M0021', 'Swati Mishra', '9935123456', 'swati.mishra@example.com', current_date - 70, true),
  ('M0022', 'Imran Khan', '9869012345', 'imran.khan@example.com', current_date - 60, true),
  ('M0023', 'Harpreet Kaur', '9815234567', 'harpreet.kaur@example.com', current_date - 50, true),
  ('M0024', 'John Mathew', '9447890123', 'john.mathew@example.com', current_date - 45, true),
  ('M0025', 'Sara DSouza', '9820456789', 'sara.dsouza@example.com', current_date - 35, true),
  ('M0026', 'Nikhil Bhat', '9480123456', 'nikhil.bhat@example.com', current_date - 28, true),
  ('M0027', 'Tanvi Deshmukh', '9657890123', 'tanvi.deshmukh@example.com', current_date - 20, true),
  ('M0028', 'Farhan Ali', '9700123456', 'farhan.ali@example.com', current_date - 14, true),
  ('M0029', 'Gaurav Singh', '9711234567', 'gaurav.singh@example.com', current_date - 7, true),
  ('M0030', 'Meenakshi Sundaram', '9444987654', 'meenakshi.sundaram@example.com', current_date - 400, false),
  ('M0031', 'Aarav Mehta', '9820011122', 'aarav.mehta@example.com', current_date - 365, true),
  ('M0032', 'Ishita Banerjee', '9830022233', 'ishita.banerjee@example.com', current_date - 350, true),
  ('M0033', 'Yash Chauhan', '9725033344', 'yash.chauhan@example.com', current_date - 335, true),
  ('M0034', 'Riya Saxena', '9839044455', 'riya.saxena@example.com', current_date - 310, true),
  ('M0035', 'Kunal Malhotra', '9810055566', 'kunal.malhotra@example.com', current_date - 300, true),
  ('M0036', 'Aishwarya Hegde', '9845066677', 'aishwarya.hegde@example.com', current_date - 280, true),
  ('M0037', 'Varun Bhatia', '9811077788', 'varun.bhatia@example.com', current_date - 270, true),
  ('M0038', 'Nandini Iyengar', '9845088899', 'nandini.iyengar@example.com', current_date - 250, true),
  ('M0039', 'Omkar Patil', '9822099900', 'omkar.patil@example.com', current_date - 230, true),
  ('M0040', 'Shreya Ghosh', '9831100011', 'shreya.ghosh@example.com', current_date - 220, true),
  ('M0041', 'Abhishek Tiwari', '9936111122', 'abhishek.tiwari@example.com', current_date - 205, true),
  ('M0042', 'Pallavi Jain', '9829122233', 'pallavi.jain@example.com', current_date - 190, true),
  ('M0043', 'Suresh Babu', '9848133344', 'suresh.babu@example.com', current_date - 180, true),
  ('M0044', 'Revathi Krishnan', '9840144455', 'revathi.krishnan@example.com', current_date - 165, true),
  ('M0045', 'Mohammed Irfan', '9866155566', 'mohammed.irfan@example.com', current_date - 155, true),
  ('M0046', 'Zoya Siddiqui', '9837166677', 'zoya.siddiqui@example.com', current_date - 145, true),
  ('M0047', 'Deepak Yadav', '9935177788', 'deepak.yadav@example.com', current_date - 130, true),
  ('M0048', 'Bhavana Rao', '9880188899', 'bhavana.rao@example.com', current_date - 125, true),
  ('M0049', 'Sanjay Pandey', '9839199900', 'sanjay.pandey@example.com', current_date - 115, true),
  ('M0050', 'Anjali Chopra', '9811200011', 'anjali.chopra@example.com', current_date - 100, true),
  ('M0051', 'Tarun Sethi', '9814211122', 'tarun.sethi@example.com', current_date - 90, true),
  ('M0052', 'Madhuri Shetty', '9845222233', 'madhuri.shetty@example.com', current_date - 85, true),
  ('M0053', 'Rajesh Naidu', '9849233344', 'rajesh.naidu@example.com', current_date - 75, true),
  ('M0054', 'Keerthana Murthy', '9886244455', 'keerthana.murthy@example.com', current_date - 65, true),
  ('M0055', 'Hemant Rathore', '9828255566', 'hemant.rathore@example.com', current_date - 55, true),
  ('M0056', 'Sunita Bose', '9830266677', 'sunita.bose@example.com', current_date - 40, true),
  ('M0057', 'Ajay Thakur', '9816277788', 'ajay.thakur@example.com', current_date - 30, true),
  ('M0058', 'Preeti Arora', '9815288899', 'preeti.arora@example.com', current_date - 21, true),
  ('M0059', 'Vivek Chandra', '9839299900', 'vivek.chandra@example.com', current_date - 10, true),
  ('M0060', 'Nisha Fernandes', '9820300011', 'nisha.fernandes@example.com', current_date - 3, true);

-- Loans. Helper: look books up by ISBN and members by member_code.
insert into issues (book_id, member_id, issued_on, due_on, returned_on, fine, fine_paid)
select b.id, m.id, x.issued_on, x.due_on, x.returned_on, x.fine, false
from (values
  -- Asha: Dune and The Hobbit, 30 days ago -> 16 days overdue
  ('9780441013593', 'M0001', current_date - 30, current_date - 16, null::date, 0),
  ('9780261102217', 'M0001', current_date - 30, current_date - 16, null::date, 0),
  -- Ravi: Clean Code returned 4 days late -> ₹20 unpaid fine
  ('9780132350884', 'M0002', current_date - 30, current_date - 16, current_date - 12, 20),
  -- Meera: the only copy of The Pragmatic Programmer (Arjun and Fatima are queued for it)
  ('9780135957059', 'M0003', current_date - 10, current_date + 4, null::date, 0),
  -- Fatima: Atomic Habits, returned yesterday -> held for Meera
  ('9781847941831', 'M0005', current_date - 10, current_date + 4, current_date - 1, 0),
  -- Issued today
  ('9780099590088', 'M0004', current_date, current_date + 14, null::date, 0),
  ('9780132350884', 'M0007', current_date, current_date + 14, null::date, 0),
  ('9788173711466', 'M0008', current_date, current_date + 14, null::date, 0),
  ('9780006550686', 'M0009', current_date, current_date + 14, null::date, 0)
) as x(isbn, code, issued_on, due_on, returned_on, fine)
join books b on b.isbn = x.isbn
join members m on m.member_code = x.code;

-- Reservations (queue order = insertion order)
insert into reservations (book_id, member_id, reserved_on, status, ready_on, hold_until)
select b.id, m.id, x.reserved_on, x.status, x.ready_on, x.hold_until
from (values
  (1, '9780135957059', 'M0004', current_date - 10, 'waiting', null::date, null::date),  -- Arjun, #1
  (2, '9780135957059', 'M0005', current_date - 10, 'waiting', null::date, null::date),  -- Fatima, #2
  (3, '9781847941831', 'M0003', current_date - 10, 'ready', current_date - 1, current_date + 1)  -- held for Meera
) as x(ord, isbn, code, reserved_on, status, ready_on, hold_until)
join books b on b.isbn = x.isbn
join members m on m.member_code = x.code
order by x.ord;  -- ids (= queue order) follow this order

-- available = total − copies on loan − copies held for pickup
update books b set available_copies = b.total_copies
  - (select count(*) from issues i where i.book_id = b.id and i.returned_on is null)
  - (select count(*) from reservations r where r.book_id = b.id and r.status = 'ready');

commit;
