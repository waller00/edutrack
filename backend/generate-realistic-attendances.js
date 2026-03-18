import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateRealisticTestAttendances() {
  try {
    console.log('🚀 Generando asistencias de prueba realistas...\n');

    // Obtener todos los usuarios disponibles
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true }
    });

    if (users.length === 0) {
      console.log('❌ No hay usuarios en la base de datos.');
      return;
    }

    console.log(`📋 Usando ${users.length} usuarios existentes:`);
    users.forEach(user => {
      console.log(`  - ${user.name} (${user.email}) - ${user.role}`);
    });

    // Limpiar asistencias existentes para empezar limpio
    console.log('\n🧹 Limpiando asistencias existentes...');
    await prisma.attendance.deleteMany({});
    console.log('✅ Asistencias anteriores eliminadas');

    // Generar fechas de los últimos 20 días laborables
    const today = new Date();
    const workDays = [];
    for (let i = 0; i < 20; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      // Solo días laborables (lunes a viernes)
      if (date.getDay() >= 1 && date.getDay() <= 5) {
        workDays.push(date);
      }
    }

    console.log(`📅 Generando datos para ${workDays.length} días laborables`);

    const attendances = [];

    // Generar asistencias más realistas
    for (const date of workDays) {
      for (const user of users) {
        // 85% de probabilidad de asistir cada día
        const willAttend = Math.random() < 0.85;
        
        if (willAttend) {
          // Generar entrada
          const entryHour = user.role === 'ADMIN' ? 
            Math.floor(Math.random() * 2) + 8 : // Admin: 8-9 AM
            Math.floor(Math.random() * 3) + 7;  // Otros: 7-9 AM
          
          const entryMinute = Math.floor(Math.random() * 60);
          const entryTime = new Date(date);
          entryTime.setHours(entryHour, entryMinute, 0, 0);

          // Determinar estado de entrada
          let entryStatus = 'PRESENT';
          let entryNotes = null;
          
          if (entryHour > 8 || (entryHour === 8 && entryMinute > 30)) {
            entryStatus = 'LATE';
            const lateReasons = [
              'Tráfico pesado',
              'Problemas de transporte',
              'Despertador no sonó',
              'Cita médica matutina',
              'Problemas familiares'
            ];
            entryNotes = lateReasons[Math.floor(Math.random() * lateReasons.length)];
          }

          attendances.push({
            userId: user.id,
            type: 'CHECK_IN',
            status: entryStatus,
            date: date,
            time: entryTime,
            notes: entryNotes
          });

          // 90% de probabilidad de tener salida registrada
          if (Math.random() < 0.9) {
            // Generar salida entre 4-6 PM
            const exitHour = Math.floor(Math.random() * 3) + 16; // 16-18 (4-6 PM)
            const exitMinute = Math.floor(Math.random() * 60);
            const exitTime = new Date(date);
            exitTime.setHours(exitHour, exitMinute, 0, 0);

            let exitStatus = 'PRESENT';
            let exitNotes = null;

            // 10% de probabilidad de salida temprana
            if (Math.random() < 0.1) {
              exitStatus = 'EARLY_EXIT';
              const earlyExitReasons = [
                'Cita médica',
                'Emergencia familiar',
                'Reunión externa',
                'Capacitación',
                'Tutor avisó'
              ];
              exitNotes = earlyExitReasons[Math.floor(Math.random() * earlyExitReasons.length)];
            }

            attendances.push({
              userId: user.id,
              type: 'CHECK_OUT',
              status: exitStatus,
              date: date,
              time: exitTime,
              notes: exitNotes
            });
          }
        } else {
          // Ausencia completa
          const absenceReasons = [
            'Licencia médica',
            'Ausencia justificada',
            'Enfermedad',
            'Emergencia familiar',
            'Cita médica todo el día'
          ];
          
          const reason = absenceReasons[Math.floor(Math.random() * absenceReasons.length)];
          const status = 'ABSENT_JUSTIFIED';

          attendances.push({
            userId: user.id,
            type: 'CHECK_IN',
            status: status,
            date: date,
            time: new Date(date.getTime() + 8 * 60 * 60 * 1000), // 8 AM
            notes: reason
          });
        }
      }
    }

    // Insertar todas las asistencias
    console.log('\n📝 Insertando asistencias...');
    const createdAttendances = await prisma.attendance.createMany({
      data: attendances,
      skipDuplicates: true
    });

    console.log(`✅ ${createdAttendances.count} asistencias creadas exitosamente`);

    // Mostrar estadísticas detalladas
    console.log('\n📊 Estadísticas por usuario:');
    for (const user of users) {
      const userAttendances = attendances.filter(a => a.userId === user.id);
      if (userAttendances.length > 0) {
        console.log(`\n👤 ${user.name} (${user.role}):`);
        console.log(`   Total registros: ${userAttendances.length}`);
        
        const byType = userAttendances.reduce((acc, att) => {
          acc[att.type] = (acc[att.type] || 0) + 1;
          return acc;
        }, {});
        
        const byStatus = userAttendances.reduce((acc, att) => {
          acc[att.status] = (acc[att.status] || 0) + 1;
          return acc;
        }, {});

        console.log(`   Entradas: ${byType.CHECK_IN || 0}, Salidas: ${byType.CHECK_OUT || 0}`);
        console.log(`   Estados: ${Object.entries(byStatus).map(([status, count]) => `${status}: ${count}`).join(', ')}`);
        
        // Calcular días trabajados vs días totales
        const uniqueDays = new Set(userAttendances.map(a => a.date.toISOString().split('T')[0])).size;
        console.log(`   Días con registro: ${uniqueDays}/${workDays.length} (${Math.round(uniqueDays/workDays.length*100)}%)`);
      }
    }

    // Mostrar resumen por fecha
    console.log('\n📅 Resumen por fecha:');
    const byDate = attendances.reduce((acc, att) => {
      const dateStr = att.date.toISOString().split('T')[0];
      acc[dateStr] = (acc[dateStr] || 0) + 1;
      return acc;
    }, {});

    Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 10) // Mostrar solo los últimos 10 días
      .forEach(([date, count]) => {
        console.log(`   ${date}: ${count} registros`);
      });

    // Estadísticas generales
    console.log('\n📈 Estadísticas generales:');
    const totalEntries = attendances.filter(a => a.type === 'CHECK_IN').length;
    const totalExits = attendances.filter(a => a.type === 'CHECK_OUT').length;
    const lateEntries = attendances.filter(a => a.type === 'CHECK_IN' && a.status === 'LATE').length;
    const absences = attendances.filter(a => a.status === 'ABSENT_NOT_JUSTIFIED' || a.status === 'ABSENT_JUSTIFIED').length;
    
    console.log(`   Total entradas: ${totalEntries}`);
    console.log(`   Total salidas: ${totalExits}`);
    console.log(`   Entradas tardías: ${lateEntries} (${Math.round(lateEntries/totalEntries*100)}%)`);
    console.log(`   Ausencias: ${absences} (${Math.round(absences/totalEntries*100)}%)`);

    console.log('\n🎉 ¡Datos de prueba realistas generados exitosamente!');
    console.log('\n💡 Datos incluidos:');
    console.log('   - Entradas y salidas realistas');
    console.log('   - Retrasos con justificaciones');
    console.log('   - Ausencias por diferentes motivos');
    console.log('   - Notas descriptivas');
    console.log('   - Patrones diferentes por rol de usuario');

  } catch (error) {
    console.error('❌ Error generando asistencias:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateRealisticTestAttendances();
