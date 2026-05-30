import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url)

const appSource = await readFile(new URL('src/App.jsx', root), 'utf8')
assert.match(
  appSource,
  /<StockSetupPage\s+onOpenPOS=\{\(\)\s*=>\s*setPage\('pos'\)\}\s*\/>/,
  'StockSetupPage must receive an onOpenPOS callback that navigates back to POS.'
)

const { buildDailyStockPlan } = await import(new URL('src/services/stockPlanning.js', root))
const { RESET_BUSINESS_TABLES } = await import(new URL('src/services/resetBusinessData.js', root))

const plan = buildDailyStockPlan(
  [
    { name: '醃蘿蔔', openStock: 11, price: 150 },
    { name: '娃娃菜', openStock: 10, price: 50 },
    { name: '售完品', openStock: 0, price: 30 },
  ],
  [{ id: 'existing-1', name: '娃娃菜', price: 40 }],
  '2026-05-30'
)

assert.deepEqual(
  plan.productsToCreate,
  [{ name: '醃蘿蔔', price: 150, category: '其他', is_active: true }],
  'Opening stock from purchase batches should create missing product records.'
)
assert.deepEqual(
  plan.stocksToUpsert,
  [
    { product_id: 'existing-1', stock_date: '2026-05-30', open_stock: 10 },
  ],
  'Existing products should be converted into daily stock upserts.'
)
assert.deepEqual(
  plan.productsToUpdate,
  [{ id: 'existing-1', price: 50 }],
  'Opening stock should update existing product prices when they changed.'
)

assert.equal(
  RESET_BUSINESS_TABLES.includes('cashiers'),
  false,
  'Business reset must preserve cashier login accounts.'
)
assert.deepEqual(
  RESET_BUSINESS_TABLES,
  [
    'delivery_items',
    'delivery_batches',
    'pos_transaction_items',
    'pos_transactions',
    'order_items',
    'orders',
    'group_buy_sessions',
    'daily_stocks',
    'purchase_batches',
    'customers',
    'products',
  ],
  'Business reset must delete child tables before parent tables.'
)
