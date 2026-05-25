'use client'
import MedicalLeaveCertificateLink from '@/components/personal/MedicalLeaveCertificateLink'
import RoleGuard from '@/components/auth/RoleGuard'
import { api } from '@/lib/api/client'
import {
  getLicenseStatusBadgeClass,
  getLicenseStatusLabel,
  getLicenseTypeLabel,
} from '@/lib/admin/licenses-display'
import { useEffect, useState } from 'react'

type License = {
  id: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  status: 'ACTIVE' | 'INACTIVE'
  startDate: string
  endDate: string
  reason: string
  notes?: string
  certificate?: string | null
}

export default function MyLicensesPage(_props: { role?: 'STAFF' | 'TEACHER' } = {}) {
  const [licenses, setLicenses] = useState<License[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadLicenses() {
      try {
        const data = await api<{ data: License[] }>('/medical-leaves/my-leaves')
        setLicenses(data.data)
      } catch (error) {
        console.error('Error cargando mis licencias:', error)
      } finally {
        setLoading(false)
      }
    }

    void loadLicenses()
  }, [])

  return (
    <RoleGuard permission="licenses.read" permissionScope="own">
      <main className="responsive-page max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <span className="text-emerald-600 text-xl">📄</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Mis Licencias</h1>
            <p className="text-gray-600">
              Consultá las licencias registradas por la institución. Si hay certificado digital o enlace, podés
              abrirlo desde la tabla.
            </p>
          </div>
        </div>

        <div className="bg-white border rounded-lg shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Período</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Motivo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificado</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notas</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">Cargando...</td>
                  </tr>
                ) : licenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No tienes licencias registradas</td>
                  </tr>
                ) : (
                  licenses.map((license) => (
                    <tr key={license.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{getLicenseTypeLabel(license.type)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(license.startDate).toLocaleDateString('es-ES')} - {new Date(license.endDate).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getLicenseStatusBadgeClass(license.status)}`}>
                          {getLicenseStatusLabel(license.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{license.reason}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <MedicalLeaveCertificateLink
                          certificate={license.certificate}
                          linkClassName="text-emerald-700 hover:text-emerald-900 font-medium"
                        />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{license.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </RoleGuard>
  )
}
