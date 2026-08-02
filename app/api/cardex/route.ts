import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { sortCatalogCards } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string        // Lorcana numeric set code
  setCode?: string    // Riftbound set code
  setName: string
  rarity: string
  imageUrl: string
  marketPrice?: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game')
  const setName = searchParams.get('set')

  if (!game || !setName) return NextResponse.json([])

  const file =
    game === 'lorcana'   ? 'lorcana-cards.json' :
    game === 'riftbound' ? 'riftbound-cards.json' :
    null

  if (!file) return NextResponse.json([])

  const catalog: CatalogCard[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'public', 'data', file), 'utf-8')
  )

  const cards = sortCatalogCards(catalog.filter((c) => c.setName === setName))
    .map((c) => ({
      id:         c.id,
      name:       c.name,
      number:     c.number,
      setCode:    c.setCode ?? c.set ?? '',
      setName:    c.setName,
      rarity:     c.rarity,
      imageUrl:   c.imageUrl,
      marketPrice: c.marketPrice ?? 0,
    }))

  return NextResponse.json(cards)
}
