'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { SignaturePad } from '@/components/requisitions/SignaturePad'
import { signRequisitionReceipt } from '@/lib/requisitions/actions'

export interface RequisitionSignaturePanelProps {
  requisitionId: string
  defaultReceiverName: string
}

export function RequisitionSignaturePanel({ requisitionId, defaultReceiverName }: RequisitionSignaturePanelProps) {
  const router = useRouter()
  const [receivedByName, setReceivedByName] = useState(defaultReceiverName)
  const [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (!signature) return
    setError(null)
    startTransition(async () => {
      try {
        await signRequisitionReceipt(requisitionId, {
          receivedByName: receivedByName.trim(),
          signature,
        })
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกลายเซ็นต์รับของไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="requisition-signature">
      <label className="field-row">
        ชื่อผู้รับของ
        <input
          type="text"
          required
          value={receivedByName}
          onChange={(event) => setReceivedByName(event.target.value)}
        />
        <small className="form-field-note">ถ้าผู้รับของไม่ใช่ผู้ขอเบิก ลบแล้วพิมพ์ชื่อผู้รับของจริงแทนได้</small>
      </label>

      <SignaturePad onChange={setSignature} disabled={isPending} />

      {error && <p className="form-error" role="alert">{error}</p>}

      <Button type="button" onClick={submit} disabled={isPending || !receivedByName.trim() || !signature}>
        {isPending ? 'กำลังบันทึก…' : 'ยืนยันลายเซ็นต์'}
      </Button>
    </div>
  )
}
