/*
  IndexedDBとは
  ------------------------------------------------------------
  ブラウザの中にある小さなデータベース。SQLiteに近いイメージだが、
  「非同期(asynchronous)」という仕組みで動く点がPythonと大きく違う。

  非同期とは何か:
  Pythonで `data = db.execute("SELECT ...")` と書けば、その行で処理が
  止まって結果が返ってくるまで待つ(同期的)。
  一方JavaScriptのIndexedDBは「結果は後で届くので、届いたらこの処理を
  実行してね」という予約だけして、その場では待たない(非同期的)。
  なので db.js のコードは "onsuccess = () => { ここで結果を使う }"
  という形がたくさん出てくる。
*/

const DB_NAME = "gambling-app-db";

// 前回はテスト用のtestStoreだけ(バージョン1)だったが、
// 今回オブジェクトストアの構成そのものを変更するのでバージョンを上げる。
// IndexedDBは「バージョン番号が前回より上がった時だけ」onupgradeneededを呼ぶ仕組み。
const DB_VERSION = 5;

// オブジェクトストア(≒テーブル)の名前を定数にまとめておく。
// 文字列を直接あちこちに書くとタイプミスに気づきにくいため。
const STORES_TABLE = "stores"; // 店舗マスタ
const RATES_TABLE = "rates"; // レート・換金率・会員カード残高
const MODELS_TABLE = "models"; // 機種マスタ
const VENUES_TABLE = "venues"; // 競馬場・ボート場マスタ
const PACHINKO_SESSIONS_TABLE = "pachinkoSessions"; // パチンコ・スロットのセッション記録
const RACES_TABLE = "races"; // 競馬・ボートレースのレース記録(親)
const BETS_TABLE = "bets"; // レースごとの投票形式別の賭け記録(子)

let dbInstance = null;

/**
 * データベースを開く(なければ作成する / バージョンが上がっていれば更新する)。
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // オブジェクトストア(テーブル)の追加・変更はここでしか行えない。
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 前回の動作確認用ストアはもう使わないので削除する
      if (db.objectStoreNames.contains("testStore")) {
        db.deleteObjectStore("testStore");
      }

      if (!db.objectStoreNames.contains(STORES_TABLE)) {
        db.createObjectStore(STORES_TABLE, { keyPath: "id", autoIncrement: true });
      }

      if (!db.objectStoreNames.contains(RATES_TABLE)) {
        const ratesStore = db.createObjectStore(RATES_TABLE, { keyPath: "id", autoIncrement: true });
        // インデックスを作ると「storeIdが3のレートだけ集める」のような検索が高速にできる。
        // インデックスがないと全件を1つずつ調べることになる。
        ratesStore.createIndex("by_storeId", "storeId", { unique: false });
      }

      if (!db.objectStoreNames.contains(MODELS_TABLE)) {
        // 新規インストールの場合はここでカテゴリのインデックスも一緒に作る
        const modelsStore = db.createObjectStore(MODELS_TABLE, { keyPath: "id", autoIncrement: true });
        modelsStore.createIndex("by_category", "category", { unique: false });
      } else {
        // 既存のテーブルにカテゴリが無いバージョンから上がってきた場合は、ここでインデックスを追加し、
        // 既存データにも仮のカテゴリ("パチンコ")を補完しておく。実際はスロットだった機種があれば、
        // 登録情報タブで一度削除し、カテゴリを選び直して登録し直してもらう必要がある。
        const modelsStore = event.target.transaction.objectStore(MODELS_TABLE);
        if (!modelsStore.indexNames.contains("by_category")) {
          modelsStore.createIndex("by_category", "category", { unique: false });
          modelsStore.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (!cursor.value.category) {
              cursor.update({ ...cursor.value, category: "パチンコ" });
            }
            cursor.continue();
          };
        }
      }

      if (!db.objectStoreNames.contains(VENUES_TABLE)) {
        const venuesStore = db.createObjectStore(VENUES_TABLE, { keyPath: "id", autoIncrement: true });
        venuesStore.createIndex("by_category", "category", { unique: false });
      }

      if (!db.objectStoreNames.contains(PACHINKO_SESSIONS_TABLE)) {
        const sessionsStore = db.createObjectStore(PACHINKO_SESSIONS_TABLE, { keyPath: "id", autoIncrement: true });
        // 収支分析画面で「2026-08」のような月単位の絞り込みをするために使う
        sessionsStore.createIndex("by_date", "date", { unique: false });
        // アプリを開いた時に「進行中のセッションがあるか」をすぐ調べるために使う
        sessionsStore.createIndex("by_status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains(RACES_TABLE)) {
        const racesStore = db.createObjectStore(RACES_TABLE, { keyPath: "id", autoIncrement: true });
        racesStore.createIndex("by_date", "date", { unique: false });
      }

      if (!db.objectStoreNames.contains(BETS_TABLE)) {
        const betsStore = db.createObjectStore(BETS_TABLE, { keyPath: "id", autoIncrement: true });
        // 「このレースに紐づく賭けだけを集める」ために使う(店舗とレートの関係と同じ考え方)
        betsStore.createIndex("by_raceId", "raceId", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/* ------------------------------------------------------------
   ここから下は「どのテーブルでも共通で使える」汎用関数。
   同じような処理(1件追加する、全件取得する…)を毎回書くと長くなるので、
   テーブル名を引数として受け取る形にして1箇所にまとめている。
------------------------------------------------------------ */

/** 指定したテーブルに1件追加する。追加したデータのidを返す。 */
function dbAdd(tableName, data) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readwrite");
      const request = tx.objectStore(tableName).add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/** 指定したテーブルから、指定したidの1件だけを取得する。 */
function dbGet(tableName, id) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readonly");
      const request = tx.objectStore(tableName).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/** 指定したテーブルの中身を全件取得する。 */
function dbGetAll(tableName) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readonly");
      const request = tx.objectStore(tableName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/** 指定したテーブルの、あるインデックス値に一致するものだけを取得する。
 *  例: dbGetByIndex("rates", "by_storeId", 3) → storeIdが3のレートだけ */
function dbGetByIndex(tableName, indexName, value) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readonly");
      const index = tx.objectStore(tableName).index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/** 指定したテーブルの1件を、id指定で丸ごと上書き保存する(更新用)。 */
function dbUpdate(tableName, data) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readwrite");
      // put()はaddと違い、同じidが既にあれば上書き、なければ新規追加になる
      const request = tx.objectStore(tableName).put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/** 指定したテーブルから、指定したidの1件を削除する。 */
function dbDelete(tableName, id) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(tableName, "readwrite");
      const request = tx.objectStore(tableName).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}
