/*
  このファイルの構成
  ------------------------------------------------------------
  1. 投票形式・購入形式の選択肢(カテゴリごとに変わる)
  2. 状態を覚えておく変数
  3. 画面: 記録する項目を選ぶ(パチンコ・スロット/競馬/ボートレース)
  4. 画面: 競馬・ボートレース入力(場を選び、賭けを複数追加。新規作成/編集の両対応)
  5. 賭け追加モーダル
  6. 保存(新規作成/編集で分岐)・削除

  設計のポイント:
  パチンコ・スロットのセッションと違い、競馬・ボートレースは
  「リアルタイムに状態が変化する」ものではなく、後からまとめて
  結果を記録するだけなので、進行中(in_progress)のような状態管理は不要。
  賭けはこの画面を離れるまではメモリ上の配列(raceBets)だけで持っておき、
  「保存」ボタンを押した瞬間に初めてDBへまとめて書き込む。
  編集時も同じ画面を再利用し、保存済みの賭けを一旦raceBetsに読み込んでから
  同じ「保存」の仕組みに乗せている(ただしDB上は古い賭けを削除してから作り直す)。
*/

// ------------------------------------------------------------
// 1. 投票形式・購入形式の選択肢
// ------------------------------------------------------------
const VOTING_TYPES = {
  "競馬": ["単勝", "複勝", "枠連", "馬連", "馬単", "ワイド", "3連複", "3連単"],
  "ボートレース": ["単勝", "複勝", "2連単", "2連複", "3連複", "3連単", "拡連複"],
};

// 購入形式はカテゴリによって「馬券」か「舟券」かが変わる
function getPurchaseMethods(category) {
  return ["ネット", category === "競馬" ? "馬券" : "舟券"];
}

// ------------------------------------------------------------
// 2. 状態を覚えておく変数
// ------------------------------------------------------------
let raceCategory = null; // "競馬" か "ボートレース"
let raceBets = []; // まだDBに保存していない、この画面で追加した賭けの一覧
let editingRaceId = null; // 既存のレースを編集中の場合、そのidを入れておく(新規作成時はnull)

// ------------------------------------------------------------
// 3. 画面: 記録する項目を選ぶ
// ------------------------------------------------------------

document.querySelectorAll(".category-choice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const choice = btn.dataset.categoryChoice;

    if (choice === "pachinko") {
      // パチンコ・スロットは既存の開始前画面(session.js側)を使う
      resetStartForm();
      showSessionScreen("screen-start");
    } else {
      openRaceScreen(choice);
    }
  });
});

document.getElementById("cancelCategorySelectBtn").addEventListener("click", () => {
  showSessionScreen("screen-calendar");
});

// ------------------------------------------------------------
// 4. 画面: 競馬・ボートレース入力
// ------------------------------------------------------------

async function openRaceScreen(category) {
  raceCategory = category;
  raceBets = [];
  editingRaceId = null;

  document.getElementById("raceScreenTitle").textContent = `${category}入力`;
  document.getElementById("saveRaceBtn").textContent = "保存";

  const venues = await dbGetByIndex(VENUES_TABLE, "by_category", category);
  const venueSelectEl = document.getElementById("raceVenueSelect");
  venueSelectEl.innerHTML = `<option value="">選択してください</option>`;
  venues.forEach((venue) => {
    venueSelectEl.innerHTML += `<option value="${venue.id}">${venue.name}</option>`;
  });

  renderBetList();
  showSessionScreen("screen-race");
}

/** 既存のレース記録を編集するために、今の内容を画面に読み込んで開く。 */
async function openRaceScreenForEdit(race, bets) {
  await openRaceScreen(race.category);

  editingRaceId = race.id;
  document.getElementById("raceScreenTitle").textContent = `${race.category}を修正`;
  document.getElementById("saveRaceBtn").textContent = "修正を保存";
  document.getElementById("raceVenueSelect").value = race.venueId;

  // 保存済みの賭けを、まだ保存していない一覧(raceBets)として画面に読み込む。
  // idやraceIdは保存し直す時に新しく振られるので、ここでは持たせない。
  raceBets = bets.map((b) => ({
    votingType: b.votingType,
    purchaseMethod: b.purchaseMethod,
    investment: b.investment,
    collection: b.collection,
  }));
  renderBetList();
}

document.getElementById("cancelRaceBtn").addEventListener("click", () => {
  // まだDBには何も保存していないので、配列を空にするだけで「キャンセル」になる
  raceBets = [];
  editingRaceId = null;
  showSessionScreen("screen-calendar");
});

/** 追加済みの賭けの一覧と、投資・回収の合計を画面に描画する。 */
function renderBetList() {
  const listEl = document.getElementById("raceBetList");
  listEl.innerHTML = "";

  let totalInvestment = 0;
  let totalCollection = 0;

  raceBets.forEach((bet, index) => {
    totalInvestment += bet.investment;
    totalCollection += bet.collection;

    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${bet.votingType}(${bet.purchaseMethod})</span>
        <span class="reg-item-sub">投資 ¥${bet.investment.toLocaleString()} / 回収 ¥${bet.collection.toLocaleString()}</span>
      </div>
      <div class="reg-item-actions">
        <button class="delete-btn" data-index="${index}">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".delete-btn").addEventListener("click", () => {
      raceBets.splice(index, 1);
      renderBetList();
    });
  });

  const totalRow = document.createElement("div");
  totalRow.className = "bet-total-row";
  const profit = totalCollection - totalInvestment;
  totalRow.innerHTML = `<span>合計 投資¥${totalInvestment.toLocaleString()} / 回収¥${totalCollection.toLocaleString()}</span><span>${profit >= 0 ? "+" : ""}${profit.toLocaleString()}円</span>`;
  listEl.appendChild(totalRow);
}

// ------------------------------------------------------------
// 5. 賭け追加モーダル
// ------------------------------------------------------------

const betModal = document.getElementById("betModal");

document.getElementById("addBetBtn").addEventListener("click", () => {
  if (!document.getElementById("raceVenueSelect").value) {
    alert("先に場を選択してください");
    return;
  }

  // カテゴリに応じて選択肢を作り直す
  const votingTypeEl = document.getElementById("betVotingTypeInput");
  votingTypeEl.innerHTML = VOTING_TYPES[raceCategory]
    .map((type) => `<option value="${type}">${type}</option>`)
    .join("");

  const purchaseMethodEl = document.getElementById("betPurchaseMethodInput");
  purchaseMethodEl.innerHTML = getPurchaseMethods(raceCategory)
    .map((method) => `<option value="${method}">${method}</option>`)
    .join("");

  document.getElementById("betInvestmentInput").value = "";
  document.getElementById("betCollectionInput").value = "";

  betModal.classList.remove("hidden");
});

document.getElementById("betModalClose").addEventListener("click", () => {
  betModal.classList.add("hidden");
});

document.getElementById("betForm").addEventListener("submit", (event) => {
  event.preventDefault();

  raceBets.push({
    votingType: document.getElementById("betVotingTypeInput").value,
    purchaseMethod: document.getElementById("betPurchaseMethodInput").value,
    investment: nonNeg(document.getElementById("betInvestmentInput").value),
    collection: nonNeg(document.getElementById("betCollectionInput").value),
  });

  betModal.classList.add("hidden");
  renderBetList();
});

// ------------------------------------------------------------
// 6. 保存
// ------------------------------------------------------------

document.getElementById("saveRaceBtn").addEventListener("click", async () => {
  const venueSelectEl = document.getElementById("raceVenueSelect");
  const venueId = Number(venueSelectEl.value);

  if (!venueId) {
    alert("場を選択してください");
    return;
  }
  if (raceBets.length === 0) {
    alert("投票形式を1件以上追加してください");
    return;
  }

  const venueName = venueSelectEl.selectedOptions[0].textContent;

  let raceId;
  let dateStr;

  if (editingRaceId) {
    // 編集モード: 元のレースのidと日付は変えず、内容だけ上書きする
    const existingRace = await dbGet(RACES_TABLE, editingRaceId);
    dateStr = existingRace.date;
    existingRace.venueId = venueId;
    existingRace.venueName = venueName;
    await dbUpdate(RACES_TABLE, existingRace);
    raceId = editingRaceId;

    // 古い賭けを全部消してから、今の内容で新しく保存し直す
    // (1件ずつ更新するより、全部消して作り直す方がシンプルで確実)
    const oldBets = await dbGetByIndex(BETS_TABLE, "by_raceId", raceId);
    await Promise.all(oldBets.map((b) => dbDelete(BETS_TABLE, b.id)));
  } else {
    // 新規作成
    dateStr = formatDate(new Date());
    raceId = await dbAdd(RACES_TABLE, {
      date: dateStr,
      category: raceCategory,
      venueId: venueId,
      venueName: venueName,
      createdAt: new Date().toISOString(),
    });
  }

  // Promise.allを使うと、複数の非同期処理(ここではdbAdd)を
  // 「全部終わるまで待つ」ことができる。1件ずつawaitするより効率的。
  await Promise.all(
    raceBets.map((bet) => dbAdd(BETS_TABLE, { ...bet, raceId }))
  );

  raceBets = [];
  editingRaceId = null;
  selectedDate = dateStr;
  await returnToCalendar();
});

/** レース(親)と、それに紐づく賭け(子)を全部削除する。 */
async function deleteRace(raceId) {
  const bets = await dbGetByIndex(BETS_TABLE, "by_raceId", raceId);
  await Promise.all(bets.map((b) => dbDelete(BETS_TABLE, b.id)));
  await dbDelete(RACES_TABLE, raceId);
}
