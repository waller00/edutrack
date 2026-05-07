import { redirect } from 'next/navigation'

export default function AdminProfilesPage() {
  redirect('/admin/settings?section=profiles')
}
