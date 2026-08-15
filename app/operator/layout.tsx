'use client'

import { useEffect } from 'react'

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousHeight = document.body.style.height

    document.body.style.overflow = 'auto'
    document.body.style.height = 'auto'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.height = previousHeight
    }
  }, [])

  return <>{children}</>
}
