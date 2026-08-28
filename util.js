'use strict';

/* 共有ユーティリティ（日付・乱数・DOM）。全スクリプトより先に読み込む。 */
window.Util = (() => {
  const DAY = 86400000;

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr(d = new Date()) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function diffDays(a, b) { return Math.round((parseDate(a) - parseDate(b)) / DAY); }
  function addDays(ds, n) { return todayStr(new Date(parseDate(ds).getTime() + n * DAY)); }
  function fmtDate(ds) {
    try {
      const loc = window.I18N ? I18N.locale() : 'ja-JP';
      return parseDate(ds).toLocaleDateString(loc, { month: 'long', day: 'numeric', weekday: 'short' });
    } catch (e) { return ds; }
  }

  /* FNV-1a 32bit ハッシュ → 擬似乱数 */
  function hashSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s ^ (s >>> 15), 1 | s) >>> 0);
      s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) >>> 0;
      return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  return { DAY, pad, todayStr, parseDate, diffDays, addDays, fmtDate, hashSeed, rng, escapeHtml, $, $$ };
})();
