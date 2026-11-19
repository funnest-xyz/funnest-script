# Funnest Script

**매매 지표와 전략**을 만드는 작은 자바스크립트 언어예요. 차트에 그리기, 백테스트, 알림,
스크리너, 모의 자동매매를 같은 스크립트 하나로 해요. [Funnest](https://funnest.xyz/trade)의
스크립트 언어이고, Apache-2.0 오픈소스예요.

```js
//@version=2
indicator({ name: 'EMA 교차', overlay: true })
const fast = ta.ema(close, input.int('빠른선', 12))
const slow = ta.ema(close, input.int('느린선', 26))
plot('빠른선', fast, { color: color.orange })
plot('느린선', slow, { color: color.purple })

strategy({
  long: ta.crossover(fast, slow),
  short: ta.crossunder(fast, slow),
  stopLoss: { long: sub(low, ta.atr(14)), short: add(high, ta.atr(14)) },
  takeProfit: 4,
})
alert(ta.crossover(fast, slow), '{symbol} 골든크로스 {close}')
```

- **그냥 자바스크립트**: 모든 봉에 한 번 실행. 시리즈(봉마다 값), `ta.*` 지표 40여 개, 그리기, 입력값.
- **정직한 백테스트**: 신호는 다음 봉 시가 체결, 손절·익절은 봉 안에서(같이 닿으면 손절), 롱·숏 따로, 추적 손절, 비중, 수수료.
- **다른 시간봉 · 시장 데이터**: `request.bars({ timeframe: '1D' })`(미래 참조 없음), `request.data('funding')`.
- **알림 · 스크리너**: `alert(조건, 메시지)`, `screen(이름, 값)`.
- **AI를 위해 만듦**: 명세 하나에서 AI용 설명서(`llms.txt`), 타입 선언, JSON 레퍼런스가 나오고, AI가 이걸로 제대로 짜는지 평가로 확인해요.

## 패키지

| 패키지 | 설명 |
|---|---|
| [`@funnest/script`](packages/script) | 언어 본체: 실행기, 백테스트, 매매 규칙, 설명서. 의존성 없음, 브라우저 · Node |
| [`@funnest/script-cli`](packages/cli) | `npx @funnest/script-cli check / run / backtest`: 타입 검사, 실제 거래소 시세로 실행, 백테스트 |
| [`@funnest/script-mcp`](packages/mcp) | MCP 서버: Claude · Cursor 같은 AI 도구가 설명서를 읽고 직접 짜고 돌리고 고쳐요 |
| [`skills/funnest-script`](skills/funnest-script) | AI 코딩 에이전트용 스킬: 짜고 확인하고 고치는 법 |

## AI와 쓰기

- **ChatGPT · Claude 대화**: [`llms.txt`](https://funnest.xyz/scripts/llms.txt)를 주고 만들어 달라고 하세요.
- **Claude Code · Cursor**: MCP 서버를 추가하고 말로 부탁하세요.

  ```sh
  claude mcp add funnest-script -- npx -y @funnest/script-mcp
  ```

## 직접 돌려 보기

```sh
npx @funnest/script-cli check my-script.js
npx @funnest/script-cli run my-script.js --symbol BINANCEF:BTCUSDT --tf 60
npx @funnest/script-cli backtest my-script.js --symbol UPBIT:KRW-BTC --tf 1D --bars 1000
```

시세는 거래소 공개 API(바이낸스 · 업비트 · 바이비트 · OKX)에서 바로 받아요. Funnest를 거치지 않아요.

## 개발

```sh
pnpm install
pnpm test        # 모든 패키지 (소스에서 바로)
pnpm generate    # src/spec.ts나 examples/를 고친 뒤: 설명서와 Worker 번들
pnpm eval        # AI 평가 (claude CLI 필요)
```

## 라이선스

[Apache-2.0](LICENSE). "Funnest", "Funnest Script"는 Funnest의 상표예요. [NOTICE](NOTICE) 참고.
