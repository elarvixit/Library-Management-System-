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
