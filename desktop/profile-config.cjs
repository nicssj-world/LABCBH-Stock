const path = require('node:path')

const PROFILE_DEFINITIONS = Object.freeze([
  {
    id: 'stock',
    label: 'LABCBH Stock',
    shortLabel: 'Stock',
    description: 'ระบบคลัง สัญญา การรับเข้า และการเบิกจ่าย',
    defaultSupabaseUrl: 'https://fslagsuorkcckvvtrmyi.supabase.co',
    defaultProjectRef: 'fslagsuorkcckvvtrmyi',
    sharedDatabaseKey: 'labcbh-production',
    sharedDatabaseLabel: 'ฐานข้อมูล Production ร่วมกับ Portal',
    folderName: 'LABCBH Production (Stock + Portal)',
  },
  {
    id: 'portal',
    label: 'LabManagement Portal',
    shortLabel: 'Portal',
    description: 'ระบบบริหารงานห้องปฏิบัติการและข้อมูลกลาง',
    defaultSupabaseUrl: 'https://fslagsuorkcckvvtrmyi.supabase.co',
    defaultProjectRef: 'fslagsuorkcckvvtrmyi',
    sharedDatabaseKey: 'labcbh-production',
    sharedDatabaseLabel: 'ฐานข้อมูล Production ร่วมกับ Stock',
    folderName: 'LABCBH Production (Stock + Portal)',
  },
])

const PROFILE_IDS = new Set(PROFILE_DEFINITIONS.map((profile) => profile.id))

function normalizeProfileId(value, fallback = 'stock') {
  const id = String(value || fallback).trim().toLowerCase()
  if (!PROFILE_IDS.has(id)) throw new Error(`ไม่พบโปรไฟล์ backup: ${id}`)
  return id
}

function profileDefinition(value) {
  const id = normalizeProfileId(value)
  return PROFILE_DEFINITIONS.find((profile) => profile.id === id)
}

function defaultProfile(value, baseBackupRoot) {
  const definition = profileDefinition(value)
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
    supabaseUrl: definition.defaultSupabaseUrl,
    expectedProjectRef: definition.defaultProjectRef,
    sharedDatabaseKey: definition.sharedDatabaseKey,
    sharedDatabaseLabel: definition.sharedDatabaseLabel,
    backupRoot: path.join(baseBackupRoot, definition.folderName),
    pgDumpPath: '',
    schedule: { enabled: false, day: 1, time: '02:00' },
    serviceRoleKey: '',
    databaseUrl: '',
    encryptedServiceRoleKey: null,
    encryptedDatabaseUrl: null,
  }
}

function isConfigured(profile) {
  return Boolean(profile?.supabaseUrl && profile?.serviceRoleKey && profile?.databaseUrl)
}

module.exports = {
  PROFILE_DEFINITIONS,
  defaultProfile,
  isConfigured,
  normalizeProfileId,
  profileDefinition,
}
