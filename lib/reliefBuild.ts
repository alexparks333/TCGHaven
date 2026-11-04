import type { BadgeDef } from './badges'

// Which Relief Studio build (components/badges/pinRelief.ts bakeReliefBuild — the pin's shape,
// worked out once) a badge can use. Kept apart from pinRelief.ts so the staff portal can tell which
// badges need one without loading three.js.

/** The art's own holes are rounded off this much unless the Studio says otherwise (ReliefSettings.holeSmooth) */
export const HOLE_SMOOTH = 0.3

// Bump when bakeReliefBuild's steps change what they make: every badge's saved build is then
// ignored (its key no longer matches) until it's built again.
export const RELIEF_BUILD_VERSION = 1

/** What a build was made from; a badge's build is only used while this still matches the badge. */
export function reliefBuildKey(imageUrl: string | undefined, finishMapUrl: string | undefined, holeSmooth: number | undefined, artHoles: boolean | undefined): string {
  return JSON.stringify([RELIEF_BUILD_VERSION, imageUrl ?? '', finishMapUrl ?? '', holeSmooth ?? HOLE_SMOOTH, !!artHoles])
}

/** The key for this badge as it is now. */
export function badgeBuildKey(b: BadgeDef): string {
  return reliefBuildKey(b.imageUrl, b.finishMapUrl, b.relief?.holeSmooth, b.relief?.artHoles)
}

/** A relief badge (art + Studio height map, no 3D model) whose build is missing or out of date. */
export function needsReliefBuild(b: BadgeDef): boolean {
  return !b.model && !!b.imageUrl && !!b.depthMapUrl && b.reliefBuildKey !== badgeBuildKey(b)
}
