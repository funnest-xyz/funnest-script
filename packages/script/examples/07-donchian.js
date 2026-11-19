//@version=2
// Donchian channel breakout: buy a new 20-bar high, sell a new 10-bar low.
indicator({ name: 'Donchian breakout', overlay: true })
const upper = ta.highest(high, input.int('Entry length', 20))
const lower = ta.lowest(low, input.int('Exit length', 10))
plot('Upper channel', upper, { color: color.green })
plot('Lower channel', lower, { color: color.red })

// The breakout compares with the channel up to the previous bar (no look-ahead).
strategy({ long: gt(close, prev(upper, 1)), longExit: lt(close, prev(lower, 1)) })
