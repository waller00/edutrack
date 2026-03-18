import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

async function createTestUsers() {
  try {
    // Crear usuario admin de prueba con acceso total
    const adminPlainPassword = 'admin12345'
    const adminPassword = await argon2.hash(adminPlainPassword, { type: argon2.argon2id })
    const admin = await prisma.user.upsert({
      where: { email: 'admin@test.com' },
      update: {
        username: 'admin_test',
        firstName: 'Admin',
        lastName: 'Test',
        name: 'Admin Test',
        passwordHash: adminPassword,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        lockUntil: null,
        failedLoginAttempts: 0
      },
      create: {
        email: 'admin@test.com',
        username: 'admin_test',
        firstName: 'Admin',
        lastName: 'Test',
        name: 'Admin Test',
        passwordHash: adminPassword,
        role: 'ADMIN',
        emailVerifiedAt: new Date()
      }
    })

    // Crear usuarios de prueba
    const users = [
      { email: 'joaquin@test.com', username: 'joaquin', name: 'Joaquín García', role: 'TEACHER' },
      { email: 'maria@test.com', username: 'maria', name: 'María López', role: 'STAFF' },
      { email: 'carlos@test.com', username: 'carlos', name: 'Carlos Ruiz', role: 'TEACHER' },
      { email: 'ana@test.com', username: 'ana', name: 'Ana Martínez', role: 'STAFF' }
    ]

    for (const userData of users) {
      const password = await argon2.hash('test12345', { type: argon2.argon2id })
      await prisma.user.upsert({
        where: { email: userData.email },
        update: {
          ...userData,
          passwordHash: password,
          emailVerifiedAt: new Date(),
          lockUntil: null,
          failedLoginAttempts: 0
        },
        create: {
          ...userData,
          passwordHash: password,
          emailVerifiedAt: new Date()
        }
      })
    }

    console.log('Usuarios de prueba creados exitosamente')
    console.log(`ADMIN -> email: ${admin.email} | username: ${admin.username} | password: ${adminPlainPassword}`)
  } catch (error) {
    console.error('Error creando usuarios:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestUsers()
