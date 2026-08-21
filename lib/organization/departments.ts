export const MEDICAL_TECHNICAL_OFFICE = 'สำนักงานกลุ่มงานเทคนิคการแพทย์'
export const REAGENT_WAREHOUSE = 'คลังน้ำยาและวัสดุวิทยาศาสตร์'

export const DEPARTMENTS = [
  MEDICAL_TECHNICAL_OFFICE,
  'งานเคมีคลินิก',
  'งานโลหิตวิทยาคลินิก',
  'งานภูมิคุ้มกันวิทยาคลินิก',
  'งานจุลทรรศนศาสตร์คลินิก',
  'งานอณูชีววิทยา',
  'งานจุลชีววิทยา',
  'งานคลังเลือด',
  'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
  'งานบริการผู้ป่วยนอก',
  'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
  REAGENT_WAREHOUSE,
  'POCT',
] as const

/**
 * Requisition pickers include the requester's own work unit plus the office
 * and the reagent warehouse, which are shared operational catalogues.
 */
export function getRequisitionItemDepartments(requesterDepartment: string | null | undefined): string[] {
  const departments = [
    requesterDepartment?.trim(),
    MEDICAL_TECHNICAL_OFFICE,
    REAGENT_WAREHOUSE,
  ].filter((department): department is string => Boolean(department))

  return [...new Set(departments)]
}
