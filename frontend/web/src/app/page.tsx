'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { HomeMe } from '@/lib/home-dashboard'
import {
  getResendButtonLabel,
  getSectionIcon,
  getVisibleHomeSections,
  getWelcomeMessage,
} from '@/lib/home-dashboard'

export default function Home() {
  const [me, setMe] = useState<HomeMe | null>(null)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    api<HomeMe>('/auth/me')
      .then((u) => {
        setMe(u)
      })
      .catch(() => (window.location.href = '/login'))
  }, [])

  async function resend() {
    setResending(true)
    try {
      await api('/auth/verify/resend', { method: 'POST' })
      setResent(true)
    } finally {
      setResending(false)
    }
  }

  if (!me) return null
  const notVerified = !me.emailVerifiedAt
  const needsProfile = !!me.needsProfileCompletion
  const pendingApproval = !me.isApproved
  const inactiveAccount = !me.isActive

  const sections = getVisibleHomeSections(me)

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-8">
      {/* Alertas */}
      {notVerified && (
        <div className="card border-l-4 border-l-yellow-400 bg-yellow-50">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">⚠</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">Email no verificado</p>
              <p className="text-sm text-yellow-700">Revisa tu bandeja o reenvía el correo de verificación.</p>
            </div>
            <button
              onClick={resend}
              disabled={resending || resent}
              className="btn-warning text-sm disabled:opacity-60"
            >
              {getResendButtonLabel(resent, resending)}
            </button>
          </div>
        </div>
      )}

      {needsProfile && (
        <div className="card border-l-4 border-l-blue-400 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-blue-400 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">ℹ</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Perfil incompleto</p>
              <p className="text-sm text-blue-700">Completa tu información personal para continuar.</p>
            </div>
            <a href="/onboarding" className="btn-primary text-sm">
              ✏️ Completar perfil
            </a>
          </div>
        </div>
      )}

      {pendingApproval && !needsProfile && (
        <div className="card border-l-4 border-l-amber-400 bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">⏳</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Cuenta pendiente de aprobación</p>
              <p className="text-sm text-amber-700">Tu registro ya fue enviado. Un administrador debe validarlo antes de habilitar el sistema.</p>
            </div>
          </div>
        </div>
      )}

      {inactiveAccount && (
        <div className="card border-l-4 border-l-red-400 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-red-400 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">!</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Cuenta dada de baja</p>
              <p className="text-sm text-red-700">Tu acceso está desactivado. Contacta a un administrador si necesitas reactivarlo.</p>
            </div>
          </div>
        </div>
      )}

      {/* Header de bienvenida */}
      <section className="text-center py-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
            <span className="text-emerald-600 text-xl">👋</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">¡Hola, {me.name || me.email}!</h1>
            <p className="text-emerald-600 font-medium">{me.role}</p>
          </div>
        </div>
        <p className="text-gray-600 max-w-2xl mx-auto">{getWelcomeMessage(inactiveAccount, pendingApproval)}</p>
      </section>

      {/* Tarjetas de funcionalidades */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sections.map((s) => (
          <div key={s.href} className="card group hover:shadow-lg transition-all duration-300 fade-in">
            <div className="card-header">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                  <span className="text-emerald-600 text-lg">
                    {getSectionIcon(s.title)}
                  </span>
                </div>
                <h2 className="font-semibold text-lg text-gray-900">{s.title}</h2>
              </div>
              <p className="text-gray-600 text-sm leading-relaxed">{s.desc}</p>
            </div>
            <a
              href={s.href}
              className="btn-primary w-full text-center justify-center group-hover:scale-105 transition-transform"
            >
              {s.cta}
            </a>
          </div>
        ))}
      </section>

      {/* Footer informativo */}
      <section className="text-center py-8 border-t border-gray-200">
        <div className="max-w-2xl mx-auto">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">EduTrack</h3>
          <p className="text-gray-600 text-sm">
            Plataforma moderna para la gestión integral de asistencias, eventos y licencias médicas.
          </p>
        </div>
      </section>
    </main>
  )
}
