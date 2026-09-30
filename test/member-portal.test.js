import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Library } from '../src/library.js';

process.env.DB_FILE = ':memory:';
const { createApp } = await import('../src/server.js');

test('member page: signs in with member ID + last 4 phone digits, hides contact details, limits guesses', async () => {
  const lib = new Library(openDb(), { today: () => '2026-09-01' });
  const m = lib.addMember({ name: 'Test Reader', phone: '9876543210', email: 'reader@example.com' });
  const b = lib.addBook({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', totalCopies: 1 });
  lib.issueBook({ memberId: m.id, bookId: b.id });
  const server = createApp(lib).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/me`;
  const post = (body, ip = '1.1.1.1') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  try {
    const ok = await post({ code: m.member_code.toLowerCase(), phone: '3210' });
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.equal(data.member.name, 'Test Reader');
    assert.equal(data.loans.length, 1);
    assert.equal(data.loans[0].title, 'Dune');
    assert.ok(!JSON.stringify(data).includes('9876543210') && !JSON.stringify(data).includes('reader@example.com'));

    assert.equal((await post({ code: m.member_code, phone: '0000' })).status, 404);
    assert.equal((await post({ code: m.member_code, phone: '12' })).status, 400);
    for (let i = 0; i < 8; i += 1) await post({ code: m.member_code, phone: '1111' }, '2.2.2.2');
    assert.equal((await post({ code: m.member_code, phone: '3210' }, '2.2.2.2')).status, 429);
  } finally {
    server.close();
  }
});

test('member page: a member without a phone number gets a clear message', async () => {
  const lib = new Library(openDb(), { today: () => '2026-09-01' });
  const m = lib.addMember({ name: 'No Phone' });
  const server = createApp(lib).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/me`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '3.3.3.3' }, body: JSON.stringify({ code: m.member_code, phone: '1234' }) });
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /no phone number saved/);
  } finally {
    server.close();
  }
});
