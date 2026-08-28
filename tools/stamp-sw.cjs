/* sw.js のキャッシュ名を、配信ファイルの内容ハッシュから自動生成する。
   実行: node tools/stamp-sw.cjs        → sw.js を書き換え
        node tools/stamp-sw.cjs --check → 書き換えが必要なら終了コード1（CI用）
   これにより「ファイルを変えたのにキャッシュ番号を上げ忘れて、
   ユーザーに古いバージョンが配られ続ける」事故を防ぐ。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const swPath = path.join(root, 'sw.js');

/* ハッシュ対象: sw.js 自身を除く配信ファイルすべて */
const FILES = [
  'index.html', 'styles.css', 'i18n.js', 'util.js', 'app.js', 'advisor.js',
  'manifest.json', 'manifest-en.json',
  'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png',
];

const h = crypto.createHash('sha256');
for (const f of FILES) h.update(fs.readFileSync(path.join(root, f)));
/* sw.js 自身のロジック変更でも更新が届くよう、キャッシュ名の行以外を含める */
const swSrc = fs.readFileSync(swPath, 'utf8');
h.update(swSrc.replace(/const CACHE = '[^']*';/, ''));

const stamp = 'dangamble-' + h.digest('hex').slice(0, 10);
const next = swSrc.replace(/const CACHE = '[^']*';/, `const CACHE = '${stamp}';`);

if (process.argv.includes('--check')) {
  if (next !== swSrc) {
    console.error(`NG: sw.js のキャッシュ名が古いままです。 node tools/stamp-sw.cjs を実行してコミットしてください（期待値: ${stamp}）`);
    process.exit(1);
  }
  console.log('ok: sw.js cache stamp is up to date:', stamp);
} else {
  if (next !== swSrc) {
    fs.writeFileSync(swPath, next);
    console.log('stamped:', stamp);
  } else {
    console.log('unchanged:', stamp);
  }
}
