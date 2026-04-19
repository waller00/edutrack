'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from '@/lib/password-strength'

export default function ResetPage() {
	const [token, setToken] = useState('')
	const [password, setPassword] = useState('')
	const [confirm, setConfirm] = useState('')
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		const p = new URLSearchParams(window.location.search)
		const t = p.get('token') || ''
		setToken(t)
	}, [])

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError('')
		if (!isStrongPassword(password)) return setError(STRONG_PASSWORD_MESSAGE)
		if (password !== confirm) return setError('Las contraseñas no coinciden')
		setLoading(true)
		try {
			await api<{ id: string; email: string; name: string; role: string }>('/auth/reset', {
				method: 'POST',
				body: JSON.stringify({ token, password }),
			})
			window.location.href = '/'
		} catch (e: unknown) {
			const msg = String((e as Error)?.message || '')
			if (msg.includes('desactivada')) setError('Tu cuenta está dada de baja. Contacta a un administrador.')
			else if (msg.includes('mayúscula') && msg.includes('minúscula')) setError(msg)
			else setError('El enlace es inválido o expiró')
		} finally {
			setLoading(false)
		}
	}

	return (
		<main className="min-h-screen grid place-items-center bg-gradient-to-b from-slate-100 to-slate-2 00">
			<div className="w-full max-w-sm bg-white border border-gray-300 rounded-2xl p-6 shadow-md hover:shadow-lg transition">
				<div className="mx-auto mb-2 w-10 h-10 grid place-items-center rounded-full bg-blue-50 text-blue-600">🔒</div>
				<h1 className="text-2xl font-bold mb-1 text-center">Restablecer contraseña</h1>
				<p className="text-center text-sm text-slate-500 mb-4">Elige una nueva contraseña segura.</p>
				<form onSubmit={onSubmit} className="space-y-3">
						<input type="hidden" value={token} readOnly />
						<label className="block text-sm font-medium text-slate-700" htmlFor="password">Nueva contraseña</label>
						<input
							id="password"
							type="password"
							className="w-full border border-gray-300 rounded px-3 py-2 bg-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
							placeholder="Nueva contraseña"
							value={password}
							onChange={e => setPassword(e.target.value)}
							required
						/>
						<label className="block text-sm font-medium text-slate-700" htmlFor="confirm">Confirmar contraseña</label>
						<input
							id="confirm"
							type="password"
							className="w-full border border-gray-300 rounded px-3 py-2 bg-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
							placeholder="Confirmar contraseña"
							value={confirm}
							onChange={e => setConfirm(e.target.value)}
							required
						/>
						{error && <p className="text-red-600 text-sm">{error}</p>}
						<button
							type="submit"
							className="w-full bg-black text-white py-2 rounded-lg hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
							disabled={loading}
						>
							{loading ? 'Actualizando…' : 'Actualizar contraseña'}
						</button>
						<div className="text-sm mt-2 text-center">
							<a className="text-blue-600 hover:underline" href="/login">Volver al login</a>
						</div>
					</form>
			</div>
		</main>
	)
} 