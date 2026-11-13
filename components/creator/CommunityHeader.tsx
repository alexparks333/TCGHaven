'use client'

// A community page's header (docs/creators.md "Communities"): the creator's picture, placed where they
// dragged and zoomed it (the Studio's Community tab), darkened toward the bottom so text reads — or,
// with no picture yet, plain light tan. A fixed 4 : 1 shape, so a placement looks the same anywhere.

import { HEADER_ASPECT, type Community } from '@/lib/creatorBooks'
import { badgeArt } from '@/lib/badgeAssets'
import { cn } from '@/lib/utils'

/** The header before a picture is added: light tan */
export const BLANK_HEADER = '#dccaa4'

export function CommunityHeader({ community, className, children }: { community: Pick<Community, 'color' | 'page'>; className?: string; children?: React.ReactNode }) {
  const look = community.page
  const fit = look?.headerFit
  const shade = Math.max(0, Math.min(1, look?.headerShade ?? 0.35))
  return (
    <div className={cn('relative w-full overflow-hidden', className)} style={{ aspectRatio: String(HEADER_ASPECT), background: look?.header ? '#2b2014' : BLANK_HEADER }}>
      {look?.header ? (
        fit ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeArt(look.header, 1920)} alt="" draggable={false} className="absolute max-w-none select-none pointer-events-none"
            style={{ left: `${50 + fit.x}%`, top: `${50 + fit.y}%`, width: `${fit.scale * 100}%`, transform: 'translate(-50%, -50%)' }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeArt(look.header, 1920)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none" />
        )
      ) : (
        // No picture yet: plain light tan paper, waiting for one
        <div className="absolute inset-0 haven-grain opacity-70" />
      )}
      {look?.header && shade > 0 && <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(to bottom, transparent 35%, rgba(10,6,2,${shade}))` }} />}
      {children}
    </div>
  )
}
