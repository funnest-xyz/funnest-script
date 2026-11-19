//@version=2
// Another timeframe and market data: trade the hourly chart only with the daily trend (the last
// closed daily bar above its 20-day EMA, worked out on the daily bars), and skip longs when
// funding runs hot.
indicator({ name: 'Daily trend filter', overlay: true })
const daily = request.bars({ timeframe: '1D' })
const dailyEma = daily.compute((b) => b.ta.ema(b.close, 20))
const funding = request.data('funding')

const fast = ta.ema(close, 20)
plot('EMA 20', fast, { color: color.orange })
plot('Daily EMA 20', dailyEma, { style: 'step', color: color.gray })

const dailyUp = gt(daily.close, dailyEma)
bgcolor(dailyUp, { color: color.green })
const calm = map((i) => Number.isNaN(funding[i]) || funding[i] < 0.03)
strategy({ long: and(and(ta.crossover(close, fast), dailyUp), calm), longExit: ta.crossunder(close, fast), stopLoss: 2 })
