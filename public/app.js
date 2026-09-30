'use strict';
/* Library Desk — librarian console.
 * The server enforces every business rule. This UI previews the rules (so the librarian sees a
 * problem before clicking) and always shows the server's own message when something is refused. */

// ===================================================================== utilities
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const asDate = (s) => new Date(`${s}T00:00:00`);
const fmtDate = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtShort = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const fmtLong = (s) => asDate(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function relDays(date) {
  const n = daysBetween(TODAY, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function hl(text, q) {
  const s = String(text ?? '');
  if (!q) return esc(s);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(s);
  return `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  arrowOut: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  arrowIn: '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  wallet: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  renew: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  chevLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevRight: '<polyline points="9 18 15 12 9 6"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  idCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  cornerDownLeft: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const hydrateIcons = (root = document) => { for (const el of $$('[data-icon]', root)) if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); };

// Deterministic colours: the same book / member always gets the same cover / avatar.
function hue(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const initials = (s) => String(s || '?').trim().split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const avatar = (name, size = '') => `<span class="avatar ${size}" style="background:hsl(${hue(name)} 48% 48%)">${esc(initials(name))}</span>`;
// Book cover: the real front cover from Open Library (looked up by ISBN), drawn over a designed
// fallback cover. If Open Library has no image, the fallback simply stays visible.
const coverUrl = (isbn, size) => `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg?default=false`;
function cover(title, size = '', isbn = '') {
  const h = hue(title);
  const letter = initials(String(title).replace(/^(the|a|an)\s+/i, '')).slice(0, 1);
  const code = String(isbn || state.books.find((b) => b.title === title)?.isbn || '').replace(/[^0-9X]/gi, '');
  const big = size === 'lg' || size === 'xl';
  const face = big ? `<span class="cv-title">${esc(title)}</span><span class="cv-rule"></span>` : `<span class="cv-letter">${esc(letter)}</span>`;
  const img = code ? `<img src="${coverUrl(code, size === 'xl' || size === 'lg' ? 'L' : 'M')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="if(this.naturalWidth>10)this.parentNode.classList.add('has-img');else this.remove()" onerror="this.remove()">` : '';
  return `<span class="cover ${size}" style="background:linear-gradient(155deg,hsl(${h} 52% 46%),hsl(${(h + 35) % 360} 58% 30%))">${face}${img}</span>`;
}
const who = (name, sub, q = '') => `<div class="who">${avatar(name)}<div><b>${hl(name, q)}</b><div class="sub">${sub}</div></div></div>`;
const bookWho = (title, sub, q = '') => `<div class="who">${cover(title)}<div><b>${hl(title, q)}</b><div class="sub">${sub}</div></div></div>`;
const badge = (text, tone = '', dot = false) => `<span class="badge ${tone}">${dot ? '<span class="dot"></span>' : ''}${text}</span>`;
const dots = (n, max) => `<span class="dots" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? (n >= max ? 'full' : 'on') : ''}"></i>`).join('')}</span>`;
const empty = (ic, title, sub = '', cls = '') => `<div class="empty ${cls}"><div class="e-ico">${icon(ic)}</div><b>${esc(title)}</b>${esc(sub)}</div>`;
const skeleton = (h = 200) => `<div class="card-body"><div class="skeleton" style="height:${h}px"></div></div>`;

// ===================================================================== state & API
let RULES = { LOAN_DAYS: 14, MAX_ACTIVE_ISSUES: 3, FINE_PER_DAY: 5, HOLD_DAYS: 2, MAX_RENEWALS: 2, DUE_SOON_DAYS: 3 };
let TODAY = localToday();
const state = { members: [], books: [], reservations: [], loans: [], dash: null, stats: null };
const ui = {
  view: 'dashboard', circTab: 'issue', loanFilter: 'active', attn: 'overdue', resFilter: 'open', fineFilter: 'unpaid', actFilter: 'all',
  bookField: 'all', bookView: 'table', bookPage: 1, memberFilter: 'all', memberPage: 1,
};
try { ui.bookView = localStorage.getItem('lib-book-view') || 'table'; } catch { /* storage unavailable */ }
const PAGE_SIZE = 10;

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshAll() {
  const [dash, stats, members, books, reservations, loans] = await Promise.all([
    // Stats are optional: an older server without /api/stats still gets a working app.
    api('GET', '/api/dashboard'), api('GET', '/api/stats').catch(() => null), api('GET', '/api/members'), api('GET', '/api/books'),
    api('GET', '/api/reservations?status=open'), api('GET', '/api/issues?status=active'),
  ]);
  Object.assign(state, { dash, stats, members, books, reservations, loans });
  RULES = dash.rules; TODAY = dash.today;
  $('#today-label').textContent = asDate(TODAY).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  setBadge('#nb-overdue', dash.stats.overdue);
  setBadge('#nb-ready', dash.stats.ready_for_pickup);
  setBadge('#nb-fines', members.filter((m) => m.unpaid_fines > 0).length);
  $('#rules-list').innerHTML = [
    `Loan period ${RULES.LOAN_DAYS} days`, `Max ${RULES.MAX_ACTIVE_ISSUES} books per member`, `Late fine ₹${RULES.FINE_PER_DAY}/day`,
    `Holds kept ${RULES.HOLD_DAYS} days`, `Up to ${RULES.MAX_RENEWALS} renewals`,
  ].map((r) => `<li>${esc(r)}</li>`).join('');
  $$('.js-loan-days').forEach((el) => { el.textContent = RULES.LOAN_DAYS; });
  renderBell();
  for (const p of Object.values(pickers)) p.refresh();
  updateIssuePanel();
  await render();
  if (drawerState) drawerState.reopen();
}
function setBadge(sel, n) { const el = $(sel); el.hidden = !n; el.textContent = n; }

// ===================================================================== toasts
function toast(msg, kind = 'info', { title = '', action = null } = {}) {
  const tones = { ok: ['checkCircle', 'tone-green'], error: ['alertCircle', 'tone-red'], info: ['info', 'tone-blue'], warn: ['alert', 'tone-amber'] };
  const [ic, tone] = tones[kind] || tones.info;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="t-ico ${tone}" data-icon="${ic}"></span><div class="t">${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}
    ${action ? `<div class="t-act"><button class="btn xs">${esc(action.label)}</button></div>` : ''}</div><button class="t-x" aria-label="Dismiss">${icon('x')}</button>`;
  hydrateIcons(el);
  $('.t-x', el).onclick = () => el.remove();
  if (action) $('.t-act button', el).onclick = () => { el.remove(); action.run(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : action ? 8000 : 5000);
}
const fail = (err) => toast(err.message, 'error', { title: 'Action refused' });

// ===================================================================== modal
function openModal({ title, sub = '', body, ok = 'Save', tone = 'primary', ic = '', icTone = 'tone-indigo', onSubmit, onOpen, hideCancel = false, cancel = 'Cancel', extra = '', wide = false }) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  $('#modal-title').textContent = title;
  $('#modal-sub').textContent = sub;
  const mi = $('#modal-ico');
  mi.className = `modal-ico ${icTone}`;
  mi.innerHTML = ic ? icon(ic) : '';
  $('#modal-body').innerHTML = body;
  $('#modal-extra').innerHTML = extra;
  $('#modal-error').textContent = '';
  const okBtn = $('#modal-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${tone}`;
  okBtn.hidden = ok === null;
  $('#modal-cancel').hidden = hideCancel;
  $('#modal-cancel').textContent = cancel;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    okBtn.disabled = true;
    try {
      const keepOpen = await onSubmit?.(Object.fromEntries(new FormData(form)), form);
      if (keepOpen !== true) dlg.close();
    } catch (err) {
      $('#modal-error').innerHTML = `${icon('alertCircle')}<span>${esc(err.message)}</span>`;
    } finally {
      okBtn.disabled = false;
    }
  };
  $('#modal-cancel').onclick = () => dlg.close();
  hydrateIcons(dlg);
  if (!dlg.open) dlg.showModal();
  onOpen?.();
  const first = $('#modal-body input:not([type=hidden]):not([type=checkbox]), #modal-body select', dlg);
  if (first) first.focus(); else if (!okBtn.hidden) okBtn.focus();
}
const closeModal = () => { if ($('#modal').open) $('#modal').close(); };

// ===================================================================== drawer
let drawerState = null;
function openDrawer(renderFn) {
  drawerState = {
    reopen: async () => {
      try { $('#drawer-body').innerHTML = await renderFn(); hydrateIcons($('#drawer-body')); } catch (err) { closeDrawer(); fail(err); }
    },
  };
  $('#drawer-body').innerHTML = `<div class="d-hero"><div class="skeleton" style="height:80px"></div></div>${skeleton(240)}`;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-scrim').classList.add('open');
  drawerState.reopen();
}
function closeDrawer() {
  drawerState = null;
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-scrim').classList.remove('open');
}

// ===================================================================== printing
let lastPrint = '';
function printDoc(html) {
  lastPrint = html;
  $('#print-area').innerHTML = html;
  window.print();
}
const pRow = (k, v) => `<div class="p-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
function loanSlip(r) {
  return `<div class="p-doc"><h1>Library Desk</h1><div class="p-sub">Loan slip · #${r.id}</div>
    ${pRow('Member', `${r.member_name} (${r.member_code})`)}${pRow('Book', r.title)}${pRow('ISBN', r.isbn)}
    ${pRow('Issued on', fmtDate(r.issued_on))}<div class="p-total"><span>Due back</span><span>${fmtDate(r.due_on)}</span></div>
    ${pRow('Issued by', LIBRARIAN)}<div class="p-foot">Late returns are charged ₹${RULES.FINE_PER_DAY} per day. Thank you for reading!</div></div>`;
}
function returnReceipt(r) {
  return `<div class="p-doc"><h1>Library Desk</h1><div class="p-sub">Return receipt · #${r.id}</div>
    ${pRow('Member', `${r.member_name} (${r.member_code})`)}${pRow('Book', r.title)}${pRow('Issued on', fmtDate(r.issued_on))}
    ${pRow('Due on', fmtDate(r.due_on))}${pRow('Returned on', fmtDate(r.returned_on))}${pRow('Days late', r.daysLate)}
    <div class="p-total"><span>Fine</span><span>${rupees(r.fine)}${r.fine ? ' (unpaid)' : ''}</span></div>
    ${pRow('Received by', LIBRARIAN)}<div class="p-foot">Fines must be paid before new books can be issued.</div></div>`;
}
const memberExpired = (m) => !!(m && m.valid_until && m.valid_until < TODAY);
function membershipBadge(m) {
  if (!m.active) return badge('Inactive', '', true);
  if (memberExpired(m)) return badge('Expired', 'red', true);
  return badge('Active', 'green', true);
}
function memberCard(m) {
  return `<div class="p-card"><div class="p-brand">LIBRARY DESK · ${esc((m.membership_type || 'General').toUpperCase())} MEMBER</div><div><div class="p-name">${esc(m.name)}</div>
    <div class="p-meta">Member since ${fmtDate(m.join_date)}${m.valid_until ? ` · valid until ${fmtDate(m.valid_until)}` : ''}${m.phone ? ` · ${esc(m.phone)}` : ''}</div></div>
    <div class="p-barcode">${window.Barcode ? Barcode.code39(m.member_code, { height: 34 }) : ''}</div></div>`;
}

// ===================================================================== picker (search-as-you-type combobox)
const pickers = {};
function picker(id, opts) {
  const root = $(`#${id}`);
  const input = $('.picker-input', root);
  const list = $('.picker-list', root);
  let shown = [];
  let active = -1;
  let value = null;
  const findItem = (key) => opts.items().find((it) => opts.key(it) === key);
  const p = {
    get item() { return value == null ? null : findItem(value) || null; },
    set(item, silent = false) {
      value = item ? opts.key(item) : null;
      input.value = item ? opts.label(item) : '';
      root.classList.toggle('has-value', !!item);
      list.hidden = true;
      if (!silent) opts.onChange?.(item || null);
    },
    setByKey(key) { p.set(findItem(key) || null); },
    refresh() { if (value != null) { const it = findItem(value); if (it) input.value = opts.label(it); else p.set(null); } },
    focus() { input.focus(); },
  };
  function open() {
    const q = input.value.trim();
    const selected = p.item;
    const all = opts.items();
    shown = (selected && q === opts.label(selected) ? all : all.filter((it) => !q || opts.text(it).toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
    active = shown.length ? 0 : -1;
    const hq = selected && q === opts.label(selected) ? '' : q;
    list.innerHTML = shown.length
      ? shown.map((it, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">${opts.render(it, hq)}</li>`).join('')
      : `<li class="none">${esc(opts.empty || 'No matches')}</li>`;
    list.hidden = false;
  }
  const highlight = () => {
    $$('li[data-i]', list).forEach((li, i) => li.classList.toggle('active', i === active));
    $('li.active', list)?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', () => {
    if (value != null) { value = null; root.classList.remove('has-value'); opts.onChange?.(null); }
    open();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { open(); return; }
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (!list.hidden && shown[active]) { e.preventDefault(); p.set(shown[active]); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.stopPropagation(); list.hidden = true; }
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); p.set(shown[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(() => {
    list.hidden = true;
    if (value == null) input.value = ''; else p.refresh();
  }, 120));
  $('.picker-clear', root).addEventListener('click', () => { p.set(null); input.focus(); });
  pickers[id] = p;
  return p;
}

const memberText = (m) => `${m.name} ${m.member_code} ${m.phone} ${m.email}`;
const memberRender = (m, q) => `${avatar(m.name, 'sm')}<div class="grow"><b>${hl(m.name, q)}</b><small>${hl(m.member_code, q)} · ${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES} books</small></div>${m.unpaid_fines ? badge(`owes ${rupees(m.unpaid_fines)}`, 'red') : ''}`;
const bookText = (b) => `${b.title} ${b.author} ${b.isbn} ${b.category}`;
const bookRender = (b, q) => `${cover(b.title, 'sm')}<div class="grow"><b>${hl(b.title, q)}</b><small>${hl(b.author, q)}</small></div>${availBadge(b)}`;
function availBadge(b) {
  if (b.available_copies > 0) return badge(`${b.available_copies} available`, 'green', true);
  if (b.queue_length) return badge(`${b.queue_length} waiting`, 'amber', true);
  if (b.held_copies) return badge('Held for pickup', 'blue', true);
  return badge('All on loan', 'red', true);
}

// ===================================================================== routing & page chrome
const PAGES = {
  dashboard: { title: 'Dashboard', sub: () => `${greeting()} Here's what's happening at the library today.` },
  activity: { title: 'Activity', sub: () => 'Every loan, return, reservation and payment, newest first.' },
  issue: { title: 'Issue Book', sub: () => `Lend a book to a member · ${RULES.LOAN_DAYS}-day loans · max ${RULES.MAX_ACTIVE_ISSUES} books per member` },
  returns: { title: 'Return Book', sub: () => `${plural(state.loans.length, 'book')} on loan · ${plural(state.dash?.stats.overdue ?? 0, 'overdue loan')} · ₹${RULES.FINE_PER_DAY}/day late fine` },
  reservations: { title: 'Reservations', sub: () => `${plural(state.dash?.stats.ready_for_pickup ?? 0, 'copy', 'copies')} ready for pickup · ${plural(state.dash?.stats.pending_reservations ?? 0, 'member')} waiting` },
  fines: { title: 'Fines', sub: () => `Late fees are ₹${RULES.FINE_PER_DAY} per day. Unpaid fines block new issues.` },
  books: { title: 'Books', sub: () => `${plural(state.dash?.stats.titles ?? 0, 'title')} · ${plural(state.dash?.stats.copies ?? 0, 'copy', 'copies')} · ${state.dash?.stats.available ?? 0} on the shelf` },
  members: { title: 'Members', sub: () => `${state.dash?.stats.active_members ?? 0} active of ${plural(state.members.length, 'member')}` },
};
const LIBRARIAN = 'Elarvix';
function greeting() {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${LIBRARIAN.split(' ')[0]}.`;
}
const actBtn = (act, ic, label, cls = '', extra = '') => `<button class="btn ${cls}" data-act="${act}" ${extra}>${icon(ic)}${label}</button>`;
const linkBtn = (href, ic, label) => `<a class="btn" href="${href}" download>${icon(ic)}${label}</a>`;
function pageActions(view) {
  return {
    dashboard: `${actBtn('go-return', 'arrowIn', 'Return book')}${actBtn('go-issue', 'arrowOut', 'Issue book', 'primary')}`,
    activity: '',
    issue: `${actBtn('go-reserve', 'bookmark', 'Reserve instead')}${actBtn('go-return', 'arrowIn', 'Return Book')}`,
    returns: `${linkBtn('/api/reports/overdue.csv', 'download', 'Overdue CSV')}${actBtn('go-issue', 'arrowOut', 'Issue Book', 'primary')}`,
    reservations: '',
    fines: linkBtn('/api/reports/fines.csv', 'download', 'Export CSV'),
    books: `${linkBtn('/api/reports/books-template.csv', 'file', 'Template')}${actBtn('import', 'upload', 'Import CSV')}${linkBtn('/api/reports/books.csv', 'download', 'Export')}${actBtn('add-book', 'plus', 'Add book', 'primary')}`,
    members: `${linkBtn('/api/reports/members.csv', 'download', 'Export')}${actBtn('add-member', 'userPlus', 'Add member', 'primary')}`,
    acquisitions: actBtn('add-acq', 'plus', 'New purchase request', 'primary'),
    digital: actBtn('add-digital', 'plus', 'Add digital resource', 'primary'),
    reports: `${actBtn('print-report', 'printer', 'Print')}${actBtn('export-report', 'download', 'Export CSV', 'primary')}`,
  }[view];
}

function route() {
  let [view, tab] = location.hash.replace(/^#\/?/, '').split('/');
  if (view === 'circulation') view = tab === 'return' ? 'returns' : 'issue'; // old links
  ui.view = PAGES[view] ? view : 'dashboard';
  for (const a of $$('.nav-item')) a.classList.toggle('on', a.dataset.view === ui.view);
  for (const v of $$('.view')) v.classList.toggle('on', v.id === `view-${ui.view}`);
  $('.site-footer').hidden = ui.view !== 'dashboard'; // footer only on the dashboard
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
  window.scrollTo({ top: 0 });
  render().catch(fail);
}
function go(view, tab) {
  const hash = `#/${view}${tab ? `/${tab}` : ''}`;
  if (location.hash === hash) route(); else location.hash = hash;
}

async function render() {
  const page = PAGES[ui.view];
  $('#page-title').textContent = page.title;
  $('#page-sub').textContent = page.sub();
  $('#crumb').textContent = page.title;
  $('#page-actions').innerHTML = pageActions(ui.view);
  $('#content').classList.toggle('no-head', ui.view === 'dashboard');
  document.title = `${page.title} · Library Desk`;
  await renderers[ui.view]();
  hydrateIcons($('#content'));
}

function table(cols, rows, emptyHtml, rowAttrs = () => '') {
  if (!rows.length) return emptyHtml;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr ${rowAttrs(r)}>${cols.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function paginate(rows, pageKey) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  ui[pageKey] = Math.min(Math.max(1, ui[pageKey]), pages);
  const start = (ui[pageKey] - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);
  const foot = rows.length > PAGE_SIZE ? `<div class="card-foot"><span class="muted small">Showing ${start + 1}–${start + slice.length} of ${rows.length}</span>
    <div class="pager"><span>Page ${ui[pageKey]} of ${pages}</span>
    <button class="btn sm" data-act="page" data-key="${pageKey}" data-to="${ui[pageKey] - 1}" ${ui[pageKey] <= 1 ? 'disabled' : ''}>${icon('chevLeft')}Previous</button>
    <button class="btn sm" data-act="page" data-key="${pageKey}" data-to="${ui[pageKey] + 1}" ${ui[pageKey] >= pages ? 'disabled' : ''}>Next${icon('chevRight')}</button></div></div>` : '';
  return { slice, foot };
}
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) { const k = keyFn(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
  return [...map.entries()];
}
const renderers = {};

// ===================================================================== dashboard
// Tiny single-series trend line for KPI cards (decorative summary; the full chart has the details).
function sparkline(values, color, label) {
  const w = 120; const h = 36; const n = values.length;
  if (n < 2) return '';
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (n - 1)) * w, h - 3 - (v / max) * (h - 8)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts.at(-1);
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,${h} ${line} ${w},${h}" fill="url(#${gid})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lx}" cy="${ly}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="2"/></svg>`;
}
// Single-value progress ring (share of copies on loan).
function ring(pct, label) {
  const r = 52; const c = 2 * Math.PI * r; const p = Math.max(0, Math.min(100, pct));
  return `<svg class="ring" viewBox="0 0 128 128" role="img" aria-label="${esc(label)}">
    <circle cx="64" cy="64" r="${r}" class="ring-track"/>
    <circle cx="64" cy="64" r="${r}" class="ring-val" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 64 64)"/>
    <text x="64" y="62" text-anchor="middle" class="ring-num">${p}%</text><text x="64" y="82" text-anchor="middle" class="ring-lbl">in use</text></svg>`;
}

ui.statsDays = 14;
renderers.dashboard = async () => {
  const d = state.dash;
  if (!d) { $('#view-dashboard').innerHTML = `<div class="card">${skeleton(400)}</div>`; return; }
  const st = state.stats || {
    activity: [], categories: [], topBooks: [], dueSoon: [], recent: [], utilisation: d.stats.copies ? Math.round((d.stats.on_loan / d.stats.copies) * 100) : 0,
    onTimeRate: null, fines: { collected_this_month: 0 }, missing: true,
  };
  const s = d.stats;
  const act = st.activity;
  const issuedSeries = act.map((x) => x.issued);
  const returnedSeries = act.map((x) => x.returned);
  const sum = (a) => a.reduce((t, v) => t + v, 0);
  const todayAct = act.at(-1) || { issued: 0, returned: 0 };
  const owing = state.members.filter((m) => m.unpaid_fines > 0);
  const borrowing = state.members.filter((m) => m.active_issues > 0).length;
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  // one-line summary of what needs doing today
  const todo = [];
  if (s.overdue) todo.push(`<b>${plural(s.overdue, 'overdue loan')}</b>`);
  if (s.ready_for_pickup) todo.push(`<b>${plural(s.ready_for_pickup, 'copy', 'copies')}</b> ready for pickup`);
  const dueToday = st.dueSoon.filter((l) => l.due_on === TODAY).length;
  if (dueToday) todo.push(`<b>${plural(dueToday, 'book')}</b> due back today`);
  if (s.unpaid_fines) todo.push(`<b>${rupees(s.unpaid_fines)}</b> in unpaid fines`);
  const summary = todo.length ? `Today you have ${todo.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Everything is on track — nothing needs your attention right now.';

  const kpi = ({ label, value, ic, tone, foot, target, series, color, alert }) => `
    <button class="kpi2 ${alert ? 'alert' : ''}" data-act="kpi" data-target="${target}" ${series ? `title="${esc(label)} — last ${act.length} days: ${series.join(', ')}"` : ''}>
      <div class="kpi2-top"><span class="kpi-ico ${tone}">${icon(ic)}</span><span class="kpi2-label">${esc(label)}</span>${icon('chevRight', 'kpi2-go')}</div>
      <div class="kpi2-mid"><span class="kpi2-val">${value}</span>${series ? sparkline(series, color, `${label}, last ${act.length} days`) : ''}</div>
      <div class="kpi2-foot">${foot}</div></button>`;

  const todayEvents = st.recent.filter((e) => e.date === TODAY);
  const attnCounts = { overdue: d.overdue.length, due: st.dueSoon.length, pickup: d.readyForPickup.length };
  const attnRows = { overdue: d.overdue, due: st.dueSoon, pickup: d.readyForPickup };
  const maxTop = Math.max(1, ...st.topBooks.map((b) => b.loans));

  $('#view-dashboard').innerHTML = `
    ${st.missing ? `<div class="callout warn row-gap">${icon('alert')}<span><b>The server is running an older version.</b> Charts and analytics need a restart:
      in the server window press <kbd>Ctrl</kbd> + <kbd>C</kbd>, run <b>npm.cmd start</b>, then refresh this page.</span></div>` : ''}

    <section class="hero">
      <div class="hero-main">
        <span class="hero-date">${icon('calendar')}${fmtLong(TODAY)}</span>
        <h2>${hello}, ${esc(LIBRARIAN.split(' ')[0])}</h2>
        <p>${summary}</p>
        <div class="hero-actions">
          <button class="hbtn primary" data-act="go-issue">${icon('arrowOut')}Issue a book</button>
          <button class="hbtn" data-act="go-return">${icon('arrowIn')}Return a book</button>
          <button class="hbtn" data-act="go-reserve">${icon('bookmark')}Reserve</button>
          <button class="hbtn" data-act="add-member">${icon('userPlus')}New member</button>
        </div>
      </div>
      <div class="hero-side">
        ${ring(st.utilisation, `${st.utilisation}% of copies are on loan`)}
        <div class="hero-facts">
          <div><b>${s.on_loan}</b><span>on loan</span></div>
          <div><b>${s.available}</b><span>on the shelf</span></div>
          <div><b>${borrowing}</b><span>members borrowing</span></div>
        </div>
      </div>
    </section>

    <div class="kpi2-grid">
      ${kpi({ label: 'Issued today', value: s.issued_today, ic: 'arrowOut', tone: 'tone-blue', target: 'loans', series: issuedSeries, color: 'var(--series-1)', foot: `${sum(issuedSeries)} in the last ${act.length} days` })}
      ${kpi({ label: 'Returned today', value: todayAct.returned, ic: 'arrowIn', tone: 'tone-green', target: 'loans', series: returnedSeries, color: 'var(--green-solid)', foot: `${sum(returnedSeries)} in the last ${act.length} days` })}
      ${kpi({ label: 'Overdue', value: s.overdue, ic: 'alert', tone: s.overdue ? 'tone-red' : 'tone-green', target: 'overdue', alert: s.overdue > 0, foot: s.overdue ? `<span class="t-red">${rupees(s.overdue_fines_accruing)}</span> in fines building up` : 'Every loan is on time' })}
      ${kpi({ label: 'Unpaid fines', value: rupees(s.unpaid_fines), ic: 'wallet', tone: s.unpaid_fines ? 'tone-amber' : 'tone-green', target: 'fines', foot: s.unpaid_fines ? `${plural(owing.length, 'member')} can't borrow until paid` : 'All fines settled' })}
    </div>

    <div class="bento">
      <div class="card b-8">
        <div class="card-head"><div><h2>Circulation</h2><p>Books issued and returned per day</p></div>
          <div class="right"><div class="chart-legend"><span><i style="background:var(--series-1)"></i>Issued</span><span><i style="background:var(--series-2)"></i>Returned</span></div>
          <div class="segmented seg-sm" id="range-seg">${[7, 14, 30].map((n) => `<button data-days="${n}" class="${ui.statsDays === n ? 'on' : ''}">${n}d</button>`).join('')}</div></div></div>
        <div class="chart-box" id="activity-chart"></div>
      </div>
      <div class="card b-4 health">
        <div class="card-head"><div><h2>Library health</h2><p>How well things are running</p></div></div>
        <div class="card-body health-list">
          ${healthRow('On-time returns', st.onTimeRate == null ? '—' : `${st.onTimeRate}%`, st.onTimeRate ?? 0, st.onTimeRate == null ? 'No returns yet' : `of returns in the last ${act.length} days`, st.onTimeRate != null && st.onTimeRate < 60 ? 'amber' : 'green')}
          ${healthRow('Copies in use', `${st.utilisation}%`, st.utilisation, `${s.on_loan} of ${s.copies} copies on loan`, 'indigo')}
          ${healthRow('Members borrowing', `${s.active_members ? Math.round((borrowing / s.active_members) * 100) : 0}%`, s.active_members ? (borrowing / s.active_members) * 100 : 0, `${borrowing} of ${s.active_members} active members`, 'blue')}
          <div class="health-foot"><div><span>Fines collected</span><b>${rupees(st.fines.collected_this_month)}</b><small>this month</small></div>
            <div><span>Waiting in queues</span><b>${s.pending_reservations}</b><small>members</small></div></div>
        </div>
      </div>

      <div class="card b-8">
        <div class="card-head b"><div><h2>Needs attention</h2><p>Follow up on these today</p></div>
          <div class="right tabs mini-tabs" id="attn-tabs">
            <button data-attn="overdue" class="${ui.attn === 'overdue' ? 'on' : ''}"><i class="dotc red"></i>Overdue <span class="tab-count">${attnCounts.overdue}</span></button>
            <button data-attn="due" class="${ui.attn === 'due' ? 'on' : ''}"><i class="dotc amber"></i>Due soon <span class="tab-count">${attnCounts.due}</span></button>
            <button data-attn="pickup" class="${ui.attn === 'pickup' ? 'on' : ''}"><i class="dotc green"></i>Pickup <span class="tab-count">${attnCounts.pickup}</span></button>
          </div></div>
        <div id="attn-body">${renderAttention(ui.attn, attnRows[ui.attn])}</div>
      </div>
      <div class="card b-4">
        <div class="card-head b"><div><h2>Today at the desk</h2><p>${plural(todayEvents.length, 'event')} so far</p></div><div class="right"><a class="btn sm ghost" href="#/activity">All activity${icon('chevRight')}</a></div></div>
        ${todayEvents.length ? `<ul class="feed compact">${todayEvents.slice(0, 6).map(feedItem).join('')}</ul>`
          : `${empty('activity', 'Quiet so far', 'Issues, returns and reservations made today will appear here.', 'sm')}${st.recent.length ? `<div class="card-foot"><span class="muted small">Last activity ${relDays(st.recent[0].date)}</span></div>` : ''}`}
      </div>

      <div class="card b-4">
        <div class="card-head"><div><h2>Most borrowed</h2><p>All-time favourites</p></div></div>
        ${st.topBooks.length ? `<div class="rows top-books">${st.topBooks.map((b, i) => `<div class="rowi clickable" data-row="book" data-id="${b.id}">
          <span class="rank ${i === 0 ? 'r1' : ''}">${i + 1}</span>${cover(b.title, 'sm')}
          <div class="grow"><b>${esc(b.title)}</b><div class="tb-bar"><i style="width:${(b.loans / maxTop) * 100}%"></i></div></div>
          <span class="muted small nowrap">${plural(b.loans, 'loan')}</span></div>`).join('')}</div>` : empty('book', 'No loans yet', '', 'sm')}
      </div>
      <div class="card b-4">
        <div class="card-head"><div><h2>Popular categories</h2><p>Loans by category</p></div></div>
        <div class="card-body">${categoryBars(st.categories)}</div>
      </div>
      <div class="card b-4">
        <div class="card-head"><div><h2>Reservation queues</h2><p>First come, first served</p></div><div class="right"><a class="btn sm ghost" href="#/reservations">Manage${icon('chevRight')}</a></div></div>
        ${pendingList(d.pendingReservations)}
      </div>
    </div>`;
  if (st.missing) $('#activity-chart').innerHTML = empty('activity', 'Chart unavailable', 'Restart the server to load analytics.', 'sm');
  else drawChartForRange();
};
function healthRow(label, value, pct, sub, tone) {
  return `<div class="health-row"><div class="hr-top"><span>${esc(label)}</span><b>${value}</b></div>
    <div class="meter ${tone}" role="img" aria-label="${esc(label)}: ${esc(value)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
    <small>${esc(sub)}</small></div>`;
}
// The chart can show 7 / 14 / 30 days; 14 days comes with the dashboard data, other ranges are fetched.
async function drawChartForRange() {
  const box = $('#activity-chart');
  if (!box) return;
  let data = state.stats?.activity || [];
  if (ui.statsDays !== data.length) {
    try { data = (await api('GET', `/api/stats?days=${ui.statsDays}`)).activity; } catch (err) { fail(err); }
  }
  state.chartData = data;
  drawActivityChart(box, data);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#range-seg button[data-days]');
  if (!b) return;
  ui.statsDays = Number(b.dataset.days);
  $$('#range-seg button').forEach((x) => x.classList.toggle('on', x === b));
  drawChartForRange();
});

function renderAttention(kind, rows) {
  if (kind === 'overdue') {
    return table([
      { label: 'Book', render: (r) => bookWho(r.title, `Due ${fmtShort(r.due_on)}`) },
      { label: 'Member', render: (r) => who(r.member_name, esc(r.phone || r.member_code)) },
      { label: 'Late', render: (r) => badge(plural(r.days_overdue, 'day'), 'red') },
      { label: 'Fine', cls: 'num', render: (r) => `<b>${rupees(r.accrued_fine)}</b>` },
      { label: '', cls: 'num', render: (r) => `<button class="btn sm" data-act="return" data-id="${r.id}">${icon('arrowIn')}Return</button>` },
    ], rows, empty('checkCircle', 'Nothing is overdue', 'Every book on loan is within its due date.', 'sm'));
  }
  if (kind === 'due') {
    return table([
      { label: 'Book', render: (r) => bookWho(r.title, esc(r.author)) },
      { label: 'Member', render: (r) => who(r.member_name, esc(r.phone || r.member_code)) },
      { label: 'Due', render: (r) => `${fmtShort(r.due_on)}<div class="sub">${relDays(r.due_on)}</div>` },
      { label: '', cls: 'num', render: (r) => `<div class="row-actions"><button class="btn sm" data-act="renew" data-id="${r.id}">${icon('renew')}Renew</button><button class="btn sm" data-act="return" data-id="${r.id}">Return</button></div>` },
    ], rows, empty('calendar', `Nothing due in the next ${RULES.DUE_SOON_DAYS} days`, '', 'sm'));
  }
  return rows.length ? `<div class="rows">${rows.map((r) => {
    const left = daysBetween(TODAY, r.hold_until);
    return `<div class="rowi">${cover(r.title)}<div class="grow"><b>${esc(r.title)}</b><span class="sub">for ${esc(r.member_name)} · ${esc(r.member_code)}</span>
      <div class="small countdown ${left <= 0 ? 'urgent' : ''}">${left <= 0 ? 'Last day to collect' : `Held until ${fmtShort(r.hold_until)} · ${plural(left, 'day')} left`}</div></div>
      <div class="row-actions"><button class="btn sm ghost" data-act="copy-msg" data-id="${r.id}" title="Copy pickup message">${icon('copy')}</button>
      <button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">${icon('arrowOut')}Issue</button></div></div>`;
  }).join('')}</div>` : empty('inbox', 'Nothing waiting at the desk', 'Copies returned for reservers appear here.', 'sm');
}

function pendingList(rows) {
  const byBook = groupBy(rows, (r) => r.book_id);
  if (!byBook.length) return empty('hourglass', 'No one is waiting', 'Reservations for unavailable books show up here.', 'sm');
  return `<div class="rows" style="padding-bottom:6px">${byBook.map(([bookId, rs]) => `<div class="rowi clickable" data-row="book" data-id="${bookId}">${cover(rs[0].title)}
    <div class="grow"><b>${esc(rs[0].title)}</b><span class="sub">${rs.map((r) => `${r.queue_position}. ${esc(r.member_name)}`).join(' · ')}</span>
    ${rs[0].next_due_on ? `<div class="small muted">Next copy due back ${fmtShort(rs[0].next_due_on)}</div>` : ''}</div>${badge(`${rs.length} waiting`, 'amber')}</div>`).join('')}</div>`;
}

function categoryBars(cats) {
  if (!cats.length) return empty('layers', 'No books yet', '', 'sm');
  const max = Math.max(1, ...cats.map((c) => c.loans));
  return `<div class="hbars">${cats.slice(0, 6).map((c) => `<div class="hbar" title="${esc(c.category)}: ${plural(c.loans, 'loan')}, ${plural(c.titles, 'title')}">
    <span class="lbl">${esc(c.category)}</span><span class="trk"><i style="width:${(c.loans / max) * 100}%"></i></span><span class="val">${c.loans}</span></div>`).join('')}</div>`;
}

const FEED = {
  issued: ['arrowOut', 'tone-indigo', (e) => `<b>${esc(e.member_name)}</b> borrowed <b>${esc(e.title)}</b>`],
  returned: ['arrowIn', 'tone-green', (e) => `<b>${esc(e.member_name)}</b> returned <b>${esc(e.title)}</b>${e.amount ? ` <span class="t-red">· ${rupees(e.amount)} late fine</span>` : ''}`],
  fine_paid: ['wallet', 'tone-violet', (e) => `<b>${esc(e.member_name)}</b> paid a <b>${rupees(e.amount)}</b> fine for ${esc(e.title)}`],
  reserved: ['bookmark', 'tone-amber', (e) => `<b>${esc(e.member_name)}</b> reserved <b>${esc(e.title)}</b>`],
  ready: ['inbox', 'tone-blue', (e) => `<b>${esc(e.title)}</b> is ready for pickup by <b>${esc(e.member_name)}</b>`],
  expired: ['clock', 'tone-red', (e) => `Hold on <b>${esc(e.title)}</b> expired — ${esc(e.member_name)} didn't collect`],
  cancelled: ['x', '', (e) => `Reservation of <b>${esc(e.title)}</b> by ${esc(e.member_name)} cancelled`],
};
function feedItem(e) {
  const [ic, tone, text] = FEED[e.type] || FEED.issued;
  return `<li><span class="f-ico ${tone || 'tone-indigo'}" data-icon="${ic}">${icon(ic)}</span><div class="f-body">${text(e)}</div><span class="f-time">${cap(relDays(e.date))}</span></li>`;
}

// Grouped bar chart (issued vs returned). Hand-built SVG, validated palette slots 1–2,
// 4px rounded data-ends on the baseline, 2px gap between paired bars, per-day hover tooltip.
function drawActivityChart(box, data) {
  if (!box) return;
  const W = Math.max(320, box.clientWidth - 44);
  const H = 250;
  const m = { t: 10, r: 4, b: 28, l: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const maxV = Math.max(1, ...data.flatMap((d) => [d.issued, d.returned]));
  const step = maxV <= 4 ? 1 : Math.ceil(maxV / 4);
  const top = Math.ceil(maxV / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const y = (v) => m.t + ph - (v / top) * ph;
  const band = pw / data.length;
  const bw = Math.max(3, Math.min(16, (band - 8) / 2 - 1));
  const labelEvery = Math.ceil(56 / band);
  const barPath = (x, v) => {
    if (!v) return '';
    const yy = y(v);
    const h = m.t + ph - yy;
    const r = Math.min(4, bw / 2, h);
    return `M${x},${m.t + ph}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${m.t + ph}Z`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Books issued and returned per day">`;
  svg += `<g class="axis">${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}</g>`;
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" rx="6"/>`;
    svg += `<path d="${barPath(cx - bw - 1, d.issued)}" fill="var(--series-1)" pointer-events="none"/>`;
    svg += `<path d="${barPath(cx + 1, d.returned)}" fill="var(--series-2)" pointer-events="none"/>`;
    if ((data.length - 1 - i) % labelEvery === 0) {
      svg += `<g class="axis"><text x="${cx}" y="${H - 8}" text-anchor="middle">${i === data.length - 1 ? 'Today' : fmtShort(d.date)}</text></g>`;
    }
  });
  svg += '</svg>';
  const tableHtml = `<table class="sr-table"><caption>Books issued and returned per day</caption><thead><tr><th>Date</th><th>Issued</th><th>Returned</th></tr></thead>
    <tbody>${data.map((d) => `<tr><td>${fmtDate(d.date)}</td><td>${d.issued}</td><td>${d.returned}</td></tr>`).join('')}</tbody></table>`;
  box.innerHTML = svg + tableHtml;
  const tip = $('#chart-tip');
  const svgEl = $('svg', box);
  svgEl.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hit');
    $$('.hit.hl', svgEl).forEach((h) => h !== hit && h.classList.remove('hl'));
    if (!hit) { tip.hidden = true; return; }
    hit.classList.add('hl');
    const d = data[Number(hit.dataset.i)];
    tip.innerHTML = `<div class="tt-h">${fmtLong(d.date)}</div>
      <div class="tt-r"><i style="background:var(--series-1)"></i>Issued<b>${d.issued}</b></div>
      <div class="tt-r"><i style="background:var(--series-2)"></i>Returned<b>${d.returned}</b></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 16 : e.clientX + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${e.clientY - 20}px`;
  });
  svgEl.addEventListener('mouseleave', () => { tip.hidden = true; $$('.hit.hl', svgEl).forEach((h) => h.classList.remove('hl')); });
}

// ===================================================================== activity page
const ACT_GROUPS = {
  all: { label: 'All', types: null },
  loans: { label: 'Loans', types: ['issued'] },
  returns: { label: 'Returns', types: ['returned'] },
  reservations: { label: 'Reservations', types: ['reserved', 'ready', 'expired', 'cancelled'] },
  fines: { label: 'Fines', types: ['fine_paid'] },
};
// kept as a list so the buttons stay in this order (objects put numeric keys first)
const ACT_RANGE_LIST = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const ACT_RANGES = Object.fromEntries(ACT_RANGE_LIST);
ui.actRange = '30';
ui.actLimit = 40;

renderers.activity = async () => {
  const el = $('#view-activity');
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `
      <div class="act-stats" id="act-stats"></div>
      <div class="card act-card">
        <div class="card-toolbar act-toolbar">
          <div class="search"><span data-icon="search"></span><input id="act-q" type="search" placeholder="Search by member or book…" data-slash></div>
          <div class="segmented" id="act-range">${ACT_RANGE_LIST.map(([k, l]) => `<button data-range="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="act-chips" id="act-chips"></div>
        <div id="act-timeline">${skeleton(320)}</div>
      </div>`;
    hydrateIcons(el);
    $('#act-q').addEventListener('input', () => { ui.actLimit = 40; drawActivity(); });
  }
  state.activityEvents = await api('GET', '/api/activity?limit=200');
  drawActivity();
};

function drawActivity() {
  const all = state.activityEvents || [];
  const q = ($('#act-q')?.value || '').trim().toLowerCase();
  const from = ui.actRange === 'all' ? '' : ui.actRange === 'today' ? TODAY : addDays(TODAY, -(Number(ui.actRange) - 1));
  const inRange = all.filter((e) => !from || e.date >= from);
  const matchQ = inRange.filter((e) => !q || `${e.member_name} ${e.title}`.toLowerCase().includes(q));
  const types = ACT_GROUPS[ui.actFilter]?.types;
  const shown = types ? matchQ.filter((e) => types.includes(e.type)) : matchQ;

  const count = (t) => inRange.filter((e) => t.includes(e.type)).length;
  const finesIn = inRange.filter((e) => e.type === 'fine_paid').reduce((t, e) => t + (e.amount || 0), 0);
  const lateReturns = inRange.filter((e) => e.type === 'returned' && e.amount > 0).length;
  const stat = (ic, tone, val, label, sub) => `<div class="act-stat"><span class="kpi-ico ${tone}">${icon(ic)}</span><div><b>${val}</b><span>${label}</span><small>${sub}</small></div></div>`;
  $('#act-stats').innerHTML = [
    stat('arrowOut', 'tone-blue', count(['issued']), 'books issued', ACT_RANGES[ui.actRange].toLowerCase()),
    stat('arrowIn', 'tone-green', count(['returned']), 'returns', `${plural(lateReturns, 'late return')}`),
    stat('bookmark', 'tone-amber', count(['reserved']), 'reservations', `${count(['ready'])} made ready for pickup`),
    stat('wallet', 'tone-violet', rupees(finesIn), 'fines collected', `${plural(count(['fine_paid']), 'payment')}`),
  ].join('');

  for (const b of $$('#act-range button')) b.classList.toggle('on', b.dataset.range === ui.actRange);
  $('#act-chips').innerHTML = Object.entries(ACT_GROUPS).map(([k, g]) => {
    const n = g.types ? matchQ.filter((e) => g.types.includes(e.type)).length : matchQ.length;
    return `<button class="chip ${ui.actFilter === k ? 'on' : ''}" data-actf="${k}">${g.label}<span class="chip-n">${n}</span></button>`;
  }).join('');

  if (!shown.length) {
    $('#act-timeline').innerHTML = empty('activity', q ? `Nothing matches “${q}”` : 'No activity in this period', q ? 'Try a different name or title.' : 'Try a longer time range.');
    return;
  }
  const visible = shown.slice(0, ui.actLimit);
  const days = groupBy(visible, (e) => e.date);
  const dayLabel = (date) => (date === TODAY ? 'Today' : date === addDays(TODAY, -1) ? 'Yesterday' : asDate(date).toLocaleDateString('en-IN', { weekday: 'long' }));
  const bookByTitle = new Map(state.books.map((b) => [b.title, b]));
  const memberByName = new Map(state.members.map((m) => [m.name, m]));
  $('#act-timeline').innerHTML = `<div class="tl">${days.map(([date, evs]) => {
    const dayAll = shown.filter((e) => e.date === date);
    const tally = Object.entries({ issued: 'issued', returned: 'returned', reserved: 'reserved', fine_paid: 'fines paid' })
      .map(([t, l]) => [dayAll.filter((e) => e.type === t).length, l]).filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(' · ');
    return `<section class="tl-day">
      <header class="tl-head"><div><b>${dayLabel(date)}</b><span>${fmtDate(date)}</span></div><small>${tally}</small></header>
      <ol class="tl-list">${evs.map((e) => {
        const [ic, tone, text] = FEED[e.type] || FEED.issued;
        const b = bookByTitle.get(e.title);
        const m = memberByName.get(e.member_name);
        return `<li class="tl-item t-${e.type}"><span class="tl-dot ${tone || 'tone-indigo'}">${icon(ic)}</span>
          <div class="tl-card">${cover(e.title, 'sm')}
            <div class="grow"><div class="tl-text">${text(e)}</div>
              <div class="tl-meta">${avatar(e.member_name, 'xs')}<span>${m ? esc(m.member_code) : 'Member'}</span>${b ? `<span>· ${esc(b.author)}</span><span class="tl-cat">${esc(b.category)}</span>` : ''}${e.amount && e.type !== 'fine_paid' ? `<span class="tl-fine">${rupees(e.amount)} fine</span>` : ''}</div></div>
            <div class="tl-actions">${m ? `<button class="btn xs ghost" data-act="view-member" data-id="${m.id}" title="Open member">${icon('user')}</button>` : ''}
              ${b ? `<button class="btn xs ghost" data-act="view-book" data-id="${b.id}" title="Open book">${icon('book')}</button>` : ''}</div>
          </div></li>`;
      }).join('')}</ol></section>`;
  }).join('')}</div>
  <div class="card-foot tl-foot"><span class="muted small">Showing ${visible.length} of ${plural(shown.length, 'event')}</span>
    ${shown.length > visible.length ? `<button class="btn sm" id="act-more">Show more${icon('chevRight')}</button>` : ''}</div>`;
  $('#act-more')?.addEventListener('click', () => { ui.actLimit += 40; drawActivity(); });
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('#act-range button[data-range]');
  if (r) { ui.actRange = r.dataset.range; ui.actLimit = 40; drawActivity(); return; }
  const c = e.target.closest('#act-chips [data-actf]');
  if (c) { ui.actFilter = c.dataset.actf; ui.actLimit = 40; drawActivity(); }
});

// ===================================================================== circulation: issue
function updateIssuePanel() {
  const m = pickers['pk-issue-member']?.item;
  const b = pickers['pk-issue-book']?.item;
  const f = $('#issue-form');
  $('#issue-member-card').innerHTML = m ? `<div class="sel-card">${avatar(m.name, 'lg')}<div class="grow"><b>${esc(m.name)}</b>
      <div class="sub">${esc(m.member_code)}${m.phone ? ` · ${esc(m.phone)}` : ''}${m.email ? ` · ${esc(m.email)}` : ''}</div>
      <div class="meta">${badge(`${dots(m.active_issues, RULES.MAX_ACTIVE_ISSUES)}${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES} books`, m.active_issues >= RULES.MAX_ACTIVE_ISSUES ? 'red' : '')}
      ${m.unpaid_fines ? badge(`Owes ${rupees(m.unpaid_fines)}`, 'red', true) : badge('No fines', 'green', true)}</div></div>
      <button type="button" class="btn sm" data-act="view-member" data-id="${m.id}">Profile</button></div>` : '';
  $('#issue-book-card').innerHTML = b ? `<div class="sel-card">${cover(b.title, 'lg')}<div class="grow"><b>${esc(b.title)}</b>
      <div class="sub">${esc(b.author)} · <span class="mono">${esc(b.isbn)}</span></div>
      <div class="meta">${availBadge(b)}${b.held_copies ? badge(`${b.held_copies} held`, 'blue') : ''}${badge(esc(b.category))}</div></div>
      <button type="button" class="btn sm" data-act="view-book" data-id="${b.id}">Details</button></div>` : '';

  const due = f?.dueOn.value;
  $('#issue-summary').innerHTML = `
    <div><span>Member</span><b>${m ? esc(m.name) : '—'}</b></div>
    <div><span>Book</span><b>${b ? esc(b.title) : '—'}</b></div>
    <div><span>Issue date</span><b>${f?.issuedOn.value ? fmtDate(f.issuedOn.value) : '—'}</b></div>
    <div><span>Due date</span><b>${due ? `${fmtDate(due)}` : '—'}</b></div>
    <div><span>Loan length</span><b>${due && f.issuedOn.value ? plural(daysBetween(f.issuedOn.value, due), 'day') : '—'}</b></div>`;

  const checks = [];
  let blocker = '';
  const add = (kind, text, extra = '') => {
    const ic = { ok: 'checkCircle', bad: 'xCircle', info: 'info', pending: 'clock' }[kind];
    checks.push(`<li class="${kind}">${icon(ic)}<span class="t">${text}</span>${extra}</li>`);
    if (kind === 'bad' && !blocker) blocker = text.replace(/<[^>]+>/g, '');
  };
  if (!m) add('pending', 'Select a member');
  else {
    add(m.active ? 'ok' : 'bad', m.active ? 'Membership is active' : 'Member is inactive');
    if (m.active && memberExpired(m)) add('bad', `Membership expired on ${fmtDate(m.valid_until)} — renew it first`, `<button type="button" class="btn xs" data-act="renew-membership" data-id="${m.id}">Renew</button>`);
    if (m.unpaid_fines) add('bad', `Unpaid fine of <b>${rupees(m.unpaid_fines)}</b> must be paid first`, `<button type="button" class="btn xs" data-act="pay" data-id="${m.id}">Collect</button>`);
    else add('ok', 'No unpaid fines');
    add(m.active_issues < RULES.MAX_ACTIVE_ISSUES ? 'ok' : 'bad', `Borrowing ${m.active_issues} of ${RULES.MAX_ACTIVE_ISSUES} allowed books`);
  }
  if (!b) add('pending', 'Select a book');
  else if (m) {
    if (state.loans.some((l) => l.member_id === m.id && l.book_id === b.id)) add('bad', 'Member already has a copy of this book');
    const open = state.reservations.filter((r) => r.book_id === b.id);
    const mine = open.find((r) => r.member_id === m.id);
    const waiting = open.filter((r) => r.status === 'waiting');
    if (mine?.status === 'ready') add('info', `A copy is <b>held for this member</b> until ${fmtDate(mine.hold_until)}`);
    else if (waiting.length) {
      const pos = waiting.findIndex((r) => r.member_id === m.id);
      add('bad', pos === 0
        ? 'First in the queue, but no copy has come back yet'
        : `Reserved: only <b>${esc(waiting[0].member_name)}</b> (first in queue) can borrow this${pos > 0 ? ` — this member is #${pos + 1}` : ''}`);
    } else if (b.available_copies > 0) add('ok', `${plural(b.available_copies, 'copy', 'copies')} on the shelf`);
    else add('bad', 'No copy available — place a reservation', '<button type="button" class="btn xs" data-act="reserve-this">Reserve</button>');
  } else add(b.available_copies > 0 ? 'ok' : 'bad', b.available_copies > 0 ? `${plural(b.available_copies, 'copy', 'copies')} on the shelf` : 'No copy on the shelf');

  $('#issue-checks').innerHTML = checks.join('');
  $('#issue-submit').disabled = !(m && b && !blocker);
  $('#issue-reason').textContent = m && b && blocker ? `Can't issue — ${blocker}` : '';
}

function setDue(days) {
  const f = $('#issue-form');
  if (!f.issuedOn.value) f.issuedOn.value = TODAY;
  f.dueOn.value = addDays(f.issuedOn.value, days);
  for (const c of $$('#due-chips .chip')) c.classList.toggle('on', Number(c.dataset.days) === days);
  updateIssuePanel();
}
function resetIssueForm(keepMember = false) {
  const f = $('#issue-form');
  f.issuedOn.value = TODAY; f.issuedOn.max = TODAY;
  f.dueOn.min = TODAY;
  setDue(RULES.LOAN_DAYS);
  if (!keepMember) pickers['pk-issue-member'].set(null, true);
  pickers['pk-issue-book'].set(null, true);
  updateIssuePanel();
}

async function submitIssue(e) {
  e.preventDefault();
  const f = e.target;
  const m = pickers['pk-issue-member'].item;
  const b = pickers['pk-issue-book'].item;
  if (!m || !b) return;
  $('#issue-submit').disabled = true;
  try {
    const r = await api('POST', '/api/issues', { memberId: m.id, bookId: b.id, issuedOn: f.issuedOn.value, dueOn: f.dueOn.value });
    resetIssueForm(true);
    await refreshAll();
    showIssued(r);
  } catch (err) { fail(err); updateIssuePanel(); }
}
function showIssued(r) {
  lastPrint = loanSlip(r);
  openModal({
    title: 'Book issued', sub: `${r.title} is now on loan to ${r.member_name}.`, ic: 'checkCircle', icTone: 'tone-green',
    ok: 'Done', hideCancel: true, extra: `<button type="button" class="btn" data-act="print-last">${icon('printer')}Print slip</button>`,
    body: `<div class="receipt">
      <div class="r-row"><span>Member</span><b>${esc(r.member_name)} · ${esc(r.member_code)}</b></div>
      <div class="r-row"><span>Book</span><b>${esc(r.title)}</b></div>
      <div class="r-row"><span>Issued on</span><b>${fmtDate(r.issued_on)}</b></div>
      <div class="r-row r-total"><span>Due back</span><b>${fmtDate(r.due_on)}</b></div></div>
      ${r.fromReservation ? `<div class="callout ok">${icon('bookmark')}<span>This copy was held for ${esc(r.member_name)}; the reservation is now complete.</span></div>` : ''}`,
  });
}
async function quickIssue(memberId, bookId) {
  try {
    const r = await api('POST', '/api/issues', { memberId, bookId });
    await refreshAll();
    showIssued(r);
  } catch (err) { fail(err); }
}

// ===================================================================== circulation: loans & returns
function renewBlock(l) {
  if (l.overdue) return 'Overdue — must be returned';
  if (l.renewals >= RULES.MAX_RENEWALS) return `Renewed ${RULES.MAX_RENEWALS}× (max)`;
  if (state.reservations.some((r) => r.book_id === l.book_id && r.status === 'waiting')) return 'Others are waiting for this book';
  const mem = state.members.find((m) => m.id === l.member_id);
  if (mem?.unpaid_fines) return 'Member has unpaid fines';
  if (addDays(TODAY, RULES.LOAN_DAYS) <= l.due_on) return 'Already due later than a renewal';
  return '';
}
function loanActions(l, compact = false) {
  const why = renewBlock(l);
  return `<div class="row-actions">
    <button class="btn sm" data-act="renew" data-id="${l.id}" ${why ? `disabled title="${esc(why)}"` : 'title="Extend by another loan period"'}>${icon('renew')}${compact ? '' : 'Renew'}</button>
    <button class="btn sm primary" data-act="return" data-id="${l.id}">${icon('arrowIn')}Return</button></div>`;
}

renderers.issue = async () => { updateIssuePanel(); };

renderers.returns = async () => {
  for (const b of $$('#loan-filter button')) b.classList.toggle('on', b.dataset.v === ui.loanFilter);
  const overdue = state.loans.filter((l) => l.overdue);
  const dueSoon = state.loans.filter((l) => !l.overdue && daysBetween(TODAY, l.due_on) <= RULES.DUE_SOON_DAYS);
  const stat = (n, label, tone, filter) => `<button class="rs ${ui.loanFilter === filter ? 'on' : ''}" data-v="${filter}"><b class="${tone}">${n}</b><span>${label}</span></button>`;
  $('#return-stats').innerHTML = `<div class="segmented-stats" id="loan-filter-stats">
    ${stat(state.loans.length, 'on loan', '', 'active')}${stat(overdue.length, 'overdue', overdue.length ? 't-red' : '', 'overdue')}
    ${stat(dueSoon.length, 'due soon', dueSoon.length ? 't-amber' : '', 'due-soon')}
    ${stat(rupees(overdue.reduce((t, l) => t + l.accrued_fine, 0)), 'fines accruing', overdue.length ? 't-red' : '', 'overdue')}</div>`;

  let rows;
  if (ui.loanFilter === 'active') rows = state.loans;
  else if (ui.loanFilter === 'due-soon') rows = state.loans.filter((l) => !l.overdue && daysBetween(TODAY, l.due_on) <= RULES.DUE_SOON_DAYS);
  else rows = await api('GET', `/api/issues?status=${ui.loanFilter}`);
  if (ui.loanFilter === 'returned' || ui.loanFilter === 'all') rows = rows.slice().sort((a, b) => (b.returned_on || '9').localeCompare(a.returned_on || '9') || b.id - a.id);
  const q = $('#loan-q').value.trim();
  const ql = q.toLowerCase();
  const shown = q ? rows.filter((r) => `${r.title} ${r.isbn} ${r.member_name} ${r.member_code}`.toLowerCase().includes(ql)) : rows;
  $('#loans-table').innerHTML = table([
    { label: 'Book', render: (r) => bookWho(r.title, `<span class="mono">${hl(r.isbn, q)}</span>`, q) },
    { label: 'Member', render: (r) => who(r.member_name, hl(r.member_code, q), q) },
    { label: 'Issued', render: (r) => fmtDate(r.issued_on) },
    { label: 'Due', render: (r) => `${fmtDate(r.due_on)}<div class="sub">${r.returned_on ? '' : relDays(r.due_on)}${r.renewals ? ` · renewed ${r.renewals}×` : ''}</div>` },
    { label: 'Status', render: (r) => (r.returned_on ? badge(`Returned ${fmtShort(r.returned_on)}`)
      : r.overdue ? badge(`${plural(r.days_overdue, 'day')} overdue`, 'red', true)
        : daysBetween(TODAY, r.due_on) <= RULES.DUE_SOON_DAYS ? badge('Due soon', 'amber', true) : badge('On time', 'green', true)) },
    { label: 'Fine', cls: 'num', render: (r) => (r.accrued_fine ? `<b>${rupees(r.accrued_fine)}</b><div class="sub">${r.returned_on ? (r.fine_paid ? 'paid' : 'unpaid') : 'accruing'}</div>` : '<span class="muted">—</span>') },
    { label: '', cls: 'num', render: (r) => (r.returned_on ? '' : loanActions(r)) },
  ], shown, q ? empty('search', 'No loans match your search', 'Try a member name, member ID, title or ISBN.') : empty('checkCircle', {
    overdue: 'Nothing is overdue', 'due-soon': 'Nothing is due soon', returned: 'No returns yet', active: 'No books on loan', all: 'No loans yet' }[ui.loanFilter]));
};

async function returnBook(issueId) {
  const issue = state.loans.find((r) => r.id === issueId) || (await api('GET', '/api/issues?status=active')).find((r) => r.id === issueId);
  if (!issue) { toast('That loan has already been returned.', 'warn'); return refreshAll(); }
  const queueFor = state.reservations.filter((r) => r.book_id === issue.book_id && r.status === 'waiting');
  const preview = (date) => {
    const late = Math.max(0, daysBetween(issue.due_on, date));
    return late
      ? `<div class="fine-box bad"><div class="small">Late fine</div><div class="amt">${rupees(late * RULES.FINE_PER_DAY)}</div>
         <div class="calc">${plural(late, 'day')} late × ₹${RULES.FINE_PER_DAY} per day — recorded against ${esc(issue.member_name)}</div></div>`
      : `<div class="fine-box ok"><div class="small">Returned on time</div><div class="amt">₹0</div><div class="calc">No fine</div></div>`;
  };
  openModal({
    title: 'Return book', sub: 'Confirm the return date. Any late fine is calculated automatically.', ok: 'Confirm return', ic: 'arrowIn', icTone: 'tone-green',
    body: `<div class="sel-card" style="margin:0">${cover(issue.title, 'lg')}<div class="grow"><b>${esc(issue.title)}</b>
        <div class="sub">Borrowed by ${esc(issue.member_name)} (${esc(issue.member_code)})</div>
        <div class="sub">Issued ${fmtDate(issue.issued_on)} · due ${fmtDate(issue.due_on)}</div></div></div>
      <label class="field">Return date<input type="date" name="returnedOn" required min="${issue.issued_on}" max="${TODAY}" value="${TODAY}"><small>Backdate if the book was left in the drop box earlier.</small></label>
      <div id="fine-preview">${preview(TODAY)}</div>
      ${queueFor.length ? `<div class="callout warn">${icon('bookmark')}<span>This copy will be <b>held for ${esc(queueFor[0].member_name)}</b>, first in the reservation queue, for ${RULES.HOLD_DAYS} days.</span></div>` : ''}`,
    onOpen: () => $('#modal-body [name=returnedOn]').addEventListener('input', (e) => { if (e.target.value) $('#fine-preview').innerHTML = preview(e.target.value); }),
    onSubmit: async (v) => {
      const r = await api('POST', `/api/issues/${issueId}/return`, { returnedOn: v.returnedOn });
      await refreshAll();
      showReturned(r);
      return true;
    },
  });
}
function showReturned(r) {
  lastPrint = returnReceipt(r);
  openModal({
    title: r.fine ? 'Returned late' : 'Returned on time', sub: `${r.title} is back from ${r.member_name}.`,
    ic: r.fine ? 'alert' : 'checkCircle', icTone: r.fine ? 'tone-amber' : 'tone-green', ok: 'Done', hideCancel: true,
    extra: `<button type="button" class="btn" data-act="print-last">${icon('printer')}Print receipt</button>
      ${r.fine ? `<button type="button" class="btn success" data-act="pay" data-id="${r.member_id}">${icon('wallet')}Collect fine now</button>` : ''}`,
    body: `<div class="receipt">
      <div class="r-row"><span>Due on</span><b>${fmtDate(r.due_on)}</b></div>
      <div class="r-row"><span>Returned on</span><b>${fmtDate(r.returned_on)}</b></div>
      <div class="r-row"><span>Days late</span><b>${r.daysLate}</b></div>
      <div class="r-row r-total"><span>Fine recorded</span><b class="${r.fine ? 't-red' : ''}">${rupees(r.fine)}</b></div></div>
      ${r.readyFor ? `<div class="callout info">${icon('inbox')}<span>Copy is now <b>held for ${esc(r.readyFor.memberName)}</b> (${esc(r.readyFor.memberCode)}) until ${fmtDate(r.readyFor.holdUntil)} and appears on “Ready for pickup”.</span></div>` : ''}`,
  });
}
async function renewLoan(issueId) {
  try {
    const r = await api('POST', `/api/issues/${issueId}/renew`);
    toast(`New due date ${fmtDate(r.due_on)} (was ${fmtDate(r.previousDue)}).`, 'ok', { title: `Renewed “${r.title}”` });
    await refreshAll();
  } catch (err) { fail(err); }
}

// ===================================================================== reservations
renderers.reservations = async () => {
  const f = ui.resFilter;
  const rows = f === 'open' ? state.reservations : await api('GET', `/api/reservations?status=${f}`);
  const seg = `<div class="segmented" id="res-filter">${[['open', 'Open'], ['ready', 'Ready'], ['waiting', 'Waiting'], ['closed', 'History']]
    .map(([v, l]) => `<button data-v="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let body;
  if (!rows.length) body = empty('bookmark', f === 'closed' ? 'No past reservations' : 'No reservations here', f === 'open' ? 'When a book has no copy on the shelf, reserve it above.' : '');
  else if (f === 'closed') {
    const label = { fulfilled: badge('Collected', 'green', true), cancelled: badge('Cancelled'), expired: badge('Expired', 'amber', true) };
    body = table([
      { label: 'Book', render: (r) => bookWho(r.title, `<span class="mono">${esc(r.isbn)}</span>`) },
      { label: 'Member', render: (r) => who(r.member_name, esc(r.member_code)) },
      { label: 'Reserved', render: (r) => fmtDate(r.reserved_on) },
      { label: 'Closed', render: (r) => fmtDate(r.closed_on) },
      { label: 'Outcome', render: (r) => label[r.status] },
    ], rows.slice().reverse(), '');
  } else {
    const books = new Map(state.books.map((b) => [b.id, b]));
    body = groupBy(rows, (r) => r.book_id).map(([bookId, rs]) => {
      const b = books.get(bookId);
      const ready = rs.filter((r) => r.status === 'ready');
      const waiting = rs.filter((r) => r.status === 'waiting');
      return `<div class="queue-card"><div class="queue-head">${cover(rs[0].title)}<div class="grow"><b>${esc(rs[0].title)}</b>
          <div class="sub">${b ? `${b.available_copies}/${b.total_copies} on shelf · ${b.issued_copies} on loan` : ''}${rs[0].next_due_on ? ` · next copy due back <b>${fmtShort(rs[0].next_due_on)}</b>` : ''}</div></div>
          ${ready.length ? badge(`${ready.length} ready`, 'green', true) : ''}${waiting.length ? badge(`${waiting.length} waiting`, 'amber', true) : ''}
          <button class="btn sm ghost" data-act="view-book" data-id="${bookId}">Details${icon('chevRight')}</button></div>
        <div class="queue">
          ${ready.map((r) => {
            const left = daysBetween(TODAY, r.hold_until);
            return `<div class="q-row ready"><span class="q-pos">${icon('check')}</span>${avatar(r.member_name, 'sm')}<div class="grow"><b>${esc(r.member_name)}</b>
              <div class="sub">Ready for pickup · held until ${fmtDate(r.hold_until)} · <span class="countdown ${left <= 0 ? 'urgent' : ''}">${left <= 0 ? 'last day' : `${plural(left, 'day')} left`}</span></div></div>
              <div class="row-actions"><button class="btn sm" data-act="copy-msg" data-id="${r.id}">${icon('copy')}Message</button>
              <button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">${icon('arrowOut')}Issue</button>
              <button class="btn sm danger-soft" data-act="cancel-res" data-id="${r.id}">Cancel</button></div></div>`;
          }).join('')}
          ${waiting.map((r, i) => `<div class="q-row ${i === 0 ? 'first' : ''}"><span class="q-pos">${r.queue_position}</span>${avatar(r.member_name, 'sm')}<div class="grow"><b>${esc(r.member_name)}</b>
            <div class="sub">${esc(r.member_code)} · waiting since ${fmtDate(r.reserved_on)}${i === 0 ? ' · <b>next in line</b>' : ''}</div></div>
            <button class="btn sm danger-soft" data-act="cancel-res" data-id="${r.id}">Cancel</button></div>`).join('')}
        </div></div>`;
    }).join('');
  }
  $('#res-body').innerHTML = `<div class="card"><div class="card-head b"><div><h2>Reservation queues</h2><p>First come, first served. A returned copy is held ${RULES.HOLD_DAYS} days for the first person in line.</p></div><div class="right">${seg}</div></div>${body}</div>`;
};
async function submitReserve(e) {
  e.preventDefault();
  const m = pickers['pk-res-member'].item;
  const b = pickers['pk-res-book'].item;
  if (!m) { toast('Choose a member first.', 'warn'); return pickers['pk-res-member'].focus(); }
  if (!b) { toast('Choose a book first.', 'warn'); return pickers['pk-res-book'].focus(); }
  try {
    const r = await api('POST', '/api/reservations', { memberId: m.id, bookId: b.id });
    toast(`${r.member_name} is #${r.queue_position} in the queue${r.next_due_on ? `. Next copy is due back ${fmtDate(r.next_due_on)}` : ''}.`, 'ok', { title: `Reserved “${r.title}”` });
    pickers['pk-res-book'].set(null, true);
    await refreshAll();
  } catch (err) { fail(err); }
}
function cancelReservation(resId) {
  const r = state.reservations.find((x) => x.id === resId);
  openModal({
    title: 'Cancel reservation?', sub: r ? `${r.member_name} · ${r.title}` : '', ok: 'Cancel reservation', cancel: 'Keep it', tone: 'danger', ic: 'bookmark', icTone: 'tone-red',
    body: `<p class="muted">${r?.status === 'ready' ? 'The held copy passes to the next person in the queue, or back to the shelf if nobody is waiting.' : 'The member loses their place in the queue.'}</p>`,
    onSubmit: async () => {
      const res = await api('POST', `/api/reservations/${resId}/cancel`);
      toast(res.readyFor ? `The copy is now held for ${res.readyFor.memberName}.` : 'The member was removed from the queue.', 'ok', { title: 'Reservation cancelled' });
      await refreshAll();
    },
  });
}
async function copyPickupMessage(resId) {
  const r = state.reservations.find((x) => x.id === resId) || state.dash.readyForPickup.find((x) => x.id === resId);
  if (!r) return;
  const text = `Hi ${r.member_name.split(' ')[0]}, your reserved book "${r.title}" is ready for pickup at the library. We'll hold it for you until ${fmtDate(r.hold_until)}.`;
  try { await navigator.clipboard.writeText(text); toast(text, 'ok', { title: 'Pickup message copied' }); } catch { openModal({ title: 'Pickup message', ok: 'Done', hideCancel: true, body: `<textarea rows="4" readonly>${esc(text)}</textarea>` }); }
}

// ===================================================================== fines
renderers.fines = async () => {
  const el = $('#view-fines');
  const data = await api('GET', `/api/fines?status=${ui.fineFilter}`);
  const t = data.totals;
  const kpi = (label, val, ic, tone, foot) => `<div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ico ${tone}">${icon(ic)}</span></div><div class="kpi-val">${val}</div><div class="kpi-foot">${foot}</div></div>`;
  const owing = groupBy(data.rows.filter((r) => !r.fine_paid), (r) => r.member_id);
  el.innerHTML = `
    <div class="kpis">
      ${kpi('Outstanding', rupees(t.outstanding), 'alertCircle', t.outstanding ? 'tone-red' : 'tone-green', t.outstanding ? 'blocking new issues' : 'nothing owed')}
      ${kpi('Members owing', t.members_owing, 'users', 'tone-amber', 'must pay before borrowing')}
      ${kpi('Collected this month', rupees(t.collected_this_month), 'wallet', 'tone-green', asDate(TODAY).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }))}
      ${kpi('Collected all-time', rupees(t.collected), 'trend', 'tone-indigo', `at ₹${RULES.FINE_PER_DAY} per late day`)}
    </div>
    <div class="card">
      <div class="card-toolbar"><div class="segmented" id="fine-filter">
        ${[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([v, l]) => `<button data-v="${v}" class="${ui.fineFilter === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="spacer"></span><span class="result-count">${plural(data.rows.length, 'fine')}${ui.fineFilter === 'unpaid' && owing.length ? ` · ${plural(owing.length, 'member')}` : ''}</span></div>
      ${table([
        { label: 'Member', render: (r) => who(r.member_name, esc(r.member_code)) },
        { label: 'Book', render: (r) => bookWho(r.title, `Due ${fmtShort(r.due_on)}`) },
        { label: 'Returned', render: (r) => `${fmtDate(r.returned_on)}<div class="sub">${plural(daysBetween(r.due_on, r.returned_on), 'day')} late</div>` },
        { label: 'Amount', cls: 'num', render: (r) => `<b>${rupees(r.fine)}</b>` },
        { label: 'Status', render: (r) => (r.fine_paid ? `${badge('Paid', 'green', true)}<div class="sub">${fmtDate(r.paid_on)}</div>` : badge('Unpaid', 'red', true)) },
        { label: '', cls: 'num', render: (r) => (r.fine_paid ? '' : `<button class="btn sm success" data-act="pay" data-id="${r.member_id}">${icon('wallet')}Collect</button>`) },
      ], data.rows, empty(ui.fineFilter === 'unpaid' ? 'checkCircle' : 'wallet', ui.fineFilter === 'unpaid' ? 'No unpaid fines' : 'No fines recorded', ui.fineFilter === 'unpaid' ? 'Every member is clear to borrow.' : ''), (r) => `class="clickable" data-row="member" data-id="${r.member_id}"`)}
    </div>`;
};
function payFine(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  if (!m) return;
  if (!m.unpaid_fines) { toast(`${m.name} has no unpaid fines.`, 'info'); return; }
  openModal({
    title: 'Collect fine', sub: 'Mark all of this member’s unpaid fines as paid.', ok: `Collect ${rupees(m.unpaid_fines)}`, tone: 'success', ic: 'wallet', icTone: 'tone-green',
    body: `<div class="sel-card" style="margin:0">${avatar(m.name, 'lg')}<div class="grow"><b>${esc(m.name)}</b><div class="sub">${esc(m.member_code)}</div></div>
      <div style="text-align:right"><div class="sub">Amount due</div><div class="kpi-val t-red">${rupees(m.unpaid_fines)}</div></div></div>
      <div class="callout info">${icon('info')}<span>Once paid, ${esc(m.name.split(' ')[0])} can borrow books again.</span></div>`,
    onSubmit: async () => {
      const r = await api('POST', `/api/members/${memberId}/pay-fine`);
      toast(`${r.member.name} can borrow again.`, 'ok', { title: `${rupees(r.paid)} collected` });
      await refreshAll();
    },
  });
}

// ===================================================================== books
let bookReq = 0;
renderers.books = async () => {
  for (const b of $$('#book-field button')) b.classList.toggle('on', b.dataset.v === ui.bookField);
  for (const b of $$('#book-view button')) b.classList.toggle('on', b.dataset.v === ui.bookView);
  const cats = [...new Set(state.books.map((b) => b.category))].sort();
  const catSel = $('#book-cat');
  const cur = catSel.value;
  catSel.innerHTML = `<option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${state.books.filter((b) => b.category === c).length})</option>`).join('')}`;
  catSel.value = cats.includes(cur) ? cur : '';

  const q = $('#book-q').value.trim();
  const qs = new URLSearchParams({ q, field: ui.bookField, ...($('#book-avail').checked ? { available: '1' } : {}) });
  const req = ++bookReq;
  let books = await api('GET', `/api/books?${qs}`);
  if (req !== bookReq) return; // a newer search superseded this one
  if (catSel.value) books = books.filter((b) => b.category === catSel.value);
  const sorters = {
    title: (a, b) => a.title.localeCompare(b.title),
    author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
    avail: (a, b) => b.available_copies - a.available_copies || a.title.localeCompare(b.title),
    demand: (a, b) => (b.queue_length + b.issued_copies) - (a.queue_length + a.issued_copies) || a.title.localeCompare(b.title),
    recent: (a, b) => b.id - a.id,
  };
  books.sort(sorters[$('#book-sort').value] || sorters.title);
  $('#book-count').textContent = plural(books.length, 'book');
  const { slice, foot } = paginate(books, 'bookPage');
  const emptyHtml = q || catSel.value || $('#book-avail').checked
    ? empty('search', 'No books match your filters', 'Try another search term or clear the filters.')
    : empty('book', 'No books yet', 'Add a book or import a CSV to build your catalogue.');
  if (ui.bookView === 'grid') {
    $('#books-body').innerHTML = slice.length ? `<div class="book-grid">${slice.map((b) => `<div class="bcard" data-row="book" data-id="${b.id}" tabindex="0">
      ${cover(b.title, 'xl')}<div><b>${hl(b.title, q)}</b><span class="sub">${hl(b.author, q)}</span></div>
      <div class="bfoot">${availBadge(b)}<span class="muted small">${b.available_copies}/${b.total_copies}</span></div></div>`).join('')}</div>${foot}` : emptyHtml;
    return;
  }
  $('#books-body').innerHTML = table([
    { label: 'Title', render: (b) => bookWho(b.title, hl(b.author, q), q) },
    { label: 'ISBN', render: (b) => `<span class="mono">${hl(b.isbn, q.replace(/[\s-]/g, ''))}</span>` },
    { label: 'Category', render: (b) => `${badge(hl(b.category, q))}${b.shelf ? `<div class="sub">Shelf ${esc(b.shelf)}</div>` : ''}` },
    { label: 'Availability', render: (b) => availBar(b) },
    { label: 'Status', render: (b) => availBadge(b) },
    { label: '', cls: 'num', render: (b) => `<div class="row-actions">
        ${b.available_copies > 0 || b.held_copies
          ? `<button class="btn sm" data-act="issue-book" data-book="${b.id}">${icon('arrowOut')}Issue</button>`
          : `<button class="btn sm" data-act="reserve-book" data-book="${b.id}">${icon('bookmark')}Reserve</button>`}
        <button class="btn sm icon" data-act="edit-book" data-id="${b.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>
        <button class="btn sm icon danger-soft" data-act="delete-book" data-id="${b.id}" title="Delete" aria-label="Delete">${icon('trash')}</button></div>` },
  ], slice, emptyHtml, (b) => `class="clickable" data-row="book" data-id="${b.id}"`) + (slice.length ? foot : '');
};
function availBar(b) {
  const t = b.total_copies || 1;
  const seg = (cls, n) => (n ? `<i class="${cls}" style="width:${(n / t) * 100}%"></i>` : '');
  return `<div class="avail"><div class="avail-top">${b.available_copies} of ${b.total_copies} on shelf</div>
    <div class="bar" title="${b.available_copies} available · ${b.held_copies} held · ${b.issued_copies} on loan">${seg('a', b.available_copies)}${seg('h', b.held_copies)}${seg('o', b.issued_copies)}</div>
    <div class="sub" style="margin-top:4px">${b.issued_copies} on loan${b.held_copies ? ` · ${b.held_copies} held` : ''}${b.queue_length ? ` · ${b.queue_length} waiting` : ''}</div></div>`;
}

function bookForm(b = {}) {
  const cats = [...new Set(state.books.map((x) => x.category))].sort();
  const min = b.id ? Math.max(1, b.issued_copies + b.held_copies) : 1;
  return `
    <label class="field">Title <input name="title" required maxlength="200" value="${esc(b.title)}" placeholder="e.g. The Hobbit"></label>
    <label class="field">Author <input name="author" required maxlength="200" value="${esc(b.author)}" placeholder="e.g. J.R.R. Tolkien"></label>
    <div class="row2">
      <label class="field">ISBN <input name="isbn" required value="${esc(b.isbn)}" placeholder="10 or 13 digits" inputmode="numeric"><small>Hyphens and spaces are ignored</small></label>
      <label class="field">Category <input name="category" list="cat-list" maxlength="80" placeholder="General" value="${esc(b.category)}"></label>
    </div>
    <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="row3">
      <label class="field">Publisher <input name="publisher" maxlength="120" value="${esc(b.publisher)}" placeholder="optional"></label>
      <label class="field">Year <input name="year" type="number" min="1000" max="2100" step="1" value="${esc(b.year ?? '')}" placeholder="e.g. 2019"></label>
      <label class="field">Shelf / rack <input name="shelf" maxlength="30" value="${esc(b.shelf)}" placeholder="e.g. A-3"></label>
    </div>
    <label class="field">Total copies <input name="total_copies" type="number" min="${min}" step="1" required value="${esc(b.total_copies ?? 1)}">
      ${b.id ? `<small>${b.issued_copies} on loan and ${b.held_copies} held for pickup, so the minimum is ${min}. Available copies update automatically; extra copies go to the reservation queue first.</small>` : '<small>All copies start on the shelf.</small>'}</label>`;
}
function addBook() {
  openModal({
    title: 'Add a book', sub: 'Add a new title to the catalogue.', ok: 'Add book', ic: 'book', body: bookForm(),
    onSubmit: async (v) => { const b = await api('POST', '/api/books', { ...v, total_copies: Number(v.total_copies) }); toast(`${plural(b.total_copies, 'copy', 'copies')} on the shelf.`, 'ok', { title: `Added “${b.title}”` }); await refreshAll(); },
  });
}
async function editBook(bookId) {
  const b = await api('GET', `/api/books/${bookId}`);
  openModal({
    title: 'Edit book', sub: b.title, ic: 'edit', body: bookForm(b), ok: 'Save changes',
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/books/${bookId}`, { ...v, total_copies: Number(v.total_copies) });
      toast('Your changes were saved.', 'ok', { title: `Updated “${r.title}”` });
      for (const p of r.promoted || []) toast(`A new copy is held for ${p.memberName}.`, 'info', { title: 'Ready for pickup' });
      await refreshAll();
    },
  });
}
function deleteBook(bookId) {
  const b = state.books.find((x) => x.id === bookId);
  if (!b) return;
  const blocked = b.issued_copies > 0 || b.held_copies > 0 || b.queue_length > 0;
  openModal({
    title: 'Delete this book?', sub: 'This removes the title from the catalogue.', ok: 'Delete book', tone: 'danger', ic: 'trash', icTone: 'tone-red',
    body: `<div class="sel-card" style="margin:0">${cover(b.title)}<div class="grow"><b>${esc(b.title)}</b><div class="sub">${esc(b.author)}</div></div></div>
      ${blocked ? `<div class="callout warn">${icon('alert')}<span>${b.issued_copies ? `${plural(b.issued_copies, 'copy is', 'copies are')} on loan` : 'This book has open reservations'} — the library will refuse the delete and tell you why.</span></div>`
        : `<div class="callout">${icon('info')}<span>Past loans and fines stay in the records.</span></div>`}`,
    onSubmit: async () => { await api('DELETE', `/api/books/${bookId}`); toast('Loan history is kept.', 'ok', { title: `Deleted “${b.title}”` }); closeDrawer(); await refreshAll(); },
  });
}

// CSV import with a preview before anything is written.
function parseCsvClient(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
async function importCsv(file) {
  const csv = await file.text();
  const rows = parseCsvClient(csv);
  if (rows.length < 2) { toast('The file needs a header row and at least one book.', 'error', { title: 'Nothing to import' }); return; }
  const [header, ...data] = rows;
  openModal({
    title: 'Import books', sub: `${file.name} · ${plural(data.length, 'row')}`, ic: 'upload', ok: `Import ${plural(data.length, 'book')}`, wide: true,
    body: `<div class="preview-table"><table><thead><tr><th>#</th>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${data.slice(0, 50).map((r, i) => `<tr><td class="muted">${i + 2}</td>${header.map((_, c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${data.length > 50 ? `<p class="muted small">Showing the first 50 of ${data.length} rows.</p>` : ''}
      <div class="callout info">${icon('info')}<span>Each row is checked separately. Rows with missing fields, invalid ISBNs or duplicate ISBNs are skipped and listed afterwards.</span></div>`,
    onSubmit: async () => {
      const r = await api('POST', '/api/books/import', { csv });
      await refreshAll();
      const skipped = r.skipped.length;
      openModal({
        title: 'Import finished', ok: 'Done', hideCancel: true, ic: skipped ? 'alert' : 'checkCircle', icTone: skipped ? 'tone-amber' : 'tone-green', wide: skipped > 0,
        sub: `${plural(r.imported, 'book')} imported${skipped ? `, ${plural(skipped, 'row')} skipped` : ''}.`,
        body: skipped ? `<div class="preview-table"><table><thead><tr><th>Line</th><th>Why it was skipped</th></tr></thead><tbody>
          ${r.skipped.map((s) => `<tr><td class="num">${s.line}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="callout ok">${icon('checkCircle')}<span>All rows were imported successfully.</span></div>`,
      });
      return true;
    },
  });
}

async function bookDrawer(bookId) {
  const { book: b, issues } = await api('GET', `/api/books/${bookId}/history`);
  const loans = issues.filter((l) => !l.returned_on);
  const past = issues.filter((l) => l.returned_on);
  const res = state.reservations.filter((r) => r.book_id === b.id);
  const nextDue = loans.map((l) => l.due_on).sort()[0];
  return `
    <div class="d-hero"><div class="d-head">${cover(b.title, 'lg')}<div><h2>${esc(b.title)}</h2><div class="sub">by ${esc(b.author)}</div>
      <div class="badges">${availBadge(b)}${badge(esc(b.category))}</div></div></div>
      <div class="d-stats">
        <div class="d-stat"><div class="v">${b.available_copies}<span class="muted" style="font-size:14px"> / ${b.total_copies}</span></div><div class="l">on the shelf</div></div>
        <div class="d-stat"><div class="v">${b.issued_copies}</div><div class="l">on loan</div></div>
        <div class="d-stat"><div class="v">${issues.length}</div><div class="l">total loans</div></div>
      </div>
      <div class="d-actions">
        ${b.available_copies > 0 || b.held_copies ? actBtn('issue-book', 'arrowOut', 'Issue', 'primary', `data-book="${b.id}"`) : actBtn('reserve-book', 'bookmark', 'Reserve', 'primary', `data-book="${b.id}"`)}
        ${actBtn('edit-book', 'edit', 'Edit', '', `data-id="${b.id}"`)}
        ${actBtn('delete-book', 'trash', 'Delete', 'danger-soft', `data-id="${b.id}"`)}
      </div></div>
    <div class="d-body">
      <div class="d-sec"><h3>Details</h3><dl class="kv"><dt>ISBN</dt><dd class="mono">${esc(b.isbn)}</dd><dt>Category</dt><dd>${esc(b.category)}</dd>
        ${b.publisher ? `<dt>Publisher</dt><dd>${esc(b.publisher)}${b.year ? `, ${b.year}` : ''}</dd>` : b.year ? `<dt>Year</dt><dd>${b.year}</dd>` : ''}
        ${b.shelf ? `<dt>Shelf</dt><dd><span class="badge">${esc(b.shelf)}</span></dd>` : ''}
        <dt>Copies</dt><dd>${b.total_copies} total · ${b.available_copies} available · ${b.held_copies} held · ${b.issued_copies} on loan</dd>
        ${nextDue ? `<dt>Next due back</dt><dd>${fmtDate(nextDue)} (${relDays(nextDue)})</dd>` : ''}</dl></div>
      <div class="d-sec"><h3>Barcode label</h3><div class="label-preview">${window.Barcode ? Barcode.ean13(b.isbn, { height: 46, module: 1.6 }) : ''}
        <button class="btn sm" data-act="print-label" data-id="${b.id}">${icon('printer')}Print label</button></div></div>
      <div class="d-sec"><h3>On loan to ${badge(loans.length)}</h3>${loans.length ? `<div class="d-list">${loans.map((l) => `<div class="d-item">${avatar(l.member_name, 'sm')}<div class="grow"><b>${esc(l.member_name)}</b>
        <div class="sub">Due ${fmtDate(l.due_on)} · ${l.overdue ? `<span class="t-red">${plural(l.days_overdue, 'day')} overdue</span>` : relDays(l.due_on)}</div></div>${loanActions(l, true)}</div>`).join('')}</div>` : '<p class="muted small">Nobody has this book right now.</p>'}</div>
      <div class="d-sec"><h3>Reservation queue ${badge(res.length)}</h3>${res.length ? `<div class="queue">${res.map((r) => `<div class="q-row ${r.status === 'ready' ? 'ready' : ''}">
        <span class="q-pos">${r.status === 'ready' ? icon('check') : r.queue_position}</span><div class="grow"><b>${esc(r.member_name)}</b>
        <div class="sub">${r.status === 'ready' ? `Ready · held until ${fmtDate(r.hold_until)}` : `Waiting since ${fmtDate(r.reserved_on)}`}</div></div></div>`).join('')}</div>` : '<p class="muted small">No one is waiting.</p>'}</div>
      <div class="d-sec"><h3>Loan history ${badge(past.length)}</h3>${past.length ? `<div class="d-list">${past.slice(0, 12).map((l) => `<div class="d-item">${avatar(l.member_name, 'sm')}<div class="grow"><b>${esc(l.member_name)}</b>
        <div class="sub">${fmtShort(l.issued_on)} → ${fmtShort(l.returned_on)}</div></div>${l.fine ? badge(`${rupees(l.fine)} fine`, l.fine_paid ? '' : 'red') : badge('On time', 'green')}</div>`).join('')}</div>` : '<p class="muted small">No past loans.</p>'}</div>
    </div>`;
}

// ===================================================================== members
renderers.members = async () => {
  for (const b of $$('#member-filter button')) b.classList.toggle('on', b.dataset.v === ui.memberFilter);
  const q = $('#member-q').value.trim();
  const ql = q.toLowerCase();
  const f = ui.memberFilter;
  const rows = state.members.filter((m) => (!q || memberText(m).toLowerCase().includes(ql))
    && (f === 'all' || (f === 'active' && m.active && !memberExpired(m)) || (f === 'inactive' && !m.active) || (f === 'expired' && m.active && memberExpired(m)) || (f === 'fines' && m.unpaid_fines > 0) || (f === 'borrowing' && m.active_issues > 0)));
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    recent: (a, b) => b.join_date.localeCompare(a.join_date) || b.id - a.id,
    books: (a, b) => b.active_issues - a.active_issues || a.name.localeCompare(b.name),
    fines: (a, b) => b.unpaid_fines - a.unpaid_fines || a.name.localeCompare(b.name),
  };
  rows.sort(sorters[$('#member-sort').value] || sorters.name);
  $('#member-count').textContent = plural(rows.length, 'member');
  const { slice, foot } = paginate(rows, 'memberPage');
  $('#members-body').innerHTML = table([
    { label: 'Member', render: (m) => who(m.name, `<span class="mono">${hl(m.member_code, q)}</span>`, q) },
    { label: 'Contact', render: (m) => `${m.phone ? hl(m.phone, q) : '<span class="muted">—</span>'}<div class="sub">${hl(m.email, q)}</div>` },
    { label: 'Member since', render: (m) => fmtDate(m.join_date) },
    { label: 'Status', render: (m) => `${membershipBadge(m)}<div class="sub">${esc(m.membership_type || 'General')}${m.valid_until ? ` · until ${fmtShort(m.valid_until)}` : ''}</div>` },
    { label: 'Books', render: (m) => `${dots(m.active_issues, RULES.MAX_ACTIVE_ISSUES)}<span class="muted small">${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES}</span>` },
    { label: 'Fines', cls: 'num', render: (m) => (m.unpaid_fines ? badge(rupees(m.unpaid_fines), 'red') : '<span class="muted">—</span>') },
    { label: '', cls: 'num', render: (m) => `<div class="row-actions">${m.unpaid_fines ? `<button class="btn sm success" data-act="pay" data-id="${m.id}">Collect</button>` : ''}
        <button class="btn sm icon" data-act="edit-member" data-id="${m.id}" title="Edit" aria-label="Edit">${icon('edit')}</button></div>` },
  ], slice, q || f !== 'all' ? empty('search', 'No members match', 'Try another search or filter.') : empty('users', 'No members yet', 'Add your first member to start lending.'),
  (m) => `class="clickable" data-row="member" data-id="${m.id}"`) + (slice.length ? foot : '');
};

function memberForm(m = {}) {
  return `
    <label class="field">Full name <input name="name" required maxlength="120" value="${esc(m.name)}" placeholder="e.g. Asha Rao"></label>
    <div class="row2">
      <label class="field">Member ID <input name="member_code" maxlength="30" placeholder="Auto-generated" value="${esc(m.member_code)}"><small>Leave blank to generate one (M0001…)</small></label>
      <label class="field">Join date <input name="join_date" type="date" max="${TODAY}" value="${esc(m.join_date || TODAY)}"></label>
    </div>
    <div class="row2">
      <label class="field">Phone <input name="phone" type="tel" placeholder="98765 43210" value="${esc(m.phone)}"></label>
      <label class="field">Email <input name="email" type="email" placeholder="name@example.com" value="${esc(m.email)}"></label>
    </div>
    <div class="row2">
      <label class="field">Membership plan <select name="membership_type">${['General', 'Student', 'Faculty', 'Senior'].map((t) => `<option ${(m.membership_type || 'General') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Valid until <input name="valid_until" type="date" value="${esc(m.valid_until || (m.id ? '' : addDays(TODAY, 365)))}"><small>Leave empty for no expiry. Expired members can't borrow.</small></label>
    </div>
    <label class="switch"><input type="checkbox" name="active" ${m.active === 0 ? '' : 'checked'}><span class="track"></span>Active member — can borrow and reserve</label>
    ${m.id && m.open_reservations ? `<div class="callout warn">${icon('alert')}<span>Making this member inactive cancels their ${plural(m.open_reservations, 'open reservation')} and passes any held copy to the next person in the queue.</span></div>` : ''}`;
}
function addMember() {
  openModal({
    title: 'Add member', sub: 'Register a new library member.', ok: 'Add member', ic: 'userPlus', body: memberForm(),
    onSubmit: async (v) => {
      const m = await api('POST', '/api/members', { ...v, active: !!v.active });
      toast(`Member ID ${m.member_code}.`, 'ok', { title: `Welcome, ${m.name}`, action: { label: 'Print library card', run: () => printDoc(memberCard(m)) } });
      await refreshAll();
    },
  });
}
function editMember(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  openModal({
    title: 'Edit member', sub: `${m.name} · ${m.member_code}`, ic: 'edit', body: memberForm(m), ok: 'Save changes',
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/members/${memberId}`, { ...v, active: !!v.active });
      toast(r.cancelledReservations ? `${plural(r.cancelledReservations, 'reservation')} cancelled.` : 'Your changes were saved.', 'ok', { title: `Updated ${r.name}` });
      await refreshAll();
    },
  });
}
async function memberDrawer(memberId) {
  const d = await api('GET', `/api/members/${memberId}`);
  const m = d.member;
  const totalLoans = d.activeIssues.length + d.history.length;
  const finesPaid = d.history.filter((l) => l.fine && l.fine_paid).reduce((t, l) => t + l.fine, 0);
  const onTime = d.history.length ? Math.round((d.history.filter((l) => !l.fine).length / d.history.length) * 100) : null;
  return `
    <div class="d-hero"><div class="d-head">${avatar(m.name, 'lg')}<div><h2>${esc(m.name)}</h2><div class="sub mono">${esc(m.member_code)}</div>
      <div class="badges">${membershipBadge(m)}${badge(esc(m.membership_type || 'General'), 'indigo')}${m.unpaid_fines ? badge(`Owes ${rupees(m.unpaid_fines)}`, 'red') : ''}</div></div></div>
      <div class="d-stats">
        <div class="d-stat"><div class="v">${m.active_issues}<span class="muted" style="font-size:14px"> / ${RULES.MAX_ACTIVE_ISSUES}</span></div><div class="l">books on loan</div></div>
        <div class="d-stat"><div class="v">${totalLoans}</div><div class="l">total loans</div></div>
        <div class="d-stat"><div class="v">${onTime == null ? '—' : `${onTime}%`}</div><div class="l">returned on time</div></div>
      </div>
      <div class="d-actions">
        ${m.active ? actBtn('issue-to', 'arrowOut', 'Issue a book', 'primary', `data-id="${m.id}"`) : ''}
        ${m.unpaid_fines ? actBtn('pay', 'wallet', `Collect ${rupees(m.unpaid_fines)}`, 'success', `data-id="${m.id}"`) : ''}
        ${actBtn('edit-member', 'edit', 'Edit', '', `data-id="${m.id}"`)}
        ${actBtn('renew-membership', 'renew', memberExpired(m) ? 'Renew membership' : 'Extend membership', memberExpired(m) ? 'primary' : '', `data-id="${m.id}"`)}
        ${actBtn('print-card', 'idCard', 'Library card', '', `data-id="${m.id}"`)}
      </div></div>
    <div class="d-body">
      <div class="d-sec"><h3>Contact</h3><dl class="kv"><dt>Phone</dt><dd>${esc(m.phone) || '—'}</dd><dt>Email</dt><dd>${esc(m.email) || '—'}</dd>
        <dt>Member since</dt><dd>${fmtDate(m.join_date)}</dd><dt>Membership</dt><dd>${esc(m.membership_type || 'General')} · ${m.valid_until ? `${memberExpired(m) ? '<span class="t-red">expired</span> ' : 'valid until '}${fmtDate(m.valid_until)}` : 'no expiry'}</dd><dt>Fines paid</dt><dd>${rupees(finesPaid)}</dd></dl></div>
      <div class="d-sec"><h3>On loan ${badge(d.activeIssues.length)}</h3>${d.activeIssues.length ? `<div class="d-list">${d.activeIssues.map((l) => `<div class="d-item">${cover(l.title, 'sm')}<div class="grow"><b>${esc(l.title)}</b>
        <div class="sub">Due ${fmtDate(l.due_on)} · ${l.overdue ? `<span class="t-red">${plural(l.days_overdue, 'day')} late · ${rupees(l.accrued_fine)}</span>` : relDays(l.due_on)}</div></div>${loanActions(l, true)}</div>`).join('')}</div>` : '<p class="muted small">No books on loan.</p>'}</div>
      <div class="d-sec"><h3>Reservations ${badge(d.reservations.length)}</h3>${d.reservations.length ? `<div class="d-list">${d.reservations.map((r) => `<div class="d-item">${cover(r.title, 'sm')}<div class="grow"><b>${esc(r.title)}</b>
        <div class="sub">${r.status === 'ready' ? `<span class="t-green">Ready — held until ${fmtDate(r.hold_until)}</span>` : `#${r.queue_position} in queue`}</div></div>
        ${r.status === 'ready' ? `<button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">Issue</button>` : ''}</div>`).join('')}</div>` : '<p class="muted small">No open reservations.</p>'}</div>
      <div class="d-sec"><h3>History ${badge(d.history.length)}</h3>${d.history.length ? `<div class="d-list">${d.history.slice().reverse().slice(0, 15).map((l) => `<div class="d-item">${cover(l.title, 'sm')}<div class="grow"><b>${esc(l.title)}</b>
        <div class="sub">${fmtShort(l.issued_on)} → ${fmtShort(l.returned_on)}</div></div>${l.fine ? badge(`${rupees(l.fine)} ${l.fine_paid ? 'paid' : 'unpaid'}`, l.fine_paid ? '' : 'red') : badge('On time', 'green')}</div>`).join('')}</div>` : '<p class="muted small">No past loans.</p>'}</div>
    </div>`;
}

// ===================================================================== notifications
function notifications() {
  const d = state.dash;
  const st = state.stats;
  if (!d) return [];
  const out = [];
  const lastDay = d.readyForPickup.filter((r) => r.hold_until === TODAY);
  if (lastDay.length) out.push({ ic: 'clock', tone: 'tone-red', title: `${plural(lastDay.length, 'hold')} expire${lastDay.length === 1 ? 's' : ''} today`, sub: lastDay.map((r) => `${r.member_name} · ${r.title}`).join(', '), go: () => go('reservations') });
  if (d.overdue.length) out.push({ ic: 'alert', tone: 'tone-red', title: `${plural(d.overdue.length, 'book')} overdue`, sub: `${rupees(d.stats.overdue_fines_accruing)} in fines accruing`, go: () => { ui.loanFilter = 'overdue'; go('returns'); } });
  if (d.readyForPickup.length) out.push({ ic: 'inbox', tone: 'tone-green', title: `${plural(d.readyForPickup.length, 'copy', 'copies')} ready for pickup`, sub: d.readyForPickup.map((r) => r.member_name).join(', '), go: () => go('reservations') });
  const dueToday = (st?.dueSoon || []).filter((l) => l.due_on === TODAY);
  if (dueToday.length) out.push({ ic: 'calendar', tone: 'tone-amber', title: `${plural(dueToday.length, 'book')} due back today`, sub: dueToday.map((l) => l.title).join(', '), go: () => { ui.loanFilter = 'due-soon'; go('returns'); } });
  const owing = state.members.filter((m) => m.unpaid_fines > 0);
  if (owing.length) out.push({ ic: 'wallet', tone: 'tone-amber', title: `${plural(owing.length, 'member')} with unpaid fines`, sub: `${rupees(d.stats.unpaid_fines)} outstanding`, go: () => { ui.fineFilter = 'unpaid'; go('fines'); } });
  return out;
}
function renderBell() {
  const list = notifications();
  $('#bell-dot').hidden = !list.length;
  $('#bell-pop').innerHTML = `<div class="pop-head"><b>Notifications</b><span class="muted small">${list.length ? plural(list.length, 'item') : 'All clear'}</span></div>
    <div class="pop-list">${list.length ? list.map((n, i) => `<div class="pop-item" data-note="${i}"><span class="kpi-ico ${n.tone}">${icon(n.ic)}</span><div><b>${esc(n.title)}</b><small>${esc(n.sub)}</small></div></div>`).join('')
      : empty('checkCircle', "You're all caught up", 'Nothing needs your attention right now.', 'sm')}</div>`;
  renderBell.items = list;
}

// ===================================================================== command palette
const COMMANDS = [
  { label: 'Issue a book', ic: 'arrowOut', kw: 'lend checkout loan', run: () => go('issue') },
  { label: 'Return a book', ic: 'arrowIn', kw: 'check in', run: () => { ui.loanFilter = 'active'; go('returns'); } },
  { label: 'Add a book', ic: 'plus', kw: 'new title catalogue', run: () => { go('books'); addBook(); } },
  { label: 'Add a member', ic: 'userPlus', kw: 'new register reader', run: () => { go('members'); addMember(); } },
  { label: 'New reservation', ic: 'bookmark', kw: 'reserve hold queue', run: () => go('reservations') },
  { label: 'Import books from CSV', ic: 'upload', kw: 'bulk upload', run: () => { go('books'); $('#import-file').click(); } },
  { label: 'View overdue loans', ic: 'alert', kw: 'late', run: () => { ui.loanFilter = 'overdue'; go('returns'); } },
  { label: 'Collect fines', ic: 'wallet', kw: 'pay unpaid', run: () => { ui.fineFilter = 'unpaid'; go('fines'); } },
  { label: 'Go to Dashboard', ic: 'grid', kw: 'home overview', run: () => go('dashboard') },
  { label: 'Go to Activity', ic: 'activity', kw: 'log history timeline', run: () => go('activity') },
  { label: 'Export overdue list (CSV)', ic: 'download', kw: 'report', run: () => { location.href = '/api/reports/overdue.csv'; } },
  { label: 'Toggle dark mode', ic: 'moon', kw: 'theme light', run: () => toggleTheme() },
  { label: 'Keyboard shortcuts', ic: 'keyboard', kw: 'help keys', run: () => showShortcuts() },
];
let palItems = [];
let palActive = 0;
function openPalette() {
  const dlg = $('#palette');
  $('#pal-input').value = '';
  renderPalette();
  if (!dlg.open) dlg.showModal();
  $('#pal-input').focus();
}
function renderPalette() {
  const q = $('#pal-input').value.trim();
  const ql = q.toLowerCase();
  const cmds = COMMANDS.filter((c) => !q || `${c.label} ${c.kw}`.toLowerCase().includes(ql)).slice(0, q ? 5 : 8);
  const books = q ? state.books.filter((b) => bookText(b).toLowerCase().includes(ql)).slice(0, 6) : [];
  const members = q ? state.members.filter((m) => memberText(m).toLowerCase().includes(ql)).slice(0, 6) : [];
  palItems = [
    ...books.map((b) => ({ group: 'Books', html: `${cover(b.title, 'sm')}<div class="grow"><b>${hl(b.title, q)}</b><small>${hl(b.author, q)} · ${b.available_copies}/${b.total_copies} available</small></div>`, run: () => openDrawer(() => bookDrawer(b.id)) })),
    ...members.map((m) => ({ group: 'Members', html: `${avatar(m.name, 'sm')}<div class="grow"><b>${hl(m.name, q)}</b><small>${hl(m.member_code, q)} · ${m.active_issues} on loan${m.unpaid_fines ? ` · owes ${rupees(m.unpaid_fines)}` : ''}</small></div>`, run: () => openDrawer(() => memberDrawer(m.id)) })),
    ...cmds.map((c) => ({ group: 'Actions', html: `<span class="p-ico">${icon(c.ic)}</span><div class="grow"><b>${hl(c.label, q)}</b></div>`, run: c.run })),
  ];
  palActive = 0;
  let lastGroup = '';
  $('#pal-results').innerHTML = palItems.length ? palItems.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="pal-group">${it.group}</div>` : '';
    lastGroup = it.group;
    return `${head}<div class="pal-item ${i === 0 ? 'active' : ''}" data-pi="${i}" role="option">${it.html}<span class="enter">${icon('cornerDownLeft')}</span></div>`;
  }).join('') : empty('search', `No results for “${q}”`, 'Try a title, author, ISBN, member name or ID.', 'sm');
}
function palMove(delta) {
  if (!palItems.length) return;
  palActive = (palActive + delta + palItems.length) % palItems.length;
  $$('.pal-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.pi) === palActive));
  $(`.pal-item[data-pi="${palActive}"]`)?.scrollIntoView({ block: 'nearest' });
}
function palRun(i) {
  const it = palItems[i];
  if (!it) return;
  $('#palette').close();
  it.run();
}
function showShortcuts() {
  openModal({
    title: 'Keyboard shortcuts', ic: 'keyboard', ok: 'Got it', hideCancel: true,
    body: `<div class="shortcut-list">
      <div><span>Open command search</span><span><kbd>Ctrl</kbd> <kbd>K</kbd></span></div>
      <div><span>Search on the current page</span><kbd>/</kbd></div>
      <div><span>Issue a book</span><kbd>I</kbd></div>
      <div><span>Return a book</span><kbd>R</kbd></div>
      <div><span>Go to Books / Members</span><span><kbd>B</kbd> <kbd>M</kbd></span></div>
      <div><span>Go to Dashboard</span><kbd>D</kbd></div>
      <div><span>Open the Library Assistant</span><kbd>A</kbd></div>
      <div><span>Close panel or dialog</span><kbd>Esc</kbd></div>
      <div><span>Show this list</span><kbd>?</kbd></div></div>`,
  });
}

// ===================================================================== theme
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $('#theme-btn').innerHTML = `${icon(isDark() ? 'sun' : 'moon')}<span>${isDark() ? 'Light mode' : 'Dark mode'}</span>`;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('lib-theme', next); } catch { /* ignore */ }
  applyTheme(next);
  if (ui.view === 'dashboard' && state.stats) drawActivityChart($('#activity-chart'), state.chartData || state.stats.activity);
}

// ===================================================================== event wiring
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn && !btn.disabled) {
    const num = (k = 'id') => Number(btn.dataset[k]);
    const acts = {
      'go-issue': () => go('issue'),
      'go-return': () => { ui.loanFilter = 'active'; go('returns'); },
      'go-reserve': () => go('reservations'),
      kpi: () => {
        const t = btn.dataset.target;
        if (t === 'overdue') { ui.loanFilter = 'overdue'; go('returns'); }
        else if (t === 'loans') { ui.loanFilter = 'active'; go('returns'); }
        else if (t === 'fines') { ui.fineFilter = 'unpaid'; go('fines'); }
        else go(t);
      },
      page: () => { ui[btn.dataset.key] = num('to'); render().catch(fail); },
      'add-book': addBook,
      import: () => $('#import-file').click(),
      'edit-book': () => editBook(num()),
      'delete-book': () => deleteBook(num()),
      'view-book': () => openDrawer(() => bookDrawer(num())),
      'issue-book': () => { closeDrawer(); closeModal(); go('issue'); pickers['pk-issue-book'].setByKey(num('book')); if (!pickers['pk-issue-member'].item) setTimeout(() => pickers['pk-issue-member'].focus(), 60); },
      'reserve-book': () => { closeDrawer(); go('reservations'); pickers['pk-res-book'].setByKey(num('book')); setTimeout(() => pickers['pk-res-member'].focus(), 60); },
      'reserve-this': () => { const m = pickers['pk-issue-member'].item; const b = pickers['pk-issue-book'].item; go('reservations'); if (m) pickers['pk-res-member'].set(m); if (b) pickers['pk-res-book'].setByKey(b.id); },
      'add-member': addMember,
      'edit-member': () => editMember(num()),
      'view-member': () => openDrawer(() => memberDrawer(num())),
      'issue-to': () => { closeDrawer(); go('issue'); pickers['pk-issue-member'].setByKey(num()); setTimeout(() => pickers['pk-issue-book'].focus(), 60); },
      'print-card': () => { const m = state.members.find((x) => x.id === num()); if (m) printDoc(memberCard(m)); },
      'print-last': () => printDoc(lastPrint),
      pay: () => { closeModal(); payFine(num()); },
      return: () => returnBook(num()),
      renew: () => renewLoan(num()),
      'cancel-res': () => cancelReservation(num()),
      'issue-hold': () => quickIssue(num('member'), num('book')),
      'copy-msg': () => copyPickupMessage(num()),
    };
    if (acts[btn.dataset.act]) { e.stopPropagation(); Promise.resolve(acts[btn.dataset.act]()).catch(fail); return; }
  }
  const row = e.target.closest('[data-row]');
  if (row && !e.target.closest('button, a, input')) {
    const rid = Number(row.dataset.id);
    openDrawer(() => (row.dataset.row === 'book' ? bookDrawer(rid) : memberDrawer(rid)));
  }
  // close the notifications popover when clicking elsewhere
  if (!e.target.closest('.bell-wrap')) $('#bell-pop').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.bcard')) e.target.click();
});

function segmented(sel, key, reset) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest(`${sel} button[data-v]`);
    if (!b) return;
    ui[key] = b.dataset.v;
    if (reset) ui[reset] = 1;
    if (key === 'bookView') { try { localStorage.setItem('lib-book-view', ui.bookView); } catch { /* ignore */ } }
    render().catch(fail);
  });
}
segmented('#loan-filter', 'loanFilter');
segmented('#res-filter', 'resFilter');
segmented('#fine-filter', 'fineFilter');
segmented('#act-filter', 'actFilter');
segmented('#book-field', 'bookField', 'bookPage');
segmented('#book-view', 'bookView');
segmented('#member-filter', 'memberFilter', 'memberPage');
document.addEventListener('click', (e) => {
  const t = e.target.closest('#attn-tabs button[data-attn]');
  if (!t) return;
  ui.attn = t.dataset.attn;
  const rows = { overdue: state.dash.overdue, due: state.stats?.dueSoon || [], pickup: state.dash.readyForPickup }[ui.attn];
  $$('#attn-tabs button').forEach((b) => b.classList.toggle('on', b === t));
  $('#attn-body').innerHTML = renderAttention(ui.attn, rows);
});
segmented('#loan-filter-stats', 'loanFilter');

let debounce;
const onSearch = (pageKey) => () => { clearTimeout(debounce); debounce = setTimeout(() => { if (pageKey) ui[pageKey] = 1; render().catch(fail); }, 160); };
$('#book-q').addEventListener('input', onSearch('bookPage'));
$('#member-q').addEventListener('input', onSearch('memberPage'));
$('#loan-q').addEventListener('input', onSearch());
for (const id of ['#book-avail', '#book-cat', '#book-sort']) $(id).addEventListener('change', () => { ui.bookPage = 1; render().catch(fail); });
$('#member-sort').addEventListener('change', () => { ui.memberPage = 1; render().catch(fail); });

$('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f).catch(fail); });
$('#issue-form').addEventListener('submit', submitIssue);
$('#issue-form').issuedOn.addEventListener('change', () => { const on = $('#due-chips .chip.on'); setDue(on ? Number(on.dataset.days) : RULES.LOAN_DAYS); });
$('#issue-form').dueOn.addEventListener('change', () => { $$('#due-chips .chip').forEach((c) => c.classList.remove('on')); updateIssuePanel(); });
$('#due-chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) setDue(Number(c.dataset.days)); });
$('#reserve-form').addEventListener('submit', submitReserve);

$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-scrim').addEventListener('click', closeDrawer);
$('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
$('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); });
$('#theme-btn').addEventListener('click', toggleTheme);
$('#bell-btn').addEventListener('click', () => { $('#bell-pop').hidden = !$('#bell-pop').hidden; });
$('#bell-pop').addEventListener('click', (e) => {
  const it = e.target.closest('[data-note]');
  if (!it) return;
  $('#bell-pop').hidden = true;
  renderBell.items[Number(it.dataset.note)]?.go();
});

$('#search-trigger').addEventListener('click', openPalette);
$('#pal-input').addEventListener('input', renderPalette);
$('#pal-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(palActive); }
});
$('#pal-results').addEventListener('click', (e) => { const it = e.target.closest('[data-pi]'); if (it) palRun(Number(it.dataset.pi)); });
$('#palette').addEventListener('click', (e) => { if (e.target === $('#palette')) $('#palette').close(); });

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const overlay = $('#modal').open || $('#palette').open;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') {
    if (!$('#bell-pop').hidden) { $('#bell-pop').hidden = true; return; }
    if (drawerState && !overlay) { closeDrawer(); return; }
  }
  if (typing || overlay || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === '/') {
    const s = $(`#view-${ui.view} [data-slash]`) || $(`#view-${ui.view} .picker-input`);
    if (s) { e.preventDefault(); s.focus(); } else { e.preventDefault(); openPalette(); }
  } else if (k === '?') { e.preventDefault(); showShortcuts(); }
  else if (k === 'i' || k === 'I') { e.preventDefault(); closeDrawer(); go('issue'); setTimeout(() => pickers['pk-issue-member'].focus(), 60); }
  else if (k === 'r' || k === 'R') { e.preventDefault(); closeDrawer(); ui.loanFilter = 'active'; go('returns'); setTimeout(() => $('#loan-q').focus(), 60); }
  else if (k === 'b' || k === 'B') { closeDrawer(); go('books'); }
  else if (k === 'm' || k === 'M') { closeDrawer(); go('members'); }
  else if (k === 'd' || k === 'D') { closeDrawer(); go('dashboard'); }
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (ui.view === 'dashboard' && state.stats) drawActivityChart($('#activity-chart'), state.chartData || state.stats.activity); }, 150);
});

// ===================================================================== pickers
picker('pk-issue-member', {
  items: () => state.members.filter((m) => m.active), key: (m) => m.id, label: (m) => `${m.name} (${m.member_code})`,
  text: memberText, render: memberRender, empty: 'No active member matches', onChange: updateIssuePanel,
});
picker('pk-issue-book', {
  items: () => state.books, key: (b) => b.id, label: (b) => b.title, text: bookText, render: bookRender, empty: 'No book matches', onChange: updateIssuePanel,
});
picker('pk-res-member', {
  items: () => state.members.filter((m) => m.active), key: (m) => m.id, label: (m) => `${m.name} (${m.member_code})`, text: memberText, render: memberRender, empty: 'No active member matches',
});
picker('pk-res-book', {
  items: () => state.books.filter((b) => b.available_copies === 0), key: (b) => b.id, label: (b) => b.title, text: bookText, render: bookRender,
  empty: 'Only books with no copy on the shelf can be reserved',
});

// ===================================================================== boot
let savedTheme = null;
try { savedTheme = localStorage.getItem('lib-theme'); } catch { /* storage unavailable */ }
applyTheme(savedTheme);
hydrateIcons();
window.addEventListener('hashchange', route);

// ===================================================================== footer & legal pages
const LEGAL = {
  privacy: { title: 'Privacy Policy', ic: 'idCard', body: `
    <p>Library Desk is operated by Pavan Technologies to run the day-to-day work of the library.</p>
    <h4>What we store</h4>
    <ul><li><b>Members:</b> name, member ID, phone, email, membership type and validity.</li>
      <li><b>Library records:</b> books, loans, returns, reservations, fines and payments.</li>
      <li><b>Live visitor count:</b> a random ID for each open browser tab and the page it is on. It holds no name or personal details and is deleted after 5 minutes.</li></ul>
    <h4>How it is used</h4>
    <p>Only to lend books, track due dates and fines, manage reservations and produce library reports. We do not sell data or use it for advertising.</p>
    <h4>Where it is kept</h4>
    <p>In the library's database, hosted on Supabase, with the website served by Vercel. Access is limited to library staff.</p>
    <h4>Your choices</h4>
    <p>Members can ask the library desk to see, correct or remove their details. Records needed for unreturned books or unpaid fines are kept until they are settled.</p>` },
  terms: { title: 'Terms of Use', ic: 'file', body: `
    <p>By using Library Desk you agree to these terms.</p>
    <h4>Library rules</h4>
    <ul><li>Books are lent for ${'{LOAN}'} days, with at most ${'{MAX}'} books per member at a time.</li>
      <li>Late returns are charged ${'{FINE}'} per day. Members with unpaid fines cannot borrow until they pay.</li>
      <li>Reserved books are held for ${'{HOLD}'} days once they are ready for pickup.</li></ul>
    <h4>Using the system</h4>
    <p>Use the system only for library work, keep member details accurate, and do not try to access data you are not meant to see.</p>
    <h4>Availability</h4>
    <p>We aim to keep the service running but cannot promise it will always be available or error free.</p>
    <h4>Changes</h4>
    <p>Pavan Technologies may update these terms; the latest version is always shown here.</p>` },
  cookies: { title: 'Cookie Policy', ic: 'info', body: `
    <p><b>Library Desk does not use cookies</b>, and there is no advertising or third-party tracking.</p>
    <h4>What your browser keeps</h4>
    <ul><li><b>Theme</b> (light or dark) and <b>book view</b> (table or grid), saved in your browser's local storage so they are remembered next time.</li>
      <li><b>Tab ID</b> for the live visitor count, saved in session storage and removed when you close the tab.</li></ul>
    <h4>Book covers</h4>
    <p>Cover pictures are loaded from Open Library (openlibrary.org), which may keep standard server logs of those requests.</p>
    <h4>Clearing it</h4>
    <p>You can clear this at any time from your browser's site data settings; the site still works without it.</p>` },
};
function openLegal(key) {
  const doc = LEGAL[key];
  if (!doc) return;
  const r = RULES || {};
  const body = doc.body.replace('{LOAN}', r.LOAN_DAYS ?? 14).replace('{MAX}', r.MAX_ACTIVE_ISSUES ?? 3)
    .replace('{FINE}', `₹${r.FINE_PER_DAY ?? 5}`).replace('{HOLD}', r.HOLD_DAYS ?? 2);
  openModal({ title: doc.title, sub: 'Pavan Technologies · Library Desk', ic: doc.ic, body: `<div class="legal">${body}</div>`,
    ok: 'Got it', hideCancel: true, wide: true, onSubmit: () => {} });
}
$('#footer-year').textContent = new Date().getFullYear();
for (const a of $$('[data-legal]')) a.addEventListener('click', (e) => { e.preventDefault(); openLegal(a.dataset.legal); });

// ===================================================================== live visitors
// Every open tab checks in every 20 s; the server counts tabs seen in the last minute.
const live = { sid: '', data: null };
try { live.sid = sessionStorage.getItem('ld-sid') || ''; } catch {}
if (!live.sid) {
  live.sid = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
  try { sessionStorage.setItem('ld-sid', live.sid); } catch {}
}
async function livePing() {
  if (document.hidden) return;
  try {
    live.data = await api('POST', '/api/presence', { sid: live.sid, page: ui.view || 'dashboard' });
    renderLive();
  } catch { $('#live-count').textContent = '–'; }
}
function renderLive() {
  const d = live.data;
  if (!d) return;
  $('#live-count').textContent = d.online;
  $('#live-btn').setAttribute('aria-label', `${plural(d.online, 'person', 'people')} online now`);
  const name = (p) => PAGES[p]?.title || (p ? p[0].toUpperCase() + p.slice(1) : 'Other');
  $('#live-pop').innerHTML = `<div class="pop-head"><b><span class="live-dot"></span> Live now</b><span class="muted small">${plural(d.online, 'person', 'people')} online</span></div>
    <div class="pop-list">${d.pages.map((r) => `<div class="live-row"><span>${esc(name(r.page))}</span><b>${r.count}</b></div>`).join('')}</div>
    <div class="live-foot muted small">Updates every 20 seconds · counts open browser tabs</div>`;
}
$('#live-btn').addEventListener('click', () => { $('#live-pop').hidden = !$('#live-pop').hidden; if (!$('#live-pop').hidden) livePing(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.live-wrap')) $('#live-pop').hidden = true; });
window.addEventListener('hashchange', () => setTimeout(livePing, 50));
document.addEventListener('visibilitychange', () => { if (!document.hidden) livePing(); });
setInterval(livePing, 20_000);
livePing();
(async () => {
  try {
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    await refreshAll();
    resetIssueForm();
    route();
  } catch (err) { fail(err); }
})();
