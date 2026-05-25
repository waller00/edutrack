'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** La comparación vive en `/admin/school-years`; esta ruta conserva enlaces viejos. */
export default function CompareSchoolYearsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/school-years')
  }, [router])
  return (
    <main className="responsive-page max-w-lg text-center text-sm text-gray-600">
      Redirigiendo a ciclos lectivos…
    </main>
  )
}
