/* =========================================================
   CASINO ROYALE | app.js
   GitHub Pages + Google Apps Script + Google Sheets
========================================================= */
"use strict";

/* 1. API SETTINGS */

const API_URL =
  "https://script.google.com/macros/s/AKfycbyntM_IZhM0ywVJ0eq6fZkRH-RLHqS-J9dIWESpfBBQSPH1CYzq9ZCqbqENzfyvyW4rHg/exec";

const SESSION_KEY = "casinoRoyaleToken";
const GUEST_COINS_KEY = "casinoRoyaleGuestCoins";

/* 2. GAME SETTINGS */

const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34,
  6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26
];

const ROULETTE_RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36
]);

const SLOT_SYMBOLS = ["🍒", "🔔", "⭐", "🍋", "7️⃣"];

const SLOT_ANIMATION_DURATION = 1800;
const ROULETTE_ANIMATION_DURATION = 5200;

let token = localStorage.getItem(SESSION_KEY) || "";
let currentUser = null;

// ゲスト専用コイン。初回は10,000コイン。
let guestCoins = Number(localStorage.getItem(GUEST_COINS_KEY));

if (!Number.isSafeInteger(guestCoins) || guestCoins < 0) {
  guestCoins = 10000;
  localStorage.setItem(GUEST_COINS_KEY, String(guestCoins));
}

function saveGuestCoins() {
  localStorage.setItem(GUEST_COINS_KEY, String(guestCoins));
}

let rouletteWheelReady = false;
let rouletteWheelRotation = 0;
let rouletteIsSpinning = false;
let slotsIsSpinning = false;
let isPlaying = false;

/* 3. DOM HELPERS */

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? "";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[char];
  });
}

function formatCoins(value) {
  const number = Number(value ?? 0);

  return Number.isFinite(number)
    ? Math.floor(number).toLocaleString("ja-JP")
    : "0";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 4. NOTICE MESSAGE */

function showNotice(message, type = "info") {
  const notice = $("#notice");
  if (!notice) return;

  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.hidden = false;

  if (notice._hideTimer) {
    clearTimeout(notice._hideTimer);
  }

  notice._hideTimer = setTimeout(() => {
    notice.hidden = true;
  }, 5000);
}

/* 5. API REQUEST */

async function api(action, extra = {}) {
  const payload = {
    action,
    token,
    ...extra
  };

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
  } catch (error) {
    throw new Error(
      "サーバーに接続できませんでした。通信環境を確認してください。"
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      "サーバーから正しい応答を受信できませんでした。Apps Scriptの公開設定を確認してください。"
    );
  }

  if (!response.ok) {
    throw new Error(data.message || "通信に失敗しました。");
  }

  if (data.ok === false || data.success === false) {
    throw new Error(
      data.message || data.error || "処理に失敗しました。"
    );
  }

  return data;
}

/* 6. USER DATA */

function getUsername(user = currentUser) {
  if (!user) return "";

  return (
    user.username ??
    user.name ??
    user.displayName ??
    ""
  );
}

const GUEST_STARTING_COINS = 10000;

function getCoins(user = currentUser) {
  // ログインしていない場合はゲスト専用コインを使う
  if (!user) {
    if (!Number.isFinite(guestCoins) || guestCoins < 0) {
      guestCoins = GUEST_STARTING_COINS;
      saveGuestCoins();
    }

    return guestCoins;
  }

  return Number(
    user.coins ??
    user.balance ??
    user.points ??
    0
  );
}

function renderUser() {
  const loggedIn = Boolean(currentUser);

  const accountForm = $("#accountForm");
  if (accountForm) {
    accountForm.hidden = loggedIn;
  }

  const logoutButton = $("#logoutButton");
  if (logoutButton) {
    logoutButton.hidden = !loggedIn;
  }

  const username = loggedIn ? getUsername() : "ゲスト";
  const coins = getCoins();

  setText("#balance", formatCoins(coins));
  setText("#homeCoins", formatCoins(coins));

  const usernameDisplay = $("#profileInfo");

  if (usernameDisplay && !loggedIn) {
    usernameDisplay.textContent =
      "ゲストプレイ中です。ログインすると戦績を保存できます。";
  }

  $$("[data-username]").forEach((element) => {
    element.textContent = username;
  });

  $$("[data-coins]").forEach((element) => {
    element.textContent = formatCoins(coins);
  });

  document.body.classList.toggle("logged-in", loggedIn);
  document.body.classList.toggle("logged-out", !loggedIn);

  updateAuthControls();
}

function updateAuthControls() {
  const loggedIn = Boolean(currentUser);

  $$("[data-requires-login]").forEach((element) => {
    element.disabled = !loggedIn;
    element.classList.toggle("disabled", !loggedIn);
  });
}

/* 7. PAGE NAVIGATION */

function showPage(pageName) {
  if (
    ["ranking", "friends", "profile"].includes(pageName) &&
    !currentUser
  ) {
    showNotice(
      "この機能を利用するにはログインしてください。",
      "info"
    );
    pageName = "account";
  }

  const pageMap = {
    home: ["page-home", "lobby"],
    lobby: ["page-home", "lobby"],
    roulette: ["page-roulette", "roulette"],
    slots: ["page-slots", "slots"],
    ranking: ["page-ranking", "ranking"],
    friends: ["page-friends", "friends"],
    profile: ["page-profile", "profile"],
    account: ["page-account", "account"]
  };

  const possibleIds = pageMap[pageName] || [`page-${pageName}`];

  document.querySelectorAll(".page").forEach((page) => {
    const isTarget = possibleIds.includes(page.id);

    page.classList.toggle("active", isTarget);

    if (isTarget) {
      page.hidden = false;
      page.style.removeProperty("display");
    } else {
      page.hidden = true;
    }
  });

  document.querySelectorAll(".navbtn").forEach((button) => {
    const buttonPage = button.dataset.page;

    const isActive =
      buttonPage === pageName ||
      (pageName === "home" && buttonPage === "lobby") ||
      (pageName === "lobby" && buttonPage === "home");

    button.classList.toggle("active", isActive);
  });

  if (pageName === "ranking") loadRanking();
  if (pageName === "friends") loadFriends();
  if (pageName === "profile") loadHistory();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupNavigation() {
  $$(".navbtn").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      if (page) showPage(page);
    });
  });

  $$("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.goto;
      if (page) showPage(page);
    });
  });
}

/* 8. REGISTER / LOGIN */

async function handleAccountSubmit(event) {
  event.preventDefault();

  const submitButton = $("#accountSubmit");
  const usernameInput = $("#username");
  const passwordInput = $("#password");

  if (!usernameInput || !passwordInput) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showNotice(
      "ユーザー名とパスワードを入力してください。",
      "error"
    );
    return;
  }

  if (submitButton) submitButton.disabled = true;

  try {
    const action =
      submitButton?.dataset.action ||
      $("#accountForm")?.dataset.action ||
      "login";

    const data = await api(action, {
      username,
      password
    });

    if (data.token) {
      token = data.token;
      localStorage.setItem(SESSION_KEY, token);
    }

    currentUser =
      data.user ??
      data.account ??
      data.data?.user ??
      data.session?.user ??
      null;

    if (!currentUser && token) {
      const me = await api("me");

      currentUser =
        me.user ??
        me.account ??
        me.data?.user ??
        me.session?.user ??
        null;
    }

    if (!currentUser) {
      throw new Error("ユーザー情報を取得できませんでした。");
    }

    renderUser();
    passwordInput.value = "";

    showNotice(
      action === "register"
        ? "アカウントを作成しました！"
        : "ログインしました！",
      "success"
    );

    showPage("home");

  } catch (error) {
    showNotice(
      error.message || "アカウント処理に失敗しました。",
      "error"
    );

  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function logout() {
  try {
    if (token) {
      await api("logout");
    }
  } catch (error) {
    console.warn("Logout API error:", error);
  } finally {
    token = "";
    currentUser = null;

    localStorage.removeItem(SESSION_KEY);

    renderUser();
    showPage("home");
    showNotice("ログアウトしました。", "success");
  }
}

/* 9. SESSION RESTORE */

async function restoreSession() {
  if (!token) {
    currentUser = null;
    renderUser();
    return;
  }

  try {
    const data = await api("me");

    currentUser =
      data.user ??
      data.account ??
      data.data?.user ??
      data.session?.user ??
      null;

    if (!currentUser) {
      throw new Error("セッションが無効です。");
    }

    renderUser();

  } catch (error) {
    token = "";
    currentUser = null;

    localStorage.removeItem(SESSION_KEY);
    renderUser();

    console.warn("Session restore failed:", error.message);
  }
}

/* 10. PLAY COMMON */

function getBet(inputSelector) {
  const input = $(inputSelector);
  const bet = Number(input?.value);

  if (
    !Number.isFinite(bet) ||
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    throw new Error("ベット額は1以上の整数で入力してください。");
  }

  if (bet > getCoins()) {
    throw new Error("コインが足りません。");
  }

  return bet;
}

function setPlayButtonsDisabled(disabled) {
  const rouletteButton = $("#rouletteButton");
  const slotsButton = $("#slotsButton");

  if (rouletteButton) rouletteButton.disabled = disabled;
  if (slotsButton) slotsButton.disabled = disabled;
}

async function play(game) {
  if (isPlaying) return;

  if (!["roulette", "slots"].includes(game)) {
    showNotice("ゲームの指定が正しくありません。", "error");
    return;
  }

  const isRoulette = game === "roulette";
  const betSelector = isRoulette ? "#rouletteBet" : "#slotsBet";
  const buttonSelector = isRoulette ? "#rouletteButton" : "#slotsButton";

  let bet;

  try {
    bet = getBet(betSelector);
  } catch (error) {
    showNotice(error.message, "error");
    return;
  }

  const extra = { game, bet };

  if (isRoulette) {
    const choice = $("#rouletteChoice")?.value;

    if (!["red", "black", "green"].includes(choice)) {
      showNotice("賭ける色を選択してください。", "error");
      return;
    }

    extra.choice = choice;
  }

  isPlaying = true;
  setPlayButtonsDisabled(true);

  const button = $(buttonSelector);

  if (button) {
    button.dataset.originalText = button.textContent || "";
    button.textContent = isRoulette
      ? "ルーレット回転中..."
      : "スロット回転中...";
  }

  try {
    let result;

    if (currentUser && token) {
      // ログイン中はサーバーで結果と残高を確定。
      const data = await api("play", extra);

      result = data.result ?? data.data?.result;

      if (!result) {
        throw new Error("ゲーム結果を取得できませんでした。");
      }

      if (isRoulette) {
        await animateRoulette(result, bet);
      } else {
        await animateSlots(result, bet);
      }

      currentUser =
        data.user ??
        data.data?.user ??
        data.session?.user ??
        currentUser;

      renderUser();

      const gamesPlayed =
        currentUser?.gamesPlayed ??
        currentUser?.games;

      if (gamesPlayed != null) {
        setText("#homeGames", formatCoins(gamesPlayed));
      }

    } else {
      // ゲストはブラウザ内の仮想コインで遊ぶ。
      result = isRoulette
        ? createGuestRouletteResult(extra.choice, bet)
        : createGuestSlotsResult(bet);

      guestCoins -= bet;
      guestCoins += Number(result.payout || 0);

      saveGuestCoins();

      if (isRoulette) {
        await animateRoulette(result, bet);
      } else {
        await animateSlots(result, bet);
      }

      renderUser();
    }

    const message = result.message || "ゲームが終了しました。";

    showNotice(
      (currentUser ? "" : "【ゲスト】") + message,
      Number(result.payout ?? 0) > bet ? "success" : "info"
    );

  } catch (error) {
    showNotice(
      error.message || "ゲームの処理に失敗しました。",
      "error"
    );

  } finally {
    isPlaying = false;
    setPlayButtonsDisabled(false);

    if (button) {
      button.textContent =
        button.dataset.originalText ||
        (isRoulette ? "スピンする" : "スロットを回す");
    }
  }
}

function createGuestRouletteResult(choice, bet) {
  const number = Math.floor(Math.random() * 37);
  const color = rouletteColor(number);
  const won = choice === color;

  const payout = won
    ? bet * (choice === "green" ? 36 : 2)
    : 0;

  return {
    number,
    color,
    choice,
    won,
    payout,
    message: won
      ? "🎉 的中！おめでとうございます！"
      : "残念！次のチャンスを狙おう。"
  };
}

function createGuestSlotsResult(bet) {
  const symbols = SLOT_SYMBOLS.length
    ? SLOT_SYMBOLS
    : ["🍒", "🍋", "🔔"];

  const reels = Array.from(
    { length: 3 },
    () => symbols[Math.floor(Math.random() * symbols.length)]
  );

  let multiplier = 0;
  let message = "ハズレ！もう一度挑戦しよう。";

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    if (reels[0] === "7️⃣") {
      multiplier = 20;
      message = "👑 JACKPOT！トリプルセブン！";
    } else if (reels[0] === "⭐") {
      multiplier = 10;
      message = "🌟 STAR JACKPOT！";
    } else {
      multiplier = 5;
      message = "🎉 3つ揃い！";
    }
  } else {
    const counts = {};

    reels.forEach((symbol) => {
      counts[symbol] = (counts[symbol] || 0) + 1;
    });

    if (Object.values(counts).some((count) => count >= 2)) {
      multiplier = 2;
      message = "✨ 2つ揃い！";
    }
  }

  return {
    reels,
    multiplier,
    payout: bet * multiplier,
    message
  };
}

/* 11. ROULETTE COLORS */

function rouletteColor(number) {
  if (Number(number) === 0) return "green";

  return ROULETTE_RED_NUMBERS.has(Number(number))
    ? "red"
    : "black";
}

function rouletteColorJapanese(color) {
  const colors = {
    red: "RED",
    black: "BLACK",
    green: "GREEN"
  };

  return colors[color] || String(color || "").toUpperCase();
}

/* 12. ROULETTE WHEEL SETUP */

function setupRouletteWheel() {
  const roulettePage = $("#page-roulette");
  if (!roulettePage) return null;

  let wheel = roulettePage.querySelector(".wheel");

  if (!wheel) {
    wheel = $("#rouletteWheel");
  }

  if (!wheel) return null;

  let wrap = wheel.closest(".wheel-wrap");

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "wheel-wrap";

    wheel.parentNode.insertBefore(wrap, wheel);
    wrap.appendChild(wheel);
  }

  let pointer = wrap.querySelector(".roulette-pointer");

  if (!pointer) {
    pointer = document.createElement("div");
    pointer.className = "roulette-pointer";
    pointer.setAttribute("aria-hidden", "true");
    wrap.appendChild(pointer);
  }

  // 数字の二重表示を防いでから作り直す。
  wheel.querySelectorAll(".roulette-number").forEach((node) => {
    node.remove();
  });

  const segment = 360 / ROULETTE_NUMBERS.length;

  const stops = ROULETTE_NUMBERS.map((number, index) => {
    const start = index * segment;
    const end = (index + 1) * segment;

    const color = rouletteColor(number);

    const colorCode =
      color === "red"
        ? "#a51d2d"
        : color === "black"
          ? "#161616"
          : "#08764d";

    return `${colorCode} ${start}deg ${end}deg`;
  });

  wheel.style.background =
    `conic-gradient(from ${-segment / 2}deg, ${stops.join(",")})`;

  wheel.style.position = "relative";
  wheel.style.borderRadius = "50%";
  wheel.style.overflow = "hidden";
  wheel.style.willChange = "transform";

  const rect = wheel.getBoundingClientRect();
  const size = rect.width || wheel.clientWidth || 270;
  const radius = size * 0.405;

  ROULETTE_NUMBERS.forEach((number, index) => {
    const label = document.createElement("span");

    label.className = "roulette-number";
    label.textContent = String(number);

    const angle = index * segment;

    label.style.transform =
      `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`;

    label.style.position = "absolute";
    label.style.left = "50%";
    label.style.top = "50%";
    label.style.zIndex = "1";
    label.style.pointerEvents = "none";

    wheel.appendChild(label);
  });

  let center = wrap.querySelector(".wheel-center");

  if (!center) {
    center = wheel.querySelector(".wheel-center");
  }

  if (center) {
    center.style.position = "absolute";
    center.style.left = "50%";
    center.style.top = "50%";
    center.style.transform = "translate(-50%, -50%)";
    center.style.zIndex = "2";
  }

  wheel.style.transform = `rotate(${rouletteWheelRotation}deg)`;

  rouletteWheelReady = true;

  return wheel;
}

/* 13. ROULETTE ANIMATION */

async function animateRoulette(result, bet) {
  if (rouletteIsSpinning) return;

  rouletteIsSpinning = true;

  try {
    const wheel = setupRouletteWheel();

    if (!wheel) {
      showRouletteResult(result, bet);
      return;
    }

    const winningNumber = Number(result.number);
    const winningIndex = ROULETTE_NUMBERS.indexOf(winningNumber);

    if (winningIndex < 0) {
      showRouletteResult(result, bet);
      return;
    }

    const segment = 360 / ROULETTE_NUMBERS.length;
    const targetAngle = -(winningIndex * segment);

    const normalizedTarget =
      ((targetAngle % 360) + 360) % 360;

    const currentNormalized =
      ((rouletteWheelRotation % 360) + 360) % 360;

    const additionalRotation =
      (normalizedTarget - currentNormalized + 360) % 360;

    const totalRotation =
      rouletteWheelRotation +
      360 * 7 +
      additionalRotation;

    wheel.style.transition = "none";
    wheel.style.transform = `rotate(${rouletteWheelRotation}deg)`;

    // 初期位置を描画してから回転させる。
    void wheel.offsetWidth;

    wheel.style.transition =
      `transform ${ROULETTE_ANIMATION_DURATION - 200}ms cubic-bezier(0.12, 0.78, 0.12, 1)`;

    wheel.style.transform = `rotate(${totalRotation}deg)`;

    rouletteWheelRotation = totalRotation;

    await sleep(ROULETTE_ANIMATION_DURATION);

    wheel.style.transition = "none";

    showRouletteResult(result, bet);

  } finally {
    rouletteIsSpinning = false;
  }
}

/* 14. ROULETTE RESULT */

function showRouletteResult(result, bet) {
  const number = Number(result.number);
  const color = rouletteColor(number);
  const payout = Number(result.payout ?? 0);
  const net = payout - Number(bet);

  const wheelResult = $("#wheelResult");

  if (wheelResult) {
    wheelResult.textContent = String(number);
    wheelResult.dataset.color = color;
  }

  const wheelColor = $("#wheelColor");

  if (wheelColor) {
    wheelColor.textContent = rouletteColorJapanese(color);
    wheelColor.dataset.color = color;
  }

  const resultArea = $("#rouletteResult");

  if (resultArea) {
    resultArea.innerHTML = `
      <div class="result-number result-${escapeHTML(color)}">
        ${escapeHTML(number)}
      </div>
      <div class="result-color">
        ${escapeHTML(rouletteColorJapanese(color))}
      </div>
      <div class="result-message">
        ${escapeHTML(result.message || "結果が確定しました。")}
      </div>
      <div class="result-payout">
        払い戻し：<strong>${formatCoins(payout)}</strong> コイン
      </div>
      <div class="result-net ${net >= 0 ? "profit" : "loss"}">
        ${net >= 0 ? "+" : ""}${formatCoins(net)} コイン
      </div>
    `;

    resultArea.classList.remove("result-pop");
    void resultArea.offsetWidth;
    resultArea.classList.add("result-pop");
  }
}

/* 15. SLOTS ANIMATION */

async function animateSlots(result, bet) {
  if (slotsIsSpinning) return;

  slotsIsSpinning = true;

  try {
    const reels = Array.isArray(result.reels)
      ? result.reels
      : ["🍒", "🍋", "⭐"];

    const reelElements = [
      $("#reel0"),
      $("#reel1"),
      $("#reel2")
    ];

    const slotSymbols = SLOT_SYMBOLS;

    reelElements.forEach((reel, index) => {
      if (!reel) return;

      reel.classList.remove("slot-stop", "slot-win");
      reel.classList.add("slot-spinning");

      reel.textContent = slotSymbols[index % slotSymbols.length];
    });

    for (let index = 0; index < reelElements.length; index++) {
      const reel = reelElements[index];

      if (!reel) continue;

      const interval = setInterval(() => {
        reel.textContent =
          slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
      }, 80);

      await sleep(700 + index * 400);

      clearInterval(interval);

      reel.textContent = String(reels[index] ?? "❔");
      reel.classList.remove("slot-spinning");
      reel.classList.add("slot-stop");

      await sleep(180);
    }

    const payout = Number(result.payout ?? 0);
    const isWin = payout > Number(bet);

    if (isWin) {
      reelElements.forEach((reel) => {
        if (reel) reel.classList.add("slot-win");
      });
    }

    const resultArea = $("#slotsResult");

    if (resultArea) {
      const net = payout - Number(bet);

      resultArea.innerHTML = `
        <div class="slots-result-message">
          ${escapeHTML(result.message || "スロットの結果")}
        </div>
        <div class="slots-result-payout">
          払い戻し：<strong>${formatCoins(payout)}</strong> コイン
        </div>
        <div class="slots-result-net ${net >= 0 ? "profit" : "loss"}">
          ${net >= 0 ? "+" : ""}${formatCoins(net)} コイン
        </div>
      `;

      resultArea.classList.remove("result-pop");
      void resultArea.offsetWidth;
      resultArea.classList.add("result-pop");
    }

    await sleep(250);

  } finally {
    $$(".slot-spinning").forEach((reel) => {
      reel.classList.remove("slot-spinning");
    });

    slotsIsSpinning = false;
  }
}

/* 16. RANKING */

async function loadRanking() {
  const list = $("#rankingList");
  if (!list) return;

  if (!currentUser) {
    list.innerHTML = "<p>ランキングを見るにはログインしてください。</p>";
    return;
  }

  list.innerHTML = "<p>ランキングを読み込み中...</p>";

  try {
    const data = await api("ranking");

    const ranking =
      data.ranking ??
      data.users ??
      data.data?.ranking ??
      [];

    if (!Array.isArray(ranking) || ranking.length === 0) {
      list.innerHTML = "<p>ランキングデータがありません。</p>";
      return;
    }

    list.innerHTML = ranking.map((user, index) => {
      const name = user.username ?? user.name ?? "プレイヤー";
      const coins = user.coins ?? user.balance ?? 0;

      const rankClass =
        index === 0 ? "rank-first" :
        index === 1 ? "rank-second" :
        index === 2 ? "rank-third" : "";

      return `
        <div class="ranking-item ${rankClass}">
          <div class="ranking-position">${index + 1}</div>
          <div class="ranking-name">${escapeHTML(name)}</div>
          <div class="ranking-coins">${formatCoins(coins)} COINS</div>
        </div>
      `;
    }).join("");

  } catch (error) {
    list.innerHTML = `
      <p class="error-message">
        ${escapeHTML(error.message || "ランキングを取得できませんでした。")}
      </p>
    `;
  }
}

/* 17. FRIEND SEARCH */

async function searchFriends() {
  const input = $("#friendQuery");
  const results = $("#friendSearchResults");

  if (!currentUser) {
    showNotice("フレンド機能を利用するにはログインしてください。", "error");
    return;
  }

  if (!input || !results) return;

  const query = input.value.trim();

  if (!query) {
    showNotice("検索するユーザー名を入力してください。", "error");
    return;
  }

  results.innerHTML = "<p>検索中...</p>";

  try {
    const data = await api("friendSearch", { query });

    const users =
      data.users ??
      data.results ??
      data.data?.users ??
      [];

    if (!Array.isArray(users) || users.length === 0) {
      results.innerHTML = "<p>ユーザーが見つかりませんでした。</p>";
      return;
    }

    results.innerHTML = users.map((user) => {
      const name = user.username ?? user.name ?? "プレイヤー";
      const id = user.username ?? user.name ?? "";

      return `
        <div class="friend-item">
          <div class="friend-name">${escapeHTML(name)}</div>
          <button
            type="button"
            class="friend-request-button"
            data-friend-request="${escapeHTML(id)}"
          >
            フレンド申請
          </button>
        </div>
      `;
    }).join("");

  } catch (error) {
    results.innerHTML = `
      <p class="error-message">${escapeHTML(error.message)}</p>
    `;
  }
}

async function sendFriendRequest(username) {
  if (!currentUser) {
    showNotice("ログインしてください。", "error");
    return;
  }

  if (!username) return;

  try {
    await api("friendRequest", { username });

    showNotice(
      `${username} にフレンド申請を送りました。`,
      "success"
    );

    await loadFriends();

  } catch (error) {
    showNotice(
      error.message || "フレンド申請に失敗しました。",
      "error"
    );
  }
}

/* 18. FRIEND LIST / REQUESTS */

async function loadFriends() {
  const requestsElement = $("#incomingRequests");
  const friendsElement = $("#friendsList");

  if (!requestsElement && !friendsElement) return;

  if (!currentUser) {
    if (requestsElement) {
      requestsElement.innerHTML = "<p>ログインしてください。</p>";
    }

    if (friendsElement) {
      friendsElement.innerHTML = "<p>ログインしてください。</p>";
    }

    return;
  }

  try {
    const data = await api("friends");

    const requests =
      data.requests ??
      data.incomingRequests ??
      data.data?.requests ??
      [];

    const friends =
      data.friends ??
      data.data?.friends ??
      [];

    if (requestsElement) {
      if (!Array.isArray(requests) || requests.length === 0) {
        requestsElement.innerHTML = "<p>新しい申請はありません。</p>";
      } else {
        requestsElement.innerHTML = requests.map((request) => {
          const name =
            request.username ??
            request.from ??
            request.name ??
            "プレイヤー";

          return `
            <div class="friend-item">
              <span>${escapeHTML(name)}</span>
              <div class="friend-actions">
                <button
                  type="button"
                  data-friend-respond="accept"
                  data-friend-name="${escapeHTML(name)}"
                >承認</button>
                <button
                  type="button"
                  data-friend-respond="reject"
                  data-friend-name="${escapeHTML(name)}"
                >拒否</button>
              </div>
            </div>
          `;
        }).join("");
      }
    }

    if (friendsElement) {
      if (!Array.isArray(friends) || friends.length === 0) {
        friendsElement.innerHTML = "<p>フレンドがまだいません。</p>";
      } else {
        friendsElement.innerHTML = friends.map((friend) => {
          const name =
            friend.username ??
            friend.name ??
            friend.friend ??
            "プレイヤー";

          return `
            <div class="friend-item">
              <span class="friend-name">${escapeHTML(name)}</span>
            </div>
          `;
        }).join("");
      }
    }

    updateTransferFriendOptions(friends);

  } catch (error) {
    if (requestsElement) {
      requestsElement.innerHTML =
        `<p class="error-message">${escapeHTML(error.message)}</p>`;
    }

    if (friendsElement) {
      friendsElement.innerHTML =
        `<p class="error-message">${escapeHTML(error.message)}</p>`;
    }
  }
}

async function respondFriendRequest(username, response) {
  if (!currentUser) {
    showNotice("ログインしてください。", "error");
    return;
  }

  try {
    await api("friendRespond", {
      username,
      response
    });

    showNotice(
      response === "accept"
        ? "フレンド申請を承認しました。"
        : "フレンド申請を拒否しました。",
      "success"
    );

    await loadFriends();

  } catch (error) {
    showNotice(
      error.message || "申請を処理できませんでした。",
      "error"
    );
  }
}

function updateTransferFriendOptions(friends) {
  const select = $("#transferTarget");

  if (!select || !Array.isArray(friends)) return;

  const selected = select.value;

  select.innerHTML = '<option value="">送金先を選択</option>';

  friends.forEach((friend) => {
    const name =
      friend.username ??
      friend.name ??
      friend.friend ??
      "";

    if (!name) return;

    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;

    select.appendChild(option);
  });

  if (selected) select.value = selected;
}

/* 19. COIN TRANSFER */

async function transferCoins() {
  if (!currentUser) {
    showNotice("ログインしてください。", "error");
    return;
  }

  const target = $("#transferTarget")?.value;
  const amount = Number($("#transferAmount")?.value);

  if (!target) {
    showNotice("送金先を選択してください。", "error");
    return;
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    showNotice("送金額は1以上の整数で入力してください。", "error");
    return;
  }

  if (amount > getCoins()) {
    showNotice("コインが足りません。", "error");
    return;
  }

  try {
    const data = await api("transfer", {
      username: target,
      amount
    });

    currentUser =
      data.user ??
      data.data?.user ??
      currentUser;

    renderUser();

    const amountInput = $("#transferAmount");
    if (amountInput) amountInput.value = "";

    showNotice(
      `${target} に ${formatCoins(amount)} コインを送金しました。`,
      "success"
    );

    await loadHistory();

  } catch (error) {
    showNotice(
      error.message || "送金に失敗しました。",
      "error"
    );
  }
}

/* 20. PLAY HISTORY */

async function loadHistory() {
  const list = $("#historyList");
  if (!list) return;

  if (!currentUser) {
    list.innerHTML = "<p>履歴を見るにはログインしてください。</p>";
    return;
  }

  list.innerHTML = "<p>履歴を読み込み中...</p>";

  try {
    const data = await api("history");

    const history =
      data.history ??
      data.records ??
      data.data?.history ??
      [];

    if (!Array.isArray(history) || history.length === 0) {
      list.innerHTML = "<p>まだ履歴がありません。</p>";
      return;
    }

    list.innerHTML = history.map((item) => {
      const game = item.game ?? item.type ?? "履歴";

      const amount = Number(
        item.payout ??
        item.amount ??
        item.change ??
        0
      );

      const dateValue =
        item.createdAt ??
        item.timestamp ??
        item.date ??
        "";

      let dateText = String(dateValue);

      if (dateValue) {
        const date = new Date(dateValue);

        if (!Number.isNaN(date.getTime())) {
          dateText = date.toLocaleString("ja-JP");
        }
      }

      return `
        <div class="history-item">
          <div class="history-main">
            <span class="history-game">${escapeHTML(game)}</span>
            <span class="history-date">${escapeHTML(dateText)}</span>
          </div>
          <div class="history-amount ${amount >= 0 ? "profit" : "loss"}">
            ${amount >= 0 ? "+" : ""}${formatCoins(amount)}
          </div>
        </div>
      `;
    }).join("");

  } catch (error) {
    list.innerHTML = `
      <p class="error-message">${escapeHTML(error.message)}</p>
    `;
  }
}

/* 21. EVENT LISTENERS */

function setupEventListeners() {
  const accountForm = document.querySelector("#accountForm");

  if (accountForm && accountForm.dataset.bound !== "true") {
    accountForm.dataset.bound = "true";
    accountForm.addEventListener("submit", handleAccountSubmit);
  }

  // HTML側の onclick を使うため、ゲームボタンには
  // addEventListener を追加しない。

  const friendSearchButton = document.querySelector("#friendSearchButton");

  if (friendSearchButton && friendSearchButton.dataset.bound !== "true") {
    friendSearchButton.dataset.bound = "true";
    friendSearchButton.addEventListener("click", searchFriends);
  }

  const friendQuery = document.querySelector("#friendQuery");

  if (friendQuery && friendQuery.dataset.bound !== "true") {
    friendQuery.dataset.bound = "true";

    friendQuery.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchFriends();
      }
    });
  }

  const transferButton = document.querySelector("#transferButton");

  if (transferButton && transferButton.dataset.bound !== "true") {
    transferButton.dataset.bound = "true";
    transferButton.addEventListener("click", transferCoins);
  }

  if (document.documentElement.dataset.friendEventsBound !== "true") {
    document.documentElement.dataset.friendEventsBound = "true";

    document.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const requestButton = target.closest("[data-friend-request]");

      if (requestButton) {
        sendFriendRequest(requestButton.dataset.friendRequest);
        return;
      }

      const respondButton = target.closest("[data-friend-respond]");

      if (respondButton) {
        respondFriendRequest(
          respondButton.dataset.friendName,
          respondButton.dataset.friendRespond
        );
      }
    });
  }
}

/* 22. INITIALIZATION */

async function initCasinoRoyale() {
  setupNavigation();
  setupEventListeners();

  // ルーレットの数字とポインターを初期化。
  setupRouletteWheel();

  // 保存済みのログイン状態を復元する。
  await restoreSession();

  if (currentUser) {
    renderUser();
  }

  // 最初のページが指定されていなければホームへ。
  const activePage = $(".page.active");

  if (!activePage) {
    showPage("home");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCasinoRoyale);
} else {
  initCasinoRoyale();
}

/* 23. PAGE DISPLAY FIX */

// HTMLの onclick="go('roulette')" などに対応。
function go(pageName) {
  if (
    ["ranking", "friends", "profile"].includes(pageName) &&
    !currentUser
  ) {
    showNotice(
      "この機能を利用するにはログインしてください。",
      "info"
    );
    pageName = "account";
  }

  const pageMap = {
    home: "page-home",
    lobby: "page-home",
    roulette: "page-roulette",
    slots: "page-slots",
    ranking: "page-ranking",
    friends: "page-friends",
    profile: "page-profile",
    account: "page-account"
  };

  const targetId = pageMap[pageName];

  if (!targetId) {
    console.warn("Unknown page:", pageName);
    return;
  }

  document.querySelectorAll(".page").forEach((page) => {
    const isTarget = page.id === targetId;

    page.classList.toggle("active", isTarget);
    page.classList.toggle("hidden", !isTarget);
    page.hidden = !isTarget;

    if (isTarget) {
      page.style.removeProperty("display");
    }
  });

  document.querySelectorAll(".navbtn").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName
    );
  });

  if (pageName === "ranking") loadRanking();
  if (pageName === "friends") loadFriends();
  if (pageName === "profile") loadHistory();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// アカウント画面のログイン・新規登録切り替え。
function accountMode(mode) {
  const form = document.getElementById("accountForm");
  const submitButton = document.getElementById("accountSubmit");
  const password = document.getElementById("password");

  if (!form || !submitButton) return;

  const isRegister = mode === "register";

  form.dataset.action = isRegister ? "register" : "login";
  submitButton.dataset.action = isRegister ? "register" : "login";

  submitButton.textContent = isRegister
    ? "アカウント作成"
    : "ログイン";

  if (password) {
    password.autocomplete = isRegister
      ? "new-password"
      : "current-password";
  }

  document.querySelectorAll(".tabs button").forEach((button) => {
    const onclickText = button.getAttribute("onclick") || "";

    if (onclickText.includes("accountMode")) {
      const active = onclickText.includes(`'${mode}'`);

      button.classList.toggle("secondary", !active);
    }
  });
}

// HTML側のナビゲーションボタンを確実に接続。
document.querySelectorAll(".navbtn").forEach((button) => {
  button.onclick = () => go(button.dataset.page);
});

// 初期表示をLOBBYに固定。
document.addEventListener("DOMContentLoaded", () => {
  go("home");
});
