/*
  このファイルの構成
  ------------------------------------------------------------
  1. サブタブ(概要/項目別/記録)の切り替え
  2. 全記録を取得する共通関数(パチンコ・スロット+競馬・ボートレースを統合)
  3. 期間(月別/年別/全期間)の切り替えと、期間内での絞り込み
  4. ①概要: 統計・累積収支グラフ・課税ラインゲージ
  5. 集計の共通部品(calcStats・statsLineHtml・groupBy・棒グラフ)
  6. ②項目別: パチンコ・スロットタブ(円/玉・メダル切り替え対応)
  7. ②項目別: 競馬・ボートレースタブ(共通ロジックを使い回す)
  8. ③記録: ベスト/ワースト・連勝連敗・大当たり間隔
  9. 起動時の初期描画

  期間切り替え(月別/年別/全期間)は概要・項目別・記録で共通の1つの状態を使う。
  UIも収支分析タブの最上部に1つだけ置いてあるので、期間が変わったら
  概要と、今表示中の項目別タブの両方を再描画するようにしている。
*/

// ------------------------------------------------------------
// 1. サブタブの切り替え
// ------------------------------------------------------------
document.querySelectorAll(".analysis-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.atab;
    document.querySelectorAll(".analysis-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".analysis-tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`subtab-${target}`).classList.add("active");

    if (target === "breakdown") renderActiveCatMain();
    if (target === "records") renderRecords();
  });
});

// ------------------------------------------------------------
// 2. 全記録を取得する共通関数
// ------------------------------------------------------------

/** パチンコ・スロットの完了済みセッションと、競馬・ボートレースのレースを
 *  同じ形({date, investment, collection})に揃えて1つの配列にまとめる。
 *  ①概要のような「全部まとめた」集計をしたい場面で使う。 */
async function getAllProfitRecords() {
  const sessions = await dbGetAll(PACHINKO_SESSIONS_TABLE);
  const sessionRecords = sessions
    .filter((s) => s.status === "completed")
    .map((s) => ({ date: s.date, investment: s.investmentAmount, collection: s.collectedYen }));

  const races = await dbGetAll(RACES_TABLE);
  const allBets = await dbGetAll(BETS_TABLE);
  const raceRecords = races.map((race) => {
    const bets = allBets.filter((b) => b.raceId === race.id);
    return {
      date: race.date,
      investment: bets.reduce((sum, b) => sum + b.investment, 0),
      collection: bets.reduce((sum, b) => sum + b.collection, 0),
    };
  });

  return [...sessionRecords, ...raceRecords];
}

/** パチンコ・スロットの完了済みセッションを、店舗・レート・機種などの詳細情報を
 *  残したまま、今の期間で絞り込んで返す。②項目別のパチンコ・スロットタブで使う。 */
async function getPeriodSessions() {
  const sessions = await dbGetAll(PACHINKO_SESSIONS_TABLE);
  return sessions.filter((s) => s.status === "completed" && isInPeriod(s.date));
}

/** 競馬・ボートレースのレースに紐づく賭けを、レース情報を持たせたまま
 *  今の期間で絞り込んで返す。②項目別の競馬・ボートレースタブで使う。 */
async function getPeriodBets() {
  const races = (await dbGetAll(RACES_TABLE)).filter((r) => isInPeriod(r.date));
  const raceById = Object.fromEntries(races.map((r) => [r.id, r]));

  const allBets = await dbGetAll(BETS_TABLE);
  return allBets.filter((b) => raceById[b.raceId]).map((b) => ({ ...b, race: raceById[b.raceId] }));
}

// ------------------------------------------------------------
// 3. 期間の切り替え
// ------------------------------------------------------------

let periodType = "month"; // "month" | "year" | "all"
let periodAnchor = new Date(); // 「月別」「年別」の基準になる日付

document.querySelectorAll(".period-type-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-type-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    periodType = btn.dataset.period;
    periodAnchor = new Date(); // タイプを切り替えたら基準日を「今」にリセットする
    renderOverview();
    renderActiveCatMain();
    renderRecords();
  });
});

document.getElementById("periodPrevBtn").addEventListener("click", () => movePeriod(-1));
document.getElementById("periodNextBtn").addEventListener("click", () => movePeriod(1));

function movePeriod(direction) {
  if (periodType === "month") {
    periodAnchor.setMonth(periodAnchor.getMonth() + direction);
  } else if (periodType === "year") {
    periodAnchor.setFullYear(periodAnchor.getFullYear() + direction);
  }
  // "all" は移動しない(常に全期間なので、前へ/次への概念がない)
  renderOverview();
  renderActiveCatMain();
  renderRecords();
}

/** 今の期間タイプ・基準日から、画面上部に出すラベル文字列を作る。 */
function getPeriodLabel() {
  const y = periodAnchor.getFullYear();
  const m = periodAnchor.getMonth() + 1;

  if (periodType === "month") return `${y}年${m}月`;
  if (periodType === "year") return `${y}年`;
  return "全期間";
}

/** 1件の記録(date文字列を持つ)が、今の期間に含まれるかを判定する。 */
function isInPeriod(dateStr) {
  if (periodType === "all") return true;

  const y = periodAnchor.getFullYear();
  const m = String(periodAnchor.getMonth() + 1).padStart(2, "0");

  if (periodType === "month") return dateStr.startsWith(`${y}-${m}`);
  if (periodType === "year") return dateStr.startsWith(`${y}`);
  return true;
}

// ------------------------------------------------------------
// 4. ①概要
// ------------------------------------------------------------

async function renderOverview() {
  document.getElementById("periodLabel").textContent = getPeriodLabel();
  document.getElementById("periodPrevBtn").classList.toggle("hidden", periodType === "all");
  document.getElementById("periodNextBtn").classList.toggle("hidden", periodType === "all");

  const allRecords = await getAllProfitRecords();
  const periodRecords = allRecords.filter((r) => isInPeriod(r.date));
  const stats = calcStats(periodRecords);

  document.getElementById("statProfit").textContent = `${stats.profit >= 0 ? "+" : ""}¥${stats.profit.toLocaleString()}`;
  document.getElementById("statProfit").className = `stat-value ${stats.profit >= 0 ? "positive" : "negative"}`;
  document.getElementById("statInvestment").textContent = `¥${stats.investment.toLocaleString()}`;
  document.getElementById("statCollection").textContent = `¥${stats.collection.toLocaleString()}`;
  document.getElementById("statWinRate").textContent =
    stats.winRate === null ? "-" : `${stats.winRate.toFixed(1)}%(${stats.winCount}/${stats.count})`;
  document.getElementById("statRecoveryRate").textContent =
    stats.recoveryRate === null ? "-" : `${stats.recoveryRate.toFixed(1)}%`;

  renderCumulativeChart(allRecords);
  renderTaxGauge(allRecords);
}

/** 今の期間タイプに応じて、グラフに使う「ラベルごとの収支合計」の配列を作る。
 *  月別なら日単位、年別なら月単位、全期間なら年月単位でまとめる。 */
function buildChartBuckets(allRecords) {
  const y = periodAnchor.getFullYear();
  const m = periodAnchor.getMonth();

  if (periodType === "month") {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const buckets = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatDate(new Date(y, m, day));
      const profit = allRecords
        .filter((r) => r.date === dateStr)
        .reduce((sum, r) => sum + (r.collection - r.investment), 0);
      buckets.push({ label: String(day), profit });
    }
    return buckets;
  }

  if (periodType === "year") {
    const buckets = [];
    for (let month = 0; month < 12; month++) {
      const prefix = `${y}-${String(month + 1).padStart(2, "0")}`;
      const profit = allRecords
        .filter((r) => r.date.startsWith(prefix))
        .reduce((sum, r) => sum + (r.collection - r.investment), 0);
      buckets.push({ label: `${month + 1}月`, profit });
    }
    return buckets;
  }

  // "all": データが存在する年月をすべて洗い出して、古い順に並べる
  const monthsPresent = [...new Set(allRecords.map((r) => r.date.slice(0, 7)))].sort();
  return monthsPresent.map((yearMonth) => {
    const profit = allRecords
      .filter((r) => r.date.startsWith(yearMonth))
      .reduce((sum, r) => sum + (r.collection - r.investment), 0);
    return { label: yearMonth.slice(2).replace("-", "/"), profit }; // "26/08" のような表記
  });
}

function renderCumulativeChart(allRecords) {
  const container = document.getElementById("cumulativeChartContainer");
  const buckets = buildChartBuckets(allRecords);

  if (!buckets || buckets.length === 0) {
    container.innerHTML = `<p class="empty-chart-message">この期間には記録がありません。</p>`;
    return;
  }

  // 日々の収支を、先頭から順に足し込んで「累積」の折れ線にする
  let running = 0;
  const points = buckets.map((b) => {
    running += b.profit;
    return { label: b.label, cumulative: running };
  });

  container.innerHTML = drawLineChartSVG(points);
}

/** 折れ線グラフのSVGを、座標計算から自分で組み立てる。
 *  ライブラリを使わない分、ここでは「値の範囲をどう画面の高さに変換するか」という
 *  グラフ描画の基本的な考え方がそのままコードに出ている。 */
function drawLineChartSVG(points) {
  const width = 600;
  const height = 200;
  const paddingLeft = 50;
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 24;

  const values = points.map((p) => p.cumulative);
  const maxValue = Math.max(0, ...values);
  const minValue = Math.min(0, ...values);
  const valueRange = maxValue - minValue || 1;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const xForIndex = (i) => paddingLeft + (i / (points.length - 1 || 1)) * plotWidth;
  const yForValue = (v) => paddingTop + (1 - (v - minValue) / valueRange) * plotHeight;

  const linePoints = points.map((p, i) => `${xForIndex(i)},${yForValue(p.cumulative)}`).join(" ");
  const zeroY = yForValue(0);

  const labelStep = Math.ceil(points.length / 8);
  const labelEls = points
    .map((p, i) => (i % labelStep === 0 ? `<text x="${xForIndex(i)}" y="${height - 6}" class="chart-axis-label" text-anchor="middle">${p.label}</text>` : ""))
    .join("");

  const lastPoint = points[points.length - 1];
  const lineColor = lastPoint.cumulative >= 0 ? "var(--accent)" : "var(--danger)";

  return `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg">
      <style>.chart-axis-label { font-size: 9px; fill: var(--text-dim); }</style>
      <line x1="${paddingLeft}" y1="${zeroY}" x2="${width - paddingRight}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="3,3" />
      <polyline points="${linePoints}" fill="none" stroke="${lineColor}" stroke-width="2" />
      ${labelEls}
    </svg>
  `;
}

const TAXABLE_LINE = 500000;

/** 課税ラインは「その年に勝った日のプラス分だけ」を合算する(負けた日は加算しない)。
 *  一時所得の課税は暦年(1月〜12月)単位で考えるのが実態に近いため、常に「今年」を対象にする。 */
function renderTaxGauge(allRecords) {
  const thisYear = new Date().getFullYear();
  const yearRecords = allRecords.filter((r) => r.date.startsWith(String(thisYear)));

  const profitByDate = {};
  yearRecords.forEach((r) => {
    profitByDate[r.date] = (profitByDate[r.date] || 0) + (r.collection - r.investment);
  });

  let taxableTotal = 0;
  Object.values(profitByDate).forEach((p) => {
    if (p > 0) taxableTotal += p;
  });

  const ratio = Math.min(1, taxableTotal / TAXABLE_LINE);
  document.getElementById("taxGaugeFill").style.width = `${ratio * 100}%`;

  const remaining = Math.max(0, TAXABLE_LINE - taxableTotal);
  document.getElementById("taxGaugeText").textContent =
    `${thisYear}年: ¥${taxableTotal.toLocaleString()} / ¥${TAXABLE_LINE.toLocaleString()}(あと¥${remaining.toLocaleString()})`;
}

// ------------------------------------------------------------
// 5. 集計の共通部品
// ------------------------------------------------------------

/** {investment, collection}の配列から、収支・勝率・回収率をまとめて計算する。
 *  円ベースでも玉/メダルベースでも、渡す配列の中身を変えるだけで同じ関数を使い回せる。 */
function calcStats(records) {
  const investment = records.reduce((sum, r) => sum + r.investment, 0);
  const collection = records.reduce((sum, r) => sum + r.collection, 0);
  const winCount = records.filter((r) => r.collection > r.investment).length;
  const count = records.length;
  return {
    investment,
    collection,
    profit: collection - investment,
    winRate: count > 0 ? (winCount / count) * 100 : null,
    winCount,
    count,
    recoveryRate: investment > 0 ? (collection / investment) * 100 : null,
  };
}

/** 統計1件分を一覧の1行として表示するHTMLを作る。
 *  unitTypeを"balls"にすると、¥表記の代わりに「個」表記になる。 */
function statsLineHtml(stats, label, unitType = "yen") {
  const profitCls = stats.profit >= 0 ? "positive" : "negative";
  const winRateText = stats.winRate === null ? "-" : `${stats.winRate.toFixed(1)}%(${stats.winCount}/${stats.count})`;
  const recoveryText = stats.recoveryRate === null ? "-" : `${stats.recoveryRate.toFixed(1)}%`;

  const fmtAmount = (n) => (unitType === "yen" ? `¥${Math.round(n).toLocaleString()}` : `${Math.round(n).toLocaleString()}個`);
  const fmtProfit = (n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}${unitType === "yen" ? "円" : "個"}`;

  return `
    <div class="reg-item-main">
      <span class="reg-item-name">${label}</span>
      <span class="reg-item-sub">投資 ${fmtAmount(stats.investment)} / 回収 ${fmtAmount(stats.collection)} / 勝率 ${winRateText} / 回収率 ${recoveryText}</span>
    </div>
    <div class="reg-item-main" style="align-items: flex-end;">
      <span class="day-amount ${profitCls}">${fmtProfit(stats.profit)}</span>
    </div>
  `;
}

/** キーごとにグループ分けする小さなヘルパー。 */
function groupBy(items, keyFn) {
  const groups = {};
  items.forEach((item) => {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return groups;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 棒グラフのSVGを組み立てる。折れ線グラフ(drawLineChartSVG)と
 *  座標変換の考え方は同じで、線の代わりに四角形(rect)を並べているだけ。 */
function drawBarChartSVG(points) {
  const width = 600;
  const height = 200;
  const paddingLeft = 50;
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 24;

  const values = points.map((p) => p.value);
  const maxValue = Math.max(0, ...values);
  const minValue = Math.min(0, ...values);
  const valueRange = maxValue - minValue || 1;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const yForValue = (v) => paddingTop + (1 - (v - minValue) / valueRange) * plotHeight;
  const zeroY = yForValue(0);

  const barWidth = (plotWidth / points.length) * 0.6;
  const barGap = (plotWidth / points.length) * 0.4;

  const bars = points
    .map((p, i) => {
      const slotX = paddingLeft + i * (barWidth + barGap) + barGap / 2;
      const barY = Math.min(zeroY, yForValue(p.value));
      const barHeight = Math.abs(yForValue(p.value) - zeroY);
      const color = p.value >= 0 ? "var(--accent)" : "var(--danger)";
      const label = `<text x="${slotX + barWidth / 2}" y="${height - 6}" class="chart-axis-label" text-anchor="middle">${p.label}</text>`;
      return `<rect x="${slotX}" y="${barY}" width="${barWidth}" height="${Math.max(1, barHeight)}" fill="${color}" />${label}`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg">
      <style>.chart-axis-label { font-size: 9px; fill: var(--text-dim); }</style>
      <line x1="${paddingLeft}" y1="${zeroY}" x2="${width - paddingRight}" y2="${zeroY}" stroke="var(--border)" />
      ${bars}
    </svg>
  `;
}

// ------------------------------------------------------------
// 6. ②項目別: パチンコ・スロットタブ
// ------------------------------------------------------------

let activeCatMain = "pachi"; // "pachi" | "keiba" | "boat"
let pachiUnitMode = "yen"; // "yen" | "balls"
let pachiGroupBy = "store"; // "store" | "rate" | "model"
let lastPachiSessions = []; // 店舗ドリルダウンで使うため、直近の描画に使ったセッション一覧を覚えておく

document.querySelectorAll(".catmain-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".catmain-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".catmain-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    activeCatMain = btn.dataset.catmain;
    document.getElementById(`catmain-${activeCatMain}`).classList.add("active");
    renderActiveCatMain();
  });
});

function renderActiveCatMain() {
  if (activeCatMain === "pachi") renderPachi();
  else if (activeCatMain === "keiba") renderKeiba();
  else if (activeCatMain === "boat") renderBoat();
}

/** セッション1件を、現金投資額と最終回収額(円)の記録に変換する。 */
function yenRecord(s) {
  return { investment: s.investmentAmount, collection: s.collectedYen };
}

/** セッション1件を、玉/メダル単位の投資数・獲得数の記録に変換する。
 *  投資数 = 現金投資額を、そのレートの貸出数で玉/メダルに換算したもの
 *  獲得数 = 当たりで回収した玉/メダルの合計(wins配列の合計)
 *  会員カードの最初の持ち玉・最終的な残り玉はあえて含めない(店舗都合を排除し、
 *  「その機種・その立ち回りでどれだけ増減したか」を見るための数字にするため)。 */
function ballRecord(s) {
  return {
    investment: (s.investmentAmount / 1000) * s.lendPerThousand,
    collection: s.wins.reduce((sum, w) => sum + w.collectedBalls, 0),
  };
}

document.getElementById("pachiUnitYenBtn").addEventListener("click", () => {
  pachiUnitMode = "yen";
  document.getElementById("pachiUnitYenBtn").classList.add("active");
  document.getElementById("pachiUnitBallBtn").classList.remove("active");
  document.getElementById("pachiUnitHint").textContent = "";
  renderPachi();
});

document.getElementById("pachiUnitBallBtn").addEventListener("click", () => {
  pachiUnitMode = "balls";
  document.getElementById("pachiUnitBallBtn").classList.add("active");
  document.getElementById("pachiUnitYenBtn").classList.remove("active");
  document.getElementById("pachiUnitHint").textContent =
    "玉とメダルは単位が異なるため、合算はせずパチンコ・スロットを別々に表示します。";
  renderPachi();
});

document.querySelectorAll(".pachi-group-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pachi-group-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    pachiGroupBy = btn.dataset.group;
    renderPachi();
  });
});

async function renderPachi() {
  const sessions = await getPeriodSessions();
  lastPachiSessions = sessions; // 店舗ドリルダウン用に覚えておく
  renderPachiCategoryList(sessions);
  renderPachiGroupList(sessions);
  renderPachiWeekdayChart(sessions);
}

function renderPachiCategoryList(sessions) {
  const listEl = document.getElementById("pachiCategoryList");
  listEl.innerHTML = "";

  const toRecord = pachiUnitMode === "yen" ? yenRecord : ballRecord;

  // 円モードの時だけ、一番上に「合算」の行も追加する(玉/メダルは単位が違うため合算できない)
  const groups = [];
  if (pachiUnitMode === "yen") {
    groups.push({ label: "パチンコ・スロット合算", records: sessions.map(toRecord) });
  }
  groups.push(
    { label: pachiUnitMode === "yen" ? "パチンコ" : "パチンコ(玉)", records: sessions.filter((s) => s.category === "パチンコ").map(toRecord) },
    { label: pachiUnitMode === "yen" ? "スロット" : "スロット(メダル)", records: sessions.filter((s) => s.category === "スロット").map(toRecord) }
  );

  groups.forEach((g) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = statsLineHtml(calcStats(g.records), g.label, pachiUnitMode);
    listEl.appendChild(li);
  });
}

function renderPachiGroupList(sessions) {
  const listEl = document.getElementById("pachiGroupList");
  listEl.innerHTML = "";

  let keyFn;
  if (pachiGroupBy === "store") keyFn = (s) => s.storeName;
  // レートは店舗や換金率に関係なく、レート名(例: "4パチ")が同じものをまとめる。
  // rateLabelは登録時に「数字+パチ/スロ」で自動生成されているため、これ自体で
  // カテゴリも判別でき、店名を付け加える必要がない
  else if (pachiGroupBy === "rate") keyFn = (s) => s.rateLabel;
  else keyFn = (s) => s.modelName;

  // 玉/メダル表示の時、店舗別・機種別はパチンコとスロットが混ざりうるので、
  // グループ名にカテゴリを付け加えて必ず分ける(レート別はrateLabel自体で分かれるので対象外)
  const needsCategorySuffix = pachiUnitMode === "balls" && pachiGroupBy !== "rate";
  const finalKeyFn = needsCategorySuffix ? (s) => `${keyFn(s)}(${s.category})` : keyFn;
  const toRecord = pachiUnitMode === "yen" ? yenRecord : ballRecord;

  const groups = groupBy(sessions, finalKeyFn);
  const entries = Object.entries(groups).map(([label, list]) => ({
    label,
    records: list.map(toRecord),
  }));

  if (entries.length === 0) {
    listEl.innerHTML = `<p class="placeholder">この期間に該当する記録がありません。</p>`;
    return;
  }

  entries.sort((a, b) => calcStats(b.records).profit - calcStats(a.records).profit);

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = statsLineHtml(calcStats(entry.records), entry.label, pachiUnitMode);

    // 店舗別の時だけ、タップするとその店舗のレート別内訳が見られるようにする
    if (pachiGroupBy === "store") {
      li.classList.add("clickable-item");
      li.addEventListener("click", () => openStoreDrilldown(entry.label));
    }

    listEl.appendChild(li);
  });
}

/** 店舗名をタップした時に、その店舗のセッションだけをレート別に集計してモーダルで見せる。 */
function openStoreDrilldown(storeName) {
  const sessionsForStore = lastPachiSessions.filter((s) => s.storeName === storeName);
  const toRecord = pachiUnitMode === "yen" ? yenRecord : ballRecord;

  const groups = groupBy(sessionsForStore, (s) => s.rateLabel);
  const entries = Object.entries(groups).map(([label, list]) => ({
    label,
    records: list.map(toRecord),
  }));
  entries.sort((a, b) => calcStats(b.records).profit - calcStats(a.records).profit);

  const listEl = document.getElementById("storeDrilldownList");
  listEl.innerHTML = "";
  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = statsLineHtml(calcStats(entry.records), entry.label, pachiUnitMode);
    listEl.appendChild(li);
  });

  document.getElementById("storeDrilldownTitle").textContent = `${storeName}のレート別`;
  document.getElementById("storeDrilldownModal").classList.remove("hidden");
}

document.getElementById("storeDrilldownClose").addEventListener("click", () => {
  document.getElementById("storeDrilldownModal").classList.add("hidden");
});

function renderPachiWeekdayChart(sessions) {
  const container = document.getElementById("pachiWeekdayChart");

  if (sessions.length === 0) {
    container.innerHTML = `<p class="empty-chart-message">この期間には記録がありません。</p>`;
    return;
  }

  const profitByWeekday = [0, 0, 0, 0, 0, 0, 0];
  sessions.forEach((s) => {
    const weekday = new Date(s.date).getDay();
    profitByWeekday[weekday] += s.collectedYen - s.investmentAmount;
  });

  const points = WEEKDAY_LABELS.map((label, i) => ({ label, value: profitByWeekday[i] }));
  container.innerHTML = drawBarChartSVG(points);
}

// ------------------------------------------------------------
// 7. ②項目別: 競馬・ボートレースタブ
// ------------------------------------------------------------

let keibaGroupBy = "venue"; // "venue" | "votingType"
let boatGroupBy = "venue";

document.querySelectorAll(".keiba-group-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".keiba-group-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    keibaGroupBy = btn.dataset.group;
    renderKeiba();
  });
});

document.querySelectorAll(".boat-group-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".boat-group-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    boatGroupBy = btn.dataset.group;
    renderBoat();
  });
});

/** 競馬・ボートレースの2タブは中身の作りが完全に同じ(カテゴリ名とidが違うだけ)なので、
 *  1つの関数にまとめて、呼び出す側でカテゴリ名と描画先のidを渡す形にしている。 */
async function renderRaceCategoryTab(category, groupByValue, ids) {
  const bets = (await getPeriodBets()).filter((b) => b.race.category === category);

  const stats = calcStats(bets.map((b) => ({ investment: b.investment, collection: b.collection })));
  document.getElementById(ids.summary).innerHTML = `
    <div class="stat-box">
      <span class="stat-label">収支</span>
      <span class="stat-value ${stats.profit >= 0 ? "positive" : "negative"}">${stats.profit >= 0 ? "+" : ""}¥${stats.profit.toLocaleString()}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">投資</span>
      <span class="stat-value">¥${stats.investment.toLocaleString()}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">回収</span>
      <span class="stat-value">¥${stats.collection.toLocaleString()}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">勝率</span>
      <span class="stat-value">${stats.winRate === null ? "-" : `${stats.winRate.toFixed(1)}%(${stats.winCount}/${stats.count})`}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">回収率</span>
      <span class="stat-value">${stats.recoveryRate === null ? "-" : `${stats.recoveryRate.toFixed(1)}%`}</span>
    </div>
  `;

  const keyFn = groupByValue === "venue" ? (b) => b.race.venueName : (b) => b.votingType;
  const groups = groupBy(bets, keyFn);
  const entries = Object.entries(groups).map(([label, list]) => ({
    label,
    records: list.map((b) => ({ investment: b.investment, collection: b.collection })),
  }));

  const listEl = document.getElementById(ids.groupList);
  listEl.innerHTML = "";
  if (entries.length === 0) {
    listEl.innerHTML = `<p class="placeholder">この期間に該当する記録がありません。</p>`;
  } else {
    entries.sort((a, b) => calcStats(b.records).profit - calcStats(a.records).profit);
    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "reg-item";
      li.innerHTML = statsLineHtml(calcStats(entry.records), entry.label, "yen");
      listEl.appendChild(li);
    });
  }
}

async function renderKeiba() {
  await renderRaceCategoryTab("競馬", keibaGroupBy, {
    summary: "keibaSummaryStats",
    groupList: "keibaGroupList",
  });
}

async function renderBoat() {
  await renderRaceCategoryTab("ボートレース", boatGroupBy, {
    summary: "boatSummaryStats",
    groupList: "boatGroupList",
  });
}

// ------------------------------------------------------------
// 8. ③記録
// ------------------------------------------------------------

async function renderRecords() {
  await renderBestWorst();
  await renderStreaks();
  await renderHitIntervals();
}

/** {name, profit}の配列から、収支が一番良い/悪い1件を選んでリストの1行として表示する。 */
function bestWorstItemHtml(name, profit, rankLabel) {
  const cls = profit >= 0 ? "positive" : "negative";
  return `
    <div class="reg-item-main">
      <span class="reg-item-name">${rankLabel}</span>
      <span class="reg-item-sub">${name}</span>
    </div>
    <div class="reg-item-main" style="align-items: flex-end;">
      <span class="day-amount ${cls}">${profit >= 0 ? "+" : ""}¥${profit.toLocaleString()}</span>
    </div>
  `;
}

async function renderBestWorst() {
  // 1日単位: パチンコ・スロット+競馬・ボートレースを合算した、日付ごとの収支
  const allRecords = await getAllProfitRecords();
  const periodRecords = allRecords.filter((r) => isInPeriod(r.date));

  const profitByDate = {};
  periodRecords.forEach((r) => {
    profitByDate[r.date] = (profitByDate[r.date] || 0) + (r.collection - r.investment);
  });
  const dateEntries = Object.entries(profitByDate);

  const dayListEl = document.getElementById("bestWorstDayList");
  dayListEl.innerHTML = "";
  if (dateEntries.length === 0) {
    dayListEl.innerHTML = `<p class="placeholder">この期間には記録がありません。</p>`;
  } else {
    const bestDay = dateEntries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    const worstDay = dateEntries.reduce((worst, cur) => (cur[1] < worst[1] ? cur : worst));

    const bestLi = document.createElement("li");
    bestLi.className = "reg-item";
    bestLi.innerHTML = bestWorstItemHtml(bestDay[0], bestDay[1], "ベスト");
    dayListEl.appendChild(bestLi);

    const worstLi = document.createElement("li");
    worstLi.className = "reg-item";
    worstLi.innerHTML = bestWorstItemHtml(worstDay[0], worstDay[1], "ワースト");
    dayListEl.appendChild(worstLi);
  }

  // 機種単位: パチンコ・スロットのみ(競馬・ボートレースには機種という概念がないため)
  const sessions = await getPeriodSessions();
  const profitByModel = {};
  sessions.forEach((s) => {
    profitByModel[s.modelName] = (profitByModel[s.modelName] || 0) + (s.collectedYen - s.investmentAmount);
  });
  const modelEntries = Object.entries(profitByModel);

  const modelListEl = document.getElementById("bestWorstModelList");
  modelListEl.innerHTML = "";
  if (modelEntries.length === 0) {
    modelListEl.innerHTML = `<p class="placeholder">この期間には記録がありません。</p>`;
  } else {
    const bestModel = modelEntries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    const worstModel = modelEntries.reduce((worst, cur) => (cur[1] < worst[1] ? cur : worst));

    const bestLi = document.createElement("li");
    bestLi.className = "reg-item";
    bestLi.innerHTML = bestWorstItemHtml(bestModel[0], bestModel[1], "ベスト");
    modelListEl.appendChild(bestLi);

    const worstLi = document.createElement("li");
    worstLi.className = "reg-item";
    worstLi.innerHTML = bestWorstItemHtml(worstModel[0], worstModel[1], "ワースト");
    modelListEl.appendChild(worstLi);
  }
}

/** パチンコ・スロットのセッションと、競馬・ボートレースのレースを
 *  記録した順番(createdAt)に並べ、連勝・連敗の最大記録を数える。 */
async function renderStreaks() {
  const sessions = await getPeriodSessions();
  const bets = await getPeriodBets();

  const records = sessions.map((s) => ({
    createdAt: s.createdAt,
    profit: s.collectedYen - s.investmentAmount,
  }));

  // 賭けはレース単位でまとめてから、1レース1件として記録に加える
  const raceProfits = {};
  bets.forEach((b) => {
    if (!raceProfits[b.raceId]) raceProfits[b.raceId] = { createdAt: b.race.createdAt, profit: 0 };
    raceProfits[b.raceId].profit += b.collection - b.investment;
  });
  records.push(...Object.values(raceProfits));

  records.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let maxWinStreak = 0;
  let maxLoseStreak = 0;
  let currentStreak = 0;
  let currentSign = 0; // 1=勝ち continues, -1=負け continues, 0=まだ何もない

  records.forEach((r) => {
    const sign = r.profit > 0 ? 1 : r.profit < 0 ? -1 : 0;

    if (sign === 0) {
      // 収支ちょうど0はどちらの連続記録にもカウントしない(連続を途切れさせる)
      currentStreak = 0;
      currentSign = 0;
      return;
    }

    currentStreak = sign === currentSign ? currentStreak + 1 : 1;
    currentSign = sign;

    if (sign === 1) maxWinStreak = Math.max(maxWinStreak, currentStreak);
    else maxLoseStreak = Math.max(maxLoseStreak, currentStreak);
  });

  document.getElementById("statMaxWinStreak").textContent = records.length === 0 ? "-" : `${maxWinStreak}連勝`;
  document.getElementById("statMaxLoseStreak").textContent = records.length === 0 ? "-" : `${maxLoseStreak}連敗`;

  // 直近の状況 = 一番最後の記録から、今も続いている連勝/連敗
  if (records.length === 0) {
    document.getElementById("statCurrentStreak").textContent = "-";
  } else {
    const label = currentSign === 1 ? `${currentStreak}連勝中` : currentSign === -1 ? `${currentStreak}連敗中` : "-";
    document.getElementById("statCurrentStreak").textContent = label;
  }
}

/** 機種ごとに「前回の当たり(または開始)から何ゲームで次の当たりが来たか」を集計し、平均を出す。 */
async function renderHitIntervals() {
  const sessions = await getPeriodSessions();
  const intervalsByModel = {};

  sessions.forEach((s) => {
    let prevGameCount = s.startGameCount;
    s.wins.forEach((w) => {
      const interval = w.atGameCount - prevGameCount;
      if (interval >= 0) {
        if (!intervalsByModel[s.modelName]) intervalsByModel[s.modelName] = [];
        intervalsByModel[s.modelName].push(interval);
      }
      prevGameCount = w.atGameCount;
    });
  });

  const listEl = document.getElementById("hitIntervalList");
  listEl.innerHTML = "";

  const entries = Object.entries(intervalsByModel).map(([model, intervals]) => ({
    model,
    avg: intervals.reduce((sum, v) => sum + v, 0) / intervals.length,
    count: intervals.length,
  }));

  if (entries.length === 0) {
    listEl.innerHTML = `<p class="placeholder">この期間に当たりの記録がありません。</p>`;
    return;
  }

  // 平均ゲーム数が少ない(よく当たっている)順に並べる
  entries.sort((a, b) => a.avg - b.avg);

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "reg-item";
    li.innerHTML = `
      <div class="reg-item-main">
        <span class="reg-item-name">${entry.model}</span>
        <span class="reg-item-sub">当たり回数: ${entry.count}回</span>
      </div>
      <div class="reg-item-main" style="align-items: flex-end;">
        <span class="day-amount">平均${Math.round(entry.avg).toLocaleString()}G</span>
      </div>
    `;
    listEl.appendChild(li);
  });
}

// ------------------------------------------------------------
// 9. 起動時の初期描画
// ------------------------------------------------------------
renderOverview();
renderPachi();
