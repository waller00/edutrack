'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentFile from '@/components/admin/gradebook/StudentFile'
import { safeReturnPath } from '@/lib/libreta/return-path'

export default function Page({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { volver?: string | string[] }
}) {
  // La reunión manda su grupo y período: volver no obliga a elegir todo de nuevo.
  const back = safeReturnPath(searchParams?.volver, '/libreta/reunion')
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1100px] space-y-4">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Reunión de profesores
        </Link>
        <StudentFile studentId={params.id} />
      </main>
    </RoleGuard>
  )
}
