import { prisma } from '../../prisma.js'

/** null = sin filtro; [] = sin coincidencias (el caller puede cortar). */
export async function resolveUserIdsFromSearch(userSearch: string | undefined): Promise<string[] | null> {
  if (!userSearch?.trim()) return null
  const q = userSearch.trim()
  const users = await prisma.user.findMany({
    where: {
      NOT: { orgRole: { code: 'ADMIN' } },
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 100,
  })
  return users.map((u) => u.id)
}

export function userDisplayName(u: {
  name: string | null
  firstName: string | null
  lastName: string | null
  username: string | null
  id: string
}): string {
  return u.name?.trim() || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || u.id.slice(0, 8)
}
