//@version=2
// A trailing stop line: highest close minus a multiple of ATR, never moving down while in a trend.
indicator({ name: 'ATR trailing stop', overlay: true })
const mult = input.number('ATR multiplier', 3, { min: 0.5, step: 0.5 })
const atr = ta.atr(14)
let stop = NaN
const line = map(i => {
  const level = close[i] - mult * atr[i]
  if (Number.isNaN(level)) return NaN
  stop = Number.isNaN(stop) || close[i] < stop ? level : Math.max(stop, level)
  return stop
})
plot('Trailing stop', line, { color: color.down, width: 2 })
