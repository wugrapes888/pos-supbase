// Supabase API 服務層
import { supabase } from '../lib/supabase'
import { buildDailyStockPlan } from './stockPlanning'
import { deleteAllRowsFromTables } from './resetBusinessData'

// ── 商品 ────────────────────────────────────────────────────

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data
}

export async function saveProduct(product) {
  const { id, ...fields } = product
  if (id) {
    const { error } = await supabase.from('products').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    return { action: 'updated' }
  }
  const { error } = await supabase.from('products').insert(fields)
  if (error) throw error
  return { action: 'created' }
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function resetBusinessData() {
  await deleteAllRowsFromTables(supabase)
}

export async function renameProduct(oldName, newName) {
  const { error } = await supabase.from('products').update({ name: newName, updated_at: new Date().toISOString() }).eq('name', oldName)
  if (error) throw error
}

// ── 每日庫存（開攤）────────────────────────────────────────

export async function getDailyStocks(date = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await supabase
    .from('daily_stocks')
    .select('*, products(name, price, category, barcode, stock_mode)')
    .eq('stock_date', date)
  if (error) throw error
  return data
}

export async function upsertDailyStock({ product_id, stock_date, open_stock, created_by }) {
  const { error } = await supabase
    .from('daily_stocks')
    .upsert({ product_id, stock_date, open_stock, created_by }, { onConflict: 'product_id,stock_date' })
  if (error) throw error
}

// 批量開攤：更新每日庫存和售價
export async function setDailyStock(items) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: products, error: productsErr } = await supabase.from('products').select('id, name, price').eq('is_active', true)
  if (productsErr) throw productsErr

  let plan = buildDailyStockPlan(items, products ?? [], today)

  if (plan.productsToCreate.length > 0) {
    const { error: createErr } = await supabase
      .from('products')
      .upsert(plan.productsToCreate, { onConflict: 'name' })
    if (createErr) throw createErr

    const { data: refreshedProducts, error: refreshedErr } = await supabase
      .from('products')
      .select('id, name, price')
      .eq('is_active', true)
    if (refreshedErr) throw refreshedErr
    plan = buildDailyStockPlan(items, refreshedProducts ?? [], today)
  }

  if (plan.stocksToUpsert.length > 0) {
    const { error } = await supabase
      .from('daily_stocks')
      .upsert(plan.stocksToUpsert, { onConflict: 'product_id,stock_date' })
    if (error) throw error
  }

  // 更新售價（如果有改動）
  for (const product of plan.productsToUpdate) {
    const { error } = await supabase
      .from('products')
      .update({ price: product.price, updated_at: new Date().toISOString() })
      .eq('id', product.id)
    if (error) throw error
  }
}

// ── 客戶 ────────────────────────────────────────────────────

export async function searchCustomers(query) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone')
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .order('name')
    .limit(20)
  if (error) throw error
  return data
}

export async function upsertCustomer({ name, phone, line_user_id, note }) {
  const { data, error } = await supabase
    .from('customers')
    .upsert({ name, phone, line_user_id, note }, { onConflict: 'line_user_id' })
    .select('id')
    .single()
  if (error) throw error
  return data
}

// ── 預購單 ────────────────────────────────────────────────────

// POS 取貨頁：所有預購客人（pending + paid）
export async function getAllPreorderCustomers() {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      status,
      customer_id,
      customer_name,
      order_items(id, product_name, qty, unit_price, subtotal, arrived)
    `)
    .eq('order_type', 'preorder')
    .not('status', 'in', '("cancelled")')
    .order('customer_name')
  if (error) throw error

  return data.map(order => {
    const totalQty = order.order_items.reduce((s, i) => s + i.qty, 0)
    return {
      customer_id:   order.customer_id,
      customer_name: order.customer_name,
      order_id:      order.id,
      status:        order.status,  // 'pending' | 'paid'
      qty:           totalQty,
      items:         order.order_items,
    }
  })
}

// POS 頁：只顯示待取貨客人（pending）
export async function getPreorderCustomers() {
  const { data, error } = await supabase
    .from('customer_preorder_summary')
    .select('*')
    .order('customer_name')
  if (error) throw error
  return data
}

// 取得客人預購品項（POS 選客人後載入購物車）
export async function getCustomerPreorderItems(customerId) {
  const { data, error } = await supabase
    .from('order_items')
    .select('*, orders!inner(id, customer_id, status, order_type)')
    .eq('orders.customer_id', customerId)
    .eq('orders.order_type', 'preorder')
    .eq('orders.status', 'pending')
  if (error) throw error
  return data.map(i => ({
    id:           i.id,
    order_id:     i.orders.id,
    product_id:   i.product_id,
    product_name: i.product_name,
    unit_price:   Number(i.unit_price),
    qty:          i.qty,
    subtotal:     Number(i.subtotal),
    arrived:      i.arrived,
  }))
}

// 取得客人訂單明細（取貨頁展開用）
export async function getCustomerOrderDetail(orderId) {
  const { data, error } = await supabase
    .from('order_items')
    .select('id, product_name, qty, unit_price, subtotal, arrived')
    .eq('order_id', orderId)
  if (error) throw error

  const arrivedTotal = data.filter(i => i.arrived).reduce((s, i) => s + Number(i.subtotal), 0)
  const allTotal     = data.reduce((s, i) => s + Number(i.subtotal), 0)

  return {
    items:        data.map(i => ({ product: i.product_name, qty: i.qty, subtotal: Number(i.subtotal), arrived: i.arrived })),
    arrivedTotal,
    allTotal,
  }
}

// 標記取貨完成
export async function markOrderDelivered(orderId) {
  const { error } = await supabase
    .from('orders')
    .update({ status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) throw error
}

// 還原取貨
export async function markOrderPending(orderId) {
  const { error } = await supabase
    .from('orders')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) throw error
}

export async function createOrder({ order_type, customer_id, customer_name, session_id, items, note, payment_screenshot_url }) {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({ order_type, customer_id, customer_name, session_id, note, payment_screenshot_url })
    .select('id')
    .single()
  if (orderErr) throw orderErr

  const orderItems = items.map(i => ({
    order_id:     order.id,
    product_id:   i.product_id,
    product_name: i.product_name,
    qty:          i.qty,
    unit_price:   i.unit_price,
    arrived:      i.arrived ?? false,
  }))
  const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
  if (itemsErr) throw itemsErr
  return order
}

// ── POS 結帳 ────────────────────────────────────────────────

export async function submitCheckout({ cashier_id, customer_id, customer_name, customer_type, payment_method, total_amount, note, items }) {
  const { data: tx, error: txErr } = await supabase
    .from('pos_transactions')
    .insert({ cashier_id, customer_id, customer_name, customer_type, payment_method, total_amount, note })
    .select('id')
    .single()
  if (txErr) throw txErr

  const txItems = items.map(i => ({
    transaction_id: tx.id,
    product_id:     i.product_id ?? null,
    product_name:   i.product_name,
    qty:            i.qty,
    unit_price:     i.unit_price,
    order_item_id:  i.order_item_id ?? null,
  }))
  const { error: itemsErr } = await supabase.from('pos_transaction_items').insert(txItems)
  if (itemsErr) throw itemsErr

  // 核銷的預購訂單標記 paid
  const orderIds = [...new Set(items.filter(i => i.order_id).map(i => i.order_id))]
  if (orderIds.length > 0) {
    await supabase
      .from('orders')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .in('id', orderIds)
  }

  // 減少每日庫存（扣除售出數量）
  const today = new Date().toISOString().slice(0, 10)
  for (const item of items) {
    if (!item.product_id) continue
    const { data: stock } = await supabase
      .from('daily_stocks')
      .select('id, open_stock')
      .eq('product_id', item.product_id)
      .eq('stock_date', today)
      .single()
    if (stock && stock.open_stock >= item.qty) {
      await supabase
        .from('daily_stocks')
        .update({ open_stock: stock.open_stock - item.qty })
        .eq('id', stock.id)
    }
  }

  return tx
}

// ── 收銀員（登入用）────────────────────────────────────────

export async function getCashierById(id) {
  const { data, error } = await supabase
    .from('cashiers')
    .select('id, name, role')
    .eq('id', id)
    .eq('is_active', true)
    .single()
  if (error) return null
  return data
}

export async function getCashiers() {
  const { data, error } = await supabase
    .from('cashiers')
    .select('id, name, role, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data
}

export async function saveCashier({ id, name, role }) {
  const { error } = await supabase
    .from('cashiers')
    .upsert({ id, name, role }, { onConflict: 'id' })
  if (error) throw error
}

export async function deleteCashier(id) {
  const { error } = await supabase.from('cashiers').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

// ── 進貨批次 ────────────────────────────────────────────────

export async function getPurchaseBatches() {
  const { data, error } = await supabase
    .from('purchase_batches')
    .select('*')
    .order('purchase_date', { ascending: false })
  if (error) throw error
  return data.map(b => ({
    id:           b.id,
    product:      b.product_name,
    purchaseDate: b.purchase_date,
    qty:          b.qty,
    unit:         b.unit,
    unitCost:     Number(b.unit_cost),
    totalCost:    Number(b.total_cost),
    remainingQty: b.remaining_qty,
    sellingPrice: b.selling_price ? Number(b.selling_price) : 0,
    note:         b.note ?? '',
  }))
}

export async function savePurchaseBatch(product, purchaseDate, qty, unit, unitCost, note, sellingPrice = 0) {
  // 嘗試找到對應 product_id
  const { data: prod } = await supabase.from('products').select('id').eq('name', product).single()
  const { error } = await supabase.from('purchase_batches').insert({
    product_id:    prod?.id ?? null,
    product_name:  product,
    purchase_date: purchaseDate,
    qty,
    unit:          unit || '個',
    unit_cost:     unitCost,
    remaining_qty: qty,
    selling_price: sellingPrice || null,
    note:          note || null,
  })
  if (error) throw error
}

export async function updatePurchaseBatch(id, fields) {
  // 轉換欄位名稱
  const mapped = {}
  if (fields.product      !== undefined) mapped.product_name  = fields.product
  if (fields.purchaseDate !== undefined) mapped.purchase_date = fields.purchaseDate
  if (fields.qty          !== undefined) { mapped.qty = fields.qty; mapped.remaining_qty = fields.qty }
  if (fields.unit         !== undefined) mapped.unit           = fields.unit
  if (fields.unitCost     !== undefined) mapped.unit_cost      = fields.unitCost
  if (fields.sellingPrice !== undefined) mapped.selling_price  = fields.sellingPrice
  if (fields.note         !== undefined) mapped.note           = fields.note
  const { error } = await supabase.from('purchase_batches').update(mapped).eq('id', id)
  if (error) throw error
}

export async function deletePurchaseBatch(id) {
  const { error } = await supabase.from('purchase_batches').delete().eq('id', id)
  if (error) throw error
}

// ── 報表 ────────────────────────────────────────────────────

export async function getTodayStats() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('today_sales_summary')
    .select('*')
  if (error) throw error

  const revenue  = data.reduce((s, r) => s + Number(r.revenue), 0)
  const txCount  = data.reduce((s, r) => s + Number(r.tx_count), 0)
  const cash     = data.filter(r => r.payment_method === 'cash').reduce((s, r) => s + Number(r.revenue), 0)
  const transfer = data.filter(r => r.payment_method === 'transfer').reduce((s, r) => s + Number(r.revenue), 0)
  const linepay  = data.filter(r => r.payment_method === 'linepay').reduce((s, r) => s + Number(r.revenue), 0)
  const preorderCount = data.filter(r => r.customer_type === 'preorder').reduce((s, r) => s + Number(r.tx_count), 0)
  const walkCount     = data.filter(r => r.customer_type === 'walkin').reduce((s, r) => s + Number(r.tx_count), 0)

  // 今日庫存
  const { data: stocks } = await supabase
    .from('daily_stocks')
    .select('open_stock, products(name)')
    .eq('stock_date', today)

  // 今日售出
  const { data: txItems } = await supabase
    .from('pos_transaction_items')
    .select('product_name, qty, pos_transactions!inner(created_at)')
    .gte('pos_transactions.created_at', today + 'T00:00:00+08:00')
    .lte('pos_transactions.created_at', today + 'T23:59:59+08:00')

  const soldMap = {}
  if (txItems) txItems.forEach(i => {
    soldMap[i.product_name] = (soldMap[i.product_name] || 0) + i.qty
  })

  const stockSummary = stocks?.map(s => ({
    name:      s.products?.name ?? '?',
    openStock: s.open_stock,
    sold:      soldMap[s.products?.name] || 0,
    remaining: s.open_stock - (soldMap[s.products?.name] || 0),
  })) ?? []

  return { date: today, totalRevenue: revenue, cashRevenue: cash, transferRevenue: transfer, linepayRevenue: linepay, txCount, avgOrder: txCount ? Math.round(revenue / txCount) : 0, preorderCount, walkCount, stockSummary }
}

export async function getTodaySales() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('pos_transactions')
    .select(`id, customer_name, customer_type, payment_method, total_amount, cashier_id, created_at,
      pos_transaction_items(product_name, qty, unit_price, subtotal)`)
    .gte('created_at', today + 'T00:00:00+08:00')
    .lte('created_at', today + 'T23:59:59+08:00')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(tx => ({
    id:           tx.id,
    customerName: tx.customer_name,
    customerType: tx.customer_type,
    paymentMethod: tx.payment_method,
    total:        Number(tx.total_amount),
    staffName:    tx.cashier_id,
    time:         tx.created_at.slice(11, 19),
    items:        tx.pos_transaction_items.map(i => ({
      name:     i.product_name,
      qty:      i.qty,
      price:    Number(i.unit_price),
      subtotal: Number(i.subtotal),
    })),
  }))
}

export async function getRevenueByDate(startDate, endDate) {
  const { data, error } = await supabase
    .from('pos_transactions')
    .select('created_at, total_amount, payment_method, customer_type')
    .gte('created_at', startDate + 'T00:00:00+08:00')
    .lte('created_at', endDate + 'T23:59:59+08:00')
    .order('created_at')
  if (error) throw error

  const map = {}
  data.forEach(tx => {
    const date = tx.created_at.slice(0, 10)
    if (!map[date]) map[date] = { date, revenue: 0, orders: 0, cash: 0, transfer: 0, linepay: 0 }
    map[date].revenue  += Number(tx.total_amount)
    map[date].orders   += 1
    if (tx.payment_method === 'cash')     map[date].cash     += Number(tx.total_amount)
    if (tx.payment_method === 'transfer') map[date].transfer += Number(tx.total_amount)
    if (tx.payment_method === 'linepay')  map[date].linepay  += Number(tx.total_amount)
  })
  return Object.values(map)
}

export async function getProductSales(startDate, endDate) {
  const { data, error } = await supabase
    .from('pos_transaction_items')
    .select('product_name, qty, subtotal, pos_transactions!inner(created_at)')
    .gte('pos_transactions.created_at', startDate + 'T00:00:00+08:00')
    .lte('pos_transactions.created_at', endDate + 'T23:59:59+08:00')
  if (error) throw error

  const map = {}
  data.forEach(i => {
    if (!map[i.product_name]) map[i.product_name] = { name: i.product_name, qty: 0, amount: 0 }
    map[i.product_name].qty    += Number(i.qty)
    map[i.product_name].amount += Number(i.subtotal)
  })
  return Object.values(map).sort((a, b) => b.amount - a.amount)
}

export async function getProductProfit(startDate, endDate) {
  const salesData = await getProductSales(startDate, endDate)
  const { data: batches } = await supabase.from('purchase_batches').select('product_name, unit_cost')
  const costMap = {}
  if (batches) batches.forEach(b => { if (!(b.product_name in costMap)) costMap[b.product_name] = Number(b.unit_cost) })

  return salesData.map(p => {
    const cost = costMap[p.name] ?? null
    const totalCost   = cost !== null ? cost * p.qty : null
    const grossProfit = totalCost !== null ? p.amount - totalCost : null
    const grossMargin = grossProfit !== null && p.amount > 0 ? Math.round(grossProfit / p.amount * 100) : null
    return { ...p, totalCost, grossProfit, grossMargin }
  })
}

export async function getProfitByDate(startDate, endDate) {
  const rows = await getRevenueByDate(startDate, endDate)
  return rows.map(r => ({ ...r, grossProfit: null, marginPct: null }))
}

export async function getChannelStats(startDate, endDate) {
  const { data, error } = await supabase
    .from('pos_transactions')
    .select('customer_type, total_amount')
    .gte('created_at', startDate + 'T00:00:00+08:00')
    .lte('created_at', endDate + 'T23:59:59+08:00')
  if (error) throw error

  const map = {}
  data.forEach(tx => {
    const type = tx.customer_type
    if (!map[type]) map[type] = { channel: type, channelLabel: type === 'preorder' ? '預購' : '散客', revenue: 0, orders: 0 }
    map[type].revenue += Number(tx.total_amount)
    map[type].orders++
  })
  return Object.values(map)
}

export async function getBatchProfit() {
  const { data: batches, error } = await supabase.from('purchase_batches').select('*').order('purchase_date', { ascending: false })
  if (error) throw error
  const { data: items } = await supabase.from('pos_transaction_items').select('product_name, qty, subtotal')

  const salesMap = {}
  if (items) items.forEach(i => {
    if (!salesMap[i.product_name]) salesMap[i.product_name] = { qty: 0, revenue: 0 }
    salesMap[i.product_name].qty     += Number(i.qty)
    salesMap[i.product_name].revenue += Number(i.subtotal)
  })

  return batches.map(b => {
    const sold        = salesMap[b.product_name]
    const soldQty     = Math.min(sold?.qty || 0, b.qty)
    const soldCost    = soldQty * Number(b.unit_cost)
    const batchRevenue = b.selling_price ? soldQty * Number(b.selling_price) : (sold?.revenue || 0)
    const grossProfit  = batchRevenue > 0 ? batchRevenue - soldCost : null
    const grossMargin  = grossProfit !== null && batchRevenue > 0 ? Math.round(grossProfit / batchRevenue * 100) : null
    return {
      id:           b.id,
      product:      b.product_name,
      purchaseDate: b.purchase_date,
      batchQty:     b.qty,
      soldQty,
      soldCost,
      batchRevenue,
      grossProfit,
      grossMargin,
    }
  })
}

// ── 圖片上傳（匯款截圖）────────────────────────────────────

export async function uploadPaymentScreenshot(file, orderId) {
  const ext  = file.name.split('.').pop()
  const path = `${orderId}.${ext}`
  const { error } = await supabase.storage.from('payment-screenshots').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('payment-screenshots').getPublicUrl(path)
  return data.publicUrl
}
