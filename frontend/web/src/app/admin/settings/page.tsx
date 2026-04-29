'use client'
import { useCallback, useEffect, useState } from 'react'
import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import { Shield } from 'lucide-react'

type SettingsResponse = { diditConfigured: boolean }

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<SettingsResponse>('/admin/system-settings')
      setData(r)
    } catch {
      setData(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-2xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-3">
            <Shield className="h-8 w-8 text-emerald-700" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Registro y alta de personas</h1>
            <p className="text-sm text-gray-600">
              Quien crea cuenta debe completar la verificación online con sus datos declarados cuando el servidor está
              correctamente configurado. No hay un interruptor: aplica igual para todas las altas nuevas.
            </p>
          </div>
        </div>

        {!data ? (
          <p className="text-gray-500">Cargando…</p>
        ) : (
          <div className="card space-y-4">
            <p className="text-sm font-medium text-gray-900">
              Estado actual:{' '}
              <span className={data.diditConfigured ? 'text-emerald-700' : 'text-amber-800'}>
                {data.diditConfigured ? 'Verificación disponible para nuevos registros' : 'Falta definir las credenciales en el servidor'}
              </span>
            </p>
            {!data.diditConfigured ? (
              <p className="text-sm text-amber-800">
                En el entorno de despliegue definí las variables de entorno del verificador (API y flujo) según la
                documentación del proveedor. Hasta entonces el formulario de registro mostrará que el alta no está
                disponible.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                El servicio de verificación responde en el backend: no hace falta activar ni desactivar nada desde la
                interfaz.
              </p>
            )}
            <div>
              <button type="button" onClick={() => void load()} className="btn-secondary text-sm">
                Consultar estado
              </button>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
