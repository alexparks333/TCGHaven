// The doorway logo animation's frames — one place for the numbers every player of it uses, so a new
// render (scripts/logo-animation.mjs) can't leave one of them out of step:
//   the phone splash (components/layout/SplashIntro.tsx, public/splash/frame-NN.webp — preloaded in
//   app/layout.tsx), and the sidebar / sign-in logo (components/LogoFrames.tsx, the frame strips).
// A render with a different frame count: change LOGO_FRAMES here, then rebuild the files.

/** Frames in the render (scripts/logo-animation.mjs reads the After Effects PNGs) */
export const LOGO_FRAMES = 21
/** 30 fps, as rendered */
export const LOGO_FRAME_MS = 33

/** The phone splash's frame i — one 720px picture per frame */
export const splashFrame = (i: number) => `/splash/frame-${String(i).padStart(2, '0')}.webp`
/** The same 21 frames as one video (scripts/splash/make-splash-video.swift — re-run after re-rendering
 *  the frames): what the phone splash plays (components/layout/SplashIntro.tsx) */
export const SPLASH_VIDEO = '/splash/splash.mp4'
