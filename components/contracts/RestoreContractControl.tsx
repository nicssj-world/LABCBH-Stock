'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { restoreContract } from '@/lib/contracts/actions'

export function RestoreContractControl({ contractId }: { contractId: number }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const restore = () => {
    setError(null)
    startTransition(async () => {
      try {
        await restoreContract(contractId)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'กู้คืนสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="restore-contract-control">
      <Button variant="secondary" onClick={restore} disabled={isPending}>
        {isPending ? 'กำลังกู้คืน…' : 'กู้คืนสัญญา'}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
