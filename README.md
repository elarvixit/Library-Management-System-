# Library Management System

A librarian's tool to manage **books, members, issues, returns, fines and reservations**.
Built with **Node.js + Express + SQLite** (REST API) and a dependency-free HTML/CSS/JS frontend.
There is one librarian role and no login.

## Quick start

Requires **Node.js 22.13 or later** (it uses the built-in `node:sqlite` module, so there are no native modules to compile).

```bash
npm install
npm run seed     # optional: demo data (overdue loans, fines, a queue, a copy ready for pickup)
npm run add-samples  # optional: add 54 sample members + 25 well-known books to a running library
npm start        # http://localhost:3000
npm test         # business-rule test suite
```

The database is stored in `data/library.db`. Set `DB_FILE` to use a different file and `PORT` to use a different port.

## Features

| Feature | Where |
|---|---|
| Books: add / edit / delete (title, author, ISBN, category, total copies, available copies) | **Books** tab |
| Members: add / edit (name, member ID, phone, email, join date, active/inactive) | **Members** tab |
| Issue a book (member + book, default due date 14 days, live rule check) | **Issue Book** page |
| Return a book with a late-fine preview; the fine is recorded against the member | **Return Book** page, **Dashboard** |
| Reservations queue, "Ready for pickup" list, 2-day hold | **Reservations**, **Dashboard** |
| Search by title / author / ISBN / category, with an "available only" filter | **Books** tab |
| Dashboard: issued today, overdue loans with fines, pending reservations, ready for pickup | **Dashboard** |
| ⭐ SQLite backend + REST API | `src/` |
| ⭐ Export the overdue list to CSV | Dashboard → *Export CSV* |
| ⭐ Bulk-import books from CSV (preview first, per-row error report, downloadable template) | Books → *Import CSV* (see `sample-data/books.csv`) |

### Extra features

- **Dashboard analytics:**
  - 14-day chart of books issued and returned (hover for daily figures)
  - Share of copies in use and the on-time return rate
  - Fines collected this month
  - Most popular categories and most borrowed books
  - A *Needs attention* panel (overdue, due soon, ready for pickup) and a live activity feed
- **Renew loans:** extends the due date to today + 14 days, up to 2 times. It is refused when the loan is overdue, the member has unpaid fines, or someone is waiting in the reservation queue. The UI disables the button and shows the reason.
- **Fines ledger:** outstanding and collected totals, paid/unpaid filter, collect from the list, CSV export.
- **Activity page:** a timeline of every loan, return, reservation, hold expiry and payment, filterable by type.
- **Library Assistant (help chat):** click *Ask assistant* (bottom right) or press `A`. It answers questions from the live library data, for example:
  - *"Can Ravi borrow Dune?"*: runs the same checks as the Issue screen (fines, 3-book limit, reservation queue, availability) and explains the result
  - *"Who has The Hobbit?"*, *"What's overdue?"*, *"Who owes fines?"*
  - *"How are fines calculated?"*, *"How do I renew a loan?"*

  Full list of supported questions with real answers: [docs/ASSISTANT-QA.md](docs/ASSISTANT-QA.md) (44 question types).

  It is **read-only**. Answers include shortcut buttons (open member, collect fine, go to Issue), and every action still goes through the normal screens and confirmations. It runs entirely in the browser, with no external AI service and no API key. All logic is in `public/assistant.js`, and its `answer()` function could later be replaced by an LLM call.
- **Command palette (`Ctrl K`):** search books, members and actions from anywhere. Keyboard shortcuts: `/` search, `I` issue, `R` return, `B` books, `M` members, `D` dashboard, `?` help.
- **Notifications bell:** holds expiring today, overdue loans, copies ready for pickup, books due today, members with fines.
- **Detail panels:**
  - A book's current borrowers, reservation queue, next due-back date and full loan history
  - A member's loans, reservations, history, on-time rate and fines paid
- **Printables:** loan slip after issuing, return receipt, member library card.
- **Books:** table or grid view, sort options, category filter, pagination, search matches highlighted.
- **Members:** filters (active, inactive, with fines, borrowing), sort options, pagination, CSV export.
- **Reservations:** expected back date, pickup countdown, *copy pickup message* button to send to the member.
- **Design:** light/dark theme and a responsive phone layout.

## Business rules and how they are enforced

All rules are in one place: [`src/library.js`](src/library.js). Every operation runs in a SQLite transaction, so a rejected request never leaves the data half-changed. The UI shows the rules as hints, but the server is the only thing that enforces them.

### Copy accounting
`available_copies` counts copies on the shelf that **anyone** may borrow. At all times:

```
total_copies = available_copies + copies issued + copies held for pickup
```

The test suite checks this invariant after every test.

### Issuing (checks run in this order)
1. The member must exist and be **active**.
2. **Fines block new issues.** If the member has any unpaid fine, the issue is refused with the amount owed. The *Pay fine* button clears it.
3. The member may hold **at most 3 books** at once, and cannot borrow a second copy of a title they already have.
4. If a copy is **held for this member** ("Ready for pickup"), it is issued to them and the reservation is marked *fulfilled*.
5. **Queue rule.** If anyone is waiting in the reservation queue, the book cannot be issued to anyone who is not first in the queue. The error names the person who is first and the requester's own position in the queue.
6. Otherwise a shelf copy must be available, and `available_copies` drops by 1.
- The due date defaults to the issue date + 14 days and can be changed, but never to a date before the issue date. The issue date cannot be in the future.

### Returning and fines
- Fine = **₹5 × days late**, where days late = return date − due date. Returning on the due date is not late.
- The fine is recorded on the issue record and counts as **unpaid** against the member until *Pay fine* is clicked.
- The return date defaults to today. It can be backdated (for example, a book left in the drop box), but it cannot be before the issue date or in the future.
- The overdue list shows the fine **building up** on books not yet returned (days overdue × ₹5). That amount becomes an actual fine only when the book is returned.

### Reservations
- A member can reserve a book only when it has **no available copy**. They cannot reserve a book they currently have on loan, and they can hold only one open reservation per book.
- The queue is strictly **first-come, first-served** (by insertion order).
- When a copy comes back (return, an expired hold, a cancelled hold, or the total copy count being increased), it goes **first to the head of the queue**. That reservation becomes **Ready for pickup** and the copy is **held for 2 days** (today + 2, inclusive). A held copy is *not* counted as available, so nobody else can take it.
- If the member does not collect it in time, the reservation becomes **expired** and the copy passes to the next person in the queue, who gets a new 2-day hold. If nobody is waiting, it goes back on the shelf. Expiry is checked at the start of every request, so nothing needs to run in the background.
- A member with a held copy still has to pass the fine and 3-book checks when collecting it. They can pay the fine at the desk and then take the book.
- Cancelling a reservation, or **deactivating a member** (which cancels all their open reservations), releases any held copy to the next person in the queue.

### Deleting and editing books
- **Deleting a book that is currently issued is refused**, and the message says who has it: *Cannot delete "Dune": 1 copy is currently issued to Asha Rao (M0001). The book must be returned first.* Deleting a book with open reservations is also refused.
- Deletion is a *soft delete*. Past issue and fine records stay intact, and the ISBN becomes free to reuse.
- Lowering `total_copies` below the number of copies issued plus held is refused. Raising it serves the waiting queue first.

### Validation
- ISBNs are normalised by removing hyphens and spaces. They must have 10 characters (the last may be `X`) or 13 digits, and must be unique among existing books.
- Member IDs are generated automatically (`M0001`, `M0002`, …) or can be entered by hand, and must be unique. Email and phone formats are checked. The join date cannot be in the future.
- Search input is escaped, so `%` and `_` are matched literally.
- The CSV export defuses spreadsheet formula injection. The CSV import validates each row on its own and reports skipped rows with line numbers and reasons.

## REST API

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard` | Stats, issued today, overdue (with fines), ready for pickup, pending reservations |
| GET | `/api/books?q=&field=all\|title\|author\|isbn\|category&available=1` | Search books |
| GET / POST / PUT / DELETE | `/api/books`, `/api/books/:id` | Book CRUD |
| POST | `/api/books/import` | `{ "csv": "title,author,isbn,category,total_copies\n..." }` |
| GET | `/api/members?q=&active=1` | List members |
| GET | `/api/members/:id` | Member with loans, history and reservations |
| POST / PUT | `/api/members`, `/api/members/:id` | Add or edit a member |
| POST | `/api/members/:id/pay-fine` | Clear the member's unpaid fines |
| GET | `/api/issues?status=active\|overdue\|returned\|all` | List loans |
| POST | `/api/issues` | `{ memberId, bookId, issuedOn?, dueOn? }` |
| POST | `/api/issues/:id/return` | `{ returnedOn? }` → returns `fine`, `daysLate`, `readyFor` |
| POST | `/api/issues/:id/renew` | Extend a loan (see renewal rules) |
| GET | `/api/books/:id/history` | Every loan of one book |
| GET | `/api/fines?status=unpaid\|paid\|all` | Fines ledger with totals |
| GET | `/api/stats` | Dashboard analytics (14-day activity, categories, top books, due soon, recent activity) |
| GET | `/api/activity?limit=` | Activity timeline |
| GET | `/api/reports/books.csv`, `members.csv`, `fines.csv`, `books-template.csv` | CSV exports and the import template |
| GET | `/api/reservations?status=open\|waiting\|ready\|closed\|all` | List reservations with queue position |
| POST | `/api/reservations` | `{ memberId, bookId }` |
| POST | `/api/reservations/:id/cancel` | Cancel a reservation (a held copy moves to the next person) |
| GET | `/api/reports/overdue.csv` | Overdue list as CSV |

Errors come back as `{ "error": "human readable message" }`, with status 400 (bad input), 404 (not found) or 409 (a business rule was violated).

## Data model

- `books(id, title, author, isbn, category, total_copies, available_copies, deleted)`
- `members(id, member_code, name, phone, email, join_date, active)`
- `issues(id, book_id, member_id, issued_on, due_on, returned_on, fine, fine_paid, paid_on)`
- `reservations(id, book_id, member_id, reserved_on, status, ready_on, hold_until, closed_on)`. `status` is one of `waiting → ready → fulfilled`, or `cancelled` / `expired`.

## Project structure

```
src/library.js    business rules (the part being evaluated)
src/db.js         SQLite schema
src/server.js     Express REST API + static frontend
src/csv.js        CSV parse/export
public/           frontend (index.html, app.js, styles.css)
test/             node:test suite covering the queue, fine and edge-case rules
scripts/seed.js   demo data
sample-data/      example CSV for bulk import
```

## Interpretation notes

- **"Notified"** means the member appears on the dashboard's *Ready for pickup* list and a message is shown to the librarian. There is no email or SMS.
- **"First in the queue"** means the earliest reservation still *waiting* for a copy. People who already have a copy held for them have been served, so their held copies are never given to anyone else.
- **Books that are overdue but not yet returned** do not block new issues. Only *recorded* (returned) unpaid fines do, as the spec states. The overdue list shows the fine building up so the librarian can follow up.

## Supabase (PostgreSQL) scripts

The `supabase/` folder contains the same data model and business rules for Supabase:

| File | What it does |
|---|---|
| `schema.sql` | Tables, constraints and indexes, with Row Level Security switched on (no public access) |
| `functions.sql` | The rules as SQL functions (`issue_book`, `return_book`, `renew_issue`, `reserve_book`, `cancel_reservation`, `pay_fines`, `delete_book`, `expire_holds`) plus dashboard views (`v_dashboard`, `v_overdue`, `v_ready_for_pickup`, `v_pending_reservations`, …) |
| `seed.sql` | Demo data: 60 members, 33 books, loans, an unpaid fine, a queue and a held copy (dates relative to today) |
| `queries.sql` | Everyday queries (dashboard, search, fines, due soon, who has a book, health check) and write examples |

**Setup:** in the Supabase dashboard open **SQL Editor → New query**, paste **`supabase/setup.sql`** (schema + functions + demo data in one file) and click **Run**. Or run `schema.sql`, `functions.sql` and `seed.sql` separately, in that order. Only the server should call the write functions, using the `service_role` key or the database connection string. Never put that key in browser code.

All four scripts were tested against PostgreSQL (PGlite): the queue order, the 3-book limit, fines blocking issues, the ₹5/day fine, 2-day hold expiry passing the copy on, and delete refusal.

### Connecting the app to Supabase

When the `DATABASE_URL` environment variable is set, the server uses PostgreSQL (`src/pg-library.js`) instead of SQLite, and the data is stored permanently. The API and the UI are unchanged.

1. In Supabase, open **SQL Editor** and run `supabase/schema.sql`, `supabase/functions.sql` and `supabase/seed.sql` (the seed is optional).
2. In Supabase, click **Connect** and copy the **Transaction pooler** URI (port 6543). Replace `[YOUR-PASSWORD]` with your database password.
3. In Vercel, go to **Settings → Environment Variables** and add:
   - `DATABASE_URL` as a **Secret**, with the URI from step 2
   - optionally `LIBRARY_TIMEZONE` (default `Asia/Kolkata`)
4. Redeploy. Environment variable changes only apply to new deployments.

Locally, `DATABASE_URL="postgresql://…" npm start` does the same.
