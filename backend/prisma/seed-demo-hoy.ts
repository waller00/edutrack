/**
 * Dataset de demo **con datos hasta hoy**: llena el ciclo lectivo en curso como si el liceo lo
 * hubiera venido usando desde marzo, y no escribe nada después de la fecha de corte.
 *
 * Se apoya en el dataset base (`npm run seed:demo`), que deja el ciclo anterior cerrado con sus
 * docentes, alumnos y libretas: de ahí hereda la matrícula (promovidos, repetidores, egresados).
 * No toca usuarios ni ciclos cerrados, y es idempotente: volver a correrlo rehace lo operativo del
 * ciclo en curso y deja los mismos números.
 *
 *   npm run seed:demo:hoy                      # ciclo del año corriente, corte = hoy
 *   npm run seed:demo:hoy -- --ciclo=2026      # otro ciclo
 *   npm run seed:demo:hoy -- --hasta=2026-10-23
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { DateTime } from 'luxon'
import { getAppTimezone } from '../src/config/app-timezone.js'
import { seedCicloEnCurso } from './demo/ciclo-en-curso.js'

const prisma = new PrismaClient()

function arg(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta definida')

  const hoy = DateTime.now().setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
  const hasta = arg('hasta') ?? hoy
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new Error(`--hasta tiene que ser yyyy-MM-dd; llegó "${hasta}"`)
  const ciclo = Number(arg('ciclo') ?? hasta.slice(0, 4))

  const resumen = await seedCicloEnCurso(prisma, {
    ciclo,
    hasta,
    ingreso: Number(arg('ingreso') ?? 20),
  })

  console.log('')
  console.log(`[en-curso] Dataset del ciclo ${resumen.ciclo} completado (datos del ${resumen.desde} al ${resumen.hasta}).`)
  console.log(`[en-curso] Oferta: ${resumen.ofertas} cursos | Matrículas vigentes: ${resumen.matriculasVigentes}`)
  console.log(
    `[en-curso] Promovidos: ${resumen.promovidos} | Recursan: ${resumen.repetidores} | ` +
      `Ingresos: ${resumen.ingresos} | Egresados del ciclo anterior: ${resumen.egresados}`,
  )
  console.log(`[en-curso] Eventos del horario: ${resumen.eventos} | Licencias: ${resumen.licencias}`)
  console.log(
    `[en-curso] Asistencia del personal: ${resumen.presentes} marcas de presente, ${resumen.ausencias} ausencias, ` +
      `${resumen.suplencias} suplencias, ${resumen.punches} marcaciones biométricas`,
  )
  console.log(
    `[en-curso] Libreta: ${resumen.libreta.libretas} libretas | ${resumen.libreta.evaluaciones} evaluaciones | ` +
      `${resumen.libreta.notas} notas sueltas`,
  )
  console.log(
    `[en-curso] Boletines cerrados: ${resumen.libreta.cierres} filas C+R | En curso (sólo C): ${resumen.libreta.enCurso} | ` +
      `Pase de lista: ${resumen.libreta.marcasDeAsistencia} marcas`,
  )
  console.log(`[en-curso] Cuotas: ${resumen.cuotas} filas`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
