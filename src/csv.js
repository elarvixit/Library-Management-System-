/** RFC 4180-style CSV parser: handles quoted fields, escaped quotes (""), commas/newlines inside quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const HEADER_ALIASES = {
  title: 'title', name: 'title', 'book title': 'title',
  author: 'author', authors: 'author',
  isbn: 'isbn', 'isbn13': 'isbn', 'isbn-13': 'isbn', 'isbn10': 'isbn',
  category: 'category', genre: 'category', subject: 'category',
  total_copies: 'total_copies', 'total copies': 'total_copies', copies: 'total_copies', quantity: 'total_copies', qty: 'total_copies',
};

/** Parses a books CSV (header row required) into objects with a __line number for error reporting. */
export function parseBooksCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  const missing = ['title', 'author', 'isbn', 'total_copies'].filter((k) => !header.includes(k));
  if (missing.length) {
    throw new Error(`CSV header is missing column(s): ${missing.join(', ')}. Expected: title, author, isbn, category, total_copies.`);
  }
  const out = [];
  rows.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return; // ignore blank lines
    const obj = { __line: i + 2 };
    header.forEach((key, col) => { if (key) obj[key] = (cells[col] ?? '').trim(); });
    out.push(obj);
  });
  return out;
}

export function toCsv(headers, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
