import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateTestAttendances() {
  try {
    console.log('🚀 Generando asistencias de prueba...\n');

    // Obtener todos los usuarios disponibles
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true }
    });

    if (users.length === 0) {
      console.log('❌ No hay usuarios en la base de datos. Ejecuta primero el script de usuarios de prueba.');
      return;
    }

    console.log(`📋 Usuarios disponibles: ${users.length}`);
    users.forEach(user => {
      console.log(`  - ${user.name} (${user.email}) - ${user.role}`);
    });

    // Generar fechas de los últimos 15 días
    const today = new Date();
    const dates = [];
    for (let i = 0; i < 15; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date);
    }

    // Estados y tipos posibles
    const attendanceTypes = ['CHECK_IN', 'CHECK_OUT'];
    const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'MEDICAL_LEAVE', 'JUSTIFIED_ABSENCE'];
    
    // Notas de ejemplo
    const notes = [
      'Llegué tarde por tráfico',
      'Salida temprana por cita médica',
      'Tutor avisó',
      'Licencia médica',
      'Reunión de padres',
      'Capacitación',
      'Sin observaciones',
      'Retraso por transporte público',
      'Salida por emergencia familiar',
      'Entrada normal',
      'Salida normal',
      'Ausencia justificada por enfermedad',
      'Tarde por problemas de salud',
      'Salida por consulta médica',
      'Sin notas'
    ];

    const attendances = [];

    // Generar 30 asistencias
    for (let i = 0; i < 30; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const date = dates[Math.floor(Math.random() * dates.length)];
      const type = attendanceTypes[Math.floor(Math.random() * attendanceTypes.length)];
      const status = attendanceStatuses[Math.floor(Math.random() * attendanceStatuses.length)];
      const note = Math.random() > 0.3 ? notes[Math.floor(Math.random() * notes.length)] : null;

      // Generar hora aleatoria según el tipo
      let hour, minute;
      if (type === 'CHECK_IN') {
        // Entrada entre 7:00 y 9:30
        hour = Math.floor(Math.random() * 3) + 7; // 7, 8, 9
        minute = Math.floor(Math.random() * 60);
        if (hour === 9 && minute > 30) {
          hour = 9;
          minute = Math.floor(Math.random() * 31); // Solo hasta 9:30
        }
      } else {
        // Salida entre 15:00 y 18:00
        hour = Math.floor(Math.random() * 4) + 15; // 15, 16, 17, 18
        minute = Math.floor(Math.random() * 60);
      }

      const time = new Date(date);
      time.setHours(hour, minute, 0, 0);

      // Ajustar estado según la hora (para hacer más realista)
      let finalStatus = status;
      if (type === 'CHECK_IN' && hour > 8 && minute > 30) {
        finalStatus = 'LATE';
      } else if (status === 'ABSENT' && type === 'CHECK_IN') {
        // Si está ausente, no debería tener hora de entrada
        finalStatus = 'ABSENT';
      }

      attendances.push({
        userId: user.id,
        type: type,
        status: finalStatus,
        date: date,
        time: time,
        notes: note
      });
    }

    // Insertar todas las asistencias
    console.log('\n📝 Insertando asistencias...');
    const createdAttendances = await prisma.attendance.createMany({
      data: attendances,
      skipDuplicates: true
    });

    console.log(`✅ ${createdAttendances.count} asistencias creadas exitosamente`);

    // Mostrar resumen por usuario
    console.log('\n📊 Resumen por usuario:');
    for (const user of users) {
      const userAttendances = attendances.filter(a => a.userId === user.id);
      if (userAttendances.length > 0) {
        console.log(`\n👤 ${user.name} (${user.role}):`);
        console.log(`   Total: ${userAttendances.length} registros`);
        
        const byType = userAttendances.reduce((acc, att) => {
          acc[att.type] = (acc[att.type] || 0) + 1;
          return acc;
        }, {});
        
        const byStatus = userAttendances.reduce((acc, att) => {
          acc[att.status] = (acc[att.status] || 0) + 1;
          return acc;
        }, {});

        console.log(`   Tipos: ${Object.entries(byType).map(([type, count]) => `${type}: ${count}`).join(', ')}`);
        console.log(`   Estados: ${Object.entries(byStatus).map(([status, count]) => `${status}: ${count}`).join(', ')}`);
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
      .forEach(([date, count]) => {
        console.log(`   ${date}: ${count} registros`);
      });

    console.log('\n🎉 ¡Datos de prueba generados exitosamente!');
    console.log('\n💡 Puedes ahora:');
    console.log('   - Probar el login con cualquier usuario');
    console.log('   - Ver las asistencias en /admin/attendance');
    console.log('   - Filtrar por diferentes criterios');
    console.log('   - Editar estados y notas');

  } catch (error) {
    console.error('❌ Error generando asistencias:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateTestAttendances();
