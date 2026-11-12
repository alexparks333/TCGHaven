'use client'

// Renders a pop-up straight into <body>, so it always sits over the whole screen. Inside the Creator
// Studio a parent with a transform or filter (the entrance animation, sticky panels) would otherwise
// become the box a `fixed` pop-up is placed in — pushing it under the top bar or off screen.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? createPortal(children, document.body) : null
}
