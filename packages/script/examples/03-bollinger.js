//@version=2
// Bollinger Bands over the candles.
indicator({ name: 'Bollinger Bands', overlay: true })
const len = input.int('Length', 20, { min: 2 })
const mult = input.number('StdDev multiplier', 2, { min: 0.5, max: 5, step: 0.1 })

const band = ta.bb(close, len, mult)
plot('Upper', band.upper, { color: color.blue })
plot('Basis', band.mid, { color: color.gray })
plot('Lower', band.lower, { color: color.blue })
