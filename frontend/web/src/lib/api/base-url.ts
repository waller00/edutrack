import { trimEndChars } from '@/lib/format/strings'

export function apiBaseUrl(): string {
  return trimEndChars(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000', '/')
}
