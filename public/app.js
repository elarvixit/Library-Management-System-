'use strict';
// Librarian console. All rules are enforced by the server; the UI only previews them for convenience.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

let RULES = { LOAN_DAYS: 14, MAX_ACTIVE_ISSUES: 3, FINE_PER_DAY: 5, HOLD_DAYS: 2 };
let TODAY = localToday();
const state = { members: [], books: [], reservations: [] };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}
const fail = (err) => toast(err.message, 'error');

function table(cols, rows, empty = 'Nothing here yet.') {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const memberCell = (r) => `${esc(r.member_name)}<div class="muted">${esc(r.member_code)}</div>`;
const bookCell = (r) => `${esc(r.title)}<div class="muted mono">${esc(r.isbn)}</div>`;

// ---------------------------------------------------------------- modal
function openModal({ title, body, ok = 'Save', danger = false, onSubmit }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-error').textContent = '';
  const okBtn = $('#modal-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    okBtn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      dlg.close();
    } catch (err) {
      $('#modal-error').textContent = err.message;
    } finally {
      okBtn.disabled = false;
    }
  };
  $('#modal-cancel').onclick = () => dlg.close();
  dlg.showModal();
  $('input, select', $('#modal-body'))?.focus();
}

// ---------------------------------------------------------------- data loading
async function loadMembers() { state.members = await api('GET', '/api/members'); }
async function loadBooks() { state.books = await api('GET', '/api/books'); }
async function loadReservations() { state.reservations = await api('GET', '/api/reservations?status=open'); }

async function refreshAll() {
  await Promise.all([loadMembers(), loadBooks(), loadReservations()]);
  fillSelects();
  await renderCurrent();
}

function fillSelects() {
  const memberOpts = '<option value="">Select member…</option>' + state.members.filter((m) => m.active)
    .map((m) => `<option value="${m.id}">${esc(m.name)} (${esc(m.member_code)})${m.unpaid_fines ? ` — owes ${rupees(m.unpaid_fines)}` : ''}</option>`).join('');
  for (const sel of $$('select[name=memberId]')) { const v = sel.value; sel.innerHTML = memberOpts; sel.value = v; }

  const issueBooks = '<option value="">Select book…</option>' + state.books
    .map((b) => `<option value="${b.id}">${esc(b.title)} — ${b.available_copies}/${b.total_copies} available${b.held_copies ? `, ${b.held_copies} held` : ''}${b.queue_length ? `, ${b.queue_length} waiting` : ''}</option>`).join('');
  const s1 = $('#issue-form [name=bookId]'); const v1 = s1.value; s1.innerHTML = issueBooks; s1.value = v1;

  const reserveBooks = '<option value="">Select book (no copies available)…</option>' + state.books.filter((b) => b.available_copies === 0)
    .map((b) => `<option value="${b.id}">${esc(b.title)} — ${b.queue_length} in queue</option>`).join('');
  const s2 = $('#reserve-form [name=bookId]'); const v2 = s2.value; s2.innerHTML = reserveBooks; s2.value = v2;
  updateIssueCheck();
}

// ---------------------------------------------------------------- views
let current = 'dashboard';
const renderers = {};

function show(view) {
  current = view;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${view}`);
  renderCurrent().catch(fail);
}
const renderCurrent = () => renderers[current]();

// Dashboard
renderers.dashboard = async () => {
  const d = await api('GET', '/api/dashboard');
  RULES = d.rules; TODAY = d.today;
  $('#today').textContent = fmtDate(d.today);
  const s = d.stats;
  $('#stats').innerHTML = [
    ['Issued today', s.issued_today],
    ['On loan', s.on_loan],
    ['Overdue', s.overdue, s.overdue ? 'alert' : 'good'],
    ['Ready for pickup', s.ready_for_pickup],
    ['Pending reservations', s.pending_reservations],
    ['Unpaid fines', rupees(s.unpaid_fines), s.unpaid_fines ? 'alert' : ''],
    ['Titles / copies', `${s.titles} / ${s.copies}`],
    ['Active members', s.active_members],
  ].map(([l, n, cls = '']) => `<div class="stat ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('');

  $('#dash-ready').innerHTML = table([
    { label: 'Book', render: bookCell },
    { label: 'Member', render: memberCell },
    { label: 'Held until', render: (r) => `${fmtDate(r.hold_until)}<div class="muted">${holdLeft(r.hold_until)}</div>` },
    { label: '', cls: 'actions', render: (r) => `<button class="btn small primary" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">Issue</button>
        <button class="btn small danger" data-act="cancel-res" data-id="${r.id}">Cancel</button>` },
  ], d.readyForPickup, 'No copies waiting to be picked up.');

  $('#dash-pending').innerHTML = table([
    { label: '#', cls: 'num', render: (r) => r.queue_position },
    { label: 'Book', render: bookCell },
    { label: 'Member', render: memberCell },
    { label: 'Since', render: (r) => fmtDate(r.reserved_on) },
  ], d.pendingReservations, 'No one is waiting for a book.');

  $('#dash-overdue').innerHTML = table([
    { label: 'Book', render: bookCell },
    { label: 'Member', render: (r) => `${memberCell(r)}${r.phone ? `<div class="muted">${esc(r.phone)}</div>` : ''}` },
    { label: 'Due', render: (r) => fmtDate(r.due_on) },
    { label: 'Days late', cls: 'num', render: (r) => r.days_overdue },
    { label: 'Fine', cls: 'num', render: (r) => `<b>${rupees(r.accrued_fine)}</b>` },
    { label: '', cls: 'actions', render: (r) => `<button class="btn small" data-act="return" data-id="${r.id}">Return</button>` },
  ], d.overdue, 'Nothing is overdue. 🎉');

  $('#dash-today').innerHTML = table([
    { label: 'Book', render: bookCell },
    { label: 'Member', render: memberCell },
    { label: 'Due', render: (r) => fmtDate(r.due_on) },
    { label: 'Status', render: (r) => (r.returned_on ? '<span class="badge muted">Returned</span>' : '<span class="badge">On loan</span>') },
  ], d.issuedToday, 'No books issued today.');
};
function holdLeft(until) {
  const n = daysBetween(TODAY, until);
  return n <= 0 ? 'last day to collect' : `${n} day${n === 1 ? '' : 's'} left`;
}

// Books
renderers.books = async () => {
  const f = new FormData($('#book-search'));
  const qs = new URLSearchParams({ q: f.get('q') || '', field: f.get('field'), ...(f.get('available') ? { available: '1' } : {}) });
  const books = await api('GET', `/api/books?${qs}`);
  $('#books-table').innerHTML = table([
    { label: 'Title', render: (b) => `<b>${esc(b.title)}</b><div class="muted">${esc(b.author)}</div>` },
    { label: 'ISBN', render: (b) => `<span class="mono">${esc(b.isbn)}</span>` },
    { label: 'Category', render: (b) => esc(b.category) },
    { label: 'Available', cls: 'num', render: (b) => `<span class="badge ${b.available_copies ? 'ok' : 'danger'}">${b.available_copies} / ${b.total_copies}</span>` },
    { label: 'On loan', cls: 'num', render: (b) => b.issued_copies },
    { label: 'Queue', cls: 'num', render: (b) => (b.queue_length || b.held_copies ? `${b.queue_length} waiting${b.held_copies ? `<div class="muted">${b.held_copies} held</div>` : ''}` : '—') },
    { label: '', cls: 'actions', render: (b) => `
        <button class="btn small" data-act="issue-book" data-book="${b.id}">Issue</button>
        ${b.available_copies === 0 ? `<button class="btn small" data-act="reserve-book" data-book="${b.id}">Reserve</button>` : ''}
        <button class="btn small" data-act="edit-book" data-id="${b.id}">Edit</button>
        <button class="btn small danger" data-act="delete-book" data-id="${b.id}">Delete</button>` },
  ], books, 'No books match your search.');
};

function bookForm(b = {}) {
  return `
    <label>Title<input name="title" required maxlength="200" value="${esc(b.title)}"></label>
    <label>Author<input name="author" required maxlength="200" value="${esc(b.author)}"></label>
    <div class="row">
      <label>ISBN<input name="isbn" required placeholder="10 or 13 digits" value="${esc(b.isbn)}"></label>
      <label>Category<input name="category" maxlength="80" placeholder="General" value="${esc(b.category)}"></label>
    </div>
    <label>Total copies<input name="total_copies" type="number" min="1" step="1" required value="${esc(b.total_copies ?? 1)}"></label>
    ${b.id ? `<p class="note">Currently ${b.issued_copies} on loan, ${b.held_copies} held for pickup, ${b.available_copies} on the shelf. Available copies are recalculated from the total.</p>` : ''}`;
}
function addBook() {
  openModal({
    title: 'Add book', ok: 'Add book', body: bookForm(),
    onSubmit: async (v) => { const b = await api('POST', '/api/books', { ...v, total_copies: Number(v.total_copies) }); toast(`Added "${b.title}".`, 'ok'); await refreshAll(); },
  });
}
async function editBook(bookId) {
  const b = await api('GET', `/api/books/${bookId}`);
  openModal({
    title: 'Edit book', body: bookForm(b),
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/books/${bookId}`, { ...v, total_copies: Number(v.total_copies) });
      toast(`Saved "${r.title}".`, 'ok');
      for (const p of r.promoted || []) toast(`New copy held for ${p.memberName} (ready for pickup).`);
      await refreshAll();
    },
  });
}
function deleteBook(bookId) {
  const b = state.books.find((x) => x.id === bookId);
  openModal({
    title: 'Delete book', ok: 'Delete', danger: true,
    body: `<p>Delete <b>${esc(b?.title)}</b>? This cannot be undone. Past issue and fine records are kept.</p>`,
    onSubmit: async () => { await api('DELETE', `/api/books/${bookId}`); toast('Book deleted.', 'ok'); await refreshAll(); },
  });
}
async function importCsv(file) {
  const csv = await file.text();
  const r = await api('POST', '/api/books/import', { csv });
  const skipped = r.skipped.length;
  openModal({
    title: 'CSV import finished', ok: 'Done',
    body: `<p><b>${r.imported}</b> book(s) imported${skipped ? `, <b>${skipped}</b> row(s) skipped:` : '.'}</p>
      ${skipped ? `<div class="table-wrap"><table><thead><tr><th>Line</th><th>Reason</th></tr></thead><tbody>
        ${r.skipped.map((s) => `<tr><td class="num">${s.line}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    onSubmit: async () => {},
  });
  $('#modal-cancel').hidden = true;
  $('#modal').addEventListener('close', () => { $('#modal-cancel').hidden = false; }, { once: true });
  await refreshAll();
}

// Members
renderers.members = async () => {
  const f = new FormData($('#member-search'));
  const qs = new URLSearchParams({ q: f.get('q') || '', ...(f.get('active') ? { active: '1' } : {}) });
  const members = await api('GET', `/api/members?${qs}`);
  $('#members-table').innerHTML = table([
    { label: 'Member', render: (m) => `<b>${esc(m.name)}</b><div class="muted mono">${esc(m.member_code)}</div>` },
    { label: 'Contact', render: (m) => `${esc(m.phone) || '—'}<div class="muted">${esc(m.email)}</div>` },
    { label: 'Joined', render: (m) => fmtDate(m.join_date) },
    { label: 'Status', render: (m) => (m.active ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Inactive</span>') },
    { label: 'Books', cls: 'num', render: (m) => `${m.active_issues} / ${RULES.MAX_ACTIVE_ISSUES}` },
    { label: 'Unpaid fine', cls: 'num', render: (m) => (m.unpaid_fines ? `<span class="badge danger">${rupees(m.unpaid_fines)}</span>` : '—') },
    { label: '', cls: 'actions', render: (m) => `
        ${m.unpaid_fines ? `<button class="btn small primary" data-act="pay" data-id="${m.id}">Pay fine</button>` : ''}
        <button class="btn small" data-act="view-member" data-id="${m.id}">Details</button>
        <button class="btn small" data-act="edit-member" data-id="${m.id}">Edit</button>` },
  ], members, 'No members match your search.');
};

function memberForm(m = {}) {
  return `
    <label>Name<input name="name" required maxlength="120" value="${esc(m.name)}"></label>
    <div class="row">
      <label>Member ID<input name="member_code" maxlength="30" placeholder="Auto (e.g. M0001)" value="${esc(m.member_code)}"></label>
      <label>Join date<input name="join_date" type="date" max="${TODAY}" value="${esc(m.join_date || TODAY)}"></label>
    </div>
    <div class="row">
      <label>Phone<input name="phone" type="tel" value="${esc(m.phone)}"></label>
      <label>Email<input name="email" type="email" value="${esc(m.email)}"></label>
    </div>
    <label class="inline"><input type="checkbox" name="active" ${m.active === 0 ? '' : 'checked'}> Active member</label>
    ${m.id && m.open_reservations ? '<p class="note warn">Deactivating this member cancels their open reservations and releases any held copies to the next person in the queue.</p>' : ''}`;
}
function addMember() {
  openModal({
    title: 'Add member', ok: 'Add member', body: memberForm(),
    onSubmit: async (v) => { const m = await api('POST', '/api/members', { ...v, active: !!v.active }); toast(`Added ${m.name} (${m.member_code}).`, 'ok'); await refreshAll(); },
  });
}
function editMember(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  openModal({
    title: 'Edit member', body: memberForm(m),
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/members/${memberId}`, { ...v, active: !!v.active });
      toast(`Saved ${r.name}.${r.cancelledReservations ? ` ${r.cancelledReservations} reservation(s) cancelled.` : ''}`, 'ok');
      await refreshAll();
    },
  });
}
function payFine(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  openModal({
    title: 'Pay fine', ok: `Mark ${rupees(m.unpaid_fines)} as paid`,
    body: `<p><b>${esc(m.name)}</b> owes <b>${rupees(m.unpaid_fines)}</b> in late-return fines. Once paid, they can borrow again.</p>`,
    onSubmit: async () => { const r = await api('POST', `/api/members/${memberId}/pay-fine`); toast(`${rupees(r.paid)} fine paid by ${r.member.name}.`, 'ok'); await refreshAll(); },
  });
}
async function viewMember(memberId) {
  const d = await api('GET', `/api/members/${memberId}`);
  const m = d.member;
  openModal({
    title: `${m.name} (${m.member_code})`, ok: 'Close',
    body: `
      <p class="note">${m.active ? 'Active' : 'Inactive'} · joined ${fmtDate(m.join_date)} · ${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES} books · unpaid fines ${rupees(m.unpaid_fines)}</p>
      <h2>On loan</h2>
      ${table([{ label: 'Book', render: bookCell }, { label: 'Due', render: (r) => `${fmtDate(r.due_on)}${r.overdue ? ` <span class="badge danger">${r.days_overdue}d late · ${rupees(r.accrued_fine)}</span>` : ''}` }], d.activeIssues, 'No books on loan.')}
      <h2>Reservations</h2>
      ${table([{ label: 'Book', render: bookCell }, { label: 'Status', render: resStatus }], d.reservations, 'No open reservations.')}
      <h2>History</h2>
      ${table([{ label: 'Book', render: bookCell }, { label: 'Returned', render: (r) => fmtDate(r.returned_on) }, { label: 'Fine', cls: 'num', render: (r) => (r.fine ? `${rupees(r.fine)} ${r.fine_paid ? '<span class="badge ok">paid</span>' : '<span class="badge danger">unpaid</span>'}` : '—') }], d.history, 'No past loans.')}`,
    onSubmit: async () => {},
  });
  $('#modal-cancel').hidden = true;
  $('#modal').addEventListener('close', () => { $('#modal-cancel').hidden = false; }, { once: true });
}

// Circulation
renderers.circulation = async () => {
  const status = $('#loan-filter').value;
  const loans = await api('GET', `/api/issues?status=${status}`);
  $('#loans-table').innerHTML = table([
    { label: 'Book', render: bookCell },
    { label: 'Member', render: memberCell },
    { label: 'Issued', render: (r) => fmtDate(r.issued_on) },
    { label: 'Due', render: (r) => fmtDate(r.due_on) },
    { label: 'Status', render: (r) => (r.returned_on
      ? `<span class="badge muted">Returned ${fmtDate(r.returned_on)}</span>`
      : r.overdue ? `<span class="badge danger">${r.days_overdue} day(s) overdue</span>` : '<span class="badge ok">On time</span>') },
    { label: 'Fine', cls: 'num', render: (r) => (r.accrued_fine ? `${rupees(r.accrued_fine)}${r.returned_on ? `<div class="muted">${r.fine_paid ? 'paid' : 'unpaid'}</div>` : '<div class="muted">so far</div>'}` : '—') },
    { label: '', cls: 'actions', render: (r) => (r.returned_on ? '' : `<button class="btn small primary" data-act="return" data-id="${r.id}">Return</button>`) },
  ], loans, status === 'overdue' ? 'Nothing is overdue.' : 'No loans to show.');
};

function updateIssueCheck() {
  const form = $('#issue-form');
  const member = state.members.find((m) => m.id === Number(form.memberId.value));
  const book = state.books.find((b) => b.id === Number(form.bookId.value));
  const panel = $('#issue-check');
  if (!member || !book) { panel.innerHTML = ''; return; }
  const items = [];
  const add = (ok, text) => items.push(`<li class="${ok ? 'good' : 'bad'}">${ok ? '✔' : '✖'} ${esc(text)}</li>`);
  add(!member.unpaid_fines, member.unpaid_fines ? `Unpaid fine of ${rupees(member.unpaid_fines)} — must be paid first` : 'No unpaid fines');
  add(member.active_issues < RULES.MAX_ACTIVE_ISSUES, `Holds ${member.active_issues} of ${RULES.MAX_ACTIVE_ISSUES} allowed books`);
  const openRes = state.reservations.filter((r) => r.book_id === book.id);
  const mine = openRes.find((r) => r.member_id === member.id);
  const waiting = openRes.filter((r) => r.status === 'waiting');
  if (mine?.status === 'ready') add(true, `A copy is held for this member until ${fmtDate(mine.hold_until)}`);
  else if (waiting.length) add(false, `Reservation queue: only ${waiting[0].member_name} (first in queue) can borrow this book`);
  else add(book.available_copies > 0, book.available_copies > 0 ? `${book.available_copies} cop${book.available_copies === 1 ? 'y' : 'ies'} available` : 'No copies available — place a reservation instead');
  panel.innerHTML = `<ul>${items.join('')}</ul>`;
}

async function submitIssue(e) {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('POST', '/api/issues', { memberId: Number(v.memberId), bookId: Number(v.bookId), issuedOn: v.issuedOn, dueOn: v.dueOn });
    toast(`Issued "${r.title}" to ${r.member_name}, due ${fmtDate(r.due_on)}.`, 'ok');
    e.target.bookId.value = '';
    await refreshAll();
  } catch (err) { fail(err); }
}
function resetIssueDates() {
  const f = $('#issue-form');
  f.issuedOn.value = TODAY; f.issuedOn.max = TODAY;
  f.dueOn.value = addDays(TODAY, RULES.LOAN_DAYS); f.dueOn.min = TODAY;
}

async function returnBook(issueId) {
  const issue = await api('GET', '/api/issues?status=active').then((rows) => rows.find((r) => r.id === issueId));
  if (!issue) { toast('That loan is no longer active.', 'error'); return refreshAll(); }
  const preview = (date) => {
    const late = Math.max(0, daysBetween(issue.due_on, date));
    return late ? `<p class="note warn">Returned ${late} day(s) late → fine of <b>${rupees(late * RULES.FINE_PER_DAY)}</b> will be recorded against ${esc(issue.member_name)}.</p>`
      : '<p class="note">On time — no fine.</p>';
  };
  openModal({
    title: 'Return book', ok: 'Mark returned',
    body: `<p><b>${esc(issue.title)}</b> borrowed by <b>${esc(issue.member_name)}</b> (${esc(issue.member_code)})<br>
        <span class="muted">Issued ${fmtDate(issue.issued_on)} · due ${fmtDate(issue.due_on)}</span></p>
      <label>Return date<input type="date" name="returnedOn" required min="${issue.issued_on}" max="${TODAY}" value="${TODAY}"></label>
      <div id="fine-preview">${preview(TODAY)}</div>`,
    onSubmit: async (v) => {
      const r = await api('POST', `/api/issues/${issueId}/return`, { returnedOn: v.returnedOn });
      toast(r.fine ? `Returned ${r.daysLate} day(s) late. Fine ${rupees(r.fine)} recorded against ${r.member_name}.` : 'Returned on time. No fine.', r.fine ? '' : 'ok');
      if (r.readyFor) toast(`Copy held for ${r.readyFor.memberName} (${r.readyFor.memberCode}) until ${fmtDate(r.readyFor.holdUntil)} — added to "Ready for pickup".`);
      await refreshAll();
    },
  });
  $('#modal-body [name=returnedOn]').addEventListener('input', (e) => { if (e.target.value) $('#fine-preview').innerHTML = preview(e.target.value); });
}

// Reservations
function resStatus(r) {
  return {
    waiting: `<span class="badge">Waiting · #${r.queue_position} in queue</span>`,
    ready: `<span class="badge ok">Ready · held until ${fmtDate(r.hold_until)}</span>`,
    fulfilled: '<span class="badge muted">Collected</span>',
    cancelled: '<span class="badge muted">Cancelled</span>',
    expired: '<span class="badge warn">Expired (not collected)</span>',
  }[r.status];
}
renderers.reservations = async () => {
  const rows = await api('GET', `/api/reservations?status=${$('#res-filter').value}`);
  $('#res-table').innerHTML = table([
    { label: 'Book', render: bookCell },
    { label: 'Member', render: memberCell },
    { label: 'Reserved', render: (r) => fmtDate(r.reserved_on) },
    { label: 'Status', render: resStatus },
    { label: '', cls: 'actions', render: (r) => (['waiting', 'ready'].includes(r.status) ? `
        ${r.status === 'ready' ? `<button class="btn small primary" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">Issue</button>` : ''}
        <button class="btn small danger" data-act="cancel-res" data-id="${r.id}">Cancel</button>` : '') },
  ], rows, 'No reservations to show.');
};
async function submitReserve(e) {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('POST', '/api/reservations', { memberId: Number(v.memberId), bookId: Number(v.bookId) });
    toast(`${r.member_name} is #${r.queue_position} in the queue for "${r.title}".`, 'ok');
    e.target.bookId.value = '';
    await refreshAll();
  } catch (err) { fail(err); }
}
function cancelReservation(resId) {
  openModal({
    title: 'Cancel reservation', ok: 'Cancel reservation', danger: true,
    body: '<p>Cancel this reservation? If a copy is being held, it passes to the next person in the queue (or back to the shelf).</p>',
    onSubmit: async () => {
      const r = await api('POST', `/api/reservations/${resId}/cancel`);
      toast('Reservation cancelled.', 'ok');
      if (r.readyFor) toast(`Copy now held for ${r.readyFor.memberName}.`);
      await refreshAll();
    },
  });
}
async function quickIssue(memberId, bookId) {
  try {
    const r = await api('POST', '/api/issues', { memberId, bookId });
    toast(`Issued "${r.title}" to ${r.member_name}, due ${fmtDate(r.due_on)}.`, 'ok');
    await refreshAll();
  } catch (err) { fail(err); }
}

// ---------------------------------------------------------------- wiring
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const idOf = (k = 'id') => Number(btn.dataset[k]);
  const acts = {
    'edit-book': () => editBook(idOf()),
    'delete-book': () => deleteBook(idOf()),
    'issue-book': () => { show('circulation'); $('#issue-form').bookId.value = btn.dataset.book; updateIssueCheck(); $('#issue-form').memberId.focus(); },
    'reserve-book': () => { show('reservations'); $('#reserve-form').bookId.value = btn.dataset.book; $('#reserve-form').memberId.focus(); },
    'edit-member': () => editMember(idOf()),
    'view-member': () => viewMember(idOf()),
    pay: () => payFine(idOf()),
    return: () => returnBook(idOf()),
    'cancel-res': () => cancelReservation(idOf()),
    'issue-hold': () => quickIssue(idOf('member'), idOf('book')),
  };
  Promise.resolve(acts[btn.dataset.act]?.()).catch(fail);
});

for (const t of $$('.tab')) t.addEventListener('click', () => show(t.dataset.view));
let debounce;
for (const id of ['#book-search', '#member-search']) {
  $(id).addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => renderCurrent().catch(fail), 200); });
  $(id).addEventListener('submit', (e) => e.preventDefault());
}
$('#btn-add-book').addEventListener('click', addBook);
$('#btn-add-member').addEventListener('click', addMember);
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f).catch(fail); });
$('#issue-form').addEventListener('submit', submitIssue);
$('#issue-form').addEventListener('change', (e) => {
  if (e.target.name === 'issuedOn' && e.target.value) $('#issue-form').dueOn.value = addDays(e.target.value, RULES.LOAN_DAYS);
  updateIssueCheck();
});
$('#reserve-form').addEventListener('submit', submitReserve);
$('#loan-filter').addEventListener('change', () => renderCurrent().catch(fail));
$('#res-filter').addEventListener('change', () => renderCurrent().catch(fail));

(async () => {
  try {
    const d = await api('GET', '/api/dashboard');
    RULES = d.rules; TODAY = d.today;
    resetIssueDates();
    await refreshAll();
  } catch (err) { fail(err); }
})();
