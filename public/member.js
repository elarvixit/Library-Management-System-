// Member self-service page: a member signs in with their member ID and the last 4 digits of their
// phone number and sees their loans, due dates, fines, reservations and recent returns. Read-only.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const asDate = (d) => new Date(`${d}T00:00:00`);
  const fmt = (d) => (d ? asDate(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const daysBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / 86_400_000);
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  let session = null; // { code, phone } kept in memory only

  $('#mp-year').textContent = new Date().getFullYear();
  try { $('#mp-code').value = localStorage.getItem('lib-member-code') || ''; } catch { /* storage unavailable */ }
  if ($('#mp-code').value) $('#mp-phone').focus(); else $('#mp-code').focus();

  function cover(title, isbn) {
    const h = hue(title);
    const code = String(isbn || '').replace(/[^0-9X]/gi, '');
    const img = code ? `<img src="https://covers.openlibrary.org/b/isbn/${code}-M.jpg?default=false" alt="" loading="lazy" referrerpolicy="no-referrer" onload="if(this.naturalWidth<10)this.remove()" onerror="this.remove()">` : '';
    return `<span class="mp-cover" style="background:linear-gradient(155deg,hsl(${h} 52% 46%),hsl(${(h + 35) % 360} 58% 30%))">${esc(initials(String(title).replace(/^(the|a|an)\s+/i, '')).slice(0, 1))}${img}</span>`;
  }

  async function load() {
    const res = await fetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Please try again.`);
    return data;
  }

  $('#mp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#mp-code').value.trim();
    const phone = $('#mp-phone').value.replace(/\D/g, '');
    $('#mp-error').textContent = '';
    if (!code || phone.length !== 4) { $('#mp-error').textContent = 'Enter your member ID and the last 4 digits of your phone number.'; return; }
    $('#mp-go').disabled = true;
    $('#mp-go').textContent = 'Checking…';
    try {
      session = { code, phone };
      const data = await load();
      try { localStorage.setItem('lib-member-code', data.member.member_code); } catch { /* ignore */ }
      show(data);
    } catch (err) {
      session = null;
      $('#mp-error').textContent = err.message;
    } finally {
      $('#mp-go').disabled = false;
      $('#mp-go').textContent = 'Show my books';
    }
  });

  $('#mp-logout').addEventListener('click', () => {
    session = null;
    $('#mp-view').hidden = true;
    $('#mp-view').innerHTML = '';
    $('#mp-login').hidden = false;
    $('#mp-logout').hidden = true;
    $('#mp-phone').value = '';
    $('#mp-phone').focus();
  });

  function show(d) {
    const { member: m, rules: R, today } = d;
    const first = m.name.split(' ')[0];
    const overdue = d.loans.filter((l) => l.overdue);
    const accruing = overdue.reduce((t, l) => t + l.fine, 0);
    const expired = m.valid_until && m.valid_until < today;
    const ready = d.reservations.filter((r) => r.status === 'ready');
    const h = hue(m.name);

    const alerts = [];
    if (overdue.length) alerts.push(['red', `${plural(overdue.length, 'book is', 'books are')} overdue. Fines grow by ${rupees(R.FINE_PER_DAY)} a day, so please return ${overdue.length === 1 ? 'it' : 'them'} soon.`]);
    if (m.unpaid_fines) alerts.push(['red', `You have ${rupees(m.unpaid_fines)} in unpaid fines. Please pay at the library desk; you can't borrow new books until it's paid.`]);
    for (const r of ready) alerts.push(['green', `"${r.title}" is ready for you to collect. We'll keep it until ${fmt(r.hold_until)}.`]);
    if (expired) alerts.push(['amber', `Your membership ended on ${fmt(m.valid_until)}. Please renew it at the library desk.`]);
    if (!m.active) alerts.push(['amber', 'Your membership is not active. Please contact the library desk.']);

    const dueText = (l) => {
      if (l.overdue) return `<span class="tag red">${plural(l.days_overdue, 'day')} late</span><div class="sub">fine so far ${rupees(l.fine)}</div>`;
      const left = daysBetween(today, l.due_on);
      const tag = left === 0 ? '<span class="tag amber">Due today</span>' : left === 1 ? '<span class="tag amber">Due tomorrow</span>'
        : left <= 3 ? `<span class="tag amber">${left} days left</span>` : `<span class="tag green">${left} days left</span>`;
      return `${tag}<div class="sub">due ${fmt(l.due_on)}</div>`;
    };

    $('#mp-view').innerHTML = `
      <section class="mp-card">
        <div class="mp-hello">
          <span class="mp-avatar" style="background:hsl(${h} 55% 45%)">${esc(initials(m.name))}</span>
          <div class="grow"><h1>Hi, ${esc(first)}</h1>
            <div class="mp-tags"><span class="tag">${esc(m.member_code)}</span><span class="tag">${esc(m.membership_type)}</span>
              ${expired ? '<span class="tag amber">Membership expired</span>' : m.valid_until ? `<span class="tag green">Valid until ${fmt(m.valid_until)}</span>` : '<span class="tag green">Active member</span>'}</div></div>
          <button class="mp-btn ghost" id="mp-refresh" type="button">Refresh</button>
        </div>
        <div class="mp-stats">
          <div class="mp-stat"><b>${d.loans.length}<small style="font-size:13px;color:var(--muted)"> / ${R.MAX_ACTIVE_ISSUES}</small></b><span>books with you</span></div>
          <div class="mp-stat ${m.unpaid_fines || accruing ? 'bad' : ''}"><b>${rupees(m.unpaid_fines + accruing)}</b><span>${accruing ? 'fines incl. overdue' : 'fines due'}</span></div>
          <div class="mp-stat"><b>${d.reservations.length}</b><span>reservations</span></div>
        </div>
        ${alerts.map(([tone, text]) => `<div class="mp-alert ${tone}">${esc(text)}</div>`).join('')}
      </section>

      <section class="mp-card">
        <h2>Books with you</h2>
        ${d.loans.length ? `<div class="mp-list">${d.loans.map((l) => `<div class="mp-item">${cover(l.title, l.isbn)}
          <div class="grow"><b>${esc(l.title)}</b><div class="sub">${esc(l.author)} · borrowed ${fmt(l.issued_on)}${l.renewals ? ` · renewed ${l.renewals}×` : ''}</div></div>
          <div class="right">${dueText(l)}</div></div>`).join('')}</div>` : `<p class="mp-empty">You have no books right now. You can borrow up to ${R.MAX_ACTIVE_ISSUES} at a time.</p>`}
      </section>

      <section class="mp-card">
        <h2>Reservations</h2>
        ${d.reservations.length ? `<div class="mp-list">${d.reservations.map((r) => `<div class="mp-item">${cover(r.title, r.isbn)}
          <div class="grow"><b>${esc(r.title)}</b><div class="sub">${r.status === 'ready' ? `Collect by ${fmt(r.hold_until)}`
            : `You are number ${r.queue_position} in the queue${r.next_due_on ? ` · a copy is due back ${fmt(r.next_due_on)}` : ''}`}</div></div>
          <div class="right">${r.status === 'ready' ? '<span class="tag green">Ready to collect</span>' : `<span class="tag">#${r.queue_position} in queue</span>`}</div></div>`).join('')}</div>`
          : '<p class="mp-empty">No reservations. Ask at the desk to reserve a book that is out on loan.</p>'}
      </section>

      <section class="mp-card">
        <h2>Recently returned</h2>
        ${d.history.length ? `<div class="mp-list">${d.history.map((i) => `<div class="mp-item">${cover(i.title, i.isbn)}
          <div class="grow"><b>${esc(i.title)}</b><div class="sub">${fmt(i.issued_on)} → ${fmt(i.returned_on)}</div></div>
          <div class="right">${i.fine ? `<span class="tag ${i.fine_paid ? 'green' : 'red'}">${rupees(i.fine)} ${i.fine_paid ? 'paid' : 'unpaid'}</span>` : '<span class="tag green">On time</span>'}</div></div>`).join('')}</div>`
          : '<p class="mp-empty">Nothing returned yet.</p>'}
      </section>

      <section class="mp-card">
        <h2>Library rules</h2>
        <ul class="mp-rules"><li>Books are lent for ${R.LOAN_DAYS} days; you can have up to ${R.MAX_ACTIVE_ISSUES} at a time.</li>
          <li>Late returns cost ${rupees(R.FINE_PER_DAY)} per day. Unpaid fines stop new borrowing.</li>
          <li>You can renew a book up to ${R.MAX_RENEWALS} times at the desk if nobody is waiting for it.</li>
          <li>Reserved books are kept for ${R.HOLD_DAYS} days once they are ready.</li></ul>
      </section>`;
    $('#mp-login').hidden = true;
    $('#mp-view').hidden = false;
    $('#mp-logout').hidden = false;
    $('#mp-refresh').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { show(await load()); } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    window.scrollTo({ top: 0 });
  }
})();
