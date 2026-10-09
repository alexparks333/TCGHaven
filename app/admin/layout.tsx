import type { Metadata } from 'next'
import { StaffPortal } from '@/components/admin/StaffPortal'

export const metadata: Metadata = { title: 'TCGHaven Staff Portal' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StaffPortal>{children}</StaffPortal>
}
