'use client'
import { useEffect } from 'react'

export default function LegacyRegisterRedirect() {
  useEffect(() => {
    globalThis.location.replace('/register')
  }, [])

  return null
}
