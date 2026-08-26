import { permanentRedirect } from 'next/navigation'

export default function LegacyOutLabNewPage() {
  permanentRedirect('/service-procurement/plans/new')
}
