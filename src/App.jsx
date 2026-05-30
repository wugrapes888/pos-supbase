import { useState, useEffect } from 'react'
import LoginScreen from './components/LoginScreen'
import POSPage from './pages/POSPage'
import OrdersPage from './pages/OrdersPage'
import StockSetupPage from './pages/StockSetupPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'

const NAV_ALL = [
  { id: 'pos',      label: '🛒 收銀'  },
  { id: 'orders',   label: '📋 取貨'  },
  { id: 'stock',    label: '📦 開攤'  },
  { id: 'reports',  label: '📊 報表'  },
  { id: 'settings', label: '⚙️ 設定'  },
]
const STAFF_PAGES = new Set(['pos', 'orders'])

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    if (sessionStorage.getItem('pos_authed') !== '1') return null
    try { return JSON.parse(sessionStorage.getItem('pos_user')) } catch { return null }
  })

  const [page, setPage] = useState('pos')
  const [preselectedCustomer, setPreselectedCustomer] = useState(null)

  const role = currentUser?.role || null
  const nav  = role === 'boss' ? NAV_ALL : NAV_ALL.filter(n => STAFF_PAGES.has(n.id))

  useEffect(() => {
    if (role === 'staff' && !STAFF_PAGES.has(page)) setPage('pos')
  }, [role, page])

  if (!currentUser) {
    return <LoginScreen onSuccess={setCurrentUser} />
  }

  const handleGoToPOS = (customerName) => {
    setPreselectedCustomer(customerName)
    setPage('pos')
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-100 font-sans">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="h-14 bg-green-700 text-white flex items-center justify-between px-4 flex-shrink-0 shadow-md z-10">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black tracking-wide">食農 POS</span>
          <span className="text-green-200 text-xs hidden sm:block">食農團購發貨系統</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full
            ${role === 'boss' ? 'bg-yellow-400 text-yellow-900' : 'bg-green-500 text-white'}`}>
            {currentUser.name}（{currentUser.id}）
          </span>
        </div>

        <nav className="flex gap-0.5">
          {nav.map(n => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors
                ${page === n.id
                  ? 'bg-white text-green-700'
                  : 'text-green-100 hover:bg-green-600'}`}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <button
          onClick={() => { sessionStorage.clear(); setCurrentUser(null) }}
          className="text-xs text-green-200 hover:text-white transition-colors"
        >
          登出
        </button>
      </header>

      {/* ── 頁面內容 ────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        {page === 'pos' && (
          <POSPage
            preselectedCustomer={preselectedCustomer}
            onClearPreselect={() => setPreselectedCustomer(null)}
            currentUser={currentUser}
          />
        )}
        {page === 'orders'   && <OrdersPage onGoToPOS={handleGoToPOS} />}
        {page === 'stock'    && role === 'boss' && <StockSetupPage onOpenPOS={() => setPage('pos')} />}
        {page === 'reports'  && role === 'boss' && <ReportsPage />}
        {page === 'settings' && role === 'boss' && <SettingsPage currentUser={currentUser} />}
      </main>
    </div>
  )
}
