'use client'

import { EditIcon } from '@/components/inventory/InventoryDetailIcons'
import { Button } from '@/components/ui/Button'
import { InventoryItemForm } from '@/components/inventory/InventoryItemForm'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import type { InventoryItemRecord } from '@/lib/inventory/types'

interface InventoryItemEditDialogProps {
  item: InventoryItemRecord
  departments: readonly string[]
  trigger?: 'icon' | 'button'
}

export function InventoryItemEditDialog({ item, departments, trigger = 'icon' }: InventoryItemEditDialogProps) {
  // The catalogue renders one of these per item, in both the table and the
  // card layout, so the form below is built only once someone opens it.
  const { dialogRef, isRendered, open, close } = useDeferredDialog()

  return (
    <>
      {trigger === 'button' ? (
        <Button variant="secondary" onClick={open} aria-haspopup="dialog">
          แก้ไขข้อมูล
        </Button>
      ) : (
        <button
          type="button"
          className="inventory-action-icon"
          onClick={open}
          aria-label={`แก้ไขข้อมูล ${item.name}`}
          title="แก้ไขข้อมูลน้ำยา"
        >
          <EditIcon />
        </button>
      )}

      {isRendered && (
        <dialog
          ref={dialogRef}
          className="app-dialog inventory-edit-dialog"
          onCancel={close}
          aria-labelledby={`inventory-edit-dialog-title-${item.id}`}
        >
          <div className="app-dialog__header">
            <div>
              <p className="section-kicker">EDIT INVENTORY ITEM</p>
              <h2 id={`inventory-edit-dialog-title-${item.id}`}>แก้ไขรายการน้ำยา</h2>
              <p>{item.name}</p>
            </div>
            <button type="button" className="app-dialog__close" onClick={close} aria-label="ปิดหน้าต่างแก้ไข">
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <div className="app-dialog__body inventory-edit-dialog__body">
            <InventoryItemForm
              mode="edit"
              item={item}
              departments={departments}
              titleId={`inventory-edit-form-title-${item.id}`}
              showSectionHeading={false}
              onSaved={close}
              onCancel={close}
            />
          </div>
        </dialog>
      )}
    </>
  )
}
