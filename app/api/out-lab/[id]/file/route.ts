import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { OutLabAuthorizationError } from '@/lib/out-lab/authorization'
import { storeOutLabFile } from '@/lib/out-lab/file-actions'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A route handler, not a Server Action, because only XMLHttpRequest exposes
 * upload progress events — Server Actions give the client no hook into the
 * request as it streams.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'สัญญาไม่ถูกต้อง' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'กรุณาเลือกไฟล์สัญญา' }, { status: 400 })
  }

  try {
    const { path } = await storeOutLabFile(id, file)
    revalidatePath(`/out-lab/${id}`)
    return NextResponse.json({ path })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'อัปโหลดไฟล์สัญญาไม่สำเร็จ'
    const status = caught instanceof OutLabAuthorizationError ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
