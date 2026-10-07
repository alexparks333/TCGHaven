import type { Config } from 'tailwindcss'

// Parchment theme: every bright Tailwind hue the app uses is re-pointed at a muted, earthy
// palette so no saturated blue/purple/pink ever shows up against the paper background. Each
// palette is generated from one base color (its 500) by mixing toward paper-light for 50–400
// and toward deep brown for 600–950, so shade relationships still behave like Tailwind's.
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
function earthy(base: string) {
  const light = '#f6efe2'
  const dark = '#1f160d'
  return {
    50: mix(base, light, 0.9), 100: mix(base, light, 0.8), 200: mix(base, light, 0.6),
    300: mix(base, light, 0.4), 400: mix(base, light, 0.2), 500: base,
    600: mix(base, dark, 0.15), 700: mix(base, dark, 0.3), 800: mix(base, dark, 0.45),
    900: mix(base, dark, 0.6), 950: mix(base, dark, 0.75),
  }
}
const walnut = earthy('#8a5d36')   // the app's primary accent (was violet)
const plum = earthy('#7a4a5a')
const clay = earthy('#9a5a5a')
const sage = earthy('#66745a')     // stands in for every blue/cyan/teal
const moss = earthy('#5f7a32')     // gains
const rust = earthy('#a8452a')     // losses / danger
const olive = earthy('#7a8030')

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Parchment theme: the whole app was built dark-first on Tailwind's slate scale, so
        // rather than rewrite ~1000 class names, slate itself is re-pointed at a warm paper
        // palette with the scale *inverted* — slate-900/950 (formerly the darkest panel/page
        // tones) are now the lightest papers, and slate-50..400 (formerly light text) are now
        // dark brown inks. `ink` replaces what used to be text-white for primary text.
        slate: {
          50: '#2a1f14',
          100: '#33261a',
          200: '#3f3021',
          300: '#4f3e2b',
          400: '#634f38',
          500: '#7a654a',
          600: '#94805f',
          700: '#bba883',
          800: '#d6c49f',
          900: '#ede1c6',
          950: '#f3e9d3',
        },
        ink: '#2b2014',
        violet: walnut, purple: plum, indigo: plum, fuchsia: clay, pink: clay,
        blue: sage, sky: sage, cyan: sage, teal: sage,
        emerald: moss, green: moss, lime: olive,
        red: rust, rose: rust,
        pokemon: '#B8860B',
        lorcana: '#6e4f6a',
        riftbound: '#b5532f',
      },
    },
  },
  plugins: [],
}

export default config
