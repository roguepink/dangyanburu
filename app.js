'use strict';

/* このファイルの中身は全体をIIFE（即時実行関数）で包み、内部の関数や変数が
   グローバルスコープ（window）を汚さないようにしている。他のファイルから
   参照する必要があるものだけ、末尾で意図的に window に公開している。 */
(function () {

const { $, $$, todayStr, parseDate, diffDays, addDays, fmtDate, escapeHtml, pad, DAY } = Util;
const t = (k, v) => I18N.t(k, v);

/* ═══════════════ 状態 ═══════════════ */
const STORE_KEY = 'dangamble_v1';
const STATE_VERSION = 1;

const defaultState = {
  version: STATE_VERSION,
  onboarded: false,
  theme: 'auto',
  lang: 'auto',
  currency: '',             // '' = 言語から自動（ja→JPY / それ以外→USD）
  startDate: todayStr(),
  birthDate: '',
  spendPerWeek: 10000,      // 以前ギャンブルに使っていた1週間あたりの平均額
  hoursPerWeek: 6,          // 以前ギャンブルに使っていた1週間あたりの平均時間
  goalDays: 30,
  goalCelebrated: 0,        // 祝福済みの目標値（重複紙吹雪の防止）
  reminderOn: false,
  reminderTime: '21:00',
  lastReminded: '',
  relapses: [],             // やってしまった日 (YYYY-MM-DD)
  relapseNotes: {},         // { date: きっかけメモ }
  relapseAmounts: {},       // { date: その日に使った金額 }
  relapseChased: {},        // { date: 取り返そうとして続けたか(true/false) }
  logs: {},                 // { date: { mood, urge, note, triggers[] } }
  badgeDates: {},           // { 日数: 達成日 }
  reasons: [],              // やめる理由
  rewardName: '',           // ごほうび貯金の目当て
  rewardPrice: 0,
  rewardCelebrated: '',     // 祝福済みのごほうび（name+price）
  safety: [],               // チェック済みの安全策のインデックス
  urgeWins: 0,              // 衝動タイマーを最後まで使って乗り切った回数
  advice: null,
  adviceHistory: {},
  deviceSalt: '',           // 生年月日未入力でも占いが人によって変わるための端末固有値
  lastBackupAt: '',         // 最後にバックアップを保存した日
  backupNudgedAt: '',       // 最後にバックアップを促した日
  backupNudgeMuted: false,  // バックアップの誘導カードを「もう表示しない」にしたか
  bankNoticeSeen: false,    // 貯金箱イラストを一度タップ済みか（済みなら脈打つ演出を止める）
  nickname: '',             // 設定で入力する任意のニックネーム（ホームの挨拶に使用）
  weekStart: 'sun',         // カレンダーの週の始まり ('sun' | 'mon')
};

/* 保存データの形式が変わったとき、バージョン番号を1つずつ順番に上げながら
   移行処理を適用する仕組み。将来また項目を追加・変更しても、ここに
   「n番目への移行」を1つ足すだけで、既存ユーザーの記録を壊さずに
   引き継げるようにするためのもの。
   （下の load() が実行時にすぐ呼ばれるため、この定義は load() より
   前に置く必要がある＝constは関数と違って巻き上げられないため） */
const MIGRATIONS = {
  /* 例) 3: (s) => { ...; return s; }  ← 項目を増やしたらここに1段階ずつ足す */
};
function migrateState(s, fromVersion) {
  let v = Number(fromVersion) || 1;
  while (v < STATE_VERSION) {
    v++;
    const step = MIGRATIONS[v];
    if (step) { try { s = step(s); } catch (e) { /* 1段階の移行が失敗しても他のデータは活かす */ } }
    s.version = v;
  }
  return s;
}

let state = load();
if (!state.deviceSalt) {
  state.deviceSalt = Math.random().toString(36).slice(2, 12);
  if (state.onboarded) save();
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...defaultState };
    let s = { ...defaultState, ...parsed };
    if (!parsed.version || parsed.version < STATE_VERSION) s = migrateState(s, parsed.version);
    return s;
  } catch (e) {
    return { ...defaultState };
  }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); mirrorReminder(); }

/* Service Workerがアプリを閉じた後も通知を出せるよう、必要最小限の情報を
   IndexedDBに写しておく（SWはlocalStorageを読めないため）。記録本体は写さない。 */
async function mirrorReminder() {
  if (!('indexedDB' in window)) return;
  try {
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('dangamble-sw', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    const days = currentDays();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({
      on: !!state.reminderOn,
      time: state.reminderTime || '21:00',
      lastReminded: state.lastReminded || '',
      loggedDate: state.logs[todayStr()] ? todayStr() : '',
      title: t('notif.title'),
      body: days > 0 ? t('notif.body', { n: days }) : t('notif.body0'),
    }, 'reminder');
    tx.oncomplete = () => db.close();
  } catch (e) { /* IndexedDB不可の環境では画面内通知のみ */ }
}

/* 別タブでの変更を反映 */
window.addEventListener('storage', e => {
  if (e.key === STORE_KEY) { state = load(); applyTheme(); applyLang(); updateDerived(); render(); }
});

/* ═══════════════ 派生値の計算 ═══════════════ */
function streakStart() {
  let start = state.startDate;
  if (state.relapses.length) {
    const last = state.relapses.slice().sort().pop();
    const dayAfter = addDays(last, 1);
    if (parseDate(dayAfter) > parseDate(start)) start = dayAfter;
  }
  return start;
}
function currentDays() { return Math.max(0, diffDays(todayStr(), streakStart())); }
function elapsedDays() { return Math.max(0, diffDays(todayStr(), state.startDate)); }
/* ギャンブル依存では、他の習慣アプリにある「事前に決めた特別な日なら
   やってもよい」という例外を意図的に設けていない。
   「今日は特別だから1回だけ」は、この病気でいちばん多い再発の入口であり、
   アプリの側からその抜け道を用意すべきではないと判断した。 */
function gamblingDayCount() {
  const t = todayStr();
  return new Set(state.relapses.filter(d => d >= state.startDate && d <= t)).size;
}
function totalCleanDays() { return Math.max(0, elapsedDays() - gamblingDayCount()); }
function isRelapseDay(ds) { return state.relapses.includes(ds); }

/* 過去に遡って「飲んでしまった日」を追加/削除しても正しく再計算されるよう、
   保存済みの値を書き換えるのではなく、開始日〜今日を relapses で区切った
   各連続区間の長さから毎回計算し直す。 */
function bestStreakDays() {
  const today = todayStr();
  const relapses = [...new Set(state.relapses)].filter(d => d >= state.startDate && d <= today).sort();
  let segStart = state.startDate;
  let best = 0;
  for (const r of relapses) {
    best = Math.max(best, diffDays(r, segStart));
    segStart = addDays(r, 1);
  }
  return Math.max(best, diffDays(today, segStart));
}

const BADGES = [
  { days: 1,   emoji: '🌱' }, { days: 3,   emoji: '🍃' }, { days: 7,   emoji: '⭐' },
  { days: 14,  emoji: '💪' }, { days: 30,  emoji: '🏅' }, { days: 60,  emoji: '🎖️' },
  { days: 90,  emoji: '🏆' }, { days: 180, emoji: '💎' }, { days: 365, emoji: '👑' },
];
/* 設定値の丸め込み。HTMLのmax属性はスピナーにしか効かず、キーボード入力や
   貼り付けでは素通りするため、保存時にここで必ず上限・下限に収める。
   round=false は「1本あたり◯円」のように小数を許したい項目用。 */
function clampNum(v, lo, hi, round = true) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, round ? Math.round(n) : n));
}

const badgeTitle = b => t('badge.d' + b.days);

/* ═══════════════ 通貨 ═══════════════ */
const CURRENCIES = { JPY: '¥', USD: '$', EUR: '€', GBP: '£', KRW: '₩' };
function curCode() {
  return CURRENCIES[state.currency] ? state.currency : (I18N.lang() === 'ja' ? 'JPY' : 'USD');
}
function fmtMoney(n) {
  return CURRENCIES[curCode()] + Math.round(n).toLocaleString(I18N.locale());
}

/* 状態から派生する更新（描画とは分離）。新規達成バッジの配列を返す。 */
function updateDerived() {
  let changed = false;
  const days = currentDays();

  const newly = [];
  const start = streakStart();
  for (const b of BADGES) {
    if (days >= b.days && !state.badgeDates[b.days]) {
      state.badgeDates[b.days] = addDays(start, b.days);
      newly.push(b);
      changed = true;
    }
  }
  if (changed) save();
  return newly.filter(b => state.badgeDates[b.days] === todayStr());
}

/* ═══════════════ 描画 ═══════════════ */
function render() {
  renderGreeting();
  renderHero();
  renderWeekStrip();
  renderGoal();
  renderReward();
  renderStats();
  renderSafety();
  renderAdvice();
  renderTodayWord();
  renderTodaySummary();
  renderLogList();
  renderCalendar();
  renderCharts();
  renderTriggerInsight();
  renderUrgeWins();
  renderSpent();
  renderBadges();
}

/* --- あいさつ（時間帯＋日替わりのひとこと） --- */
function renderGreeting() {
  const h = new Date().getHours();
  const g = t(h < 5 ? 'greet.evening' : h < 11 ? 'greet.morning' : h < 18 ? 'greet.day' : 'greet.evening');
  const m = t('greet.m' + (Util.hashSeed(todayStr() + 'greet') % 8));
  const name = (state.nickname || '').trim();
  const greetLine = name ? `${t('greet.name', { name })}${g}` : g;
  $('#greeting').textContent = `${greetLine} ${m}`;
}

/* --- ヒーロー（リング・貯金箱・チップ） --- */
const RING_C = 2 * Math.PI * 86;
let lastAnimatedDays = null;

function renderHero() {
  const days = currentDays();
  animateNumber($('#daysCount'), days);
  $('.ring-days i').textContent = t(days === 1 ? 'ring.dayUnit1' : 'ring.dayUnit');
  $('#chipStreak').innerHTML = t('chip.streak', { n: days });
  const elapsed = elapsedDays();
  $('#chipTotal').innerHTML = elapsed > 0
    ? t('chip.totalFrac', { clean: totalCleanDays(), elapsed })
    : t('chip.total', { n: totalCleanDays() });
  $('#chipBest').innerHTML = t('chip.best', { n: bestStreakDays() });
  const urgeChip = $('#chipUrge');
  urgeChip.hidden = !state.urgeWins;
  if (state.urgeWins) urgeChip.innerHTML = t('chip.urge', { n: state.urgeWins });
  $('#counterSub').textContent = t('hero.since', { d1: fmtDate(streakStart()), d2: fmtDate(state.startDate) });

  const next = BADGES.find(b => b.days > days);
  const prev = [...BADGES].reverse().find(b => b.days <= days);
  const base = prev ? prev.days : 0;
  let pct = 1;
  if (next) pct = Math.max(0.02, (days - base) / (next.days - base));
  $('#ringFg').style.strokeDashoffset = RING_C * (1 - pct);
  $('#ringSub').textContent = next
    ? t('hero.nextBadge', { emoji: next.emoji, title: badgeTitle(next), n: next.days - days })
    : t('hero.allBadges');

  renderBank();
  renderBankInfoBtn();
}

function animateNumber(el, target) {
  if (lastAnimatedDays === target) { el.textContent = target; return; }
  lastAnimatedDays = target;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) {
    el.textContent = target; return;
  }
  const dur = 700, t0 = performance.now();
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* --- 貯金箱：使わずに済んだお金がたまっていく様子 ---
   ごほうびを設定していればその金額を満杯、していなければ
   「1か月ぶんの平均額」を満杯として見た目の進み具合を出す。
   肝臓のような体の回復と違い、ギャンブルでは失うのが主にお金と時間なので、
   ここを主役のビジュアルにしている。 */
function bankTargetMoney() {
  const reward = Math.round(Number(state.rewardPrice) || 0);
  if (reward > 0) return reward;
  const monthly = Math.round((Number(state.spendPerWeek) || 0) * 52 / 12);
  return monthly > 0 ? monthly : 1;
}
function renderBank() {
  const money = savedMoney();
  const target = bankTargetMoney();
  const pct = Math.max(0, Math.min(1, money / target));
  const fill = document.getElementById('bankFill');
  /* 瓶の内側は y=26〜88。下から pct ぶんだけ塗り上げる */
  if (fill) {
    const top = 88 - 62 * pct;
    fill.setAttribute('y', String(top));
    fill.setAttribute('height', String(88 - top));
  }
  const name = (state.rewardName || '').trim();
  const remain = Math.max(0, target - money);
  $('#bankCaption').innerHTML = remain <= 0
    ? t('bank.done')
    : (name ? t('bank.remain', { name: escapeHtml(name), n: fmtMoney(remain) })
            : t('bank.remainNoGoal', { money: fmtMoney(money) }));
}
function renderBankInfoBtn() {
  const wrap = $('#heroSide');
  if (wrap) wrap.classList.toggle('bank-seen', !!state.bankNoticeSeen);
}

/* --- 直近7日ストリップ（タップでその日の記録へ） --- */
function renderWeekStrip() {
  const el = $('#weekStrip');
  if (!el) return;
  const today = todayStr();
  const dows = I18N.dows();
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const ds = addDays(today, -i);
    const log = state.logs[ds];
    const relapse = isRelapseDay(ds);
    const inRange = ds >= state.startDate;
    const icon = relapse ? '🎰' : log ? (MOOD_EMOJI[log.mood] || '📝') : inRange ? '🕊️' : '·';
    const cls = 'ws-day' + (ds === today ? ' today' : '') + (relapse ? ' relapse' : '') +
      (!log && !relapse ? ' faint' : '');
    html += `<button class="${cls}" data-date="${ds}" aria-label="${escapeHtml(t('ws.dayAria', { d: fmtDate(ds) }))}">
      <span class="ws-dow">${dows[parseDate(ds).getDay()]}</span><span class="ws-date">${parseDate(ds).getDate()}</span><span class="ws-icon">${icon}</span></button>`;
  }
  el.innerHTML = html;
  $$('#weekStrip .ws-day').forEach(b =>
    b.addEventListener('click', () => openRecordSheet(b.dataset.date)));
}

/* --- 目標 --- */
function renderGoal() {
  const days = currentDays();
  const goal = Math.max(1, state.goalDays || 1);
  const pct = Math.min(100, Math.round((days / goal) * 100));
  const reached = days >= goal;
  $('#goalCard').classList.toggle('reached', reached);
  $('#goalCount').innerHTML = t('goal.count', { d: days, g: goal });
  $('#goalBar').style.width = Math.max(3, pct) + '%';
  $('#goalSub').textContent = reached
    ? t('goal.reached')
    : t('goal.progress', { p: pct, n: goal - days });

  if (reached && state.goalCelebrated !== goal) {
    state.goalCelebrated = goal;
    save();
    celebrate();
    toast(t('goal.toast', { g: goal }));
  }
}

/* --- ごほうび貯金 --- */
/* 1週間あたりの平均額を1日あたりに割り戻して積み上げる。
   「1日あたり」で聞くと少なすぎて実感と合わないため、入力は週単位にしている。 */
function savedMoney() { return Math.round(totalCleanDays() * (Number(state.spendPerWeek) || 0) / 7); }
function savedHours() { return Math.round(totalCleanDays() * (Number(state.hoursPerWeek) || 0) / 7); }

function renderReward() {
  const card = $('#rewardCard');
  if (!card) return;
  const name = (state.rewardName || '').trim();
  const price = Math.round(Number(state.rewardPrice) || 0);
  if (!name || price <= 0) { card.hidden = true; return; }
  card.hidden = false;
  const money = savedMoney();
  const pct = Math.min(100, Math.round((money / price) * 100));
  const reached = money >= price;
  card.classList.toggle('reached', reached);
  $('#rewardCount').innerHTML = `<b>${fmtMoney(Math.min(money, price))}</b> / ${fmtMoney(price)}`;
  $('#rewardBar').style.width = Math.max(3, pct) + '%';
  $('#rewardSub').textContent = reached
    ? t('reward.reached', { name })
    : t('reward.progress', { name, money: fmtMoney(price - money), p: pct });

  const key = name + '|' + price;
  if (reached && state.rewardCelebrated !== key) {
    state.rewardCelebrated = key;
    save();
    celebrate();
    toast(t('reward.toast', { name }));
  }
}

/* --- 統計（通算ベース） --- */
function renderStats() {
  const total = totalCleanDays();
  $('#moneySaved').textContent = fmtMoney(savedMoney());
  $('#hoursSaved').textContent = t('stat.hoursUnit', { n: savedHours().toLocaleString(I18N.locale()) });
  $('#cleanDays').textContent = total.toLocaleString(I18N.locale());
  const el = elapsedDays();
  $('#cleanRate').textContent = (el === 0 ? 100 : Math.round((total / el) * 100)) + '%';
}

/* --- 安全策（環境調整）のチェックリスト --- */
const SAFETY_COUNT = 8;
function safetyDone() { return (state.safety || []).filter(i => i >= 0 && i < SAFETY_COUNT).length; }
function renderSafety() {
  const done = safetyDone();
  $('#safetyCount').textContent = t('safety.count', { done, total: SAFETY_COUNT });
  $('#safetyBar').style.width = Math.max(3, Math.round(done / SAFETY_COUNT * 100)) + '%';
}

/* --- AIアドバイス --- */
function renderAdvice(force) {
  const el = $('#adviceBody');
  if (!el || !window.Advisor) return;
  const today = todayStr();
  const age = Advisor.ageFrom(state.birthDate);

  const days = currentDays();
  const lang = I18N.lang();
  /* 日数もキーに含める。含めないと、初回起動時（0日）に作られた文面が
     オンボーディングで開始日を過去にしたあともその日いっぱい残ってしまう。 */
  if (!force && state.advice && state.advice.date === today && state.advice.lang === lang &&
      state.advice.age === (age == null ? null : age) && state.advice.days === days && state.advice.text) {
    el.textContent = state.advice.text;
    return;
  }
  const salt = (force && state.advice && state.advice.date === today) ? (state.advice.salt || 0) + 1 : 0;
  if (!state.adviceHistory) state.adviceHistory = {};
  const { text } = Advisor.generate({ days, age, date: today, salt, history: state.adviceHistory, lang });
  state.advice = { date: today, salt, age: (age == null ? null : age), days, text, lang };
  save();
  el.textContent = text;
}

/* --- 今日のひとこと ---
   ここは元にした姉妹アプリではタロット占い（★の数と大吉7%）だったが、
   このアプリでは意図的に外している。「毎日ランダムに引いて、たまに当たりが出る」
   仕組みは、スロットやパチンコとまったく同じ変動報酬そのもので、
   ギャンブルをやめようとしている人に毎日それを練習させることになるため。
   代わりに、日付から決まる（＝その日は何度開いても同じ）ひとことを出している。 */
function renderTodayWord() {
  const el = $('#todayBody');
  if (!el || !window.Advisor) return;
  const today = todayStr();
  $('#todayDate').textContent = fmtDate(today);
  el.textContent = Advisor.todayWord(today, I18N.lang());
}

/* --- 今日の記録サマリー --- */
const MOOD_EMOJI = { 5: '😄', 4: '🙂', 3: '😐', 2: '😟', 1: '😣' };
function renderTodaySummary() {
  const td = todayStr();
  const log = state.logs[td];
  const el = $('#todaySummary');
  if (!log) {
    el.innerHTML = `<p class="empty">${escapeHtml(t('log.noneToday'))}</p>
      <button class="btn btn-primary btn-lg" id="logFromTab">${escapeHtml(t('btn.recordToday'))}</button>`;
    $('#logFromTab').addEventListener('click', () => openRecordSheet(td));
    return;
  }
  const tags = (log.triggers || []).map(triggerLabel).join('・');
  el.innerHTML = `<div class="today-summary">
      <span class="ts-emoji">${MOOD_EMOJI[log.mood] || '📝'}</span>
      <div class="ts-text">
        ${escapeHtml(t('log.done'))}
        <div class="ts-sub">${escapeHtml(t('log.urge', { n: log.urge }))}${tags ? ' ・ ' + escapeHtml(tags) : ''}</div>
      </div>
      <button class="btn" id="editToday">${escapeHtml(t('log.edit'))}</button>
    </div>`;
  $('#editToday').addEventListener('click', () => openRecordSheet(td));
}

/* きっかけタグは日本語キーで保存し、表示時に翻訳する */
function triggerLabel(key) {
  const l = t('triggerName.' + key);
  return l.startsWith('triggerName.') ? key : l;
}

/* --- 記録リスト --- */
function renderLogList() {
  const entries = Object.entries(state.logs).sort((a, b) => b[0].localeCompare(a[0]));
  const relapseSet = new Set(state.relapses);
  const list = $('#logList');
  const rows = [];
  for (const [date, log] of entries) rows.push({ date, log, relapse: relapseSet.has(date) });
  for (const date of state.relapses) if (!state.logs[date]) rows.push({ date, log: null, relapse: true });
  rows.sort((a, b) => b.date.localeCompare(a.date));

  if (!rows.length) {
    list.innerHTML = `<p class="empty">${escapeHtml(t('log.empty'))}</p>`;
    return;
  }
  list.innerHTML = rows.map(r => {
    const emoji = r.relapse ? '🎰' : (r.log ? MOOD_EMOJI[r.log.mood] || '📝' : '📝');
    const note = r.log && r.log.note ? escapeHtml(r.log.note) : '';
    const rNote = r.relapse && state.relapseNotes[r.date] ? escapeHtml(state.relapseNotes[r.date]) : '';
    const urge = r.log && r.log.urge != null ? ` ・ ${escapeHtml(t('log.urge', { n: r.log.urge }))}` : '';
    const tags = r.log && r.log.triggers && r.log.triggers.length
      ? `<div class="li-tags">${r.log.triggers.map(x => escapeHtml(triggerLabel(x))).join(' ・ ')}</div>` : '';
    const amt = r.relapse && state.relapseAmounts[r.date]
      ? ' ' + escapeHtml(fmtMoney(state.relapseAmounts[r.date])) : '';
    const badge = r.relapse ? `<div class="li-badge">${escapeHtml(t('log.relapseBadge'))}${amt}${rNote ? '：' + rNote : ''}</div>` : '';
    return `<button class="log-item" data-date="${r.date}">
      <span class="li-emoji">${emoji}</span>
      <span class="li-body">
        <span class="li-date">${fmtDate(r.date)}${urge}</span>
        ${note ? `<span class="li-note">${note}</span>` : ''}
        ${tags}${badge}
      </span>
      <span class="li-edit">${escapeHtml(t('log.editBtn'))}</span>
    </button>`;
  }).join('');
  $$('#logList .log-item').forEach(b =>
    b.addEventListener('click', () => openRecordSheet(b.dataset.date)));
}

/* --- カレンダー（タップで詳細） --- */
let calCursor = new Date();
let selectedDay = null;

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('#calTitle').textContent = I18N.lang() === 'ja'
    ? `${y}年 ${m + 1}月`
    : new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekStartOffset = state.weekStart === 'mon' ? 1 : 0;
  const startDow = (new Date(y, m, 1).getDay() - weekStartOffset + 7) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  const dowsBase = I18N.dows();
  const dows = weekStartOffset ? dowsBase.slice(weekStartOffset).concat(dowsBase.slice(0, weekStartOffset)) : dowsBase;
  let html = dows.map(d => `<div class="cal-cell dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) html += `<div class="cal-cell"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
    let cls = 'cal-cell';
    if (isRelapseDay(ds)) cls += ' relapse';
    else if (ds >= state.startDate && ds <= today) cls += ' sober';
    if (ds === today) cls += ' today';
    if (ds === selectedDay) cls += ' selected';
    const tappable = ds <= today;
    html += tappable
      ? `<button class="${cls}" data-date="${ds}">${d}</button>`
      : `<div class="${cls}" style="opacity:.4">${d}</div>`;
  }
  $('#calendar').innerHTML = html;
  $$('#calendar button.cal-cell').forEach(b =>
    b.addEventListener('click', () => showDayDetail(b.dataset.date)));
  renderDayDetail();
}

function showDayDetail(ds) {
  selectedDay = (selectedDay === ds) ? null : ds;
  renderCalendar();
}

function renderDayDetail() {
  const box = $('#dayDetail');
  if (!selectedDay) { box.hidden = true; return; }
  const ds = selectedDay;
  const today = todayStr();
  const log = state.logs[ds];
  const relapse = isRelapseDay(ds);
  const before = ds < state.startDate;
  const future = ds > today;

  let status = before ? t('dd.before') : relapse ? t('dd.gambled') : t('dd.clean');
  let body = '';
  if (log) {
    body += `<div>${escapeHtml(t('dd.mood', { emoji: MOOD_EMOJI[log.mood] || '', n: log.urge }))}</div>`;
    if (log.triggers && log.triggers.length) body += `<div>${escapeHtml(t('dd.triggers', { list: log.triggers.map(triggerLabel).join('・') }))}</div>`;
    if (log.note) body += `<div>${escapeHtml(log.note)}</div>`;
  }
  if (relapse && state.relapseAmounts[ds]) body += `<div>${escapeHtml(t('dd.amount', { money: fmtMoney(state.relapseAmounts[ds]) }))}</div>`;
  if (relapse && state.relapseChased[ds]) body += `<div>${escapeHtml(t('dd.chased'))}</div>`;
  if (relapse && state.relapseNotes[ds]) body += `<div>${escapeHtml(t('dd.note', { note: state.relapseNotes[ds] }))}</div>`;

  let actions = '';
  if (!future) actions += `<button class="btn" id="ddEdit">${escapeHtml(t(log ? 'dd.edit' : 'dd.add'))}</button>`;
  if (relapse) actions += `<button class="btn" id="ddUnrelapse">${escapeHtml(t('dd.unrelapse'))}</button>`;
  else if (!before && !future) actions += `<button class="btn" id="ddRelapse">${escapeHtml(t('dd.relapse'))}</button>`;

  box.hidden = false;
  box.innerHTML = `<div class="dd-date">${fmtDate(ds)} — ${status}</div>${body}<div class="dd-actions">${actions}</div>`;

  const ed = $('#ddEdit');
  if (ed) ed.addEventListener('click', () => openRecordSheet(ds));
  const un = $('#ddUnrelapse');
  if (un) un.addEventListener('click', () => {
    state.relapses = state.relapses.filter(d => d !== ds);
    delete state.relapseNotes[ds];
    delete state.relapseAmounts[ds];
    delete state.relapseChased[ds];
    save(); updateDerived(); render();
    toast(t('dd.unrelapsed'));
  });
  const re = $('#ddRelapse');
  if (re) re.addEventListener('click', () => addRelapse(ds, { note: '' }));
}

/* --- チャート --- */
function renderCharts() {
  drawLineChart($('#moodChart'), d => (state.logs[d] ? state.logs[d].mood : null), 1, 5,
    t('stats.moodEmpty'));
  drawLineChart($('#urgeChart'), d => (state.logs[d] ? state.logs[d].urge : null), 0, 10,
    t('stats.urgeEmpty'));
}

function drawLineChart(canvas, valueFor, vMin, vMax, emptyMsg) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320, h = 140;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const ds = todayStr(new Date(Date.now() - i * DAY));
    days.push({ ds, v: valueFor(ds) });
  }
  const px = 24, top = 14, bottom = h - 24;
  const stepX = (w - px * 2) / (days.length - 1);
  const yFor = v => bottom - ((v - vMin) / (vMax - vMin)) * (bottom - top);

  const css = getComputedStyle(document.body);
  const primary = css.getPropertyValue('--primary').trim() || '#0d9488';
  const muted = css.getPropertyValue('--muted').trim() || '#8fa3a0';

  ctx.strokeStyle = muted; ctx.globalAlpha = .25; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, bottom); ctx.lineTo(w - px, bottom); ctx.stroke();
  ctx.globalAlpha = 1;

  /* 日付ラベル（両端と中央） */
  ctx.fillStyle = muted; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  [0, 7, 13].forEach(i => {
    const [, m, d] = days[i].ds.split('-');
    ctx.fillText(`${Number(m)}/${Number(d)}`, px + i * stepX, h - 8);
  });

  const pts = days.map((d, i) => d.v != null ? { x: px + i * stepX, y: yFor(d.v) } : null);

  ctx.strokeStyle = primary; ctx.lineWidth = 2.5; ctx.beginPath();
  let started = false;
  pts.forEach(p => {
    if (!p) { started = false; return; }
    if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.fillStyle = primary;
  pts.forEach(p => { if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); } });

  if (pts.every(p => !p)) {
    ctx.fillStyle = muted; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(emptyMsg, w / 2, h / 2);
  }
}

/* --- きっかけの洞察 --- */
function renderTriggerInsight() {
  const counts = {};
  for (const log of Object.values(state.logs)) {
    for (const t of (log.triggers || [])) counts[t] = (counts[t] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const card = $('#triggerCard');
  if (!entries.length) { card.hidden = true; return; }
  card.hidden = false;
  const max = entries[0][1];
  const times = n => I18N.lang() === 'ja' ? `${n}回` : `${n}×`;
  $('#triggerInsight').innerHTML = entries.slice(0, 5).map(([name, n]) =>
    `<div class="ti-row"><span>${escapeHtml(triggerLabel(name))}</span>
      <span class="ti-bar"><i style="width:${Math.round(n / max * 100)}%"></i></span>
      <span class="ti-count">${times(n)}</span></div>`).join('') +
    `<p class="hint" style="margin-top:10px">${escapeHtml(t('stats.triggerHint', { name: triggerLabel(entries[0][0]) }))}</p>`;
}

/* --- 衝動を乗り切った回数 --- */
function renderUrgeWins() {
  const card = $('#urgeWinCard');
  if (!card) return;
  card.hidden = false;
  $('#urgeWinBody').innerHTML = state.urgeWins
    ? t('stats.urgeWinsBody', { n: state.urgeWins })
    : escapeHtml(t('stats.urgeWinsEmpty'));
}

/* --- やってしまった日に使った金額の合計 ---
   責めるための数字ではないが、ギャンブルでは本人が総額を過小評価しやすく、
   事実を1か所にまとめて見えるようにしておくこと自体に意味があるため置いている。 */
function renderSpent() {
  const card = $('#spentCard');
  if (!card) return;
  const dates = Object.keys(state.relapseAmounts).filter(d => Number(state.relapseAmounts[d]) > 0);
  if (!dates.length) { card.hidden = true; return; }
  card.hidden = false;
  const sum = dates.reduce((a, d) => a + Number(state.relapseAmounts[d] || 0), 0);
  $('#spentBody').innerHTML = t('stats.spentBody', { money: fmtMoney(sum), days: dates.length });
}

/* --- バッジ --- */
function renderBadges() {
  const days = currentDays();
  $('#badgesEmptyHint').hidden = days >= BADGES[0].days;
  $('#badgeGrid').innerHTML = BADGES.map(b => {
    const on = days >= b.days;
    const date = state.badgeDates[b.days];
    return `<div class="badge ${on ? 'unlocked' : 'locked'}">
      <div class="b-emoji">${b.emoji}</div>
      <div class="b-title">${escapeHtml(badgeTitle(b))}</div>
      <div class="b-sub">${on ? (date ? fmtDate(date) : escapeHtml(t('badge.done'))) : escapeHtml(t('badge.remain', { n: b.days - days }))}</div>
    </div>`;
  }).join('');
}

/* ═══════════════ 記録シート ═══════════════ */
let sheetDate = null;
let selectedMood = null;

function openRecordSheet(ds) {
  sheetDate = ds;
  const log = state.logs[ds] || {};
  $('#recordDateTitle').textContent = ds === todayStr()
    ? t('sheet.recordTitleToday')
    : t('sheet.recordTitle', { d: fmtDate(ds) });
  selectedMood = log.mood || null;
  $$('.mood').forEach(b => b.classList.toggle('selected', Number(b.dataset.mood) === selectedMood));
  $('#urgeLevel').value = log.urge || 0;
  $('#urgeOut').textContent = `${log.urge || 0} / 10`;
  const trigs = new Set(log.triggers || []);
  $$('#triggerRow .trigger').forEach(b => b.classList.toggle('selected', trigs.has(b.dataset.trigger)));
  $('#note').value = log.note || '';
  openSheet('#recordSheet');
}

function saveLog() {
  if (!sheetDate) return;
  if (!selectedMood) { toast(t('record.needMood')); return; }
  state.logs[sheetDate] = {
    mood: selectedMood,
    urge: Number($('#urgeLevel').value),
    note: $('#note').value.trim(),
    triggers: $$('#triggerRow .trigger.selected').map(b => b.dataset.trigger),
  };
  save();
  closeSheet('#recordSheet');
  const newly = updateDerived();
  render();
  if (newly.length) {
    celebrate();
    toast(t('badge.toast', { emoji: newly[0].emoji, title: badgeTitle(newly[0]) }));
  } else {
    toast(t('record.saved'));
  }
  buzz(12);
}

/* ═══════════════ スリップシート ═══════════════ */
let relapseDayChoice = '0';   // '0'=今日 / '1'=昨日 / 'other'=日付指定
let relapseChaseChoice = '0'; // '1'=取り返そうとして続けた

function openRelapseSheet() {
  relapseDayChoice = '0';
  relapseChaseChoice = '0';
  $$('#relapseDaySeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.day === '0'));
  $$('#relapseChaseSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.chase === '0'));
  $('#relapseDateField').hidden = true;
  $('#relapseDate').value = '';
  $('#relapseDate').max = todayStr();
  $('#relapseAmount').value = '';
  $('#relapseNote').value = '';
  openSheet('#relapseSheet');
}

/* info: { note, amount, chased } — カレンダーからの簡易登録では note のみ */
function addRelapse(ds, info) {
  const o = info || {};
  const undoState = {
    relapses: [...state.relapses],
    notes: { ...state.relapseNotes },
    amounts: { ...state.relapseAmounts },
    chased: { ...state.relapseChased },
  };
  if (!state.relapses.includes(ds)) state.relapses.push(ds);
  if (o.note) state.relapseNotes[ds] = o.note;
  if (o.amount > 0) state.relapseAmounts[ds] = o.amount;
  if (o.chased) state.relapseChased[ds] = true;
  save(); updateDerived(); render();
  switchTab('home');
  buzz(15);
  showUndoConfirm(t('relapse.toast'), t('relapse.undo'), () => {
    state.relapses = undoState.relapses;
    state.relapseNotes = undoState.notes;
    state.relapseAmounts = undoState.amounts;
    state.relapseChased = undoState.chased;
    save(); updateDerived(); render();
    toast(t('relapse.undone'));
  });
  /* 深追いは依存が進んでいるいちばん分かりやすいサイン。
     責める言い方をせず、次に取れる具体的な一手だけを添える。 */
  if (o.chased) setTimeout(() => toast(t('relapse.chasedToast')), 5400);
}

let undoConfirmTimer = null;
function showUndoConfirm(msg, undoLabel, onUndo) {
  const ov = $('#relapseConfirm');
  $('#rcMsg').textContent = msg;
  $('#rcUndo').textContent = undoLabel;
  ov.classList.remove('hidden', 'closing');
  ov.setAttribute('aria-hidden', 'false');
  const close = () => {
    ov.classList.add('closing');
    clearTimeout(undoConfirmTimer);
    setTimeout(() => { ov.classList.add('hidden'); ov.setAttribute('aria-hidden', 'true'); }, 220);
  };
  $('#rcUndo').onclick = () => { close(); onUndo(); };
  $('#rcClose').onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  clearTimeout(undoConfirmTimer);
  undoConfirmTimer = setTimeout(close, 5000);
}

/* ═══════════════ 衝動タイマー ═══════════════
   このアプリの中心機能。ギャンブルの衝動は「山」があり、多くの場合
   10分ほどで越えていくため、その間だけ別のことに注意を向けてもらう。
   最後まで残ると「乗り切れましたか？」と聞き、乗り切れた回数を数える。
   数えることで、我慢が「何も起きなかった時間」ではなく実績になる。 */
let urgeTimer = null;
let urgeTipTimer = null;
let urgeMinutes = 10;
const URGE_TIP_COUNT = 6;

function fmtMMSS(sec) {
  const m = Math.floor(sec / 60), s2 = sec % 60;
  return `${m}:${String(s2).padStart(2, '0')}`;
}

function openUrge() {
  const box = $('#urgeReasons');
  box.innerHTML = state.reasons.length
    ? `<p class="sr-title">${escapeHtml(t('urge.reasonsTitle'))}</p>` +
      state.reasons.map(r => `<div class="sr-item">🍀 ${escapeHtml(r)}</div>`).join('')
    : `<p class="sr-title">${escapeHtml(t('urge.noReasons'))}</p>`;
  resetUrgeUI();
  hideBackupNudge();
  const ov = $('#urgeOverlay');
  if (ov.classList.contains('hidden')) {
    ov.classList.remove('hidden');
    try { history.pushState({ sheet: '#urgeOverlay' }, ''); } catch (e) {}
  }
}

function resetUrgeUI() {
  clearInterval(urgeTimer);
  clearInterval(urgeTipTimer);
  $('#urgeSetup').hidden = false;
  $('#urgeAsk').hidden = true;
  $('#urgeActions').hidden = false;
  $('#urgeStart').hidden = false;
  $('#breathPhase').textContent = t('urge.ready');
  $('#breathPhase').classList.remove('breath-done');
  $('#breathCount').textContent = fmtMMSS(urgeMinutes * 60);
  $('#breathCircle').className = 'breath-circle';
  $('#urgeTip').textContent = '';
  $$('#urgeMinSeg .seg-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.min) === urgeMinutes));
}

function startUrge() {
  $('#urgeSetup').hidden = true;
  $('#urgeStart').hidden = true;
  $('#breathPhase').classList.remove('breath-done');
  const circle = $('#breathCircle');
  const phases = [
    { name: t('urge.in'), cls: 'in', sec: 4 },
    { name: t('urge.out'), cls: 'out', sec: 6 },
  ];
  let remain = urgeMinutes * 60, pi = 0, phaseLeft = phases[0].sec;
  circle.className = 'breath-circle ' + phases[0].cls;
  $('#breathPhase').textContent = phases[0].name;
  $('#breathCount').textContent = fmtMMSS(remain);

  /* 気をそらす具体的な行動を、20秒ごとに順番に出す */
  let tip = Util.hashSeed(todayStr() + 'tip') % URGE_TIP_COUNT;
  const showTip = () => { $('#urgeTip').textContent = t('urge.tip' + (tip % URGE_TIP_COUNT)); tip++; };
  showTip();
  clearInterval(urgeTipTimer);
  urgeTipTimer = setInterval(showTip, 20000);

  clearInterval(urgeTimer);
  urgeTimer = setInterval(() => {
    remain--; phaseLeft--;
    if (remain <= 0) {
      clearInterval(urgeTimer);
      clearInterval(urgeTipTimer);
      circle.className = 'breath-circle';
      $('#breathPhase').textContent = t('urge.doneTitle');
      $('#breathPhase').classList.add('breath-done');
      $('#breathCount').textContent = '0:00';
      $('#urgeActions').hidden = true;
      $('#urgeAsk').hidden = false;
      buzz([40, 80, 40]);
      return;
    }
    if (phaseLeft <= 0) {
      pi = (pi + 1) % phases.length;
      phaseLeft = phases[pi].sec;
      circle.className = 'breath-circle ' + phases[pi].cls;
      $('#breathPhase').textContent = phases[pi].name;
    }
    $('#breathCount').textContent = fmtMMSS(remain);
  }, 1000);
}

function closeUrge(fromPop) {
  clearInterval(urgeTimer);
  clearInterval(urgeTipTimer);
  const ov = $('#urgeOverlay');
  if (ov.classList.contains('hidden')) return;
  ov.classList.add('hidden');
  if (!fromPop && history.state && history.state.sheet === '#urgeOverlay') {
    try { history.back(); } catch (e) {}
  }
}

/* ═══════════════ 安全策（環境調整） ═══════════════ */
function openSafetySheet() {
  const done = new Set(state.safety || []);
  $('#safetyList').innerHTML = Array.from({ length: SAFETY_COUNT }, (_, i) =>
    `<label class="safety-item${done.has(i) ? ' done' : ''}">
      <input type="checkbox" data-safety="${i}"${done.has(i) ? ' checked' : ''} />
      <span>${escapeHtml(t('safety.s' + i))}</span>
    </label>`).join('');
  $$('#safetyList input[data-safety]').forEach(cb => cb.addEventListener('change', () => {
    const i = Number(cb.dataset.safety);
    const set = new Set(state.safety || []);
    if (cb.checked) set.add(i); else set.delete(i);
    state.safety = [...set].sort((a, b) => a - b);
    cb.closest('.safety-item').classList.toggle('done', cb.checked);
    save();
    renderSafety();
    if (cb.checked) buzz(12);
  }));
  openSheet('#safetySheet');
}

/* ═══════════════ 相談窓口 ═══════════════
   番号は日本国内の公的・全国規模の窓口のみを載せている。
   個人が特定される情報は一切送らず、リンクも張らずに番号だけを示す。 */
const HELP_ITEMS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
/* 番号は tel: リンクにして、つらいときに番号を書き写さずそのまま掛けられるようにする。
   相談先を持たない項目（センターや自助グループ）はリンクなし。 */
const HELP_TEL = { g3: '0570-064-556', g4: '0120-279-338', g5: '188', g6: '0570-078374' };
function telLink(num, label) {
  return `<a class="btn btn-sm help-tel" href="tel:${num.replace(/-/g, '')}">📞 ${escapeHtml(label)}</a>`;
}
function openHelpSheet() {
  $('#helpList').innerHTML = HELP_ITEMS.map(k =>
    `<div class="help-item">
      <div class="help-item-title">${escapeHtml(t('help.' + k + 't'))}</div>
      <div class="help-item-body">${escapeHtml(t('help.' + k + 'b'))}</div>
      ${HELP_TEL[k] ? telLink(HELP_TEL[k], HELP_TEL[k]) : ''}
    </div>`).join('');
  $('#helpUrgentTel').innerHTML = telLink('0120-279-338', t('help.urgentCall'));
  openSheet('#helpSheet');
}

/* ═══════════════ 設定 ═══════════════ */
function openSettings() {
  $('#startDate').value = state.startDate;
  $('#goalDays').value = state.goalDays;
  $('#spendPerWeek').value = state.spendPerWeek;
  $('#hoursPerWeek').value = state.hoursPerWeek;
  $('#rewardName').value = state.rewardName || '';
  $('#rewardPrice').value = state.rewardPrice || '';
  $('#nickname').value = state.nickname || '';
  $('#birthDate').value = state.birthDate;
  $('#reasonsInput').value = state.reasons.join('\n');
  $('#reminderOn').checked = state.reminderOn;
  $('#reminderTime').value = state.reminderTime;
  $('#currency').value = curCode();
  $('#currency').dataset.init = curCode();
  $('#currencyWarn').hidden = true;
  $$('#themeSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === state.theme));
  $$('#langSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === (state.lang || 'auto')));
  $$('#weekStartSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.week === state.weekStart));
  updateReminderUI();
  openSheet('#settingsSheet');
}

function updateReminderUI() {
  const on = $('#reminderOn').checked;
  $('#reminderTimeField').style.display = on ? '' : 'none';
  const hint = $('#reminderHint');
  if (!('Notification' in window)) hint.textContent = t('hint.noNotif');
  else if (!on) hint.textContent = t('hint.notifOff');
  else if (Notification.permission === 'denied') hint.textContent = t('hint.notifDenied');
  else hint.textContent = t('hint.notifOn', { time: state.reminderTime });
}

async function saveSettings() {
  const sd = $('#startDate').value;
  if (sd && parseDate(sd) > new Date()) { toast(t('set.futureDate')); return; }
  state.startDate = sd || state.startDate;
  state.currency = $('#currency').value;
  state.goalDays = clampNum(Number($('#goalDays').value) || 30, 1, 3650);
  state.spendPerWeek = clampNum(Number($('#spendPerWeek').value) || 0, 0, 100000000, false);
  state.hoursPerWeek = clampNum(Number($('#hoursPerWeek').value) || 0, 0, 168, false);
  state.rewardName = $('#rewardName').value.trim();
  state.rewardPrice = clampNum(Number($('#rewardPrice').value) || 0, 0, 100000000);
  state.nickname = $('#nickname').value.trim().slice(0, 12);
  const newBirth = $('#birthDate').value || '';
  if (newBirth !== state.birthDate) state.advice = null;
  state.birthDate = newBirth;
  state.reasons = $('#reasonsInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  state.reminderTime = $('#reminderTime').value || '21:00';

  const wantReminder = $('#reminderOn').checked;
  if (wantReminder && 'Notification' in window && Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      $('#reminderOn').checked = false;
      toast(t('notif.denied'));
    }
  }
  state.reminderOn = $('#reminderOn').checked && ('Notification' in window) && Notification.permission === 'granted';

  save();
  closeSheet('#settingsSheet');
  scheduleReminder();
  updatePeriodicSync();
  updateDerived();
  render();
  toast(t('set.saved'));
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme || 'auto';
}

/* --- 言語の適用（静的HTML＋lang属性） --- */
function applyLang() {
  I18N.setLang(state.lang || 'auto');
  document.documentElement.lang = I18N.lang();
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const en = I18N.lang() !== 'ja';
  document.title = en ? 'Gamble-Free Tracker' : 'ギャンブル断ちトラッカー';
  /* ホーム画面に追加した時のアプリ名も言語に合わせる */
  const ml = $('#manifestLink');
  if (ml) ml.href = en ? 'manifest-en.json' : 'manifest.json';
  const at = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (at) at.content = en ? 'Gamble-Free' : 'ギャンブル断ち';
}

/* --- バックアップ --- */
async function exportData() {
  const json = JSON.stringify(state, null, 2);
  const name = `kinshu-backup-${todayStr()}.json`;
  const markDone = () => { state.lastBackupAt = todayStr(); save(); toast(t('backup.saved')); };

  /* スマホでは共有シート経由（Googleドライブ・LINE・メール等に直接送れる） */
  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: t('backup.shareTitle') });
        markDone();
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // ユーザーが共有をキャンセル
      /* 共有に失敗したらダウンロード保存にフォールバック */
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  markDone();
}

/* 記録が溜まってきたら、月1回だけバックアップをそっと促す */
function maybeNudgeBackup() {
  if (!state.onboarded || state.backupNudgeMuted) return;
  if (Object.keys(state.logs).length < 3 && elapsedDays() < 7) return;
  const today = todayStr();
  if (state.lastBackupAt && diffDays(today, state.lastBackupAt) < 30) return;
  if (state.backupNudgedAt && diffDays(today, state.backupNudgedAt) < 7) return;
  state.backupNudgedAt = today;
  save();
  setTimeout(showBackupNudge, 3000);
}

/* シートや全画面表示が開いていないか。開いている間にバックアップ誘導カードを
   出すと、その下のボタンを押せなくしてしまうため。 */
function anyPanelOpen() {
  const open = sel => { const el = $(sel); return el && !el.classList.contains('hidden'); };
  return SHEET_SELS.some(open) || open('#urgeOverlay') || open('#onboarding');
}
function showBackupNudge() {
  /* 表示は読み込みから少し遅れて起きるため、その間に何かが開かれていることがある。
     開いている間は出さずに待ち、閉じられてから改めて出す。 */
  if (anyPanelOpen()) { setTimeout(showBackupNudge, 2000); return; }
  $('#backupNudge').classList.remove('hidden');
}
function hideBackupNudge() {
  $('#backupNudge').classList.add('hidden');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.startDate || typeof data.logs !== 'object') {
        toast(t('backup.invalid')); return;
      }
      /* 今のデータを消して置き換える操作なので、必ず一度確認する */
      const n = Object.keys(data.logs).length;
      if (!confirm(t('backup.confirmLoad', { n, date: data.startDate }))) return;
      state = { ...defaultState, deviceSalt: state.deviceSalt, ...data, version: STATE_VERSION, onboarded: true };
      save(); applyTheme(); applyLang(); updateDerived(); render();
      closeSheet('#settingsSheet');
      toast(t('backup.loaded'));
    } catch (e) {
      toast(t('backup.failed'));
    }
  };
  reader.readAsText(file);
}

/* ═══════════════ リマインダー ═══════════════ */
let reminderTimer = null;
function scheduleReminder() {
  if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
  if (!state.reminderOn || !('Notification' in window) || Notification.permission !== 'granted') return;
  const [h, m] = (state.reminderTime || '21:00').split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) {
    maybeNotify();
    target.setDate(target.getDate() + 1);
  }
  const delay = Math.min(target - now, 2 ** 31 - 1);
  reminderTimer = setTimeout(() => { maybeNotify(); scheduleReminder(); }, delay);
}
function maybeNotify() {
  const td = todayStr();
  if (state.logs[td]) return;
  if (state.lastReminded === td) return;
  if (document.visibilityState === 'visible') return;   // 画面を見ている最中は不要
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  state.lastReminded = td;
  save();
  const days = currentDays();
  const body = days > 0 ? t('notif.body', { n: days }) : t('notif.body0');
  showNotif(t('notif.title'), body);
}

/* Android ChromeはService Worker経由でないと通知を出せないため、SW優先で表示 */
function showNotif(title, body) {
  const opts = { body, tag: 'kinshu-daily', icon: 'icon-192.png', badge: 'icon-192.png' };
  const fallback = () => { try { new Notification(title, opts); } catch (e) {} };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration()
      .then(reg => { if (reg && reg.showNotification) reg.showNotification(title, opts); else fallback(); })
      .catch(fallback);
  } else fallback();
}

/* 対応端末（Androidのホーム画面追加済みPWA）では、アプリを閉じていても
   ブラウザが定期的にSWを起こして通知できるようPeriodic Background Syncを登録 */
async function updatePeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return;
    if (state.reminderOn) {
      await reg.periodicSync.register('dangamble-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    } else {
      await reg.periodicSync.unregister('dangamble-reminder');
    }
  } catch (e) { /* 未対応・権限なしの環境では画面内通知のみ */ }
}

/* ═══════════════ オンボーディング ═══════════════ */
function showOnboarding() {
  $('#obStartDate').value = todayStr();
  /* 海外向けの現実的な初期値（USD想定・週あたり） */
  if (I18N.lang() !== 'ja') $('#obSpend').value = 80;
  $('#onboarding').classList.remove('hidden');
  const go = n => {
    $$('.ob-step').forEach(p => { p.hidden = Number(p.dataset.step) !== n; });
    $$('#obDots i').forEach((d, i) => d.classList.toggle('on', i === n - 1));
  };
  $('#obNext1').addEventListener('click', () => go(2));
  $('#obNext2').addEventListener('click', () => go(3));
  $('#obNext3').addEventListener('click', () => go(4));
  $('#obBack2').addEventListener('click', () => go(1));
  $('#obBack3').addEventListener('click', () => go(2));
  $('#obBack4').addEventListener('click', () => go(3));
  $$('#reasonChips .trigger').forEach(b =>
    b.addEventListener('click', () => b.classList.toggle('selected')));

  const finish = (thenSafety) => {
    const sd = $('#obStartDate').value;
    /* 未来の日付は他の画面と同じく理由を伝えて弾く。
       黙って今日に置き換えると、入力が消えたことに気づけないため。 */
    if (sd && parseDate(sd) > new Date()) { toast(t('set.futureDate')); go(1); return; }
    if (sd) state.startDate = sd;
    state.reasons = $$('#reasonChips .trigger.selected').map(b => b.dataset.reason);
    state.spendPerWeek = clampNum(Number($('#obSpend').value) || (I18N.lang() === 'ja' ? 10000 : 80), 0, 100000000, false);
    state.hoursPerWeek = clampNum(Number($('#obHours').value) || 6, 0, 168, false);
    state.goalDays = clampNum(Number($('#obGoal').value) || 30, 1, 3650);
    state.birthDate = $('#obBirth').value || '';
    state.onboarded = true;
    save();
    $('#onboarding').classList.add('hidden');
    updateDerived();
    render();
    toast(t('ob.done'));
    if (thenSafety) setTimeout(openSafetySheet, 400);
  };
  $('#obFinish').addEventListener('click', () => finish(false));
  $('#obSafety').addEventListener('click', () => finish(true));
}

/* ═══════════════ 紙吹雪 ═══════════════ */
function celebrate(palette) {
  buzz([20, 60, 20]);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = palette || ['#f59e0b', '#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#2dd4bf'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const size = 6 + Math.random() * 7;
    p.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size * (Math.random() > .5 ? 1 : 1.8)}px;` +
      `background:${colors[i % colors.length]};border-radius:${Math.random() > .5 ? '50%' : '2px'}`;
    document.body.appendChild(p);
    const drift = (Math.random() - .5) * 160;
    p.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${drift}px, 105vh) rotate(${360 + Math.random() * 540}deg)`, opacity: .8 },
    ], { duration: 1900 + Math.random() * 1400, delay: Math.random() * 350, easing: 'cubic-bezier(.2,.6,.6,1)' })
      .onfinish = () => p.remove();
  }
}

/* ═══════════════ UI基盤（タブ・シート・トースト） ═══════════════ */
function switchTab(name) {
  $$('.nav-item').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.view').forEach(v => v.classList.toggle('active', v.id === name));
  if (name === 'stats') renderCharts();
  window.scrollTo({ top: 0 });
}

/* シートは開くと履歴を1つ積む → スマホの「戻る」で閉じられる */
const SHEET_SELS = ['#recordSheet', '#relapseSheet', '#settingsSheet', '#bankInfoSheet', '#safetySheet', '#helpSheet'];
let lastFocus = null;

function openSheet(sel) {
  const el = $(sel);
  if (!el.classList.contains('hidden')) return;
  /* バックアップ誘導カードはシートより手前に浮くため、
     開いたシートのボタンを覆ってしまわないよう必ず引っ込める。 */
  hideBackupNudge();
  lastFocus = document.activeElement;
  el.classList.remove('hidden');
  try { history.pushState({ sheet: sel }, ''); } catch (e) {}
  const panel = el.querySelector('.sheet-panel, .sos-box');
  if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true }); }
}

function closeSheet(sel, fromPop) {
  const el = $(sel);
  if (el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  if (!fromPop && history.state && history.state.sheet === sel) {
    try { history.back(); } catch (e) {}
  }
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} lastFocus = null; }
}

/* シートを指で下にスワイプして閉じられるようにする（グリップ部分のみ） */
function enableSheetSwipe(sel) {
  const overlay = $(sel);
  const panel = overlay.querySelector('.sheet-panel');
  const grip = overlay.querySelector('.sheet-grip');
  if (!panel || !grip) return;
  let startY = 0, dy = 0, dragging = false;
  const onStart = (e) => {
    dragging = true; dy = 0; startY = e.touches[0].clientY;
    panel.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) closeSheet(sel);
  };
  grip.addEventListener('touchstart', onStart, { passive: true });
  grip.addEventListener('touchmove', onMove, { passive: true });
  grip.addEventListener('touchend', onEnd);
  grip.addEventListener('touchcancel', onEnd);
}

window.addEventListener('popstate', () => {
  SHEET_SELS.forEach(s => closeSheet(s, true));
  const urge = $('#urgeOverlay');
  if (urge && !urge.classList.contains('hidden')) closeUrge(true);
});

/* 端末が対応していれば軽い振動でフィードバック */
function buzz(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern || 12); } catch (e) {} }
}

/* 実績シェア用のカード画像を生成（Canvas、外部画像は使わない） */
function generateShareCardBlob() {
  return new Promise((resolve) => {
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(null); return; }

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0f766e');
    grad.addColorStop(.6, '#115e59');
    grad.addColorStop(1, '#0b2b27');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,.10)';
    [[130, 150, 70], [930, 210, 46], [860, 900, 100], [150, 900, 56]].forEach(([x, y, r]) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';

    ctx.globalAlpha = .88;
    ctx.font = '600 44px sans-serif';
    ctx.fillText(t('app.title'), W / 2, 170);
    ctx.globalAlpha = 1;

    ctx.font = '800 320px sans-serif';
    ctx.fillText(String(currentDays()), W / 2, 540);

    ctx.font = '700 54px sans-serif';
    ctx.fillText(t('share.cardDays'), W / 2, 620);

    ctx.globalAlpha = .92;
    ctx.font = '600 46px sans-serif';
    ctx.fillText(t('share.cardSaved', { money: fmtMoney(savedMoney()) }), W / 2, 800);
    ctx.globalAlpha = 1;

    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/* 実績のシェア（画像+テキストのWeb Share → テキストのみのWeb Share → クリップボード） */
async function shareProgress() {
  const text = t('share.text', { days: currentDays(), total: totalCleanDays(), money: fmtMoney(savedMoney()) });

  if (navigator.canShare && navigator.share) {
    try {
      const blob = await generateShareCardBlob();
      if (blob) {
        const file = new File([blob], 'progress.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text, title: t('app.title') });
          return;
        }
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('share.copied'));
  } catch (e) {
    toast(t('share.failed'));
  }
}

let toastTimer;
function toast(msg, action, opts) {
  const el = $('#toast');
  el.innerHTML = escapeHtml(msg);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.classList.add('hidden'); action.fn(); });
    el.appendChild(btn);
  }
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (!(opts && opts.sticky)) {
    toastTimer = setTimeout(() => el.classList.add('hidden'), action ? 6000 : 2600);
  }
}

/* ═══════════════ 起動 ═══════════════ */
function init() {
  applyTheme();
  applyLang();

  SHEET_SELS.forEach(enableSheetSwipe);

  /* ナビ */
  $$('.nav-item').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  /* 禁酒継続の円タップ → 達成タブのマイルストーンへジャンプ */
  $('#ringWrap').addEventListener('click', () => switchTab('badges'));
  $('#ringWrap').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('badges'); }
  });

  /* シェア */
  $('#shareBtn').addEventListener('click', shareProgress);

  /* ホーム */
  $('#recordTodayBtn').addEventListener('click', () => openRecordSheet(todayStr()));
  $('#relapseBtn').addEventListener('click', openRelapseSheet);
  $('#urgeBtn').addEventListener('click', openUrge);
  $('#openSafety').addEventListener('click', openSafetySheet);
  $('#openHelp').addEventListener('click', openHelpSheet);
  $('#adviceRefresh').addEventListener('click', () => {
    const btn = $('#adviceRefresh');
    btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin');
    renderAdvice(true);
  });
  /* 記録シート */
  $$('.mood').forEach(btn => btn.addEventListener('click', () => {
    $$('.mood').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMood = Number(btn.dataset.mood);
  }));
  $('#urgeLevel').addEventListener('input', () => { $('#urgeOut').textContent = `${$('#urgeLevel').value} / 10`; });
  $$('#triggerRow .trigger').forEach(b => b.addEventListener('click', () => b.classList.toggle('selected')));
  $('#saveLogBtn').addEventListener('click', saveLog);
  $('#closeRecord').addEventListener('click', () => closeSheet('#recordSheet'));

  /* スリップシート */
  $$('#relapseDaySeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    relapseDayChoice = b.dataset.day;
    $$('#relapseDaySeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    const other = relapseDayChoice === 'other';
    $('#relapseDateField').hidden = !other;
    if (other) {
      const inp = $('#relapseDate');
      if (!inp.value) inp.value = todayStr();
      /* タップした流れでそのまま日付ピッカーを開く（対応ブラウザのみ） */
      try { inp.showPicker(); } catch (e) { inp.focus(); }
    }
  }));
  $('#saveRelapseBtn').addEventListener('click', () => {
    let ds;
    if (relapseDayChoice === 'other') {
      ds = $('#relapseDate').value;
      if (!ds) { toast(t('relapse.pickDate')); return; }
      if (parseDate(ds) > new Date()) { toast(t('set.futureDate')); return; }
    } else {
      ds = addDays(todayStr(), -Number(relapseDayChoice));
    }
    closeSheet('#relapseSheet');
    addRelapse(ds, {
      note: $('#relapseNote').value.trim(),
      amount: clampNum(Number($('#relapseAmount').value) || 0, 0, 100000000),
      chased: relapseChaseChoice === '1',
    });
  });
  $$('#relapseChaseSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    relapseChaseChoice = b.dataset.chase;
    $$('#relapseChaseSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('#closeRelapse').addEventListener('click', () => closeSheet('#relapseSheet'));

  /* 貯金箱イラストの注意書き */
  const openBankInfo = () => {
    if (!state.bankNoticeSeen) { state.bankNoticeSeen = true; save(); renderBankInfoBtn(); }
    openSheet('#bankInfoSheet');
  };
  $('#bankInfoBtn').addEventListener('click', openBankInfo);
  $('#bankInfoIcon').addEventListener('click', openBankInfo);
  $('#closeBankInfo').addEventListener('click', () => closeSheet('#bankInfoSheet'));

  /* 衝動タイマー */
  $('#urgeFab').addEventListener('click', openUrge);
  $('#urgeStart').addEventListener('click', startUrge);
  $('#urgeClose').addEventListener('click', () => closeUrge());
  $('#urgeHelpLink').addEventListener('click', openHelpSheet);
  $$('#urgeMinSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    urgeMinutes = Number(b.dataset.min) || 10;
    $$('#urgeMinSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    $('#breathCount').textContent = fmtMMSS(urgeMinutes * 60);
  }));
  $('#urgeWon').addEventListener('click', () => {
    state.urgeWins = (state.urgeWins || 0) + 1;
    save();
    closeUrge();
    render();
    celebrate();
    toast(state.urgeWins === 1 ? t('urge.wonFirst') : t('urge.wonToast', { n: state.urgeWins }));
  });
  $('#urgeLost').addEventListener('click', () => {
    closeUrge();
    openRelapseSheet();
  });

  /* 安全策・相談窓口 */
  $('#closeSafety').addEventListener('click', () => closeSheet('#safetySheet'));
  $('#closeHelp').addEventListener('click', () => closeSheet('#helpSheet'));
  $('#openSafetyFromSet').addEventListener('click', () => { closeSheet('#settingsSheet'); openSafetySheet(); });
  $('#openHelpFromSet').addEventListener('click', () => { closeSheet('#settingsSheet'); openHelpSheet(); });

  /* 設定 */
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#closeSettings').addEventListener('click', () => closeSheet('#settingsSheet'));
  $('#reminderOn').addEventListener('change', updateReminderUI);
  /* 通貨を変えたら金額の入れ直しを促す（自動両替はしない） */
  $('#currency').addEventListener('change', () => {
    const warn = $('#currencyWarn');
    warn.hidden = $('#currency').value === ($('#currency').dataset.init || curCode());
    if (!warn.hidden) {
      const f = $('#spendPerWeek');
      f.classList.remove('pulse-attn'); void f.offsetWidth; f.classList.add('pulse-attn');
    }
  });
  $$('#themeSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    state.theme = b.dataset.theme;
    $$('#themeSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    applyTheme(); save(); renderCharts();
  }));
  $$('#langSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    $$('#langSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    save(); applyLang(); updateReminderUI(); render();
  }));
  $$('#weekStartSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    state.weekStart = b.dataset.week;
    $$('#weekStartSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    save(); renderCalendar();
  }));
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#backupNudgeSave').addEventListener('click', async () => { await exportData(); hideBackupNudge(); });
  $('#backupNudgeLater').addEventListener('click', hideBackupNudge);
  $('#backupNudgeClose').addEventListener('click', hideBackupNudge);
  $('#backupNudgeMute').addEventListener('click', () => {
    state.backupNudgeMuted = true;
    save();
    hideBackupNudge();
  });
  $('#resetAll').addEventListener('click', () => {
    if (confirm(t('set.confirmReset'))) {
      localStorage.removeItem(STORE_KEY);
      state = { ...defaultState };
      save(); applyTheme(); applyLang(); render();
      closeSheet('#settingsSheet');
      showOnboarding();
    }
  });

  /* シートの背景タップ・Escで閉じる */
  SHEET_SELS.forEach(sel => {
    $(sel).addEventListener('click', e => { if (e.target === $(sel)) closeSheet(sel); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    SHEET_SELS.forEach(s => closeSheet(s));
    closeUrge();
  });

  /* カレンダー */
  $('#calPrev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  $('#calNext').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });

  const newly = updateDerived();
  render();
  if (newly.length) { celebrate(); toast(t('badge.toast', { emoji: newly[0].emoji, title: badgeTitle(newly[0]) })); }

  if (!state.onboarded) showOnboarding();
  else {
    maybeNudgeBackup();
    /* ホーム画面アイコンの長押しショートカット（manifest.jsonのshortcuts）から起動した場合 */
    const action = new URLSearchParams(location.search).get('action');
    if (action === 'record') openRecordSheet(todayStr());
    else if (action === 'urge') openUrge();
    if (action) history.replaceState(null, '', location.pathname);
  }

  scheduleReminder();
  updatePeriodicSync();
  /* 日付またぎ対応。アプリを開いたまま日付が変わっても継続日数が止まらないよう、
     1分ごとと「画面に戻ったとき」に日付を見張り、変わっていたら数え直す。
     スマホのホーム画面から使うと何日も起動しっぱなしになるため必須。 */
  let shownDate = todayStr();
  const checkDateRollover = () => {
    const now = todayStr();
    if (now === shownDate) return;
    shownDate = now;
    const newly = updateDerived();
    render();
    if (newly.length) {
      celebrate();
      toast(t('badge.toast', { emoji: newly[0].emoji, title: badgeTitle(newly[0]) }));
    }
  };
  setInterval(checkDateRollover, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    scheduleReminder();
    checkDateRollover();
  });
  window.addEventListener('focus', checkDateRollover);
  window.addEventListener('resize', () => { if ($('#stats').classList.contains('active')) renderCharts(); });

  /* Service Worker 登録＋更新通知
     updateViaCache:'none' で sw.js自体のHTTPキャッシュ再利用を止め、
     毎回のregister()呼び出しで確実にネットワークから真の最新版を取得する。 */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const promptUpdate = () => toast(t('sw.update'), { label: t('sw.reload'), fn: () => location.reload() }, { sticky: true });
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate();
        });
      });
      reg.update().catch(() => {});
    }).catch(() => {});
  }
}

/* 何らかの理由で起動処理そのものが失敗した場合、白い画面のまま固まる
   のではなく「データは無事です」と伝えてから再読み込みを促す。
   I18N側が原因で失敗した可能性もあるため、ここでは翻訳を使わず
   ブラウザの言語設定から直接ja/enだけを判定する。 */
function showFatalError() {
  try {
    const ja = !(navigator.language || '').toLowerCase().startsWith('en');
    document.body.innerHTML =
      '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;text-align:center;gap:16px;padding:32px;' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Hiragino Kaku Gothic ProN\',sans-serif;">' +
      '<div style="font-size:2.4rem;">🌱</div>' +
      '<p style="font-size:1.02rem;font-weight:700;max-width:320px;line-height:1.7;color:#10221f;">' +
      (ja
        ? '問題が発生しました。この端末に保存されている記録は無事です。<br>お手数ですが、再読み込みをお試しください。'
        : 'Something went wrong. Your records saved on this device are safe.<br>Please try reloading the page.') +
      '</p>' +
      '<button type="button" id="fatalReloadBtn" style="padding:13px 30px;border-radius:14px;border:none;' +
      'background:#0d9488;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;">' +
      (ja ? '再読み込み' : 'Reload') + '</button></div>';
    const btn = document.getElementById('fatalReloadBtn');
    if (btn) btn.addEventListener('click', () => location.reload());
  } catch (e2) { /* ここまで失敗したら打てる手がない */ }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    init();
  } catch (e) {
    showFatalError();
  }
});

/* テスト（tests/smoke.cjs）がスティッキートーストを直接呼び出せるように、
   このひとつだけ意図的にwindowへ公開する */
window.toast = toast;

})();
