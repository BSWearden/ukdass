import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DASS Administration',
  description: 'Danger Area Status System administration and oversight',
}

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
