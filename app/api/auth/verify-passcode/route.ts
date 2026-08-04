import { NextResponse } from 'next/server'

// Gate for creating a new TCGHaven account. The real code lives only in this server-only env
// var (never NEXT_PUBLIC_, never shipped to the browser) — the client only ever learns whether
// what it typed matched, never the code itself.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const code = body?.code as string | undefined

  const expected = process.env.SIGNUP_PASSCODE
  if (!expected) {
    return NextResponse.json({ error: 'Sign-ups are not configured yet — SIGNUP_PASSCODE is not set.' }, { status: 500 })
  }

  const ok = !!code && code === expected
  return NextResponse.json({ ok })
}
