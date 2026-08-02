export interface Purchase {
  id: string
  productId: string
  pricePaid: number
  quantity: number
  date: string // ISO "YYYY-MM-DD"
}
