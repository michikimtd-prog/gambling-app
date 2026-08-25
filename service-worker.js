// キャッシュに名前をつける。ファイルの中身を変更してアップデートしたら
// この名前(バージョン番号)を変えることで、古いキャッシュを破棄して新しいものに入れ替える
const CACHE_NAME = "gambling-app-v22";

// オフラインでも開けるようにキャッシュしておくファイル一覧
const FILES_TO_CACHE = [
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/registration.js",
  "./js/session.js",
  "./js/race.js",
  "./js/analysis.js",
];

// ① インストール時: 上のファイル一覧をまとめてキャッシュに保存する
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  // 新しいService Workerをすぐに有効化する(通常は前のタブが閉じるまで待機するが、
  // 個人利用アプリなので即反映で問題ない)
  self.skipWaiting();
});

// ② 有効化時: 古いバージョンのキャッシュが残っていたら削除する
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ③ 通信のたびに呼ばれる: キャッシュにあればそれを返し(オフライン対応)、
//    なければ通常通りネットワークから取得する
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
