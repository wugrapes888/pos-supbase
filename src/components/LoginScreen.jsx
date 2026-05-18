import { useState } from 'react'
import { getCashierById } from '../services/api'

export default function LoginScreen({ onSuccess }) {
  const [input, setInput]   = useState('')
  const [error, setError]   = useState(false)
  const [shake, setShake]   = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    const user = await getCashierById(input.trim())
    setLoading(false)
    if (user) {
      sessionStorage.setItem('pos_authed', '1')
      sessionStorage.setItem('pos_user', JSON.stringify(user))
      onSuccess(user)
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setInput('')
    }
  }

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-green-700 gap-6">
      <div className="text-center text-white">
        <div className="text-4xl font-black tracking-wide mb-1">食農 POS v2</div>
        <div className="text-green-200 text-sm">食農團購發貨系統</div>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`bg-white rounded-2xl shadow-xl p-8 w-80 space-y-4 ${shake ? 'animate-shake' : ''}`}
      >
        <label className="block text-sm font-semibold text-gray-700">員工 ID</label>
        <input
          type="password"
          inputMode="numeric"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false) }}
          placeholder="輸入員工 ID"
          className={`w-full border-2 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest outline-none transition-colors
            ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-green-500'}`}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm text-center">ID 不正確，請再試一次</p>}
        <button
          type="submit"
          disabled={loading || !input}
          className="w-full bg-green-700 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-600 active:scale-95 transition-all disabled:opacity-50"
        >
          {loading ? '驗證中…' : '登入'}
        </button>
      </form>
    </div>
  )
}
