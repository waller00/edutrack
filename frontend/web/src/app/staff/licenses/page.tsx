'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Ruta legacy por rol. La vista canónica vive en `/me/licenses`; acá solo redirigimos. */
export default function StaffLicensesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/me/licenses')
  }, [router])
  return (
    <main className="responsive-page max-w-lg text-center text-sm text-gray-600">
      Redirigiendo…
    </main>
  )
}
