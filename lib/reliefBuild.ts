// Which Relief Studio build (components/badges/pinRelief.ts bakeReliefBuild — the pin's shape,
// worked out once) a badge can use. Kept apart from pinRelief.ts so the key can be checked without
// loading three.js.

/** The art's own holes are rounded off this much unless the Studio says otherwise (ReliefSettings.holeSmooth) */
export const HOLE_SMOOTH = 0.3

// Bump when bakeReliefBuild's steps change what they make: every badge's saved build is then
// ignored (its key no longer matches) until it's built again.
export const RELIEF_BUILD_VERSION = 1

/** What a build was made from; a badge's build is only used while this still matches the badge. */
export function reliefBuildKey(imageUrl: string | undefined, finishMapUrl: string | undefined, holeSmooth: number | undefined, artHoles: boolean | undefined): string {
  return JSON.stringify([RELIEF_BUILD_VERSION, imageUrl ?? '', finishMapUrl ?? '', holeSmooth ?? HOLE_SMOOTH, !!artHoles])
}

