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

-- Staff (S001 Elarvix, Admin, is created by schema.sql)
insert into staff (staff_code, name, role, shift, email, phone, join_date, active) values
  ('S002', 'Kavitha Rao', 'Librarian', 'Morning', 'kavitha.rao@library.example', '9845100001', current_date - 900, true),
  ('S003', 'Rakesh Menon', 'Librarian', 'Evening', 'rakesh.menon@library.example', '9845100002', current_date - 640, true),
  ('S004', 'Anita Desai', 'Assistant', 'Morning', 'anita.desai@library.example', '9845100003', current_date - 300, true),
  ('S005', 'Sameer Khan', 'Assistant', 'Evening', 'sameer.khan@library.example', '9845100004', current_date - 120, true),
  ('S006', 'Lalitha Iyer', 'Assistant', 'Full day', 'lalitha.iyer@library.example', '9845100005', current_date - 1200, false);

-- Loans. Helper: look books up by ISBN and members by member_code.
insert into issues (book_id, member_id, issued_on, due_on, returned_on, fine, fine_paid, issued_by, returned_by)
select b.id, m.id, x.issued_on, x.due_on, x.returned_on, x.fine, false,
       (select id from staff where staff_code = x.issued_by), (select id from staff where staff_code = x.returned_by)
from (values
  -- Asha: Dune and The Hobbit, 30 days ago -> 16 days overdue
  ('9780441013593', 'M0001', current_date - 30, current_date - 16, null::date, 0, 'S002', null),
  ('9780261102217', 'M0001', current_date - 30, current_date - 16, null::date, 0, 'S002', null),
  -- Ravi: Clean Code returned 4 days late -> ₹20 unpaid fine
  ('9780132350884', 'M0002', current_date - 30, current_date - 16, current_date - 12, 20, 'S002', 'S003'),
  -- Meera: the only copy of The Pragmatic Programmer (Arjun and Fatima are queued for it)
  ('9780135957059', 'M0003', current_date - 10, current_date + 4, null::date, 0, 'S003', null),
  -- Fatima: Atomic Habits, returned yesterday -> held for Meera
  ('9781847941831', 'M0005', current_date - 10, current_date + 4, current_date - 1, 0, 'S003', 'S002'),
  -- Issued today
  ('9780099590088', 'M0004', current_date, current_date + 14, null::date, 0, 'S001', null),
  ('9780132350884', 'M0007', current_date, current_date + 14, null::date, 0, 'S002', null),
  ('9788173711466', 'M0008', current_date, current_date + 14, null::date, 0, 'S004', null),
  ('9780006550686', 'M0009', current_date, current_date + 14, null::date, 0, 'S001', null)
) as x(isbn, code, issued_on, due_on, returned_on, fine, issued_by, returned_by)
join books b on b.isbn = x.isbn
join members m on m.member_code = x.code;

-- Reservations (queue order = insertion order)
insert into reservations (book_id, member_id, reserved_on, status, ready_on, hold_until, created_by)
select b.id, m.id, x.reserved_on, x.status, x.ready_on, x.hold_until, (select id from staff where staff_code = 'S004')
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
