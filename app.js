/* =========================================
   CASINO ROYALE
   Frontend Application
   Roulette & Slot Spin Animation
========================================= */

/* Apps ScriptのウェブアプリURL */
const API_URL = "https://script.google.com/macros/s/AKfycbyntM_IZhM0ywVJ0eq6fZkRH-RLHqS-J9dIWESpfBBQSPH1CYzq9ZCqbqENzfyvyW4rHg/exec";

let token = localStorage.getItem("cr_token") || "";
let currentUser = null;
let accountAction = "login";
let currentRanking = "wealth";
let busy = false;

let wheelRotation = 0;
let slotAnimationId = 0;

const $ = id => document.getElementById(id);

const fmt = value =>
  Number(value || 0).toLocaleString("ja-JP");

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

/* ---------- UI ---------- */

function message(text, error = false) {
  const box = $("notice");

  if (!box) return;

  box.textContent = text;
  box.classList.toggle("error", error);
}

function go(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.classList.add("hidden");
  });

  const target = $("page-" + page);

  if (!target) return;

  target.classList.remove("hidden");

  document.querySelectorAll(".navbtn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  if (page === "ranking") loadRanking(currentRanking);
  if (page === "friends") loadFriends();
  if (page === "profile") loadProfile();
  if (page === "account") syncAccountUI();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll(".navbtn").forEach(button => {
  button.addEventListener("click", () => {
    go(button.dataset.page);
  });
});

/* ---------- API ---------- */

async function api(action, extra = {}) {
  if (!API_URL.startsWith("https://script.google.com/")) {
    throw new Error(
      "app.jsのAPI_URLをApps ScriptのウェブアプリURLに設定してください。"
    );
  }

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action,
        token,
        ...extra
      })
    });
  } catch (error) {
    throw new Error(
      "サーバーに接続できません。Apps ScriptのURLと公開設定を確認してください。"
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      "APIの応答を読み取れません。Apps Scriptのデプロイを確認してください。"
    );
  }

  if (!data.ok) {
    throw new Error(data.error || "処理に失敗しました。");
  }

  return data;
}

/* ---------- Account ---------- */

function accountMode(mode) {
  accountAction = mode;

  $("accountSubmit").textContent =
    mode === "login"
      ? "ログイン"
      : "アカウントを作成";

  $("password").autocomplete =
    mode === "login"
      ? "current-password"
      : "new-password";
}

$("accountForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("accountSubmit");

  button.disabled = true;

  try {
    const data = await api(accountAction, {
      username: $("username").value.trim(),
      password: $("password").value
    });

    token = data.session.token;
    currentUser = data.session.user;

    localStorage.setItem("cr_token", token);

    $("password").value = "";

    renderUser();

    message(
      accountAction === "login"
        ? "ログインしました。"
        : "登録完了！10,000コインを獲得しました。"
    );

    go("home");
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function syncAccountUI() {
  $("logoutButton").classList.toggle(
    "hidden",
    !token
  );
}

async function logout() {
  try {
    if (token) {
      await api("logout");
    }
  } catch (error) {
    // 接続できなくても端末側のログイン情報を破棄
  }

  token = "";
  currentUser = null;

  localStorage.removeItem("cr_token");

  renderUser();
  syncAccountUI();

  message("ログアウトしました。");

  go("home");
}

function renderUser() {
  const loggedIn = !!currentUser;

  $("balance").textContent = loggedIn
    ? fmt(currentUser.coins) + " COINS"
    : "GUEST";

  $("homeCoins").textContent = loggedIn
    ? fmt(currentUser.coins)
    : "---";

  $("homeGames").textContent = loggedIn
    ? fmt(currentUser.games)
    : "---";

  $("logoutButton").classList.toggle(
    "hidden",
    !token
  );
}

async function refreshMe() {
  if (!token) {
    renderUser();
    return;
  }

  try {
    const data = await api("me");

    currentUser = data.user;

    renderUser();
  } catch (error) {
    // 通信エラーだけでセッションを勝手に破棄しない
    message(error.message, true);
    renderUser();
  }
}

/* ---------- Games ---------- */

async function play(game) {
  if (busy) return;

  if (!token) {
    message(
      "プレイするにはアカウント登録・ログインが必要です。",
      true
    );

    go("account");
    return;
  }

  const betInput = $(
    game === "roulette"
      ? "rouletteBet"
      : "slotsBet"
  );

  const bet = Number(betInput.value);

  if (
    !Number.isInteger(bet) ||
    bet < 10 ||
    bet > 10000
  ) {
    message(
      "賭けコインは10〜10,000枚の整数で入力してください。",
      true
    );
    return;
  }

  const extra = {
    game,
    bet
  };

  if (game === "roulette") {
    extra.choice = $("rouletteChoice").value;
  }

  const button = $(
    game === "roulette"
      ? "rouletteButton"
      : "slotsButton"
  );

  const originalText = button.textContent;

  busy = true;

  button.disabled = true;
  button.textContent =
    game === "roulette"
      ? "SPINNING..."
      : "SPINNING...";

  try {
    // サーバーでゲーム結果を確定
    message("ゲームの準備中...");

    const data = await api("play", extra);

    if (!data.result || !data.user) {
      throw new Error(
        "ゲーム結果を正しく取得できませんでした。"
      );
    }

    // 残高はサーバーから返された値を使用
    currentUser = data.user;
    renderUser();

    // 結果に合わせて回転演出
    if (game === "roulette") {
      await animateRoulette(data.result, bet);
    } else {
      await animateSlots(data.result, bet);
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = originalText;
  }
}

/* ---------- Roulette Animation ---------- */

async function animateRoulette(result, bet) {
  const wheel = document.querySelector(
    "#page-roulette .wheel"
  );

  if (!wheel) {
    showRouletteResult(result, bet);
    return;
  }

  const resultPanel = $("rouletteResult");

  resultPanel.textContent = "";

  $("wheelResult").textContent = "★";
  $("wheelColor").textContent = "SPINNING";

  message("ルーレットが回転中...");

  // 前回の角度を維持しながら回転を追加
  const startRotation = wheelRotation;

  const extraRotation =
    360 * 7 + Math.random() * 360;

  wheelRotation = startRotation + extraRotation;

  // 現在位置に固定してからアニメーション開始
  wheel.style.transition = "none";
  wheel.style.transform =
    `rotate(${startRotation}deg)`;

  void wheel.offsetWidth;

  wheel.style.transition =
    "transform 4.5s cubic-bezier(.10,.68,.12,1)";

  wheel.style.transform =
    `rotate(${wheelRotation}deg)`;

  await sleep(4700);

  showRouletteResult(result, bet);
}

/* ---------- Roulette Result ---------- */

function showRouletteResult(result, bet) {
  $("wheelResult").textContent = result.number;

  $("wheelColor").textContent =
    String(result.color || "").toUpperCase();

  const net = Number(result.payout) - bet;

  $("rouletteResult").textContent =
    result.message +
    " — " +
    fmt(result.payout) +
    "コイン返還 / " +
    (net >= 0 ? "+" : "") +
    fmt(net) +
    "コイン";

  message(
    "ルーレットの結果：" +
    result.number +
    " / " +
    result.color
  );
}

/* ---------- Slot Animation ---------- */

async function animateSlots(result, bet) {
  const reels = [
    $("reel0"),
    $("reel1"),
    $("reel2")
  ];

  const symbols = [
    "🍒",
    "🔔",
    "⭐",
    "🍋",
    "7️⃣"
  ];

  if (
    !Array.isArray(result.reels) ||
    result.reels.length !== 3 ||
    reels.some(reel => !reel)
  ) {
    showSlotsResult(result, bet);
    return;
  }

  // この演出の識別番号
  const animationId = ++slotAnimationId;

  $("slotsResult").textContent = "";

  message("スロットが回転中...");

  reels.forEach(reel => {
    reel.classList.remove("reel-stopped");
    reel.classList.add("spinning");
  });

  // 左・中央・右の順にリールを停止
  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];

    const duration = 1400 + i * 650;
    const interval = 65;
    const startTime = Date.now();

    while (Date.now() - startTime < duration) {
      if (animationId !== slotAnimationId) {
        return;
      }

      reel.textContent =
        symbols[
          Math.floor(Math.random() * symbols.length)
        ];

      await sleep(interval);
    }

    if (animationId !== slotAnimationId) {
      return;
    }

    // 最後は必ずサーバーの確定結果に合わせる
    reel.textContent = result.reels[i];

    reel.classList.remove("spinning");
    reel.classList.add("reel-stopped");

    await sleep(220);

    reel.classList.remove("reel-stopped");
  }

  await sleep(250);

  showSlotsResult(result, bet);
}

/* ---------- Slot Result ---------- */

function showSlotsResult(result, bet) {
  result.reels.forEach((symbol, index) => {
    const reel = $("reel" + index);

    if (!reel) return;

    reel.textContent = symbol;

    reel.classList.remove("spinning");
    reel.classList.remove("reel-stopped");
  });

  const net = Number(result.payout) - bet;

  $("slotsResult").textContent =
    result.message +
    " — " +
    fmt(result.payout) +
    "コイン返還 / " +
    (net >= 0 ? "+" : "") +
    fmt(net) +
    "コイン";

  message("スロットの結果：" + result.message);
}

/* ---------- Ranking ---------- */

async function loadRanking(mode) {
  currentRanking = mode;

  $("rankingList").innerHTML =
    '<p class="muted">ランキングを読み込み中...</p>';

  try {
    const data = await api("ranking", { mode });

    if (!data.ranking.length) {
      $("rankingList").innerHTML =
        '<p class="muted">まだランキングデータがありません。</p>';
      return;
    }

    $("rankingList").innerHTML =
      data.ranking.map((user, index) => `
        <div class="rankrow">
          <div class="ranknum">${index + 1}</div>
          <div>
            <strong>${esc(user.username)}</strong>
            <div class="muted">
              ${index === 0 ? "ROYAL CHAMPION" : "PLAYER"}
            </div>
          </div>
          <strong class="gold">${fmt(user.score)}</strong>
        </div>
      `).join("");
  } catch (error) {
    $("rankingList").textContent = error.message;
  }
}

/* ---------- Friends ---------- */

async function searchFriends() {
  if (!token) {
    message("フレンド機能にはログインが必要です。", true);
    return;
  }

  try {
    const data = await api("friendSearch", {
      query: $("friendQuery").value.trim()
    });

    if (!data.users.length) {
      $("friendSearchResults").innerHTML =
        '<p class="muted">ユーザーが見つかりません。</p>';
      return;
    }

    $("friendSearchResults").innerHTML =
      data.users.map(user => `
        <div class="rankrow">
          <div>♟</div>
          <div>${esc(user.username)}</div>
          <button
            class="btn small"
            data-friend-request="${esc(user.id)}"
          >申請</button>
        </div>
      `).join("");

    $("friendSearchResults")
      .querySelectorAll("[data-friend-request]")
      .forEach(button => {
        button.addEventListener("click", () => {
          sendRequest(button.dataset.friendRequest);
        });
      });
  } catch (error) {
    message(error.message, true);
  }
}

async function sendRequest(targetId) {
  try {
    const data = await api("friendRequest", {
      targetId
    });

    message(data.message);

    await loadFriends();
  } catch (error) {
    message(error.message, true);
  }
}

async function loadFriends() {
  if (!token) {
    $("incomingRequests").innerHTML =
      '<p class="muted">ログインしてください。</p>';

    $("friendsList").innerHTML = "";

    $("transferTarget").innerHTML =
      '<option value="">フレンドを選択</option>';

    return;
  }

  try {
    const data = await api("friends");

    $("incomingRequests").innerHTML =
      data.incoming.length
        ? data.incoming.map(request => `
            <div class="rankrow">
              <div>✉</div>
              <div>${esc(request.username)}</div>
              <div class="actions">
                <button
                  class="btn small"
                  data-request-id="${esc(request.id)}"
                  data-accept="true"
                >承認</button>

                <button
                  class="btn secondary small"
                  data-request-id="${esc(request.id)}"
                  data-accept="false"
                >拒否</button>
              </div>
            </div>
          `).join("")
        : '<p class="muted">新しい申請はありません。</p>';

    $("incomingRequests")
      .querySelectorAll("[data-request-id]")
      .forEach(button => {
        button.addEventListener("click", () => {
          respondRequest(
            button.dataset.requestId,
            button.dataset.accept === "true"
          );
        });
      });

    $("friendsList").innerHTML =
      data.friends.length
        ? data.friends.map(friend => `
            <div class="rankrow">
              <div>♟</div>
              <div>${esc(friend.username)}</div>
              <span class="gold">FRIEND</span>
            </div>
          `).join("")
        : '<p class="muted">フレンドはまだいません。</p>';

    $("transferTarget").innerHTML =
      '<option value="">フレンドを選択</option>' +
      data.friends.map(friend => `
        <option value="${esc(friend.id)}">
          ${esc(friend.username)}
        </option>
      `).join("");
  } catch (error) {
    message(error.message, true);
  }
}

async function respondRequest(requestId, accept) {
  try {
    await api("friendRespond", {
      requestId,
      accept
    });

    message(
      accept
        ? "フレンド申請を承認しました。"
        : "フレンド申請を拒否しました。"
    );

    await loadFriends();
  } catch (error) {
    message(error.message, true);
  }
}

async function transferCoins() {
  const targetId = $("transferTarget").value;
  const amount = Number($("transferAmount").value);

  if (!targetId) {
    message("送付先のフレンドを選択してください。", true);
    return;
  }

  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 50000
  ) {
    message("送付額は1〜50,000枚の整数で入力してください。", true);
    return;
  }

  if (!confirm(fmt(amount) + "コインを送付しますか？")) {
    return;
  }

  try {
    const data = await api("transfer", {
      targetId,
      amount
    });

    currentUser = data.user;

    renderUser();

    message(data.message);
  } catch (error) {
    message(error.message, true);
  }
}

/* ---------- Profile & History ---------- */

async function loadProfile() {
  if (!token) {
    $("profileInfo").innerHTML =
      '<p class="muted">ログインしてください。</p>';

    $("historyList").innerHTML = "";

    return;
  }

  try {
    const [me, historyData] = await Promise.all([
      api("me"),
      api("history")
    ]);

    currentUser = me.user;

    renderUser();

    const user = me.user;

    $("profileInfo").innerHTML = `
      <h3>${esc(user.username)}</h3>

      <div class="grid">
        <div class="stat">
          <small>所持コイン</small>
          <strong>${fmt(user.coins)}</strong>
        </div>

        <div class="stat">
          <small>プレイ回数</small>
          <strong>${fmt(user.games)}</strong>
        </div>

        <div class="stat">
          <small>総賭け金</small>
          <strong>${fmt(user.totalBet)}</strong>
        </div>

        <div class="stat">
          <small>総返還額</small>
          <strong>${fmt(user.totalPayout)}</strong>
        </div>
      </div>
    `;

    const history = historyData.history;

    if (!history.length) {
      $("historyList").innerHTML =
        '<p class="muted">まだプレイ履歴がありません。</p>';

      return;
    }

    $("historyList").innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>日時</th>
              <th>ゲーム</th>
              <th>賭け</th>
              <th>返還</th>
              <th>収支</th>
            </tr>
          </thead>

          <tbody>
            ${history.map(item => `
              <tr>
                <td>
                  ${esc(
                    new Date(item.createdAt)
                      .toLocaleString("ja-JP")
                  )}
                </td>

                <td>
                  ${item.game === "roulette"
                    ? "ルーレット"
                    : "スロット"}
                </td>

                <td>${fmt(item.bet)}</td>
                <td>${fmt(item.payout)}</td>

                <td style="color:${
                  item.net >= 0 ? "#e6cc7d" : "#ef7777"
                }">
                  ${item.net > 0 ? "+" : ""}${fmt(item.net)}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    message(error.message, true);
  }
}

/* ---------- Security helper ---------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* ---------- Startup ---------- */

async function init() {
  accountMode("login");

  syncAccountUI();

  await refreshMe();
}

init();
