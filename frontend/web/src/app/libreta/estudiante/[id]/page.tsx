'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentFile from '@/components/admin/gradebook/StudentFile'

export default function Page({ params }: { params: { id: string } }) {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1100px] space-y-4">
        <Link href="/libreta/grupo" className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Vista de grupo
        </Link>
        <StudentFile studentId={params.id} />
      </main>
    </RoleGuard>
  )
}
