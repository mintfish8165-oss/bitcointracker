// =====================================================
// BITCOIN TRACKER - 업비트 Open API (시세 조회, 인증 불필요)
//  - 실시간 현재가/체결/호가: WebSocket  wss://api.upbit.com/websocket/v1
//  - 과거 캔들: REST (Vercel 서버리스 함수 /api/candles 경유)
//  - 차트: TradingView Lightweight Charts
// =====================================================

const COINS = [
  { code: "KRW-BTC",  name: "비트코인",   sym: "BTC",  color: "#f7931a" },
  { code: "KRW-ETH",  name: "이더리움",   sym: "ETH",  color: "#627eea" },
  { code: "KRW-XRP",  name: "리플",       sym: "XRP",  color: "#23292f" },
  { code: "KRW-SOL",  name: "솔라나",     sym: "SOL",  color: "#9945ff" },
  { code: "KRW-DOGE", name: "도지코인",   sym: "DOGE", color: "#c2a633" },
  { code: "KRW-ADA",  name: "에이다",     sym: "ADA",  color: "#0033ad" },
  { code: "KRW-AVAX", name: "아발란체",   sym: "AVAX", color: "#e84142" },
  { code: "KRW-LINK", name: "체인링크",   sym: "LINK", color: "#2a5ada" },
];

const UNITS = [
  { key: "1",   label: "1분",   ms: 60e3 },
  { key: "5",   label: "5분",   ms: 5 * 60e3 },
  { key: "15",  label: "15분",  ms: 15 * 60e3 },
  { key: "60",  label: "1시간", ms: 60 * 60e3 },
  { key: "240", label: "4시간", ms: 240 * 60e3 },
  { key: "D",   label: "일",    ms: 24 * 60 * 60e3 },
  { key: "W",   label: "주" },
  { key: "M",   label: "월" },
];

const API_PATH = { D: "days", W: "weeks", M: "months" };

// 체결 시각(ms)이 속한 캔들의 시작 시각(ms, UTC 기준)
// 업비트 일·주·월봉은 UTC 0시(한국 시간 오전 9시)에 시작합니다.
function bucketStart(ts) {
  if (unit.key === "W") {
    const d = new Date(ts);
    const day = (d.getUTCDay() + 6) % 7; // 월요일 = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  }
  if (unit.key === "M") {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return Math.floor(ts / unit.ms) * unit.ms;
}

const WS_URL = "wss://api.upbit.com/websocket/v1";
const KST = 9 * 3600; // 차트를 한국 시간으로 표시하기 위한 보정(초)
const MAX_TRADES = 14;
const OB_DEPTH = 7;

let selected = COINS[0].code;
let unit = UNITS[0];
const tickers = {};    // code -> 최신 현재가
const trades = {};     // code -> 최근 체결
const orderbooks = {}; // code -> 최신 호가
let lastCandle = null; // 차트의 마지막 캔들
let lastPrice = null;
let lastTopTradeId = null;
const prevMarketPrice = {};

// ---------- 포맷 도우미 ----------
const won = (n) => {
  if (n == null || isNaN(n)) return "-";
  const a = Math.abs(n);
  if (a >= 100) return Math.round(n).toLocaleString("ko-KR");
  if (a >= 1) return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
};
const bigWon = (n) => {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "조";
  if (n >= 1e8) return Math.round(n / 1e8).toLocaleString("ko-KR") + "억";
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  return won(n);
};
const qty = (n) => (n >= 1000 ? Math.round(n).toLocaleString("ko-KR") : n.toFixed(n >= 1 ? 3 : 4));
const pct = (r) => (r > 0 ? "+" : "") + (r * 100).toFixed(2) + "%";
// 한국 시간 HH:MM:SS
const hhmmss = (ms) => new Date(ms + KST * 1000).toISOString().slice(11, 19);
const dirClass = (c) => (c === "RISE" ? "rise" : c === "FALL" ? "fall" : "even");
const $ = (id) => document.getElementById(id);
const coinOf = (code) => COINS.find((c) => c.code === code);

// ---------- 시계 ----------
setInterval(() => ($("clock").textContent = "KST " + hhmmss(Date.now())), 1000);

// ---------- 마켓 목록 ----------
function buildMarkets() {
  $("markets").innerHTML = COINS.map((c) => `
    <li class="market" data-code="${c.code}">
      <span class="dot" style="background:${c.color}">${c.sym.slice(0, 4)}</span>
      <div><div class="m-name">${c.name}</div><div class="m-code">${c.sym}/KRW</div></div>
      <div class="m-right"><div class="m-price" id="mp-${c.sym}">-</div><div class="m-rate" id="mr-${c.sym}"></div></div>
    </li>`).join("");
  markActive();
}

function markActive() {
  document.querySelectorAll(".market").forEach((el) =>
    el.classList.toggle("active", el.dataset.code === selected));
}

function renderMarkets() {
  for (const c of COINS) {
    const t = tickers[c.code];
    if (!t) continue;
    const cls = dirClass(t.change);
    const p = $("mp-" + c.sym);
    const r = $("mr-" + c.sym);
    if (prevMarketPrice[c.code] !== t.trade_price) {
      p.textContent = won(t.trade_price);
      if (prevMarketPrice[c.code] != null) flash(p, t.trade_price > prevMarketPrice[c.code]);
      prevMarketPrice[c.code] = t.trade_price;
    }
    p.className = "m-price " + cls;
    r.className = "m-rate " + cls;
    r.textContent = pct(t.signed_change_rate);
  }
}

$("markets").addEventListener("click", (e) => {
  const li = e.target.closest(".market");
  if (!li || li.dataset.code === selected) return;
  selected = li.dataset.code;
  lastPrice = null;
  lastTopTradeId = null;
  markActive();
  renderAll();
  loadCandles();
});

function flash(el, up) {
  el.classList.remove("flash-up", "flash-down");
  void el.offsetWidth; // 애니메이션 다시 시작
  el.classList.add(up ? "flash-up" : "flash-down");
}

// ---------- 메인 시세 ----------
function renderTicker() {
  const coin = coinOf(selected);
  $("coinName").textContent = coin.name;
  $("coinCode").textContent = coin.code;
  $("coinBadge").textContent = coin.sym;
  $("coinBadge").style.background = coin.color;

  const t = tickers[selected];
  if (!t) {
    $("price").textContent = "-";
    $("change").textContent = "-";
    return;
  }
  const cls = dirClass(t.change);

  const priceEl = $("price");
  priceEl.classList.remove("rise", "fall", "even");
  priceEl.classList.add(cls);
  if (t.trade_price !== lastPrice) {
    priceEl.innerHTML = won(t.trade_price) + '<span class="unit">KRW</span>';
    if (lastPrice !== null) flash(priceEl, t.trade_price > lastPrice);
    lastPrice = t.trade_price;
  }

  const sign = t.signed_change_price > 0 ? "+" : "";
  $("change").className = "change " + cls;
  $("change").innerHTML =
    `${sign}${won(t.signed_change_price)}원<span class="pill"><span>${pct(t.signed_change_rate)}</span></span>`;

  $("high").textContent = won(t.high_price);
  $("low").textContent = won(t.low_price);
  $("prev").textContent = won(t.prev_closing_price);
  $("volume").textContent = bigWon(t.acc_trade_price_24h) + "원";
  $("high52").textContent = won(t.highest_52_week_price);
  $("low52").textContent = won(t.lowest_52_week_price);

  document.title = `${won(t.trade_price)} ${pct(t.signed_change_rate)} · ${coin.sym}`;
}

// ---------- 호가 ----------
function renderOrderbook() {
  const ob = orderbooks[selected];
  const t = tickers[selected];
  if (!ob) { $("orderbook").innerHTML = ""; return; }

  const units = ob.orderbook_units.slice(0, OB_DEPTH);
  const max = Math.max(...units.map((u) => Math.max(u.ask_size, u.bid_size)));
  const prev = t ? t.prev_closing_price : null;
  const colorOf = (p) => (prev == null ? "" : p > prev ? "rise" : p < prev ? "fall" : "");

  const asks = units.slice().reverse().map((u) => `
    <div class="ob-row ask">
      <div class="bar" style="width:${(u.ask_size / max) * 50}%"></div>
      <span class="s">${qty(u.ask_size)}</span>
      <span class="p ${colorOf(u.ask_price)}">${won(u.ask_price)}</span>
      <span></span>
    </div>`).join("");

  const bids = units.map((u) => `
    <div class="ob-row bid">
      <div class="bar" style="width:${(u.bid_size / max) * 50}%"></div>
      <span></span>
      <span class="p ${colorOf(u.bid_price)}">${won(u.bid_price)}</span>
      <span class="s">${qty(u.bid_size)}</span>
    </div>`).join("");

  const mid = t ? `<div class="ob-mid ${dirClass(t.change)}">${won(t.trade_price)}</div>` : "";
  $("orderbook").innerHTML = asks + mid + bids;

  const total = ob.total_bid_size + ob.total_ask_size;
  const bidRate = total ? ob.total_bid_size / total : 0.5;
  $("bidBar").style.width = (bidRate * 100).toFixed(1) + "%";
  $("bidPct").textContent = (bidRate * 100).toFixed(1) + "%";
  $("askPct").textContent = ((1 - bidRate) * 100).toFixed(1) + "%";
}

// ---------- 체결 ----------
function renderTrades() {
  const list = trades[selected] || [];
  const topId = list[0] && list[0].sequential_id;
  const isNew = topId != null && topId !== lastTopTradeId && lastTopTradeId !== null;
  lastTopTradeId = topId ?? null;

  $("trades").innerHTML = list.map((tr, i) => `
    <tr class="${i === 0 && isNew ? "new" : ""}">
      <td>${hhmmss(tr.trade_timestamp)}</td>
      <td class="${tr.ask_bid === "BID" ? "rise" : "fall"}">${won(tr.trade_price)}</td>
      <td>${qty(tr.trade_volume)}</td>
    </tr>`).join("");
}

// ---------- 차트 ----------
const chart = LightweightCharts.createChart($("chart"), {
  autoSize: true,
  layout: {
    background: { type: "solid", color: "transparent" },
    textColor: "#7d879c",
    fontFamily: "Pretendard Variable, Pretendard, sans-serif",
  },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.04)" },
    horzLines: { color: "rgba(255,255,255,0.04)" },
  },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
  localization: { priceFormatter: won },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: "#f6465d", downColor: "#3d8bfd",
  wickUpColor: "#f6465d", wickDownColor: "#3d8bfd",
  borderVisible: false,
  priceFormat: { type: "custom", formatter: won, minMove: 0.0001 },
});
candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });

const volumeSeries = chart.addHistogramSeries({
  priceScaleId: "vol",
  priceFormat: { type: "volume" },
  lastValueVisible: false,
  priceLineVisible: false,
});
chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

const volColor = (c) => (c.close >= c.open ? "rgba(246,70,93,0.35)" : "rgba(61,139,253,0.35)");

function buildUnits() {
  $("units").innerHTML = UNITS.map((u) =>
    `<button data-key="${u.key}" class="${u.key === unit.key ? "active" : ""}">${u.label}</button>`).join("");
}
$("units").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.key === unit.key) return;
  unit = UNITS.find((u) => u.key === b.dataset.key);
  buildUnits();
  loadCandles();
});

let loadSeq = 0;
async function loadCandles() {
  const seq = ++loadSeq;
  const code = selected;
  const path = API_PATH[unit.key] || `minutes/${unit.key}`;
  const urls = [
    `/api/candles?market=${code}&unit=${unit.key}&count=200`,
    `https://api.upbit.com/v1/candles/${path}?market=${code}&count=200`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (seq !== loadSeq || !Array.isArray(data)) return; // 그 사이 다른 걸 골랐다면 무시
      const rows = data.map((c) => ({
        time: Date.parse(c.candle_date_time_utc + "Z") / 1000 + KST,
        open: c.opening_price,
        high: c.high_price,
        low: c.low_price,
        close: c.trade_price,
        volume: c.candle_acc_trade_volume,
      })).reverse(); // 업비트는 최신순 → 시간순으로

      candleSeries.setData(rows);
      volumeSeries.setData(rows.map((r) => ({ time: r.time, value: r.volume, color: volColor(r) })));
      lastCandle = rows.length ? { ...rows[rows.length - 1] } : null;
      chart.timeScale().scrollToRealTime();
      return;
    } catch (_) { /* 다음 주소로 재시도 */ }
  }
}

// 실시간 체결을 마지막 캔들에 반영
function applyTrade(price, volume, ts) {
  if (!lastCandle) return;
  const time = bucketStart(ts) / 1000 + KST;
  if (time > lastCandle.time) {
    lastCandle = { time, open: price, high: price, low: price, close: price, volume };
  } else if (time === lastCandle.time) {
    lastCandle.close = price;
    lastCandle.high = Math.max(lastCandle.high, price);
    lastCandle.low = Math.min(lastCandle.low, price);
    lastCandle.volume += volume;
  } else {
    return; // 이미 지난 캔들의 늦은 체결은 무시
  }
  chartDirty = true;
}

let chartDirty = false;
function flushChart() {
  if (!chartDirty || !lastCandle) return;
  chartDirty = false;
  candleSeries.update(lastCandle);
  volumeSeries.update({ time: lastCandle.time, value: lastCandle.volume, color: volColor(lastCandle) });
}

// ---------- 화면 갱신 (한 프레임에 한 번만) ----------
let dirty = false;
function renderAll() {
  renderMarkets();
  renderTicker();
  renderOrderbook();
  renderTrades();
  flushChart();
}
function scheduleRender() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(() => { dirty = false; renderAll(); });
}

// ---------- WebSocket ----------
let ws, pingTimer, retry = 0;

function setStatus(text, cls) {
  $("status").textContent = text;
  $("status").className = "status " + cls;
}

function connect() {
  setStatus("연결 중", "connecting");
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer"; // 업비트는 바이너리로 보냄

  ws.onopen = () => {
    retry = 0;
    setStatus("실시간", "live");
    const codes = COINS.map((c) => c.code);
    ws.send(JSON.stringify([
      { ticket: "bitcoin-tracker-" + Date.now() },
      { type: "ticker", codes },
      { type: "trade", codes },
      { type: "orderbook", codes },
      { format: "DEFAULT" },
    ]));
    // 120초간 메시지가 없으면 끊기므로 주기적으로 PING
    clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === 1 && ws.send("PING"), 60000);
  };

  ws.onmessage = (e) => {
    const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.status === "UP") return;
    if (msg.error) { console.warn("업비트 오류:", msg.error); return; }

    if (msg.type === "ticker") {
      tickers[msg.code] = msg;
    } else if (msg.type === "trade") {
      const arr = (trades[msg.code] ||= []);
      arr.unshift(msg);
      if (arr.length > MAX_TRADES) arr.pop();
      if (msg.code === selected) applyTrade(msg.trade_price, msg.trade_volume, msg.trade_timestamp);
    } else if (msg.type === "orderbook") {
      orderbooks[msg.code] = msg;
    }
    scheduleRender();
  };

  ws.onclose = () => {
    clearInterval(pingTimer);
    setStatus("재연결 대기", "error");
    const delay = Math.min(30000, 1000 * 2 ** retry++); // 점점 길게 기다렸다 재연결
    setTimeout(connect, delay);
  };

  ws.onerror = () => ws.close();
}

// 다른 탭에 있다 돌아오면 차트를 최신으로
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadCandles();
});

// ---------- 시작 ----------
buildMarkets();
buildUnits();
renderAll();
loadCandles();
connect();
