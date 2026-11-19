//@version=2
// SuperTrend as a strategy: long while the trend is up.
indicator({ name: 'SuperTrend', overlay: true })
const factor = input.number('Factor', 3, { min: 1, max: 10, step: 0.5 })
const len = input.int('ATR length', 10, { min: 2 })

const st = ta.supertrend(factor, len)
plot('SuperTrend', st.line, { color: color.orange, width: 2 })

const up = eq(st.dir, 1)
strategy({ long: and(up, not(prev(up, 1))), longExit: and(not(up), prev(up, 1)) })
