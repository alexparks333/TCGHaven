// Shown the instant you click into a page that has to ask the server first (a card's detail page,
// someone's profile, an invite link — pages with an id in the address). Every other page is
// pre-built and switches immediately without it.
export default function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-600 text-sm">Loading…</div>
    </div>
  )
}
