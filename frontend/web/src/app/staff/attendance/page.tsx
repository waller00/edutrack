'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Ruta legacy por rol. La vista canónica vive en `/me/attendance`; acá solo redirigimos. */
export default function StaffAttendanceRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/me/attendance')
  }, [router])
  return (
    <main className="responsive-page max-w-lg text-center text-sm text-gray-600">
      Redirigiendo…
    </main>
  )
}
