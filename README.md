# 실시간 코인 시세 (업비트 Open API)

업비트 Open API로 비트코인·이더리움·리플·솔라나의 원화 시세를 실시간으로 보여주는 웹사이트입니다.
별도의 빌드 도구나 라이브러리 없이 HTML/CSS/JavaScript만으로 만들었고, Vercel에 그대로 배포됩니다.

## 기능
- 현재가, 전일 대비 등락(빨강 상승 / 파랑 하락), 고가·저가, 24시간 거래대금
- 최근 2시간 1분봉 차트 (실시간 체결가가 마지막 봉에 반영)
- 실시간 체결 내역
- 코인 탭 전환, 끊기면 자동 재연결

## 구조
```
index.html        화면
style.css         디자인
app.js            WebSocket 연결, 차트, 화면 갱신
api/candles.js    Vercel 서버리스 함수 (1분봉 REST API 중계)
```

## 사용한 업비트 API (인증 불필요한 시세 조회 API)
- WebSocket `wss://api.upbit.com/websocket/v1` — `ticker`(현재가), `trade`(체결)
- REST `GET https://api.upbit.com/v1/candles/minutes/1` — 1분봉

## 배포 방법
1. GitHub에서 새 저장소를 만들고 이 파일들을 그대로 올립니다 (`api` 폴더 포함).
2. https://vercel.com 에 GitHub 계정으로 로그인 → **Add New… → Project** → 저장소 선택 → **Import**
3. Framework Preset은 **Other**, 나머지 설정은 건드리지 않고 **Deploy**
4. 이후 GitHub에 push할 때마다 자동으로 다시 배포됩니다.

## 로컬에서 확인
`api` 함수까지 시험하려면 `npx vercel dev`, 화면만 볼 거라면 `npx serve .` 후 브라우저로 접속합니다.
