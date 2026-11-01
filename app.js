// =====================================================
// 실시간 코인 시세 - 업비트 Open API (Quotation, 인증 불필요)
//  - 실시간 시세/체결: WebSocket  wss://api.upbit.com/websocket/v1
//  - 과거 1분봉 차트: REST (Vercel 서버리스 함수 /api/candles 경유)
// =====================================================

const COINS = [
  { code: "KRW-BTC", name: "비트코인" },
  { code: "KRW-ETH", name: "이더리움" },
  { code: "KRW-XRP", name: "리플" },
  { code: "KRW-SOL", name: "솔라나" },
];

const WS_URL = "wss://api.upbit.com/websocket/v1";
const MAX_TRADES = 15;
const CANDLE_COUNT = 120; // 최근 2시간

let selected = COINS[0].code;
const tickers = {};   // code -> 최신 ticker
const trades = {};    // code -> 최근 체결 배열
let candles = [];     // 선택된 코인의 1분봉 [{t, price}]
let lastPrice = null;

// ---------- 포맷 도우미 ----------
const won = (n) =>
  n >= 100 ? Math.round(n).toLocaleString("ko-KR")
           : n.toLocaleString("ko-KR", { maximumFractionDigits: 4 });

const bigWon = (n) => {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "조";
  if (n >= 1e8) return Math.round(n / 1e8).toLocaleString("ko-KR") + "억";
  return won(n);
};

const hhmmss = (ms) =>
  new Date(ms).toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" });

const $ = (id) => document.getElementById(id);
const dirClass = (c) => (c === "RISE" ? "rise" : c === "FALL" ? "fall" : "even");

// ---------- 탭 ----------
function renderTabs() {
  $("tabs").innerHTML = COINS.map((c) => {
    const t = tickers[c.code];
    const p = t ? won(t.trade_price) : "-";
    const cls = t ? dirClass(t.change) : "";
    return `<button class="tab ${c.code === selected ? "active" : ""}" data-code="${c.code}">
      ${c.name}<small class="${cls}">${p}</small></button>`;
  }).join("");
}

$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn || btn.dataset.code === selected) return;
  selected = btn.dataset.code;
  lastPrice = null;
  renderTabs();
  renderTicker();
  renderTrades();
  loadCandles();
});

// ---------- 시세 카드 ----------
function renderTicker() {
  const coin = COINS.find((c) => c.code === selected);
  $("coinName").textContent = coin.name;
  $("coinCode").textContent = coin.code;
  document.title = "실시간 " + coin.name + " 시세";

  const t = tickers[selected];
  if (!t) return;

  const cls = dirClass(t.change);
  const priceEl = $("price");
  priceEl.textContent = won(t.trade_price) + "원";
  priceEl.className = "price " + cls;

  // 가격이 바뀔 때 깜빡임 효과
  if (lastPrice !== null && t.trade_price !== lastPrice) {
    priceEl.classList.add(t.trade_price > lastPrice ? "flash-up" : "flash-down");
  }
  lastPrice = t.trade_price;

  const sign = t.signed_change_price > 0 ? "+" : "";
  $("change").className = "change " + cls;
  $("change").textContent =
    `${sign}${won(t.signed_change_price)}원 (${sign}${(t.signed_change_rate * 100).toFixed(2)}%)`;

  $("high").textContent = won(t.high_price);
  $("low").textContent = won(t.low_price);
  $("prev").textContent = won(t.prev_closing_price);
  $("volume").textContent = bigWon(t.acc_trade_price_24h) + "원";
}

// ---------- 체결 목록 ----------
function renderTrades() {
  const list = trades[selected] || [];
  $("trades").innerHTML = list.map((tr) => `
    <tr>
      <td>${hhmmss(tr.trade_timestamp)}</td>
      <td class="${tr.ask_bid === "BID" ? "rise" : "fall"}">${won(tr.trade_price)}</td>
      <td>${tr.trade_volume.toFixed(4)}</td>
    </tr>`).join("");
}

// ---------- 차트 (외부 라이브러리 없이 canvas로 직접 그림) ----------
async function loadCandles() {
  const code = selected;
  const urls = [
    `/api/candles?market=${code}&count=${CANDLE_COUNT}`,                                 // Vercel 함수
    `https://api.upbit.com/v1/candles/minutes/1?market=${code}&count=${CANDLE_COUNT}`,   // 직접 호출(예비)
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (code !== selected) return; // 그 사이 탭이 바뀐 경우
      candles = data
        .map((c) => ({ t: minuteOf(c.timestamp), price: c.trade_price }))
        .reverse(); // 업비트는 최신순으로 주므로 시간순으로 뒤집음
      drawChart();
      return;
    } catch (_) { /* 다음 URL 시도 */ }
  }
}

const minuteOf = (ms) => Math.floor(ms / 60000) * 60000;

// 실시간 체결가를 차트 마지막 봉에 반영
function updateCandle(price, ts) {
  if (!candles.length) return;
  const m = minuteOf(ts);
  const last = candles[candles.length - 1];
  if (m > last.t) {
    candles.push({ t: m, price });
    if (candles.length > CANDLE_COUNT) candles.shift();
  } else {
    last.price = price;
  }
}

function drawChart() {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = 260;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (candles.length < 2) return;

  const padR = 78, padT = 10, padB = 24;
  const prices = candles.map((c) => c.price);
  let min = Math.min(...prices), max = Math.max(...prices);
  if (min === max) { min -= 1; max += 1; }

  const x = (i) => (i / (candles.length - 1)) * (w - padR);
  const y = (p) => padT + (1 - (p - min) / (max - min)) * (h - padT - padB);

  // 가로 눈금선 + 가격 라벨
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#8a94ab";
  ctx.strokeStyle = "#263049";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const p = min + ((max - min) * i) / 4;
    const yy = y(p);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    ctx.fillText(won(p), w - padR + 6, yy + 4);
  }

  // 시간 라벨
  [0, Math.floor(candles.length / 2), candles.length - 1].forEach((i, k) => {
    const label = new Date(candles[i].t).toLocaleTimeString("ko-KR",
      { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
    ctx.textAlign = k === 0 ? "left" : k === 1 ? "center" : "right";
    ctx.fillText(label, x(i), h - 6);
  });
  ctx.textAlign = "left";

  // 선 색: 차트 구간 시작 대비 상승이면 빨강, 하락이면 파랑
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? "#ef4444" : "#3b82f6";

  // 영역 채우기
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, up ? "rgba(239,68,68,.25)" : "rgba(59,130,246,.25)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  candles.forEach((c, i) => (i ? ctx.lineTo(x(i), y(c.price)) : ctx.moveTo(x(i), y(c.price))));
  ctx.lineTo(x(candles.length - 1), h - padB);
  ctx.lineTo(0, h - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 선
  ctx.beginPath();
  candles.forEach((c, i) => (i ? ctx.lineTo(x(i), y(c.price)) : ctx.moveTo(x(i), y(c.price))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 현재가 점
  const lx = x(candles.length - 1), ly = y(prices[prices.length - 1]);
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

window.addEventListener("resize", drawChart);

// 화면 갱신은 초당 여러 번 오는 메시지를 모아서 한 프레임에 한 번만
let dirty = false;
function scheduleRender() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(() => {
    dirty = false;
    renderTabs();
    renderTicker();
    renderTrades();
    drawChart();
  });
}

// ---------- WebSocket ----------
let ws, pingTimer, retry = 0;

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + cls;
}

function connect() {
  setStatus("연결 중…", "connecting");
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer"; // 업비트는 바이너리로 데이터를 보냄

  ws.onopen = () => {
    retry = 0;
    setStatus("실시간", "live");
    const codes = COINS.map((c) => c.code);
    ws.send(JSON.stringify([
      { ticket: "btc-live-" + Date.now() },
      { type: "ticker", codes },
      { type: "trade", codes },
      { format: "DEFAULT" },
    ]));
    // 업비트는 약 120초간 메시지가 없으면 연결을 끊으므로 주기적으로 PING
    clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === 1 && ws.send("PING"), 60000);
  };

  ws.onmessage = (e) => {
    const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.status === "UP") return;           // PING 응답
    if (msg.error) { console.warn("업비트 오류:", msg.error); return; }

    if (msg.type === "ticker") {
      tickers[msg.code] = msg;
      if (msg.code === selected) updateCandle(msg.trade_price, msg.trade_timestamp);
    } else if (msg.type === "trade") {
      const arr = (trades[msg.code] ||= []);
      arr.unshift(msg);
      if (arr.length > MAX_TRADES) arr.pop();
    }
    scheduleRender();
  };

  ws.onclose = () => {
    clearInterval(pingTimer);
    setStatus("재연결 대기…", "error");
    // 연결 제한(초당 5회)을 넘지 않도록 점점 길게 기다렸다 재연결
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    setTimeout(connect, delay);
  };

  ws.onerror = () => ws.close();
}

// 탭을 다시 열었을 때 차트를 최신으로
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadCandles();
});

// ---------- 시작 ----------
renderTabs();
renderTicker();
loadCandles();
connect();
