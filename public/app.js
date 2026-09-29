'use strict';
// Library Desk — librarian console.
// Every business rule is enforced by the server; the UI previews them so the librarian sees
// problems before clicking, but always shows the server's message if something is refused.

// ================================================================ utilities
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtShort = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const relDays = (date) => {
  const n = daysBetween(TODAY, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
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
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const hydrateIcons = (root = document) => { for (const el of $$('[data-icon]', root)) if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); };

// Deterministic colours so the same book / member always gets the same cover / avatar.
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const initials = (s) => String(s || '?').trim().split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const avatar = (name, lg = false) => `<span class="avatar ${lg ? 'lg' : ''}" style="background:hsl(${hue(name)} 55% 52%)">${esc(initials(name))}</span>`;
const cover = (title, lg = false) => {
  const h = hue(title);
  return `<span class="cover ${lg ? 'lg' : ''}" style="background:linear-gradient(160deg,hsl(${h} 50% 50%),hsl(${(h + 40) % 360} 55% 34%))">${esc(initials(title.replace(/^(the|a|an)\s+/i, '')).slice(0, 1))}</span>`;
};
const who = (name, sub, lg) => `<div class="who">${avatar(name, lg)}<div style="min-width:0"><b>${esc(name)}</b><div class="sub">${sub}</div></div></div>`;
const bookWho = (title, sub) => `<div class="who">${cover(title)}<div style="min-width:0"><b>${esc(title)}</b><div class="sub">${sub}</div></div></div>`;
const pill = (text, tone = '', dot = false) => `<span class="pill ${tone}">${dot ? '<span class="dot"></span>' : ''}${text}</span>`;
const dots = (n, max) => `<span class="dots" title="${n} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? (n >= max ? 'full' : 'on') : ''}"></i>`).join('')}</span>`;
const empty = (ic, title, sub = '') => `<div class="empty"><div class="e-ico" data-icon="${ic}">${icon(ic)}</div><b>${esc(title)}</b>${esc(sub)}</div>`;

// ================================================================ state & API
let RULES = { LOAN_DAYS: 14, MAX_ACTIVE_ISSUES: 3, FINE_PER_DAY: 5, HOLD_DAYS: 2 };
let TODAY = localToday();
const state = { members: [], books: [], reservations: [], loans: [], dash: null };
const ui = { view: 'dashboard', circTab: 'issue', loanFilter: 'active', resFilter: 'open', bookField: 'all', category: '', memberFilter: 'all' };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshAll() {
  const [dash, members, books, reservations, loans] = await Promise.all([
    api('GET', '/api/dashboard'), api('GET', '/api/members'), api('GET', '/api/books'),
    api('GET', '/api/reservations?status=open'), api('GET', '/api/issues?status=active'),
  ]);
  Object.assign(state, { dash, members, books, reservations, loans });
  RULES = dash.rules; TODAY = dash.today;
  $('#today-label').textContent = new Date(`${TODAY}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  setBadge('#nb-overdue', dash.stats.overdue);
  setBadge('#nb-ready', dash.stats.ready_for_pickup);
  setBadge('#nb-fines', members.filter((m) => m.unpaid_fines > 0).length);
  for (const p of Object.values(pickers)) p.refresh();
  updateIssuePanel();
  await render();
  if (drawerState) drawerState.reopen();
}
function setBadge(sel, n) { const el = $(sel); el.hidden = !n; el.textContent = n; }

// ================================================================ toasts & modal
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'checkCircle' : 'info')}<span class="t">${esc(msg)}</span><button aria-label="Dismiss">${icon('x')}</button>`;
  el.querySelector('button').onclick = () => el.remove();
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4500);
}
const fail = (err) => toast(err.message, 'error');

function openModal({ title, body, ok = 'Save', tone = 'primary', ic = '', icTone = 'tone-indigo', onSubmit, onOpen, hideCancel = false }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  const mi = $('#modal-ico');
  mi.className = `modal-ico ${icTone}`;
  mi.innerHTML = ic ? icon(ic) : '';
  $('#modal-body').innerHTML = body;
  $('#modal-error').textContent = '';
  const okBtn = $('#modal-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${tone}`;
  $('#modal-cancel').hidden = hideCancel;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    okBtn.disabled = true;
    try {
      await onSubmit?.(Object.fromEntries(new FormData(form)), form);
      dlg.close();
    } catch (err) {
      $('#modal-error').textContent = err.message;
    } finally {
      okBtn.disabled = false;
    }
  };
  $('#modal-cancel').onclick = () => dlg.close();
  hydrateIcons($('#modal-body'));
  dlg.showModal();
  onOpen?.();
  const first = $('#modal-body input:not([type=hidden]):not([type=checkbox]), #modal-body select', dlg);
  if (first) first.focus(); else okBtn.focus();
}

// ================================================================ drawer
let drawerState = null;
function openDrawer(renderFn) {
  drawerState = {
    reopen: async () => {
      try { $('#drawer-body').innerHTML = await renderFn(); hydrateIcons($('#drawer-body')); } catch (err) { closeDrawer(); fail(err); }
    },
  };
  $('#drawer-body').innerHTML = '<p class="muted">Loading…</p>';
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

// ================================================================ picker (search-as-you-type combobox)
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
    get value() { return value; },
    get item() { return value == null ? null : findItem(value); },
    set(item, silent = false) {
      value = item ? opts.key(item) : null;
      input.value = item ? opts.label(item) : '';
      root.classList.toggle('has-value', !!item);
      list.hidden = true;
      if (!silent) opts.onChange?.(item || null);
    },
    setByKey(key) { const it = findItem(key); p.set(it || null); },
    refresh() { if (value != null) { const it = findItem(value); if (it) input.value = opts.label(it); else p.set(null); } },
    focus() { input.focus(); },
  };
  function open() {
    const q = input.value.trim().toLowerCase();
    const all = opts.items();
    shown = (value != null && q === opts.label(p.item || {}).toLowerCase() ? all : all.filter((it) => !q || opts.text(it).toLowerCase().includes(q))).slice(0, 60);
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.length
      ? shown.map((it, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">${opts.render(it)}</li>`).join('')
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
      if (list.hidden) return open();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (!list.hidden && shown[active]) { e.preventDefault(); p.set(shown[active]); }
    } else if (e.key === 'Escape') {
      list.hidden = true;
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
const memberRender = (m) => `${avatar(m.name)}<div class="grow"><b>${esc(m.name)}</b><small>${esc(m.member_code)} · ${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES} books</small></div>${m.unpaid_fines ? pill(`owes ${rupees(m.unpaid_fines)}`, 'red') : ''}`;
const bookText = (b) => `${b.title} ${b.author} ${b.isbn} ${b.category}`;
const bookRender = (b) => `${cover(b.title)}<div class="grow"><b>${esc(b.title)}</b><small>${esc(b.author)}</small></div>${availPill(b)}`;
function availPill(b) {
  if (b.available_copies > 0) return pill(`${b.available_copies} available`, 'green', true);
  if (b.queue_length) return pill(`${b.queue_length} waiting`, 'amber', true);
  return pill('None on shelf', 'red', true);
}

// ================================================================ routing & page chrome
const PAGES = {
  dashboard: { title: 'Dashboard', sub: () => greeting() },
  circulation: { title: 'Issue & Return', sub: () => `Loans are ${RULES.LOAN_DAYS} days · max ${RULES.MAX_ACTIVE_ISSUES} books per member · ₹${RULES.FINE_PER_DAY}/day late` },
  reservations: { title: 'Reservations', sub: () => `${plural(state.dash?.stats.ready_for_pickup ?? 0, 'copy', 'copies')} ready for pickup · ${plural(state.dash?.stats.pending_reservations ?? 0, 'member')} waiting` },
  books: { title: 'Books', sub: () => `${plural(state.dash?.stats.titles ?? 0, 'title')} · ${plural(state.dash?.stats.copies ?? 0, 'copy', 'copies')} · ${state.dash?.stats.available ?? 0} on the shelf` },
  members: { title: 'Members', sub: () => `${state.dash?.stats.active_members ?? 0} active members` },
};
function greeting() {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'} — here's what needs attention today.`;
}
function pageActions(view) {
  const b = (act, ic, label, cls = '') => `<button class="btn ${cls}" data-act="${act}">${icon(ic)}${label}</button>`;
  return {
    dashboard: b('go-issue', 'arrowOut', 'Issue book', 'primary'),
    circulation: `${b('go-reserve', 'bookmark', 'Reserve', 'ghost')}`,
    reservations: '',
    books: `${b('import', 'upload', 'Import CSV', 'ghost')}${b('add-book', 'plus', 'Add book', 'primary')}`,
    members: b('add-member', 'userPlus', 'Add member', 'primary'),
  }[view];
}

function route() {
  const [view, tab] = location.hash.replace(/^#\/?/, '').split('/');
  ui.view = PAGES[view] ? view : 'dashboard';
  if (ui.view === 'circulation' && (tab === 'issue' || tab === 'return')) ui.circTab = tab;
  for (const a of $$('.nav-item')) a.classList.toggle('on', a.dataset.view === ui.view);
  for (const v of $$('.view')) v.classList.toggle('on', v.id === `view-${ui.view}`);
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
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
  $('#page-actions').innerHTML = pageActions(ui.view);
  document.title = `${page.title} · Library Desk`;
  await renderers[ui.view]();
  hydrateIcons($('.content'));
}

function table(cols, rows, emptyHtml, rowAttrs = () => '') {
  if (!rows.length) return emptyHtml;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr ${rowAttrs(r)}>${cols.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ================================================================ dashboard
const renderers = {};
renderers.dashboard = async () => {
  const d = state.dash;
  if (!d) return;
  const s = d.stats;
  const kpi = (label, val, ic, tone, foot, target, alert = false) =>
    `<button class="kpi ${alert ? 'alert' : ''}" data-act="kpi" data-target="${target}">
      <div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-ico ${tone}">${icon(ic)}</span></div>
      <div class="kpi-val">${esc(val)}</div><div class="kpi-foot">${esc(foot)}</div></button>`;
  $('#kpis').innerHTML = [
    kpi('Issued today', s.issued_today, 'arrowOut', 'tone-indigo', `${s.on_loan} on loan in total`, 'circulation/return'),
    kpi('Overdue', s.overdue, 'alert', s.overdue ? 'tone-red' : 'tone-green', s.overdue ? `${rupees(s.overdue_fines_accruing)} in fines building up` : 'Everything is on time', 'overdue', s.overdue > 0),
    kpi('Ready for pickup', s.ready_for_pickup, 'inbox', 'tone-green', 'held for 2 days', 'reservations'),
    kpi('Waiting', s.pending_reservations, 'hourglass', 'tone-amber', 'members in reservation queues', 'reservations'),
    kpi('Unpaid fines', rupees(s.unpaid_fines), 'wallet', s.unpaid_fines ? 'tone-rose' : 'tone-green', s.unpaid_fines ? 'blocking new issues' : 'All settled', 'members-fines', s.unpaid_fines > 0),
  ].join('');

  $('#dash-ready').innerHTML = d.readyForPickup.length
    ? `<div class="list">${d.readyForPickup.map((r) => {
      const left = daysBetween(TODAY, r.hold_until);
      return `<div class="list-item">${cover(r.title)}<div class="grow"><b>${esc(r.title)}</b><div class="muted">for ${esc(r.member_name)} · ${esc(r.member_code)}</div>
          <div class="countdown ${left <= 0 ? 'urgent' : ''}">${left <= 0 ? 'Last day to collect' : `Held until ${fmtShort(r.hold_until)} · ${plural(left, 'day')} left`}</div></div>
          <div class="row-actions"><button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">${icon('arrowOut')}Issue</button>
          <button class="btn sm danger-ghost" data-act="cancel-res" data-id="${r.id}">Cancel</button></div></div>`;
    }).join('')}</div>`
    : empty('inbox', 'Nothing waiting at the desk', 'Returned copies for reservers will appear here.');

  const byBook = groupBy(d.pendingReservations, (r) => r.book_id);
  $('#dash-pending').innerHTML = byBook.length
    ? `<div class="list">${byBook.map(([, rs]) => `<div class="list-item">${cover(rs[0].title)}<div class="grow"><b>${esc(rs[0].title)}</b>
        <div class="muted">${rs.map((r) => `${r.queue_position}. ${esc(r.member_name)}`).join(' · ')}</div></div>${pill(plural(rs.length, 'waiting', 'waiting'), 'amber')}</div>`).join('')}</div>`
    : empty('hourglass', 'No one is waiting', 'Reservations for unavailable books show up here.');

  $('#dash-overdue').innerHTML = table([
    { label: 'Book', render: (r) => bookWho(r.title, `<span class="mono">${esc(r.isbn)}</span>`) },
    { label: 'Member', render: (r) => who(r.member_name, `${esc(r.member_code)}${r.phone ? ` · ${esc(r.phone)}` : ''}`) },
    { label: 'Due', render: (r) => `${fmtDate(r.due_on)}<div class="muted">${relDays(r.due_on)}</div>` },
    { label: 'Late', cls: 'num', render: (r) => pill(plural(r.days_overdue, 'day'), 'red') },
    { label: 'Fine', cls: 'num', render: (r) => `<b>${rupees(r.accrued_fine)}</b>` },
    { label: '', cls: 'num', render: (r) => `<button class="btn sm" data-act="return" data-id="${r.id}">${icon('arrowIn')}Return</button>` },
  ], d.overdue, empty('checkCircle', 'Nothing is overdue', 'Every book on loan is within its due date.'));

  $('#dash-today').innerHTML = table([
    { label: 'Book', render: (r) => bookWho(r.title, esc(r.author)) },
    { label: 'Member', render: (r) => who(r.member_name, esc(r.member_code)) },
    { label: 'Due', render: (r) => fmtDate(r.due_on) },
    { label: 'Status', render: (r) => (r.returned_on ? pill('Returned', 'grey') : pill('On loan', '', true)) },
  ], d.issuedToday, empty('arrowOut', 'No books issued yet today'));
};
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) { const k = keyFn(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
  return [...map.entries()];
}

// ================================================================ circulation: issue
function updateIssuePanel() {
  const m = pickers['pk-issue-member']?.item;
  const b = pickers['pk-issue-book']?.item;
  $('#issue-member-card').innerHTML = m ? `<div class="sel-card">${avatar(m.name, true)}<div class="grow"><b>${esc(m.name)}</b>
      <div class="muted">${esc(m.member_code)}${m.phone ? ` · ${esc(m.phone)}` : ''}</div>
      <div class="meta">${pill(`${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES} books`, m.active_issues >= RULES.MAX_ACTIVE_ISSUES ? 'red' : '')}
      ${m.unpaid_fines ? pill(`owes ${rupees(m.unpaid_fines)}`, 'red') : pill('No fines', 'green')}</div></div>
      <button type="button" class="btn sm ghost" data-act="view-member" data-id="${m.id}">Profile</button></div>` : '';
  $('#issue-book-card').innerHTML = b ? `<div class="sel-card">${cover(b.title, true)}<div class="grow"><b>${esc(b.title)}</b>
      <div class="muted">${esc(b.author)} · <span class="mono">${esc(b.isbn)}</span></div>
      <div class="meta">${availPill(b)}${b.held_copies ? pill(`${b.held_copies} held`, 'amber') : ''}${pill(esc(b.category), 'grey')}</div></div>
      <button type="button" class="btn sm ghost" data-act="view-book" data-id="${b.id}">Details</button></div>` : '';

  const checks = [];
  let blocker = '';
  const add = (kind, text, extra = '') => {
    checks.push(`<li class="${kind}">${icon(kind === 'ok' ? 'checkCircle' : kind === 'bad' ? 'xCircle' : kind === 'info' ? 'info' : 'clock')}<span class="t">${text}</span>${extra}</li>`);
    if (kind === 'bad' && !blocker) blocker = text.replace(/<[^>]+>/g, '');
  };
  if (!m) add('pending', 'Choose a member');
  else {
    add(m.active ? 'ok' : 'bad', m.active ? 'Member is active' : 'Member is inactive');
    if (m.unpaid_fines) add('bad', `Unpaid fine of <b>${rupees(m.unpaid_fines)}</b> — must be paid first`, `<button type="button" class="btn sm" data-act="pay" data-id="${m.id}">Pay</button>`);
    else add('ok', 'No unpaid fines');
    add(m.active_issues < RULES.MAX_ACTIVE_ISSUES ? 'ok' : 'bad', `Holds ${m.active_issues} of ${RULES.MAX_ACTIVE_ISSUES} allowed books`);
  }
  if (!b) add('pending', 'Choose a book');
  else if (m) {
    const holding = state.loans.some((l) => l.member_id === m.id && l.book_id === b.id);
    if (holding) add('bad', 'Member already has a copy of this book');
    const open = state.reservations.filter((r) => r.book_id === b.id);
    const mine = open.find((r) => r.member_id === m.id);
    const waiting = open.filter((r) => r.status === 'waiting');
    if (mine?.status === 'ready') add('info', `A copy is <b>held for this member</b> until ${fmtDate(mine.hold_until)}`);
    else if (waiting.length) {
      const pos = waiting.findIndex((r) => r.member_id === m.id);
      add('bad', pos === 0
        ? 'First in the queue, but no copy has come back yet'
        : `Reservation queue: only <b>${esc(waiting[0].member_name)}</b> (first in line) can borrow this${pos > 0 ? ` — this member is #${pos + 1}` : ''}`);
    } else if (b.available_copies > 0) add('ok', `${plural(b.available_copies, 'copy', 'copies')} on the shelf`);
    else add('bad', 'No copies available — place a reservation instead', `<button type="button" class="btn sm" data-act="reserve-this">Reserve</button>`);
  } else add(b.available_copies > 0 ? 'ok' : 'bad', b.available_copies > 0 ? `${plural(b.available_copies, 'copy', 'copies')} on the shelf` : 'No copies on the shelf');

  $('#issue-checks').innerHTML = checks.join('');
  const ready = m && b && !blocker;
  $('#issue-submit').disabled = !ready;
  $('#issue-reason').textContent = m && b && blocker ? `Can't issue: ${blocker}` : '';
}

function setDue(days) {
  const f = $('#issue-form');
  if (!f.issuedOn.value) f.issuedOn.value = TODAY;
  f.dueOn.value = addDays(f.issuedOn.value, days);
  for (const c of $$('#due-chips .chip')) c.classList.toggle('on', Number(c.dataset.days) === days);
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
    toast(`Issued "${r.title}" to ${r.member_name}. Due ${fmtDate(r.due_on)}.`, 'ok');
    resetIssueForm(true);
    await refreshAll();
  } catch (err) { fail(err); updateIssuePanel(); }
}

// ================================================================ circulation: return
renderers.circulation = async () => {
  for (const b of $$('#circ-tabs button')) b.classList.toggle('on', b.dataset.tab === ui.circTab);
  $('#circ-issue').hidden = ui.circTab !== 'issue';
  $('#circ-return').hidden = ui.circTab !== 'return';
  for (const b of $$('#loan-filter button')) b.classList.toggle('on', b.dataset.v === ui.loanFilter);
  if (ui.circTab === 'issue') { updateIssuePanel(); return; }

  const rows = ui.loanFilter === 'active' ? state.loans : await api('GET', `/api/issues?status=${ui.loanFilter}`);
  const q = $('#loan-q').value.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.title} ${r.isbn} ${r.member_name} ${r.member_code}`.toLowerCase().includes(q)) : rows;
  $('#loans-table').innerHTML = table([
    { label: 'Book', render: (r) => bookWho(r.title, `<span class="mono">${esc(r.isbn)}</span>`) },
    { label: 'Member', render: (r) => who(r.member_name, esc(r.member_code)) },
    { label: 'Issued', render: (r) => fmtDate(r.issued_on) },
    { label: 'Due', render: (r) => `${fmtDate(r.due_on)}${r.returned_on ? '' : `<div class="muted">${relDays(r.due_on)}</div>`}` },
    { label: 'Status', render: (r) => (r.returned_on ? pill(`Returned ${fmtShort(r.returned_on)}`, 'grey')
      : r.overdue ? pill(`${plural(r.days_overdue, 'day')} late`, 'red', true) : pill('On time', 'green', true)) },
    { label: 'Fine', cls: 'num', render: (r) => (r.accrued_fine ? `<b>${rupees(r.accrued_fine)}</b><div class="muted">${r.returned_on ? (r.fine_paid ? 'paid' : 'unpaid') : 'so far'}</div>` : '<span class="muted">—</span>') },
    { label: '', cls: 'num', render: (r) => (r.returned_on ? '' : `<button class="btn sm primary" data-act="return" data-id="${r.id}">${icon('arrowIn')}Return</button>`) },
  ], shown, q ? empty('search', 'No loans match your search') : empty('checkCircle', ui.loanFilter === 'overdue' ? 'Nothing is overdue' : 'No loans to show'));
};

async function returnBook(issueId) {
  const issue = state.loans.find((r) => r.id === issueId) || (await api('GET', '/api/issues?status=active')).find((r) => r.id === issueId);
  if (!issue) { toast('That loan has already been returned.', 'error'); return refreshAll(); }
  const queueFor = state.reservations.filter((r) => r.book_id === issue.book_id && r.status === 'waiting');
  const preview = (date) => {
    const late = Math.max(0, daysBetween(issue.due_on, date));
    return late
      ? `<div class="callout bad"><div class="muted-s" style="color:inherit">Late fine</div><div class="fine-big">${rupees(late * RULES.FINE_PER_DAY)}</div>${plural(late, 'day')} late × ₹${RULES.FINE_PER_DAY} — recorded against ${esc(issue.member_name)} and blocks new issues until paid.</div>`
      : '<div class="callout ok"><b>On time</b> — no fine.</div>';
  };
  openModal({
    title: 'Return book', ok: 'Mark as returned', ic: 'arrowIn', icTone: 'tone-green',
    body: `<div class="sel-card" style="margin:0">${cover(issue.title, true)}<div class="grow"><b>${esc(issue.title)}</b>
        <div class="muted">Borrowed by ${esc(issue.member_name)} (${esc(issue.member_code)})</div>
        <div class="muted">Issued ${fmtDate(issue.issued_on)} · due ${fmtDate(issue.due_on)}</div></div></div>
      <label class="field">Return date<input type="date" name="returnedOn" required min="${issue.issued_on}" max="${TODAY}" value="${TODAY}"></label>
      <div id="fine-preview">${preview(TODAY)}</div>
      ${queueFor.length ? `<div class="callout warn">${icon('bookmark')} This copy will be <b>held for ${esc(queueFor[0].member_name)}</b> (first in the reservation queue) for ${RULES.HOLD_DAYS} days.</div>` : ''}`,
    onOpen: () => $('#modal-body [name=returnedOn]').addEventListener('input', (e) => { if (e.target.value) $('#fine-preview').innerHTML = preview(e.target.value); }),
    onSubmit: async (v) => {
      const r = await api('POST', `/api/issues/${issueId}/return`, { returnedOn: v.returnedOn });
      toast(r.fine ? `Returned ${plural(r.daysLate, 'day')} late — fine of ${rupees(r.fine)} recorded against ${r.member_name}.` : `"${r.title}" returned on time.`, r.fine ? '' : 'ok');
      if (r.readyFor) toast(`Copy held for ${r.readyFor.memberName} until ${fmtDate(r.readyFor.holdUntil)} — now on "Ready for pickup".`);
      await refreshAll();
    },
  });
}

// ================================================================ reservations
renderers.reservations = async () => {
  for (const b of $$('#res-filter button')) b.classList.toggle('on', b.dataset.v === ui.resFilter);
  const rows = ui.resFilter === 'open' ? state.reservations : await api('GET', `/api/reservations?status=${ui.resFilter}`);
  if (!rows.length) {
    $('#res-list').innerHTML = empty('bookmark', ui.resFilter === 'closed' ? 'No past reservations' : 'No reservations here', ui.resFilter === 'open' ? 'Reserve a book above when no copy is on the shelf.' : '');
    return;
  }
  if (ui.resFilter === 'closed') {
    const label = { fulfilled: pill('Collected', 'green'), cancelled: pill('Cancelled', 'grey'), expired: pill('Expired — not collected', 'amber') };
    $('#res-list').innerHTML = table([
      { label: 'Book', render: (r) => bookWho(r.title, `<span class="mono">${esc(r.isbn)}</span>`) },
      { label: 'Member', render: (r) => who(r.member_name, esc(r.member_code)) },
      { label: 'Reserved', render: (r) => fmtDate(r.reserved_on) },
      { label: 'Closed', render: (r) => fmtDate(r.closed_on) },
      { label: 'Outcome', render: (r) => label[r.status] },
    ], rows, '');
    return;
  }
  const books = new Map(state.books.map((b) => [b.id, b]));
  $('#res-list').innerHTML = groupBy(rows, (r) => r.book_id).map(([bookId, rs]) => {
    const b = books.get(bookId);
    const ready = rs.filter((r) => r.status === 'ready');
    const waiting = rs.filter((r) => r.status === 'waiting');
    return `<div class="queue-card"><div class="queue-head">${cover(rs[0].title)}<div class="grow"><b>${esc(rs[0].title)}</b>
        <div class="muted">${b ? `${b.available_copies}/${b.total_copies} on shelf · ${b.issued_copies} on loan` : ''}</div></div>
        ${ready.length ? pill(`${ready.length} ready`, 'green') : ''}${waiting.length ? pill(`${waiting.length} waiting`, 'amber') : ''}</div>
      <div class="queue">
        ${ready.map((r) => `<div class="q-row ready"><span class="q-pos">${icon('check')}</span>${avatar(r.member_name)}<div class="grow"><b>${esc(r.member_name)}</b>
          <div class="muted">Ready · held until ${fmtDate(r.hold_until)} (${daysBetween(TODAY, r.hold_until) <= 0 ? 'last day' : plural(daysBetween(TODAY, r.hold_until), 'day') + ' left'})</div></div>
          <div class="row-actions"><button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">Issue</button>
          <button class="btn sm danger-ghost" data-act="cancel-res" data-id="${r.id}">Cancel</button></div></div>`).join('')}
        ${waiting.map((r) => `<div class="q-row"><span class="q-pos">${r.queue_position}</span>${avatar(r.member_name)}<div class="grow"><b>${esc(r.member_name)}</b>
          <div class="muted">${esc(r.member_code)} · waiting since ${fmtDate(r.reserved_on)}</div></div>
          <button class="btn sm danger-ghost" data-act="cancel-res" data-id="${r.id}">Cancel</button></div>`).join('')}
      </div></div>`;
  }).join('');
};
async function submitReserve(e) {
  e.preventDefault();
  const m = pickers['pk-res-member'].item;
  const b = pickers['pk-res-book'].item;
  if (!m) { toast('Choose a member first.', 'error'); return pickers['pk-res-member'].focus(); }
  if (!b) { toast('Choose a book first.', 'error'); return pickers['pk-res-book'].focus(); }
  try {
    const r = await api('POST', '/api/reservations', { memberId: m.id, bookId: b.id });
    toast(`${r.member_name} is #${r.queue_position} in the queue for "${r.title}".`, 'ok');
    pickers['pk-res-book'].set(null, true);
    await refreshAll();
  } catch (err) { fail(err); }
}
function cancelReservation(resId) {
  openModal({
    title: 'Cancel reservation?', ok: 'Cancel reservation', tone: 'danger', ic: 'bookmark', icTone: 'tone-red',
    body: '<p>If a copy is being held for this member, it passes to the next person in the queue, or back to the shelf if nobody is waiting.</p>',
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
    toast(`Issued "${r.title}" to ${r.member_name}. Due ${fmtDate(r.due_on)}.`, 'ok');
    await refreshAll();
  } catch (err) { fail(err); }
}

// ================================================================ books
let bookReq = 0;
renderers.books = async () => {
  for (const b of $$('#book-field button')) b.classList.toggle('on', b.dataset.v === ui.bookField);
  const cats = [...new Set(state.books.map((b) => b.category))].sort();
  $('#cat-chips').innerHTML = cats.length > 1 ? [`<button class="chip ${ui.category ? '' : 'on'}" data-cat="">All categories</button>`,
    ...cats.map((c) => `<button class="chip ${ui.category === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)].join('') : '';

  const qs = new URLSearchParams({ q: $('#book-q').value, field: ui.bookField, ...($('#book-avail').checked ? { available: '1' } : {}) });
  const req = ++bookReq;
  let books = await api('GET', `/api/books?${qs}`);
  if (req !== bookReq) return; // a newer search is already on its way
  if (ui.category) books = books.filter((b) => b.category === ui.category);
  $('#books-table').innerHTML = table([
    { label: 'Book', render: (b) => bookWho(b.title, esc(b.author)) },
    { label: 'ISBN', render: (b) => `<span class="mono">${esc(b.isbn)}</span>` },
    { label: 'Category', render: (b) => pill(esc(b.category), 'grey') },
    { label: 'Copies', render: (b) => availBar(b) },
    { label: 'Queue', render: (b) => (b.queue_length ? pill(`${b.queue_length} waiting`, 'amber') : '<span class="muted">—</span>') },
    { label: '', cls: 'num', render: (b) => `<div class="row-actions">
        ${b.available_copies > 0 || b.held_copies
          ? `<button class="btn sm" data-act="issue-book" data-book="${b.id}">${icon('arrowOut')}Issue</button>`
          : `<button class="btn sm" data-act="reserve-book" data-book="${b.id}">${icon('bookmark')}Reserve</button>`}
        <button class="btn sm ghost" data-act="edit-book" data-id="${b.id}" aria-label="Edit">${icon('edit')}</button>
        <button class="btn sm danger-ghost" data-act="delete-book" data-id="${b.id}" aria-label="Delete">${icon('trash')}</button></div>` },
  ], books, empty('book', 'No books match', 'Try another search term, or turn off "Available only".'), (b) => `class="clickable" data-row="book" data-id="${b.id}"`);
};
function availBar(b) {
  const t = b.total_copies || 1;
  return `<div class="avail"><div class="avail-top"><span>${b.available_copies} of ${b.total_copies} available</span></div>
    <div class="bar" title="${b.available_copies} available · ${b.held_copies} held · ${b.issued_copies} on loan">
    <i class="a" style="width:${(b.available_copies / t) * 100}%"></i><i class="h" style="width:${(b.held_copies / t) * 100}%"></i><i class="o" style="width:${(b.issued_copies / t) * 100}%"></i></div>
    <div class="muted" style="font-size:11.5px;margin-top:3px">${b.issued_copies} on loan${b.held_copies ? ` · ${b.held_copies} held` : ''}</div></div>`;
}

function bookForm(b = {}) {
  const cats = [...new Set(state.books.map((x) => x.category))].sort();
  return `
    <label class="field">Title<input name="title" required maxlength="200" value="${esc(b.title)}"></label>
    <label class="field">Author<input name="author" required maxlength="200" value="${esc(b.author)}"></label>
    <div class="row2">
      <label class="field">ISBN<input name="isbn" required placeholder="10 or 13 digits" value="${esc(b.isbn)}"></label>
      <label class="field">Category<input name="category" list="cat-list" maxlength="80" placeholder="General" value="${esc(b.category)}"></label>
    </div>
    <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="field">Total copies<input name="total_copies" type="number" min="${b.id ? Math.max(1, b.issued_copies + b.held_copies) : 1}" step="1" required value="${esc(b.total_copies ?? 1)}">
      ${b.id ? `<small>${b.issued_copies} on loan and ${b.held_copies} held for pickup, so the minimum is ${Math.max(1, b.issued_copies + b.held_copies)}. Available copies are recalculated automatically.</small>` : ''}</label>`;
}
function addBook() {
  openModal({
    title: 'Add a book', ok: 'Add book', ic: 'book', body: bookForm(),
    onSubmit: async (v) => { const b = await api('POST', '/api/books', { ...v, total_copies: Number(v.total_copies) }); toast(`Added "${b.title}".`, 'ok'); await refreshAll(); },
  });
}
async function editBook(bookId) {
  const b = await api('GET', `/api/books/${bookId}`);
  openModal({
    title: 'Edit book', ic: 'edit', body: bookForm(b),
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/books/${bookId}`, { ...v, total_copies: Number(v.total_copies) });
      toast(`Saved "${r.title}".`, 'ok');
      for (const p of r.promoted || []) toast(`New copy held for ${p.memberName} — now on "Ready for pickup".`);
      await refreshAll();
    },
  });
}
function deleteBook(bookId) {
  const b = state.books.find((x) => x.id === bookId);
  const blocked = b && (b.issued_copies > 0 || b.held_copies > 0 || b.queue_length > 0);
  openModal({
    title: 'Delete this book?', ok: 'Delete book', tone: 'danger', ic: 'trash', icTone: 'tone-red',
    body: `<div class="sel-card" style="margin:0">${cover(b?.title || '?')}<div class="grow"><b>${esc(b?.title)}</b><div class="muted">${esc(b?.author)}</div></div></div>
      ${blocked ? `<div class="callout warn">This book is ${b.issued_copies ? `on loan (${plural(b.issued_copies, 'copy', 'copies')})` : 'reserved'}, so it can't be deleted yet. You'll see the details below if you try.</div>`
        : '<p class="muted">Past loans and fines stay in the records.</p>'}`,
    onSubmit: async () => { await api('DELETE', `/api/books/${bookId}`); toast('Book deleted.', 'ok'); closeDrawer(); await refreshAll(); },
  });
}
async function importCsv(file) {
  const r = await api('POST', '/api/books/import', { csv: await file.text() });
  const skipped = r.skipped.length;
  openModal({
    title: 'Import finished', ok: 'Done', hideCancel: true, ic: 'upload', icTone: skipped ? 'tone-amber' : 'tone-green',
    body: `<div class="callout ${r.imported ? 'ok' : 'warn'}"><b>${plural(r.imported, 'book')} imported</b>${skipped ? `, ${plural(skipped, 'row')} skipped` : ''}.</div>
      ${skipped ? `<div class="table-wrap" style="margin:0"><table><thead><tr><th>Line</th><th>Why it was skipped</th></tr></thead><tbody>
        ${r.skipped.map((s) => `<tr><td class="num">${s.line}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="muted">Expected columns: title, author, isbn, category, total_copies.</p>`,
  });
  await refreshAll();
}

async function bookDrawer(bookId) {
  const b = await api('GET', `/api/books/${bookId}`);
  const loans = state.loans.filter((l) => l.book_id === b.id);
  const res = state.reservations.filter((r) => r.book_id === b.id);
  return `
    <div class="d-head">${cover(b.title, true)}<div><h2>${esc(b.title)}</h2><div class="muted">${esc(b.author)}</div><div style="margin-top:6px">${pill(esc(b.category), 'grey')} ${availPill(b)}</div></div></div>
    <div class="d-stats">
      <div class="d-stat"><div class="v">${b.available_copies}<span class="muted">/${b.total_copies}</span></div><div class="l">on the shelf</div></div>
      <div class="d-stat"><div class="v">${b.issued_copies}</div><div class="l">on loan</div></div>
      <div class="d-stat"><div class="v">${b.queue_length + b.held_copies}</div><div class="l">reservations</div></div>
    </div>
    <div class="d-actions">
      ${b.available_copies > 0 || b.held_copies ? `<button class="btn primary" data-act="issue-book" data-book="${b.id}">${icon('arrowOut')}Issue</button>` : `<button class="btn primary" data-act="reserve-book" data-book="${b.id}">${icon('bookmark')}Reserve</button>`}
      <button class="btn" data-act="edit-book" data-id="${b.id}">${icon('edit')}Edit</button>
      <button class="btn danger-ghost" data-act="delete-book" data-id="${b.id}">${icon('trash')}Delete</button>
    </div>
    <div class="d-sec"><h3>Details</h3><dl class="kv"><dt>ISBN</dt><dd class="mono">${esc(b.isbn)}</dd><dt>Category</dt><dd>${esc(b.category)}</dd><dt>Total copies</dt><dd>${b.total_copies}</dd></dl></div>
    <div class="d-sec"><h3>Currently borrowed by</h3>${loans.length ? `<div class="list">${loans.map((l) => `<div class="list-item">${avatar(l.member_name)}<div class="grow"><b>${esc(l.member_name)}</b>
      <div class="muted">Due ${fmtDate(l.due_on)}${l.overdue ? ` · <span style="color:var(--red)">${plural(l.days_overdue, 'day')} late</span>` : ''}</div></div>
      <button class="btn sm" data-act="return" data-id="${l.id}">Return</button></div>`).join('')}</div>` : '<p class="muted">Nobody has this book right now.</p>'}</div>
    <div class="d-sec"><h3>Reservation queue</h3>${res.length ? `<div class="queue">${res.map((r) => `<div class="q-row ${r.status === 'ready' ? 'ready' : ''}">
      <span class="q-pos">${r.status === 'ready' ? icon('check') : r.queue_position}</span><div class="grow"><b>${esc(r.member_name)}</b>
      <div class="muted">${r.status === 'ready' ? `Ready · held until ${fmtDate(r.hold_until)}` : `Waiting since ${fmtDate(r.reserved_on)}`}</div></div></div>`).join('')}</div>` : '<p class="muted">No one is waiting.</p>'}</div>`;
}

// ================================================================ members
renderers.members = async () => {
  for (const b of $$('#member-filter button')) b.classList.toggle('on', b.dataset.v === ui.memberFilter);
  const q = $('#member-q').value.trim().toLowerCase();
  const f = ui.memberFilter;
  const rows = state.members.filter((m) => (!q || memberText(m).toLowerCase().includes(q))
    && (f === 'all' || (f === 'active' && m.active) || (f === 'inactive' && !m.active) || (f === 'fines' && m.unpaid_fines > 0)));
  $('#members-table').innerHTML = table([
    { label: 'Member', render: (m) => who(m.name, `<span class="mono">${esc(m.member_code)}</span>`) },
    { label: 'Contact', render: (m) => `${esc(m.phone) || '<span class="muted">—</span>'}<div class="muted">${esc(m.email)}</div>` },
    { label: 'Joined', render: (m) => fmtDate(m.join_date) },
    { label: 'Status', render: (m) => (m.active ? pill('Active', 'green', true) : pill('Inactive', 'grey', true)) },
    { label: 'Books', render: (m) => `${dots(m.active_issues, RULES.MAX_ACTIVE_ISSUES)} <span class="muted">${m.active_issues}/${RULES.MAX_ACTIVE_ISSUES}</span>` },
    { label: 'Fines', cls: 'num', render: (m) => (m.unpaid_fines ? `<div class="row-actions">${pill(rupees(m.unpaid_fines), 'red')}<button class="btn sm primary" data-act="pay" data-id="${m.id}">Pay</button></div>` : '<span class="muted">—</span>') },
    { label: '', cls: 'num', render: (m) => `<button class="btn sm ghost" data-act="edit-member" data-id="${m.id}" aria-label="Edit">${icon('edit')}</button>` },
  ], rows, q || f !== 'all' ? empty('search', 'No members match') : empty('users', 'No members yet', 'Add your first member to start lending.'),
  (m) => `class="clickable" data-row="member" data-id="${m.id}"`);
};

function memberForm(m = {}) {
  return `
    <label class="field">Full name<input name="name" required maxlength="120" value="${esc(m.name)}"></label>
    <div class="row2">
      <label class="field">Member ID<input name="member_code" maxlength="30" placeholder="Auto, e.g. M0007" value="${esc(m.member_code)}"><small>Leave blank to generate one</small></label>
      <label class="field">Join date<input name="join_date" type="date" max="${TODAY}" value="${esc(m.join_date || TODAY)}"></label>
    </div>
    <div class="row2">
      <label class="field">Phone<input name="phone" type="tel" placeholder="98765 43210" value="${esc(m.phone)}"></label>
      <label class="field">Email<input name="email" type="email" placeholder="name@example.com" value="${esc(m.email)}"></label>
    </div>
    <label class="switch"><input type="checkbox" name="active" ${m.active === 0 ? '' : 'checked'}><span class="track"></span>Active member</label>
    ${m.id && m.open_reservations ? '<div class="callout warn">Making this member inactive cancels their open reservations and passes any held copy to the next person in the queue.</div>' : ''}`;
}
function addMember() {
  openModal({
    title: 'New member', ok: 'Add member', ic: 'userPlus', body: memberForm(),
    onSubmit: async (v) => { const m = await api('POST', '/api/members', { ...v, active: !!v.active }); toast(`Welcome, ${m.name} (${m.member_code}).`, 'ok'); await refreshAll(); },
  });
}
function editMember(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  openModal({
    title: 'Edit member', ic: 'edit', body: memberForm(m),
    onSubmit: async (v) => {
      const r = await api('PUT', `/api/members/${memberId}`, { ...v, active: !!v.active });
      toast(`Saved ${r.name}.${r.cancelledReservations ? ` ${plural(r.cancelledReservations, 'reservation')} cancelled.` : ''}`, 'ok');
      await refreshAll();
    },
  });
}
function payFine(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  openModal({
    title: 'Collect fine', ok: `Mark ${rupees(m.unpaid_fines)} as paid`, tone: 'success', ic: 'wallet', icTone: 'tone-green',
    body: `<div class="sel-card" style="margin:0">${avatar(m.name, true)}<div class="grow"><b>${esc(m.name)}</b><div class="muted">${esc(m.member_code)}</div></div>
      <div style="text-align:right"><div class="muted-s">Owes</div><div class="fine-big" style="color:var(--red)">${rupees(m.unpaid_fines)}</div></div></div>
      <p class="muted">Once paid, ${esc(m.name.split(' ')[0])} can borrow books again.</p>`,
    onSubmit: async () => { const r = await api('POST', `/api/members/${memberId}/pay-fine`); toast(`${rupees(r.paid)} collected from ${r.member.name}.`, 'ok'); await refreshAll(); },
  });
}
async function memberDrawer(memberId) {
  const d = await api('GET', `/api/members/${memberId}`);
  const m = d.member;
  return `
    <div class="d-head">${avatar(m.name, true)}<div><h2>${esc(m.name)}</h2><div class="muted mono">${esc(m.member_code)}</div>
      <div style="margin-top:6px">${m.active ? pill('Active', 'green', true) : pill('Inactive', 'grey', true)}</div></div></div>
    <div class="d-stats">
      <div class="d-stat"><div class="v">${m.active_issues}<span class="muted">/${RULES.MAX_ACTIVE_ISSUES}</span></div><div class="l">books on loan</div></div>
      <div class="d-stat"><div class="v" style="${m.unpaid_fines ? 'color:var(--red)' : ''}">${rupees(m.unpaid_fines)}</div><div class="l">unpaid fines</div></div>
      <div class="d-stat"><div class="v">${m.open_reservations}</div><div class="l">reservations</div></div>
    </div>
    <div class="d-actions">
      ${m.active ? `<button class="btn primary" data-act="issue-to" data-id="${m.id}">${icon('arrowOut')}Issue a book</button>` : ''}
      ${m.unpaid_fines ? `<button class="btn success" data-act="pay" data-id="${m.id}">${icon('wallet')}Collect ${rupees(m.unpaid_fines)}</button>` : ''}
      <button class="btn" data-act="edit-member" data-id="${m.id}">${icon('edit')}Edit</button>
    </div>
    <div class="d-sec"><h3>Contact</h3><dl class="kv"><dt>Phone</dt><dd>${esc(m.phone) || '—'}</dd><dt>Email</dt><dd>${esc(m.email) || '—'}</dd><dt>Joined</dt><dd>${fmtDate(m.join_date)}</dd></dl></div>
    <div class="d-sec"><h3>On loan</h3>${d.activeIssues.length ? `<div class="list">${d.activeIssues.map((l) => `<div class="list-item">${cover(l.title)}<div class="grow"><b>${esc(l.title)}</b>
      <div class="muted">Due ${fmtDate(l.due_on)}${l.overdue ? ` · <span style="color:var(--red)">${plural(l.days_overdue, 'day')} late · ${rupees(l.accrued_fine)}</span>` : ` · ${relDays(l.due_on)}`}</div></div>
      <button class="btn sm" data-act="return" data-id="${l.id}">Return</button></div>`).join('')}</div>` : '<p class="muted">No books on loan.</p>'}</div>
    <div class="d-sec"><h3>Reservations</h3>${d.reservations.length ? `<div class="list">${d.reservations.map((r) => `<div class="list-item">${cover(r.title)}<div class="grow"><b>${esc(r.title)}</b>
      <div class="muted">${r.status === 'ready' ? `<span style="color:var(--green)">Ready — held until ${fmtDate(r.hold_until)}</span>` : `#${r.queue_position} in queue`}</div></div>
      ${r.status === 'ready' ? `<button class="btn sm success" data-act="issue-hold" data-member="${r.member_id}" data-book="${r.book_id}">Issue</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">No open reservations.</p>'}</div>
    <div class="d-sec"><h3>History</h3>${d.history.length ? `<div class="list">${d.history.slice().reverse().map((l) => `<div class="list-item">${cover(l.title)}<div class="grow"><b>${esc(l.title)}</b>
      <div class="muted">Returned ${fmtDate(l.returned_on)}</div></div>${l.fine ? pill(`${rupees(l.fine)} ${l.fine_paid ? 'paid' : 'unpaid'}`, l.fine_paid ? 'grey' : 'red') : pill('On time', 'green')}</div>`).join('')}</div>` : '<p class="muted">No past loans.</p>'}</div>`;
}

// ================================================================ wiring
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) {
    e.stopPropagation();
    const num = (k = 'id') => Number(btn.dataset[k]);
    const acts = {
      'go-issue': () => go('circulation', 'issue'),
      'go-reserve': () => go('reservations'),
      kpi: () => {
        const t = btn.dataset.target;
        if (t === 'overdue') { ui.loanFilter = 'overdue'; go('circulation', 'return'); }
        else if (t === 'members-fines') { ui.memberFilter = 'fines'; go('members'); }
        else if (t === 'circulation/return') { ui.loanFilter = 'active'; go('circulation', 'return'); }
        else go(t);
      },
      'add-book': addBook,
      import: () => $('#import-file').click(),
      'edit-book': () => editBook(num()),
      'delete-book': () => deleteBook(num()),
      'view-book': () => openDrawer(() => bookDrawer(num())),
      'issue-book': () => { closeDrawer(); go('circulation', 'issue'); pickers['pk-issue-book'].setByKey(num('book')); if (!pickers['pk-issue-member'].item) setTimeout(() => pickers['pk-issue-member'].focus(), 50); },
      'reserve-book': () => { closeDrawer(); go('reservations'); pickers['pk-res-book'].setByKey(num('book')); setTimeout(() => pickers['pk-res-member'].focus(), 50); },
      'reserve-this': () => { const m = pickers['pk-issue-member'].item; const b = pickers['pk-issue-book'].item; go('reservations'); if (m) pickers['pk-res-member'].set(m); if (b) pickers['pk-res-book'].setByKey(b.id); },
      'add-member': addMember,
      'edit-member': () => editMember(num()),
      'view-member': () => openDrawer(() => memberDrawer(num())),
      'issue-to': () => { closeDrawer(); go('circulation', 'issue'); pickers['pk-issue-member'].setByKey(num()); setTimeout(() => pickers['pk-issue-book'].focus(), 50); },
      pay: () => payFine(num()),
      return: () => returnBook(num()),
      'cancel-res': () => cancelReservation(num()),
      'issue-hold': () => quickIssue(num('member'), num('book')),
    };
    Promise.resolve(acts[btn.dataset.act]?.()).catch(fail);
    return;
  }
  const row = e.target.closest('tr[data-row]');
  if (row) {
    const rid = Number(row.dataset.id);
    openDrawer(() => (row.dataset.row === 'book' ? bookDrawer(rid) : memberDrawer(rid)));
  }
});

$$('[data-go]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.go;
  if (t === 'issue') go('circulation', 'issue');
  else if (t === 'return') { ui.loanFilter = 'active'; go('circulation', 'return'); }
  else if (t === 'reserve') go('reservations');
  else if (t === 'add-member') addMember();
}));

function segmented(sel, key, after) {
  $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    ui[key] = b.dataset.v;
    (after || (() => render()))().catch?.(fail);
  });
}
segmented('#loan-filter', 'loanFilter');
segmented('#res-filter', 'resFilter');
segmented('#book-field', 'bookField');
segmented('#member-filter', 'memberFilter');
$('#circ-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) go('circulation', b.dataset.tab); });
$('#cat-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) { ui.category = c.dataset.cat; render().catch(fail); } });

let debounce;
for (const id of ['#book-q', '#member-q', '#loan-q']) {
  $(id).addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => render().catch(fail), 180); });
}
$('#book-avail').addEventListener('change', () => render().catch(fail));

$('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f).catch(fail); });
$('#issue-form').addEventListener('submit', submitIssue);
$('#issue-form').issuedOn.addEventListener('change', () => { const on = $('#due-chips .chip.on'); setDue(on ? Number(on.dataset.days) : RULES.LOAN_DAYS); });
$('#issue-form').dueOn.addEventListener('change', () => $$('#due-chips .chip').forEach((c) => c.classList.remove('on')));
$('#due-chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) setDue(Number(c.dataset.days)); });
$('#reserve-form').addEventListener('submit', submitReserve);

$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-scrim').addEventListener('click', closeDrawer);
$('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
$('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawerState && !$('#modal').open) closeDrawer();
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#modal').open) {
    const s = $(`#view-${ui.view} [data-slash]`) || $(`#view-${ui.view} .picker-input`);
    if (s) { e.preventDefault(); s.focus(); }
  }
});

// theme
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme-btn').innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
}
let savedTheme = null;
try { savedTheme = localStorage.getItem('lib-theme'); } catch { /* storage unavailable */ }
applyTheme(savedTheme);
$('#theme-btn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem('lib-theme', next); } catch { /* ignore */ }
  applyTheme(next);
});

// pickers
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

hydrateIcons();
window.addEventListener('hashchange', route);
(async () => {
  try {
    await refreshAll();
    resetIssueForm();
    route();
  } catch (err) { fail(err); }
})();
