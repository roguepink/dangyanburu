/* ギャンブル断ちトラッカー E2Eスモークテスト
   実行: node tests/smoke.cjs (要: 起動済みローカルサーバー localhost:8130) */
/* playwright はローカル環境ではグローバル、CIでは node_modules から読み込む */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const URL = process.env.TEST_URL || 'http://localhost:8130/index.html';
const EXEC = process.env.CHROME_PATH ||
  (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : '');
let failures = [];
function check(name, cond) {
  console.log((cond ? '  ok ' : '  NG ') + name);
  if (!cond) failures.push(name);
}
const ymd = d => new Date(d).toISOString().slice(0, 10);
/* バックアップ誘導カードは画面下部に出て操作を邪魔するので、出ていたら閉じる */
async function dismissNudge(page) {
  const el = await page.$('#backupNudge');
  if (el && !(await el.evaluate(n => n.classList.contains('hidden')))) {
    await page.click('#backupNudgeLater');
    await page.waitForTimeout(200);
  }
}
const daysAgo = n => ymd(Date.now() - n * 86400000);

/* 週14,000円・週7時間で開始10日前 →
   使わずに済んだお金 = 10日 × 14000/7 = ¥20,000 / 取り戻した時間 = 10時間 */
async function onboard(page, opts) {
  const o = opts || {};
  await page.waitForTimeout(400);
  await page.fill('#obStartDate', o.start || daysAgo(10));
  await page.click('#reasonChips .trigger[data-reason="借金を減らしたい"]');
  await page.click('#reasonChips .trigger[data-reason="家族・大切な人のため"]');
  await page.click('#obNext1');
  await page.fill('#obSpend', o.spend || '14000');
  await page.fill('#obHours', o.hours || '7');
  await page.click('#obNext2');
  await page.fill('#obGoal', o.goal || '30');
  if (o.birth !== null) await page.fill('#obBirth', o.birth || '1985-03-10');
  await page.click('#obNext3');
  await page.click('#obFinish');
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // ── 1. 新規ユーザー: オンボーディング（4ステップ） ──
  await page.goto(URL);
  await page.waitForTimeout(400);
  check('新規: オンボーディング表示', !(await page.$eval('#onboarding', el => el.classList.contains('hidden'))));
  check('オンボーディングは4ステップ', (await page.$$('#obDots i')).length === 4);
  check('4ステップ目は安全策の案内', !!(await page.$('.ob-step[data-step="4"] #obSafety')));
  await onboard(page);
  check('オンボーディング完了で閉じる', await page.$eval('#onboarding', el => el.classList.contains('hidden')));
  await page.waitForTimeout(800); // カウントアップ完了待ち
  check('継続10日', (await page.textContent('#daysCount')) === '10');
  check('通算10日', (await page.textContent('#chipTotal b')) === '10');
  check('通算は経過日数を分母にした分数表示', /10\s*\/\s*10日/.test(await page.textContent('#chipTotal')));
  check('最長10日', (await page.textContent('#chipBest b')) === '10');
  check('使わずに済んだお金 ¥20,000', (await page.textContent('#moneySaved')) === '¥20,000');
  check('取り戻した時間 10時間', (await page.textContent('#hoursSaved')) === '10時間');
  check('やらなかった日数 10', (await page.textContent('#cleanDays')) === '10');
  check('達成率100%', (await page.textContent('#cleanRate')) === '100%');
  check('あいさつ表示', ((await page.textContent('#greeting')) || '').length > 3);
  check('週間ストリップ7日分', (await page.$$('#weekStrip .ws-day')).length === 7);
  check('週間ストリップに日付が入る', /\d/.test(await page.textContent('#weekStrip .ws-day .ws-date')));

  // ── 2. ギャンブル依存向けの設計判断（重要な回帰テスト） ──
  check('タロット等のランダム抽選UIが存在しない', !(await page.$('#tarotFlip')) && !(await page.$('.fortune-card')));
  check('大吉ジャックポット演出が存在しない', !(await page.$('#jackpotOverlay')));
  check('「特別な日」の例外機能が存在しない', !(await page.$('#exceptionBtn')) && !(await page.$('#exceptionSheet')));
  const word1 = await page.textContent('#todayBody');
  check('今日のひとことが表示される', (word1 || '').length > 5);
  await page.reload();
  await page.waitForTimeout(500);
  await dismissNudge(page);
  check('今日のひとことは開き直しても同じ（抽選ではない）', (await page.textContent('#todayBody')) === word1);

  // ── 3. 衝動ボタンが記録ボタンより上にある（押してほしい順） ──
  const order = await page.evaluate(() => {
    const u = document.querySelector('#urgeBtn').compareDocumentPosition(document.querySelector('#recordTodayBtn'));
    return !!(u & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check('衝動ボタンが今日を記録より前に置かれている', order);
  check('画面下に常時表示の衝動ボタンがある', !!(await page.$('#urgeFab')));

  // ── 4. 今日を記録（気分必須） ──
  await page.click('#recordTodayBtn');
  await page.click('#saveLogBtn'); // 気分未選択 → エラートースト
  await page.waitForTimeout(200);
  check('気分未選択で保存できない', !(await page.$eval('#recordSheet', el => el.classList.contains('hidden'))));
  await page.click('.mood[data-mood="4"]');
  await page.$eval('#urgeLevel', el => { el.value = 6; el.dispatchEvent(new Event('input')); });
  await page.click('#triggerRow .trigger[data-trigger="給料日・入金"]');
  await page.click('#triggerRow .trigger[data-trigger="負けを取り返したい"]');
  await page.fill('#note', 'テストメモ');
  await page.click('#saveLogBtn');
  await page.waitForTimeout(400);
  check('記録シートが閉じる', await page.$eval('#recordSheet', el => el.classList.contains('hidden')));
  await page.click('.nav-item[data-tab="log"]');
  await page.waitForTimeout(200);
  check('今日の記録サマリーに反映', /やりたい気持ち 6/.test(await page.textContent('#todaySummary')));
  check('記録リストにメモ', /テストメモ/.test(await page.textContent('#logList')));
  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(300);
  check('きっかけの集計が出る', !(await page.$eval('#triggerCard', el => el.hidden)));
  check('ギャンブル特有のきっかけが選べる', /取り返したい/.test(await page.textContent('#triggerInsight')));

  // ── 5. 衝動タイマー（乗り切った回数が積み上がる） ──
  await page.click('.nav-item[data-tab="home"]');
  await dismissNudge(page);
  await page.click('#urgeBtn');
  await page.waitForTimeout(300);
  check('衝動タイマーが開く', !(await page.$eval('#urgeOverlay', el => el.classList.contains('hidden'))));
  check('初期表示は10:00', (await page.textContent('#breathCount')) === '10:00');
  check('やめる理由が表示される', /借金を減らしたい/.test(await page.textContent('#urgeReasons')));
  await page.click('#urgeMinSeg .seg-btn[data-min="3"]');
  check('3分を選ぶと3:00になる', (await page.textContent('#breathCount')) === '3:00');
  check('相談窓口への導線がある', !!(await page.$('#urgeHelpLink')));
  await page.click('#urgeClose');
  await page.waitForTimeout(200);
  check('衝動タイマーを閉じられる', await page.$eval('#urgeOverlay', el => el.classList.contains('hidden')));

  // ── 6. 安全策チェックリスト ──
  await page.click('#openSafety');
  await page.waitForTimeout(300);
  check('安全策シートが開く', !(await page.$eval('#safetySheet', el => el.classList.contains('hidden'))));
  check('安全策は8項目', (await page.$$('#safetyList input[data-safety]')).length === 8);
  await page.click('#safetyList input[data-safety="0"]');
  await page.click('#safetyList input[data-safety="1"]');
  await page.waitForTimeout(200);
  check('チェックが進捗に反映される', (await page.textContent('#safetyCount')) === '2 / 8');
  check('チェック済み項目に印が付く', await page.$eval('#safetyList label:first-child', el => el.classList.contains('done')));
  await page.click('#closeSafety');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(600);
  await dismissNudge(page);
  check('安全策のチェックが保存されている', (await page.textContent('#safetyCount')) === '2 / 8');

  // ── 7. 相談窓口 ──
  await page.click('#openHelp');
  await page.waitForTimeout(300);
  check('相談窓口シートが開く', !(await page.$eval('#helpSheet', el => el.classList.contains('hidden'))));
  const helpText = await page.textContent('#helpSheet');
  check('自助グループ(GA)の案内がある', /ギャンブラーズ・アノニマス/.test(helpText));
  check('24時間の窓口が案内されている', /0120-279-338/.test(helpText));
  check('借金の相談先が案内されている', /188|法テラス/.test(helpText));
  check('危機時の案内が最初に出ている', /死にたい/.test(await page.textContent('.help-urgent')));
  check('番号はタップで発信できる',
    (await page.getAttribute('#helpUrgentTel a', 'href')) === 'tel:0120279338');
  check('各窓口にも発信ボタンがある', (await page.$$('#helpList .help-tel')).length === 4);
  await page.click('#closeHelp');
  await page.waitForTimeout(200);

  // ── 8. スリップ（金額・深追いつき）＋undo → 通算は保持 ──
  await page.click('#relapseBtn');
  await page.waitForTimeout(300);
  await page.click('#relapseDaySeg .seg-btn[data-day="1"]'); // 昨日
  await page.fill('#relapseAmount', '30000');
  await page.click('#relapseChaseSeg .seg-btn[data-chase="1"]');
  await page.fill('#relapseNote', '給料日に駅前を通った');
  await page.click('#saveRelapseBtn');
  await page.waitForTimeout(700);
  check('スリップで連続日数がリセット', (await page.textContent('#daysCount')) === '0');
  check('通算は9日に減るだけ（記録は消えない）', (await page.textContent('#chipTotal b')) === '9');
  check('最長記録は9日として残る（通算の記録は消えない）', (await page.textContent('#chipBest b')) === '9');
  check('取り消しカードが出る', !(await page.$eval('#relapseConfirm', el => el.classList.contains('hidden'))));
  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(400);
  check('使ってしまった金額の合計が出る', /¥30,000/.test(await page.textContent('#spentBody')));
  await page.click('.nav-item[data-tab="log"]');
  await page.waitForTimeout(200);
  check('記録リストに金額が出る', /¥30,000/.test(await page.textContent('#logList')));

  // ── 9. カレンダーの日別詳細（金額・深追いが見える） ──
  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(300);
  await page.click(`#calendar button[data-date="${daysAgo(1)}"]`);
  await page.waitForTimeout(300);
  const dd = await page.textContent('#dayDetail');
  check('日別詳細に「やってしまった日」', /やってしまった日/.test(dd));
  check('日別詳細に使った金額', /¥30,000/.test(dd));
  check('日別詳細に深追いの記録', /取り返そうとして続けた/.test(dd));
  check('日別詳細にメモ', /駅前/.test(dd));
  await page.click('#ddUnrelapse');
  await page.waitForTimeout(500);
  check('日別詳細から取り消せる', (await page.textContent('#daysCount')) === '10');

  // ── 10. カレンダーの週の始まり（日曜⇔月曜） ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#weekStartSeg .seg-btn[data-week="mon"]');
  await page.waitForTimeout(200);
  check('月曜始まりに切り替わる', (await page.textContent('#calendar .cal-cell.dow')) === '月');
  await page.click('#weekStartSeg .seg-btn[data-week="sun"]');
  await page.waitForTimeout(200);
  check('日曜始まりに戻せる', (await page.textContent('#calendar .cal-cell.dow')) === '日');

  // ── 11. 設定：ごほうび貯金・ニックネーム・上限クランプ ──
  await page.fill('#rewardName', '家族と旅行');
  await page.fill('#rewardPrice', '30000');
  await page.fill('#nickname', 'たろう');
  await page.fill('#goalDays', '99999');        // 上限3650を超える値
  await page.fill('#spendPerWeek', '14000');
  await page.click('#saveSettings');
  await page.waitForTimeout(600);
  check('ごほうび貯金カードが出る', !(await page.$eval('#rewardCard', el => el.hidden)));
  check('ごほうびの残り¥10,000', /¥10,000/.test(await page.textContent('#rewardSub')));
  check('ニックネームが挨拶に反映', /たろう/.test(await page.textContent('#greeting')));
  check('目標日数が上限3650に丸められる', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dangamble_v1')).goalDays === 3650));
  check('貯金箱の説明文にごほうび名が出る', /家族と旅行/.test(await page.textContent('#bankCaption')));

  // ── 12. 貯金箱イラストのポップアップ ──
  await page.click('.nav-item[data-tab="home"]');
  await page.waitForTimeout(200);
  check('タップ前は脈打つ演出とタップ表示', !(await page.$eval('#heroSide', el => el.classList.contains('bank-seen'))));
  await page.click('#bankInfoBtn');
  await page.waitForTimeout(300);
  check('貯金箱の説明シートが開く', !(await page.$eval('#bankInfoSheet', el => el.classList.contains('hidden'))));
  check('説明に「実際の残高ではない」旨がある', /実際の残高/.test(await page.textContent('.bank-info-body')));
  check('説明から相談を促している', /相談/.test(await page.textContent('.bank-info-body')));
  await page.click('#closeBankInfo');
  await page.waitForTimeout(300);
  check('タップ後は脈打つ演出が止まる', await page.$eval('#heroSide', el => el.classList.contains('bank-seen')));

  // ── 13. 戻るボタンでシートが閉じる ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(300);
  check('端末の戻るでシートが閉じる', await page.$eval('#settingsSheet', el => el.classList.contains('hidden')));

  // ── 14. 継続日数の円タップ → 達成タブ ──
  await page.click('#ringWrap');
  await page.waitForTimeout(300);
  check('円タップで達成タブへ', await page.$eval('#badges', el => el.classList.contains('active')));
  check('バッジが9段階', (await page.$$('#badgeGrid .badge')).length === 9);
  check('7日バッジが解除済み', await page.$eval('#badgeGrid .badge:nth-child(3)', el => el.classList.contains('unlocked')));
  check('シェアボタンがある', !!(await page.$('#shareBtn')));

  // ── 15. 未来の日付は弾く ──
  await page.click('.nav-item[data-tab="home"]');
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.fill('#startDate', ymd(Date.now() + 3 * 86400000));
  await page.click('#saveSettings');
  await page.waitForTimeout(400);
  check('未来の開始日は保存を拒否', !(await page.$eval('#settingsSheet', el => el.classList.contains('hidden'))));
  check('理由がトーストで伝わる', /未来の日付/.test(await page.textContent('#toast')));
  await page.fill('#startDate', daysAgo(10));

  // ── 16. 通貨変更の警告 ──
  await page.selectOption('#currency', 'USD');
  await page.waitForTimeout(200);
  check('通貨を変えると入れ直しの警告が出る', !(await page.$eval('#currencyWarn', el => el.hidden)));
  await page.selectOption('#currency', 'JPY');
  await page.waitForTimeout(200);
  check('元に戻すと警告が消える', await page.$eval('#currencyWarn', el => el.hidden));

  // ── 17. 機種変更手順とバックアップ ──
  check('設定に機種変更の手順がある', !!(await page.$('.migrate-details')));
  check('設定から安全策を開ける', !!(await page.$('#openSafetyFromSet')));
  check('設定から相談窓口を開ける', !!(await page.$('#openHelpFromSet')));
  check('姉妹アプリへのリンクが3つある', (await page.$$('.link-btn')).length === 3);

  // 設定からの導線。以前は設定を閉じる「戻る」が遅れて届き、開いた直後の
  // シートまで閉じられてホームに戻ってしまっていた
  await page.click('#openSafetyFromSet');
  await page.waitForTimeout(600);
  check('設定から安全策シートへ移れる（ホームに戻らない）',
    !(await page.$eval('#safetySheet', el => el.classList.contains('hidden'))));
  check('移ったあと設定シートは閉じている',
    await page.$eval('#settingsSheet', el => el.classList.contains('hidden')));
  await page.goBack();
  await page.waitForTimeout(400);
  check('安全策シートは端末の戻るで閉じる',
    await page.$eval('#safetySheet', el => el.classList.contains('hidden')));

  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#openHelpFromSet');
  await page.waitForTimeout(600);
  check('設定から相談窓口シートへ移れる（ホームに戻らない）',
    !(await page.$eval('#helpSheet', el => el.classList.contains('hidden'))));
  await page.click('#closeHelp');
  await page.waitForTimeout(400);

  // 衝動タイマーの上から窓口を開いて閉じても、タイマーは開いたまま
  await page.click('#urgeFab');
  await page.waitForTimeout(400);
  await page.click('#urgeHelpLink');
  await page.waitForTimeout(500);
  check('衝動タイマーの上から窓口を開ける',
    !(await page.$eval('#helpSheet', el => el.classList.contains('hidden'))));
  await page.click('#closeHelp');
  await page.waitForTimeout(500);
  check('窓口を閉じても衝動タイマーは開いたまま',
    !(await page.$eval('#urgeOverlay', el => el.classList.contains('hidden'))));
  await page.click('#urgeClose');
  await page.waitForTimeout(300);

  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#closeSettings');
  await page.waitForTimeout(300);

  // ── 18. 桁の多い金額でも横に崩れない ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.fill('#spendPerWeek', '99999999');
  await page.click('#saveSettings');
  await page.waitForTimeout(600);
  check('桁の多い金額でも横スクロールしない',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.fill('#spendPerWeek', '14000');
  await page.click('#saveSettings');
  await page.waitForTimeout(500);

  // ── 19. 「今日のメッセージ」の内容 ──
  const advice = await page.textContent('#adviceBody');
  check('メッセージに十分な分量がある', advice.length > 120);
  check('AI表記を使っていない', !/AI/.test(advice));
  check('断定的な効能表現を避けている', !/必ず治り|確実に治/.test(advice));
  check('注意書きがある', /診断や治療を行うものではありません/.test(await page.textContent('.advice-note')));
  check('メッセージが0日目の文面のまま固定されない', !/今日から始まります/.test(advice));
  await page.click('#adviceRefresh');
  await page.waitForTimeout(400);
  check('切り替えで別のメッセージになる', (await page.textContent('#adviceBody')) !== advice);

  // ── 20. リロードしても記録が残る ──
  await page.reload();
  await page.waitForTimeout(900);
  await dismissNudge(page);
  check('リロード後も継続10日', (await page.textContent('#daysCount')) === '10');
  check('リロード後も安全策2/8', (await page.textContent('#safetyCount')) === '2 / 8');

  check('ページエラーなし', errors.length === 0);
  if (errors.length) console.log('  errors:', errors.slice(0, 5));

  // ── 21. 衝動タイマーを最後まで使う（時計を早送り） ──
  const pT = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const tErrors = [];
  pT.on('pageerror', e => tErrors.push(e.message));
  await pT.clock.install({ time: new Date('2025-06-10T12:00:00') });
  await pT.goto(URL);
  /* 時計を固定しているので、開始日もその時計に合わせる（未来日は弾かれるため） */
  await onboard(pT, { start: '2025-06-01' });
  await pT.click('#urgeBtn');
  await pT.waitForTimeout(300);
  await pT.click('#urgeMinSeg .seg-btn[data-min="3"]');
  await pT.click('#urgeStart');
  await pT.clock.runFor(5000);
  check('タイマー開始で秒数が減る', (await pT.textContent('#breathCount')) === '2:55');
  check('気をそらす行動が表示される', ((await pT.textContent('#urgeTip')) || '').length > 5);
  await pT.clock.runFor(180000);
  check('時間が来ると結果を聞かれる', !(await pT.$eval('#urgeAsk', el => el.hidden)));
  await pT.click('#urgeWon');
  await pT.waitForTimeout(500);
  check('乗り切った回数がチップに出る', /乗り切った/.test(await pT.textContent('#chipUrge')));
  await pT.click('.nav-item[data-tab="stats"]');
  await pT.waitForTimeout(300);
  check('統計に乗り切った回数が出る', /1回/.test(await pT.textContent('#urgeWinBody')));
  check('衝動タイマーでエラーなし', tErrors.length === 0);
  if (tErrors.length) console.log('  errors:', tErrors.slice(0, 5));

  // ── 22. 日付をまたいでも継続日数が止まらない ──
  const pD = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  await pD.clock.install({ time: new Date('2025-06-10T23:50:00') });
  await pD.goto(URL);
  await onboard(pD, { start: '2025-06-01' });
  await pD.waitForTimeout(700);
  check('日付またぎ前: 継続9日', (await pD.textContent('#daysCount')) === '9');
  await pD.clock.runFor(20 * 60 * 1000); // 00:10 へ
  await pD.waitForTimeout(400);
  check('日付またぎ後: 継続10日に増える', (await pD.textContent('#daysCount')) === '10');
  await pD.close();

  // ── 23. 英語ロケールの新規ユーザー ──
  const pE = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const eErrors = [];
  pE.on('pageerror', e => eErrors.push(e.message));
  await pE.goto(URL);
  await pE.waitForTimeout(400);
  check('英語ロケール: 英語で表示', /Welcome/.test(await pE.textContent('#onboarding')));
  await pE.fill('#obStartDate', daysAgo(10));
  await pE.click('#obNext1');
  await pE.fill('#obSpend', '140');
  await pE.fill('#obHours', '7');
  await pE.click('#obNext2');
  await pE.click('#obNext3');
  await pE.click('#obFinish');
  await pE.waitForTimeout(900);
  check('英語ロケール: USD表示', (await pE.textContent('#moneySaved')) === '$200');
  check('英語ロケール: タイトルが英語', /Gamble-Free/.test(await pE.title()));
  check('英語ロケール: 英語マニフェスト', /manifest-en\.json/.test(await pE.getAttribute('#manifestLink', 'href')));
  check('英語ロケール: 相談窓口も英語', /Where to get help/.test(await pE.textContent('.help-card')));
  const enAdvice = await pE.textContent('#adviceBody');
  check('英語ロケール: メッセージも英語', enAdvice.length > 100 && !/です|ます/.test(enAdvice));
  check('英語ロケール: エラーなし', eErrors.length === 0);
  if (eErrors.length) console.log('  errors:', eErrors.slice(0, 5));
  await pE.close();

  // ── 24. 言語切替（日本語 → English） ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#langSeg .seg-btn[data-lang="en"]');
  await page.waitForTimeout(400);
  check('言語切替: 設定が英語になる', /Settings/.test(await page.textContent('#settingsSheet h2')));
  await page.click('#closeSettings');
  await page.waitForTimeout(300);
  check('言語切替: 統計の見出しが英語になる', /Money not spent/.test(await page.textContent('.stat-grid')));
  check('言語切替: 自分で選んだ通貨は勝手に変わらない', /¥/.test(await page.textContent('#moneySaved')));
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#langSeg .seg-btn[data-lang="ja"]');
  await page.waitForTimeout(400);
  await page.click('#closeSettings');
  await page.waitForTimeout(300);
  check('言語切替: 日本語に戻せる', /¥/.test(await page.textContent('#moneySaved')));

  // ── 25. すべての記録を削除 → 最初の状態に戻る ──
  page.on('dialog', d => d.accept());
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#resetAll');
  await page.waitForTimeout(600);
  check('全削除でオンボーディングに戻る', !(await page.$eval('#onboarding', el => el.classList.contains('hidden'))));
  check('全削除で安全策もリセット', await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('dangamble_v1')).safety || []).length === 0));

  await browser.close();
  console.log('');
  if (failures.length) {
    console.log(`❌ ${failures.length} 件失敗:`);
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('✅ すべて成功');
})().catch(e => { console.error(e); process.exit(1); });
