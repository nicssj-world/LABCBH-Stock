import { permanentRedirect } from 'next/navigation'

export default function LegacyOutLabDetailPage() {
  permanentRedirect('/service-procurement/plans?notice=legacy-out-lab')
}
