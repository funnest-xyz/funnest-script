//@version=2
// MACD with the histogram as bars.
indicator({ name: 'MACD', overlay: false })
const m = ta.macd(close, 12, 26, 9)
plot('Histogram', m.hist, { style: 'histogram' })
plot('MACD', m.macd, { color: color.blue })
plot('Signal', m.signal, { color: color.orange })
hline(0)
