// Vercel 서버리스 함수: /api/candles?market=KRW-BTC&unit=1&count=200
// unit: 1, 3, 5, 15, 30, 60, 240 (분), D (일), W (주), M (월)
// 브라우저에서 업비트 REST API를 직접 부를 때 생길 수 있는 CORS 문제를 피하기 위한 중계 역할입니다.

const PATHS = {
  "1": "minutes/1", "3": "minutes/3", "5": "minutes/5", "15": "minutes/15",
  "30": "minutes/30", "60": "minutes/60", "240": "minutes/240",
  "D": "days", "W": "weeks", "M": "months",
};

module.exports = async (req, res) => {
  const market = String(req.query.market || "KRW-BTC").toUpperCase();
  const unit = String(req.query.unit || "1").toUpperCase();
  const count = Math.min(200, Math.max(1, parseInt(req.query.count, 10) || 200));

  if (!/^[A-Z]{3,5}-[A-Z0-9]{1,15}$/.test(market) || !PATHS[unit]) {
    return res.status(400).json({ error: "잘못된 요청 값입니다." });
  }

  try {
    const r = await fetch(
      `https://api.upbit.com/v1/candles/${PATHS[unit]}?market=${market}&count=${count}`,
      { headers: { accept: "application/json" } }
    );
    const data = await r.json();
    // 짧게 CDN 캐시해서 업비트 요청 수 제한을 아낌
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=30");
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: "업비트 API 호출 실패" });
  }
};
