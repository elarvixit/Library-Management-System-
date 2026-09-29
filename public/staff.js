'use strict';
/* Library Staff — who works at the library and who did what.
 *  • Staff page: details, role, shift, status and each person's activity (today and all time)
 *  • "On duty" switcher in the top bar: the chosen staff member is sent with every request
 *    (X-Staff-Id) and recorded on issues, returns, fine collections and reservations
 *  • Rule (enforced by the server/database): at least one active Admin must always remain
 */
(() => {
  const ROLE_TONE = { Admin: 'indigo', Librarian: 'blue', Assistant: '' };
  const ROLE_DESC = {
    Admin: 'Manages staff and settings; full access',
    Librarian: 'Runs the desk: issues, returns, reservations, fines',
    Assistant: 'Helps at the desk: issues, returns and reservations',
  };
  const roleBadge = (role) => badge(esc(role), ROLE_TONE[role] ?? '');
  const staffAvatar = (s, size = '') => `<span class="avatar ${size}" style="background:hsl(${(hue(s.name) + 180) % 360} 45% 42%)">${esc(initials(s.name))}</span>`;

  // ---------------------------------------------------------------- page
  PAGES.staff = {
    title: 'Library Staff',
    sub: () => {
      const active = state.staff.filter((s) => s.active);
      const admins = active.filter((s) => s.role === 'Admin');
      return `${plural(active.length, 'active staff member')} · ${plural(admins.length, 'admin')} · on duty now: ${onDuty()?.name ?? '—'}`;
    },
  };
  ui.staffFilter = 'all';

  renderers.staff = async () => {
    const list = state.staff;
    const f = ui.staffFilter;
    const rows = list.filter((s) => f === 'all' || (f === 'active' && s.active) || (f === 'inactive' && !s.active) || s.role === f);
    const actionsToday = list.reduce((t, s) => t + s.issued_today + s.returned_today, 0);
    const kpi = (label, val, ic, tone, foot) => `<div class="kpi" style="cursor:default"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ico ${tone}">${icon(ic)}</span></div><div class="kpi-val">${val}</div><div class="kpi-foot">${foot}</div></div>`;
    const duty = onDuty();
    $('#view-staff').innerHTML = `
      <div class="kpis">
        ${kpi('Total staff', list.length, 'users', 'tone-indigo', `${list.filter((s) => s.active).length} active`)}
        ${kpi('Admins', list.filter((s) => s.role === 'Admin' && s.active).length, 'idCard', 'tone-violet', 'full access')}
        ${kpi('Librarians', list.filter((s) => s.role === 'Librarian' && s.active).length, 'book', 'tone-blue', `${list.filter((s) => s.role === 'Assistant' && s.active).length} assistants`)}
        ${kpi('Desk actions today', actionsToday, 'activity', 'tone-green', 'issues + returns')}
      </div>
      ${duty ? `<div class="card pad duty-card">${staffAvatar(duty, 'lg')}
        <div class="grow"><div class="muted-s">On duty now</div><b>${esc(duty.name)}</b>
          <div class="sub">${esc(duty.staff_code)} · ${esc(duty.role)} · ${esc(duty.shift)} shift</div></div>
        <div class="duty-stats"><div><b>${duty.issued_today}</b><span>issued today</span></div><div><b>${duty.returned_today}</b><span>returned today</span></div></div>
        <button class="btn" data-act="switch-staff">${icon('repeat')}Switch staff</button></div>` : ''}
      <div class="card">
        <div class="card-toolbar"><div class="segmented" id="staff-filter">
          ${[['all', 'All'], ['Admin', 'Admins'], ['Librarian', 'Librarians'], ['Assistant', 'Assistants'], ['inactive', 'Inactive']]
            .map(([v, l]) => `<button data-v="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <span class="spacer"></span><span class="result-count">${plural(rows.length, 'staff member')}</span></div>
        ${table([
          { label: 'Staff member', render: (s) => `<div class="who">${staffAvatar(s)}<div><b>${esc(s.name)}${s.id === ui.staffId ? ' <span class="badge green" style="margin-left:6px"><span class="dot"></span>On duty</span>' : ''}</b><div class="sub mono">${esc(s.staff_code)}</div></div></div>` },
          { label: 'Role', render: (s) => `${roleBadge(s.role)}<div class="sub">${esc(s.shift)} shift</div>` },
          { label: 'Contact', render: (s) => `${esc(s.phone) || '<span class="muted">—</span>'}<div class="sub">${esc(s.email)}</div>` },
          { label: 'Joined', cls: 'nowrap', render: (s) => fmtDate(s.join_date) },
          { label: 'Status', render: (s) => (s.active ? badge('Active', 'green', true) : badge('Inactive', '', true)) },
          { label: 'Today', cls: 'num nowrap', render: (s) => `${s.issued_today} issued<div class="sub">${s.returned_today} returned</div>` },
          { label: 'All time', cls: 'num nowrap', render: (s) => `${s.issued_total} issued<div class="sub">${s.returned_total} returns · ${rupees(s.fines_collected)} fines</div>` },
          { label: '', cls: 'num', render: (s) => `<div class="row-actions">
              ${s.active && s.id !== ui.staffId ? `<button class="btn sm" data-act="set-duty" data-id="${s.id}" title="Make this person the staff on duty">On duty</button>` : ''}
              <button class="btn sm icon" data-act="edit-staff" data-id="${s.id}" title="Edit" aria-label="Edit">${icon('edit')}</button></div>` },
        ], rows, empty('users', 'No staff match this filter'), (s) => `class="clickable" data-row="staff" data-id="${s.id}"`)}
      </div>
      <div class="card pad roles-card"><h2>Roles</h2><div class="roles-grid">
        ${Object.entries(ROLE_DESC).map(([r, d]) => `<div>${roleBadge(r)}<p class="sub">${esc(d)}</p></div>`).join('')}
        <div>${badge('Rule', 'amber')}<p class="sub">At least one active Admin must always remain.</p></div></div></div>`;
  };

  // ---------------------------------------------------------------- forms
  function staffForm(s = {}) {
    const opt = (list, cur) => list.map((v) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    return `
      <label class="field">Full name <input name="name" required maxlength="120" value="${esc(s.name)}" placeholder="e.g. Kavitha Rao"></label>
      <div class="row2">
        <label class="field">Staff ID <input name="staff_code" maxlength="20" value="${esc(s.staff_code)}" placeholder="Auto-generated"><small>Leave blank to generate one (S001…)</small></label>
        <label class="field">Join date <input name="join_date" type="date" max="${TODAY}" value="${esc(s.join_date || TODAY)}"></label>
      </div>
      <div class="row2">
        <label class="field">Role <select name="role">${opt(['Admin', 'Librarian', 'Assistant'], s.role || 'Librarian')}</select></label>
        <label class="field">Shift <select name="shift">${opt(['Morning', 'Evening', 'Full day'], s.shift || 'Full day')}</select></label>
      </div>
      <div class="row2">
        <label class="field">Phone <input name="phone" type="tel" value="${esc(s.phone)}" placeholder="98451 00001"></label>
        <label class="field">Email <input name="email" type="email" value="${esc(s.email)}" placeholder="name@library.example"></label>
      </div>
      <label class="switch"><input type="checkbox" name="active" ${s.active === 0 ? '' : 'checked'}><span class="track"></span>Active — can be put on duty and perform library actions</label>
      ${s.role === 'Admin' ? `<div class="callout info">${icon('info')}<span>The library must keep at least one active Admin, so the last Admin can't be demoted or deactivated.</span></div>` : ''}`;
  }
  function addStaff() {
    openModal({
      title: 'Add staff member', sub: 'Register someone who works at the library.', ok: 'Add staff', ic: 'userPlus', body: staffForm(),
      onSubmit: async (v) => {
        const s = await api('POST', '/api/staff', { ...v, active: !!v.active });
        toast(`${s.staff_code} · ${s.role}`, 'ok', { title: `Added ${s.name}`, action: s.active ? { label: 'Put on duty', run: () => setDuty(s.id) } : null });
        await refreshAll();
      },
    });
  }
  function editStaff(staffId) {
    const s = state.staff.find((x) => x.id === staffId);
    if (!s) return;
    openModal({
      title: 'Edit staff member', sub: `${s.name} · ${s.staff_code}`, ok: 'Save changes', ic: 'edit', body: staffForm(s),
      onSubmit: async (v) => {
        const r = await api('PUT', `/api/staff/${staffId}`, { ...v, active: !!v.active });
        toast('Your changes were saved.', 'ok', { title: `Updated ${r.name}` });
        await refreshAll();
      },
    });
  }

  // ---------------------------------------------------------------- drawer
  window.staffDrawer = async (staffId) => {
    const { staff: s, recent } = await api('GET', `/api/staff/${staffId}`);
    return `
      <div class="d-hero"><div class="d-head">${staffAvatar(s, 'lg')}<div><h2>${esc(s.name)}</h2><div class="sub mono">${esc(s.staff_code)}</div>
        <div class="badges">${roleBadge(s.role)}${s.active ? badge('Active', 'green', true) : badge('Inactive', '', true)}${s.id === ui.staffId ? badge('On duty', 'green') : ''}</div></div></div>
        <div class="d-stats">
          <div class="d-stat"><div class="v">${s.issued_total}</div><div class="l">books issued</div></div>
          <div class="d-stat"><div class="v">${s.returned_total}</div><div class="l">returns taken</div></div>
          <div class="d-stat"><div class="v">${rupees(s.fines_collected)}</div><div class="l">fines collected</div></div>
        </div>
        <div class="d-actions">
          ${s.active && s.id !== ui.staffId ? `<button class="btn primary" data-act="set-duty" data-id="${s.id}">${icon('repeat')}Put on duty</button>` : ''}
          <button class="btn" data-act="edit-staff" data-id="${s.id}">${icon('edit')}Edit</button>
        </div></div>
      <div class="d-body">
        <div class="d-sec"><h3>Details</h3><dl class="kv">
          <dt>Role</dt><dd>${esc(s.role)} — ${esc(ROLE_DESC[s.role] || '')}</dd><dt>Shift</dt><dd>${esc(s.shift)}</dd>
          <dt>Phone</dt><dd>${esc(s.phone) || '—'}</dd><dt>Email</dt><dd>${esc(s.email) || '—'}</dd>
          <dt>Joined</dt><dd>${fmtDate(s.join_date)}</dd><dt>Today</dt><dd>${s.issued_today} issued · ${s.returned_today} returned</dd></dl></div>
        <div class="d-sec"><h3>Recent actions ${badge(recent.length)}</h3>
          ${recent.length ? `<ul class="feed" style="padding:0">${recent.map(feedItem).join('')}</ul>` : '<p class="muted small">No recorded actions yet.</p>'}</div>
      </div>`;
  };

  // ---------------------------------------------------------------- on-duty switcher (top bar)
  function setDuty(staffId) {
    const s = state.staff.find((x) => x.id === staffId);
    if (!s || !s.active) return;
    ui.staffId = s.id;
    try { localStorage.setItem('lib-staff', String(s.id)); } catch { /* ignore */ }
    $('#me-pop').hidden = true;
    renderOnDuty();
    toast(`New issues, returns and fine collections will be recorded as ${s.name}.`, 'ok', { title: `${s.name} is on duty` });
    render().catch(fail);
    if (drawerState) drawerState.reopen();
  }
  window.renderOnDuty = function renderOnDuty() {
    const s = onDuty();
    $('#me-avatar').textContent = s ? initials(s.name) : '?';
    $('#me-avatar').style.background = s ? `hsl(${(hue(s.name) + 180) % 360} 45% 42%)` : '';
    $('#me-name').textContent = s ? s.name : 'No staff on duty';
    $('#me-role').textContent = s ? s.role : 'Choose staff';
    const active = state.staff.filter((x) => x.active);
    $('#me-pop').innerHTML = `<div class="pop-head"><b>Staff on duty</b><span class="muted small">recorded on every action</span></div>
      <div class="pop-list">${active.map((x) => `<div class="pop-item ${x.id === ui.staffId ? 'current' : ''}" data-duty="${x.id}">${staffAvatar(x, 'sm')}
        <div class="grow"><b>${esc(x.name)}</b><small>${esc(x.staff_code)} · ${esc(x.role)} · ${esc(x.shift)}</small></div>${x.id === ui.staffId ? icon('check') : ''}</div>`).join('')}</div>
      <div class="pop-foot"><a href="#/staff" class="btn sm ghost">${icon('users')}Manage staff</a></div>`;
  };
  const renderOnDuty = window.renderOnDuty;

  $('#me-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#me-pop').hidden = !$('#me-pop').hidden; });
  $('#me-pop').addEventListener('click', (e) => {
    const it = e.target.closest('[data-duty]');
    if (it) setDuty(Number(it.dataset.duty));
    else if (e.target.closest('a')) $('#me-pop').hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.me-wrap')) $('#me-pop').hidden = true;
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      const f = e.target.closest('#staff-filter button[data-v]');
      if (f) { ui.staffFilter = f.dataset.v; render().catch(fail); }
      return;
    }
    const idOf = () => Number(btn.dataset.id);
    const acts = {
      'add-staff': addStaff,
      'edit-staff': () => editStaff(idOf()),
      'set-duty': () => setDuty(idOf()),
      'switch-staff': () => { $('#me-pop').hidden = false; },
    };
    if (acts[btn.dataset.act]) { e.stopPropagation(); acts[btn.dataset.act](); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#me-pop').hidden = true; });

  COMMANDS.push(
    { label: 'Go to Library Staff', ic: 'idCard', kw: 'staff admin employees team', run: () => go('staff') },
    { label: 'Add a staff member', ic: 'userPlus', kw: 'new staff employee librarian', run: () => { go('staff'); addStaff(); } },
    { label: 'Switch staff on duty', ic: 'repeat', kw: 'on duty shift change user', run: () => { $('#me-pop').hidden = false; } },
  );
})();
