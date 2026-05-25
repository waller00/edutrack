import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../auth/jwt.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
    course: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    courseOffering: { findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    subject: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    subjectCourseAssignment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  getActiveSchoolYearId: vi.fn().mockResolvedValue('sy-default'),
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-default'),
  ensureCourseOffering: vi.fn().mockResolvedValue({ id: 'off-1', courseId: '00000000-0000-4000-8000-0000000000c1', schoolYearId: 'sy-default', isActive: true }),
}))

import coursesRoutes from './courses.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/courses', coursesRoutes)
  return a
}

const courseId = '00000000-0000-4000-8000-0000000000c1'
const subjectId = '00000000-0000-4000-8000-0000000000a1'

describe('courses / subjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.course.findUnique.mockResolvedValue({ id: courseId, level: 'EMS' })
    prismaMock.courseOffering.findFirst.mockResolvedValue({ id: 'off-1', courseId, schoolYearId: 'sy-default' })
    prismaMock.subjectCourseAssignment.create.mockResolvedValue({ id: 'as-1' })
  })

  it('GET /courses/:id/subjects 404 si curso no visible', async () => {
    prismaMock.course.findFirst.mockResolvedValueOnce(null)
    const tok = signAccessToken({ sub: 'a', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app())
      .get(`/courses/${courseId}/subjects`)
      .set('Authorization', `Bearer ${tok}`)
    expect(res.status).toBe(404)
  })

  it('GET /courses/:id/subjects lista', async () => {
    prismaMock.course.findFirst.mockResolvedValueOnce({ id: courseId })
    prismaMock.subject.findMany.mockResolvedValueOnce([
      { id: subjectId, name: 'Matemática', code: 'MAT', description: null, sortOrder: 0, isActive: true, courseId },
    ])
    const tok = signAccessToken({ sub: 't', email: 't@t.com', role: 'TEACHER' })
    const res = await request(app())
      .get(`/courses/${courseId}/subjects?schoolYearId=${'sy-default'}`)
      .set('Authorization', `Bearer ${tok}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].name).toBe('Matemática')
  })

  it('POST /courses/:id/subjects ADMIN crea', async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: courseId })
    prismaMock.subject.create.mockResolvedValue({
      id: subjectId,
      name: 'Historia',
      code: null,
      description: null,
      sortOrder: 1,
      isActive: true,
      courseId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const tok = signAccessToken({ sub: 'a', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app())
      .post(`/courses/${courseId}/subjects`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ name: 'Historia', sortOrder: 1 })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Historia')
  })

  it('POST /courses/:id/subjects 403 TEACHER', async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: courseId })
    const tok = signAccessToken({ sub: 't', email: 't@t.com', role: 'TEACHER' })
    const res = await request(app())
      .post(`/courses/${courseId}/subjects`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ name: 'X' })
    expect(res.status).toBe(403)
    expect(prismaMock.subject.create).not.toHaveBeenCalled()
  })

  it('PUT /courses/:id/subjects/:sid ADMIN actualiza', async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: courseId })
    prismaMock.subject.findFirst.mockResolvedValue({ id: subjectId })
    prismaMock.subject.update.mockResolvedValue({
      id: subjectId,
      name: 'Historia del Arte',
      code: 'HART',
      description: null,
      sortOrder: 2,
      isActive: false,
      courseId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const tok = signAccessToken({ sub: 'a', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app())
      .put(`/courses/${courseId}/subjects/${subjectId}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ name: 'Historia del Arte', code: 'HART', sortOrder: 2, isActive: false })
    expect(res.status).toBe(200)
    expect(res.body.isActive).toBe(false)
  })

  it('DELETE /courses/:id/subjects/:sid ADMIN', async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: courseId })
    prismaMock.subject.deleteMany.mockResolvedValue({ count: 1 })
    const tok = signAccessToken({ sub: 'a', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app())
      .delete(`/courses/${courseId}/subjects/${subjectId}`)
      .set('Authorization', `Bearer ${tok}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
