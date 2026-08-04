import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/actor'
import { storeContractFile } from '@/lib/contracts/file-actions'

export const dynamic = 'force-dynamic'

/**
 * A route handler, not the `uploadContractFile` Server Action, because only
 * XMLHttpRequest exposes upload progress events — Server Actions give the
 * client no hook into the request as it streams.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params
  const contractId = Number(id)
  if (!Number.isInteger(contractId) || contractId <= 0) {
    return NextResponse.json({ error: 'สัญญาไม่ถูกต้อง' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'กรุณาเลือกไฟล์สัญญา' }, { status: 400 })
  }

  try {
    const { path } = await storeContractFile(actor.id, contractId, file)
    revalidatePath(`/contracts/${contractId}`)
    return NextResponse.json({ path })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'อัปโหลดไฟล์สัญญาไม่สำเร็จ'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
