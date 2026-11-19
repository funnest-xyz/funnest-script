//@version=2
// Volume against its average: bars above 1 trade more than usual.
indicator({ name: 'Volume ratio', overlay: false })
const len = input.int('Average length', 20, { min: 2 })
const ratio = div(volume, ta.sma(volume, len))
plot('Volume / average', ratio, { style: 'histogram' })
hline(2, { label: 'Spike' })
