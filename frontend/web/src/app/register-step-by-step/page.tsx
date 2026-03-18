'use client'
import { useEffect } from 'react'

export default function LegacyRegisterRedirect() {
  useEffect(() => {
    window.location.replace('/register')
  }, [])

  return null
}
