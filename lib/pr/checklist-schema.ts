import { z } from 'zod'
import { PR_ATTACHMENT_KINDS, PR_COMMITTEE_KINDS, PR_MAX_ATTACHMENT_SIZE_BYTES } from './checklist'
import { PURCHASE_METHODS } from './schema'

export const purchaseRequestAttachmentKindSchema = z.enum(PR_ATTACHMENT_KINDS)
export const purchaseRequestCommitteeKindSchema = z.enum(PR_COMMITTEE_KINDS)

export const purchaseRequestCommitteeAssignmentSchema = z
  .object({
    kind: purchaseRequestCommitteeKindSchema,
    seat: z.number().int().min(1).max(3),
    profileId: z.string().uuid(),
  })
  .strict()

const checklistSlotSchema = z.object({
  kind: purchaseRequestAttachmentKindSchema,
  slot: z.number().int().min(1).max(3),
})

export const purchaseRequestChecklistAttachmentReferenceSchema = z.union([
  checklistSlotSchema.extend({ attachmentId: z.string().uuid() }).strict(),
  checklistSlotSchema.extend({ uploadId: z.string().uuid() }).strict(),
])

export const purchaseRequestChecklistSubmissionSchema = z
  .object({
    uploadSessionId: z.string().uuid(),
    attachments: z.array(purchaseRequestChecklistAttachmentReferenceSchema).max(5),
    committees: z.array(purchaseRequestCommitteeAssignmentSchema).max(9),
  })
  .strict()

export type PurchaseRequestChecklistSubmission = z.infer<typeof purchaseRequestChecklistSubmissionSchema>
export type PurchaseRequestChecklistAttachmentReference = z.infer<
  typeof purchaseRequestChecklistAttachmentReferenceSchema
>

export const purchaseRequestChecklistPresignSchema = z
  .object({
    uploadSessionId: z.string().uuid(),
    method: z.enum(PURCHASE_METHODS),
    total: z.number().finite().nonnegative().nullable(),
    kind: purchaseRequestAttachmentKindSchema,
    slot: z.number().int().min(1).max(3),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().min(1).max(PR_MAX_ATTACHMENT_SIZE_BYTES),
  })
  .strict()
