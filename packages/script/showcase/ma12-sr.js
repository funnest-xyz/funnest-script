//@version=2
// 고가 이동평균선 12개 + 지지 · 저항 (파인 스크립트 "High MA x12"를 옮김)
indicator({ name: '고가 이동평균선 12개', overlay: true })

const MA_TYPES = ['SMA', 'EMA', 'WMA', 'VWMA', 'SMMA', 'HMA', 'DEMA', 'TEMA', 'LSMA', 'ZLSMA', 'ALMA', 'ALSMA']
const SRC = { 고가: high, 저가: low, 종가: close, 시가: open, HL2: hl2, HLC3: hlc3, OHLC4: ohlc4, HLCC4: hlcc4 }
const SRC_NAMES = Object.keys(SRC)
const POS = { '오른쪽 위': 'top-right', '오른쪽 가운데': 'middle-right', '오른쪽 아래': 'bottom-right', '왼쪽 위': 'top-left', '왼쪽 가운데': 'middle-left', '왼쪽 아래': 'bottom-left', '가운데 위': 'top-center', '정가운데': 'middle-center', '가운데 아래': 'bottom-center' }
const POS_NAMES = Object.keys(POS)
const SIZE = { '아주 작게': 'tiny', 작게: 'small', 보통: 'normal' }
const SIZE_NAMES = Object.keys(SIZE)
const STYLE = { 점선: 'dotted', 파선: 'dashed', 실선: 'solid' }
const STYLE_NAMES = Object.keys(STYLE)
const NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const WIDTHS = [1, 2, 3, 4]

const TITLE_MA = '#2196F366', TITLE_AL = '#FF980066', TITLE_REF = '#9C27B066', TITLE_SR = '#00897B66', PRICE_BG = '#FFFFFF26'

const GRP_MA = '① 이동평균선 (표시 · 종류 · 가격 · 기간 · 색 · 굵기)'
const GRP_LABEL = '② 선 끝 이름표'
const GRP_BAND = '③ 밴드 채우기 (선 A ↔ 선 B)'
const GRP_CROSS = '④ 골든 / 데드 크로스 (선 A가 선 B를 돌파)'
const GRP_ALIGN = '⑤ 정배열 / 역배열'
const GRP_DASH = '⑥ 이평선 대시보드'
const GRP_ADASH = '⑦ 이평선 배열 대시보드 (위 → 아래 순서)'
const GRP_REF = '⑧ 기준봉 · 기준가 (이평선이 오르려면?)'
const GRP_PARAM = '⑨ 이평선별 세부 설정 (ALMA · LSMA · ZLSMA · ALSMA 선 전용)'
const GRP_SR = '⑩ 지지 · 저항 ① 기본 (가격이 여러 번 꺾인 가격대) + 대시보드'
const GRP_RN = '⑪ 지지 · 저항 ② 라운드 넘버 (150, 170처럼 딱 떨어지는 가격)'
const GRP_VP = '⑫ 지지 · 저항 ③ 매물대 (거래량이 많이 쌓인 가격대)'

const TT_ROW = 'ALMA · LSMA · ZLSMA · ALSMA의 세부 값은 ⑨에서'
const TT_BAND = '선 A가 위면 첫 번째 색, 아래면 두 번째 색'
const TT_CROSS = 'A가 B를 위로 뚫으면 GC, 아래로 뚫으면 DC'
const TT_ALIGN = '쉼표로 구분 (예: 1,3,6,8)'
const TT_ADASH = '값이 높은 순서로, 현재가 위치와 함께'
const TT_REF = 'SMA: N봉 전 값, EMA · SMMA: 직전 이평선 값'
const TT_PARAM = 'ALMA 오프셋 · 시그마 / LSMA 오프셋 / ALSMA 스무딩'
const TT_SR = '② 라운드 넘버 · ③ 매물대와 겹치면 1점씩 더해요'
const TT_RSTEP = '0이면 가격과 ATR에 맞춰 자동'
const TT_VP = '평균 거래량의 몇 배 이상인 가격대'

const DEF_LEN = [5, 10, 20, 30, 50, 60, 100, 120, 200, 240, 300, 480]
const DEF_COLOR = ['#FF5252', '#FF9800', '#FFEB3B', '#CDDC39', '#4CAF50', '#00BCD4', '#2196F3', '#3F51B5', '#9C27B0', '#E91E63', '#795548', '#607D8B']
const ma = DEF_LEN.map((len, k) => {
  const id = 'MA ' + String(k + 1).padStart(2, '0')
  const row = { group: GRP_MA, inline: 'ma' + k }
  return {
    id,
    show: input.bool(id, true, row),
    type: input.select(id + ' 종류', MA_TYPES, 'SMA', row),
    src: input.select(id + ' 가격', SRC_NAMES, '고가', row),
    len: input.int(id + ' 기간', len, { min: 1, ...row }),
    color: input.color(id + ' 색', DEF_COLOR[k], row),
    width: input.select(id + ' 굵기', WIDTHS, 1, k === 0 ? { ...row, tooltip: TT_ROW } : row),
  }
})

const showLabelInput = input.bool('선 끝에 이름 표시 (예: SMA 20 고가)', true, { group: GRP_LABEL })
const labelShift = input.int('이름 위치 (마지막 봉에서 오른쪽으로 몇 칸)', 2, { min: 0, max: 50, group: GRP_LABEL })

const bands = [
  { on: true, a: 3, b: 6, up: '#26A69A33', dn: '#EF535033' },
  { on: false, a: 6, b: 8, up: '#2196F333', dn: '#FF980033' },
  { on: false, a: 1, b: 3, up: '#00BCD433', dn: '#E91E6333' },
  { on: false, a: 8, b: 9, up: '#9C27B033', dn: '#79554833' },
].map(({ on, a, b, up, dn }, j) => {
  const name = '밴드 ' + (j + 1), row = { group: GRP_BAND, inline: 'b' + j }
  return {
    on: input.bool(name, on, row),
    a: input.select(name + ' 선 A', NUMS, a, row),
    b: input.select(name + ' 선 B', NUMS, b, row),
    up: input.color(name + ' 위 색', up, row),
    dn: input.color(name + ' 아래 색', dn, j === 0 ? { ...row, tooltip: TT_BAND } : row),
  }
})

const crossMarkOn = input.bool('차트에 GC / DC 표시', true, { group: GRP_CROSS, inline: 'xm' })
const gcColor = input.color('골든 색', '#00E676', { group: GRP_CROSS, inline: 'xm' })
const dcColor = input.color('데드 색', '#FF5252', { group: GRP_CROSS, inline: 'xm' })
const crosses = [{ on: true, a: 1, b: 3 }, { on: true, a: 3, b: 6 }, { on: false, a: 6, b: 8 }].map(({ on, a, b }, j) => {
  const name = '크로스 ' + (j + 1), row = { group: GRP_CROSS, inline: 'x' + j }
  return { on: input.bool(name, on, row), a: input.select(name + ' 선 A', NUMS, a, row), b: input.select(name + ' 선 B', NUMS, b, j === 0 ? { ...row, tooltip: TT_CROSS } : row) }
})

const alignOn = input.bool('차트에 배열 표시 (시작 지점 · 배경색)', true, { group: GRP_ALIGN })
const alignListIn = input.text('판정할 선 번호', '1,3,6,8', { group: GRP_ALIGN, tooltip: TT_ALIGN })
const alignMarkOn = input.bool('배열 시작 지점 표시', true, { group: GRP_ALIGN })
const alignBgOn = input.bool('배열 상태 배경색', false, { group: GRP_ALIGN })
const bullColor = input.color('정배열 색', '#26A69A', { group: GRP_ALIGN, inline: 'ac' })
const bearColor = input.color('역배열 색', '#EF5350', { group: GRP_ALIGN, inline: 'ac' })
const bullBgColor = input.color('정배열 배경', '#26A69A14', { group: GRP_ALIGN, inline: 'ab' })
const bearBgColor = input.color('역배열 배경', '#EF535014', { group: GRP_ALIGN, inline: 'ab' })

const dashOn = input.bool('대시보드 표시', true, { group: GRP_DASH })
const dashPos = input.select('대시보드 위치', POS_NAMES, '오른쪽 위', { group: GRP_DASH, inline: 'd1' })
const dashSize = input.select('대시보드 글자 크기', SIZE_NAMES, '작게', { group: GRP_DASH, inline: 'd1' })
const dashBg = input.color('대시보드 배경색', '#131722CC', { group: GRP_DASH, inline: 'd2' })
const dashText = input.color('대시보드 글자색', '#D1D4DC', { group: GRP_DASH, inline: 'd2' })
const dashMaOn = input.bool('이평선 값 · 현재가 대비 %', true, { group: GRP_DASH })
const dashTitleOn = input.bool('대시보드 제목 줄 표시 (모든 대시보드)', true, { group: GRP_DASH })
const dashCrossOn = input.bool('크로스 상태 (마지막 크로스 · 몇 봉 전)', true, { group: GRP_DASH })

const alignDashOn = input.bool('배열 대시보드 표시', true, { group: GRP_ADASH, tooltip: TT_ADASH })
const alignPos = input.select('배열 대시보드 위치', POS_NAMES, '오른쪽 아래', { group: GRP_ADASH, inline: 'ad' })
const alignSize = input.select('배열 대시보드 글자 크기', SIZE_NAMES, '작게', { group: GRP_ADASH, inline: 'ad' })
const alignPriceOn = input.bool('현재가 위치도 함께 표시', true, { group: GRP_ADASH })

const refOn = input.bool('기준봉 기능 사용', true, { group: GRP_REF, tooltip: TT_REF })
const refListIn = input.text('표시할 선 번호', '3,6,9', { group: GRP_REF })
const refVOn = input.bool('기준봉 세로선 표시', true, { group: GRP_REF })
const refHOn = input.bool('기준가 가로선 표시 (현재가가 이 선 위면 이평선 상승)', true, { group: GRP_REF })
const refLblOn = input.bool('기준봉 이름표 표시', true, { group: GRP_REF })
const dashRefOn = input.bool('기준봉 대시보드 표시', true, { group: GRP_REF })
const refVAuto = input.bool('세로선 = 이평선 색', true, { group: GRP_REF, inline: 'rv' })
const refVColor = input.color('세로선 색', '#B2B5BE99', { group: GRP_REF, inline: 'rv' })
const refVWidth = input.select('세로선 굵기', WIDTHS, 1, { group: GRP_REF, inline: 'rv' })
const refVStyle = input.select('세로선 모양', STYLE_NAMES, '점선', { group: GRP_REF, inline: 'rv' })
const refHAuto = input.bool('가로선 = 이평선 색', true, { group: GRP_REF, inline: 'rh' })
const refHColor = input.color('가로선 색', '#B2B5BE', { group: GRP_REF, inline: 'rh' })
const refHWidth = input.select('가로선 굵기', WIDTHS, 1, { group: GRP_REF, inline: 'rh' })
const refHStyle = input.select('가로선 모양', STYLE_NAMES, '점선', { group: GRP_REF, inline: 'rh' })
const refLAuto = input.bool('이름표 = 이평선 색', true, { group: GRP_REF, inline: 'rl' })
const refLColor = input.color('이름표 색', '#B2B5BE', { group: GRP_REF, inline: 'rl' })
const refLSize = input.select('이름표 글자 크기', SIZE_NAMES, '아주 작게', { group: GRP_REF, inline: 'rl' })
const refPos = input.select('기준봉 대시보드 위치', POS_NAMES, '왼쪽 아래', { group: GRP_REF, inline: 'rd' })
const refSize = input.select('기준봉 대시보드 글자 크기', SIZE_NAMES, '작게', { group: GRP_REF, inline: 'rd' })

const params = ma.map((m, k) => {
  const row = { group: GRP_PARAM, inline: 'p' + k }
  return {
    almaOff: input.number(m.id + ' ALMA 오프셋', 0.85, { min: 0, max: 1, step: 0.05, ...row }),
    almaSig: input.number(m.id + ' ALMA 시그마', 6, { min: 0.1, step: 0.5, ...row }),
    lsOff: input.int(m.id + ' LSMA 오프셋', 0, row),
    alsSm: input.number(m.id + ' ALSMA 스무딩', 1.5, { min: 0.1, step: 0.1, ...(k === 0 ? { ...row, tooltip: TT_PARAM } : row) }),
  }
})

const srOn = input.bool('기본 지지 · 저항 박스 표시', true, { group: GRP_SR, tooltip: TT_SR })
const srLeft = input.int('고점 · 저점 감지 왼쪽 봉 수', 10, { min: 2, max: 50, group: GRP_SR, inline: 'sp' })
const srRight = input.int('고점 · 저점 감지 오른쪽 봉 수', 10, { min: 2, max: 50, group: GRP_SR, inline: 'sp' })
const srLookback = input.int('최근 몇 봉 안에서 찾기', 500, { min: 50, max: 5000, group: GRP_SR })
const srTolMult = input.number('같은 가격대로 묶는 범위 (ATR 배수)', 0.5, { min: 0.05, step: 0.05, group: GRP_SR })
const srMinTouch = input.int('최소 강도 (반응 횟수 + 라운드 1점 + 매물대 1점)', 2, { min: 1, max: 20, group: GRP_SR })
const srMaxEach = input.int('위 · 아래 각각 표시 개수', 3, { min: 1, max: 5, group: GRP_SR })
const srZoneMult = input.number('구간 두께 (ATR 배수)', 0.3, { min: 0, step: 0.05, group: GRP_SR })
const srResColor = input.color('저항 색', '#EF5350', { group: GRP_SR, inline: 'sc' })
const srSupColor = input.color('지지 색', '#26A69A', { group: GRP_SR, inline: 'sc' })
const srLabelOn = input.bool('가격 · 근거 글자 표시', true, { group: GRP_SR })
const srPrevDOn = input.bool('전일 고가 · 저가 선', false, { group: GRP_SR })
const srPrevWOn = input.bool('전주 고가 · 저가 선', false, { group: GRP_SR })
const srPrevMOn = input.bool('전월 고가 · 저가 선', true, { group: GRP_SR })
const srPrevColor = input.color('이전 기간 고가 · 저가 선 색', '#FFB74D', { group: GRP_SR })
const srDashOn = input.bool('지지 · 저항 대시보드 표시', true, { group: GRP_SR })
const srPos = input.select('지지 · 저항 대시보드 위치', POS_NAMES, '왼쪽 가운데', { group: GRP_SR, inline: 'sd' })
const srSize = input.select('지지 · 저항 대시보드 글자 크기', SIZE_NAMES, '작게', { group: GRP_SR, inline: 'sd' })

const srRoundOn = input.bool('라운드 넘버를 기본 박스 점수에 반영 (+1점)', true, { group: GRP_RN })
const srRoundStep = input.number('라운드 간격 (0 = 자동)', 0, { min: 0, group: GRP_RN, tooltip: TT_RSTEP })
const srRoundMarkOn = input.bool('라운드 넘버 선 표시', true, { group: GRP_RN, inline: 'rk' })
const srRoundColor = input.color('라운드 선 색', '#29B6F6', { group: GRP_RN, inline: 'rk' })
const srRoundWidth = input.select('라운드 선 굵기', WIDTHS, 1, { group: GRP_RN, inline: 'rk' })
const srRoundStyle = input.select('라운드 선 모양', STYLE_NAMES, '점선', { group: GRP_RN, inline: 'rk' })
const rnCount = input.int('라운드 넘버 현재가 위 · 아래 각각 몇 개', 1, { min: 0, max: 5, group: GRP_RN })
const rnLabelOn = input.bool('라운드 넘버 가격 글자 표시', true, { group: GRP_RN })

const srVolOn = input.bool('매물대를 기본 박스 점수에 반영 (+1점)', true, { group: GRP_VP, tooltip: TT_VP })
const srVolMult = input.number('매물대 기준 (평균 거래량의 몇 배 이상)', 1.5, { min: 1, step: 0.1, group: GRP_VP })
const srVolMarkOn = input.bool('매물대 박스 표시', true, { group: GRP_VP, inline: 'vk' })
const srVolColor = input.color('매물대 색', '#E040FB', { group: GRP_VP, inline: 'vk' })
const srVolWidth = input.select('매물대 테두리 굵기', WIDTHS, 2, { group: GRP_VP, inline: 'vk' })
const srVolStyle = input.select('매물대 테두리 모양', STYLE_NAMES, '파선', { group: GRP_VP, inline: 'vk' })
const vpLookback = input.int('매물대: 최근 몇 봉의 거래량으로 계산', 500, { min: 50, max: 5000, group: GRP_VP })
const vpBins = input.int('매물대: 가격 칸 수 (클수록 촘촘하게)', 50, { min: 10, max: 200, group: GRP_VP })
const vpCount = input.int('매물대 현재가 위 · 아래 각각 몇 개', 1, { min: 0, max: 5, group: GRP_VP })
const vpLabelOn = input.bool('매물대 가격 글자 표시', true, { group: GRP_VP })

const n = bar.count
const last = n - 1
const now = close[last]
const digits = now >= 10000 ? 0 : now >= 100 ? 2 : now >= 1 ? 3 : 6
const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : '-')
const pct = (v) => (Number.isFinite(v) && v !== 0 ? ((now - v) / v) * 100 : NaN)
const pctText = (d) => (Number.isNaN(d) ? '-' : (d >= 0 ? '▲ +' : '▼ ') + d.toFixed(2) + '%')

const trv = ta.tr()
function alsma(src, len, smooth) {
  const hi = ta.highest(trv, len)
  let mx = NaN, my = NaN, vx = 0, cxy = 0
  return map((i) => {
    let a = hi[i] > 0 ? Math.pow(trv[i] / hi[i], smooth) : NaN
    a = Number.isNaN(a) ? 2 / (len + 1) : Math.min(Math.max(a, 0), 1)
    const y = src[i]
    if (Number.isNaN(y)) return NaN
    if (Number.isNaN(mx)) {
      mx = i
      my = y
    } else {
      const dx = i - mx, dy = y - my
      mx += a * dx
      my += a * dy
      vx = (1 - a) * (vx + a * dx * dx)
      cxy = (1 - a) * (cxy + a * dx * dy)
    }
    return vx > 0 ? my + (cxy / vx) * (i - mx) : my
  })
}
function maOf(m, p) {
  const src = SRC[m.src], len = m.len
  switch (m.type) {
    case 'SMA': return ta.sma(src, len)
    case 'EMA': return ta.ema(src, len)
    case 'WMA': return ta.wma(src, len)
    case 'VWMA': return ta.vwma(src, len)
    case 'SMMA': return ta.rma(src, len)
    case 'HMA': return ta.hma(src, Math.max(2, len))
    case 'DEMA': return ta.dema(src, len)
    case 'TEMA': return ta.tema(src, len)
    case 'LSMA': return ta.linreg(src, len, p.lsOff)
    case 'ZLSMA': {
      const l1 = ta.linreg(src, len, p.lsOff), l2 = ta.linreg(l1, len, p.lsOff)
      return map((i) => 2 * l1[i] - l2[i])
    }
    case 'ALMA': return ta.alma(src, len, p.almaOff, p.almaSig)
    default: return alsma(src, len, p.alsSm)
  }
}
const vals = ma.map((m, k) => maOf(m, params[k]))
const name = (k) => ma[k].type + ' ' + ma[k].len + ' ' + ma[k].src
const shortName = (k) => ma[k].type + ma[k].len

function parseList(txt) {
  const out = []
  for (const p of txt.replace(/\s/g, '').split(',')) {
    const k = Math.round(Number(p))
    if (p !== '' && k >= 1 && k <= 12 && !out.includes(k)) out.push(k)
  }
  return out.sort((a, b) => ma[a - 1].len - ma[b - 1].len)
}

ma.forEach((m, k) => {
  if (m.show) plot(m.id, vals[k], { color: m.color, width: m.width })
})
bands.forEach((b) => {
  const A = ma[b.a - 1], B = ma[b.b - 1]
  if (!b.on || b.a === b.b || !A.show || !B.show) return
  const va = vals[b.a - 1], vb = vals[b.b - 1]
  fill(A.id, B.id, { color: (i) => (va[i] > vb[i] ? b.up : b.dn) })
})

const crossState = crosses.map((c, k) => {
  if (!c.on) return null
  const a = vals[c.a - 1], b = vals[c.b - 1]
  const gc = ta.crossover(a, b), dc = ta.crossunder(a, b)
  if (crossMarkOn) {
    plotshape(gc, { shape: 'triangleup', location: 'below', color: gcColor, text: 'GC' + (k + 1), size: 'tiny' })
    plotshape(dc, { shape: 'triangledown', location: 'above', color: dcColor, text: 'DC' + (k + 1), size: 'tiny' })
  }
  const g = gc.lastIndexOf(1), d = dc.lastIndexOf(1)
  return { dir: g < 0 && d < 0 ? 0 : g > d ? 1 : -1, bar: Math.max(g, d) }
})

const alignIdx = parseList(alignListIn)
function arranged(up) {
  return map((i) => {
    if (alignIdx.length < 2) return 0
    for (let j = 0; j + 1 < alignIdx.length; j++) {
      const a = vals[alignIdx[j] - 1][i], b = vals[alignIdx[j + 1] - 1][i]
      if (Number.isNaN(a) || Number.isNaN(b) || (up ? a <= b : a >= b)) return 0
    }
    return 1
  })
}
const isBull = arranged(true), isBear = arranged(false)
if (alignOn && alignMarkOn) {
  plotshape(map((i) => isBull[i] && !(i > 0 && isBull[i - 1])), { shape: 'diamond', location: 'below', color: bullColor, text: '정배열', size: 'tiny' })
  plotshape(map((i) => isBear[i] && !(i > 0 && isBear[i - 1])), { shape: 'diamond', location: 'above', color: bearColor, text: '역배열', size: 'tiny' })
}
if (alignOn && alignBgOn) bgcolor((i) => (isBull[i] ? bullBgColor : isBear[i] ? bearBgColor : null))

if (showLabelInput)
  ma.forEach((m, k) => {
    const v = vals[k][last]
    if (m.show && Number.isFinite(v)) label(last + labelShift, name(k), { price: v, style: 'text', align: 'right', textColor: m.color, size: 'small' })
  })

function refPrice(k) {
  const m = ma[k], v = vals[k][last], vp = vals[k][last - 1]
  if (!Number.isFinite(v) || !Number.isFinite(vp)) return NaN
  if (m.type === 'SMA') return SRC[m.src][last] - m.len * (v - vp)
  if (m.type === 'EMA' || m.type === 'SMMA') return vp
  return NaN
}
const refIdx = parseList(refListIn)
if (refOn)
  for (const r of refIdx) {
    const k = r - 1, m = ma[k], rp = refPrice(k)
    if (m.type !== 'SMA' || !Number.isFinite(rp) || last < m.len) continue
    const xb = last - m.len
    const lc = refLAuto ? m.color : refLColor
    if (refVOn) line(xb, rp, xb, rp + 1, { extend: 'both', color: refVAuto ? color.alpha(m.color, 0.6) : refVColor, style: STYLE[refVStyle], width: refVWidth })
    if (refHOn) line(xb, rp, last, rp, { color: refHAuto ? m.color : refHColor, style: STYLE[refHStyle], width: refHWidth })
    if (refLblOn) label(xb, name(k) + ' 기준봉', { location: 'above', color: color.alpha(lc, 0.2), textColor: lc, size: SIZE[refLSize] })
  }

const titleRow = (txt, bg, right = '') => [{ text: txt, bg }, { text: '', bg }, { text: right, bg, color: srRoundColor }]
const priceRow = () => [{ text: '▶ 현재가', bg: PRICE_BG }, { text: fmt(now), bg: PRICE_BG }, { text: '', bg: PRICE_BG }]
const box3 = (pos, size, rows) => table({ position: POS[pos], rows, bg: dashBg, textColor: dashText, border: color.alpha(dashText, 0.2), size: SIZE[size] })

if (dashOn) {
  const rows = []
  if (dashTitleOn) rows.push(titleRow('■ 이평선', TITLE_MA))
  if (dashMaOn) {
    rows.push(['이평선', '값', '현재가 대비'])
    ma.forEach((m, k) => {
      if (!m.show) return
      const v = vals[k][last], d = pct(v)
      rows.push([{ text: name(k), color: m.color }, fmt(v), { text: pctText(d), color: Number.isNaN(d) ? dashText : d >= 0 ? bullColor : bearColor }])
    })
  }
  if (dashCrossOn)
    crosses.forEach((c, k) => {
      const s = crossState[k]
      if (!s) return
      const st = s.dir === 1 ? '골든크로스' : s.dir === -1 ? '데드크로스' : '없음'
      const ago = s.dir === 0 ? '-' : last - s.bar === 0 ? '이번 봉' : last - s.bar + '봉 전'
      rows.push(['크로스' + (k + 1) + '  ' + shortName(c.a - 1) + ' × ' + shortName(c.b - 1), { text: st, color: s.dir === 1 ? gcColor : s.dir === -1 ? dcColor : dashText }, ago])
    })
  if (rows.length) box3(dashPos, dashSize, rows)
}

if (alignDashOn) {
  const rows = []
  if (dashTitleOn) rows.push(titleRow('■ 이평선 배열 (위 → 아래)', TITLE_AL))
  const shown = ma.map((m, k) => ({ k, v: vals[k][last] })).filter((x) => ma[x.k].show && Number.isFinite(x.v)).sort((a, b) => b.v - a.v)
  let priceDone = !alignPriceOn
  shown.forEach((x, rank) => {
    if (!priceDone && now >= x.v) {
      rows.push(priceRow())
      priceDone = true
    }
    const d = pct(x.v)
    rows.push([{ text: rank + 1 + '. ' + name(x.k), color: ma[x.k].color }, fmt(x.v), { text: pctText(d), color: Number.isNaN(d) ? dashText : d >= 0 ? bullColor : bearColor }])
  })
  if (!priceDone) rows.push(priceRow())
  box3(alignPos, alignSize, rows)
}

if (dashRefOn && refOn) {
  const rows = []
  if (dashTitleOn) rows.push(titleRow('■ 기준봉 (이평선 방향)', TITLE_REF))
  rows.push(['이평선 (기준)', '기준가', '현재 위치'])
  for (const r of refIdx) {
    const k = r - 1, t = ma[k].type, rp = refPrice(k), cur = SRC[ma[k].src][last]
    const supported = t === 'SMA' || t === 'EMA' || t === 'SMMA'
    const tag = t === 'SMA' ? ' (' + ma[k].len + '봉 전)' : supported ? ' (직전 이평)' : ''
    let pos = '-', pc = dashText
    if (!supported) pos = '해당 없음'
    else if (Number.isFinite(rp) && Number.isFinite(cur) && rp !== 0) {
      const g = ((cur - rp) / rp) * 100
      const gt = (g >= 0 ? '+' : '') + g.toFixed(2) + '%'
      pos = cur > rp ? '▲ 상승 ' + gt : cur < rp ? '▼ 하락 ' + gt : '= 보합'
      pc = cur > rp ? bullColor : cur < rp ? bearColor : dashText
    }
    rows.push([{ text: name(k) + tag, color: ma[k].color }, fmt(rp), { text: pos, color: pc }])
  }
  box3(refPos, refSize, rows)
}

const srAtr = ta.atr(50)
const ph = ta.pivothigh(high, srLeft, srRight), pl = ta.pivotlow(low, srLeft, srRight)
const pivots = []
for (let i = 0; i < n; i++) {
  if (!Number.isNaN(ph[i])) pivots.push({ p: ph[i], b: i - srRight })
  if (!Number.isNaN(pl[i])) pivots.push({ p: pl[i], b: i - srRight })
}
const recent = pivots.filter((x) => x.b >= last - srLookback)

const atrNow = Number.isFinite(srAtr[last]) ? srAtr[last] : 0
const tol = atrNow * srTolMult
const half = (atrNow * srZoneMult) / 2
const w = Math.max(half, tol / 2)
function autoRoundStep(px, width) {
  const mag = px > 0 ? Math.pow(10, Math.floor(Math.log10(px))) / 10 : 0
  const need = Math.max(mag, width * 6)
  const base = need > 0 ? Math.pow(10, Math.floor(Math.log10(need))) : 0
  return base <= 0 ? 0 : need <= base ? base : need <= base * 2 ? base * 2 : need <= base * 5 ? base * 5 : base * 10
}
const rStep = srRoundStep > 0 ? srRoundStep : autoRoundStep(now, w)
const rTol = rStep * 0.001
const near = (list, v, t) => list.some((x) => Math.abs(x - v) <= t)

const zones = []
const vFrom = Math.max(0, n - vpLookback)
if ((srVolOn || srVolMarkOn) && n > 0) {
  let vLo = Infinity, vHi = -Infinity
  for (let i = vFrom; i < n; i++) (vLo = Math.min(vLo, low[i])), (vHi = Math.max(vHi, high[i]))
  if (vHi > vLo) {
    const step = (vHi - vLo) / vpBins
    const bins = new Array(vpBins).fill(0)
    for (let i = vFrom; i < n; i++) {
      const h = high[i], l = low[i], v = volume[i] || 0
      if (v <= 0) continue
      const b0 = Math.max(0, Math.min(vpBins - 1, Math.floor((l - vLo) / step)))
      const b1 = Math.max(0, Math.min(vpBins - 1, Math.floor((h - vLo) / step)))
      if (b1 === b0 || h <= l) bins[b0] += v
      else
        for (let b = b0; b <= b1; b++) {
          const bl = vLo + b * step
          const ov = Math.min(h, bl + step) - Math.max(l, bl)
          if (ov > 0) bins[b] += (v * ov) / (h - l)
        }
    }
    const avgVol = bins.reduce((a, b) => a + b, 0) / vpBins
    if (avgVol > 0) {
      let zs = -1, zv = 0
      for (let b = 0; b <= vpBins; b++) {
        const hot = b < vpBins && bins[b] >= avgVol * srVolMult
        if (hot) {
          if (zs < 0) (zs = b), (zv = 0)
          zv += bins[b]
        } else if (zs >= 0) {
          zones.push({ lo: vLo + zs * step, hi: vLo + b * step, r: zv / (b - zs) / avgVol })
          zs = -1
        }
      }
    }
  }
}

function zoneEval(m, cnt) {
  let rv = NaN
  if ((srRoundOn || srRoundMarkOn) && rStep > 0) {
    const nr = Math.round(m / rStep) * rStep
    if (Math.abs(nr - m) <= w) rv = nr
  }
  let vz = -1, best = 0
  if (srVolOn || srVolMarkOn)
    zones.forEach((z, k) => {
      if (z.lo <= m + w && z.hi >= m - w && z.r > best) (best = z.r), (vz = k)
    })
  return { sc: cnt + (srRoundOn && !Number.isNaN(rv) ? 1 : 0) + (srVolOn && vz >= 0 ? 1 : 0), rv, vz }
}
const tagOf = (cnt, rv, vol) => cnt + '회' + (Number.isNaN(rv) ? '' : ' · 라운드 ' + rv) + (vol ? ' · 매물대' : '')
const labelX = last + labelShift + 12
function srZone(m, sc, firstBar, isRes, tag, rv) {
  const col = isRes ? srResColor : srSupColor
  const transp = Math.max(50, 85 - (sc - srMinTouch) * 8)
  const rIn = srRoundMarkOn && !Number.isNaN(rv)
  const top = rIn ? Math.max(m + half, rv) : m + half
  const bottom = rIn ? Math.min(m - half, rv) : m - half
  box(firstBar, top, last, bottom, { color: color.alpha(col, 0.6), width: 1, bg: color.new(col, transp), extend: 'right' })
  if (srLabelOn) label(labelX, (isRes ? '저항 ' : '지지 ') + fmt(m) + ' · ' + tag, { price: m, style: 'text', align: 'right', textColor: col, size: 'tiny' })
}

const clusters = []
if (srOn && recent.length) {
  const sorted = [...recent].sort((a, b) => a.p - b.p)
  let sum = 0, cnt = 0, start = NaN, first = 0
  for (const x of sorted) {
    if (cnt > 0 && x.p - start > tol) {
      clusters.push({ mean: sum / cnt, cnt, first })
      cnt = 0
    }
    if (cnt === 0) (sum = x.p), (cnt = 1), (start = x.p), (first = x.b)
    else (sum += x.p), (cnt += 1), (first = Math.min(first, x.b))
  }
  if (cnt > 0) clusters.push({ mean: sum / cnt, cnt, first })
}
const res = [], sup = [], rnAttached = [], vzAttached = []
const firstUp = clusters.findIndex((c) => c.mean > now)
const up0 = firstUp < 0 ? clusters.length : firstUp
function pickZones(order, out, isRes) {
  for (const c of order) {
    if (out.length >= srMaxEach) break
    const { sc, rv, vz } = zoneEval(c.mean, c.cnt)
    if (sc < srMinTouch) continue
    const tag = tagOf(c.cnt, rv, vz >= 0)
    out.push({ c, tag })
    srZone(c.mean, sc, c.first, isRes, tag, rv)
    if (!Number.isNaN(rv)) rnAttached.push({ lv: rv, x: c.first })
    if (vz >= 0) vzAttached.push(vz)
  }
}
if (srOn) {
  pickZones(clusters.slice(up0), res, true)
  pickZones(clusters.slice(0, up0).reverse(), sup, false)
}

const rnLevels = [], rnOwn = []
const rnLine = (x1, lv) => line(x1, lv, last, lv, { extend: 'right', color: srRoundColor, style: STYLE[srRoundStyle], width: srRoundWidth })
if (srRoundMarkOn && rStep > 0) {
  for (const a of rnAttached)
    if (!near(rnLevels, a.lv, rTol)) {
      rnLevels.push(a.lv)
      rnOwn.push(false)
      rnLine(a.x, a.lv)
    }
  const x1 = Math.max(0, last - 60)
  for (let i = 1; i <= rnCount; i++) {
    const up = (Math.floor(now / rStep) + i) * rStep, dn = (Math.ceil(now / rStep) - i) * rStep
    for (const lv of [up, dn]) {
      if (lv <= 0 || near(rnLevels, lv, rTol)) continue
      rnLevels.push(lv)
      rnOwn.push(true)
      rnLine(x1, lv)
      if (rnLabelOn) label(labelX, '라운드 ' + fmt(lv), { price: lv, style: 'text', align: 'right', textColor: srRoundColor, size: 'tiny' })
    }
  }
}

const vpShow = [], vpOwn = []
if (srVolMarkOn && zones.length) {
  for (const z of vzAttached)
    if (!vpShow.includes(z)) {
      vpShow.push(z)
      vpOwn.push(false)
    }
  if (vpCount > 0) {
    let fu = zones.findIndex((z) => (z.lo + z.hi) / 2 > now)
    if (fu < 0) fu = zones.length
    const take = (list) => {
      for (const z of list.slice(0, vpCount))
        if (!vpShow.includes(z)) {
          vpShow.push(z)
          vpOwn.push(true)
        }
    }
    take(zones.map((_, k) => k).slice(fu))
    take(zones.map((_, k) => k).slice(0, fu).reverse())
  }
  vpShow.forEach((z, j) => {
    const { lo, hi, r } = zones[z]
    box(vFrom, hi, last, lo, { color: srVolColor, width: srVolWidth, style: STYLE[srVolStyle], bg: color.new(srVolColor, 90), extend: 'right' })
    if (vpLabelOn && vpOwn[j]) label(labelX, '매물대 ' + fmt(lo) + '~' + fmt(hi) + ' · ' + r.toFixed(1) + '배', { price: (lo + hi) / 2, style: 'text', align: 'right', textColor: srVolColor, size: 'tiny' })
  })
}

function prevPeriod(keyOf) {
  const cur = keyOf(time[last])
  let prevKey = null, h = -Infinity, l = Infinity
  for (let i = last; i >= 0; i--) {
    const k = keyOf(time[i])
    if (k === cur) continue
    if (prevKey === null) prevKey = k
    if (k !== prevKey) break
    h = Math.max(h, high[i])
    l = Math.min(l, low[i])
  }
  return prevKey === null ? [NaN, NaN] : [h, l]
}
const DAY = 86400000
const periods = [
  { on: srPrevDOn, nm: '전일', key: (t) => Math.floor(t / DAY) },
  { on: srPrevWOn, nm: '전주', key: (t) => Math.floor((t / DAY + 3) / 7) },
  { on: srPrevMOn, nm: '전월', key: (t) => new Date(t).getUTCFullYear() * 12 + new Date(t).getUTCMonth() },
]
  .filter((p) => p.on)
  .map((p) => ({ nm: p.nm, hl: prevPeriod(p.key) }))
for (const p of periods)
  p.hl.forEach((lvl, j) => {
    if (!Number.isFinite(lvl)) return
    line(last - 30, lvl, labelX, lvl, { color: srPrevColor, style: 'dashed' })
    if (srLabelOn) label(labelX, p.nm + (j === 0 ? ' 고가 ' : ' 저가 ') + fmt(lvl), { price: lvl, style: 'text', align: 'right', textColor: srPrevColor, size: 'tiny' })
  })

if (srDashOn) {
  const rows = []
  if (dashTitleOn) rows.push(titleRow('■ 지지 · 저항', TITLE_SR, (srRoundOn || srRoundMarkOn) && rStep > 0 ? '라운드 간격 ' + rStep : ''))
  rows.push(['구분 (근거)', '가격', '현재가 대비'])
  const items = [
    ...res.map((x, j) => ({ p: x.c.mean, nm: '저항 ' + (j + 1) + ' (' + x.tag + ')', txt: fmt(x.c.mean), col: srResColor })),
    ...sup.map((x, j) => ({ p: x.c.mean, nm: '지지 ' + (j + 1) + ' (' + x.tag + ')', txt: fmt(x.c.mean), col: srSupColor })),
    ...rnLevels.filter((_, k) => rnOwn[k]).map((lv) => ({ p: lv, nm: '라운드 넘버', txt: fmt(lv), col: srRoundColor })),
    ...vpShow.filter((_, j) => vpOwn[j]).map((z) => ({ p: (zones[z].lo + zones[z].hi) / 2, nm: '매물대 (' + zones[z].r.toFixed(1) + '배)', txt: fmt(zones[z].lo) + '~' + fmt(zones[z].hi), col: srVolColor })),
  ].sort((a, b) => b.p - a.p)
  const gap = (lvl) => (Number.isFinite(lvl) && now !== 0 ? ((lvl - now) / now) * 100 : NaN)
  const ladder = (nm, txt, lvl, col) => {
    const g = gap(lvl)
    rows.push([{ text: nm, color: col }, txt, { text: Number.isNaN(g) ? '-' : (g >= 0 ? '+' : '') + g.toFixed(2) + '%', color: col }])
  }
  let priceDone = false
  for (const it of items) {
    if (!priceDone && it.p <= now) {
      rows.push(priceRow())
      priceDone = true
    }
    ladder(it.nm, it.txt, it.p, it.col)
  }
  if (!priceDone) rows.push(priceRow())
  if (!items.length) rows.push(['표시할 지지 · 저항 없음', '', ''])
  for (const p of periods) {
    ladder(p.nm + ' 고가', fmt(p.hl[0]), p.hl[0], srPrevColor)
    ladder(p.nm + ' 저가', fmt(p.hl[1]), p.hl[1], srPrevColor)
  }
  box3(srPos, srSize, rows)
}
