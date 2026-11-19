//@version=2
// Signals: shade the uptrend (close above the 200 EMA); inside it mark ▲ Buy when RSI crosses above 30,
// and ▼ Sell when it falls below 70. The latest bar gets the RSI now.
indicator({ name: 'RSI signals', overlay: true })
const len = input.int('RSI length', 14, { min: 2 })
const trendLen = input.int('Trend EMA', 200, { min: 10 })

const rsi = ta.rsi(close, len)
const trend = ta.ema(close, trendLen)
const upTrend = gt(close, trend)

plot('Trend EMA', trend, { color: color.purple, width: 2 })
bgcolor(upTrend, { color: '#12B88614' })
plotshape(and(upTrend, ta.crossover(rsi, 30)), { shape: 'triangleup', text: 'Buy' })
plotshape(ta.crossunder(rsi, 70), { shape: 'triangledown', text: 'Sell' })
label(-1, `RSI ${last(rsi).toFixed(1)}`, { location: 'above' })
