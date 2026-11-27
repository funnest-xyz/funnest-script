//@version=2
// The day's VWAP with ±1 / ±2 deviation bands, starting over each day in the market's time zone,
// yesterday's pivot point, and Korean market hours (09:00–15:30 Seoul) shaded.
indicator({ name: 'Session VWAP', overlay: true })
const anchor = input.select('Start over', ['D', 'W', 'M'], 'D')
const v1 = ta.vwapbands(hlc3, anchor, 1)
const v2 = ta.vwapbands(hlc3, anchor, 2)
plot('VWAP', v1.vwap, { color: color.blue, width: 2 })
plot('+1σ', v1.upper, { color: color.alpha(color.blue, 0.6) })
plot('-1σ', v1.lower, { color: color.alpha(color.blue, 0.6) })
plot('+2σ', v2.upper, { color: color.alpha(color.blue, 0.3), lineStyle: 'dashed' })
plot('-2σ', v2.lower, { color: color.alpha(color.blue, 0.3), lineStyle: 'dashed' })
fill('+1σ', '-1σ', { color: color.alpha(color.blue, 0.06) })

const pv = ta.pivots('traditional', 'D')
plot('Pivot', pv.p, { color: color.gray, style: 'step', lineStyle: 'dotted' })

if (timeframe.isIntraday) bgcolor(date.session('0900-1530', 'Asia/Seoul'), { color: color.alpha(color.yellow, 0.06) })
plotshape(date.isNew('D'), { shape: 'circle', location: 'bottom', color: color.gray, size: 'tiny' })
