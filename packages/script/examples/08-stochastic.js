//@version=2
// Stochastic oscillator.
indicator({ name: 'Stochastic', overlay: false, range: [0, 100] })
const s = ta.stoch(input.int('Length', 14), 3, 3)
plot('%K', s.k, { color: color.blue })
plot('%D', s.d, { color: color.orange })
hline(80)
hline(20)
