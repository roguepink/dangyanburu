/* ギャンブル断ちトラッカー Service Worker
   - ページ(HTML)はネットワーク優先: 更新が確実にユーザーに届く
   - アセットはキャッシュ優先＋裏で更新(stale-while-revalidate) */
const CACHE = 'dangamble-1d3a1b9f95';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './i18n.js',
  './util.js',
  './app.js',
  './advisor.js',
  './manifest.json',
  './manifest-en.json',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  /* addAll()は各ファイルのHTTPキャッシュを再利用しうるため、
     cache:'reload'で1件ずつネットワークから確実に最新を取得する */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(res => c.put(url, res)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

/* ═══════════ アプリを閉じていても届くリマインダー（対応端末のみ） ═══════════
   Androidのホーム画面追加済みPWAでは、ブラウザが半日〜1日おきにSWを起こす
   （Periodic Background Sync）。設定はアプリ側がIndexedDBに写してある。 */
function readReminderCfg() {
  return new Promise(resolve => {
    try {
      const rq = indexedDB.open('dangamble-sw', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          const get = db.transaction('kv').objectStore('kv').get('reminder');
          get.onsuccess = () => { resolve(get.result || null); db.close(); };
          get.onerror = () => { resolve(null); db.close(); };
        } catch (e) { resolve(null); db.close(); }
      };
      rq.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function writeReminded(cfg, day) {
  return new Promise(resolve => {
    try {
      const rq = indexedDB.open('dangamble-sw', 1);
      rq.onsuccess = () => {
        const db = rq.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ ...cfg, lastReminded: day }, 'reminder');
        tx.oncomplete = () => { resolve(); db.close(); };
        tx.onerror = () => { resolve(); db.close(); };
      };
      rq.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkReminder() {
  const cfg = await readReminderCfg();
  if (!cfg || !cfg.on) return;
  const today = localToday();
  if (cfg.loggedDate === today || cfg.lastReminded === today) return;
  const [h, m] = (cfg.time || '21:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;   // まだ時刻前
  await writeReminded(cfg, today);
  await self.registration.showNotification(cfg.title || 'Sober Tracker', {
    body: cfg.body || '',
    tag: 'dangamble-daily',
    icon: './icon-192.png',
    badge: './icon-192.png',
  });
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'dangamble-reminder') e.waitUntil(checkReminder());
});

/* 通知をタップしたらアプリを開く（既に開いていればそこへ移動） */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
