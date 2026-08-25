'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { CommitteeMemberCombobox } from '@/components/pr/PurchaseRequestChecklistFields'
import { setContractCommittees } from '@/lib/contracts/actions'
import { formatProfileName } from '@/lib/profiles/name'
import type { ContractCommitteeMember } from '@/lib/contracts/committee-queries'
import type { ContractType } from '@/lib/contracts/types'
import {
  PR_COMMITTEE_KIND_LABELS,
  type CommitteeAssignmentInput,
  type PurchaseRequestCommitteeKind,
} from '@/lib/pr/checklist'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'

interface ContractCommitteeRosterProps {
  contractId: number
  contractType: ContractType | null
  members: ContractCommitteeMember[]
  candidates: PurchaseRequestCommitteeCandidate[]
  canEdit: boolean
}

export function ContractCommitteeRoster({
  contractId,
  contractType,
  members,
  candidates,
  canEdit,
}: ContractCommitteeRosterProps) {
  const router = useRouter()
  const kinds: PurchaseRequestCommitteeKind[] = contractType === 'e_bidding' || contractType === 'equipment_lease'
    ? ['specification', 'result', 'inspection']
    : ['specification', 'inspection']
  const [assignments, setAssignments] = useState<CommitteeAssignmentInput[]>(() =>
    members.map((member) => ({ kind: member.kind, seat: member.seat, profileId: member.profileId })),
  )
  const [editing, setEditing] = useState(members.length === 0 && canEdit)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const expectedCount = kinds.length * 3
  const complete = assignments.filter((assignment) => kinds.includes(assignment.kind)).length === expectedCount

  const selectedFor = (kind: PurchaseRequestCommitteeKind, seat: number) =>
    assignments.find((assignment) => assignment.kind === kind && assignment.seat === seat)?.profileId ?? null
  const setSelected = (kind: PurchaseRequestCommitteeKind, seat: number, profileId: string | null) => {
    const retained = assignments.filter((assignment) => !(assignment.kind === kind && assignment.seat === seat))
    setAssignments(profileId ? [...retained, { kind, seat, profileId }] : retained)
  }
  const disabledFor = (kind: PurchaseRequestCommitteeKind, seat: number) => {
    const ids = new Set<string>()
    for (const assignment of assignments) {
      if (assignment.kind === kind && assignment.seat !== seat) ids.add(assignment.profileId)
      if (kind === 'inspection' && assignment.kind === 'result') ids.add(assignment.profileId)
      if (kind === 'result' && assignment.kind === 'inspection') ids.add(assignment.profileId)
    }
    return ids
  }
  const membersFor = (kind: PurchaseRequestCommitteeKind) =>
    members.filter((member) => member.kind === kind).sort((a, b) => a.seat - b.seat)

  return (
    <section className="bench-panel contract-committee-roster" aria-labelledby="contract-committee-title">
      <div className="bench-panel__header">
        <div>
          <p id="contract-committee-title" className="section-kicker">COMMITTEE ROSTER</p>
        </div>
        <span className={members.length === expectedCount ? 'pr-checklist__status is-complete' : 'pr-checklist__status'}>
          {members.length === expectedCount ? 'ครบแล้ว' : 'ยังไม่ครบ'}
        </span>
      </div>

      {!editing ? (
        <div className="pr-checklist-detail__committees">
          {kinds.map((kind) => {
            const kindMembers = membersFor(kind)
            return (
              <section key={kind}>
                <h3>{PR_COMMITTEE_KIND_LABELS[kind]}</h3>
                <ol>
                  {kindMembers.length > 0 ? kindMembers.map((member) => (
                    <li key={member.id}><span>{formatProfileName(member.name, member.namePrefix)}</span><small>{member.positionTitle ?? 'ยังไม่ระบุตำแหน่ง'}</small></li>
                  )) : <li className="contract-committee-roster__empty">ยังไม่ได้กำหนดกรรมการ</li>}
                </ol>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="pr-checklist__committees">
          {kinds.map((kind) => (
            <fieldset key={kind}>
              <legend>{PR_COMMITTEE_KIND_LABELS[kind]} · 3 คน</legend>
              <div className="pr-checklist__committee-grid">
                {[1, 2, 3].map((seat) => (
                  <CommitteeMemberCombobox
                    key={seat}
                    kind={kind}
                    seat={seat}
                    candidates={candidates}
                    selectedProfileId={selectedFor(kind, seat)}
                    disabledProfileIds={disabledFor(kind, seat)}
                    disabled={isPending}
                    onSelect={(profileId) => setSelected(kind, seat, profileId)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {canEdit && (
        <div className="form-action-bar__buttons">
          {editing ? (
            <>
              {members.length > 0 && <Button variant="secondary" type="button" disabled={isPending} onClick={() => setEditing(false)}>ยกเลิก</Button>}
              <Button
                type="button"
                disabled={isPending || !complete}
                onClick={() => startTransition(async () => {
                  setError(null)
                  try {
                    await setContractCommittees(contractId, assignments.filter((assignment) => kinds.includes(assignment.kind)))
                    setEditing(false)
                    router.refresh()
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : 'บันทึก roster ไม่สำเร็จ')
                  }
                })}
              >
                {isPending ? 'กำลังบันทึก…' : 'บันทึกรายชื่อกรรมการ'}
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>แก้ไขรายชื่อกรรมการ</Button>
          )}
        </div>
      )}
    </section>
  )
}
