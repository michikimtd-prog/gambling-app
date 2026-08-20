/*
  このファイルの構成
  ------------------------------------------------------------
  1. 登録情報タブ内のサブタブ切り替え
  2. 店舗: 一覧描画・追加・削除・レート管理モーダル
  3. 機種: 一覧描画・追加・削除
  4. 場: カテゴリ切り替え・一覧描画・追加・削除
  5. 会員カード残高一覧(読み取り専用)
  6. 起動時にまとめて描画
*/

// ------------------------------------------------------------
// 1. サブタブ切り替え(前回作ったタブ切り替えと同じ考え方)
// ------------------------------------------------------------
document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.subtab;

    document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(`subtab-${target}`).classList.add("active");
  });
});

// ------------------------------------------------------------
// 2. 店舗
// ------------------------------------------------------------

/** 店舗一覧を再取得して画面に描画し直す。追加・削除のたびに呼ぶ。 */
async function renderStores() {
  const stores = await dbGetAll(STORES_TABLE);
  const listEl = document.getElementById("storeList");

  // 中身を一旦空にしてから、取得したデータの数だけ<li>を作り直す。
  // 「差分だけ書き換える」より単純で分かりやすいので、まずはこの書き方で統一する。
  listEl.innerHTML = "";

  stores.forEach((store) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${store.name}</span>
        <span class="reg-item-sub">${store.hasMemberCard ? "会員カードあり" : "会員カードなし"}</span>
      </div>
      <div class="reg-item-actions">
        <button class="rate-btn" data-id="${store.id}">レート管理</button>
        <button class="delete-btn" data-id="${store.id}">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    // 「レート管理」ボタン: このliの中だけで完結する処理なので、
    // 描画のタイミングでイベントを直接つけてしまう
    li.querySelector(".rate-btn").addEventListener("click", () => openRateModal(store));

    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm(`「${store.name}」を削除しますか?紐づくレートも扱えなくなります。`)) return;
      await dbDelete(STORES_TABLE, store.id);
      renderStores();
      renderCards(); // 会員カード一覧にも影響するので合わせて再描画
    });
  });
}

document.getElementById("storeForm").addEventListener("submit", async (event) => {
  // フォームのデフォルト動作(ページ全体がリロードされる)を止める。
  // これを忘れるとJSでの処理が実行される前にページが再読み込みされてしまう。
  event.preventDefault();

  const nameInput = document.getElementById("storeNameInput");
  const hasCardInput = document.getElementById("storeHasCardInput");

  await dbAdd(STORES_TABLE, {
    name: nameInput.value,
    hasMemberCard: hasCardInput.checked,
  });

  // 入力欄をクリアしてから一覧を再描画
  nameInput.value = "";
  hasCardInput.checked = false;
  renderStores();
});

// --- レート管理モーダル ---

const rateModal = document.getElementById("rateModal");
let currentStoreForRateModal = null; // 今モーダルで開いている店舗を覚えておく

async function openRateModal(store) {
  currentStoreForRateModal = store;
  document.getElementById("rateModalStoreName").textContent = `${store.name} のレート`;
  rateModal.classList.remove("hidden");
  await renderRatesForCurrentStore();
}

document.getElementById("rateModalClose").addEventListener("click", () => {
  rateModal.classList.add("hidden");
  currentStoreForRateModal = null;
});

async function renderRatesForCurrentStore() {
  if (!currentStoreForRateModal) return;

  // インデックスを使って、この店舗のレートだけを取得する
  const rates = await dbGetByIndex(RATES_TABLE, "by_storeId", currentStoreForRateModal.id);
  const listEl = document.getElementById("rateList");
  listEl.innerHTML = "";

  rates.forEach((rate) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${rate.rateLabel}</span>
        <span class="reg-item-sub">
          1000円で${rate.lendPerThousand}個貸出 / ${rate.exchangeYenUnit}円につき${rate.exchangeUnitsRequired}個で換金
          ${currentStoreForRateModal.hasMemberCard ? ` / カード残高: ${rate.cardBalance}個` : ""}
        </span>
      </div>
      <div class="reg-item-actions">
        <button class="delete-btn" data-id="${rate.id}">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm("このレートを削除しますか?")) return;
      await dbDelete(RATES_TABLE, rate.id);
      renderRatesForCurrentStore();
      renderCards();
    });
  });
}

document.getElementById("rateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentStoreForRateModal) return;

  const categoryInput = document.getElementById("rateCategoryInput");
  const numberInput = document.getElementById("rateNumberInput");
  const lendInput = document.getElementById("rateLendInput");
  const yenInput = document.getElementById("rateExchangeYenInput");
  const unitsInput = document.getElementById("rateExchangeUnitsInput");

  // レート名は「数字+パチ/スロ」の形で統一する。手入力の表記ゆれ(4パチ/4パチンコ など)を防ぎ、
  // 後で店舗をまたいで「同じレート名でまとめる」分析がしやすくなる
  const suffix = categoryInput.value === "パチンコ" ? "パチ" : "スロ";
  const rateLabel = `${numberInput.value}${suffix}`;

  await dbAdd(RATES_TABLE, {
    storeId: currentStoreForRateModal.id,
    category: categoryInput.value,
    rateLabel: rateLabel,
    // input type="number" の値は文字列で渡ってくるので、計算に使えるようNumber()で数値に変換する
    lendPerThousand: Number(lendInput.value),
    exchangeYenUnit: Number(yenInput.value),
    exchangeUnitsRequired: Number(unitsInput.value),
    cardBalance: 0, // 新規登録時点では残高0からスタート
  });

  numberInput.value = "";
  lendInput.value = "";
  yenInput.value = "";
  unitsInput.value = "";

  renderRatesForCurrentStore();
  renderCards();
});

// ------------------------------------------------------------
// 3. 機種
// ------------------------------------------------------------

// 今どちらのカテゴリを表示中かを覚えておく変数(場のcurrentVenueCategoryと同じ考え方)
let currentModelCategory = "パチンコ";

document.querySelectorAll(".model-category-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".model-category-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentModelCategory = btn.dataset.category;
    renderModels();
  });
});

async function renderModels() {
  // インデックスを使って、今選ばれているカテゴリの機種だけを取得する
  const models = await dbGetByIndex(MODELS_TABLE, "by_category", currentModelCategory);
  const listEl = document.getElementById("modelList");
  listEl.innerHTML = "";

  models.forEach((model) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${model.name}</span>
      </div>
      <div class="reg-item-actions">
        <button class="delete-btn" data-id="${model.id}">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm(`「${model.name}」を削除しますか?`)) return;
      await dbDelete(MODELS_TABLE, model.id);
      renderModels();
    });
  });
}

document.getElementById("modelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nameInput = document.getElementById("modelNameInput");

  await dbAdd(MODELS_TABLE, { name: nameInput.value, category: currentModelCategory });

  nameInput.value = "";
  renderModels();
});

// ------------------------------------------------------------
// 4. 場(競馬場・ボート場)
// ------------------------------------------------------------

// 今どちらのカテゴリを表示中かを覚えておく変数
let currentVenueCategory = "競馬";

document.querySelectorAll(".venue-category-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".venue-category-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentVenueCategory = btn.dataset.category;
    renderVenues();
  });
});

async function renderVenues() {
  // すべて取得してから、今選ばれているカテゴリだけに絞り込む。
  // (件数が少ない前提のアプリなので、インデックス検索でなくても問題ない範囲)
  const allVenues = await dbGetAll(VENUES_TABLE);
  const venues = allVenues.filter((v) => v.category === currentVenueCategory);

  const listEl = document.getElementById("venueList");
  listEl.innerHTML = "";

  venues.forEach((venue) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${venue.name}</span>
      </div>
      <div class="reg-item-actions">
        <button class="delete-btn" data-id="${venue.id}">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm(`「${venue.name}」を削除しますか?`)) return;
      await dbDelete(VENUES_TABLE, venue.id);
      renderVenues();
    });
  });
}

document.getElementById("venueForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nameInput = document.getElementById("venueNameInput");

  await dbAdd(VENUES_TABLE, {
    category: currentVenueCategory,
    name: nameInput.value,
  });

  nameInput.value = "";
  renderVenues();
});

// ------------------------------------------------------------
// 5. 会員カード残高一覧(読み取り専用)
// ------------------------------------------------------------

async function renderCards() {
  const stores = await dbGetAll(STORES_TABLE);
  const allRates = await dbGetAll(RATES_TABLE);
  const listEl = document.getElementById("cardList");
  listEl.innerHTML = "";

  // 会員カードがある店舗だけに絞り込む
  const cardStores = stores.filter((s) => s.hasMemberCard);

  cardStores.forEach((store) => {
    // このstoreに紐づくレートだけを、全レートの中から探す。
    // dbGetByIndexを使ってもよいが、店舗数が多くない前提なのでここではfilterで十分。
    const ratesForStore = allRates.filter((r) => r.storeId === store.id);

    ratesForStore.forEach((rate) => {
      const li = document.createElement("li");
      li.className = "reg-item";
      li.innerHTML = `
        <div class="reg-item-main">
          <span class="reg-item-name">${store.name} / ${rate.rateLabel}</span>
          <span class="reg-item-sub">残高: ${rate.cardBalance}個</span>
        </div>
      `;
      listEl.appendChild(li);
    });
  });

  if (listEl.children.length === 0) {
    listEl.innerHTML = `<p class="placeholder">会員カードが登録された店舗・レートはまだありません。</p>`;
  }
}

// ------------------------------------------------------------
// 6. 起動時にまとめて描画
// ------------------------------------------------------------
renderStores();
renderModels();
renderVenues();
renderCards();
