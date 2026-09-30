// Library reports. Built on the service's list methods, so they work unchanged with both the
// SQLite (Library) and Supabase/PostgreSQL (PgLibrary) implementations.
import { LibraryError, addDays, daysBetween, parseDate } from './library.js';

export const REPORTS = {
  circulation: 'Circulation summary',
  overdue: 'Overdue loans',
  fines: 'Fines',
  popular: 'Most borrowed books',
  categories: 'Category usage',
  members: 'Member activity',
  inventory: 'Inventory / stock',
  acquisitions: 'Acquisitions & spending',
  digital: 'Digital resource usage',
};

const col = (key, label, num = false) => ({ key, label, num });
const inRange = (d, from, to) => d && d >= from && d <= to;
const monthOf = (d) => d.slice(0, 7);

/**
 * @param lib   Library or PgLibrary
 * @param name  one of REPORTS
 * @param opts  { from, to } (YYYY-MM-DD). Defaults to the last 30 days.
 */
export async function buildReport(lib, name, { from, to } = {}) {
  if (!REPORTS[name]) throw new LibraryError(`Unknown report. Choose one of: ${Object.keys(REPORTS).join(', ')}.`, 404);
  const today = lib.today();
  const end = to ? parseDate(to, 'To date') : today;
  const start = from ? parseDate(from, 'From date') : addDays(end, -29);
  if (start > end) throw new LibraryError('The "from" date must be before the "to" date.');
  const period = { from: start, to: end, days: daysBetween(start, end) + 1 };
  const base = { name, title: REPORTS[name], period, generated_on: today };

  const issues = ['circulation', 'fines', 'popular', 'categories', 'members'].includes(name) ? await lib.listIssues({ status: 'all' }) : [];

  switch (name) {
    case 'circulation': {
      const byMonth = period.days > 62;
      const buckets = new Map();
      const keyOf = (d) => (byMonth ? monthOf(d) : d);
      for (let d = start; d <= end; d = addDays(d, 1)) buckets.set(keyOf(d), { period: keyOf(d), issued: 0, returned: 0, late_returns: 0, fines_charged: 0 });
      for (const i of issues) {
        if (inRange(i.issued_on, start, end)) buckets.get(keyOf(i.issued_on)).issued++;
        if (inRange(i.returned_on, start, end)) {
          const b = buckets.get(keyOf(i.returned_on));
          b.returned++;
          if (i.fine > 0) { b.late_returns++; b.fines_charged += i.fine; }
        }
      }
      const rows = [...buckets.values()];
      const t = rows.reduce((a, r) => ({ issued: a.issued + r.issued, returned: a.returned + r.returned, late: a.late + r.late_returns, fines: a.fines + r.fines_charged }), { issued: 0, returned: 0, late: 0, fines: 0 });
      return {
        ...base,
        description: `Books issued and returned per ${byMonth ? 'month' : 'day'}.`,
        columns: [col('period', byMonth ? 'Month' : 'Date'), col('issued', 'Issued', true), col('returned', 'Returned', true), col('late_returns', 'Late returns', true), col('fines_charged', 'Fines charged (₹)', true)],
        rows,
        summary: [
          { label: 'Books issued', value: t.issued }, { label: 'Books returned', value: t.returned },
          { label: 'On-time returns', value: t.returned ? `${Math.round(((t.returned - t.late) / t.returned) * 100)}%` : '—' },
          { label: 'Fines charged', value: `₹${t.fines}` },
        ],
      };
    }
    case 'overdue': {
      const rows = (await lib.listIssues({ status: 'overdue' })).map((i) => ({
        member_code: i.member_code, member: i.member_name, phone: i.phone, title: i.title, isbn: i.isbn, issued_on: i.issued_on, due_on: i.due_on, days_overdue: i.days_overdue, fine: i.accrued_fine,
      }));
      return {
        ...base, period: { ...period, from: today, to: today }, description: 'Books not yet returned after their due date, as of today.',
        columns: [col('member_code', 'Member ID'), col('member', 'Member'), col('phone', 'Phone'), col('title', 'Book'), col('isbn', 'ISBN'), col('issued_on', 'Issued'), col('due_on', 'Due'), col('days_overdue', 'Days late', true), col('fine', 'Fine so far (₹)', true)],
        rows,
        summary: [{ label: 'Overdue loans', value: rows.length }, { label: 'Members affected', value: new Set(rows.map((r) => r.member_code)).size }, { label: 'Fines building up', value: `₹${rows.reduce((t, r) => t + r.fine, 0)}` }],
      };
    }
    case 'fines': {
      const rows = issues.filter((i) => i.fine > 0 && (inRange(i.returned_on, start, end) || inRange(i.paid_on, start, end))).map((i) => ({
        member_code: i.member_code, member: i.member_name, title: i.title, due_on: i.due_on, returned_on: i.returned_on,
        days_late: Math.max(0, daysBetween(i.due_on, i.returned_on)), fine: i.fine, status: i.fine_paid ? 'Paid' : 'Unpaid', paid_on: i.paid_on || '',
      }));
      const charged = issues.filter((i) => i.fine > 0 && inRange(i.returned_on, start, end)).reduce((t, i) => t + i.fine, 0);
      const collected = issues.filter((i) => i.fine_paid && inRange(i.paid_on, start, end)).reduce((t, i) => t + i.fine, 0);
      const outstanding = issues.filter((i) => i.fine > 0 && !i.fine_paid).reduce((t, i) => t + i.fine, 0);
      return {
        ...base, description: 'Late fines charged or collected in the period (₹5 per day late).',
        columns: [col('member_code', 'Member ID'), col('member', 'Member'), col('title', 'Book'), col('due_on', 'Due'), col('returned_on', 'Returned'), col('days_late', 'Days late', true), col('fine', 'Fine (₹)', true), col('status', 'Status'), col('paid_on', 'Paid on')],
        rows,
        summary: [{ label: 'Fines charged', value: `₹${charged}` }, { label: 'Fines collected', value: `₹${collected}` }, { label: 'Outstanding (all time)', value: `₹${outstanding}` }],
      };
    }
    case 'popular': {
      const m = new Map();
      for (const i of issues) {
        if (!inRange(i.issued_on, start, end)) continue;
        const r = m.get(i.book_id) || { title: i.title, author: i.author, isbn: i.isbn, loans: 0, borrowers: new Set() };
        r.loans++; r.borrowers.add(i.member_id); m.set(i.book_id, r);
      }
      const rows = [...m.values()].sort((a, b) => b.loans - a.loans || a.title.localeCompare(b.title))
        .map((r, idx) => ({ rank: idx + 1, title: r.title, author: r.author, isbn: r.isbn, loans: r.loans, borrowers: r.borrowers.size }));
      return {
        ...base, description: 'Books ranked by how often they were issued in the period.',
        columns: [col('rank', '#', true), col('title', 'Book'), col('author', 'Author'), col('isbn', 'ISBN'), col('loans', 'Loans', true), col('borrowers', 'Different members', true)],
        rows,
        summary: [{ label: 'Titles borrowed', value: rows.length }, { label: 'Total loans', value: rows.reduce((t, r) => t + r.loans, 0) }, { label: 'Top title', value: rows[0]?.title ?? '—' }],
      };
    }
    case 'categories': {
      const books = await lib.searchBooks({});
      const byId = new Map(books.map((b) => [b.id, b]));
      const m = new Map();
      for (const b of books) {
        const r = m.get(b.category) || { category: b.category, titles: 0, copies: 0, on_loan: 0, loans: 0 };
        r.titles++; r.copies += b.total_copies; r.on_loan += b.issued_copies; m.set(b.category, r);
      }
      for (const i of issues) {
        const b = byId.get(i.book_id);
        if (b && inRange(i.issued_on, start, end)) m.get(b.category).loans++;
      }
      const rows = [...m.values()].sort((a, b) => b.loans - a.loans || b.copies - a.copies);
      const total = rows.reduce((t, r) => t + r.loans, 0);
      rows.forEach((r) => { r.share = total ? `${Math.round((r.loans / total) * 100)}%` : '0%'; });
      return {
        ...base, description: 'Loans in the period and current stock, per category.',
        columns: [col('category', 'Category'), col('titles', 'Titles', true), col('copies', 'Copies', true), col('on_loan', 'On loan now', true), col('loans', 'Loans in period', true), col('share', 'Share of loans', true)],
        rows,
        summary: [{ label: 'Categories', value: rows.length }, { label: 'Loans in period', value: total }, { label: 'Most popular', value: rows[0]?.loans ? rows[0].category : '—' }],
      };
    }
    case 'members': {
      const members = await lib.listMembers({});
      const loans = new Map();
      for (const i of issues) if (inRange(i.issued_on, start, end)) loans.set(i.member_id, (loans.get(i.member_id) || 0) + 1);
      const rows = members.map((m) => ({
        member_code: m.member_code, name: m.name, type: m.membership_type || 'General', status: !m.active ? 'Inactive' : (m.valid_until && m.valid_until < today ? 'Expired' : 'Active'),
        valid_until: m.valid_until || 'No expiry', loans_in_period: loans.get(m.id) || 0, on_loan_now: m.active_issues, unpaid_fines: m.unpaid_fines,
      })).sort((a, b) => b.loans_in_period - a.loans_in_period || a.name.localeCompare(b.name));
      return {
        ...base, description: 'Each member’s borrowing in the period, current loans, fines and membership status.',
        columns: [col('member_code', 'Member ID'), col('name', 'Name'), col('type', 'Membership'), col('status', 'Status'), col('valid_until', 'Valid until'), col('loans_in_period', 'Loans in period', true), col('on_loan_now', 'On loan now', true), col('unpaid_fines', 'Unpaid fines (₹)', true)],
        rows,
        summary: [{ label: 'Members', value: rows.length }, { label: 'Borrowed in period', value: rows.filter((r) => r.loans_in_period > 0).length },
          { label: 'Expired memberships', value: rows.filter((r) => r.status === 'Expired').length }, { label: 'Owing fines', value: rows.filter((r) => r.unpaid_fines > 0).length }],
      };
    }
    case 'inventory': {
      const books = await lib.searchBooks({});
      const rows = books.map((b) => ({
        title: b.title, author: b.author, isbn: b.isbn, category: b.category, shelf: b.shelf || '', total: b.total_copies,
        available: b.available_copies, on_loan: b.issued_copies, held: b.held_copies, waiting: b.queue_length,
      }));
      return {
        ...base, period: { ...period, from: today, to: today }, description: 'Current stock for every title, as of today.',
        columns: [col('title', 'Title'), col('author', 'Author'), col('isbn', 'ISBN'), col('category', 'Category'), col('shelf', 'Shelf'), col('total', 'Copies', true), col('available', 'On shelf', true), col('on_loan', 'On loan', true), col('held', 'Held', true), col('waiting', 'Waiting', true)],
        rows,
        summary: [{ label: 'Titles', value: rows.length }, { label: 'Copies', value: rows.reduce((t, r) => t + r.total, 0) },
          { label: 'On the shelf', value: rows.reduce((t, r) => t + r.available, 0) }, { label: 'Titles with none available', value: rows.filter((r) => r.available === 0).length }],
      };
    }
    case 'acquisitions': {
      const list = (await lib.listAcquisitions({})).filter((a) => inRange(a.requested_on, start, end) || inRange(a.received_on, start, end));
      const rows = list.map((a) => ({
        title: a.title, isbn: a.isbn, vendor: a.vendor, quantity: a.quantity, unit_cost: a.unit_cost, total_cost: a.total_cost, status: a.status[0].toUpperCase() + a.status.slice(1),
        requested_on: a.requested_on, received_on: a.received_on || '',
      }));
      const spent = list.filter((a) => a.status === 'received').reduce((t, a) => t + a.total_cost, 0);
      const pending = list.filter((a) => a.status === 'requested' || a.status === 'ordered').reduce((t, a) => t + a.total_cost, 0);
      return {
        ...base, description: 'Purchases requested or received in the period.',
        columns: [col('title', 'Title'), col('isbn', 'ISBN'), col('vendor', 'Vendor'), col('quantity', 'Qty', true), col('unit_cost', 'Cost / copy (₹)', true), col('total_cost', 'Total (₹)', true), col('status', 'Status'), col('requested_on', 'Requested'), col('received_on', 'Received')],
        rows,
        summary: [{ label: 'Purchases', value: rows.length }, { label: 'Copies received', value: list.filter((a) => a.status === 'received').reduce((t, a) => t + a.quantity, 0) },
          { label: 'Spent (received)', value: `₹${spent}` }, { label: 'Pending orders', value: `₹${pending}` }],
      };
    }
    case 'digital': {
      const list = await lib.listDigital({});
      const rows = list.map((r) => ({ title: r.title, type: r.type, category: r.category, access: r.access, added_on: r.added_on, views: r.views }))
        .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title));
      return {
        ...base, period: { ...period, from: today, to: today }, description: 'Digital resources and how often they were opened (all time).',
        columns: [col('title', 'Title'), col('type', 'Type'), col('category', 'Category'), col('access', 'Access'), col('added_on', 'Added'), col('views', 'Views', true)],
        rows,
        summary: [{ label: 'Resources', value: rows.length }, { label: 'Total views', value: rows.reduce((t, r) => t + r.views, 0) }, { label: 'Most viewed', value: rows[0]?.views ? rows[0].title : '—' }],
      };
    }
    default:
      throw new LibraryError('Unknown report.', 404);
  }
}
