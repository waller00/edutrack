import crypto from 'crypto'

export type ExportFormat = 'PDF' | 'XLSX' | 'CSV'
export type ExportStatus = 'PENDING' | 'DONE' | 'FAILED'

type StoredExport = {
  exportId: string
  status: ExportStatus
  format: ExportFormat
  reportKey: string
  filename: string
  contentType: string
  // ExcelJS/pdfkit devuelven Buffer tipado con genéricos; para no pelear tipos, guardamos `any`.
  buffer: any | null
  errorMessage?: string
  createdAt: Date
  finishedAt?: Date
}

const store = new Map<string, StoredExport>()

export function createExportId() {
  return crypto.randomUUID()
}

export function setExport(id: string, partial: Partial<StoredExport>) {
  const existing = store.get(id)
  if (!existing) return
  store.set(id, { ...existing, ...partial })
}

export function getExport(id: string) {
  const e = store.get(id)
  if (!e) return null
  return e
}

export function createPendingExport(params: {
  exportId?: string
  format: ExportFormat
  reportKey: string
  filename: string
  contentType: string
}) {
  const exportId = params.exportId || createExportId()
  store.set(exportId, {
    exportId,
    status: 'PENDING',
    format: params.format,
    reportKey: params.reportKey,
    filename: params.filename,
    contentType: params.contentType,
    buffer: null,
    createdAt: new Date(),
  })
  return exportId
}

export function getDownloadUrl(exportId: string) {
  return `/exports/${exportId}/download`
}

export function markFailed(exportId: string, errorMessage: string) {
  setExport(exportId, { status: 'FAILED', errorMessage, finishedAt: new Date(), buffer: null })
}

export function markDone(exportId: string, buffer: any, finishedAt = new Date()) {
  setExport(exportId, { status: 'DONE', buffer, finishedAt })
}

