'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgeTier, pinSize, type BadgeDef } from '@/lib/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { loadBadges, type SharedBadges } from '@/lib/firebase/badges'
import { useFriends } from '@/components/friends/FriendsProvider'
import { toBannerPins, updateProfileDetails, type Profile } from '@/lib/firebase/friends'
import { PinInspector, preloadPinInspector } from './pinInspectorLoader'
import { PinPicker } from './BadgeShowcase'
import { BadgePin } from './BadgePin'
import { useTrimmedArt } from './trimmedArt'

// One pin on the banner. With a mouse it tilts toward the pointer while a glint of light moves
// across it — the same light-catching tilt as the pin book (BadgeBook.tsx BadgeSpot). Click: the
// 3D inspect view for visitors, the picker for the owner. The silhouette shadow and the drop
// shadow sit on parts that don't tilt (a filter on the tilting element blurs it, see BadgeSpot).
function BannerPin({ def, size, box, grayscale, title, onClick }: {
  def: BadgeDef
  size: number
  box: { width: number; height: number }
  grayscale: boolean
  title: string
  onClick: () => void
}) {
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null)
  const art = useTrimmedArt(def.imageUrl) // the glint is masked to the pin's own shape
  useEffect(() => { preloadPinInspector() }, []) // so a click opens the 3D view at once
  const drawn = Math.min(size, pinSize(def, size)) // never past the banner's height, whatever the Display size
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        setTilt({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
      }}
      onPointerLeave={() => setTilt(null)}
      title={title}
      aria-label={title}
      className="banner-pin relative flex items-center justify-center outline-none cursor-pointer"
      style={box}
    >
      {/* its shadowed backing: the pin's own silhouette in soft dark, a touch bigger and lower,
          pressed into the parchment behind it */}
      <span aria-hidden className="banner-pin-backing absolute inset-0 flex items-center justify-center pointer-events-none">
        <BadgePin art={def.art} imageUrl={def.imageUrl} size={drawn} />
      </span>
      <span
        className="banner-pin-tilt relative block"
        style={{
          transform: tilt
            ? `perspective(700px) rotateY(${(tilt.x - 0.5) * 18}deg) rotateX(${(0.5 - tilt.y) * 18}deg) translateY(-3px)`
            : undefined,
        }}
      >
        <span className={cn('flex [&>*]:shrink-0 [&>img]:max-w-none', grayscale && 'grayscale')}>
          <BadgePin art={def.art} imageUrl={def.imageUrl} size={drawn} />
        </span>
        {tilt && (
          <span
            className="pinbook-glint absolute inset-0"
            style={{
              background: `radial-gradient(circle at ${tilt.x * 100}% ${tilt.y * 100}%, rgba(255,255,255,${grayscale ? 0.48 : 0.55}), rgba(255,255,255,0.06) 35%, transparent 60%)`,
              ...(art && { WebkitMask: `url("${art.src}") center / contain no-repeat`, mask: `url("${art.src}") center / contain no-repeat` }),
            }}
          />
        )}
      </span>
    </button>
  )
}

// The pins a collector attaches to their profile's header banner (left of Settings), pinned
// straight into the parchment and sized by the page to fill the banner top to bottom. Saved as `profiles/{uid}.bannerPins` (BANNER_PIN_SPOTS long). Like the
// Pin Display, only pins actually earned show, in their tier's look (Grayscale / Full).
// The owner always sees their spots (with nothing earned yet they lead to the Badges page); visitors see only the pins, and only when the owner's
// Badges are public (a pin's look needs their badge progress, which is private otherwise).

export function BannerPins({ profile, isMe, onSaved, size }: {
  profile: Profile
  isMe: boolean
  onSaved: (p: Profile) => void
  size: number
}) {
  const { catalog } = useBadgeCatalog()
  const { myBadges, isFriend } = useFriends()
  const canSee = profile.privacy.badges || isFriend(profile.uid) // Everyone, or Friends and you're one
  const ids = useMemo(() => toBannerPins(profile.bannerPins), [profile.bannerPins])
  const anyChosen = ids.some(Boolean)
  const [theirs, setTheirs] = useState<SharedBadges | 'private' | undefined>(undefined)
  const [picking, setPicking] = useState<number | null>(null)
  const [inspect, setInspect] = useState<BadgeDef | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (isMe || !anyChosen || !canSee) return
    let live = true
    loadBadges(profile.uid).then((b) => { if (live) setTheirs(b) }).catch(() => { if (live) setTheirs('private') })
    return () => { live = false }
  }, [isMe, anyChosen, canSee, profile.uid])

  const badges = isMe ? myBadges : theirs && theirs !== 'private' ? theirs : null
  const byId = useMemo(() => new Map(catalog.badges.map((b) => [b.id, b])), [catalog.badges])
  const tierOf = (d: BadgeDef) => (badges ? badgeTier(d, badges.progress[d.id]) : 0)
  const earned = useMemo(
    () => (badges ? catalog.badges.filter((d) => badgeTier(d, badges.progress[d.id]) > 0) : []),
    [catalog.badges, badges],
  )
  const shown = ids.map((id) => { const d = id ? byId.get(id) : undefined; return d && tierOf(d) > 0 ? d : null })

  if (!badges) return null
  // Visitors: nothing on the strap → no strap at all. You: always, so you can fill it.
  if (!isMe && shown.every((d) => !d)) return null
  // You always see your strap, even before your first badge — Brad never knew it was there
  // (2026-11-19). With nothing earned its spots lead to the Badges page instead of the picker.
  const nothingYet = isMe && earned.length === 0

  async function save(next: string[]) {
    const before = profile
    setError(false)
    onSaved({ ...profile, bannerPins: next })
    try { await updateProfileDetails(profile.uid, { bannerPins: next }) } catch (e) { console.error(e); onSaved(before); setError(true) }
  }
  function place(spot: number, id: string) {
    const next = ids.map((x) => (x === id ? '' : x)) // a pin is only ever in one spot: moving it
    next[spot] = id
    setPicking(null)
    void save(next)
  }
  function remove(spot: number) {
    const next = [...ids]
    next[spot] = ''
    setPicking(null)
    void save(next)
  }

  const spots = shown.map((def, i) => ({ def, i })).filter((s) => isMe || s.def)
  const box = { width: size * 1.02, height: size * 1.12 }

  return (
    <>
      <div
        title={isMe && !profile.privacy.badges ? 'Only your friends can see these pins while your Badges are set to Friends' : undefined}
        className="relative flex items-center" style={{ gap: size * 0.12 }}>
        {spots.map(({ def, i }) => def ? (
          <BannerPin
            key={i}
            def={def}
            size={size}
            box={box}
            grayscale={tierOf(def) === 1}
            title={isMe ? `${def.name} — change or take off` : `${def.name} — view in 3D`}
            onClick={() => (isMe ? setPicking(i) : setInspect(def))}
          />
        ) : nothingYet ? (
          <Link
            key={i}
            href="/badges"
            title="Earn a badge to pin it here"
            aria-label="Earn a badge to pin it here — open your Badges"
            className="group flex items-center justify-center outline-none"
            style={box}
          >
            <span className="banner-hole flex items-center justify-center rounded-full transition-colors" style={{ width: size * 0.9, height: size * 0.9 }}>
              <Plus size={Math.max(14, size * 0.22)} strokeWidth={1.5} className="text-[#4a321f]/40 group-hover:text-[#4a321f]/75" />
            </span>
          </Link>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => setPicking(i)}
            title="Attach a pin to your banner"
            aria-label="Attach a pin to your banner"
            className="group flex items-center justify-center outline-none"
            style={box}
          >
            <span className="banner-hole flex items-center justify-center rounded-full transition-colors" style={{ width: size * 0.9, height: size * 0.9 }}>
              <Plus size={Math.max(14, size * 0.22)} strokeWidth={1.5} className="text-[#4a321f]/40 group-hover:text-[#4a321f]/75" />
            </span>
          </button>
        ))}
        {error && <span className="absolute -bottom-5 right-0 whitespace-nowrap text-[0.625rem] font-semibold text-red-700">Couldn’t save — try again</span>}
      </div>

      {picking !== null && (
        <PinPicker
          current={shown[picking]}
          earned={earned}
          tierOf={tierOf}
          displayed={new Set(ids.filter(Boolean))}
          onPick={(id) => place(picking, id)}
          onRemove={() => remove(picking)}
          onView={(d) => { setPicking(null); setInspect(d) }}
          onClose={() => setPicking(null)}
        />
      )}
      {inspect && badges && (
        <PinInspector
          def={inspect}
          earnedAt={badges.earned[inspect.id]}
          progress={badges.progress[inspect.id]}
          onClose={() => setInspect(null)}
        />
      )}
    </>
  )
}
