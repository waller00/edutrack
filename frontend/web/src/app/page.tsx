'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Info, Loader2, Mail, PenLine } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { HomeAdminAttendanceFeed, HomeGenericHint, HomeUpcomingSchedule } from '@/components/home/HomeRolePanels'
import { api } from '@/lib/api/client'
import type { HomeMe } from '@/lib/home/dashboard'
import { getWelcomeMessage } from '@/lib/home/dashboard'

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

  const canRoleDashboard = me.isApproved && me.isActive && !needsProfile
  const scheduleRole = me.role === 'TEACHER' || me.role === 'STAFF' ? me.role : null

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:max-w-4xl sm:px-6 lg:max-w-5xl">
      {notVerified && (
        <div className="card border-l-4 border-l-yellow-400 bg-yellow-50">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400">
              <AlertTriangle className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">Email no verificado</p>
              <p className="text-sm text-yellow-700">Revisa tu bandeja o reenvía el correo de verificación.</p>
            </div>
            <button
              onClick={resend}
              disabled={resending || resent}
              className="btn-warning inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60"
            >
              {resent ? (
                <>
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  Enviado
                </>
              ) : (
                <PendingButtonContent
                  pending={resending}
                  pendingText="Enviando…"
                  idle={
                    <>
                      <Mail className="h-4 w-4 shrink-0" aria-hidden />
                      Reenviar correo
                    </>
                  }
                />
              )}
            </button>
          </div>
        </div>
      )}

      {needsProfile && (
        <div className="card border-l-4 border-l-blue-400 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-400">
              <Info className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Perfil incompleto</p>
              <p className="text-sm text-blue-700">Completa tu información personal para continuar.</p>
            </div>
            <a href="/onboarding" className="btn-primary inline-flex items-center justify-center gap-2 text-sm">
              <PenLine className="h-4 w-4 shrink-0" aria-hidden />
              Completar perfil
            </a>
          </div>
        </div>
      )}

      {pendingApproval && !needsProfile && (
        <div className="card border-l-4 border-l-amber-400 bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-white" aria-hidden />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Cuenta pendiente de aprobación</p>
              <p className="text-sm text-amber-700">
                Tu registro ya fue enviado. Un administrador debe validarlo antes de habilitar el sistema.
              </p>
            </div>
          </div>
        </div>
      )}

      {inactiveAccount && (
        <div className="card border-l-4 border-l-red-400 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-400">
              <span className="text-xs text-white">!</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Cuenta dada de baja</p>
              <p className="text-sm text-red-700">
                Tu acceso está desactivado. Contacta a un administrador si necesitas reactivarlo.
              </p>
            </div>
          </div>
        </div>
      )}

      <header className="relative overflow-hidden rounded-2xl border border-emerald-100/60 bg-white/90 px-5 py-6 shadow-sm ring-1 ring-slate-950/[0.03] sm:px-8 sm:py-7">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400"
          aria-hidden
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700/90">Inicio</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              ¡Hola, {me.name || me.email}!
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600">{getWelcomeMessage(inactiveAccount, pendingApproval)}</p>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            {me.role === 'ADMIN'
              ? 'Administración'
              : me.role === 'TEACHER'
                ? 'Docente'
                : me.role === 'STAFF'
                  ? 'Personal'
                  : me.role}
          </span>
        </div>
      </header>

      {canRoleDashboard && me.role === 'ADMIN' && <HomeAdminAttendanceFeed />}

      {canRoleDashboard && scheduleRole && me.id && <HomeUpcomingSchedule role={scheduleRole} userId={me.id} />}

      {canRoleDashboard && me.role !== 'ADMIN' && !scheduleRole && <HomeGenericHint />}

      <footer className="pb-2 pt-2 text-center text-[11px] text-slate-400">EduTrack</footer>
    </main>
  )
}
