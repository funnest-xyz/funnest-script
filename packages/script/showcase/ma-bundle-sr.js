//@version=2
// 이평선 묶음 + 지지 · 저항 — Funnest 예제 (처음부터 새로 작성)
// 1. 국내 HTS에서 많이 보는 기간(5·10·20·60·120·240)의 이동평균선을 한 번에 그려요.
// 2. 선들이 짧은 순으로 위에서부터 놓이면 정배열, 반대면 역배열로 배경을 칠해요.
// 3. 고른 두 선의 골든 · 데드 크로스를 표시하고 알림을 걸 수 있어요.
// 4. 가격이 여러 번 꺾인 자리를 묶어 지지 · 저항 구간으로 그려요.
indicator({ name: '이평선 묶음 + 지지 · 저항', overlay: true })

// ── 입력 ─────────────────────────────────────────────
const G_MA = '이동평균선'
const G_SIG = '배열 · 크로스'
const G_SR = '지지 · 저항'

const kind = input.select('종류', ['EMA', 'SMA', 'WMA', 'HMA'], 'EMA', { group: G_MA })
const src = input.source('가격', 'close', { group: G_MA })
const lengthsText = input.text('기간 (쉼표로, 최대 8개)', '5,10,20,60,120,240', { group: G_MA })
const shadeBundle = input.bool('가장 짧은 선 ~ 가장 긴 선 사이 칠하기', true, { group: G_MA })

const showOrder = input.bool('정배열 · 역배열 배경', true, { group: G_SIG })
const crossA = input.int('크로스: 빠른 선 (번호)', 3, { min: 1, max: 8, group: G_SIG })
const crossB = input.int('크로스: 느린 선 (번호)', 4, { min: 1, max: 8, group: G_SIG })

const showSR = input.bool('지지 · 저항 구간', true, { group: G_SR })
const swing = input.int('꺾인 자리 찾는 폭 (봉)', 8, { min: 2, max: 50, group: G_SR })
const maxZones = input.int('최대 구간 수', 6, { min: 1, max: 12, group: G_SR })
const zoneAtr = input.number('구간 두께 (ATR 배수)', 0.3, { min: 0.05, max: 2, step: 0.05, group: G_SR })

// ── 이동평균선 ───────────────────────────────────────
const lengths = [...new Set(lengthsText.split(',').map((s) => Math.round(Number(s.trim()))))]
  .filter((n) => Number.isFinite(n) && n >= 2 && n <= 1000)
  .sort((a, b) => a - b)
  .slice(0, 8)

const average = (len) =>
  kind === 'SMA' ? ta.sma(src, len) : kind === 'WMA' ? ta.wma(src, len) : kind === 'HMA' ? ta.hma(src, len) : ta.ema(src, len)

// 짧은 선은 따뜻한 색, 긴 선으로 갈수록 차가운 색.
const PALETTE = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#38D9A9', '#4DABF7', '#748FFC', '#DA77F2']
const lines = lengths.map((len, k) => ({ len, name: `${kind} ${len}`, values: average(len), color: PALETTE[Math.round((k * (PALETTE.length - 1)) / Math.max(1, lengths.length - 1))] }))

for (const l of lines) plot(l.name, l.values, { color: l.color, width: l.len >= 60 ? 2 : 1 })
if (shadeBundle && lines.length >= 2) fill(lines[0].name, lines[lines.length - 1].name, { color: color.alpha(color.up, 0.07), downColor: color.alpha(color.down, 0.07) })

// ── 정배열 · 역배열 ──────────────────────────────────
// 정배열: 짧은 선이 언제나 긴 선보다 위. 역배열: 언제나 아래.
const ordered = (dir) =>
  map((i) => {
    if (lines.length < 2) return false
    for (let k = 1; k < lines.length; k++) {
      const a = lines[k - 1].values[i]
      const b = lines[k].values[i]
      if (!Number.isFinite(a) || !Number.isFinite(b) || (dir > 0 ? a <= b : a >= b)) return false
    }
    return true
  })
const bull = ordered(1)
const bear = ordered(-1)
if (showOrder) {
  bgcolor(bull, { color: color.alpha(color.up, 0.06) })
  bgcolor(bear, { color: color.alpha(color.down, 0.06) })
}

// ── 크로스 ──────────────────────────────────────────
const fast = lines[crossA - 1]
const slow = lines[crossB - 1]
if (fast && slow && fast !== slow) {
  const golden = ta.crossover(fast.values, slow.values)
  const dead = ta.crossunder(fast.values, slow.values)
  plotshape(golden, { shape: 'triangleup', location: 'below', color: color.up, size: 'small', text: 'GC' })
  plotshape(dead, { shape: 'triangledown', location: 'above', color: color.down, size: 'small', text: 'DC' })
  alert(golden, `{symbol} 골든크로스 (${fast.name} ↑ ${slow.name}) · {close}`)
  alert(dead, `{symbol} 데드크로스 (${fast.name} ↓ ${slow.name}) · {close}`)
}

// ── 지지 · 저항 ─────────────────────────────────────
// 꺾인 자리(양옆 swing봉보다 높거나 낮은 봉)를 모아, 가까운 가격끼리 한 구간으로 묶어요.
// 여러 번 꺾인 구간일수록 위에 남겨요.
const n = bar.count
const atr = ta.atr(14)
const now = last(close)
const zones = []
if (showSR && n > swing * 2) {
  const tops = ta.pivothigh(high, swing, swing)
  const bottoms = ta.pivotlow(low, swing, swing)
  const half = (Number.isFinite(last(atr)) ? last(atr) : now * 0.01) * zoneAtr
  const turns = []
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(tops[i])) turns.push({ price: tops[i], bar: i - swing })
    if (Number.isFinite(bottoms[i])) turns.push({ price: bottoms[i], bar: i - swing })
  }
  for (const t of turns) {
    const z = zones.find((x) => Math.abs(x.price - t.price) <= half * 2)
    if (z) {
      z.price = (z.price * z.touches + t.price) / (z.touches + 1)
      z.touches += 1
      z.from = Math.min(z.from, t.bar)
      z.latest = Math.max(z.latest, t.bar)
    } else zones.push({ price: t.price, touches: 1, from: t.bar, latest: t.bar })
  }
  zones.sort((a, b) => b.touches - a.touches || b.latest - a.latest)
  zones.length = Math.min(zones.length, maxZones)
  for (const z of zones) {
    const above = z.price > now
    const c = above ? color.down : color.up
    box(z.from, z.price + half, n - 1, z.price - half, {
      color: color.alpha(c, 0.5),
      bg: color.alpha(c, 0.1),
      extend: 'right',
      text: `${above ? '저항' : '지지'} · ${z.touches}번`,
      textColor: c,
    })
  }
}

// ── 요약 ────────────────────────────────────────────
const aboveCount = lines.filter((l) => now > last(l.values)).length
const state = last(bull) ? '정배열' : last(bear) ? '역배열' : '섞임'
const nearest = (wantAbove) =>
  zones
    .filter((z) => (wantAbove ? z.price > now : z.price <= now))
    .sort((a, b) => Math.abs(a.price - now) - Math.abs(b.price - now))[0]
const r = nearest(true)
const s = nearest(false)
table({
  position: 'top-right',
  size: 'small',
  rows: [
    ['배열', { text: state, color: state === '정배열' ? color.up : state === '역배열' ? color.down : undefined }],
    ['가격 위의 선', `${aboveCount} / ${lines.length}`],
    ['가까운 저항', r ? r.price.toFixed(2) : '—'],
    ['가까운 지지', s ? s.price.toFixed(2) : '—'],
  ],
})
