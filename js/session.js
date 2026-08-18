/*
  このファイルの構成
  ------------------------------------------------------------
  1. 画面切り替えの共通処理
  2. 状態(今どのセッションを操作中か)を覚えておく変数
  2.5 カレンダー画面(ホーム画面): 日別収支の一覧・詳細表示
  3. 画面②: 開始前(店舗・レート選択、開始)
  4. 画面③: 進行中(投資額の増減、当たり/終了への遷移)
  5. 画面④: 当たり記録
  6. 画面⑤: 終了(換金計算、確定→カレンダーへ自動で戻る)
  7. 起動時: 進行中のセッションがあれば自動で再開する
*/

// ------------------------------------------------------------
// 1. 画面切り替えの共通処理
// ------------------------------------------------------------
function showSessionScreen(screenId) {
  document.querySelectorAll(".session-screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

// ------------------------------------------------------------
// 2. 状態を覚えておく変数
// 画面をまたいで使う値は、こうやってファイルの上の方でまとめて管理する
// ------------------------------------------------------------
let currentSessionId = null; // 今操作中のセッションのid(IndexedDB上のid)
let currentSession = null; // 今操作中のセッションのデータそのもの
let currentStore = null; // 選択中の店舗(会員カード有無の判定に使う)
let currentRate = null; // 選択中のレート(換金率などの計算に使う)
let selectedCardAction = null; // 終了画面で選んだ "exchange" か "keep"
let winBallsBeforeWin = 0; // 当たり記録画面に入った時点(=当たった時点)の所持数。回収数の自動計算に使う

// カレンダー画面用の状態
const today = new Date();
let calendarYear = today.getFullYear();
let calendarMonth = today.getMonth(); // 0(1月)〜11(12月)
let selectedDate = formatDate(today);

/** Dateオブジェクトを "2026-08-12" の形式の文字列にする */
function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ゲーム数・投資金額・玉/メダル数は0未満になり得ないため、
 *  入力欄から値を読み取る時は必ずこの関数を通して0未満を0に切り下げる。
 *  (HTML側にmin="0"を付けていても、直接マイナス記号を入力される可能性は残るため) */
function nonNeg(value) {
  return Math.max(0, Number(value) || 0);
}

// ------------------------------------------------------------
// 2.5 カレンダー画面(ホーム画面)
// ------------------------------------------------------------

/** その月の、日付ごとの収支合計をまとめて取得する。
 *  パチンコ・スロットのセッションと、競馬・ボートレースのレース記録の両方を合算する。
 *  戻り値の例: { "2026-08-01": -5500, "2026-08-04": 3200 } */
async function getMonthlyProfitByDate(year, month) {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`; // "2026-08"
  const profitByDate = {};

  // パチンコ・スロット分
  const allSessions = await dbGetAll(PACHINKO_SESSIONS_TABLE);
  allSessions
    .filter((s) => s.status === "completed" && s.date.startsWith(monthPrefix))
    .forEach((s) => {
      const profit = s.collectedYen - s.investmentAmount;
      profitByDate[s.date] = (profitByDate[s.date] || 0) + profit;
    });

  // 競馬・ボートレース分。レース(親)ごとに、紐づく賭け(子)の投資・回収を合計する
  const allRaces = await dbGetAll(RACES_TABLE);
  const racesThisMonth = allRaces.filter((r) => r.date.startsWith(monthPrefix));
  const allBets = await dbGetAll(BETS_TABLE);

  racesThisMonth.forEach((race) => {
    const betsForRace = allBets.filter((b) => b.raceId === race.id);
    const profit = betsForRace.reduce((sum, b) => sum + (b.collection - b.investment), 0);
    profitByDate[race.date] = (profitByDate[race.date] || 0) + profit;
  });

  return profitByDate;
}

async function renderCalendar() {
  document.getElementById("calMonthLabel").textContent = `${calendarYear}年${calendarMonth + 1}月`;

  const profitByDate = await getMonthlyProfitByDate(calendarYear, calendarMonth);

  const firstDayOfMonth = new Date(calendarYear, calendarMonth, 1);
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const startWeekday = firstDayOfMonth.getDay(); // 0(日)〜6(土)

  const gridEl = document.getElementById("calendarGrid");
  gridEl.innerHTML = "";

  // 月の最初の週で、1日より前にあたる部分は空セルで埋める
  for (let i = 0; i < startWeekday; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "calendar-day empty";
    gridEl.appendChild(emptyCell);
  }

  let monthTotal = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(new Date(calendarYear, calendarMonth, day));
    const profit = profitByDate[dateStr];
    if (profit !== undefined) monthTotal += profit;

    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (dateStr === formatDate(new Date())) cell.classList.add("today");
    if (dateStr === selectedDate) cell.classList.add("selected");

    let amountHtml = "";
    if (profit !== undefined) {
      const cls = profit >= 0 ? "positive" : "negative";
      const sign = profit > 0 ? "+" : "";
      amountHtml = `<span class="day-amount ${cls}">${sign}${profit.toLocaleString()}</span>`;
    }

    cell.innerHTML = `<span>${day}</span>${amountHtml}`;
    cell.addEventListener("click", () => {
      selectedDate = dateStr;
      renderCalendar(); // 選択状態(枠の色)を更新するため再描画
      renderDayDetail(dateStr);
    });

    gridEl.appendChild(cell);
  }

  document.getElementById("calMonthTotal").textContent = `¥${monthTotal.toLocaleString()}`;
}

async function renderDayDetail(dateStr) {
  document.getElementById("dayDetailTitle").textContent = dateStr;

  const sessions = await dbGetByIndex(PACHINKO_SESSIONS_TABLE, "by_date", dateStr);
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const races = await dbGetByIndex(RACES_TABLE, "by_date", dateStr);

  const listEl = document.getElementById("dayDetailList");
  listEl.innerHTML = "";

  if (completedSessions.length === 0 && races.length === 0) {
    listEl.innerHTML = `<p class="placeholder">この日の記録はまだありません。</p>`;
    return;
  }

  completedSessions.forEach((s) => {
    const profit = s.collectedYen - s.investmentAmount;
    const li = document.createElement("li");
    li.className = "day-record-item";
    li.innerHTML = `
      <div class="reg-item">
        <div class="reg-item-main">
          <span class="reg-item-name">${s.storeName} / ${s.rateLabel} / ${s.modelName}</span>
          <span class="reg-item-sub">投資 ¥${s.investmentAmount.toLocaleString()} / 回収 ¥${s.collectedYen.toLocaleString()}</span>
        </div>
        <div class="reg-item-main" style="align-items: flex-end;">
          <span class="day-amount ${profit >= 0 ? "positive" : "negative"}">${profit >= 0 ? "+" : ""}${profit.toLocaleString()}円</span>
        </div>
      </div>
      <div class="reg-item-actions">
        <button class="rate-btn edit-session-btn">修正</button>
        <button class="delete-btn delete-session-btn">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".edit-session-btn").addEventListener("click", () => openEditSessionModal(s));
    li.querySelector(".delete-session-btn").addEventListener("click", async () => {
      if (!confirm(`${s.storeName}の記録を削除しますか?会員カードを使っていた場合、残高も元に戻します。`)) return;
      await deletePachinkoSession(s);
      await renderCalendar();
      await renderDayDetail(dateStr);
      if (typeof renderCards === "function") renderCards();
    });
  });

  // 競馬・ボートレースは、レースごとに紐づく賭けをまとめて1件のカードとして表示する
  for (const race of races) {
    const bets = await dbGetByIndex(BETS_TABLE, "by_raceId", race.id);
    const investment = bets.reduce((sum, b) => sum + b.investment, 0);
    const collection = bets.reduce((sum, b) => sum + b.collection, 0);
    const profit = collection - investment;

    const li = document.createElement("li");
    li.className = "day-record-item";
    li.innerHTML = `
      <div class="reg-item">
        <div class="reg-item-main">
          <span class="reg-item-name">${race.venueName} / ${race.category}(${bets.length}点)</span>
          <span class="reg-item-sub">投資 ¥${investment.toLocaleString()} / 回収 ¥${collection.toLocaleString()}</span>
        </div>
        <div class="reg-item-main" style="align-items: flex-end;">
          <span class="day-amount ${profit >= 0 ? "positive" : "negative"}">${profit >= 0 ? "+" : ""}${profit.toLocaleString()}円</span>
        </div>
      </div>
      <div class="reg-item-actions">
        <button class="rate-btn edit-race-btn">修正</button>
        <button class="delete-btn delete-race-btn">削除</button>
      </div>
    `;
    listEl.appendChild(li);

    li.querySelector(".edit-race-btn").addEventListener("click", () => openRaceScreenForEdit(race, bets));
    li.querySelector(".delete-race-btn").addEventListener("click", async () => {
      if (!confirm(`${race.venueName}のレース記録を削除しますか?`)) return;
      await deleteRace(race.id);
      await renderCalendar();
      await renderDayDetail(dateStr);
    });
  }
}

// ------------------------------------------------------------
// 2.6 パチンコ・スロット記録の修正・削除
// ------------------------------------------------------------

let editingSessionId = null;

function openEditSessionModal(session) {
  editingSessionId = session.id;
  document.getElementById("editInvestmentInput").value = session.investmentAmount;
  document.getElementById("editCollectedInput").value = session.collectedYen;
  document.getElementById("editSessionModal").classList.remove("hidden");
}

document.getElementById("editSessionModalClose").addEventListener("click", () => {
  document.getElementById("editSessionModal").classList.add("hidden");
});

document.getElementById("editSessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await dbGet(PACHINKO_SESSIONS_TABLE, editingSessionId);
  session.investmentAmount = nonNeg(document.getElementById("editInvestmentInput").value);
  session.collectedYen = nonNeg(document.getElementById("editCollectedInput").value);
  await dbUpdate(PACHINKO_SESSIONS_TABLE, session);

  document.getElementById("editSessionModal").classList.add("hidden");
  await renderCalendar();
  await renderDayDetail(session.date);
});

/** セッションを削除する。会員カードを使っていた場合は、
 *  開始時に引いた分・終了時に足した分を計算し直してカード残高を元に戻してから削除する。 */
async function deletePachinkoSession(session) {
  if (session.usedMemberCard || session.cardAction) {
    const rate = await dbGet(RATES_TABLE, session.rateId);
    if (rate) {
      // 開始時: カードから持ってきた分を返す
      if (session.usedMemberCard) {
        rate.cardBalance += session.startBallsFromCard;
      }
      // 終了時: カードに足した分(換金の余り、または換金しなかった全量)を差し引く
      if (session.cardAction === "exchange") {
        rate.cardBalance -= session.endBalls % session.exchangeUnitsRequired;
      } else if (session.cardAction === "keep") {
        rate.cardBalance -= session.endBalls;
      }
      await dbUpdate(RATES_TABLE, rate);
    }
  }
  await dbDelete(PACHINKO_SESSIONS_TABLE, session.id);
}

document.getElementById("calPrevBtn").addEventListener("click", () => {
  calendarMonth -= 1;
  if (calendarMonth < 0) {
    calendarMonth = 11;
    calendarYear -= 1;
  }
  renderCalendar();
});

document.getElementById("calNextBtn").addEventListener("click", () => {
  calendarMonth += 1;
  if (calendarMonth > 11) {
    calendarMonth = 0;
    calendarYear += 1;
  }
  renderCalendar();
});

// ------------------------------------------------------------
// 3. 画面①: 開始前
// ------------------------------------------------------------

async function populateStoreSelect() {
  const stores = await dbGetAll(STORES_TABLE);
  const selectEl = document.getElementById("sessionStoreSelect");
  selectEl.innerHTML = `<option value="">選択してください</option>`;
  stores.forEach((store) => {
    selectEl.innerHTML += `<option value="${store.id}">${store.name}</option>`;
  });
}

async function populateModelSelect() {
  const models = await dbGetAll(MODELS_TABLE);
  const selectEl = document.getElementById("sessionModelSelect");
  selectEl.innerHTML = `<option value="">選択してください</option>`;
  models.forEach((model) => {
    selectEl.innerHTML += `<option value="${model.id}">${model.name}</option>`;
  });
}

// 店舗を選んだら、その店舗のレートだけをレート選択肢に表示する
document.getElementById("sessionStoreSelect").addEventListener("change", async (event) => {
  const storeId = Number(event.target.value);
  const rateSelectEl = document.getElementById("sessionRateSelect");
  const cardInfoEl = document.getElementById("cardBalanceInfo");

  if (!storeId) {
    rateSelectEl.innerHTML = `<option value="">先に店舗を選んでください</option>`;
    rateSelectEl.disabled = true;
    cardInfoEl.classList.add("hidden");
    currentStore = null;
    return;
  }

  currentStore = await dbGet(STORES_TABLE, storeId);
  const rates = await dbGetByIndex(RATES_TABLE, "by_storeId", storeId);

  rateSelectEl.disabled = false;
  rateSelectEl.innerHTML = `<option value="">選択してください</option>`;
  rates.forEach((rate) => {
    rateSelectEl.innerHTML += `<option value="${rate.id}">${rate.rateLabel}</option>`;
  });

  // 会員カードがある店舗の場合だけ「会員カードを使う」の欄を表示する
  cardInfoEl.classList.toggle("hidden", !currentStore.hasMemberCard);
});

// レートを選んだら、そのレートの会員カード残高を表示する
document.getElementById("sessionRateSelect").addEventListener("change", async (event) => {
  const rateId = Number(event.target.value);
  if (!rateId) {
    currentRate = null;
    return;
  }
  currentRate = await dbGet(RATES_TABLE, rateId);
  document.getElementById("cardBalanceText").textContent = currentRate.cardBalance;
});

document.getElementById("sessionStartBtn").addEventListener("click", async () => {
  if (!currentStore || !currentRate) {
    alert("店舗とレートを選択してください");
    return;
  }

  const modelSelectEl = document.getElementById("sessionModelSelect");
  const modelId = Number(modelSelectEl.value);
  if (!modelId) {
    alert("機種を選択してください");
    return;
  }
  const modelName = modelSelectEl.selectedOptions[0].textContent;

  const useCard = document.getElementById("sessionUseCardInput").checked;
  const startGameCount = nonNeg(document.getElementById("sessionStartGameCountInput").value);

  // 会員カードを使う場合、カードの残高を丸ごと「所持している玉/メダル」として持ってくる
  const startBallsFromCard = useCard ? currentRate.cardBalance : 0;

  const dateStr = formatDate(new Date());

  const newSession = {
    date: dateStr,
    category: currentRate.category,
    storeId: currentStore.id,
    storeName: currentStore.name,
    rateId: currentRate.id,
    rateLabel: currentRate.rateLabel,
    lendPerThousand: currentRate.lendPerThousand,
    exchangeYenUnit: currentRate.exchangeYenUnit,
    exchangeUnitsRequired: currentRate.exchangeUnitsRequired,
    modelId: modelId,
    modelName: modelName,
    startGameCount: startGameCount,
    usedMemberCard: useCard,
    startBallsFromCard: startBallsFromCard,
    investmentAmount: 0,
    currentGameCount: startGameCount,
    currentBalls: startBallsFromCard,
    wins: [],
    status: "in_progress",
    createdAt: new Date().toISOString(),
  };

  currentSessionId = await dbAdd(PACHINKO_SESSIONS_TABLE, newSession);
  newSession.id = currentSessionId;
  currentSession = newSession;

  // カードの残高を使い切ったので、レート側の残高を0に更新しておく
  if (useCard) {
    currentRate.cardBalance = 0;
    await dbUpdate(RATES_TABLE, currentRate);
  }

  enterProgressScreen();
});

// ------------------------------------------------------------
// 4. 画面②: 進行中
// ------------------------------------------------------------

function enterProgressScreen() {
  document.getElementById("progressTitle").textContent =
    `${currentSession.storeName} / ${currentSession.rateLabel} / ${currentSession.modelName}`;
  document.getElementById("investmentAmountInput").value = currentSession.investmentAmount;
  document.getElementById("currentGameCountInput").value = currentSession.currentGameCount;
  document.getElementById("currentBallsInput").value = currentSession.currentBalls;
  showSessionScreen("screen-progress");
}

document.getElementById("investMinusBtn").addEventListener("click", () => {
  const input = document.getElementById("investmentAmountInput");
  // Math.maxで0未満にならないようにしている
  input.value = Math.max(0, Number(input.value) - 1000);
});

document.getElementById("investPlusBtn").addEventListener("click", () => {
  const input = document.getElementById("investmentAmountInput");
  input.value = Number(input.value) + 1000;
});

/** 進行中画面に入力されている値を、メモリ上のcurrentSessionに反映する。
 *  画面を切り替える直前に必ず呼ぶことで、値の取りこぼしを防ぐ。 */
function syncProgressInputsToSession() {
  currentSession.investmentAmount = nonNeg(document.getElementById("investmentAmountInput").value);
  currentSession.currentGameCount = nonNeg(document.getElementById("currentGameCountInput").value);
  currentSession.currentBalls = nonNeg(document.getElementById("currentBallsInput").value);
}

document.getElementById("winBtn").addEventListener("click", () => {
  syncProgressInputsToSession();

  // 「当たった時のゲーム数・投資金額」は直前の進行中画面で入力済みの値そのものなので、
  // ここでは再入力させず確認用のテキストとして表示するだけにする
  winBallsBeforeWin = currentSession.currentBalls; // 回収数を自動計算する基準値として覚えておく
  document.getElementById("winGameCountText").textContent = currentSession.currentGameCount;
  document.getElementById("winInvestmentText").textContent = currentSession.investmentAmount;
  document.getElementById("winBallsBeforeText").textContent = winBallsBeforeWin;
  document.getElementById("winNewBallsInput").value = winBallsBeforeWin;
  updateWinCollectedPreview();

  showSessionScreen("screen-win");
});

document.getElementById("backFromWinBtn").addEventListener("click", () => {
  // この画面ではまだ何もDBに保存していないので、単に進行中画面に戻るだけでよい
  enterProgressScreen();
});

document.getElementById("endFromProgressBtn").addEventListener("click", () => {
  syncProgressInputsToSession();
  enterEndScreen(currentSession.currentGameCount, currentSession.currentBalls);
});

document.getElementById("discardSessionBtn").addEventListener("click", async () => {
  if (!confirm("この記録を保存せずに中断しますか?ここまでの入力内容は消えます。")) return;
  await abortCurrentSession();
});

/** 進行中のセッションを、記録として残さずに削除する。
 *  会員カードを使っていた場合は、開始時に持ってきた分をカードの残高に戻す。 */
async function abortCurrentSession() {
  if (currentSession.usedMemberCard) {
    const rate = await dbGet(RATES_TABLE, currentSession.rateId);
    if (rate) {
      rate.cardBalance += currentSession.startBallsFromCard;
      await dbUpdate(RATES_TABLE, rate);
    }
  }
  await dbDelete(PACHINKO_SESSIONS_TABLE, currentSession.id);

  if (typeof renderCards === "function") renderCards();
  await returnToCalendar();
}

// ------------------------------------------------------------
// 5. 画面③: 当たり記録
// ------------------------------------------------------------

/** 「回収後の所持数」の入力に合わせて、回収数(=差分)をリアルタイムに計算して表示する。 */
function updateWinCollectedPreview() {
  const newBalls = nonNeg(document.getElementById("winNewBallsInput").value);
  const collected = Math.max(0, newBalls - winBallsBeforeWin);
  document.getElementById("winCollectedText").textContent = collected;
}

document.getElementById("winNewBallsInput").addEventListener("input", updateWinCollectedPreview);

/** 入力された当たり情報をcurrentSession.winsに1件追加し、DBに保存する。 */
async function commitWinEntry() {
  // ゲーム数・投資金額はすでにcurrentSessionに入っている値をそのまま使う(再入力させない)
  const atGameCount = currentSession.currentGameCount;
  const atInvestment = currentSession.investmentAmount;
  const newBalls = nonNeg(document.getElementById("winNewBallsInput").value);
  // 回収数は「回収後の所持数」と「当たった時点の所持数」の差分から自動計算する
  const collectedBalls = Math.max(0, newBalls - winBallsBeforeWin);

  currentSession.wins.push({ atGameCount, atInvestment, collectedBalls });
  currentSession.currentBalls = newBalls;

  await dbUpdate(PACHINKO_SESSIONS_TABLE, currentSession);
}

document.getElementById("continueBtn").addEventListener("click", async () => {
  await commitWinEntry();
  enterProgressScreen();
});

document.getElementById("endFromWinBtn").addEventListener("click", async () => {
  await commitWinEntry();
  enterEndScreen(currentSession.currentGameCount, currentSession.currentBalls);
});

// ------------------------------------------------------------
// 6. 画面④: 終了
// ------------------------------------------------------------

function enterEndScreen(prefillGameCount, prefillBalls) {
  document.getElementById("endGameCountInput").value = prefillGameCount;
  document.getElementById("endBallsInput").value = prefillBalls;
  document.getElementById("confirmEndBtn").disabled = false;

  const cardActionGroup = document.getElementById("cardActionGroup");
  selectedCardAction = null;
  document.querySelectorAll("#cardActionGroup .toggle-btn").forEach((b) => b.classList.remove("active"));

  // 会員カードがある店舗の時だけ「換金する/しない」の選択肢を出す
  cardActionGroup.classList.toggle("hidden", !currentStore.hasMemberCard);
  if (!currentStore.hasMemberCard) {
    selectedCardAction = "exchange"; // カードがない場合は常に全額換金扱いにする
  }

  showSessionScreen("screen-end");
}

document.getElementById("backFromEndBtn").addEventListener("click", () => {
  // まだ確定(dbUpdateでstatusをcompletedにする処理)前なので、単に進行中画面に戻ればよい
  enterProgressScreen();
});

document.getElementById("cardExchangeBtn").addEventListener("click", () => {
  selectedCardAction = "exchange";
  document.getElementById("cardExchangeBtn").classList.add("active");
  document.getElementById("cardKeepBtn").classList.remove("active");
});

document.getElementById("cardKeepBtn").addEventListener("click", () => {
  selectedCardAction = "keep";
  document.getElementById("cardKeepBtn").classList.add("active");
  document.getElementById("cardExchangeBtn").classList.remove("active");
});

document.getElementById("confirmEndBtn").addEventListener("click", async () => {
  // すでに完了済みのセッションであれば、二重に処理しない
  // (連打防止のボタン無効化と合わせて、二重の安全策にしている)
  if (currentSession.status === "completed") return;

  if (currentStore.hasMemberCard && !selectedCardAction) {
    alert("会員カードへの対応(換金する/しない)を選んでください");
    return;
  }

  // 処理が終わるまでボタンを無効化し、連打で二重送信されるのを防ぐ
  const confirmBtn = document.getElementById("confirmEndBtn");
  confirmBtn.disabled = true;

  const endGameCount = nonNeg(document.getElementById("endGameCountInput").value);
  const endBalls = nonNeg(document.getElementById("endBallsInput").value);

  // 換金できる個数(割り切れる分)と、端数(余り)を計算する
  const exchangeableUnits = Math.floor(endBalls / currentSession.exchangeUnitsRequired);
  const remainder = endBalls % currentSession.exchangeUnitsRequired;

  let collectedYen = 0;
  let cardBalanceToAdd = 0;

  if (selectedCardAction === "exchange") {
    collectedYen = exchangeableUnits * currentSession.exchangeYenUnit;
    cardBalanceToAdd = currentStore.hasMemberCard ? remainder : 0; // カードがなければ余りは破棄
  } else if (selectedCardAction === "keep") {
    collectedYen = 0;
    cardBalanceToAdd = endBalls; // 全部カードに戻す
  }

  // 会員カードがある場合は、最新のレート情報を取得してから残高を更新する
  if (currentStore.hasMemberCard && cardBalanceToAdd > 0) {
    const latestRate = await dbGet(RATES_TABLE, currentSession.rateId);
    latestRate.cardBalance += cardBalanceToAdd;
    await dbUpdate(RATES_TABLE, latestRate);
  }

  currentSession.status = "completed";
  currentSession.endGameCount = endGameCount;
  currentSession.endBalls = endBalls;
  currentSession.cardAction = currentStore.hasMemberCard ? selectedCardAction : null;
  currentSession.collectedYen = collectedYen;
  await dbUpdate(PACHINKO_SESSIONS_TABLE, currentSession);

  // 会員カードの一覧表示(登録情報タブ)にも影響するので再描画しておく
  if (typeof renderCards === "function") renderCards();

  // 結果画面は経由せず、カレンダーのそのマス目に金額が反映された状態を見せることで
  // 「記録できたことの確認」を兼ねる
  selectedDate = currentSession.date;
  returnToCalendar();
});

/** セッション関連の状態をリセットして、カレンダー画面に戻る。 */
async function returnToCalendar() {
  currentSessionId = null;
  currentSession = null;
  currentStore = null;
  currentRate = null;

  resetStartForm();
  await renderCalendar();
  await renderDayDetail(selectedDate);
  showSessionScreen("screen-calendar");
}

/** 開始前画面のフォームを初期状態に戻す。 */
function resetStartForm() {
  document.getElementById("sessionStoreSelect").value = "";
  document.getElementById("sessionRateSelect").innerHTML = `<option value="">先に店舗を選んでください</option>`;
  document.getElementById("sessionRateSelect").disabled = true;
  document.getElementById("cardBalanceInfo").classList.add("hidden");
  document.getElementById("sessionUseCardInput").checked = false;
  document.getElementById("sessionStartGameCountInput").value = 0;
}

document.getElementById("cancelStartBtn").addEventListener("click", () => {
  currentStore = null;
  currentRate = null;
  resetStartForm();
  showSessionScreen("screen-calendar");
});

document.getElementById("fabAddBtn").addEventListener("click", () => {
  showSessionScreen("screen-category-select");
});

// ------------------------------------------------------------
// 7. 起動時: 進行中のセッションがあれば自動で再開する
// ------------------------------------------------------------
async function resumeInProgressSessionIfAny() {
  const inProgressSessions = await dbGetByIndex(PACHINKO_SESSIONS_TABLE, "by_status", "in_progress");
  if (inProgressSessions.length === 0) return;

  // 通常は1件しか進行中セッションが無い想定だが、念のため一番新しいものを使う
  currentSession = inProgressSessions[inProgressSessions.length - 1];
  currentSessionId = currentSession.id;
  currentStore = await dbGet(STORES_TABLE, currentSession.storeId);
  currentRate = await dbGet(RATES_TABLE, currentSession.rateId);

  enterProgressScreen();
}

populateStoreSelect();
populateModelSelect();
renderCalendar();
renderDayDetail(selectedDate);
resumeInProgressSessionIfAny();
