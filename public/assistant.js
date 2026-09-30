'use strict';
/* Library Assistant — a built-in help chat (no external AI service, no API key).
 *
 * It answers from the live data already loaded by app.js (state.members, state.books, state.loans,
 * state.reservations, state.dash, state.stats) plus the library rules. It is READ-ONLY: answers carry
 * shortcut buttons (open member, go to Issue, collect fine…) and the librarian performs every action
 * through the normal screens and confirmations.
 *
 * How it understands a question:
 *   1. how-to questions ("how do I renew…")           -> step-by-step guide
 *   2. rule questions ("how is the fine calculated")   -> rule explanation
 *   3. member / book names found in the text           -> live answers about them
 *   4. topic keywords (overdue, fines, pickup, queue…) -> live lists
 * The `answer(text)` function is the single entry point, so a real LLM could replace it later.
 */

(() => {
  // ------------------------------------------------------------------ text helpers
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (t, re) => re.test(t);
  const STOP = new Set(('the a an of and or to in on for is are was by at it its my me i we you can could who whom has have had when where what which '
    + 'how does do did book books copy copies there any about tell show give find please with from this that be will would should list all '
    + 'borrow borrowed issue issued return returned available reserve reserved due back member members fine fines owe owes').split(' '));

  // ------------------------------------------------------------------ entity recognition
  function findMembers(text) {
    const t = ` ${norm(text)} `;
    const hits = [];
    for (const m of state.members) {
      const full = norm(m.name);
      const parts = full.split(' ');
      const code = norm(m.member_code);
      const usable = (w) => w.length >= 3 && !STOP.has(w); // never match on words like "member"
      let score = 0;
      if (t.includes(` ${full} `) || t.includes(` ${code} `)) score = 3;
      else if (usable(parts[0]) && t.includes(` ${parts[0]} `)) score = 2;
      else if (parts.length > 1 && usable(parts.at(-1)) && parts.at(-1).length >= 4 && t.includes(` ${parts.at(-1)} `)) score = 1;
      if (score) hits.push({ m, score });
    }
    if (!hits.length) return [];
    const best = Math.max(...hits.map((h) => h.score));
    return hits.filter((h) => h.score === best).map((h) => h.m);
  }

  function findBooks(text) {
    const t = ` ${norm(text)} `;
    const digits = String(text).replace(/[\s-]/g, '');
    const hits = [];
    for (const b of state.books) {
      const full = norm(b.title);
      const fullNoArticle = full.replace(/^(the|a|an) /, '');
      let score = 0;
      if (t.includes(` ${full} `) || t.includes(` ${fullNoArticle} `) || (digits.length >= 10 && digits.includes(b.isbn))) score = 3;
      else {
        const words = full.split(' ').filter((w) => w.length > 2 && !STOP.has(w));
        const matched = words.filter((w) => t.includes(` ${w} `));
        if (words.length && matched.length && matched.length / words.length >= 0.5) score = 1 + matched.length / words.length;
      }
      if (score) hits.push({ b, score });
    }
    if (!hits.length) return [];
    const best = Math.max(...hits.map((h) => h.score));
    return hits.filter((h) => h.score === best).map((h) => h.b);
  }

  // ------------------------------------------------------------------ reply building blocks
  const btn = (label, attrs, cls = '') => `<button type="button" class="btn xs ${cls}" ${attrs}>${esc(label)}</button>`;
  const openMember = (m) => btn(`Open ${m.name.split(' ')[0]}`, `data-act="view-member" data-id="${m.id}"`);
  const openBook = (b) => btn('Open book', `data-act="view-book" data-id="${b.id}"`);
  const nav = (label, to, extra = '') => btn(label, `data-nav="${to}" ${extra}`);
  const li = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  const more = (arr, n, noun) => (arr.length > n ? `<p class="as-muted">…and ${plural(arr.length - n, noun)} more.</p>` : '');
  const reply = (html, actions = []) => ({ html, actions });
  const loansOf = (m) => state.loans.filter((l) => l.member_id === m.id);

  // Mirrors the server's issue rules (the server remains the authority).
  function eligibility(m, b) {
    const checks = [];
    const add = (ok, text) => checks.push({ ok, text });
    add(!!m.active, m.active ? 'Membership is active' : 'Membership is inactive');
    if (m.active && m.valid_until && m.valid_until < TODAY) add(false, `Membership expired on ${fmtDate(m.valid_until)} — it must be renewed first`);
    add(!m.unpaid_fines, m.unpaid_fines ? `Has an unpaid fine of ${rupees(m.unpaid_fines)} — it must be paid first` : 'No unpaid fines');
    add(m.active_issues < RULES.MAX_ACTIVE_ISSUES, `Holds ${m.active_issues} of ${RULES.MAX_ACTIVE_ISSUES} allowed books`);
    if (b) {
      if (state.loans.some((l) => l.member_id === m.id && l.book_id === b.id)) add(false, 'Already has a copy of this book');
      const open = state.reservations.filter((r) => r.book_id === b.id);
      const mine = open.find((r) => r.member_id === m.id);
      const waiting = open.filter((r) => r.status === 'waiting');
      if (mine?.status === 'ready') add(true, `A copy is held for them until ${fmtDate(mine.hold_until)}`);
      else if (waiting.length) {
        const pos = waiting.findIndex((r) => r.member_id === m.id);
        add(false, pos === 0 ? 'They are first in the queue, but no copy has come back yet'
          : `Reserved — only ${esc(waiting[0].member_name)} (first in the queue) can borrow it${pos > 0 ? `; they are #${pos + 1}` : ''}`);
      } else add(b.available_copies > 0, b.available_copies > 0 ? `${plural(b.available_copies, 'copy', 'copies')} on the shelf` : 'No copy on the shelf — they can reserve it');
    }
    return { ok: checks.every((c) => c.ok), checks };
  }
  const checkList = (checks) => `<ul class="as-checks">${checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${icon(c.ok ? 'checkCircle' : 'xCircle')}<span>${c.text}</span></li>`).join('')}</ul>`;

  // ------------------------------------------------------------------ answers about entities
  function canBorrow(m, b) {
    const e = eligibility(m, b);
    const head = b
      ? `<p><b>${e.ok ? 'Yes' : 'No'}</b> — ${esc(m.name)} ${e.ok ? 'can' : 'cannot'} borrow <b>${esc(b.title)}</b> right now.</p>`
      : `<p><b>${e.ok ? 'Yes' : 'No'}</b> — ${esc(m.name)} ${e.ok ? 'can borrow books' : 'cannot borrow books'} right now.</p>`;
    const actions = [];
    if (m.unpaid_fines) actions.push(btn(`Collect ${rupees(m.unpaid_fines)}`, `data-act="pay" data-id="${m.id}"`, 'success'));
    if (e.ok && b) actions.push(btn('Issue it now', `data-assist-issue="${m.id}:${b.id}"`, 'primary'));
    else if (e.ok) actions.push(btn('Issue a book', `data-act="issue-to" data-id="${m.id}"`, 'primary'));
    if (b && !e.ok && b.available_copies === 0 && !state.reservations.some((r) => r.book_id === b.id && r.member_id === m.id)) actions.push(btn('Reserve instead', `data-act="reserve-book" data-book="${b.id}"`));
    actions.push(openMember(m));
    return reply(head + checkList(e.checks), actions);
  }

  function memberSummary(m) {
    const loans = loansOf(m);
    const res = state.reservations.filter((r) => r.member_id === m.id);
    const exp = m.valid_until && m.valid_until < TODAY;
    let html = `<p><b>${esc(m.name)}</b> (${esc(m.member_code)}) · ${esc(m.membership_type || 'General')} · ${m.active ? (exp ? '<b class="t-red">membership expired</b>' : 'active') : '<b>inactive</b>'} member since ${fmtDate(m.join_date)}${m.valid_until ? ` · ${exp ? 'expired' : 'valid until'} ${fmtDate(m.valid_until)}` : ''}.</p>`;
    html += loans.length
      ? `<p>On loan (${loans.length}/${RULES.MAX_ACTIVE_ISSUES}):</p>${li(loans.map((l) => `<b>${esc(l.title)}</b> — due ${fmtShort(l.due_on)}${l.overdue ? ` <span class="t-red">(${plural(l.days_overdue, 'day')} overdue, ${rupees(l.accrued_fine)} accruing)</span>` : ` (${relDays(l.due_on)})`}`))}`
      : '<p>No books on loan.</p>';
    if (m.unpaid_fines) html += `<p class="t-red">Unpaid fines: <b>${rupees(m.unpaid_fines)}</b> — blocks new issues until paid.</p>`;
    if (res.length) html += `<p>Reservations:</p>${li(res.map((r) => `${esc(r.title)} — ${r.status === 'ready' ? `<span class="t-green">ready, held until ${fmtShort(r.hold_until)}</span>` : `#${r.queue_position} in queue`}`))}`;
    const actions = [openMember(m)];
    if (m.unpaid_fines) actions.push(btn(`Collect ${rupees(m.unpaid_fines)}`, `data-act="pay" data-id="${m.id}"`, 'success'));
    if (m.active) actions.push(btn('Issue a book', `data-act="issue-to" data-id="${m.id}"`));
    return reply(html, actions);
  }

  function bookSummary(b, focus = 'all') {
    const loans = state.loans.filter((l) => l.book_id === b.id);
    const res = state.reservations.filter((r) => r.book_id === b.id);
    const waiting = res.filter((r) => r.status === 'waiting');
    const ready = res.filter((r) => r.status === 'ready');
    const nextDue = loans.map((l) => l.due_on).sort()[0];
    let html = `<p><b>${esc(b.title)}</b> by ${esc(b.author)} · ${esc(b.category)}</p>`;
    if (b.available_copies > 0) html += `<p class="t-green"><b>Available</b> — ${b.available_copies} of ${b.total_copies} ${b.total_copies === 1 ? 'copy is' : 'copies are'} on the shelf.</p>`;
    else html += `<p class="t-red"><b>Not available</b> — all ${plural(b.total_copies, 'copy', 'copies')} ${b.total_copies === 1 ? 'is' : 'are'} on loan or held.</p>`;
    if (focus !== 'avail' || !b.available_copies) {
      if (loans.length) html += `<p>Borrowed by:</p>${li(loans.map((l) => `${esc(l.member_name)} — due back ${fmtShort(l.due_on)}${l.overdue ? ` <span class="t-red">(${plural(l.days_overdue, 'day')} overdue)</span>` : ` (${relDays(l.due_on)})`}`))}`;
      else if (focus === 'who') html += '<p>Nobody has it on loan right now.</p>';
      if (ready.length) html += `<p>Held for pickup: ${ready.map((r) => `${esc(r.member_name)} (until ${fmtShort(r.hold_until)})`).join(', ')}.</p>`;
      if (waiting.length) html += `<p>Waiting in queue: ${waiting.map((r) => `${r.queue_position}. ${esc(r.member_name)}`).join(', ')}.</p>`;
      if (!b.available_copies && nextDue) html += `<p>Next copy is due back <b>${fmtDate(nextDue)}</b> (${relDays(nextDue)})${waiting.length ? `, and it will go to ${esc(waiting[0].member_name)} first` : ''}.</p>`;
    }
    const actions = [openBook(b)];
    if (b.available_copies > 0) actions.push(btn('Issue this book', `data-act="issue-book" data-book="${b.id}"`, 'primary'));
    else actions.push(btn('Reserve', `data-act="reserve-book" data-book="${b.id}"`));
    return reply(html, actions);
  }

  const disambiguate = (kind, list) => reply(
    `<p>I found more than one ${kind} matching that — which one did you mean?</p>`,
    list.slice(0, 5).map((x) => (kind === 'member'
      ? btn(`${x.name} (${x.member_code})`, `data-ask="Tell me about ${esc(x.name)}"`)
      : btn(x.title, `data-ask="Tell me about ${esc(x.title)}"`))),
  );

  // ------------------------------------------------------------------ topic answers (live lists)
  function overdueAnswer() {
    const rows = state.dash?.overdue || [];
    if (!rows.length) return reply('<p><b>Nothing is overdue.</b> 🎉 Every book on loan is within its due date.</p>', [nav('Open loans', 'loans')]);
    const total = rows.reduce((t, r) => t + r.accrued_fine, 0);
    return reply(`<p><b>${plural(rows.length, 'book')}</b> overdue, with <b>${rupees(total)}</b> in fines building up:</p>
      ${li(rows.slice(0, 8).map((r) => `<b>${esc(r.title)}</b> — ${esc(r.member_name)}${r.phone ? ` (${esc(r.phone)})` : ''}, ${plural(r.days_overdue, 'day')} late · ${rupees(r.accrued_fine)}`))}${more(rows, 8, 'loan')}
      <p class="as-muted">Fines are recorded when the book is returned.</p>`,
    [nav('Show overdue loans', 'overdue', 'data-primary'), btn('Export CSV', 'data-download="/api/reports/overdue.csv"')]);
  }
  function finesAnswer() {
    const owing = state.members.filter((m) => m.unpaid_fines > 0).sort((a, b) => b.unpaid_fines - a.unpaid_fines);
    if (!owing.length) return reply('<p><b>No unpaid fines.</b> Every member is clear to borrow.</p>', [nav('Open fines ledger', 'fines')]);
    const total = owing.reduce((t, m) => t + m.unpaid_fines, 0);
    return reply(`<p><b>${plural(owing.length, 'member')}</b> ${owing.length === 1 ? 'owes' : 'owe'} <b>${rupees(total)}</b> in total. They can't borrow until they pay:</p>
      ${li(owing.slice(0, 8).map((m) => `${esc(m.name)} (${esc(m.member_code)}) — <b>${rupees(m.unpaid_fines)}</b>`))}${more(owing, 8, 'member')}`,
    [nav('Open fines ledger', 'fines'), ...owing.slice(0, 2).map((m) => btn(`Collect from ${m.name.split(' ')[0]}`, `data-act="pay" data-id="${m.id}"`, 'success'))]);
  }
  function pickupAnswer() {
    const rows = state.dash?.readyForPickup || [];
    if (!rows.length) return reply('<p>No copies are waiting for pickup right now.</p>', [nav('Open reservations', 'reservations')]);
    return reply(`<p><b>${plural(rows.length, 'copy', 'copies')}</b> ready for pickup:</p>
      ${li(rows.map((r) => { const left = daysBetween(TODAY, r.hold_until); return `<b>${esc(r.title)}</b> for ${esc(r.member_name)} — ${left <= 0 ? '<span class="t-red">last day to collect</span>' : `held until ${fmtShort(r.hold_until)} (${plural(left, 'day')} left)`}`; }))}`,
    [nav('Open reservations', 'reservations')]);
  }
  function queueAnswer() {
    const rows = state.dash?.pendingReservations || [];
    if (!rows.length) return reply('<p>No one is waiting in a reservation queue.</p>', [nav('Open reservations', 'reservations')]);
    const byBook = new Map();
    for (const r of rows) { if (!byBook.has(r.title)) byBook.set(r.title, []); byBook.get(r.title).push(r); }
    return reply(`<p><b>${plural(rows.length, 'member')}</b> waiting across ${plural(byBook.size, 'book')}:</p>
      ${li([...byBook].map(([title, rs]) => `<b>${esc(title)}</b> — ${rs.map((r) => `${r.queue_position}. ${esc(r.member_name)}`).join(', ')}${rs[0].next_due_on ? ` · next copy due ${fmtShort(rs[0].next_due_on)}` : ''}`))}`,
    [nav('Open reservations', 'reservations')]);
  }
  function dueSoonAnswer(todayOnly) {
    let rows = state.stats?.dueSoon || state.loans.filter((l) => !l.overdue && daysBetween(TODAY, l.due_on) <= RULES.DUE_SOON_DAYS);
    if (todayOnly) rows = rows.filter((l) => l.due_on === TODAY);
    if (!rows.length) return reply(`<p>Nothing is due back ${todayOnly ? 'today' : `in the next ${RULES.DUE_SOON_DAYS} days`}.</p>`, [nav('Open loans', 'loans')]);
    return reply(`<p><b>${plural(rows.length, 'book')}</b> due back ${todayOnly ? 'today' : `in the next ${RULES.DUE_SOON_DAYS} days`}:</p>
      ${li(rows.map((l) => `<b>${esc(l.title)}</b> — ${esc(l.member_name)}, due ${fmtShort(l.due_on)} (${relDays(l.due_on)})`))}`,
    [nav('Show due soon', 'due-soon')]);
  }
  function issuedTodayAnswer() {
    const rows = state.dash?.issuedToday || [];
    if (!rows.length) return reply('<p>No books have been issued today yet.</p>', [btn('Issue a book', 'data-act="go-issue"', 'primary')]);
    return reply(`<p><b>${plural(rows.length, 'book')}</b> issued today:</p>${li(rows.map((r) => `<b>${esc(r.title)}</b> to ${esc(r.member_name)} — due ${fmtShort(r.due_on)}`))}`, [nav('Open loans', 'loans')]);
  }
  function statsAnswer() {
    const s = state.dash?.stats;
    if (!s) return null;
    return reply(`<p>Here's the library at a glance:</p>${li([
      `<b>${s.titles}</b> titles, <b>${s.copies}</b> copies (${s.available} on the shelf)`,
      `<b>${s.on_loan}</b> books on loan, <b>${s.overdue}</b> overdue`,
      `<b>${s.active_members}</b> active members of ${state.members.length}`,
      `<b>${s.ready_for_pickup}</b> ready for pickup, <b>${s.pending_reservations}</b> waiting in queues`,
      `<b>${rupees(s.unpaid_fines)}</b> in unpaid fines`,
    ])}`, [nav('Open dashboard', 'dashboard')]);
  }
  function searchAnswer(kind, term) {
    const q = norm(term);
    const rows = state.books.filter((b) => norm(kind === 'author' ? b.author : b.category).includes(q));
    if (!rows.length) return reply(`<p>I couldn't find any books ${kind === 'author' ? 'by' : 'in'} “${esc(term)}”.</p>`, [nav('Open books', 'books')]);
    return reply(`<p>${plural(rows.length, 'book')} ${kind === 'author' ? 'by' : 'in'} “${esc(term)}”:</p>
      ${li(rows.slice(0, 10).map((b) => `<b>${esc(b.title)}</b> — ${esc(b.author)} · ${b.available_copies > 0 ? `<span class="t-green">${b.available_copies} available</span>` : '<span class="t-red">none available</span>'}`))}${more(rows, 10, 'book')}`,
    [nav('Open books', 'books')]);
  }

  // ------------------------------------------------------------------ rules & how-to guides
  const RULE_ANSWERS = [
    { re: /(fine|penalt|late fee|charge)/, when: /(how|what|calculat|much|work|rule|rate|per day)/, html: () => `<p><b>Late fines</b> are <b>₹${RULES.FINE_PER_DAY} per day</b> after the due date.</p>${li([
      'Returning on the due date is not late.',
      `Example: 4 days late = 4 × ₹${RULES.FINE_PER_DAY} = <b>₹${4 * RULES.FINE_PER_DAY}</b>.`,
      'The fine is calculated and recorded against the member when the book is returned.',
      'Unpaid fines <b>block new issues and renewals</b> until the librarian clicks <i>Collect</i>.'])}`, actions: () => [nav('Open fines ledger', 'fines')] },
    { re: /(how many|max|maximum|limit)/, when: /(book|borrow|hold|take|issue)/, html: () => `<p>A member can hold <b>at most ${RULES.MAX_ACTIVE_ISSUES} books</b> at a time. To borrow another, they must return one first.</p>`, actions: () => [] },
    { re: /(loan period|how long|how many days|due date|default)/, when: /./, html: () => `<p>The default loan period is <b>${RULES.LOAN_DAYS} days</b> from the issue date. On the Issue screen you can pick 1–4 weeks or set any due date (not before the issue date).</p>`, actions: () => [btn('Issue a book', 'data-act="go-issue"')] },
    { re: /(renew|extend)/, when: /./, html: () => `<p><b>Renewing</b> extends a loan to <b>today + ${RULES.LOAN_DAYS} days</b>, up to <b>${RULES.MAX_RENEWALS} times</b>. It's refused when:</p>${li([
      'the book is already overdue (it must be returned and the fine paid)', 'the member has unpaid fines', 'someone is waiting in the reservation queue for that book'])}
      <p>Use the <b>Renew</b> button on the <i>Return Book</i> page. If it's disabled, hover it to see why.</p>`, actions: () => [nav('Open loans', 'loans')] },
    { re: /(hold|pickup|pick up).*(expire|expir|not collect|miss)|(expire|expir).*(hold|pickup)/, when: /./, html: () => `<p>A copy <b>ready for pickup</b> is held for <b>${RULES.HOLD_DAYS} days</b>.</p>${li([
      'The member can collect it any time until the "held until" date (inclusive).',
      'From the next day the hold <b>expires</b>: the copy passes to the next person in the queue, with a fresh 2-day hold.',
      'If nobody else is waiting, the copy goes back on the shelf for anyone to borrow.'])}`, actions: () => [nav('Open reservations', 'reservations')] },
    { re: /(reserv|queue|hold)/, when: /(how|work|rule|expire|long|explain|policy)/, html: () => `<p><b>Reservations</b> work like this:</p>${li([
      'A member can reserve a book only when <b>no copy is on the shelf</b>.',
      'The queue is <b>first come, first served</b>.',
      `When a copy is returned it goes to the <b>first person in the queue</b>, appears on <i>Ready for pickup</i>, and is <b>held for ${RULES.HOLD_DAYS} days</b>.`,
      'While people are waiting, the book can only be issued to the first person in the queue.',
      'If the hold expires, the copy passes to the next person (or back to the shelf).'])}`, actions: () => [nav('Open reservations', 'reservations')] },
    { re: /(delete|remove)/, when: /(book|title)/, html: () => '<p>A book <b>cannot be deleted while any copy is on loan</b> or while it has open reservations — the app refuses and tells you who has it. Deleting keeps past loans and fines in the records.</p>', actions: () => [nav('Open books', 'books')] },
    { re: /(membership|expir|renew membership|valid until|plan)/, when: /(membership|expir|valid|plan)/, html: () => `<p><b>Memberships</b> have a plan (General, Student, Faculty or Senior) and an optional <b>valid until</b> date.</p>${li([
      'When a membership has <b>expired</b>, the member cannot borrow or reserve until it is renewed.',
      'Renew from the member\'s profile (<b>Renew membership</b>) for 6 months to 3 years; the new period starts from today, or from the current expiry if it hasn\'t passed yet.',
      'Members without an expiry date never expire.'])}`, actions: () => [nav('Open members', 'members')] },
    { re: /(inactive|deactivat|disable)/, when: /./, html: () => '<p>Inactive members <b>cannot borrow or reserve</b>. Making a member inactive cancels their open reservations and passes any held copy to the next person in the queue. They must still return books they already have.</p>', actions: () => [nav('Open members', 'members')] },
  ];

  const HOWTO = [
    { re: /(issue|lend|check ?out|give)/, title: 'issue a book', steps: ['Open <b>Issue Book</b> in the sidebar (or press <kbd>I</kbd>).', 'Search and select the <b>member</b>.', 'Search and select the <b>book</b>.', `Check the due date (default ${RULES.LOAN_DAYS} days) and the rule checklist on the right.`, 'Click <b>Issue book</b> — you can print a loan slip afterwards.'], act: () => btn('Go to Issue', 'data-act="go-issue"', 'primary') },
    { re: /(return|check ?in|give back)/, title: 'return a book', steps: ['Open <b>Return Book</b> in the sidebar (or press <kbd>R</kbd>).', 'Find the loan by member, title or ISBN.', 'Click <b>Return</b> and confirm the return date — any late fine is shown before you confirm.', 'Print the receipt or collect the fine straight away.'], act: () => btn('Go to Returns', 'data-act="go-return"', 'primary') },
    { re: /(reserv|hold|queue)/, title: 'reserve a book', steps: ['Go to <b>Reservations</b>.', 'Select the member and the book (only books with no copy on the shelf are listed).', 'Click <b>Reserve</b> — the member joins the end of the queue.'], act: () => nav('Open reservations', 'reservations', 'data-primary') },
    { re: /(renew|extend).*(membership)|(membership).*(renew|extend)/, title: 'renew a membership', steps: ['Open <b>Members</b> and click the member.', 'Click <b>Renew membership</b> (or <b>Extend membership</b>).', 'Choose 6 months to 3 years and confirm.'], act: () => nav('Open members', 'members', 'data-primary') },
    { re: /(renew|extend)/, title: 'renew a loan', steps: ['Open <b>Return Book</b> in the sidebar.', 'Click <b>Renew</b> on the loan.', 'If the button is disabled, hover it to see why (overdue, unpaid fines, or someone waiting).'], act: () => nav('Open loans', 'loans', 'data-primary') },
    { re: /(buy|purchase|acquisition|acquire|order (new )?books?|vendor|supplier)/, title: 'buy new books (acquisitions)', steps: ['Open <b>Acquisitions</b> in the sidebar and click <b>New purchase request</b>.', 'Enter title, author, ISBN, vendor, quantity and cost per copy.', 'Click <b>Order</b> when it is ordered from the vendor.', 'When the delivery arrives click <b>Receive</b> — the copies are added to the catalogue (existing ISBNs get extra copies, and anyone waiting in the queue gets them first).'], act: () => nav('Open acquisitions', 'acquisitions', 'data-primary') },
    { re: /(digital|e ?-?books?|ebooks?|journals?|audio ?books?|online resource|website|videos?)/, title: 'use the Digital Library', steps: ['Open <b>Digital Library</b> in the sidebar.', 'Filter by type (E-book, Journal, Audiobook, Video, Website, Database) or search.', 'Click <b>Open</b> to open the resource — views are counted.', 'Use <b>Add digital resource</b> to add a new link; mark it <i>Members only</i> if it needs a library card.'], act: () => nav('Open digital library', 'digital', 'data-primary') },
    { re: /(report|statistic|analytics)/, title: 'run a report', steps: ['Open <b>Reports</b> in the sidebar.', 'Choose a report: circulation, overdue, fines, most borrowed, categories, members, inventory, acquisitions or digital usage.', 'Pick a period (last 7/30 days, this month, this year or custom dates).', 'Click <b>Export CSV</b> or <b>Print</b>.'], act: () => nav('Open reports', 'reports', 'data-primary') },
    { re: /(scan|barcode|rfid|scanner)/, title: 'scan barcodes / RFID', steps: ['<b>Issue:</b> on <b>Issue Book</b>, click the scan box, scan the member card, then the book barcode — both are selected automatically.', '<b>Return:</b> on <b>Return Book</b>, scan the book barcode — its return opens straight away.', 'Book labels: open a book and click <b>Print label</b> (EAN-13 barcode). Member cards: open a member and click <b>Library card</b> (Code 39 barcode).', 'Any USB/Bluetooth barcode scanner or RFID reader in keyboard mode works; you can also type a member ID or ISBN and press Enter.'], act: () => btn('Go to Issue', 'data-act="go-issue"', 'primary') },
    { re: /(import|upload|bulk|csv)/, title: 'import books from CSV', steps: ['Go to <b>Books</b> and click <b>Template</b> to download an example file.', 'Fill in title, author, isbn, category, total_copies.', 'Click <b>Import CSV</b>, check the preview, then confirm.', 'Rows with errors (missing fields, bad or duplicate ISBN) are skipped and listed.'], act: () => nav('Open books', 'books', 'data-primary') },
    { re: /(export|download|report)/, title: 'export data', steps: ['<b>Overdue list</b>: Return Book → <i>Overdue CSV</i>.', '<b>Books / Members</b>: the <i>Export</i> button on each page.', '<b>Fines</b>: Fines → <i>Export CSV</i>.'], act: () => btn('Download overdue CSV', 'data-download="/api/reports/overdue.csv"') },
    { re: /(add|create|new|register).*(book|title)|(book|title).*(add|create)/, title: 'add a book', steps: ['Go to <b>Books</b> and click <b>Add book</b>.', 'Enter title, author, ISBN (10 or 13 digits), category and total copies.', 'Click <b>Add book</b> — all copies start on the shelf.'], act: () => btn('Add a book', 'data-act="add-book"', 'primary') },
    { re: /(add|create|new|register).*(member|reader|user)|(member).*(add|create|register)/, title: 'add a member', steps: ['Go to <b>Members</b> and click <b>Add member</b>.', 'Enter the name (member ID is generated if left blank), phone and email.', 'Click <b>Add member</b> — you can print a library card straight away.'], act: () => btn('Add a member', 'data-act="add-member"', 'primary') },
    { re: /(delete|remove).*(book)/, title: 'delete a book', steps: ['Open <b>Books</b> and click the bin icon on the book (or open it and click <b>Delete</b>).', 'It is refused while any copy is on loan or reserved — return or cancel those first.'], act: () => nav('Open books', 'books') },
    { re: /(pay|collect|clear).*(fine)|(fine).*(pay|collect|clear)/, title: 'collect a fine', steps: ['Open <b>Fines</b> (or the member\'s profile).', 'Click <b>Collect</b> next to the member.', 'Confirm — all their unpaid fines are cleared and they can borrow again.'], act: () => nav('Open fines', 'fines', 'data-primary') },
    { re: /(edit|change|update).*(member)/, title: 'edit a member', steps: ['Open <b>Members</b> in the sidebar.', 'Click the pencil icon on the member (or open them and click <b>Edit</b>).', 'Change name, phone, email or active status and click <b>Save changes</b>.'], act: () => nav('Open members', 'members', 'data-primary') },
    { re: /(edit|change|update).*(book)/, title: 'edit a book', steps: ['Open <b>Books</b> in the sidebar.', 'Click the pencil icon on the book (or open it and click <b>Edit</b>).', 'Change the details or total copies and click <b>Save changes</b>. Extra copies go to the reservation queue first.'], act: () => nav('Open books', 'books', 'data-primary') },
    { re: /(print|card|slip|receipt)/, title: 'print a card, slip or receipt', steps: ['<b>Loan slip</b>: shown right after issuing a book.', '<b>Return receipt</b>: shown right after a return.', '<b>Library card</b>: open a member and click <b>Library card</b>.'], act: () => nav('Open members', 'members') },
    { re: /(search|find|look ?up)/, title: 'search', steps: ['Press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to search books, members and actions.', 'Press <kbd>/</kbd> to jump to the search box on the current page.', 'On <b>Books</b> you can search by title, author, ISBN or category and filter to available only.'], act: () => btn('Open search', 'data-open-palette') },
  ];

  // ------------------------------------------------------------------ the brain
  function answer(raw) {
    const text = String(raw || '').trim();
    const t = norm(text);
    if (!t) return reply('<p>Type a question, or pick one of the suggestions below.</p>');

    if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(t) && t.split(' ').length <= 4) return welcome();
    if (/^(help|what can you do|what do you do|commands|menu)\b/.test(t)) return capabilities();
    if (/^(thanks|thank you|thx|ok|okay|great|cool)\b/.test(t)) return reply('<p>You\'re welcome! Ask me anything else about the library.</p>');

    // 1) how-to guides
    if (/^(how (do|can|to|should) (i|we|you)|how to|steps to|where (do|can) i|guide)/.test(t) || /\bhow do i\b/.test(t)) {
      const g = HOWTO.find((h) => h.re.test(t));
      if (g) return reply(`<p>To <b>${g.title}</b>:</p><ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`, [g.act()]);
    }
    // 2) rule questions (no specific member/book in the question)
    const members = findMembers(text);
    const books = findBooks(text);
    if (!members.length && !books.length) {
      // Only explanatory questions ("how does…", "what is the rule…") get a rule answer;
      // "what's ready for pickup?" is a live-data question and falls through to the topic lists.
      const explanatory = /(how|rule|policy|why|explain|work|calculat|much|many|long|limit|max|allowed|happen|what (is|are) the|what s the)/.test(t);
      const r = explanatory && RULE_ANSWERS.find((x) => x.re.test(t) && x.when.test(t));
      if (r) return reply(r.html(), r.actions());
    }

    // 3) specific members / books
    if (members.length > 1 && !books.length) return disambiguate('member', members);
    if (books.length > 1 && !members.length && books.length <= 5) return disambiguate('book', books);
    const m = members.length === 1 ? members[0] : null;
    const b = books.length === 1 ? books[0] : null;

    const asksBorrow = /(can|could|may|allowed|able|eligible|possible).*(borrow|issue|take|lend|get|have)|(borrow|issue).*(\?|allowed|possible)/.test(t);
    if (m && asksBorrow) return canBorrow(m, b);
    if (m && b) {
      if (/(return|due|when)/.test(t)) {
        const loan = state.loans.find((l) => l.member_id === m.id && l.book_id === b.id);
        if (loan) return reply(`<p>${esc(m.name)} has <b>${esc(b.title)}</b>, due back <b>${fmtDate(loan.due_on)}</b> (${relDays(loan.due_on)})${loan.overdue ? ` — <span class="t-red">${plural(loan.days_overdue, 'day')} overdue, ${rupees(loan.accrued_fine)} accruing</span>` : ''}.</p>`,
          [btn('Return it', `data-act="return" data-id="${loan.id}"`, 'primary'), openMember(m)]);
      }
      return canBorrow(m, b);
    }
    if (m) {
      if (/(fine|owe|pay|due amount|penalt)/.test(t)) {
        return reply(m.unpaid_fines
          ? `<p>${esc(m.name)} owes <b class="t-red">${rupees(m.unpaid_fines)}</b> in unpaid fines, so they can't borrow until it's paid.</p>`
          : `<p>${esc(m.name)} has <b>no unpaid fines</b>.</p>`, m.unpaid_fines ? [btn(`Collect ${rupees(m.unpaid_fines)}`, `data-act="pay" data-id="${m.id}"`, 'success'), openMember(m)] : [openMember(m)]);
      }
      return memberSummary(m);
    }
    if (b) {
      if (/(who|where|whom|borrowed by|has it|have it)/.test(t)) return bookSummary(b, 'who');
      if (/(available|in stock|on (the )?shelf|copies|copy|can i get|free)/.test(t)) return bookSummary(b, 'avail');
      return bookSummary(b);
    }

    // 4) topics
    const byAuthor = text.match(/\b(?:books?|titles?|anything)\s+(?:by|from|written by)\s+(.+?)[?.!]*$/i);
    if (byAuthor) return searchAnswer('author', byAuthor[1]);
    const inCat = text.match(/\b(?:books?|titles?)\s+(?:in|on|about|under)\s+(?:the\s+)?(.+?)(?:\s+category)?[?.!]*$/i);
    if (inCat) return searchAnswer('category', inCat[1]);

    if (/(expired|expiring).*(member)|(member).*(expired)|expired memberships?/.test(t)) {
      const ex = state.members.filter((mm) => mm.active && mm.valid_until && mm.valid_until < TODAY);
      return ex.length
        ? reply(`<p><b>${plural(ex.length, 'membership')}</b> expired — they can't borrow until renewed:</p>${li(ex.map((mm) => `${esc(mm.name)} (${esc(mm.member_code)}) — ${esc(mm.membership_type || 'General')}, expired ${fmtDate(mm.valid_until)}`))}`,
          ex.slice(0, 3).map((mm) => btn(`Renew ${mm.name.split(' ')[0]}`, `data-act="renew-membership" data-id="${mm.id}"`, 'primary')))
        : reply('<p>No memberships have expired.</p>', [nav('Open members', 'members')]);
    }
    if (/(overdue|late|not returned|past due)/.test(t)) return overdueAnswer();
    if (/(fine|owe|unpaid|penalt|dues)/.test(t)) return finesAnswer();
    if (/(pick ?up|ready|collect(ion)?|held)/.test(t)) return pickupAnswer();
    if (/(reserv|queue|waiting|wait list|waitlist)/.test(t)) return queueAnswer();
    if (/due (today|back today)/.test(t)) return dueSoonAnswer(true);
    if (/(due soon|due this week|due next|coming due|due in|upcoming)/.test(t)) return dueSoonAnswer(false);
    if (/(issued today|lent today|borrowed today|today s (loans|issues))/.test(t)) return issuedTodayAnswer();
    if (/(how many|count|total|number of|stats|statistics|summary|overview|at a glance)/.test(t)) return statsAnswer();
    if (/(popular|most borrowed|top books|trending)/.test(t)) {
      const top = state.stats?.topBooks || [];
      if (top.length) return reply(`<p>Most borrowed books:</p><ol>${top.map((x) => `<li><b>${esc(x.title)}</b> — ${plural(x.loans, 'loan')}</li>`).join('')}</ol>`, [nav('Open dashboard', 'dashboard')]);
    }

    // Loose rule match as a last resort (e.g. "fine rules", "renewal policy")
    const loose = RULE_ANSWERS.find((x) => x.re.test(t));
    if (loose) return reply(loose.html(), loose.actions());
    const guide = HOWTO.find((h) => h.re.test(t));
    if (guide && /(how|where|steps|way)/.test(t)) return reply(`<p>To <b>${guide.title}</b>:</p><ol>${guide.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`, [guide.act()]);

    // Fallback: keyword search across books and members
    const words = t.split(' ').filter((w) => w.length > 2 && !STOP.has(w));
    const bookHits = words.length ? state.books.filter((x) => words.some((w) => norm(`${x.title} ${x.author} ${x.category}`).includes(w))).slice(0, 4) : [];
    const memberHits = words.length ? state.members.filter((x) => words.some((w) => norm(`${x.name} ${x.member_code}`).includes(w))).slice(0, 4) : [];
    if (bookHits.length || memberHits.length) {
      return reply(`<p>I'm not sure what you're asking, but these look related:</p>`,
        [...bookHits.map((x) => btn(x.title, `data-ask="Tell me about ${esc(x.title)}"`)), ...memberHits.map((x) => btn(x.name, `data-ask="Tell me about ${esc(x.name)}"`))]);
    }
    return reply(`<p>Sorry, I didn't understand that. I'm a built-in help assistant, so I work best with questions like the suggestions below — mention a <b>member's name</b> or a <b>book title</b> and I'll look them up.</p>`);
  }

  function welcome() {
    return reply(`<p>Hi! I'm the <b>Library Assistant</b>. Ask me about members, books, loans, fines and reservations — I look everything up in the library's live data.</p>
      <p class="as-muted">I only read information. You stay in control of every action.</p>`);
  }
  function capabilities() {
    return reply(`<p>Here's what I can help with:</p>${li([
      '<b>Members</b> — "Tell me about Asha", "Can Ravi borrow Dune?", "Does Meera owe a fine?"',
      '<b>Books</b> — "Is Sapiens available?", "Who has The Hobbit?", "Books by Tolkien"',
      '<b>Today\'s work</b> — "What\'s overdue?", "What\'s ready for pickup?", "What\'s due soon?"',
      '<b>Rules</b> — "How are fines calculated?", "How do reservations work?", "Renewal rules"',
      '<b>How-to</b> — "How do I import books?", "How do I collect a fine?"'])}`);
  }

  // ------------------------------------------------------------------ suggestions (use real names)
  function suggestions() {
    const s = [];
    const d = state.dash;
    if (d?.overdue?.length) s.push("What's overdue?");
    if (state.members.some((m) => m.unpaid_fines > 0)) s.push('Who owes fines?');
    if (d?.readyForPickup?.length) s.push("What's ready for pickup?");
    const mem = state.members.find((m) => m.active && m.active_issues > 0) || state.members.find((m) => m.active);
    const bk = state.books.find((b) => b.available_copies === 0) || state.books[0];
    if (mem && bk) s.push(`Can ${mem.name.split(' ')[0]} borrow ${bk.title}?`);
    const loaned = state.loans[0];
    if (loaned) s.push(`Who has ${loaned.title}?`);
    s.push('How are fines calculated?', 'How do I renew a loan?', 'Library summary');
    return [...new Set(s)].slice(0, 6);
  }

  // ------------------------------------------------------------------ UI
  ICONS.chat = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  ICONS.sparkle = '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>';
  ICONS.send = '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>';
  const root = document.createElement('div');
  root.innerHTML = `
    <section class="as-panel" id="as-panel" role="dialog" aria-label="Library Assistant" hidden>
      <header class="as-head">
        <span class="as-logo"><span class="bot-emoji" aria-hidden="true">🤖</span></span>
        <div class="as-title"><b>Library Assistant</b><small><span class="as-dot"></span>Help mode · reads live library data</small></div>
        <button class="icon-btn as-icon" id="as-clear" type="button" title="Clear conversation" aria-label="Clear conversation">${icon('renew')}</button>
        <button class="icon-btn as-icon" id="as-close" type="button" title="Close" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="as-log" id="as-log" aria-live="polite"></div>
      <div class="as-sugg" id="as-sugg"></div>
      <form class="as-form" id="as-form" autocomplete="off">
        <input id="as-input" placeholder="Ask about a member, book, fine…" aria-label="Ask the assistant" maxlength="300">
        <button class="btn primary as-send" type="submit" aria-label="Send">${icon('send')}</button>
      </form>
    </section>`;
  document.body.append(root);

  const log = $('#as-log');
  const panel = $('#as-panel');
  const fab = $('#ai-top-btn'); // the assistant opens only from the top bar (or the A shortcut)
  const input = $('#as-input');
  let started = false;

  function addMsg(who, html, actions = []) {
    const el = document.createElement('div');
    el.className = `as-msg ${who}`;
    el.innerHTML = who === 'bot'
      ? `<span class="as-avatar"><span class="bot-emoji" aria-hidden="true">🤖</span></span><div class="as-bubble">${html}${actions.length ? `<div class="as-actions">${actions.join('')}</div>` : ''}</div>`
      : `<div class="as-bubble">${esc(html)}</div>`;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function renderSuggestions() {
    $('#as-sugg').innerHTML = suggestions().map((q) => `<button type="button" class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  }
  function ask(q) {
    const text = String(q || '').trim();
    if (!text) return;
    addMsg('user', text);
    input.value = '';
    const typing = addMsg('bot', '<span class="as-typing"><i></i><i></i><i></i></span>');
    setTimeout(() => {
      let r;
      try { r = answer(text); } catch (err) { console.error(err); r = reply('<p>Sorry — something went wrong while looking that up.</p>'); }
      typing.remove();
      addMsg('bot', r.html, r.actions);
      renderSuggestions();
    }, 350);
  }
  function open() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('on');
    if (!started) {
      started = true;
      const w = welcome();
      addMsg('bot', w.html);
    }
    renderSuggestions();
    setTimeout(() => input.focus(), 30);
  }
  function close() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.classList.remove('on');
  }

  // Robot symbol for the assistant (replaces any icon hydrated earlier).
  $('.ai-spark', fab).innerHTML = '<span class="bot-emoji" aria-hidden="true">🤖</span>';
  fab.setAttribute('aria-expanded', 'false');
  fab.addEventListener('click', () => { if (panel.hidden) open(); else close(); });
  $('#as-close').addEventListener('click', close);
  $('#as-clear').addEventListener('click', () => { log.innerHTML = ''; started = false; open(); });
  $('#as-form').addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ask]');
    if (a) { ask(a.dataset.ask); return; }
    const n = e.target.closest('[data-nav]');
    if (n) {
      const to = n.dataset.nav;
      closeDrawer();
      if (to === 'overdue' || to === 'loans' || to === 'due-soon') { ui.loanFilter = to === 'loans' ? 'active' : to; go('returns'); }
      else if (to === 'fines') { ui.fineFilter = 'unpaid'; go('fines'); }
      else if (to === 'acquisitions' || to === 'digital' || to === 'reports') go(to);
      else go(to);
      return;
    }
    const dl = e.target.closest('[data-download]');
    if (dl) { location.href = dl.dataset.download; return; }
    if (e.target.closest('[data-open-palette]')) { openPalette(); return; }
    const iss = e.target.closest('[data-assist-issue]');
    if (iss) {
      const [mid, bid] = iss.dataset.assistIssue.split(':').map(Number);
      closeDrawer();
      go('issue');
      pickers['pk-issue-member'].setByKey(mid);
      pickers['pk-issue-book'].setByKey(bid);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) { close(); fab.focus(); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'a' || e.key === 'A') && !$('#modal').open && !$('#palette').open) {
      e.preventDefault();
      if (panel.hidden) open(); else close();
    }
  });

  // expose to the command palette and shortcut list
  COMMANDS.unshift({ label: 'Ask the Library Assistant', ic: 'chat', kw: 'help bot question ai chat', run: open });
  window.libraryAssistant = { open, close, ask, answer };
})();
