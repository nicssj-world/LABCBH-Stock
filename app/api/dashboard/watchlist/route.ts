import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth/actor'
import { getDashboardWatchlistPage } from '@/lib/dashboard/contracts'

function parseInteger(value: string | null, fallback: number): number | null {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  const parsed = parseInteger(value, fallback)
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null
}

export async function GET(request: Request) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    if (actor.appRoles.length === 0) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูรายการติดตาม' }, { status: 403 })
    }

    const url = new URL(request.url)
    const offset = parseInteger(url.searchParams.get('offset'), 5)
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 10, 1, 10)
    if (offset === null || limit === null) {
      return NextResponse.json({ error: 'พารามิเตอร์รายการไม่ถูกต้อง' }, { status: 422 })
    }

    const page = await getDashboardWatchlistPage({ offset, limit })
    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'อ่านรายการติดตามไม่สำเร็จ' }, { status: 500 })
  }
}
