'use client'
import { useEffect, useRef, useState } from 'react'
import { PendingButtonContent } from '@/components/PendingButtonContent'
import { api } from '@/lib/api'
import { Info } from 'lucide-react'

declare global {
	interface Window {
		turnstile?: {
			render: (container: HTMLElement, options: Record<string, unknown>) => string
			reset?: (widgetId: string) => void
			remove?: (widgetId: string) => void
		}
	}
}

export default function ForgotPage() {
	const [email, setEmail] = useState('')
	const [sent, setSent] = useState<string | null>(null)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const [captchaToken, setCaptchaToken] = useState('')
	const widgetRef = useRef<HTMLDivElement>(null)
	const widgetIdRef = useRef<string | null>(null)

	const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

	function resetTurnstileWidget() {
		const id = widgetIdRef.current
		if (id && window.turnstile?.reset) {
			try {
				window.turnstile.reset(id)
			} catch {
				/* ignore */
			}
		}
		setCaptchaToken('')
	}

	useEffect(() => {
		if (!siteKey) return

		function renderWidget(): boolean {
			const el = widgetRef.current
			if (!el || !window.turnstile?.render) return false
			try {
				if (widgetIdRef.current && window.turnstile.remove) {
					window.turnstile.remove(widgetIdRef.current)
				}
			} catch {
				/* ignore */
			}
			widgetIdRef.current = null
			widgetIdRef.current = window.turnstile.render(el, {
				sitekey: siteKey,
				callback: (token: string) => setCaptchaToken(token),
				'error-callback': () => setCaptchaToken(''),
				'expired-callback': () => setCaptchaToken(''),
				theme: 'light',
			})
			return true
		}

		const scriptId = 'turnstile-script'
		const scheduleRender = () => {
			requestAnimationFrame(() => {
				if (!renderWidget()) {
					requestAnimationFrame(() => {
						renderWidget()
					})
				}
			})
		}

		if (document.getElementById(scriptId)) {
			scheduleRender()
			return () => {
				if (widgetIdRef.current && window.turnstile?.remove) {
					try {
						window.turnstile.remove(widgetIdRef.current)
					} catch {
						/* ignore */
					}
					widgetIdRef.current = null
				}
			}
		}

		const s = document.createElement('script')
		s.id = scriptId
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileForgot'
		;(window as unknown as { onloadTurnstileForgot?: () => void }).onloadTurnstileForgot = () => scheduleRender()
		document.body.appendChild(s)

		return () => {
			if (widgetIdRef.current && window.turnstile?.remove) {
				try {
					window.turnstile.remove(widgetIdRef.current)
				} catch {
					/* ignore */
				}
				widgetIdRef.current = null
			}
		}
	}, [siteKey])

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError('')
		if (siteKey && !captchaToken) {
			setError('Valida el captcha para continuar')
			return
		}
		setLoading(true)
		try {
			const res = await api<{ ok: boolean; resetUrl?: string }>('/auth/forgot', {
				method: 'POST',
				body: JSON.stringify({ email, captchaToken: captchaToken || undefined }),
			})
			setSent(res.resetUrl || 'ok')
			if (siteKey) resetTurnstileWidget()
		} catch (e: unknown) {
			const msg = String((e as Error)?.message || '')
			if (msg.includes('400')) setError('Captcha inválido. Intenta nuevamente.')
			else setError('No se pudo enviar el email. Intenta nuevamente.')
			if (siteKey) resetTurnstileWidget()
		} finally {
			setLoading(false)
		}
	}

	return (
		<main className="min-h-screen gradient-light flex items-center justify-center p-4">
			<div className="w-full max-w-md">
				<div className="card shadow-modern-lg">
					<div className="text-center mb-8">
						<div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
							<img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
						</div>
						<h1 className="text-3xl font-bold text-gray-900 mb-2">Recuperar Contraseña</h1>
						<p className="text-gray-600">Ingresa tu email para recibir un enlace de restablecimiento</p>
					</div>

					{sent ? (
						<div className="space-y-6">
							<div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
								<div className="flex items-center gap-3">
									<div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
										<Info className="h-4 w-4 text-blue-600" aria-hidden />
									</div>
									<div>
										<p className="text-sm font-medium text-blue-800">Email enviado</p>
										<p className="text-sm text-blue-700">Si el email existe, te enviamos un enlace para restablecer tu contraseña.</p>
									</div>
								</div>
							</div>
							{sent !== 'ok' && (
								<div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
									<p className="text-sm text-gray-600 mb-2">En desarrollo puedes usar este enlace directamente:</p>
									<a className="text-emerald-600 underline break-all" href={sent}>
										{sent}
									</a>
								</div>
							)}
							<p className="text-center text-sm text-gray-500">
								Revisá tu correo. Podés cerrar esta pestaña o{' '}
								<a href="/login" className="text-emerald-600 font-medium hover:underline">
									ir al inicio de sesión
								</a>{' '}
								cuando quieras.
							</p>
						</div>
					) : (
						<form onSubmit={onSubmit} className="space-y-6">
							<div>
								<label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="email">
									Email
								</label>
								<input
									id="email"
									type="email"
									required
									className="input-field"
									placeholder="tu@correo.com"
									value={email}
									onChange={e => setEmail(e.target.value)}
								/>
							</div>

							{siteKey ? (
								<div className="space-y-2">
									<p className="text-sm text-gray-600 text-center">Verificación de seguridad</p>
									<div ref={widgetRef} className="flex justify-center min-h-[65px]" />
								</div>
							) : null}

							{error && (
								<div className="p-4 bg-red-50 border border-red-200 rounded-lg">
									<p className="text-red-600 text-sm">{error}</p>
								</div>
							)}

							<button
								type="submit"
								className="btn-primary w-full disabled:opacity-60"
								disabled={loading}
							>
								<PendingButtonContent pending={loading} pendingText="Enviando…" idle="Enviar enlace" />
							</button>

							<div className="text-center">
								<a className="text-emerald-600 hover:text-emerald-700 font-medium" href="/login">
									Volver al login
								</a>
							</div>
						</form>
					)}
				</div>
			</div>
		</main>
	)
}
