//@version=2
// Take profit in parts: half at +2%, a quarter at +4%, the rest at +7%; after the first target
// the stop moves to the entry (break-even). Entries wait for a small dip (a limit order under the
// signal bar's close) for up to 3 bars, and a trade that goes nowhere is closed after 48 bars.
indicator({ name: 'Scale-out trend', overlay: true })
const len = input.int('Trend length', 50, { min: 10, max: 400 })
const dip = input.number('Dip to buy (%)', 0.3, { min: 0, max: 5, step: 0.1 })

const trend = ta.ema(close, len)
const fast = ta.ema(close, 9)
plot('Trend', trend, { color: color.gray, width: 2 })
plot('Fast', fast, { color: color.orange })

const up = gt(close, trend)
strategy({
  long: and(ta.crossover(fast, ta.ema(close, 21)), up),
  longExit: ta.crossunder(close, trend),
  entryPrice: mul(close, 1 - dip / 100),
  entryBars: 3,
  stopLoss: 2.5,
  takeProfit: [{ at: 2, close: 50 }, { at: 4, close: 25 }, { at: 7 }],
  breakEven: true,
  exitAfter: 48,
})
