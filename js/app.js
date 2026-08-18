// ------------------------------------------------------------
// Service Workerの登録(前回から変更なし)
// ------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => console.log("Service Worker登録完了"))
      .catch((err) => console.error("Service Worker登録失敗", err));
  });
}

// ------------------------------------------------------------
// 最上位タブ(収支入力 / 収支分析 / 登録情報)の切り替え
// 登録情報タブ内のサブタブ切り替えは js/registration.js が担当する
// ------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetTab = btn.dataset.tab;

    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(`tab-${targetTab}`).classList.add("active");
  });
});
