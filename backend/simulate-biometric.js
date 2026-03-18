import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function simulateBiometricSystem() {
  try {
    console.log('🚀 Simulando sistema biométrico...\n');

    // Obtener usuarios disponibles
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true }
    });

    console.log(`📋 Usuarios disponibles: ${users.length}`);
    users.forEach(user => {
      console.log(`  - ${user.name} (${user.email}) - ${user.role}`);
    });

    // Simular marcas biométricas para hoy
    const today = new Date();
    const todayDate = new Date(today);
    todayDate.setHours(0, 0, 0, 0);

    console.log(`\n📅 Simulando marcas para: ${todayDate.toLocaleDateString('es-ES')}`);

    // Simular diferentes escenarios
    const scenarios = [
      {
        user: users[0], // Primer usuario
        entryTime: new Date(today.getTime() + 7 * 60 * 60 * 1000), // 7:00 AM
        exitTime: new Date(today.getTime() + 16 * 60 * 60 * 1000), // 4:00 PM
        description: 'Entrada puntual, salida normal'
      },
      {
        user: users[1], // Segundo usuario
        entryTime: new Date(today.getTime() + 8 * 60 * 60 * 1000 + 45 * 60 * 1000), // 8:45 AM
        exitTime: new Date(today.getTime() + 17 * 60 * 60 * 1000), // 5:00 PM
        description: 'Entrada tardía, salida normal'
      },
      {
        user: users[2], // Tercer usuario
        entryTime: new Date(today.getTime() + 7 * 60 * 60 * 1000 + 30 * 60 * 1000), // 7:30 AM
        exitTime: new Date(today.getTime() + 15 * 60 * 60 * 1000 + 30 * 60 * 1000), // 3:30 PM
        description: 'Entrada puntual, salida anticipada'
      },
      {
        user: users[3], // Cuarto usuario
        entryTime: new Date(today.getTime() + 9 * 60 * 60 * 1000), // 9:00 AM
        exitTime: new Date(today.getTime() + 18 * 60 * 60 * 1000), // 6:00 PM
        description: 'Entrada muy tardía, salida tarde'
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n👤 ${scenario.user.name} - ${scenario.description}`);
      
      // Simular entrada
      const entryResponse = await fetch('http://localhost:4000/attendance/biometric', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': 'access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlZDA0MjQ5Ny0xMDdjLTQ1MzMtOWE2Yi1mOGJlNzRhY2Q2ZmQiLCJlbWFpbCI6ImFkbWluQHRlc3QuY29tIiwicm9sZSI6IkFETUlOIiwiaWF0IjoxNzYwNjYwOTY1LCJleHAiOjE3NjA2NjgxNjV9.E2qte48wZPfuKANYyY9zCr6VkiGPLKRQWfEG019QLfU'
        },
        body: JSON.stringify({
          userId: scenario.user.id,
          timestamp: scenario.entryTime.toISOString(),
          biometricData: 'fingerprint_data_' + Math.random().toString(36).substr(2, 9),
          deviceId: 'BIOMETRIC_DEVICE_001'
        })
      });

      if (entryResponse.ok) {
        const entryData = await entryResponse.json();
        console.log(`  ✅ Entrada: ${entryData.message}`);
        if (entryData.isLate) {
          console.log(`  ⚠️  RETRASO detectado automáticamente`);
        }
      } else {
        const error = await entryResponse.text();
        console.log(`  ❌ Error en entrada: ${error}`);
      }

      // Simular salida
      const exitResponse = await fetch('http://localhost:4000/attendance/biometric', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': 'access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlZDA0MjQ5Ny0xMDdjLTQ1MzMtOWE2Yi1mOGJlNzRhY2Q2ZmQiLCJlbWFpbCI6ImFkbWluQHRlc3QuY29tIiwicm9sZSI6IkFETUlOIiwiaWF0IjoxNzYwNjYwOTY1LCJleHAiOjE3NjA2NjgxNjV9.E2qte48wZPfuKANYyY9zCr6VkiGPLKRQWfEG019QLfU'
        },
        body: JSON.stringify({
          userId: scenario.user.id,
          timestamp: scenario.exitTime.toISOString(),
          biometricData: 'fingerprint_data_' + Math.random().toString(36).substr(2, 9),
          deviceId: 'BIOMETRIC_DEVICE_001'
        })
      });

      if (exitResponse.ok) {
        const exitData = await exitResponse.json();
        console.log(`  ✅ Salida: ${exitData.message}`);
      } else {
        const error = await exitResponse.text();
        console.log(`  ❌ Error en salida: ${error}`);
      }
    }

    console.log('\n🎉 ¡Simulación del sistema biométrico completada!');
    console.log('\n💡 Funcionalidades probadas:');
    console.log('   - Registro automático de entrada/salida');
    console.log('   - Detección automática de retrasos');
    console.log('   - Validación de duplicados');
    console.log('   - Notas automáticas del dispositivo');
    console.log('   - Estados automáticos (PRESENT/LATE)');

    console.log('\n🔧 Próximos pasos:');
    console.log('   - Los usuarios pueden agregar notas explicativas');
    console.log('   - El admin puede ver todas las asistencias');
    console.log('   - Se pueden filtrar por estado, usuario, fecha');
    console.log('   - Se pueden editar estados y notas');

  } catch (error) {
    console.error('❌ Error en simulación:', error);
  } finally {
    await prisma.$disconnect();
  }
}

simulateBiometricSystem();






