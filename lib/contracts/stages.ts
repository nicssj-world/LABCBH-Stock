export const PROCUREMENT_STAGES = [
  'sent_to_procurement',
  'plan_published',
  'tender_announced',
  'result_consideration',
  'winner_announced',
  'contract_started',
] as const

export type ProcurementStage = (typeof PROCUREMENT_STAGES)[number]

export function allowedNextStages(stage: ProcurementStage): ProcurementStage[] {
  const index = PROCUREMENT_STAGES.indexOf(stage)
  const next = PROCUREMENT_STAGES[index + 1]
  return next ? [next] : []
}

export function requiresContractNumber(stage: ProcurementStage): boolean {
  return stage === 'contract_started'
}
