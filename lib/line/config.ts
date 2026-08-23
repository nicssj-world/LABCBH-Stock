import 'server-only'

import { z } from 'zod'

const lineConfigSchema = z.object({
  accessToken: z.string().trim().min(1),
  groupId: z.string().trim().min(1),
  appBaseUrl: z.string().trim().url().refine((value) => value.startsWith('https://'), 'APP_BASE_URL must use HTTPS'),
})

export interface LineNotificationConfig {
  accessToken: string
  groupId: string
  appBaseUrl: string
}

export function getLineNotificationConfig(): LineNotificationConfig | null {
  const parsed = lineConfigSchema.safeParse({
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    groupId: process.env.LINE_GROUP_ID,
    appBaseUrl: process.env.APP_BASE_URL,
  })

  if (!parsed.success) return null

  return {
    accessToken: parsed.data.accessToken,
    groupId: parsed.data.groupId,
    appBaseUrl: parsed.data.appBaseUrl.replace(/\/+$/, ''),
  }
}

export function requireLineNotificationConfig(): LineNotificationConfig {
  const config = getLineNotificationConfig()
  if (!config) {
    throw new Error('ระบบยังไม่ได้ตั้งค่า LINE OA กรุณาติดต่อผู้ดูแลระบบ')
  }
  return config
}
