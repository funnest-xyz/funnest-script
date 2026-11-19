//@version=2
// Both ways with risk control: long on a golden cross above the 200 EMA, short on a dead cross below it.
// Stop 1.5 ATR away (a price per bar), target 3%, a 2% trailing stop, 50% of the account per trade.
indicator({ name: 'EMA cross with stops', overlay: true })
const fast = ta.ema(close, input.int('Fast', 12, { min: 2 }))
const slow = ta.ema(close, input.int('Slow', 26, { min: 3 }))
const trend = ta.ema(close, 200)
const atr = ta.atr(14)

plot('Fast', fast, { color: color.orange })
plot('Slow', slow, { color: color.purple })
plot('Trend', trend, { color: color.gray })

const up = gt(close, trend)
strategy({
  long: and(ta.crossover(fast, slow), up),
  short: and(ta.crossunder(fast, slow), not(up)),
  stopLoss: map((i) => (close[i] > trend[i] ? close[i] - 1.5 * atr[i] : close[i] + 1.5 * atr[i])),
  takeProfit: 3,
  trailingStop: 2,
  size: 50,
})
