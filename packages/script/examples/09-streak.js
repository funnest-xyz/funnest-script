//@version=2
// Consecutive rising closes, counted bar by bar with map and an outer variable.
indicator({ name: 'Up streak', overlay: false })
let streak = 0
const count = map(i => {
  streak = i > 0 && close[i] > close[i - 1] ? streak + 1 : 0
  return streak
})
plot('Bars up in a row', count, { style: 'histogram', color: color.up })
