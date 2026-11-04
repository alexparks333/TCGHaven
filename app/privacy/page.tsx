import type { Metadata } from 'next'
import Link from 'next/link'

// The privacy policy — public (no sign-in), linked from the App Store listing and the app. Shown
// without the app's sidebar (ClientWrapper). Keep it true to what the code does: update it when
// what's collected, who can see it, or who processes it changes.

export const metadata: Metadata = { title: 'Privacy Policy · TCGHaven' }

const CONTACT_EMAIL = 'support@tcghaven.org' // TODO(owner): confirm this inbox exists before the App Store submission
const UPDATED = 'November 4, 2026'

export default function Page() {
  return (
    <div className="h-dvh overflow-y-auto">
      <article className="mx-auto max-w-2xl px-5 py-10 md:py-16 text-[15px] leading-relaxed text-slate-300">
        <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-ink">← TCGHaven</Link>
        <h1 className="mt-6 text-3xl font-bold text-ink">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated {UPDATED}</p>

        <Section title="The short version">
          TCGHaven keeps track of your trading card collection. We only keep what the app needs to do
          that, we don’t sell your data, we don’t show ads, and we don’t track you around the web. You
          can delete your account and everything in it from the app at any time.
        </Section>

        <Section title="What we keep">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><b className="text-ink">Your account:</b> your email address and name, and your profile photo if you sign in with Google or Apple.</li>
            <li><b className="text-ink">Your collection:</b> the cards you add, with the details you enter (condition, quantity, purchase price and date, grade, groups), cards you’ve sold, and your personal collections.</li>
            <li><b className="text-ink">Your profile:</b> your @username, bio, privacy choices, the badges you’ve earned and your Pin Display.</li>
            <li><b className="text-ink">Your friends:</b> the friend requests you send and receive.</li>
            <li><b className="text-ink">Your settings:</b> such as filters, so they match on every device.</li>
          </ul>
        </Section>

        <Section title="Who can see it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Your purchase prices, what you paid, your portfolio value and your sold cards are <b className="text-ink">only ever visible to you</b>.</li>
            <li>Other signed-in collectors can see your profile: your name, @username, photo, bio, Pin Display and — unless you turn them off in your profile’s privacy settings — your badges and which cards you own (without any prices). Your email address is never shown to anyone.</li>
            <li>Friend requests are visible only to the two people involved.</li>
          </ul>
        </Section>

        <Section title="Who processes it">
          Your data is stored with Google Firebase (sign-in, database and file storage) and the app is
          hosted by Vercel. They process it only to run TCGHaven. Card details and prices come from
          public card databases; those requests are made by our server and carry nothing about you.
          Links to stores such as eBay open their own sites, under their own privacy policies.
        </Section>

        <Section title="On your device">
          The app keeps a copy of your collection and some settings in your browser or the app’s
          storage, so it opens quickly. This is cleared when you sign out or delete your account.
          We don’t use advertising or analytics cookies.
        </Section>

        <Section title="Deleting your account">
          Open your profile, tap the ⚙️ Settings, then <b className="text-ink">Delete account</b>. This
          permanently deletes your collection, sold cards, collections, profile, username, badges,
          friends and sign-in. It can’t be undone.
        </Section>

        <Section title="Children">
          TCGHaven isn’t directed at children under 13, and we don’t knowingly collect their data.
        </Section>

        <Section title="Changes and contact">
          If this policy changes, we’ll update the date above. Questions or requests:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-ink underline">{CONTACT_EMAIL}</a>.
        </Section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-ink mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  )
}
