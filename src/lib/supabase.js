import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[Supabase] 缺少環境變數。\n' +
    '本機開發：請建立 .env.local 並填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY\n' +
    'GitHub Pages：請在 Repo Settings → Secrets 設定相同變數。'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
