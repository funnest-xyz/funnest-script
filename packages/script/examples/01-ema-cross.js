//@version=2
// EMA cross strategy: buy when the fast EMA crosses above the slow one, sell when it crosses back.
indicator({ name: 'EMA cross strategy', overlay: true })
const fastLen = input.int('Fast length', 12, { min: 2, max: 100 })
const slowLen = input.int('Slow length', 26, { min: 3, max: 300 })

const fast = ta.ema(close, fastLen)
const slow = ta.ema(close, slowLen)
plot('Fast EMA', fast, { color: color.orange })
plot('Slow EMA', slow, { color: color.purple })

strategy({ long: ta.crossover(fast, slow), longExit: ta.crossunder(fast, slow) })
