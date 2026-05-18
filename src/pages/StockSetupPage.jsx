import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  BARCODE_READER_CONFIG, BARCODE_SCAN_CONFIG,
  normalizeBarcodeText, stopBarcodeScanner,
} from '../utils/barcodeScanner'
import {
  getProducts, saveProduct, deleteProduct,
  getDailyStocks, setDailyStock,
  getPurchaseBatches, savePurchaseBatch, updatePurchaseBatch, deletePurchaseBatch,
} from '../services/api'

// ── 條碼掃描 Modal ─────────────────────────────────────────
const SETUP_SCANNER_ID = 'barcode-setup-reader'

function BarcodeScannerModal({ onDetect, onClose }) {
  const scannerRef  = useRef(null)
  const detectedRef = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    try {
      const scanner = new Html5Qrcode(SETUP_SCANNER_ID, BARCODE_READER_CONFIG)
      scannerRef.current = scanner
      scanner.start(
        { facingMode: { ideal: 'environment' } },
        BARCODE_SCAN_CONFIG,
        (code) => {
          if (detectedRef.current) return
          const n = normalizeBarcodeText(code)
          if (n.length < 4) return
          detectedRef.current = true
          stopBarcodeScanner(scanner).finally(() => onDetect(n))
        },
        () => {}
      ).catch(() => { if (!cancelled) setError('相機啟動失敗，請確認瀏覽器已允許相機權限。') })
    } catch {
      Promise.resolve().then(() => { if (!cancelled) setError('相機掃描器載入失敗。') })
    }
    return () => { cancelled = true; stopBarcodeScanner(scannerRef.current) }
  }, [onDetect])

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-gray-800 text-lg">掃描條碼</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div id={SETUP_SCANNER_ID} className="w-full overflow-hidden rounded-xl" />
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <p className="text-xs text-gray-400 text-center">將商品條碼橫放並填滿框線，自動辨識後綁定品項</p>
      </div>
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

function MiniStat({ label, value, sub, color = 'green' }) {
  const colors = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue:  'bg-blue-50  border-blue-200  text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-black">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── 進貨管理 ────────────────────────────────────────────────
function PurchaseSection({ onOpenPOS }) {
  const today = new Date().toISOString().slice(0, 10)
  const EMPTY = { product: '', purchaseDate: today, qty: '', unit: '', unitCost: '', sellingPrice: '', note: '' }

  const [batches,      setBatches]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [sortBy,       setSortBy]       = useState('date')
  const [filterProd,   setFilterProd]   = useState('')
  const [pendingEdits, setPendingEdits] = useState({})
  const [form, setForm] = useState(EMPTY)
  const [opened, setOpened]   = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')

  const load = (quiet = false) => {
    if (!quiet) setLoading(true)
    getPurchaseBatches()
      .then(data => setBatches(Array.isArray(data) ? data : []))
      .finally(() => { if (!quiet) setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const fc = Number(form.unitCost)     || 0
  const fp = Number(form.sellingPrice) || 0
  const fProfit = fc > 0 && fp > 0 ? fp - fc : null
  const fMargin = fProfit !== null && fp > 0 ? Math.round(fProfit / fp * 100) : null

  const handleSave = async () => {
    if (!form.product.trim() || !form.purchaseDate || !form.qty || !form.unitCost) return
    setSaving(true); setSaveError('')
    try {
      await savePurchaseBatch(
        form.product.trim(), form.purchaseDate,
        Number(form.qty), form.unit, Number(form.unitCost), form.note,
        Number(form.sellingPrice) || 0
      )
      setForm({ ...EMPTY, purchaseDate: form.purchaseDate })
      load(true)
    } catch (e) {
      setSaveError(e.message || '儲存失敗')
    } finally { setSaving(false) }
  }

  const handleOpenStall = async () => {
    setOpening(true); setOpenError('')
    try {
      const productMap = {}
      ;[...batches].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)).forEach(b => {
        if (!productMap[b.product]) productMap[b.product] = { openStock: 0, price: 0 }
        productMap[b.product].openStock += b.remainingQty
        if (b.sellingPrice > 0) productMap[b.product].price = b.sellingPrice
      })
      const items = Object.entries(productMap)
        .filter(([, v]) => v.openStock > 0)
        .map(([name, v]) => ({ name, openStock: v.openStock, price: v.price }))
      if (items.length === 0) { setOpenError('沒有可開攤的品項'); return }
      await setDailyStock(items)
      setOpened(true)
    } catch (e) {
      setOpenError(e.message || '開攤失敗')
    } finally { setOpening(false) }
  }

  const handleDelete = async (id) => {
    setBatches(prev => prev.filter(b => b.id !== id))
    try { await deletePurchaseBatch(id) } catch { load(true) }
  }

  const handleFieldChange = (id, field, value) =>
    setPendingEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }))

  const handleFieldBlur = async (b, field) => {
    const pending = pendingEdits[b.id]
    if (!pending || pending[field] === undefined) return
    const value = pending[field]
    setPendingEdits(prev => {
      const updated = { ...(prev[b.id] || {}) }; delete updated[field]
      return { ...prev, [b.id]: updated }
    })
    if (field === 'product'      && (!value.trim() || value.trim() === b.product)) return
    if (field === 'purchaseDate' && (!value || value === b.purchaseDate)) return
    if (field === 'unit'         && value === b.unit) return
    if (field === 'qty')          { const n = Number(value); if (!value || isNaN(n) || n <= 0 || n === b.qty)          return }
    if (field === 'unitCost')     { const n = Number(value); if (!value || isNaN(n) || n <= 0 || n === b.unitCost)     return }
    if (field === 'sellingPrice') { const n = Number(value); if (isNaN(n) || n === b.sellingPrice) return }
    const isStr = field === 'product' || field === 'purchaseDate' || field === 'unit'
    await updatePurchaseBatch(b.id, { [field]: isStr ? (value.trim?.() ?? value) : Number(value) })
    load(true)
  }

  const displayField     = (b, field) => pendingEdits[b.id]?.[field] !== undefined ? pendingEdits[b.id][field] : b[field]
  const displayTotalCost = b => {
    const q = pendingEdits[b.id]?.qty      !== undefined ? Number(pendingEdits[b.id].qty)      : b.qty
    const c = pendingEdits[b.id]?.unitCost !== undefined ? Number(pendingEdits[b.id].unitCost) : b.unitCost
    return (isNaN(q) || q <= 0 || isNaN(c) || c <= 0) ? b.totalCost : q * c
  }

  const canSave         = form.product.trim() && form.purchaseDate && form.qty && form.unitCost
  const products        = [...new Set(batches.map(b => b.product))]
  const totalInvestment = batches.reduce((s, b) => s + displayTotalCost(b), 0)
  const filtered        = batches.filter(b => !filterProd || b.product === filterProd)
  const sorted          = [...filtered].sort((a, b) => {
    if (sortBy === 'product') return a.product.localeCompare(b.product)
    if (sortBy === 'cost')    return b.unitCost - a.unitCost
    return b.purchaseDate.localeCompare(a.purchaseDate)
  })
  const cellCls = "border-b border-transparent hover:border-gray-300 focus:border-green-500 outline-none bg-transparent py-0.5 transition-colors"

  return (
    <div>
      {/* 統計卡片 */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <MiniStat label="進貨批次"   value={batches.length}                         sub="筆" color="blue"  />
        <MiniStat label="品項種類"   value={products.length}                        sub="種" color="amber" />
        <MiniStat label="總進貨金額" value={`$${totalInvestment.toLocaleString()}`}          color="green" />
      </div>

      {/* 新增進貨表單 */}
      <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-5">
        <div className="text-xs font-bold text-green-700 mb-3 uppercase tracking-wide">新增進貨</div>
        {saveError && (
          <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">{saveError}</div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">商品名稱 *</label>
            <input value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))}
              placeholder="例：脆梅"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 bg-white" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">進貨日 *</label>
            <input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 bg-white" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">數量 *</label>
            <input type="number" min="0" placeholder="0" value={form.qty}
              onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 bg-white text-right" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">單位</label>
            <input placeholder="個/盒" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 bg-white" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">單位成本 *</label>
            <div className="flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden focus-within:border-amber-400">
              <span className="px-2 text-gray-400 text-sm">$</span>
              <input type="number" min="0" placeholder="0" value={form.unitCost}
                onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))}
                className="flex-1 py-2 pr-3 text-sm outline-none text-right" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">售價</label>
            <div className="flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden focus-within:border-green-400">
              <span className="px-2 text-gray-400 text-sm">$</span>
              <input type="number" min="0" placeholder="0" value={form.sellingPrice}
                onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))}
                className="flex-1 py-2 pr-3 text-sm outline-none text-right" />
            </div>
          </div>
        </div>
        {fProfit !== null && (
          <div className={`flex items-center gap-3 mb-2 px-3 py-2 rounded-lg text-sm font-bold
            ${fMargin >= 30 ? 'bg-green-100 text-green-700' : fMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
            <span>毛利：${fProfit} / 件</span>
            <span className="opacity-70">毛利率：{fMargin}%</span>
            {form.qty && <span className="opacity-70">總毛利：${fProfit * (Number(form.qty) || 0)}</span>}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">備註</label>
            <input placeholder="選填" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 bg-white" />
          </div>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 whitespace-nowrap">
            {saving ? '儲存中…' : '＋ 新增'}
          </button>
        </div>
      </div>

      {/* 批次表格 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <select value={filterProd} onChange={e => setFilterProd(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white">
              <option value="">全部商品</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {[{id:'date',label:'日期'},{id:'product',label:'商品'},{id:'cost',label:'成本'}].map(s => (
                <button key={s.id} onClick={() => setSortBy(s.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${sortBy === s.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? <Spinner /> : sorted.length === 0 ? (
          <div className="text-center py-10 text-gray-300 text-sm">尚未記錄任何進貨批次</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">商品</th>
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">進貨日</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">數量</th>
                  <th className="px-3 py-2.5 text-left  text-xs text-gray-500 font-bold">單位</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">成本</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-bold">售價</th>
                  <th className="px-3 py-2.5 text-center text-xs text-gray-500 font-bold">毛利率</th>
                  <th className="px-3 py-2.5 text-center text-xs text-gray-500 font-bold">剩餘</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b, i) => {
                  const pct    = b.qty > 0 ? Math.round(b.remainingQty / b.qty * 100) : 0
                  const isOut  = b.remainingQty === 0
                  const isLow  = !isOut && pct <= 20
                  const sp     = Number(displayField(b, 'sellingPrice')) || 0
                  const uc     = Number(displayField(b, 'unitCost'))     || 0
                  const margin = sp > 0 && uc > 0 ? Math.round((sp - uc) / sp * 100) : null
                  const mColor = margin === null ? 'text-gray-300' : margin >= 30 ? 'text-green-600 bg-green-50' : margin >= 15 ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50'
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
                          className={`w-14 text-right text-gray-600 ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input value={displayField(b, 'unit')}
                          onChange={e => handleFieldChange(b.id, 'unit', e.target.value)}
                          onBlur={() => handleFieldBlur(b, 'unit')}
                          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                          className={`w-8 text-gray-500 text-xs ${cellCls}`} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-gray-400 text-xs">$</span>
                          <input type="number" value={displayField(b, 'unitCost')}
                            onChange={e => handleFieldChange(b.id, 'unitCost', e.target.value)}
                            onBlur={() => handleFieldBlur(b, 'unitCost')}
                            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                            className={`w-14 text-right font-semibold text-gray-700 ${cellCls}`} />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-gray-400 text-xs">$</span>
                          <input type="number" value={displayField(b, 'sellingPrice') || ''}
                            onChange={e => handleFieldChange(b.id, 'sellingPrice', e.target.value)}
                            onBlur={() => handleFieldBlur(b, 'sellingPrice')}
                            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                            placeholder="0"
                            className={`w-14 text-right font-bold text-green-700 ${cellCls}`} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {margin !== null
                          ? <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${mColor}`}>{margin}%</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <div className="w-8 bg-gray-100 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${isOut ? 'bg-red-300' : isLow ? 'bg-amber-400' : 'bg-green-400'}`}
                                 style={{ width: pct + '%' }} />
                          </div>
                          <span className={`text-xs font-bold w-5 text-right ${isOut ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-gray-600'}`}>
                            {b.remainingQty}
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button onClick={() => handleDelete(b.id ?? i)}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-red-300 hover:text-red-600 hover:bg-red-50 active:scale-90">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 確認開攤 */}
      {batches.length > 0 && (
        <div className="sticky bottom-4 pt-3">
          {openError && (
            <div className="mb-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center">{openError}</div>
          )}
          {opened ? (
            <div className="flex gap-2">
              <div className="flex-1 py-4 rounded-2xl bg-green-500 text-white font-black text-lg text-center shadow-lg">✅ 開攤完成！</div>
              <button onClick={onOpenPOS}
                className="px-5 py-4 rounded-2xl bg-green-700 text-white font-black text-lg shadow-lg hover:bg-green-800 active:scale-[0.98] whitespace-nowrap">
                前往收銀 →
              </button>
            </div>
          ) : (
            <button onClick={handleOpenStall} disabled={opening}
              className="w-full py-4 rounded-2xl font-black text-lg shadow-lg bg-green-600 text-white hover:bg-green-700 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400">
              {opening ? '開攤中…' : '💾 確認開攤'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── 品項設定 ────────────────────────────────────────────────
const CATEGORIES = ['水果', '蔬菜', '蛋類', '冷凍食品', '加工品', '其他']
const EMPTY_FORM  = { name: '', price: '', openStock: '', category: '其他', stock_mode: 'reset' }

function SetupSection({ onOpenPOS }) {
  const [products,   setProducts]   = useState([])
  const [stocks,     setStocks]     = useState({})   // product.id → qty string
  const [prices,     setPrices]     = useState({})   // product.id → price
  const [origPrices, setOrigPrices] = useState({})
  const [barcodes,   setBarcodes]   = useState({})   // product.id → barcode string
  const [included,   setIncluded]   = useState({})   // product.id → bool

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [adding,  setAdding]  = useState(false)

  const [scanningFor,    setScanningFor]    = useState(null)
  const [confirmDelete,  setConfirmDelete]  = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([getProducts(), getDailyStocks(today)])
      .then(([prods, dayStocks]) => {
        setProducts(prods)
        const stockById = {}
        dayStocks.forEach(s => { stockById[s.product_id] = s.open_stock })
        const initS = {}, initP = {}, initI = {}, initB = {}
        prods.forEach(p => {
          initS[p.id] = stockById[p.id] ?? 0
          initP[p.id] = p.price
          initI[p.id] = p.id in stockById
          initB[p.id] = p.barcode || ''
        })
        setStocks(initS); setPrices(initP); setOrigPrices(initP)
        setIncluded(initI); setBarcodes(initB)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      const items = products
        .filter(p => included[p.id])
        .map(p => ({ name: p.name, openStock: Number(stocks[p.id]) || 0, price: Number(prices[p.id]) }))
      await setDailyStock(items)
      setOrigPrices({ ...prices })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError('儲存失敗：' + e.message)
    } finally { setSaving(false) }
  }

  const handleAdd = async () => {
    if (!form.name.trim()) { setError('請輸入商品名稱'); return }
    if (!form.price)        { setError('請輸入單價');     return }
    setAdding(true); setError('')
    try {
      await saveProduct({ name: form.name.trim(), price: Number(form.price), category: form.category, stock_mode: form.stock_mode })
      const [prods] = await Promise.all([getProducts()])
      setProducts(prods)
      const newP = prods.find(p => p.name === form.name.trim())
      if (newP) {
        setStocks(prev  => ({ ...prev, [newP.id]: Number(form.openStock) || 0 }))
        setPrices(prev  => ({ ...prev, [newP.id]: newP.price }))
        setOrigPrices(prev => ({ ...prev, [newP.id]: newP.price }))
        setIncluded(prev => ({ ...prev, [newP.id]: true }))
        setBarcodes(prev => ({ ...prev, [newP.id]: '' }))
      }
      setForm(EMPTY_FORM); setShowAdd(false)
    } catch (e) { setError('新增失敗：' + e.message) }
    finally { setAdding(false) }
  }

  const handleSaveBarcode = async (p) => {
    const barcode = normalizeBarcodeText(barcodes[p.id])
    if (barcode === normalizeBarcodeText(p.barcode)) return
    try {
      await saveProduct({ id: p.id, name: p.name, price: p.price, category: p.category, stock_mode: p.stock_mode, barcode })
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, barcode } : x))
    } catch (e) { setError('條碼儲存失敗：' + e.message) }
  }

  const handleScanBarcode = (code) => {
    const pid = scanningFor; setScanningFor(null)
    if (!pid) return
    const barcode = normalizeBarcodeText(code)
    if (barcode.length < 4) return
    setBarcodes(prev => ({ ...prev, [pid]: barcode }))
    const p = products.find(x => x.id === pid)
    if (p) {
      saveProduct({ id: p.id, name: p.name, price: p.price, category: p.category, stock_mode: p.stock_mode, barcode })
        .then(() => setProducts(prev => prev.map(x => x.id === pid ? { ...x, barcode } : x)))
        .catch(e => setError('條碼儲存失敗：' + e.message))
    }
  }

  const handleDelete = async (p) => {
    setConfirmDelete(null)
    setProducts(prev => prev.filter(x => x.id !== p.id))
    try { await deleteProduct(p.id) }
    catch (e) { setError('刪除失敗：' + e.message) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const categories = [...new Set(products.map(p => p.category || '其他'))]
  const byCategory  = {}
  categories.forEach(cat => { byCategory[cat] = products.filter(p => (p.category || '其他') === cat) })
  const includedCount = Object.values(included).filter(Boolean).length
  const totalStock    = products.filter(p => included[p.id]).reduce((s, p) => s + (Number(stocks[p.id]) || 0), 0)

  return (
    <div>
      <p className="text-sm text-gray-400 mb-4">
        今日上架 <span className="font-bold text-gray-600">{includedCount}</span> 種，
        帶貨 <span className="font-bold text-green-600">{totalStock}</span> 件
      </p>

      <div className="flex justify-end mb-4">
        <button onClick={() => { setShowAdd(v => !v); setError('') }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold
            ${showAdd ? 'bg-gray-200 text-gray-600' : 'bg-green-600 text-white hover:bg-green-700'}`}>
          {showAdd ? '✕ 取消' : '＋ 新增品項'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showAdd && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-5 space-y-3">
          <h2 className="font-bold text-green-800 text-sm">新增品項</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">商品名稱</label>
              <input type="text" placeholder="例：玉荷包荔枝" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">單價 $</label>
              <input type="number" min="0" placeholder="0" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">今日帶貨量</label>
              <input type="number" min="0" placeholder="0" value={form.openStock}
                onChange={e => setForm(f => ({ ...f, openStock: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">分類</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 bg-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">庫存模式</label>
              <select value={form.stock_mode} onChange={e => setForm(f => ({ ...f, stock_mode: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 bg-white">
                <option value="reset">每日重設</option>
                <option value="carry">跨日累積</option>
              </select>
            </div>
          </div>
          <button onClick={handleAdd} disabled={adding}
            className="w-full py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400">
            {adding ? '新增中…' : '確認新增'}
          </button>
        </div>
      )}

      {/* 商品列表（按分類） */}
      {categories.map(cat => (
        <div key={cat} className="mb-5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{cat}</h2>
          <div className="space-y-2">
            {byCategory[cat].map(p => {
              const isOn         = included[p.id]
              const priceChanged = prices[p.id] !== origPrices[p.id]
              const isDeleting   = confirmDelete === p.id
              return (
                <div key={p.id}
                  className={`bg-white rounded-xl border px-4 py-3 transition-all ${isOn ? 'border-gray-200 shadow-sm' : 'border-gray-100 opacity-40'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-gray-800 text-sm">{p.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${p.stock_mode === 'carry' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                          {p.stock_mode === 'carry' ? '跨日' : '每日重設'}
                        </span>
                      </div>
                    </div>

                    {/* 開關 */}
                    <button onClick={() => setIncluded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className={`mt-0.5 w-12 h-6 rounded-full transition-colors shrink-0 relative ${isOn ? 'bg-green-500' : 'bg-gray-200'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isOn ? 'left-[26px]' : 'left-0.5'}`} />
                    </button>

                    {/* 刪除 */}
                    {!isDeleting ? (
                      <button onClick={() => setConfirmDelete(p.id)}
                        className="mt-0.5 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 shrink-0">🗑</button>
                    ) : (
                      <div className="flex gap-1 shrink-0 mt-0.5">
                        <button onClick={() => handleDelete(p)} className="px-2 py-0.5 bg-red-500 text-white rounded-lg text-xs font-bold">確認刪除</button>
                        <button onClick={() => setConfirmDelete(null)} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-lg text-xs">取消</button>
                      </div>
                    )}
                  </div>

                  {isOn && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400 whitespace-nowrap">售價 $</span>
                          <input type="number" min="0" value={prices[p.id] ?? ''}
                            onChange={e => setPrices(prev => ({ ...prev, [p.id]: Number(e.target.value) || 0 }))}
                            className="w-16 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold focus:outline-none focus:border-green-400" />
                          {priceChanged && <span className="text-[10px] text-amber-500 font-semibold">已改</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">帶貨</span>
                        <button onClick={() => setStocks(prev => ({ ...prev, [p.id]: Math.max(0, (Number(prev[p.id]) || 0) - 1) }))}
                          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 font-bold flex items-center justify-center text-base">−</button>
                        <input type="number" min="0" value={stocks[p.id] ?? ''}
                          onChange={e => setStocks(prev => ({ ...prev, [p.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                          className="w-14 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold focus:outline-none focus:border-green-400" />
                        <button onClick={() => setStocks(prev => ({ ...prev, [p.id]: (Number(prev[p.id]) || 0) + 1 }))}
                          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-600 font-bold flex items-center justify-center text-base">＋</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400 whitespace-nowrap">條碼</span>
                        <input type="text" value={barcodes[p.id] ?? ''}
                          onChange={e => setBarcodes(prev => ({ ...prev, [p.id]: normalizeBarcodeText(e.target.value) }))}
                          onBlur={() => handleSaveBarcode(p)}
                          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                          placeholder="未設定，可手動輸入或掃描"
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-green-400" />
                        <button onClick={() => setScanningFor(p.id)}
                          className="shrink-0 px-2.5 py-1 rounded-lg bg-[#1D9E75] text-white text-xs font-bold hover:bg-[#0F6E56] active:scale-95">
                          📷
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {scanningFor && (
        <BarcodeScannerModal onDetect={handleScanBarcode} onClose={() => setScanningFor(null)} />
      )}

      {/* 開攤按鈕 */}
      <div className="sticky bottom-4 pt-2">
        {saved ? (
          <div className="flex gap-2">
            <div className="flex-1 py-4 rounded-2xl bg-green-500 text-white font-black text-lg text-center shadow-lg">✅ 開攤設定完成！</div>
            <button onClick={onOpenPOS}
              className="px-5 py-4 rounded-2xl bg-green-700 text-white font-black text-lg shadow-lg hover:bg-green-800 active:scale-[0.98] whitespace-nowrap">
              前往收銀 →
            </button>
          </div>
        ) : (
          <button onClick={handleSave} disabled={saving}
            className="w-full py-4 rounded-2xl font-black text-lg shadow-lg bg-green-600 text-white hover:bg-green-700 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400">
            {saving ? '儲存中…' : '💾 確認開攤'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── 主頁面 ──────────────────────────────────────────────────
export default function StockSetupPage({ onOpenPOS }) {
  const [tab, setTab] = useState('purchase')
  return (
    <div className="h-full overflow-y-auto p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-gray-800">📦 開攤設定</h1>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {[{id:'purchase',label:'進貨管理'},{id:'setup',label:'品項設定'}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'purchase' && <PurchaseSection onOpenPOS={onOpenPOS} />}
      {tab === 'setup'    && <SetupSection    onOpenPOS={onOpenPOS} />}
    </div>
  )
}
