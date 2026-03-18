'use client'
import RoleGuard from '@/components/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type UserRow = {
	id:string
	email:string
	username?:string
	role:'ADMIN'|'STAFF'|'TEACHER'
	firstName?:string
	lastName?:string
	emailVerifiedAt?:string
	lockUntil?:string
	nationalId?:string
	isApproved:boolean
	approvedAt?:string
	isActive:boolean
}

export default function AdminUsersPage() {
	const [data, setData] = useState<{ total:number; data:UserRow[] }>({ total: 0, data: [] })
	const [loading, setLoading] = useState(false)
	const [edit, setEdit] = useState<UserRow | null>(null)
	const [editOrig, setEditOrig] = useState<UserRow | null>(null)
	const [saving, setSaving] = useState(false)
	const [msg, setMsg] = useState('')
	const [q, setQ] = useState('')
	const [role, setRole] = useState<'ALL'|'ADMIN'|'STAFF'|'TEACHER'>('ALL')

	async function load() {
		setLoading(true)
		const params = new URLSearchParams({ page: '1', pageSize: '20' })
		if (q) params.set('q', q)
		if (role !== 'ALL') params.set('role', role)
		try { setData(await api(`/admin/users?${params.toString()}`)) } finally { setLoading(false) }
	}

	useEffect(() => { load() }, [])

	function openEdit(u: UserRow) { setEdit({ ...u } as any); setEditOrig({ ...u } as any) }
	function closeEdit() { setEdit(null); setEditOrig(null); setMsg('') }

	async function saveEdit() {
		if (!edit) return
		// construir resumen de cambios
		const changes:string[] = []
		if (editOrig) {
			if (editOrig.role !== edit.role) changes.push(`Rol: ${editOrig.role} → ${edit.role}`)
			if ((editOrig.username||'') !== (edit.username||'')) changes.push(`Usuario: ${editOrig.username||'-'} → ${edit.username||'-'}`)
			const origCi = (editOrig as any).nationalId || ''
			const newCi = (edit as any).nationalId || ''
			if (origCi !== newCi) changes.push(`Cédula: ${origCi || '-'} → ${newCi || '-'}`)
		}
		const proceed = confirm(changes.length ? `Confirmar cambios:\n - ${changes.join('\n - ')}` : 'No hay cambios. ¿Guardar igualmente?')
		if (!proceed) return

		setSaving(true)
		setMsg('')
		try {
			await api(`/admin/users/${edit.id}`, {
				method: 'PUT',
				body: JSON.stringify({
					role: edit.role,
					username: edit.username,
					nationalId: edit.nationalId,
					firstName: edit.firstName,
					lastName: edit.lastName,
					isApproved: edit.isApproved,
					isActive: edit.isActive,
				})
			})
			await load()
			closeEdit()
		} catch (e:any) {
			if (String(e?.message||'').includes('409')) setMsg('Usuario o cédula ya registrados')
			else if (String(e?.message||'').includes('400')) setMsg('Datos inválidos (verifica cédula)')
			else setMsg('No se pudo guardar')
		} finally { setSaving(false) }
	}

	async function toggleLock(u: UserRow) {
		const lock = !u.lockUntil
		if (!confirm(lock ? '¿Bloquear usuario 15 minutos?' : '¿Desbloquear usuario?')) return
		await api(`/admin/users/${u.id}/lock?lock=${lock}`, { method: 'PUT' })
		await load()
	}

	async function resetPassword(u: UserRow) {
		if (!confirm(`Generar token de reset para ${u.email}?`)) return
		const r = await api<{ token:string; expiresAt:string }>(`/admin/users/${u.id}/password/reset`, { method: 'POST' })
		alert(`Token de reset (dev): ${r.token}\nVence: ${new Date(r.expiresAt).toLocaleString()}`)
	}

	async function toggleApproval(u: UserRow) {
		const next = !u.isApproved
		if (!confirm(next ? '¿Aprobar usuario?' : '¿Marcar usuario como pendiente?')) return
		await api(`/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ isApproved: next }) })
		await load()
	}

	async function toggleActive(u: UserRow) {
		const next = !u.isActive
		if (!confirm(next ? '¿Dar de alta al usuario?' : '¿Dar de baja al usuario?')) return
		await api(`/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ isActive: next }) })
		await load()
	}

	return (
		<RoleGuard allow={['ADMIN']}>
			<main className="mx-auto max-w-6xl p-6 space-y-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
							<span className="text-emerald-600 text-xl">👥</span>
						</div>
						<div>
							<h1 className="text-2xl font-bold">Usuarios</h1>
							<p className="text-gray-600">Gestión de usuarios y permisos</p>
						</div>
					</div>
				</div>

				<div className="flex gap-2 items-center">
					<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar (email/usuario/nombre)" className="border border-gray-300 rounded px-3 py-1.5 bg-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
					<select value={role} onChange={e=>setRole(e.target.value as any)} className="border border-gray-300 rounded px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
						<option value="ALL">Todos</option>
						<option value="ADMIN">ADMIN</option>
						<option value="STAFF">STAFF</option>
						<option value="TEACHER">TEACHER</option>
					</select>
					<button onClick={load} className="px-3 py-1.5 bg-black text-white rounded-lg hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">Filtrar</button>
				</div>

				<div className="border rounded-lg bg-white shadow-md overflow-auto">
					<table className="min-w-full text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 text-left">Email</th>
								<th className="px-3 py-2 text-left">Usuario</th>
								<th className="px-3 py-2 text-left">Rol</th>
								<th className="px-3 py-2 text-left">Nombre</th>
								<th className="px-3 py-2 text-left">Verificado</th>
								<th className="px-3 py-2 text-left">Aprobación</th>
								<th className="px-3 py-2 text-left">Alta/Baja</th>
								<th className="px-3 py-2 text-left">Bloqueo</th>
								<th className="px-3 py-2"></th>
								</tr>
						</thead>
						<tbody>
							{data.data.map((u) => (
								<tr key={u.id} className="border-t hover:bg-slate-50">
									<td className="px-3 py-2">{u.email}</td>
									<td className="px-3 py-2">{u.username || '-'}</td>
									<td className="px-3 py-2">{u.role}</td>
									<td className="px-3 py-2">{u.firstName || ''} {u.lastName || ''}</td>
									<td className="px-3 py-2">
										{u.emailVerifiedAt ? (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Verificado</span>
										) : (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">No verificado</span>
										)}
									</td>
									<td className="px-3 py-2">
										{u.isApproved ? (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Aprobado</span>
										) : (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pendiente</span>
										)}
									</td>
									<td className="px-3 py-2">
										{u.isActive ? (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700">Alta</span>
										) : (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Baja</span>
										)}
									</td>
									<td className="px-3 py-2">
										{u.lockUntil ? (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Bloqueado</span>
										) : (
											<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700">Sin bloqueo</span>
										)}
									</td>
									<td className="px-3 py-2 text-right space-x-1">
										<button onClick={()=>toggleApproval(u)} className="inline-grid place-items-center px-2 h-8 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-xs" title={u.isApproved ? 'Volver a pendiente' : 'Aprobar'}>
											{u.isApproved ? 'Pendiente' : 'Aprobar'}
										</button>
										<button onClick={()=>toggleActive(u)} className="inline-grid place-items-center px-2 h-8 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-xs" title={u.isActive ? 'Dar de baja' : 'Dar de alta'}>
											{u.isActive ? 'Dar baja' : 'Dar alta'}
										</button>
										<button onClick={()=>openEdit(u)} className="inline-grid place-items-center w-8 h-8 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400" aria-label="Editar" title="Editar">
											<span className="sr-only">Editar</span>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
												<path d="M13.586 3.586a2 2 0 0 1 2.828 2.828l-9.192 9.192a2 2 0 0 1-.878.505l-3.06.785a.5 .5 0 0 1-.606-.606l.785-3.06a2 2 0 0 1 .505-.878l9.192-9.192Z"/>
												<path d="M12.172 4.999 15 7.828"/>
											</svg>
										</button>
										<button onClick={()=>toggleLock(u)} className="inline-grid place-items-center w-8 h-8 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400" aria-label={u.lockUntil ? 'Desbloquear' : 'Bloquear'} title={u.lockUntil ? 'Desbloquear' : 'Bloquear'}>
											<span className="sr-only">{u.lockUntil ? 'Desbloquear' : 'Bloquear'}</span>
											{u.lockUntil ? (
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
													<path d="M5 8a5 5 0 1 1 10 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h7V8a3 3 0 0 0-6 0H5Z"/>
												</svg>
											) : (
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
													<path d="M10 2a5 5 0 0 1 5 5v1h-2V7a3 3 0 1 0-6 0v1H5V7a5 5 0 0 1 5-5Z"/>
													<path d="M4 9h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/>
												</svg>
											)}
										</button>
										<button onClick={()=>resetPassword(u)} className="inline-grid place-items-center w-8 h-8 border rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400" aria-label="Resetear contraseña" title="Resetear contraseña">
											<span className="sr-only">Resetear contraseña</span>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
												<path d="M10 2a4 4 0 0 1 3.464 1.94l.536.894a1 1 0 0 1-1.732 1.032l-.536-.894A2 2 0 1 0 9 6h1a1 1 0 1 1 0 2H9a4 4 0 1 1 1-6Z"/>
												<path d="M7 11a3 3 0 0 1 3-3h1a1 1 0 1 1 0 2h-1a1 1 0 1 0 0 2h2a3 3 0 1 1 0 6H7a1 1 0 1 1 0-2h5a1 1 0 1 0 0-2H10a3 3 0 0 1-3-3Z"/>
											</svg>
										</button>
								</td>
							</tr>
							))}
						</tbody>
					</table>
				</div>

				{edit && (
					<div className="fixed inset-0 bg-black/30 grid place-items-center p-4">
						<div className="w-full max-w-lg bg-white rounded shadow border p-4">
							<h2 className="font-semibold mb-3">Editar usuario</h2>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div>
									<label className="block text-sm font-medium">Email</label>
									<input value={edit.email} disabled className="w-full border rounded px-3 py-2 bg-gray-100" />
								</div>
								<div>
									<label className="block text-sm font-medium">Usuario</label>
									<input value={edit.username || ''} onChange={e=>setEdit({ ...edit, username: e.target.value })} className="w-full border rounded px-3 py-2 bg-blue-50" />
								</div>
								<div>
									<label className="block text-sm font-medium">Nombre</label>
									<input value={edit.firstName || ''} onChange={e=>setEdit({ ...edit, firstName: e.target.value })} className="w-full border rounded px-3 py-2 bg-blue-50" />
								</div>
								<div>
									<label className="block text-sm font-medium">Apellido</label>
									<input value={edit.lastName || ''} onChange={e=>setEdit({ ...edit, lastName: e.target.value })} className="w-full border rounded px-3 py-2 bg-blue-50" />
								</div>
								<div>
									<label className="block text-sm font-medium">Rol</label>
									<select value={edit.role} onChange={e=>setEdit({ ...edit, role: e.target.value as any })} className="w-full border rounded px-3 py-2 bg-blue-50">
									<option value="ADMIN">ADMIN</option>
									<option value="STAFF">STAFF</option>
									<option value="TEACHER">TEACHER</option>
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium">Cédula</label>
									<input value={edit.nationalId || ''} onChange={e=>setEdit({ ...edit, nationalId: e.target.value })} className="w-full border rounded px-3 py-2 bg-blue-50" />
								</div>
								<div>
									<label className="block text-sm font-medium">Aprobación</label>
									<select value={edit.isApproved ? 'true' : 'false'} onChange={e=>setEdit({ ...edit, isApproved: e.target.value === 'true' })} className="w-full border rounded px-3 py-2 bg-blue-50">
										<option value="false">Pendiente</option>
										<option value="true">Aprobado</option>
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium">Alta/Baja</label>
									<select value={edit.isActive ? 'true' : 'false'} onChange={e=>setEdit({ ...edit, isActive: e.target.value === 'true' })} className="w-full border rounded px-3 py-2 bg-blue-50">
										<option value="true">Alta</option>
										<option value="false">Baja</option>
									</select>
								</div>
							</div>
							{msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
							<div className="mt-4 flex justify-end gap-2">
								<button onClick={closeEdit} className="px-3 py-1.5 border rounded">Cancelar</button>
								<button onClick={saveEdit} disabled={saving} className="px-3 py-1.5 bg-black text-white rounded disabled:opacity-60">{saving? 'Guardando…':'Guardar'}</button>
							</div>
						</div>
					</div>
				)}
			</main>
		</RoleGuard>
	)
} 
