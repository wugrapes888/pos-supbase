import { useState, useEffect } from 'react'
import {
  getCashiers, saveCashier, deleteCashier,
  saveProduct, getProducts, deleteProduct,
  resetBusinessData,
} from '../services/api'

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 font-bold text-gray-700 border-b border-gray-100">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  )
}

export default function SettingsPage({ currentUser }) {
  const [cashiers, setCashiers] = useState([])
  const [products, setProducts] = useState([])
  const [newCashier, setNewCashier] = useState({ id: '', name: '', role: 'staff' })
  const [newProduct, setNewProduct] = useState({ name: '', price: '', category: '水果', barcode: '', stock_mode: 'reset' })
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const reload = async () => {
    const [c, p] = await Promise.all([getCashiers(), getProducts()])
    setCashiers(c)
    setProducts(p)
  }

  useEffect(() => { reload() }, [])

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2500) }

  const handleAddCashier = async (e) => {
    e.preventDefault()
    if (!newCashier.id || !newCashier.name) return
    setSaving(true)
    try {
      await saveCashier(newCashier)
      setNewCashier({ id: '', name: '', role: 'staff' })
      await reload()
      flash('已新增員工')
    } catch (err) { flash(err.message) }
    finally { setSaving(false) }
  }

  const handleAddProduct = async (e) => {
    e.preventDefault()
    if (!newProduct.name || !newProduct.price) return
    setSaving(true)
    try {
      await saveProduct({ ...newProduct, price: Number(newProduct.price) })
      setNewProduct({ name: '', price: '', category: '水果', barcode: '', stock_mode: 'reset' })
      await reload()
      flash('已新增商品')
    } catch (err) { flash(err.message) }
    finally { setSaving(false) }
  }

  const handleResetBusinessData = async () => {
    setResetting(true)
    try {
      await resetBusinessData()
      setConfirmReset(false)
      await reload()
      flash('已重置所有營業資料')
    } catch (err) {
      flash('重置失敗：' + err.message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {msg && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-xl shadow-xl z-50 text-sm">
          {msg}
        </div>
      )}

      {/* 員工管理 */}
      <Section title="員工管理">
        <div className="space-y-2 mb-4">
          {cashiers.map(c => (
            <div key={c.id} className="flex items-center gap-3 text-sm">
              <span className="font-mono font-bold w-16">{c.id}</span>
              <span className="flex-1">{c.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${c.role === 'boss' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>
                {c.role === 'boss' ? '老闆' : '員工'}
              </span>
              {c.id !== currentUser.id && (
                <button
                  onClick={async () => { await deleteCashier(c.id); reload() }}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  刪除
                </button>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={handleAddCashier} className="flex gap-2 flex-wrap">
          <input value={newCashier.id} onChange={e => setNewCashier(p => ({ ...p, id: e.target.value }))}
            placeholder="ID（PIN）" className="border rounded-lg px-3 py-1.5 text-sm w-28 outline-none focus:border-green-500" />
          <input value={newCashier.name} onChange={e => setNewCashier(p => ({ ...p, name: e.target.value }))}
            placeholder="姓名" className="border rounded-lg px-3 py-1.5 text-sm flex-1 outline-none focus:border-green-500" />
          <select value={newCashier.role} onChange={e => setNewCashier(p => ({ ...p, role: e.target.value }))}
            className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500">
            <option value="staff">員工</option>
            <option value="boss">老闆</option>
          </select>
          <button type="submit" disabled={saving} className="px-4 py-1.5 bg-green-700 text-white rounded-lg text-sm font-bold hover:bg-green-600 disabled:opacity-50">
            新增
          </button>
        </form>
      </Section>

      {/* 商品管理 */}
      <Section title="商品管理">
        <div className="space-y-1 mb-4 max-h-64 overflow-y-auto">
          {products.map(p => (
            <div key={p.id} className="flex items-center gap-3 text-sm py-1">
              <span className="flex-1 font-medium">{p.name}</span>
              <span className="text-gray-500 text-xs">{p.category}</span>
              <span className="text-green-700 font-bold">${p.price}</span>
              <button
                onClick={async () => { await deleteProduct(p.id); reload() }}
                className="text-red-400 hover:text-red-600 text-xs"
              >
                停用
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAddProduct} className="grid grid-cols-2 gap-2">
          <input value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
            placeholder="商品名稱" className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500 col-span-2" />
          <input value={newProduct.price} onChange={e => setNewProduct(p => ({ ...p, price: e.target.value }))}
            placeholder="售價" type="number" className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500" />
          <input value={newProduct.category} onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))}
            placeholder="分類" className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500" />
          <input value={newProduct.barcode} onChange={e => setNewProduct(p => ({ ...p, barcode: e.target.value }))}
            placeholder="條碼（選填）" className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500" />
          <select value={newProduct.stock_mode} onChange={e => setNewProduct(p => ({ ...p, stock_mode: e.target.value }))}
            className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500">
            <option value="reset">每日清零</option>
            <option value="carry">累計</option>
          </select>
          <button type="submit" disabled={saving} className="col-span-2 py-2 bg-green-700 text-white rounded-lg text-sm font-bold hover:bg-green-600 disabled:opacity-50">
            新增商品
          </button>
        </form>
      </Section>

      {/* Supabase 連線資訊 */}
      <Section title="Supabase 連線">
        <div className="text-sm text-gray-600 space-y-1">
          <div>URL：<code className="bg-gray-100 px-1 rounded">{import.meta.env.VITE_SUPABASE_URL || '未設定'}</code></div>
          <div className="text-xs text-gray-400 mt-2">
            連線設定請在 <code>.env.local</code>（本機）或 GitHub Secrets（GitHub Actions）中設定<br />
            <code>VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_ANON_KEY</code>
          </div>
        </div>
      </Section>

      {/* 危險操作 */}
      <Section title="危險操作">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="font-bold text-red-700 mb-1">重置所有營業資料</div>
          <p className="text-sm text-red-600 mb-4">
            會刪除客戶、訂單、收銀紀錄、每日庫存、進貨批次和商品資料，但會保留老闆與員工登入帳號。
          </p>

          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 active:scale-[0.98]"
            >
              重置所有營業資料
            </button>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-bold text-red-700">
                請再次確認：刪除後無法從系統內復原。
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleResetBusinessData}
                  disabled={resetting}
                  className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-black hover:bg-red-800 disabled:bg-red-200 disabled:text-red-400 active:scale-[0.98]"
                >
                  {resetting ? '刪除中…' : '確認永久刪除'}
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  disabled={resetting}
                  className="px-4 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-sm font-bold hover:bg-red-100 disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
