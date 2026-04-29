/** Subconjunto tipo frontend `RegisterVerificationResults` sin importar desde web. */

export type RegisterVerificationEntryLite = {
  provided: string
  extracted?: string
  message: string
}

export type RegisterVerificationLite = {
  verifiedFields: number
  totalFields: number
  verification: Record<string, RegisterVerificationEntryLite>
}
