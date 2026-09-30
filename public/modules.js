'use strict';
/* Library modules added on top of the core app:
 *   • Acquisitions  — purchase requests → ordered → received (copies join the catalogue)
 *   • Digital Library — e-books, journals, audiobooks, videos, websites, databases
 *   • Reports       — 9 reports with date ranges, summaries, CSV export and printing
 *   • Barcode / RFID — scan boxes on Issue Book and Return Book, printable book labels
 *   • Memberships   — renew / extend a membership
 * Uses the helpers and state from app.js (api, state, ui, PAGES, renderers, openModal, …).
 */
(() => {
  Object.assign(ICONS, {
    barcode: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  });
  // app.js already drew the page's icons before these were registered, so redraw the new ones
  const NEW_ICONS = ['barcode', 'cart', 'truck', 'globe', 'play', 'headphones', 'external', 'chart', 'database'];
  for (const el of $$('[data-icon]')) if (NEW_ICONS.includes(el.dataset.icon)) el.innerHTML = icon(el.dataset.icon);
  const kpiTile = (label, val, ic, tone, foot) => `<div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ico ${tone}">${icon(ic)}</span></div><div class="kpi-val">${val}</div><div class="kpi-foot">${foot}</div></div>`;
  const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const thisMonth = () => TODAY.slice(0, 7);

  // =================================================================== ACQUISITIONS
  PAGES.acquisitions = { title: 'Acquisitions', sub: () => 'Request, order and receive new books. Received copies join the catalogue automatically.' };
  ui.acqFilter = 'all';
  const ACQ_TONE = { requested: 'blue', ordered: 'amber', received: 'green', cancelled: '' };

  renderers.acquisitions = async () => {
    const all = await api('GET', '/api/acquisitions');
    state.acquisitions = all;
    const f = ui.acqFilter;
    const q = ($('#acq-q')?.value || '').trim().toLowerCase();
    const rows = all.filter((a) => (f === 'all' || a.status === f) && (!q || `${a.title} ${a.author} ${a.isbn} ${a.vendor}`.toLowerCase().includes(q)));
    const count = (s) => all.filter((a) => a.status === s);
    const pendingCost = [...count('requested'), ...count('ordered')].reduce((t, a) => t + a.total_cost, 0);
    const recvMonth = count('received').filter((a) => (a.received_on || '').startsWith(thisMonth()));
    const el = $('#view-acquisitions');
    const qVal = $('#acq-q')?.value || '';
    el.innerHTML = `
      <div class="kpis">
        ${kpiTile('Requested', count('requested').length, 'cart', 'tone-blue', 'awaiting approval / order')}
        ${kpiTile('On order', count('ordered').length, 'truck', 'tone-amber', `${rupees(count('ordered').reduce((t, a) => t + a.total_cost, 0))} to be delivered`)}
        ${kpiTile('Received this month', recvMonth.reduce((t, a) => t + a.quantity, 0), 'checkCircle', 'tone-green', `copies · ${plural(recvMonth.length, 'purchase')}`)}
        ${kpiTile('Spent this month', rupees(recvMonth.reduce((t, a) => t + a.total_cost, 0)), 'wallet', 'tone-violet', `${rupees(pendingCost)} still pending`)}
      </div>
      <div class="card">
        <div class="card-toolbar">
          <div class="search"><span data-icon="search"></span><input id="acq-q" type="search" placeholder="Search title, author, ISBN or vendor…" value="${esc(qVal)}" data-slash></div>
          <div class="segmented" id="acq-filter">${['all', 'requested', 'ordered', 'received', 'cancelled'].map((s) => `<button data-v="${s}" class="${f === s ? 'on' : ''}">${capWord(s)}${s !== 'all' ? ` <span class="tab-count">${count(s).length}</span>` : ''}</button>`).join('')}</div>
        </div>
        <div class="acq-flow"><span class="${f === 'requested' ? 'on' : ''}">${icon('cart')}Requested</span>${icon('chevRight')}<span class="${f === 'ordered' ? 'on' : ''}">${icon('truck')}Ordered</span>${icon('chevRight')}<span class="${f === 'received' ? 'on' : ''}">${icon('checkCircle')}Received → added to catalogue</span></div>
        ${table([
          { label: 'Title', render: (a) => bookWho(a.title, `${esc(a.author)} · <span class="mono">${esc(a.isbn)}</span>`) },
          { label: 'Vendor', render: (a) => esc(a.vendor) || '<span class="muted">—</span>' },
          { label: 'Qty', cls: 'num', render: (a) => a.quantity },
          { label: 'Cost', cls: 'num', render: (a) => `<b>${rupees(a.total_cost)}</b><div class="sub">${rupees(a.unit_cost)} each</div>` },
          { label: 'Status', render: (a) => `${badge(capWord(a.status), ACQ_TONE[a.status], true)}<div class="sub">${a.status === 'received' ? `on ${fmtShort(a.received_on)}` : a.status === 'ordered' ? `since ${fmtShort(a.ordered_on)}` : `requested ${fmtShort(a.requested_on)}`}</div>` },
          { label: '', cls: 'num', render: (a) => `<div class="row-actions">${
            a.status === 'requested' ? `<button class="btn sm" data-act="order-acq" data-id="${a.id}">${icon('truck')}Order</button>` : ''}${
            a.status === 'requested' || a.status === 'ordered' ? `<button class="btn sm success" data-act="receive-acq" data-id="${a.id}">${icon('checkCircle')}Receive</button>
              <button class="btn sm icon" data-act="edit-acq" data-id="${a.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>
              <button class="btn sm icon danger-soft" data-act="cancel-acq" data-id="${a.id}" title="Cancel" aria-label="Cancel">${icon('x')}</button>` : ''}${
            a.status === 'received' && a.book_id ? `<button class="btn sm ghost" data-act="view-book" data-id="${a.book_id}">In catalogue${icon('chevRight')}</button>` : ''}</div>` },
        ], rows, empty('cart', q || f !== 'all' ? 'No purchases match' : 'No purchases yet', q || f !== 'all' ? '' : 'Click “New purchase request” to order books.'))}
      </div>`;
    hydrateIcons(el);
    $('#acq-q').addEventListener('input', debounceRender);
  };
  let dT;
  const debounceRender = () => { clearTimeout(dT); dT = setTimeout(() => render().then(() => { const i = $(`#view-${ui.view} input[data-slash]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }).catch(fail), 250); };

  function acqForm(a = {}) {
    const cats = [...new Set(state.books.map((x) => x.category))].sort();
    return `
      <label class="field">Title <input name="title" required maxlength="200" value="${esc(a.title)}" list="acq-titles" placeholder="Book title"></label>
      <datalist id="acq-titles">${state.books.map((b) => `<option value="${esc(b.title)}">`).join('')}</datalist>
      <div class="row2">
        <label class="field">Author <input name="author" required maxlength="200" value="${esc(a.author)}"></label>
        <label class="field">ISBN <input name="isbn" required value="${esc(a.isbn)}" placeholder="10 or 13 digits"><small id="acq-isbn-note">An existing ISBN adds copies to that book.</small></label>
      </div>
      <div class="row2">
        <label class="field">Category <input name="category" list="acq-cats" maxlength="80" value="${esc(a.category)}" placeholder="General"></label>
        <label class="field">Vendor / supplier <input name="vendor" maxlength="120" value="${esc(a.vendor)}" placeholder="e.g. Sapna Book House"></label>
      </div>
      <datalist id="acq-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="row2">
        <label class="field">Quantity <input name="quantity" type="number" min="1" step="1" required value="${esc(a.quantity ?? 1)}"></label>
        <label class="field">Cost per copy (₹) <input name="unit_cost" type="number" min="0" step="1" value="${esc(a.unit_cost ?? '')}" placeholder="0"></label>
      </div>
      <label class="field">Notes <input name="notes" maxlength="500" value="${esc(a.notes)}" placeholder="optional, e.g. requested by the science department"></label>`;
  }
  function wireAcqForm() {
    const title = $('#modal-body [name=title]');
    const isbn = $('#modal-body [name=isbn]');
    const note = $('#acq-isbn-note');
    const fill = () => {
      const b = state.books.find((x) => x.title.toLowerCase() === title.value.trim().toLowerCase());
      if (b && !isbn.value) {
        isbn.value = b.isbn;
        $('#modal-body [name=author]').value ||= b.author;
        $('#modal-body [name=category]').value ||= b.category;
      }
      check();
    };
    const check = () => {
      const v = isbn.value.replace(/[\s-]/g, '');
      const b = state.books.find((x) => x.isbn === v);
      note.innerHTML = b ? `<span class="t-green">Adds copies to “${esc(b.title)}” (now ${b.total_copies}).</span>` : 'A new ISBN creates a new book in the catalogue.';
    };
    title.addEventListener('change', fill);
    isbn.addEventListener('input', check);
    check();
  }
  const numBody = (v) => ({ ...v, quantity: Number(v.quantity), unit_cost: v.unit_cost === '' ? 0 : Number(v.unit_cost) });
  function addAcq() {
    openModal({
      title: 'New purchase request', sub: 'Request books to buy. Order and receive them later.', ok: 'Create request', ic: 'cart', body: acqForm(), onOpen: wireAcqForm,
      onSubmit: async (v) => { const a = await api('POST', '/api/acquisitions', numBody(v)); toast(`${plural(a.quantity, 'copy', 'copies')} · ${rupees(a.total_cost)}`, 'ok', { title: `Requested “${a.title}”` }); await render(); },
    });
  }
  function editAcq(acqId) {
    const a = state.acquisitions.find((x) => x.id === acqId);
    openModal({
      title: 'Edit purchase', sub: a.title, ok: 'Save changes', ic: 'edit', body: acqForm(a), onOpen: wireAcqForm,
      onSubmit: async (v) => { await api('PUT', `/api/acquisitions/${acqId}`, numBody(v)); toast('Purchase updated.', 'ok'); await render(); },
    });
  }
  async function actAcq(acqId, action) {
    const a = state.acquisitions.find((x) => x.id === acqId);
    if (action === 'receive') {
      const existing = state.books.find((b) => b.isbn === a.isbn);
      openModal({
        title: 'Receive delivery', sub: `${a.title} · ${plural(a.quantity, 'copy', 'copies')}`, ok: 'Receive & add to catalogue', tone: 'success', ic: 'checkCircle', icTone: 'tone-green',
        body: `<div class="callout ${existing ? 'info' : 'ok'}">${icon(existing ? 'info' : 'plus')}<span>${existing
          ? `Adds ${plural(a.quantity, 'copy', 'copies')} to <b>${esc(existing.title)}</b>: ${existing.total_copies} → <b>${existing.total_copies + a.quantity}</b> copies. Members waiting in its reservation queue get the new copies first.`
          : `Creates <b>${esc(a.title)}</b> in the catalogue with ${plural(a.quantity, 'copy', 'copies')} on the shelf.`}</span></div>`,
        onSubmit: async () => {
          const r = await api('POST', `/api/acquisitions/${acqId}/receive`);
          toast(r.createdBook ? 'New book added to the catalogue.' : `${r.book.title} now has ${r.book.total_copies} copies.`, 'ok', { title: 'Delivery received' });
          for (const p of r.promoted || []) toast(`A new copy is held for ${p.memberName}.`, 'info', { title: 'Ready for pickup' });
          await refreshAll();
        },
      });
      return;
    }
    if (action === 'cancel') {
      openModal({
        title: 'Cancel this purchase?', sub: a.title, ok: 'Cancel purchase', cancel: 'Keep it', tone: 'danger', ic: 'x', icTone: 'tone-red', body: '<p class="muted">The request stays in the history as cancelled.</p>',
        onSubmit: async () => { await api('POST', `/api/acquisitions/${acqId}/cancel`); toast('Purchase cancelled.', 'ok'); await render(); },
      });
      return;
    }
    try { await api('POST', `/api/acquisitions/${acqId}/order`); toast(`Ordered from ${a.vendor || 'the vendor'}.`, 'ok', { title: `“${a.title}” ordered` }); await render(); } catch (err) { fail(err); }
  }

  // =================================================================== DIGITAL LIBRARY
  PAGES.digital = { title: 'Digital Library', sub: () => 'E-books, journals, audiobooks, videos and online databases.' };
  ui.digType = 'all';
  const DIG_ICON = { 'E-book': 'book', Journal: 'file', Audiobook: 'headphones', Video: 'play', Website: 'globe', Database: 'database' };
  const DIG_TONE = { 'E-book': 'tone-indigo', Journal: 'tone-blue', Audiobook: 'tone-violet', Video: 'tone-red', Website: 'tone-green', Database: 'tone-amber' };

  renderers.digital = async () => {
    const q = $('#dig-q')?.value || '';
    const all = await api('GET', '/api/digital');
    state.digital = all;
    const t = ui.digType;
    const rows = all.filter((r) => (t === 'all' || r.type === t) && (!q || `${r.title} ${r.author} ${r.category}`.toLowerCase().includes(q.toLowerCase())));
    const types = Object.keys(DIG_ICON);
    const el = $('#view-digital');
    el.innerHTML = `
      <div class="kpis">
        ${kpiTile('Resources', all.length, 'layers', 'tone-indigo', `${types.filter((x) => all.some((r) => r.type === x)).length} types`)}
        ${kpiTile('Total views', all.reduce((s, r) => s + r.views, 0), 'activity', 'tone-green', 'times opened from here')}
        ${kpiTile('Open access', all.filter((r) => r.access === 'Open').length, 'globe', 'tone-blue', 'free for everyone')}
        ${kpiTile('Members only', all.filter((r) => r.access === 'Members only').length, 'user', 'tone-amber', 'check the member card first')}
      </div>
      <div class="card">
        <div class="card-toolbar">
          <div class="search"><span data-icon="search"></span><input id="dig-q" type="search" placeholder="Search title, author or category…" value="${esc(q)}" data-slash></div>
        </div>
        <div class="act-chips" id="dig-types">${['all', ...types].map((x) => {
          const n = x === 'all' ? all.length : all.filter((r) => r.type === x).length;
          return `<button class="chip ${t === x ? 'on' : ''}" data-dtype="${x}">${x === 'all' ? 'All' : x}<span class="chip-n">${n}</span></button>`;
        }).join('')}</div>
        ${rows.length ? `<div class="dig-grid">${rows.map((r) => `<article class="dig-card">
          <div class="dig-top"><span class="kpi-ico ${DIG_TONE[r.type]}">${icon(DIG_ICON[r.type])}</span>
            <div class="dig-badges">${badge(esc(r.type))}${r.access === 'Open' ? badge('Open', 'green', true) : badge('Members only', 'amber', true)}</div></div>
          <h3>${esc(r.title)}</h3>
          <div class="sub">${esc(r.author) || '&nbsp;'}</div>
          <p class="dig-desc">${esc(r.description) || '&nbsp;'}</p>
          <div class="dig-meta"><span>${esc(r.category)}</span><span>${plural(r.views, 'view')}</span></div>
          <div class="dig-actions"><button class="btn sm primary" data-act="open-digital" data-id="${r.id}">${icon('external')}Open</button>
            <button class="btn sm icon" data-act="edit-digital" data-id="${r.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>
            <button class="btn sm icon danger-soft" data-act="delete-digital" data-id="${r.id}" title="Delete" aria-label="Delete">${icon('trash')}</button></div>
        </article>`).join('')}</div>` : empty('layers', q || t !== 'all' ? 'Nothing matches' : 'No digital resources yet', q || t !== 'all' ? '' : 'Add e-books, journals or links your members can use.')}
      </div>`;
    hydrateIcons(el);
    $('#dig-q').addEventListener('input', debounceRender);
  };
  function digForm(r = {}) {
    const opt = (list, cur) => list.map((v) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    return `
      <label class="field">Title <input name="title" required maxlength="200" value="${esc(r.title)}"></label>
      <div class="row2">
        <label class="field">Author / publisher <input name="author" maxlength="200" value="${esc(r.author)}"></label>
        <label class="field">Category <input name="category" maxlength="80" value="${esc(r.category)}" placeholder="General"></label>
      </div>
      <label class="field">Link (URL) <input name="url" type="url" required maxlength="500" value="${esc(r.url)}" placeholder="https://…"></label>
      <div class="row2">
        <label class="field">Type <select name="type">${opt(Object.keys(DIG_ICON), r.type || 'E-book')}</select></label>
        <label class="field">Access <select name="access">${opt(['Open', 'Members only'], r.access || 'Open')}</select></label>
      </div>
      <label class="field">Description <input name="description" maxlength="500" value="${esc(r.description)}" placeholder="optional"></label>`;
  }
  function addDigital() {
    openModal({
      title: 'Add digital resource', ok: 'Add resource', ic: 'layers', body: digForm(),
      onSubmit: async (v) => { const r = await api('POST', '/api/digital', v); toast(r.type, 'ok', { title: `Added “${r.title}”` }); await render(); },
    });
  }
  function editDigital(resId) {
    const r = state.digital.find((x) => x.id === resId);
    openModal({
      title: 'Edit digital resource', sub: r.title, ok: 'Save changes', ic: 'edit', body: digForm(r),
      onSubmit: async (v) => { await api('PUT', `/api/digital/${resId}`, v); toast('Saved.', 'ok'); await render(); },
    });
  }
  function deleteDigital(resId) {
    const r = state.digital.find((x) => x.id === resId);
    openModal({
      title: 'Delete this resource?', sub: r.title, ok: 'Delete', tone: 'danger', ic: 'trash', icTone: 'tone-red', body: '<p class="muted">It will no longer appear in the Digital Library.</p>',
      onSubmit: async () => { await api('DELETE', `/api/digital/${resId}`); toast('Resource deleted.', 'ok'); await render(); },
    });
  }
  async function openDigital(resId) {
    const w = window.open('about:blank', '_blank'); // open synchronously so pop-up blockers allow it
    try {
      const r = await api('POST', `/api/digital/${resId}/open`);
      if (w) { w.opener = null; w.location.href = r.url; } else window.location.href = r.url;
      const card = state.digital.find((x) => x.id === resId); if (card) card.views = r.views;
      render().catch(() => {});
    } catch (err) { if (w) w.close(); fail(err); }
  }

  // =================================================================== REPORTS
  PAGES.reports = { title: 'Reports', sub: () => 'Choose a report and a period. Export to CSV or print.' };
  ui.report = 'circulation';
  ui.repFrom = null;
  ui.repTo = null;
  const REPORT_META = {
    circulation: ['activity', 'Issues and returns over time'], overdue: ['alert', 'Loans past their due date'], fines: ['wallet', 'Charged, collected, outstanding'],
    popular: ['trend', 'Most borrowed titles'], categories: ['layers', 'Loans and stock by category'], members: ['users', 'Borrowing per member'],
    inventory: ['book', 'Stock of every title'], acquisitions: ['cart', 'Purchases and spending'], digital: ['globe', 'Views of digital resources'],
  };
  const REPORT_TITLES = {
    circulation: 'Circulation summary', overdue: 'Overdue loans', fines: 'Fines', popular: 'Most borrowed books', categories: 'Category usage',
    members: 'Member activity', inventory: 'Inventory / stock', acquisitions: 'Acquisitions & spending', digital: 'Digital resource usage',
  };
  const reportUrl = (fmt = '') => `/api/report/${ui.report}${fmt}?from=${ui.repFrom}&to=${ui.repTo}`;

  renderers.reports = async () => {
    ui.repTo ||= TODAY;
    ui.repFrom ||= addDays(TODAY, -29);
    const el = $('#view-reports');
    const r = await api('GET', reportUrl());
    state.lastReport = r;
    const ranges = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['year', 'This year']];
    const noPeriod = ['overdue', 'inventory', 'digital'].includes(ui.report);
    el.innerHTML = `
      <div class="rep-layout">
        <nav class="card rep-list" aria-label="Reports">${Object.entries(REPORT_TITLES).map(([k, t]) => `<button class="rep-item ${ui.report === k ? 'on' : ''}" data-report="${k}">
          <span class="kpi-ico tone-indigo">${icon(REPORT_META[k][0])}</span><span><b>${t}</b><small>${REPORT_META[k][1]}</small></span></button>`).join('')}</nav>
        <section class="rep-main">
          <div class="card pad rep-head">
            <div class="grow"><h2>${esc(r.title)}</h2><p class="muted small">${esc(r.description)} ${noPeriod ? '' : `· ${fmtDate(r.period.from)} – ${fmtDate(r.period.to)} (${plural(r.period.days, 'day')})`}</p></div>
            ${noPeriod ? '<span class="badge">As of today</span>' : `<div class="rep-range">
              <div class="chips" style="margin:0">${ranges.map(([k, l]) => `<button class="chip" data-range="${k}">${l}</button>`).join('')}</div>
              <label class="field">From <input type="date" id="rep-from" value="${ui.repFrom}" max="${TODAY}"></label>
              <label class="field">To <input type="date" id="rep-to" value="${ui.repTo}" max="${TODAY}"></label></div>`}
          </div>
          <div class="rep-summary">${r.summary.map((s) => `<div class="act-stat"><div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div></div>`).join('')}</div>
          <div class="card">${table(r.columns.map((c) => ({ label: c.label, cls: c.num ? 'num' : '', render: (row) => esc(row[c.key] ?? '') })),
            r.rows, empty('chart', 'No data for this period', 'Try a longer date range.'))}
            <div class="card-foot"><span class="muted small">${plural(r.rows.length, 'row')} · generated ${fmtDate(r.generated_on)}</span></div></div>
        </section>
      </div>`;
    hydrateIcons(el);
    const setRange = () => { ui.repFrom = $('#rep-from').value || ui.repFrom; ui.repTo = $('#rep-to').value || ui.repTo; render().catch(fail); };
    $('#rep-from')?.addEventListener('change', setRange);
    $('#rep-to')?.addEventListener('change', setRange);
  };
  function printReport() {
    const r = state.lastReport;
    if (!r) return;
    printDoc(`<div class="p-report"><h1>${esc(r.title)}</h1><div class="p-sub">${esc(r.description)} · ${fmtDate(r.period.from)} – ${fmtDate(r.period.to)} · Library Desk</div>
      <div class="p-sum">${r.summary.map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>
      <table><thead><tr>${r.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td>${esc(row[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }

  // =================================================================== BARCODE / RFID SCANNING
  // Scanners and RFID readers in keyboard mode "type" the code and press Enter.
  async function handleScan(input, where) {
    const code = input.value.trim();
    input.value = '';
    if (!code) return;
    let r;
    try { r = await api('GET', `/api/scan?code=${encodeURIComponent(code)}`); } catch (err) { fail(err); return; }
    const flash = (ok) => { input.classList.remove('scan-ok', 'scan-bad'); void input.offsetWidth; input.classList.add(ok ? 'scan-ok' : 'scan-bad'); };
    if (r.kind === 'none') { flash(false); toast(`“${code}” is not a member card or a book in the catalogue.`, 'warn', { title: 'Unknown code' }); return; }
    flash(true);
    if (where === 'issue') {
      if (r.kind === 'member') {
        pickers['pk-issue-member'].setByKey(r.member.id);
        if (!pickers['pk-issue-member'].item) { toast(`${r.member.name} is inactive and can't borrow.`, 'warn'); return; }
        toast(`${r.member.member_code} · now scan the book`, 'ok', { title: r.member.name });
      } else {
        pickers['pk-issue-book'].setByKey(r.book.id);
        toast(`${r.book.available_copies} of ${r.book.total_copies} on the shelf`, 'ok', { title: r.book.title });
      }
      $('#issue-scan-status').innerHTML = scanStatus();
      input.focus();
      return;
    }
    // returns
    if (r.kind === 'member') {
      $('#loan-q').value = r.member.member_code;
      ui.loanFilter = 'active';
      await render();
      toast(`${plural(r.member.active_issues, 'book')} on loan — scan a book to return it.`, 'info', { title: r.member.name });
    } else if (r.loans.length === 1) {
      returnBook(r.loans[0].id);
    } else if (r.loans.length > 1) {
      $('#loan-q').value = r.book.isbn;
      await render();
      toast(`${r.loans.length} copies of this book are on loan — choose which one is being returned.`, 'info', { title: r.book.title });
    } else {
      toast('No copy of this book is on loan right now.', 'warn', { title: r.book.title });
    }
    $('#scan-return')?.focus();
  }
  function scanStatus() {
    const m = pickers['pk-issue-member']?.item;
    const b = pickers['pk-issue-book']?.item;
    return `<span class="${m ? 'done' : ''}">${icon(m ? 'checkCircle' : 'user')}${m ? esc(m.name) : 'Member card'}</span>
      <span class="${b ? 'done' : ''}">${icon(b ? 'checkCircle' : 'book')}${b ? esc(b.title) : 'Book barcode'}</span>`;
  }
  $('#scan-issue')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(e.target, 'issue'); } });
  $('#scan-return')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(e.target, 'return'); } });
  const issueStatus = $('#issue-scan-status');
  if (issueStatus) {
    issueStatus.innerHTML = scanStatus();
    document.addEventListener('click', () => setTimeout(() => { issueStatus.innerHTML = scanStatus(); }, 50));
  }

  function printLabel(bookId) {
    const b = state.books.find((x) => x.id === bookId);
    if (!b) return;
    const one = `<div class="p-label"><div class="p-label-t">${esc(b.title)}</div><div class="p-label-a">${esc(b.author)}${b.shelf ? ` · Shelf ${esc(b.shelf)}` : ''}</div>
      ${Barcode.ean13(b.isbn, { height: 44, module: 1.5 })}</div>`;
    printDoc(`<div class="p-labels">${Array.from({ length: Math.max(1, b.total_copies) }, () => one).join('')}</div>`);
  }

  // =================================================================== MEMBERSHIP RENEWAL
  function renewMembership(memberId) {
    const m = state.members.find((x) => x.id === memberId);
    if (!m) return;
    const expired = memberExpired(m);
    openModal({
      title: expired ? 'Renew membership' : 'Extend membership', sub: `${m.name} · ${m.membership_type || 'General'}`, ok: 'Renew', tone: 'primary', ic: 'renew',
      body: `<div class="callout ${expired ? 'bad' : 'info'}">${icon(expired ? 'alert' : 'info')}<span>${m.valid_until
        ? `${expired ? 'Expired on' : 'Currently valid until'} <b>${fmtDate(m.valid_until)}</b>.` : 'This membership has no expiry date yet.'}
        The new period starts from ${expired || !m.valid_until ? 'today' : 'the current expiry date'}.</span></div>
        <label class="field">Renew for <select name="months"><option value="6">6 months</option><option value="12" selected>1 year</option><option value="24">2 years</option><option value="36">3 years</option></select></label>`,
      onSubmit: async (v) => {
        const r = await api('POST', `/api/members/${memberId}/renew-membership`, { months: Number(v.months) });
        toast(`Valid until ${fmtDate(r.valid_until)}.`, 'ok', { title: `${r.name}'s membership renewed` });
        await refreshAll();
      },
    });
  }

  // =================================================================== wiring
  document.addEventListener('click', (e) => {
    const f = e.target.closest('#acq-filter button[data-v]');
    if (f) { ui.acqFilter = f.dataset.v; render().catch(fail); return; }
    const dt = e.target.closest('#dig-types [data-dtype]');
    if (dt) { ui.digType = dt.dataset.dtype; render().catch(fail); return; }
    const rep = e.target.closest('[data-report]');
    if (rep) { ui.report = rep.dataset.report; render().catch(fail); return; }
    const rg = e.target.closest('.rep-range [data-range]');
    if (rg) {
      const k = rg.dataset.range;
      ui.repTo = TODAY;
      ui.repFrom = k === 'month' ? `${TODAY.slice(0, 7)}-01` : k === 'year' ? `${TODAY.slice(0, 4)}-01-01` : addDays(TODAY, -(Number(k) - 1));
      render().catch(fail);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const idOf = () => Number(btn.dataset.id);
    const acts = {
      'add-acq': addAcq, 'edit-acq': () => editAcq(idOf()), 'order-acq': () => actAcq(idOf(), 'order'),
      'receive-acq': () => actAcq(idOf(), 'receive'), 'cancel-acq': () => actAcq(idOf(), 'cancel'),
      'add-digital': addDigital, 'edit-digital': () => editDigital(idOf()), 'delete-digital': () => deleteDigital(idOf()), 'open-digital': () => openDigital(idOf()),
      'print-report': printReport, 'export-report': () => { location.href = reportUrl('.csv'); },
      'print-label': () => printLabel(idOf()),
      'renew-membership': () => { closeModal(); renewMembership(idOf()); },
    };
    if (acts[btn.dataset.act]) { e.stopPropagation(); acts[btn.dataset.act](); }
  });

  COMMANDS.push(
    { label: 'New purchase request', ic: 'cart', kw: 'acquisition buy order vendor', run: () => { go('acquisitions'); addAcq(); } },
    { label: 'Go to Acquisitions', ic: 'truck', kw: 'purchases orders vendor', run: () => go('acquisitions') },
    { label: 'Go to Digital Library', ic: 'globe', kw: 'ebook e-book journal online', run: () => go('digital') },
    { label: 'Add digital resource', ic: 'plus', kw: 'ebook link journal', run: () => { go('digital'); addDigital(); } },
    { label: 'Go to Reports', ic: 'chart', kw: 'report statistics export', run: () => go('reports') },
    { label: 'Scan a barcode to issue', ic: 'barcode', kw: 'scan rfid barcode issue', run: () => { go('issue'); setTimeout(() => $('#scan-issue')?.focus(), 80); } },
    { label: 'Scan a barcode to return', ic: 'barcode', kw: 'scan rfid barcode return', run: () => { go('returns'); setTimeout(() => $('#scan-return')?.focus(), 80); } },
  );
})();
