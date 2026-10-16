/*
  このファイルの構成
  ------------------------------------------------------------
  1. 画面を開く(店舗選択肢の準備)
  2. 保存・キャンセル

  ノリ打ちは、パチンコ・スロットの「開始→当たり→終了」という細かい進行を追わず、
  競馬・ボートレースと同じように「投資額と回収額を直接入力するだけ」のシンプルな
  記録として扱う。機種は選ばず、代わりに店舗(任意)とメモだけを持たせている。
*/

async function openGroupPlayScreen() {
  // 店舗は必須にしていないので、一覧の先頭に「指定なし」を残したまま追加する
  const stores = sortFavoritesFirst(await dbGetAll(STORES_TABLE));
  const storeSelectEl = document.getElementById("groupPlayStoreSelect");
  storeSelectEl.innerHTML = `<option value="">指定なし</option>`;
  stores.forEach((store) => {
    const label = store.isFavorite ? `★ ${store.name}` : store.name;
    storeSelectEl.innerHTML += `<option value="${store.id}">${label}</option>`;
  });

  document.getElementById("groupPlayCategoryInput").value = "パチンコ";
  document.getElementById("groupPlayInvestmentInput").value = 0;
  document.getElementById("groupPlayCollectionInput").value = 0;
  document.getElementById("groupPlayMemoInput").value = "";

  showSessionScreen("screen-groupplay");
}

document.getElementById("cancelGroupPlayBtn").addEventListener("click", () => {
  showSessionScreen("screen-calendar");
});

document.getElementById("saveGroupPlayBtn").addEventListener("click", async () => {
  const storeSelectEl = document.getElementById("groupPlayStoreSelect");
  const storeId = storeSelectEl.value ? Number(storeSelectEl.value) : null;
  const storeName = storeId ? storeSelectEl.selectedOptions[0].textContent.replace(/^★ /, "") : null;

  const dateStr = formatDate(new Date());

  await dbAdd(GROUP_PLAY_TABLE, {
    date: dateStr,
    category: document.getElementById("groupPlayCategoryInput").value,
    storeId: storeId,
    storeName: storeName,
    investmentAmount: nonNeg(document.getElementById("groupPlayInvestmentInput").value),
    collectedYen: nonNeg(document.getElementById("groupPlayCollectionInput").value),
    memo: document.getElementById("groupPlayMemoInput").value,
    createdAt: new Date().toISOString(),
  });

  selectedDate = dateStr;
  await returnToCalendar();
});
