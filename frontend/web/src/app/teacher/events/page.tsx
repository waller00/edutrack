'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Ruta legacy por rol. La vista canónica vive en `/me/events`; acá solo redirigimos. */
export default function TeacherEventsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/me/events')
  }, [router])
  return (
    <main className="responsive-page max-w-lg text-center text-sm text-gray-600">
      Redirigiendo…
    </main>
  )
}
