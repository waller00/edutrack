'use client'

import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import {
  getLicenseStatusBadgeClass,
  getLicenseStatusLabel,
  getLicenseTypeLabel,
} from '@/lib/admin/licenses-display'
import { ymdToDmy } from '@/lib/forms/date-mask'
import DateRangePicker from '@/components/forms/DateRangePicker'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import {
  PersonalHeader,
  PersonalLoading,
  PersonalError,
  PersonalPagination,
} from './PersonalPageUi'

type License = {
  id: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  status: 'ACTIVE' | 'INACTIVE'
  startDate: string
  endDate: string
  reason: string
  notes?: string
}
type Response = { data: License[]; pagination?: { totalPages: number } }

export default function MyLicensesPage(
  _props: { role?: 'STAFF' | 'TEACHER' } = {},
) {
  return (
    <RoleGuard permission="licenses.read" permissionScope="own">
      <LicensesContent />
    </RoleGuard>
  )
}

function LicensesContent() {
  const { me } = useAuth()
  const [licenses, setLicenses] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    if (!me?.id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      try {
        const first = await api<Response>(
          '/medical-leaves/my-leaves?pageSize=100',
        )
        const all = [...first.data]
        for (
          let pageNumber = 2;
          pageNumber <= (first.pagination?.totalPages ?? 1) && !cancelled;
          pageNumber++
        ) {
          const more = await api<Response>(
            `/medical-leaves/my-leaves?pageSize=100&page=${pageNumber}`,
          )
          all.push(...more.data)
        }
        if (!cancelled) setLicenses(all)
      } catch {
        if (!cancelled) {
          setLicenses([])
          setError('No se pudieron cargar tus licencias.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [me?.id, refresh])
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  const visible = licenses.filter(
    (license) =>
      (!status || license.status === status) &&
      (!startDate || license.endDate.slice(0, 10) >= startDate) &&
      (!endDate || license.startDate.slice(0, 10) <= endDate) &&
      normalize(
        `${getLicenseTypeLabel(license.type)} ${license.reason} ${license.notes || ''}`,
      ).includes(normalize(search)),
  )
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / 20)))
  return (
    <main className="responsive-page max-w-6xl space-y-5">
      <PersonalHeader
        title="Mis Licencias"
        description="Consultá las licencias registradas por la institución."
        icon={<FileText className="h-6 w-6" aria-hidden />}
      />
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div
          role="group"
          aria-label="Estado de mis licencias"
          className="flex flex-wrap gap-1"
        >
          {[
            ['', 'Todas'],
            ['ACTIVE', 'Activas'],
            ['INACTIVE', 'Inactivas'],
          ].map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={status === id}
              onClick={() => {
                setStatus(id)
                setPage(1)
              }}
              className={`rounded-lg px-3 py-2 text-sm ${status === id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(range) => {
              setStartDate(range.startDate)
              setEndDate(range.endDate)
              setPage(1)
            }}
          />
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Buscar licencia
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Tipo o motivo"
              className="input-field min-h-11 text-sm"
            />
          </label>
        </div>
        {(status || search || startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              setStatus('')
              setSearch('')
              setStartDate('')
              setEndDate('')
              setPage(1)
            }}
            className="text-sm font-medium text-emerald-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>
      {loading ? (
        <PersonalLoading />
      ) : error ? (
        <PersonalError
          message={error}
          retry={() => setRefresh((value) => value + 1)}
        />
      ) : (
        <>
          <p className="text-xs text-slate-500">{visible.length} {visible.length === 1 ? 'licencia' : 'licencias'}</p>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              {licenses.length
                ? 'No hay licencias que coincidan con los filtros.'
                : 'No tienes licencias registradas'}
            </p>
          ) : (
            <ul className="grid items-start gap-4 lg:grid-cols-2">
              {visible
                .slice((safePage - 1) * 20, safePage * 20)
                .map((license) => (
                  <li
                    key={license.id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">
                        {getLicenseTypeLabel(license.type)}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${getLicenseStatusBadgeClass(license.status)}`}
                      >
                        {getLicenseStatusLabel(license.status)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">
                      {ymdToDmy(license.startDate.slice(0, 10))} –{' '}
                      {ymdToDmy(license.endDate.slice(0, 10))}
                    </p>
                    <p className="text-sm text-slate-600">{license.reason}</p>
                    {license.notes && (
                      <SettingsDetails title="Notas de la licencia">
                        <p className="text-sm text-slate-600">
                          {license.notes}
                        </p>
                      </SettingsDetails>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <PersonalPagination
            page={safePage}
            total={visible.length}
            onPage={setPage}
          />
        </>
      )}
    </main>
  )
}
