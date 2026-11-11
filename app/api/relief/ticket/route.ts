import { NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { verifyCreatorRequest } from '@/lib/firebase/verifyAdminRequest'

// The Creator Studio's pass to the 3D maker (HavenRelief on a GPU — docs/creators.md "The 3D
// maker's GPU"). A Creator (or staff) asks here; they get the GPU server's address and a ticket
// good for 2 hours: "{uid}.{expires}.{signature}", signed with HAVENRELIEF_SECRET, which
// tools/havenrelief/server.py checks. Nobody else can run up the GPU bill, and the server never
// needs to know about Firebase.
//   POST (signed-in user's ID token) → { url, ticket } — or { url: null } when no GPU is set up yet

const TICKET_HOURS = 2

export async function POST(request: Request) {
  const who = await verifyCreatorRequest(request)
  if (who instanceof NextResponse) return who
  const url = process.env.HAVENRELIEF_URL
  const secret = process.env.HAVENRELIEF_SECRET
  if (!url || !secret) return NextResponse.json({ url: null })
  const expires = Math.floor(Date.now() / 1000) + TICKET_HOURS * 3600
  const body = `${who.uid}.${expires}`
  const ticket = `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`
  return NextResponse.json({ url, ticket })
}
