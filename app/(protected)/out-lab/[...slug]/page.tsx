import { permanentRedirect } from 'next/navigation'

export default function LegacyOutLabDeepLinkPage() {
  permanentRedirect('/service-procurement/plans?notice=legacy-out-lab')
}
