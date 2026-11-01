// Vercel 서버리스 함수: /api/candles?market=KRW-BTC&count=120
// 브라우저에서 업비트 REST API를 직접 부를 때 생길 수 있는 CORS 문제를 피하기 위한 중계 역할입니다.

module.exports = async (req, res) => {
  const market = String(req.query.market || "KRW-BTC").toUpperCase();
  const count = Math.min(200, Math.max(1, parseInt(req.query.count, 10) || 120));

  // 허용된 형식(KRW-BTC 같은)만 통과
  if (!/^[A-Z]{3,5}-[A-Z0-9]{1,15}$/.test(market)) {
    return res.status(400).json({ error: "잘못된 market 값입니다." });
  }

  try {
    const r = await fetch(
      `https://api.upbit.com/v1/candles/minutes/1?market=${market}&count=${count}`,
      { headers: { accept: "application/json" } }
    );
    const data = await r.json();
    // 10초 동안 Vercel CDN에 캐시해서 업비트 요청 수 제한을 아낌
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: "업비트 API 호출 실패" });
  }
};
