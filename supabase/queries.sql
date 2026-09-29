-- =====================================================================
-- Library Management System — everyday queries for Supabase
-- Run after schema.sql, functions.sql (and seed.sql for demo data).
-- The SELECTs are read-only. The write examples at the bottom are commented out.
-- =====================================================================

-- ---------------------------------------------------------------- dashboard
select * from v_dashboard;             -- issued today, on loan, overdue, pickups, queue, unpaid fines
select * from v_issued_today;          -- books issued today
select * from v_overdue;               -- overdue list with fine so far (₹5 × days late)
select * from v_ready_for_pickup;      -- copies held for reservers, with days left to collect
select * from v_pending_reservations;  -- waiting queues with position

-- ---------------------------------------------------------------- search books
-- by title / author / ISBN / category (case-insensitive), available only
select id, title, author, isbn, category, total_copies, available_copies, issued_copies, held_copies, queue_length
  from v_books
 where (title ilike '%harry%' or author ilike '%harry%' or isbn like '%harry%' or category ilike '%harry%')
   and available_copies > 0            -- remove this line to include unavailable books
 order by title;

-- books in one category
select title, author, available_copies, total_copies from v_books where category = 'Children' order by title;

-- ---------------------------------------------------------------- members
select member_code, name, phone, email, join_date, active, active_issues, unpaid_fines
  from v_members order by name;

-- members who owe fines (they cannot borrow until they pay)
select member_code, name, phone, unpaid_fines from v_members where unpaid_fines > 0 order by unpaid_fines desc;

-- everything one member has on loan
select b.title, i.issued_on, i.due_on,
       greatest(0, current_date - i.due_on) as days_late,
       greatest(0, current_date - i.due_on) * 5 as fine_so_far
  from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
 where m.member_code = 'M0001' and i.returned_on is null;

-- ---------------------------------------------------------------- staff
-- all staff with what they did (totals and today)
select staff_code, name, role, shift, email, phone, active, issued_total, returned_total, fines_collected, issued_today, returned_today
  from v_staff order by case role when 'Admin' then 0 when 'Librarian' then 1 else 2 end, name;

-- admins
select staff_code, name, email, phone from staff where role = 'Admin' and active;

-- who issued / received each loan
select b.title, m.name as member, si.name as issued_by, sr.name as returned_by, sp.name as fine_collected_by
  from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
  left join staff si on si.id = i.issued_by left join staff sr on sr.id = i.returned_by left join staff sp on sp.id = i.paid_by
 order by i.id desc limit 20;

-- ---------------------------------------------------------------- loans
-- due in the next 3 days
select b.title, m.name, m.phone, i.due_on
  from issues i join books b on b.id = i.book_id join members m on m.id = i.member_id
 where i.returned_on is null and i.due_on between current_date and current_date + 3
 order by i.due_on;

-- who has a book and when it is due back
select m.name, m.member_code, i.due_on
  from issues i join members m on m.id = i.member_id join books b on b.id = i.book_id
 where b.title = 'The Hobbit' and i.returned_on is null;

-- fines ledger
select m.member_code, m.name, b.title, i.due_on, i.returned_on, i.fine,
       case when i.fine_paid then 'Paid' else 'Unpaid' end as status, i.paid_on
  from issues i join members m on m.id = i.member_id join books b on b.id = i.book_id
 where i.fine > 0 order by i.fine_paid, i.returned_on desc;

-- most borrowed books
select b.title, count(*) as loans from issues i join books b on b.id = i.book_id
 group by b.title order by loans desc, b.title limit 10;

-- ---------------------------------------------------------------- health check
-- should return 0 rows: total = available + on loan + held, and no free copy while people wait
select title, total_copies, available_copies, issued_copies, held_copies, queue_length
  from v_books
 where total_copies <> available_copies + issued_copies + held_copies
    or (queue_length > 0 and available_copies > 0);

-- =====================================================================
-- Write operations — ALWAYS use the functions (they enforce the library rules).
-- Uncomment one line at a time to try it on the demo data.
-- =====================================================================
-- Issue: member + book (default due date = today + 14 days)
-- select * from issue_book((select id from members where member_code = 'M0010'), (select id from books where title = 'The Alchemist'));
-- Issue with a custom due date
-- select * from issue_book((select id from members where member_code = 'M0010'), (select id from books where title = 'Cosmos'), current_date + 7);

-- Return (fine is calculated automatically; a queued member gets the copy held for 2 days)
-- select * from return_book((select i.id from issues i join members m on m.id = i.member_id where m.member_code = 'M0001' and i.returned_on is null limit 1));

-- Renew (max 2 times; refused when overdue, fines unpaid, or someone is waiting)
-- select * from renew_issue(<issue id>);

-- Reserve (only when no copy is on the shelf) / cancel
-- select * from reserve_book((select id from members where member_code = 'M0012'), (select id from books where title = 'The Pragmatic Programmer'));
-- select * from cancel_reservation(<reservation id>);

-- Pay all of a member's fines ("Pay fine" button)
-- select pay_fines((select id from members where member_code = 'M0002'));

-- Delete a book (refused while on loan or reserved; soft delete keeps history)
-- select * from delete_book((select id from books where title = 'Cosmos'));

-- Record the staff member on duty: pass their id as the last argument, e.g.
-- select * from issue_book((select id from members where member_code = 'M0010'), (select id from books where title = 'Wonder'), null, current_date, (select id from staff where staff_code = 'S002'));

-- Add staff
-- insert into staff (staff_code, name, role, shift, email, phone) values ('S007', 'New Staff', 'Assistant', 'Morning', 'new.staff@library.example', '9800000000');

-- Add a book / member (plain inserts are fine for these)
-- insert into books (title, author, isbn, category, total_copies, available_copies) values ('New Book', 'Some Author', '9780000000001', 'General', 2, 2);
-- insert into members (member_code, name, phone, email) values ('M0061', 'New Member', '9800000000', 'new.member@example.com');

-- Release holds that were not collected in 2 days (the functions also do this automatically).
-- Optional: schedule it daily with Supabase Cron (Integrations → Cron):  select expire_holds();
