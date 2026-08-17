import type { Metadata } from 'next'
import './admin.css'
import OperationalPeriodsPreview from '../components/OperationalPeriodsPreview'

export const metadata: Metadata = {
  title: 'DASS Administration',
  description: 'Danger Area Status System administration and oversight',
}

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="dass-admin-scroll-shell">
      <OperationalPeriodsPreview mode="admin" />
      {children}
    </div>
  )
}
