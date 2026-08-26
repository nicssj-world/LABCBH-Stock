import { permanentRedirect } from 'next/navigation'

export default function LegacyOutLabEditPage() {
  permanentRedirect('/service-procurement/plans?notice=legacy-out-lab')
}
