export const RESET_BUSINESS_TABLES = [
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
]

export async function deleteAllRowsFromTables(supabase, tables = RESET_BUSINESS_TABLES) {
  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .not('id', 'is', null)
    if (error) throw error
  }
}
