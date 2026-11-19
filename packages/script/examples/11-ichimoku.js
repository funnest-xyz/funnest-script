//@version=2
// Ichimoku: conversion and base lines, the two leading spans shifted 26 bars ahead with the cloud between them
// (green while A is on top, red while B is), and the lagging span shifted 26 bars back.
indicator({ name: 'Ichimoku', overlay: true })
const conv = input.int('Conversion', 9, { min: 2 })
const base = input.int('Base', 26, { min: 2 })
const spanB = input.int('Lead B', 52, { min: 2 })
const shift = input.int('Displacement', 26, { min: 1, max: 100 })

const mid = (len) => avg(ta.highest(high, len), ta.lowest(low, len))
const tenkan = mid(conv)
const kijun = mid(base)

plot('Conversion', tenkan, { color: color.blue })
plot('Base', kijun, { color: color.red })
plot('Lead A', avg(tenkan, kijun), { color: color.green, offset: shift })
plot('Lead B', mid(spanB), { color: color.orange, offset: shift })
plot('Lagging', close, { color: color.gray, offset: -shift })
fill('Lead A', 'Lead B', { color: color.green, downColor: color.red })
