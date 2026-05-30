export function buildDailyStockPlan(items, products, stockDate = new Date().toISOString().slice(0, 10)) {
  const productMap = {}
  products.forEach(p => { productMap[p.name] = p })

  const normalizedItems = items
    .map(item => ({
      name: item.name?.trim() ?? '',
      openStock: Number(item.openStock) || 0,
      price: Number(item.price) || 0,
    }))
    .filter(item => item.name && item.openStock > 0)

  const productsToCreate = normalizedItems
    .filter(item => !productMap[item.name])
    .map(item => ({
      name: item.name,
      price: item.price,
      category: '其他',
      is_active: true,
    }))

  const stocksToUpsert = normalizedItems
    .map(item => {
      const product = productMap[item.name]
      if (!product) return null
      return {
        product_id: product.id,
        stock_date: stockDate,
        open_stock: item.openStock,
      }
    })
    .filter(Boolean)

  const productsToUpdate = normalizedItems
    .map(item => {
      const product = productMap[item.name]
      if (!product || Number(item.price) === Number(product.price)) return null
      return { id: product.id, price: item.price }
    })
    .filter(Boolean)

  return { productsToCreate, stocksToUpsert, productsToUpdate }
}
