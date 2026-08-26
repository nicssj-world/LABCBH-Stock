export interface ServicePlanResponsibleCandidate {
  id: string
  name: string
  ephisId: string | null
  positionTitle: string | null
}

export const SERVICE_PLAN_RESPONSIBLE_RESULT_LIMIT = 8

export function filterServicePlanCandidates(
  candidates: readonly ServicePlanResponsibleCandidate[],
  query: string,
  limit = SERVICE_PLAN_RESPONSIBLE_RESULT_LIMIT,
) {
  const needle = query.trim().toLocaleLowerCase('th')
  const matches = needle
    ? candidates.filter((candidate) => {
        const searchable = [candidate.name, candidate.ephisId ?? '']
          .join(' ')
          .toLocaleLowerCase('th')
        return searchable.includes(needle)
      })
    : candidates

  return matches.slice(0, limit)
}

export function toggleServicePlanCandidate(ids: readonly string[], id: string) {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
}
