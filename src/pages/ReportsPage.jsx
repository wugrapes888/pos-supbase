import { useState, useEffect } from 'react'
import {
  getTodayStats, getTodaySales, getRevenueByDate, getProductSales,
  getProductProfit, getPurchaseBatches, savePurchaseBatch, deletePurchaseBatch, updatePurchaseBatch,
  getProfitByDate, getBatchProfit, getChannelStats,
} from '../services/api'

// ── 日期工具 ────────────────────────────────────────────────────

const fmtDate = d => d.toISOString().slice(0, 10)

function getDimRange(dim, customStart, customEnd) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (dim === 'custom')    return { start: customStart || fmtDate(today), end: customEnd || fmtDate(today) }
  if (dim === 'daily')     return { start: fmtDate(today), end: fmtDate(today) }
  if (dim === 'weekly') {
    const dow = today.getDay()
    const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6)
    return { start: fmtDate(mon), end: fmtDate(sun) }
  }
  if (dim === 'monthly') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1)
    const e = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { start: fmtDate(s), end: fmtDate(e) }
  }
  if (dim === 'quarterly') {
    const q = Math.floor(today.getMonth() / 3)
    const s = new Date(today.getFullYear(), q * 3, 1)
    const e = new Date(today.getFullYear(), q * 3 + 3, 0)
    return { start: fmtDate(s), end: fmtDate(e) }
  }
  return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` }
}

function getPrevRange({ start, end }) {
  const s = new Date(start), e = new Date(end)
  const days = Math.round((e - s) / 86400000) + 1
  const pe = new Date(s); pe.setDate(pe.getDate() - 1)
  const ps = new Date(pe); ps.setDate(pe.getDate() - days + 1)
  return { start: fmtDate(ps), end: fmtDate(pe) }
}

function sumRows(rows) {
  return rows.reduce((acc, r) => ({
    revenue:  acc.revenue  + r.revenue,
    orders:   acc.orders   + r.orders,
    cash:     acc.cash     + (r.cash     || 0),
    transfer: acc.transfer + (r.transfer || 0),
    linepay:  acc.linepay  + (r.linepay  || 0),
  }), { revenue: 0, orders: 0, cash: 0, transfer: 0, linepay: 0 })
}

function growthPct(curr, prev) {
  if (!prev) return null
  return Math.round((curr - prev) / prev * 100)
}

function groupForChart(rows, dim) {
  if (dim === 'yearly') {
    const map = {}
    rows.forEach(r => {
      const m = r.date.slice(0, 7)
      if (!map[m]) map[m] = { label: r.date.slice(5, 7) + '月', revenue: 0 }
      map[m].revenue += r.revenue
    })
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label))
  }
  if (dim === 'quarterly') {
    const map = {}
    rows.forEach(r => {
      const d = new Date(r.date)
      const dow = d.getDay()
      const mon = new Date(d); mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
      const key = fmtDate(mon)
      if (!map[key]) map[key] = { label: key.slice(5), revenue: 0 }
      map[key].revenue += r.revenue
    })
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label))
  }
  return rows.map(r => ({ label: r.date.slice(5), revenue: r.revenue }))
}

// ── 共用元件 ────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'green', growth }) {
  const colors = {
    green:  'bg-green-50  border-green-200  text-green-700',
    blue:   'bg-blue-50   border-blue-200   text-blue-700',
    amber:  'bg-amber-50  border-amber-200  text-amber-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    red:    'bg-red-50    border-red-200    text-red-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-black">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
      {growth != null && (
        <div className={`text-xs font-bold mt-1.5 ${growth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% vs 上期
        </div>
      )}
    </div>
  )
}

function PayBar({ cash, transfer, linepay, total }) {
  if (!total) return null
  const pct = v => Math.round(v / total * 100)
  return (
    <div className="mt-4">
      <div className="text-xs text-gray-500 mb-1.5 font-semibold uppercase tracking-wide">付款方式分佈</div>
      <div className="flex rounded-full overflow-hidden h-5 text-xs font-bold text-white">
        {cash     > 0 && <div style={{ width: pct(cash)     + '%' }} className="bg-green-500  flex items-center justify-center">{pct(cash)}%</div>}
        {transfer > 0 && <div style={{ width: pct(transfer) + '%' }} className="bg-blue-500   flex items-center justify-center">{pct(transfer)}%</div>}
        {linepay  > 0 && <div style={{ width: pct(linepay)  + '%' }} className="bg-emerald-400 flex items-center justify-center">{pct(linepay)}%</div>}
      </div>
      <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
        <span>💵 現金 ${cash.toLocaleString()}</span>
        <span>🏦 轉帳 ${transfer.toLocaleString()}</span>
        <span>💚 Line Pay ${linepay.toLocaleString()}</span>
      </div>
    </div>
  )
}

function TrendChart({ bars }) {
  if (!bars || bars.length === 0) return null
  const maxRev = Math.max(...bars.map(b => b.revenue), 1)
  const every  = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : 5
  return (
    <div>
      <div className="flex items-end gap-px h-28">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col justify-end"
            title={`${b.label}：$${b.revenue.toLocaleString()}`}
          >
            <div
              className="w-full bg-green-400 rounded-t-sm transition-all hover:bg-green-500"
              style={{ height: `${Math.max(b.revenue > 0 ? (b.revenue / maxRev * 100) : 0, b.revenue > 0 ? 2 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-px mt-1">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 text-center text-gray-400 overflow-hidden" style={{ fontSize: '10px' }}>
            {i % every === 0 ? b.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function groupProfitForChart(rows, dim) {
  const toBar = m => ({
    label: m.label,
    revenue: m.totalRevenue,
    grossProfit: m.totalProfit,
    marginPct: m.totalRevenue > 0 ? Math.round(m.totalProfit / m.totalRevenue * 100) : 0,
  })
  if (dim === 'yearly') {
    const map = {}
    rows.forEach(r => {
      const k = r.date.slice(0, 7)
      if (!map[k]) map[k] = { label: r.date.slice(5, 7) + '月', totalRevenue: 0, totalProfit: 0 }
      map[k].totalRevenue += r.revenue
      map[k].totalProfit  += (r.grossProfit || 0)
    })
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label)).map(toBar)
  }
  if (dim === 'quarterly') {
    const map = {}
    rows.forEach(r => {
      const d = new Date(r.date)
      const dow = d.getDay()
      const mon = new Date(d); mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
      const key = fmtDate(mon)
      if (!map[key]) map[key] = { label: key.slice(5), totalRevenue: 0, totalProfit: 0 }
      map[key].totalRevenue += r.revenue
      map[key].totalProfit  += (r.grossProfit || 0)
    })
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label)).map(toBar)
  }
  return rows.map(r => ({ label: r.date.slice(5), revenue: r.revenue, grossProfit: r.grossProfit || 0, marginPct: r.marginPct ?? 0 }))
}

function ProfitStackChart({ bars }) {
  if (!bars || bars.length === 0) return null
  const maxRev = Math.max(...bars.map(b => b.revenue), 1)
  const every  = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : 5
  return (
    <div>
      <div className="flex items-end gap-px h-28">
        {bars.map((b, i) => {
          const totalH     = b.revenue > 0 ? Math.max(b.revenue / maxRev * 100, 2) : 0
          const costRatio  = b.revenue > 0 ? Math.max(0, Math.min((b.revenue - b.grossProfit) / b.revenue, 1)) : 1
          const profitRatio = 1 - costRatio
          return (
            <div key={i} className="flex-1 flex flex-col justify-end"
                 title={`${b.label}：$${b.revenue?.toLocaleString()} | 毛利率${b.marginPct}%`}>
              <div className="w-full flex flex-col rounded-t-sm overflow-hidden"
                   style={{ height: totalH + '%' }}>
                <div className="w-full bg-green-400 hover:bg-green-500 transition-all"
                     style={{ height: (profitRatio * 100) + '%' }} />
                <div className="w-full bg-amber-300 hover:bg-amber-400 transition-all"
                     style={{ height: (costRatio * 100) + '%' }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-px mt-1">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 text-center text-gray-400 overflow-hidden" style={{ fontSize: '10px' }}>
            {i % every === 0 ? b.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

const DIMS = [
  { id: 'daily',     label: '日' },
  { id: 'weekly',    label: '週' },
  { id: 'monthly',   label: '月' },
  { id: 'quarterly', label: '季' },
  { id: 'yearly',    label: '年' },
  { id: 'custom',    label: '自訂' },
]

function TimePicker({ dim, setDim, customStart, setCustomStart, customEnd, setCustomEnd }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
        {DIMS.map(d => (
          <button
            key={d.id}
            onClick={() => setDim(d.id)}
            className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${
              dim === d.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {dim === 'custom' && (
        <div className="flex items-center gap-1.5 text-sm">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
          <span className="text-gray-400">—</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-7 h-7 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function downloadTodayCsv(sales, date) {
  const PAY_LABEL  = { cash: '現金', transfer: '轉帳', linepay: 'LINE Pay' }
  const TYPE_LABEL = { preorder: '預購', walkin: '散客' }

  const rows = [['日期', '時間', '客人姓名', '客人類型', '商品名稱', '數量', '單價', '小計', '付款方式', '員工']]
  sales.forEach(tx => {
    tx.items.forEach(item => {
      rows.push([
        date, tx.time, tx.customerName,
        TYPE_LABEL[tx.customerType] || tx.customerType,
        item.name, item.qty, item.price, item.subtotal,
        PAY_LABEL[tx.paymentMethod] || tx.paymentMethod,
        tx.staffName,
      ])
    })
  })

  const csv  = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `銷售明細_${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── 今日概況 Tab ────────────────────────────────────────────────

function TodayTab() {
  const [stats,      setStats]      = useState(null)
  const [sales,      setSales]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [showDetail, setShowDetail] = useState(false)

  const load = () => {
    setLoading(true); setError('')
    Promise.all([getTodayStats(), getTodaySales()])
      .then(([s, tx]) => { setStats(s); setSales(Array.isArray(tx) ? tx : []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const PAY_LABEL  = { cash: '💵 現金', transfer: '🏦 轉帳', linepay: '💚 LINE Pay' }
  const TYPE_LABEL = { preorder: '預購', walkin: '散客' }

  if (loading) return <Spinner />
  if (error)   return (
    <div className="text-center py-8 text-gray-400 text-sm">
      {error}
      <button onClick={load} className="ml-2 text-green-600 underline">重試</button>
    </div>
  )
  if (!stats) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-gray-400">{stats.date}</div>
        <div className="flex gap-2">
          {sales.length > 0 && (
            <button
              onClick={() => downloadTodayCsv(sales, stats.date)}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"
            >
              ⬇️ 下載 Excel
            </button>
          )}
          <button onClick={load} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">
            ↺ 重新整理
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="總收款"      value={`$${(stats.totalRevenue || 0).toLocaleString()}`} color="green" />
        <StatCard label="結帳筆數"    value={stats.txCount || 0} sub="筆" color="blue" />
        <StatCard label="平均客單"    value={`$${(stats.avgOrder || 0).toLocaleString()}`} color="amber" />
        <StatCard label="預購 / 散客" value={`${stats.preorderCount} / ${stats.walkCount}`}
          sub={`總 ${(stats.preorderCount || 0) + (stats.walkCount || 0)} 筆`} color="indigo" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
        <div className="text-sm font-bold text-gray-700 mb-3">付款方式明細</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-green-50 rounded-lg py-3">
            <div className="text-lg font-black text-green-700">${(stats.cashRevenue || 0).toLocaleString()}</div>
            <div className="text-xs text-green-500">💵 現金</div>
          </div>
          <div className="bg-blue-50 rounded-lg py-3">
            <div className="text-lg font-black text-blue-700">${(stats.transferRevenue || 0).toLocaleString()}</div>
            <div className="text-xs text-blue-500">🏦 轉帳</div>
          </div>
          <div className="bg-emerald-50 rounded-lg py-3">
            <div className="text-lg font-black text-emerald-700">${(stats.linepayRevenue || 0).toLocaleString()}</div>
            <div className="text-xs text-emerald-500">💚 Line Pay</div>
          </div>
        </div>
        <PayBar cash={stats.cashRevenue||0} transfer={stats.transferRevenue||0} linepay={stats.linepayRevenue||0} total={stats.totalRevenue||0} />
      </div>

      {sales.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-5">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 rounded-xl"
            onClick={() => setShowDetail(v => !v)}
          >
            <span>今日購買明細（{sales.length} 筆）</span>
            <span className="text-gray-400 text-xs">{showDetail ? '▲ 收起' : '▼ 展開'}</span>
          </button>

          {showDetail && (
            <div className="border-t border-gray-100">
              {sales.map((tx, ti) => (
                <div key={ti} className="border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50">
                    <span className="text-xs text-gray-400 font-mono w-16 shrink-0">{tx.time.slice(0, 5)}</span>
                    <span className="font-semibold text-gray-800 text-sm">{tx.customerName}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0
                      ${tx.customerType === 'preorder' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                      {TYPE_LABEL[tx.customerType] || tx.customerType}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">{PAY_LABEL[tx.paymentMethod] || tx.paymentMethod}</span>
                    {tx.staffName && <span className="text-xs text-gray-400 ml-auto shrink-0">{tx.staffName}</span>}
                  </div>
                  <div className="px-4 py-2 space-y-1">
                    {tx.items.map((item, ii) => (
                      <div key={ii} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{item.name} <span className="text-gray-400 text-xs">×{item.qty}</span></span>
                        <span className="font-semibold text-gray-800">${item.subtotal.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1 border-t border-gray-100 text-sm font-bold">
                      <span className="text-gray-500">小計</span>
                      <span className="text-green-700">${tx.total.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {stats.stockSummary?.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">今日庫存</h2>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left   text-xs text-gray-500 font-bold">商品</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-500 font-bold">開攤</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-500 font-bold">售出</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-500 font-bold">結餘</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-500 font-bold">狀態</th>
                </tr>
              </thead>
              <tbody>
                {stats.stockSummary.map((row, i) => {
                  const isSoldOut = row.remaining === 0
                  const isLow     = row.remaining > 0 && row.remaining <= 3
                  return (
                    <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{row.name}</td>
                      <td className="px-4 py-2.5 text-center text-gray-500">{row.openStock}</td>
                      <td className="px-4 py-2.5 text-center text-gray-700 font-semibold">{row.sold}</td>
                      <td className="px-4 py-2.5 text-center font-bold">
                        <span className={isSoldOut ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-green-600'}>
                          {row.remaining}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isSoldOut
                          ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">售罄</span>
                          : isLow
                          ? <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-bold">偏低</span>
                          : <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">正常</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── 營收總覽 Tab ────────────────────────────────────────────────

function RevenueTab() {
  const today = fmtDate(new Date())
  const [dim,         setDim]         = useState('yearly')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd,   setCustomEnd]   = useState(today)
  const [loading,     setLoading]     = useState(false)
  const [currRows,    setCurrRows]    = useState([])
  const [prevRows,    setPrevRows]    = useState([])
  const [loadError,   setLoadError]   = useState('')

  useEffect(() => {
    if (dim === 'custom' && (!customStart || !customEnd || customStart > customEnd)) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    const range = getDimRange(dim, customStart, customEnd)
    const prev  = getPrevRange(range)
    Promise.all([
      getRevenueByDate(range.start, range.end),
      getRevenueByDate(prev.start,  prev.end),
    ]).then(([c, p]) => {
      if (!cancelled) { setCurrRows(Array.isArray(c) ? c : []); setPrevRows(Array.isArray(p) ? p : []) }
    }).catch(err => {
      if (!cancelled) { setCurrRows([]); setPrevRows([]); setLoadError(err.message) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dim, customStart, customEnd])

  const range = getDimRange(dim, customStart, customEnd)
  const curr  = sumRows(currRows)
  const prev  = sumRows(prevRows)
  const aov   = curr.orders ? Math.round(curr.revenue / curr.orders) : 0
  const paov  = prev.orders ? Math.round(prev.revenue / prev.orders) : 0
  const bars  = groupForChart(currRows, dim)

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <TimePicker dim={dim} setDim={setDim}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd}     setCustomEnd={setCustomEnd} />
      </div>
      <div className="text-xs text-gray-400 mb-4">{range.start} ～ {range.end}</div>

      {loading ? <Spinner /> : loadError ? (
        <div className="text-center py-8 text-red-400 text-sm bg-red-50 rounded-xl p-4">
          <div className="font-bold mb-1">載入失敗</div>
          <div className="font-mono text-xs">{loadError}</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            <StatCard label="總收款"   value={`$${curr.revenue.toLocaleString()}`}  color="green" growth={growthPct(curr.revenue, prev.revenue)} />
            <StatCard label="結帳筆數" value={curr.orders} sub="筆"                 color="blue"  growth={growthPct(curr.orders,  prev.orders)}  />
            <StatCard label="平均客單" value={`$${aov.toLocaleString()}`}           color="amber" growth={growthPct(aov, paov)} />
          </div>

          {bars.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
              <div className="text-sm font-bold text-gray-700 mb-3">收款趨勢</div>
              <TrendChart bars={bars} />
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-sm font-bold text-gray-700 mb-3">付款方式明細</div>
            <div className="grid grid-cols-3 gap-3 text-center mb-1">
              <div className="bg-green-50 rounded-lg py-3">
                <div className="text-lg font-black text-green-700">${curr.cash.toLocaleString()}</div>
                <div className="text-xs text-green-500">💵 現金</div>
              </div>
              <div className="bg-blue-50 rounded-lg py-3">
                <div className="text-lg font-black text-blue-700">${curr.transfer.toLocaleString()}</div>
                <div className="text-xs text-blue-500">🏦 轉帳</div>
              </div>
              <div className="bg-emerald-50 rounded-lg py-3">
                <div className="text-lg font-black text-emerald-700">${curr.linepay.toLocaleString()}</div>
                <div className="text-xs text-emerald-500">💚 Line Pay</div>
              </div>
            </div>
            <PayBar cash={curr.cash} transfer={curr.transfer} linepay={curr.linepay} total={curr.revenue} />
          </div>
        </>
      )}
    </div>
  )
}

// ── 產品銷售 Tab ────────────────────────────────────────────────

function ProductTab() {
  const today = fmtDate(new Date())
  const [dim,         setDim]         = useState('yearly')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd,   setCustomEnd]   = useState(today)
  const [loading,     setLoading]     = useState(false)
  const [products,    setProducts]    = useState([])
  const [topN,        setTopN]        = useState(10)
  const [sortBy,      setSortBy]      = useState('amount')
  const [loadError,   setLoadError]   = useState('')

  useEffect(() => {
    if (dim === 'custom' && (!customStart || !customEnd || customStart > customEnd)) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    const range = getDimRange(dim, customStart, customEnd)
    getProductSales(range.start, range.end)
      .then(data => { if (!cancelled) setProducts(Array.isArray(data) ? data : []) })
      .catch(err => { if (!cancelled) { setProducts([]); setLoadError(err.message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dim, customStart, customEnd])

  const range     = getDimRange(dim, customStart, customEnd)
  const totalRev  = products.reduce((s, p) => s + p.amount, 0)
  const sorted    = [...products].sort((a, b) => sortBy === 'amount' ? b.amount - a.amount : b.qty - a.qty)
  const displayed = sorted.slice(0, topN)
  const maxAmount = displayed[0]?.amount || 1

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <TimePicker dim={dim} setDim={setDim}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd}     setCustomEnd={setCustomEnd} />
      </div>
      <div className="text-xs text-gray-400 mb-4">{range.start} ～ {range.end}</div>

      {loading ? <Spinner /> : (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {[5, 10, 20].map(n => (
                <button key={n} onClick={() => setTopN(n)}
                  className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${topN === n ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  Top {n}
                </button>
              ))}
            </div>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              <button onClick={() => setSortBy('amount')}
                className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${sortBy === 'amount' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                依金額
              </button>
              <button onClick={() => setSortBy('qty')}
                className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${sortBy === 'qty' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                依數量
              </button>
            </div>
          </div>

          {loadError ? (
            <div className="text-center py-8 text-red-400 text-sm bg-red-50 rounded-xl p-4">
              <div className="font-bold mb-1">載入失敗</div>
              <div className="font-mono text-xs">{loadError}</div>
            </div>
          ) : displayed.length === 0
            ? <div className="text-center py-10 text-gray-300 text-sm">此期間無銷售資料</div>
            : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold w-8">#</th>
                      <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">商品名稱</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">數量</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">金額</th>
                      <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold w-32">佔比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((p, i) => {
                      const share = totalRev ? Math.round(p.amount / totalRev * 100) : 0
                      const barW  = Math.round(p.amount / maxAmount * 100)
                      return (
                        <tr key={p.name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-gray-400 font-bold text-xs">{i + 1}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{p.name}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{p.qty.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-gray-800">${p.amount.toLocaleString()}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                                <div className="bg-green-400 h-1.5 rounded-full" style={{ width: barW + '%' }} />
                              </div>
                              <span className="text-xs text-gray-400 w-7 text-right">{share}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </>
      )}
    </div>
  )
}

// ── 進貨批次管理 ────────────────────────────────────────────────

function BatchManagementSection() {
  const today = fmtDate(new Date())
  const [batches,      setBatches]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [sortBy,       setSortBy]       = useState('date')
  const [filterProduct, setFilterProduct] = useState('')
  const [pendingEdits, setPendingEdits] = useState({})
  const [form, setForm] = useState({ product: '', purchaseDate: today, qty: '', unit: '', unitCost: '', note: '' })

  const load = () => {
    setLoading(true)
    getPurchaseBatches()
      .then(data => setBatches(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!form.product.trim() || !form.purchaseDate || !form.qty || !form.unitCost) return
    setSaving(true)
    try {
      await savePurchaseBatch(form.product.trim(), form.purchaseDate, Number(form.qty), form.unit, Number(form.unitCost), form.note)
      load()
      setShowForm(false)
      setForm({ product: '', purchaseDate: today, qty: '', unit: '', unitCost: '', note: '' })
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    await deletePurchaseBatch(id)
    load()
  }

  const handleFieldChange = (id, field, value) => {
    setPendingEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }))
  }

  const handleFieldBlur = async (b, field) => {
    const pending = pendingEdits[b.id]
    if (!pending || pending[field] === undefined) return
    const value = pending[field]
    setPendingEdits(prev => {
      const updated = { ...(prev[b.id] || {}) }
      delete updated[field]
      return { ...prev, [b.id]: updated }
    })
    if (field === 'product'      && (!value.trim() || value.trim() === b.product)) return
    if (field === 'purchaseDate' && (!value || value === b.purchaseDate)) return
    if (field === 'unit'         && value === b.unit) return
    if (field === 'qty') {
      const n = Number(value); if (!value || isNaN(n) || n <= 0 || n === b.qty) return
    }
    if (field === 'unitCost') {
      const n = Number(value); if (!value || isNaN(n) || n <= 0 || n === b.unitCost) return
    }
    const isString = field === 'product' || field === 'purchaseDate' || field === 'unit'
    await updatePurchaseBatch(b.id, { [field]: isString ? (value.trim?.() ?? value) : Number(value) })
    load()
  }

  const displayField     = (b, field) => pendingEdits[b.id]?.[field] !== undefined ? pendingEdits[b.id][field] : b[field]
  const displayTotalCost = b => {
    const q = pendingEdits[b.id]?.qty      !== undefined ? Number(pendingEdits[b.id].qty)      : b.qty
    const c = pendingEdits[b.id]?.unitCost !== undefined ? Number(pendingEdits[b.id].unitCost) : b.unitCost
    return (isNaN(q) || q <= 0 || isNaN(c) || c <= 0) ? b.totalCost : q * c
  }

  const products        = [...new Set(batches.map(b => b.product))]
  const totalInvestment = batches.reduce((s, b) => s + displayTotalCost(b), 0)
  const filtered        = batches.filter(b => !filterProduct || b.product === filterProduct)
  const sorted          = [...filtered].sort((a, b) => {
    if (sortBy === 'product') return a.product.localeCompare(b.product)
    if (sortBy === 'cost')    return b.unitCost - a.unitCost
    return b.purchaseDate.localeCompare(a.purchaseDate)
  })

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="進貨批次"   value={batches.length} sub="筆" color="blue" />
        <StatCard label="品項種類"   value={products.length} sub="種" color="amber" />
        <StatCard label="總進貨金額" value={`$${totalInvestment.toLocaleString()}`} color="green" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white">
              <option value="">全部商品</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {[{id:'date',label:'日期'},{id:'product',label:'商品'},{id:'cost',label:'成本'}].map(s => (
                <button key={s.id} onClick={() => setSortBy(s.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${sortBy === s.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">
            + 新增批次
          </button>
        </div>

        {loading ? <Spinner /> : (
          sorted.length === 0 && !showForm ? (
            <div className="text-center py-10 text-gray-300 text-sm">尚未記錄任何進貨批次，點右上角「+ 新增批次」開始記錄</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">商品</th>
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">進貨日</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">數量</th>
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">單位</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">單位成本</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">總成本</th>
                  <th className="px-3 py-2.5 text-center text-xs text-gray-500 font-bold">剩餘庫存</th>
                  <th className="px-3 py-2.5 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {showForm && (
                  <tr className="border-b-2 border-green-300 bg-green-50">
                    <td className="px-2 py-2">
                      <input placeholder="商品名稱 *" value={form.product}
                        onChange={e => setForm(f => ({...f, product: e.target.value}))}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:border-green-400 bg-white" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" value={form.purchaseDate}
                        onChange={e => setForm(f => ({...f, purchaseDate: e.target.value}))}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-green-400 bg-white" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" placeholder="50" value={form.qty}
                        onChange={e => setForm(f => ({...f, qty: e.target.value}))}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:border-green-400 bg-white text-right" />
                    </td>
                    <td className="px-2 py-2">
                      <input placeholder="個/盒/串" value={form.unit}
                        onChange={e => setForm(f => ({...f, unit: e.target.value}))}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:border-green-400 bg-white" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-0.5">
                        <span className="text-gray-400 text-xs">$</span>
                        <input type="number" placeholder="80" value={form.unitCost}
                          onChange={e => setForm(f => ({...f, unitCost: e.target.value}))}
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:border-green-400 bg-white text-right" />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 text-sm font-semibold">
                      {form.qty && form.unitCost
                        ? `$${(Number(form.qty) * Number(form.unitCost)).toLocaleString()}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      <input placeholder="備註" value={form.note}
                        onChange={e => setForm(f => ({...f, note: e.target.value}))}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-green-400 bg-white" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <button onClick={handleSave}
                          disabled={saving || !form.product.trim() || !form.qty || !form.unitCost}
                          title="儲存"
                          className="w-7 h-7 bg-green-500 hover:bg-green-600 text-white rounded-full text-sm font-bold disabled:opacity-40 flex items-center justify-center">
                          ✓
                        </button>
                        <button onClick={() => { setShowForm(false); setForm({ product: '', purchaseDate: today, qty: '', unit: '', unitCost: '', note: '' }) }}
                          title="取消"
                          className="w-7 h-7 bg-gray-200 hover:bg-gray-300 text-gray-500 rounded-full text-sm font-bold flex items-center justify-center">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {sorted.map((b, i) => {
                  const pct   = b.qty > 0 ? Math.round(b.remainingQty / b.qty * 100) : 0
                  const isOut = b.remainingQty === 0
                  const isLow = !isOut && pct <= 20
                  const cellCls = "border-b border-transparent hover:border-gray-300 focus:border-green-500 outline-none bg-transparent py-0.5 transition-colors"
                  return (
                    <tr key={b.id ?? i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-1.5">
                        <input value={displayField(b, 'product')}
                          onChange={e => handleFieldChange(b.id, 'product', e.target.value)}
                          onBlur={() => handleFieldBlur(b, 'product')}
                          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                          className={`w-full font-medium text-gray-800 text-sm ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="date" value={displayField(b, 'purchaseDate')}
                          onChange={e => handleFieldChange(b.id, 'purchaseDate', e.target.value)}
                          onBlur={() => handleFieldBlur(b, 'purchaseDate')}
                          className={`text-gray-500 text-xs ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" value={displayField(b, 'qty')}
                          onChange={e => handleFieldChange(b.id, 'qty', e.target.value)}
                          onBlur={() => handleFieldBlur(b, 'qty')}
                          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                          className={`w-16 text-right text-gray-600 ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input value={displayField(b, 'unit')}
                          onChange={e => handleFieldChange(b.id, 'unit', e.target.value)}
                          onBlur={() => handleFieldBlur(b, 'unit')}
                          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                          className={`w-10 text-gray-500 text-xs ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-gray-400 text-xs">$</span>
                          <input type="number" value={displayField(b, 'unitCost')}
                            onChange={e => handleFieldChange(b.id, 'unitCost', e.target.value)}
                            onBlur={() => handleFieldBlur(b, 'unitCost')}
                            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                            className={`w-16 text-right font-bold text-gray-800 ${cellCls}`} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600">${displayTotalCost(b).toLocaleString()}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-10">
                            <div className={`h-1.5 rounded-full ${isOut ? 'bg-red-300' : isLow ? 'bg-amber-400' : 'bg-green-400'}`}
                                 style={{ width: pct + '%' }} />
                          </div>
                          <span className={`text-xs font-bold w-6 text-right ${isOut ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-gray-600'}`}>
                            {b.remainingQty}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => handleDelete(b.id ?? i)}
                          className="text-red-300 hover:text-red-500 text-xs leading-none" title="刪除">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

// ── 毛利報表 ─────────────────────────────────────────────────────

function ProfitReportSection() {
  const today = fmtDate(new Date())
  const [dim,         setDim]         = useState('yearly')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd,   setCustomEnd]   = useState(today)
  const [loading,     setLoading]     = useState(false)
  const [profitData,  setProfitData]  = useState([])
  const [trendData,   setTrendData]   = useState([])
  const [channelData, setChannelData] = useState([])
  const [sortBy,      setSortBy]      = useState('margin')
  const [loadError,   setLoadError]   = useState('')

  useEffect(() => {
    if (dim === 'custom' && (!customStart || !customEnd || customStart > customEnd)) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    const range = getDimRange(dim, customStart, customEnd)
    Promise.all([
      getProductProfit(range.start, range.end),
      getProfitByDate(range.start, range.end),
      getChannelStats(range.start, range.end),
    ])
      .then(([profit, trend, ch]) => {
        if (!cancelled) {
          setProfitData(Array.isArray(profit) ? profit : [])
          setTrendData(Array.isArray(trend) ? trend : [])
          setChannelData(Array.isArray(ch) ? ch : [])
        }
      })
      .catch(err => { if (!cancelled) { setProfitData([]); setTrendData([]); setChannelData([]); setLoadError(err.message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dim, customStart, customEnd])

  const range         = getDimRange(dim, customStart, customEnd)
  const withCost      = profitData.filter(p => p.grossMargin !== null)
  const totalRev      = withCost.reduce((s, p) => s + p.amount, 0)
  const totalCost     = withCost.reduce((s, p) => s + (p.totalCost || 0), 0)
  const totalProfit   = withCost.reduce((s, p) => s + p.grossProfit, 0)
  const overallMargin = totalRev > 0 ? Math.round(totalProfit / totalRev * 100) : null

  const trendBars = groupProfitForChart(trendData, dim)
  const sorted    = [...profitData].sort((a, b) => {
    if (sortBy === 'margin')  return (b.grossMargin ?? -999) - (a.grossMargin ?? -999)
    if (sortBy === 'profit')  return (b.grossProfit ?? 0)    - (a.grossProfit ?? 0)
    return b.amount - a.amount
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <TimePicker dim={dim} setDim={setDim}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd}     setCustomEnd={setCustomEnd} />
      </div>
      <div className="text-xs text-gray-400 mb-4">{range.start} ～ {range.end}</div>

      {loading ? <Spinner /> : loadError ? (
        <div className="text-center py-8 text-red-400 text-sm bg-red-50 rounded-xl p-4">
          <div className="font-bold mb-1">載入失敗</div>
          <div className="font-mono text-xs">{loadError}</div>
        </div>
      ) : profitData.length === 0 ? (
        <div className="text-center py-8 text-gray-300 text-sm">此期間無銷售資料</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatCard label="銷售額"   value={`$${totalRev.toLocaleString()}`}    color="blue"  />
            <StatCard label="進貨成本" value={`$${totalCost.toLocaleString()}`}   color="amber" />
            <StatCard label="毛利"     value={`$${totalProfit.toLocaleString()}`} color="green" />
            {overallMargin !== null && (
              <StatCard label="整體毛利率" value={`${overallMargin}%`}
                color={overallMargin >= 30 ? 'green' : overallMargin >= 20 ? 'amber' : 'red'} />
            )}
          </div>

          {withCost.filter(p => p.grossMargin < 20).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5">
              <div className="text-xs font-bold text-red-600 mb-1.5">⚠ 低毛利警示（毛利率 &lt; 20%）</div>
              <div className="flex flex-wrap gap-1.5">
                {withCost.filter(p => p.grossMargin < 20).map(p => (
                  <span key={p.name} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">
                    {p.name} {p.grossMargin}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {trendBars.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-700">成本 vs 毛利趨勢</div>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-2 bg-green-400 inline-block rounded-sm" />毛利
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-2 bg-amber-300 inline-block rounded-sm" />成本
                  </span>
                </div>
              </div>
              <ProfitStackChart bars={trendBars} />
            </div>
          )}

          {channelData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
              <div className="text-sm font-bold text-gray-700 mb-3">通路分析</div>
              {(() => {
                const totalChRev = channelData.reduce((s, c) => s + c.revenue, 0)
                return channelData.map((c, i) => {
                  const share = totalChRev > 0 ? Math.round(c.revenue / totalChRev * 100) : 0
                  const COLOR = ['bg-blue-500', 'bg-indigo-500', 'bg-emerald-500']
                  return (
                    <div key={i} className="flex items-center gap-3 mb-2 last:mb-0">
                      <div className="w-14 text-xs font-semibold text-gray-600 shrink-0">{c.channelLabel}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className={`h-2 rounded-full ${COLOR[i] || 'bg-gray-400'}`} style={{ width: share + '%' }} />
                      </div>
                      <div className="text-xs text-gray-500 w-16 text-right">${c.revenue.toLocaleString()}</div>
                      <div className="text-xs text-gray-400 w-8 text-right">{share}%</div>
                      <div className="text-xs text-gray-400 w-12 text-right">{c.orders}筆</div>
                    </div>
                  )
                })
              })()}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-bold text-gray-700">產品毛利明細</div>
              <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                {[{id:'margin',label:'毛利率'},{id:'profit',label:'毛利額'},{id:'revenue',label:'銷售額'}].map(s => (
                  <button key={s.id} onClick={() => setSortBy(s.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${sortBy === s.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">商品</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">數量</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">銷售額</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">成本</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">毛利</th>
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold w-36">毛利率</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => {
                  const m     = p.grossMargin
                  const mc    = m === null ? 'gray' : m >= 30 ? 'green' : m >= 20 ? 'amber' : 'red'
                  const badge = { green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-600', gray: 'bg-gray-100 text-gray-400' }[mc]
                  const bar   = { green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-400', gray: 'bg-gray-200' }[mc]
                  return (
                    <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-800">{p.name}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{p.qty}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">${p.amount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">
                        {p.totalCost !== null ? `$${p.totalCost.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold">
                        {p.grossProfit !== null
                          ? <span className={p.grossProfit < 0 ? 'text-red-600' : 'text-gray-800'}>${p.grossProfit.toLocaleString()}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {m !== null ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 bg-gray-100 rounded-full h-1.5 shrink-0">
                              <div className={`h-1.5 rounded-full ${bar}`} style={{ width: Math.min(m, 100) + '%' }} />
                            </div>
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${badge}`}>{m}%</span>
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">未設定</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── 批次毛利分析 ────────────────────────────────────────────────

function BatchProfitSection() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy,  setSortBy]  = useState('margin')

  useEffect(() => {
    setLoading(true)
    getBatchProfit()
      .then(data => setBatches(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  const sorted        = [...batches].sort((a, b) => {
    if (sortBy === 'margin')  return (b.grossMargin ?? -999) - (a.grossMargin ?? -999)
    if (sortBy === 'profit')  return (b.grossProfit ?? 0)    - (a.grossProfit ?? 0)
    return b.purchaseDate.localeCompare(a.purchaseDate)
  })
  const totalSoldCost = batches.reduce((s, b) => s + b.soldCost, 0)
  const totalBatchRev = batches.reduce((s, b) => s + (b.batchRevenue || 0), 0)
  const totalProfit   = batches.reduce((s, b) => s + (b.grossProfit || 0), 0)
  const overallMargin = totalBatchRev > 0 ? Math.round(totalProfit / totalBatchRev * 100) : null

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="批次總數"   value={batches.length} sub="筆" color="blue" />
        <StatCard label="已售成本"   value={`$${totalSoldCost.toLocaleString()}`}  color="amber" />
        <StatCard label="估算收入"   value={`$${totalBatchRev.toLocaleString()}`}  color="indigo" />
        {overallMargin !== null && (
          <StatCard label="整體毛利率" value={`${overallMargin}%`}
            color={overallMargin >= 30 ? 'green' : overallMargin >= 20 ? 'amber' : 'red'} />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-bold text-gray-700">批次毛利明細</div>
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {[{id:'margin',label:'毛利率'},{id:'profit',label:'毛利額'},{id:'date',label:'日期'}].map(s => (
              <button key={s.id} onClick={() => setSortBy(s.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${sortBy === s.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? <Spinner /> : sorted.length === 0 ? (
          <div className="text-center py-10 text-gray-300 text-sm">尚未有批次資料</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">商品</th>
                <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">進貨日</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">進貨數</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">已售數</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">已售成本</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">估算收入</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">批次毛利</th>
                <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold w-32">毛利率</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => {
                const m     = b.grossMargin
                const mc    = m === null ? 'gray' : m >= 30 ? 'green' : m >= 20 ? 'amber' : 'red'
                const badge = { green:'bg-green-100 text-green-700', amber:'bg-amber-100 text-amber-700', red:'bg-red-100 text-red-600', gray:'bg-gray-100 text-gray-400' }[mc]
                const bar   = { green:'bg-green-400', amber:'bg-amber-400', red:'bg-red-400', gray:'bg-gray-200' }[mc]
                return (
                  <tr key={b.id ?? i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-800">{b.product}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{b.purchaseDate}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{b.batchQty}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{b.soldQty}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">${b.soldCost.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {b.batchRevenue > 0 ? `$${b.batchRevenue.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">
                      {b.grossProfit !== null
                        ? <span className={b.grossProfit < 0 ? 'text-red-600' : 'text-gray-800'}>${b.grossProfit.toLocaleString()}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {m !== null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 bg-gray-100 rounded-full h-1.5 shrink-0">
                            <div className={`h-1.5 rounded-full ${bar}`} style={{ width: Math.min(m, 100) + '%' }} />
                          </div>
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${badge}`}>{m}%</span>
                        </div>
                      ) : <span className="text-gray-300 text-xs">未設定</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── 毛利分析 Tab ────────────────────────────────────────────────

function ProfitTab() {
  const [subTab, setSubTab] = useState('report')
  return (
    <div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5 w-fit">
        {[{id:'report',label:'毛利報表'},{id:'batch',label:'批次分析'},{id:'batches',label:'進貨管理'}].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              subTab === t.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'report'  && <ProfitReportSection />}
      {subTab === 'batch'   && <BatchProfitSection />}
      {subTab === 'batches' && <BatchManagementSection />}
    </div>
  )
}

// ── 毛利試算 Tab ────────────────────────────────────────────────

function CalculatorTab() {
  const [price,        setPrice]        = useState('')
  const [cost,         setCost]         = useState('')
  const [qty,          setQty]          = useState('')
  const [targetMargin, setTargetMargin] = useState('')

  const p  = parseFloat(price)        || 0
  const c  = parseFloat(cost)         || 0
  const q  = parseInt(qty)            || 0
  const tm = parseFloat(targetMargin) || 0

  const unitProfit     = p > 0 && c > 0 ? p - c : null
  const margin         = p > 0 && c > 0 ? (p - c) / p * 100 : null
  const totalProfit    = unitProfit !== null && q > 0 ? unitProfit * q : null
  const suggestedPrice = c > 0 && tm > 0 && tm < 100 ? Math.ceil(c / (1 - tm / 100)) : null

  const hasResult = p > 0 && c > 0

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="text-sm font-bold text-gray-700 mb-4">輸入資料</div>
        <div className="grid gap-3">
          {[
            { label: '售價',     value: price, set: setPrice, placeholder: '150', prefix: '$' },
            { label: '進貨成本', value: cost,  set: setCost,  placeholder: '80',  prefix: '$' },
          ].map(({ label, value, set, placeholder, prefix }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-20 shrink-0">{label}</span>
              <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <span className="px-3 py-2 bg-gray-50 text-gray-400 text-sm border-r border-gray-200">{prefix}</span>
                <input type="number" placeholder={placeholder} value={value}
                  onChange={e => set(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm outline-none" />
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 w-20 shrink-0">數量（選用）</span>
            <input type="number" placeholder="10" value={qty}
              onChange={e => setQty(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
        </div>
      </div>

      {hasResult && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">單件毛利</div>
            <div className="text-2xl font-black text-green-700">${unitProfit}</div>
          </div>
          <div className={`border rounded-xl p-4 text-center ${margin < 20 ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${margin < 20 ? 'text-red-500' : 'text-blue-600'}`}>毛利率</div>
            <div className={`text-2xl font-black ${margin < 20 ? 'text-red-600' : 'text-blue-700'}`}>
              {margin.toFixed(1)}%
            </div>
            {margin < 20 && <div className="text-xs text-red-400 mt-1">偏低</div>}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
              {q > 0 ? `總毛利 ×${q}` : '總毛利'}
            </div>
            <div className="text-2xl font-black text-amber-700">
              {totalProfit !== null ? `$${totalProfit.toLocaleString()}` : '—'}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="text-sm font-bold text-gray-700 mb-3">目標毛利率 → 建議售價</div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600 w-20 shrink-0">目標毛利率</span>
          <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <input type="number" placeholder="40" value={targetMargin}
              onChange={e => setTargetMargin(e.target.value)}
              className="flex-1 px-3 py-2 text-sm outline-none" />
            <span className="px-3 py-2 bg-gray-50 text-gray-400 text-sm border-l border-gray-200">%</span>
          </div>
        </div>
        {suggestedPrice ? (
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <div className="text-xs text-green-600 font-semibold mb-1">建議售價（無條件進位）</div>
            <div className="text-3xl font-black text-green-700">${suggestedPrice}</div>
            {c > 0 && (
              <div className="text-xs text-green-500 mt-1.5">
                成本 ${c} ÷ (1 − {targetMargin}%) = ${suggestedPrice}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-3 text-gray-300 text-sm">
            輸入進貨成本與目標毛利率後顯示建議售價
          </div>
        )}
      </div>
    </div>
  )
}

// ── 主頁面 ──────────────────────────────────────────────────────

const TABS = [
  { id: 'today',      label: '今日概況' },
  { id: 'revenue',    label: '營收總覽' },
  { id: 'product',    label: '產品銷售' },
  { id: 'profit',     label: '毛利分析' },
  { id: 'calculator', label: '毛利試算' },
]

export default function ReportsPage() {
  const [tab, setTab] = useState('today')

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-black text-gray-800 mb-4">📊 報表中心</h1>

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'today'      && <TodayTab />}
        {tab === 'revenue'    && <RevenueTab />}
        {tab === 'product'    && <ProductTab />}
        {tab === 'profit'     && <ProfitTab />}
        {tab === 'calculator' && <CalculatorTab />}
      </div>
    </div>
  )
}
