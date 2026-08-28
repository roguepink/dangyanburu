'use strict';

/* ビルド不要のシンプルな構成を保つため、バンドラは導入せず、
   開発時にタイプミスや簡単なミスに気づけるLintだけを追加している。
   本番の公開方法（静的ファイルをそのままGitHub Pagesへ）は変えない。 */

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  indexedDB: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Notification: 'readonly',
  Touch: 'readonly',
  TouchEvent: 'readonly',
  Event: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  matchMedia: 'readonly',
  performance: 'readonly',
  requestAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  location: 'readonly',
  history: 'readonly',
  confirm: 'readonly',
  caches: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**'] },

  /* アプリ本体（ブラウザで動く素のJS。他ファイルが window.X で公開する
     ものは "writable" として扱い、参照側で未定義扱いにならないようにする） */
  {
    files: ['*.js'],
    ignores: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...BROWSER_GLOBALS,
        Util: 'writable',
        I18N: 'writable',
        Tarot: 'writable',
        TarotIcons: 'writable',
        Advisor: 'writable',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
    },
  },

  /* Service Worker（専用のグローバルを持つ別の実行コンテキスト） */
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { self: 'readonly', caches: 'readonly', indexedDB: 'readonly', fetch: 'readonly', clients: 'readonly', console: 'readonly' },
    },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-undef': 'error' },
  },

  /* ビルド用ツール（Node.jsのCommonJSスクリプト） */
  {
    files: ['tools/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: NODE_GLOBALS },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-undef': 'error' },
  },

  /* E2Eテスト（Node.js側とpage.evaluate()内のブラウザ側コードが混在する
     ため、no-undefは厳密にチェックしきれず無効化している。実際の不具合は
     テスト実行自体が失敗することで検出される） */
  {
    files: ['tests/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-undef': 'off' },
  },
];
