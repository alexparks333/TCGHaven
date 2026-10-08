import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'

// Gate for creating a new TCGHaven account. The real code lives only in this server-only env
// var (never NEXT_PUBLIC_, never shipped to the browser) — the client only ever learns whether
// what it typed matched, never the code itself.
//
// Hardened against guessing: the comparison is constant-time (hashing both sides first gives
// equal-length buffers, which timingSafeEqual requires), and every wrong guess waits before
// answering, so trying codes in bulk is slow.
const WRONG_GUESS_DELAY_MS = 1000

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code : ''

  const expected = process.env.SIGNUP_PASSCODE
  if (!expected) {
    return NextResponse.json({ error: 'Sign-ups are not configured yet — SIGNUP_PASSCODE is not set.' }, { status: 500 })
  }

  const digest = (s: string) => createHash('sha256').update(s).digest()
  const ok = code.length > 0 && timingSafeEqual(digest(code), digest(expected))
  if (!ok) await new Promise((r) => setTimeout(r, WRONG_GUESS_DELAY_MS))
  return NextResponse.json({ ok })
}
