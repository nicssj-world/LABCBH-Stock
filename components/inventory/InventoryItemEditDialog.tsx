'use client'

import { useRef } from 'react'
import { EditIcon } from '@/components/inventory/InventoryDetailIcons'
import { InventoryItemForm } from '@/components/inventory/InventoryItemForm'
import type { InventoryItemRecord } from '@/lib/inventory/types'

interface InventoryItemEditDialogProps {
  item: InventoryItemRecord
  departments: readonly string[]
}

export function InventoryItemEditDialog({ item, departments }: InventoryItemEditDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const open = () => dialogRef.current?.showModal()
  const close = () => dialogRef.current?.close()

  return (
    <>
      <button
        type="button"
        className="inventory-action-icon"
        onClick={open}
        aria-label={`แก้ไขข้อมูล ${item.name}`}
        title="แก้ไขข้อมูลน้ำยา"
      >
        <EditIcon />
      </button>

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
    </>
  )
}
