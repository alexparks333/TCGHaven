import { redirect } from 'next/navigation'

// Settings moved into the profile (the ⚙️ on your profile banner) — old links land there, open.
export default function Page() {
  redirect('/profile?settings=1')
}
