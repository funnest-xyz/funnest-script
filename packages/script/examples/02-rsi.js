//@version=2
// RSI in its own pane with overbought / oversold lines.
indicator({ name: 'RSI', overlay: false, range: [0, 100] })
const len = input.int('Length', 14, { min: 2, max: 100 })
const src = input.source('Source', 'close')

plot('RSI', ta.rsi(src, len), { color: color.purple, width: 2 })
hline(70, { label: 'Overbought', color: color.down })
hline(30, { label: 'Oversold', color: color.up })
