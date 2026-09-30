'use strict';
/* Barcode rendering (SVG) for book labels and library cards.
 *  • EAN-13  — books (ISBN-13; ISBN-10 is converted to its 978-prefixed ISBN-13)
 *  • Code 39 — member library cards (member IDs like M0001)
 * Any USB/Bluetooth barcode scanner or RFID reader in "keyboard mode" reads these and types the code
 * followed by Enter, which the scan boxes on the Issue Book and Return Book pages pick up.
 */
window.Barcode = (() => {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const escXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** ISBN (10 or 13) -> 13 EAN digits, or null. */
  function toEan13(isbn) {
    const s = String(isbn || '').replace(/[\s-]/g, '').toUpperCase();
    let d12;
    if (/^\d{13}$/.test(s)) return s;
    if (/^\d{9}[\dX]$/.test(s)) d12 = `978${s.slice(0, 9)}`;
    else if (/^\d{12}$/.test(s)) d12 = s;
    else return null;
    const sum = [...d12].reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0);
    return d12 + ((10 - (sum % 10)) % 10);
  }

  function ean13(isbn, { height = 60, module = 2 } = {}) {
    const code = toEan13(isbn);
    if (!code) return '';
    const first = Number(code[0]);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === 'L' ? L : G)[Number(code[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
    bits += '101';
    const quiet = 11;
    const w = (bits.length + quiet * 2) * module;
    const guard = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
    let rects = '';
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      const h = guard.has(i) ? height + 8 : height;
      rects += `<rect x="${(quiet + i) * module}" y="0" width="${module}" height="${h}"/>`;
    }
    const ty = height + 20;
    const txt = (x, s) => `<text x="${x}" y="${ty}" text-anchor="middle">${s}</text>`;
    return `<svg class="barcode" viewBox="0 0 ${w} ${height + 24}" width="${w}" height="${height + 24}" role="img" aria-label="Barcode ${code}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>
      <g fill="#000" font-family="ui-monospace, Consolas, monospace" font-size="${module * 7}">
        ${txt(module * 5, code[0])}${txt((quiet + 3 + 21) * module, code.slice(1, 7))}${txt((quiet + 50 + 21) * module, code.slice(7))}</g></svg>`;
  }

  // Code 39: 9 elements per character (bar, space, bar, …), n = narrow, w = wide; '*' is start/stop.
  const C39 = {
    0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn',
    A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
    K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
    U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  };
  function code39(text, { height = 50, narrow = 2, showText = true } = {}) {
    const value = String(text || '').toUpperCase();
    if (!value || [...value].some((c) => !C39[c])) return '';
    const wide = narrow * 2.5;
    const chars = `*${value}*`;
    let x = narrow * 10;
    let rects = '';
    for (const ch of chars) {
      [...C39[ch]].forEach((el, i) => {
        const wdt = el === 'w' ? wide : narrow;
        if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${wdt}" height="${height}"/>`;
        x += wdt;
      });
      x += narrow; // gap between characters
    }
    const w = x + narrow * 9;
    return `<svg class="barcode" viewBox="0 0 ${w} ${height + (showText ? 18 : 0)}" width="${w}" height="${height + (showText ? 18 : 0)}" role="img" aria-label="Barcode ${escXml(value)}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>
      ${showText ? `<text x="${w / 2}" y="${height + 14}" text-anchor="middle" font-family="ui-monospace, Consolas, monospace" font-size="12" fill="#000">${escXml(value)}</text>` : ''}</svg>`;
  }

  return { ean13, code39, toEan13 };
})();
