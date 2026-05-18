import { useState, useEffect, useCallback } from 'react'
import {
  getAllPreorderCustomers, getCustomerOrderDetail,
  markOrderDelivered, markOrderPending,
} from '../services/api'

const FILTERS = [
  { id: 'pending', label: '待取貨' },
  { id: 'done',    label: '已完成' },
  { id: 'all',     label: '全部'   },
]

export default function OrdersPage({ onGoToPOS }) {
  const [customers,       setCustomers]       = useState([])
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [filter,          setFilter]          = useState('pending')
  const [expanded,        setExpanded]        = useState(null)
  const [details,         setDetails]         = useState({})
  const [detailLoading,   setDetailLoading]   = useState(false)
  const [actionLoading,   setActionLoading]   = useState(null)
  const [toast,           setToast]           = useState(null)

  const showToast = useCallback((msg, type = '') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setDetails({})
    getAllPreorderCustomers()
      .then(setCustomers)
      .catch(e => showToast('載入失敗：' + e.message, 'error'))
      .finally(() => setLoading(false))
  }, [showToast])

  useEffect(() => { load() }, [load])

  const handleExpand = async (orderId) => {
    if (expanded === orderId) { setExpanded(null); return }
    setExpanded(orderId)
    if (!details[orderId]) {
      setDetailLoading(true)
      try {
        const d = await getCustomerOrderDetail(orderId)
        setDetails(prev => ({ ...prev, [orderId]: d }))
      } catch {
        showToast('取得詳情失敗', 'error')
      } finally {
        setDetailLoading(false)
      }
    }
  }

  const handleComplete = async (e, customer) => {
    e.stopPropagation()
    setActionLoading(customer.order_id)
    try {
      await markOrderDelivered(customer.order_id)
      showToast(`✅ ${customer.customer_name} 已完成取貨`, 'success')
      setCustomers(prev => prev.map(c =>
        c.order_id === customer.order_id ? { ...c, status: 'paid' } : c
      ))
    } catch (e) {
      showToast('操作失敗：' + e.message, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleUndo = async (e, customer) => {
    e.stopPropagation()
    setActionLoading(customer.order_id)
    try {
      await markOrderPending(customer.order_id)
      showToast(`↩ ${customer.customer_name} 已還原為未取貨`, '')
      setCustomers(prev => prev.map(c =>
        c.order_id === customer.order_id ? { ...c, status: 'pending' } : c
      ))
    } catch (e) {
      showToast('操作失敗：' + e.message, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = customers
    .filter(c => {
      if (filter === 'pending') return c.status === 'pending'
      if (filter === 'done')    return c.status === 'paid'
      return true
    })
    .filter(c => !search || c.customer_name.includes(search))

  const pendingCount = customers.filter(c => c.status === 'pending').length
  const doneCount    = customers.filter(c => c.status === 'paid').length

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── 頂部：統計 + 搜尋 + 篩選 ──────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 pt-4 pb-3 shrink-0">
        {/* 統計數字 */}
        <div className="flex items-center gap-5 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-black text-amber-500">{pendingCount}</span>
            <span className="text-xs text-gray-400 leading-tight">待取貨<br/>客人</span>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className="text-3xl font-black text-green-600">{doneCount}</span>
            <span className="text-xs text-gray-400 leading-tight">已完成<br/>取貨</span>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className="text-3xl font-black text-gray-700">{customers.length}</span>
            <span className="text-xs text-gray-400 leading-tight">客人<br/>總數</span>
          </div>
          <button onClick={load}
            className="ml-auto px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50 active:bg-gray-100">
            ↺ 重新整理
          </button>
        </div>

        {/* 搜尋 + 篩選 */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="🔍 搜尋客人姓名…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-400"
          />
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold
                  ${filter === f.id ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 客人清單 ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
            <span className="text-5xl">
              {filter === 'pending' ? '🎉' : '📭'}
            </span>
            <p className="text-sm font-medium text-gray-400">
              {filter === 'pending' ? '所有客人都已取貨！' : '沒有符合的客人'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(customer => {
              const isDone      = customer.status === 'paid'
              const isExpanded  = expanded === customer.order_id
              const det         = details[customer.order_id]
              const isActioning = actionLoading === customer.order_id

              return (
                <div key={customer.order_id} className="bg-white">
                  {/* 客人主列 */}
                  <div
                    className="flex items-center gap-3 px-4 py-4 cursor-pointer select-none active:bg-gray-50"
                    onClick={() => handleExpand(customer.order_id)}
                  >
                    {/* 頭像圓圈 */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-black shrink-0
                      ${isDone ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-700'}`}>
                      {customer.customer_name.charAt(0)}
                    </div>

                    {/* 姓名 & 狀態 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800 text-base">{customer.customer_name}</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold
                          ${isDone ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isDone ? '✅ 已取貨' : '⏳ 待取貨'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">共 {customer.qty} 件商品</div>
                    </div>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {!isDone && (
                        <button
                          onClick={e => { e.stopPropagation(); onGoToPOS?.(customer.customer_name) }}
                          className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold active:bg-green-700"
                        >
                          🛒 前往收銀
                        </button>
                      )}
                      {!isDone ? (
                        <button
                          onClick={e => handleComplete(e, customer)}
                          disabled={isActioning}
                          className="px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-bold active:bg-gray-50 disabled:opacity-40"
                        >
                          {isActioning ? '…' : '✓ 標記取貨'}
                        </button>
                      ) : (
                        <button
                          onClick={e => handleUndo(e, customer)}
                          disabled={isActioning}
                          className="px-4 py-2.5 bg-white border border-gray-200 text-gray-400 rounded-xl text-sm font-medium active:bg-gray-50 disabled:opacity-40"
                        >
                          {isActioning ? '…' : '↩ 還原'}
                        </button>
                      )}
                    </div>

                    {/* 展開箭頭 */}
                    <span className="text-gray-300 text-sm shrink-0 transition-transform duration-200"
                      style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </div>

                  {/* 展開：品項明細 */}
                  {isExpanded && !det && (
                    <div className="px-4 py-5 bg-gray-50 border-t border-gray-100 flex justify-center">
                      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}

                  {isExpanded && det && (
                    <div className="px-4 pb-4 pt-3 bg-gray-50 border-t border-gray-100">
                      <div className="space-y-2">
                        {det.items.map((item, i) => (
                          <div key={i}
                            className={`flex items-center justify-between px-4 py-3 rounded-xl
                              ${!item.arrived ? 'bg-gray-100 opacity-50' : 'bg-white border border-gray-100'}`}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-gray-800">{item.product}</span>
                              {!item.arrived && <span className="text-[11px] text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">未到貨</span>}
                            </div>
                            <div className="text-sm text-gray-600 tabular-nums">
                              <span className="text-gray-400">×{item.qty}</span>
                              <span className="ml-2 font-bold">${item.subtotal.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 小計 */}
                      <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                        <span className="text-sm text-gray-500">已到貨應收</span>
                        <div className="text-right">
                          <span className="text-xl font-black text-green-700">${det.arrivedTotal.toLocaleString()}</span>
                          {det.arrivedTotal !== det.allTotal && (
                            <span className="text-xs text-gray-400 ml-2">（含未到貨共 ${det.allTotal.toLocaleString()}）</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-xl z-50 text-sm font-medium text-white whitespace-nowrap
          ${toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
