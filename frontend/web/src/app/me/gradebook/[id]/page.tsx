'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import GradeBookDetail from '@/components/gradebook/GradeBookDetail'

export default function GradeBookPage({ params }: { params: { id: string } }) {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1100px]">
        <GradeBookDetail gradeBookId={params.id} />
      </main>
    </RoleGuard>
  )
}
