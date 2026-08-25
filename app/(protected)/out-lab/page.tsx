import { permanentRedirect } from 'next/navigation'

export default function LegacyOutLabPage() {
  permanentRedirect('/service-procurement/plans?notice=legacy-out-lab')
}
