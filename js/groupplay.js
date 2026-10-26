/*
  このファイルの構成
  ------------------------------------------------------------
  1. 画面を開く(店舗選択肢の準備・増減の初期化)
  2. 増やす/減らすの切り替え
  3. 保存・キャンセル

  ノリ打ちは「個人の収支を確定させたあとに、精算分を足したり引いたりして調整する」
  ものとして扱う。投資と回収の2つに分けず、増減の金額(プラスもマイナスも)を
  1つだけ記録する。保存する値(adjustment)は、増やすならプラス、減らすならマイナスの数。
*/

let groupPlaySign = 1; // 1=増やす(受け取る)、-1=減らす(支払う)

function setGroupPlaySign(sign) {
  groupPlaySign = sign;
  document.getElementById("groupPlayPlusBtn").classList.toggle("active", sign === 1);
  document.getElementById("groupPlayMinusBtn").classList.toggle("active", sign === -1);
}

document.getElementById("groupPlayPlusBtn").addEventListener("click", () => setGroupPlaySign(1));
document.getElementById("groupPlayMinusBtn").addEventListener("click", () => setGroupPlaySign(-1));

async function openGroupPlayScreen() {
  // 店舗は必須にしていないので、一覧の先頭に「指定なし」を残したまま追加する
  const stores = sortFavoritesFirst(await dbGetAll(STORES_TABLE));
  const storeSelectEl = document.getElementById("groupPlayStoreSelect");
  storeSelectEl.innerHTML = `<option value="">指定なし</option>`;
  stores.forEach((store) => {
    const label = store.isFavorite ? `★ ${store.name}` : store.name;
    storeSelectEl.innerHTML += `<option value="${store.id}">${label}</option>`;
  });

  setGroupPlaySign(1);
  document.getElementById("groupPlayAmountInput").value = 0;
  document.getElementById("groupPlayMemoInput").value = "";

  showSessionScreen("screen-groupplay");
}

document.getElementById("cancelGroupPlayBtn").addEventListener("click", () => {
  showSessionScreen("screen-calendar");
});

document.getElementById("saveGroupPlayBtn").addEventListener("click", async () => {
  const amount = nonNeg(document.getElementById("groupPlayAmountInput").value);
  if (amount === 0) {
    alert("調整する金額を入力してください");
    return;
  }

  const storeSelectEl = document.getElementById("groupPlayStoreSelect");
  const storeId = storeSelectEl.value ? Number(storeSelectEl.value) : null;
  const storeName = storeId ? storeSelectEl.selectedOptions[0].textContent.replace(/^★ /, "") : null;

  const dateStr = formatDate(new Date());

  await dbAdd(GROUP_PLAY_TABLE, {
    date: dateStr,
    adjustment: groupPlaySign * amount, // 減らす場合はマイナスの値で保存する
    storeId: storeId,
    storeName: storeName,
    memo: document.getElementById("groupPlayMemoInput").value,
    createdAt: new Date().toISOString(),
  });

  selectedDate = dateStr;
  await returnToCalendar();
});
