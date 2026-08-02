# Shared department dropdown design

## Goal

Replace free-text department inputs on purchase request, goods receipt, and
requisition forms with one shared, required department dropdown.

## Source of truth

Move the existing 11-item `CONTRACT_DEPARTMENTS` list to a neutral shared
module. The contracts schema will import the list from that module, so
contracts and all three operational forms use exactly the same values.

The default selection will be `สำนักงานกลุ่มงานเทคนิคการแพทย์`, the first
value in the standard list.

## Form behavior

Each form renders a native `select` control with the shared values:

- Purchase request: `หน่วยงานผู้ขอ`
- Goods receipt: `หน่วยงานที่รับของ`
- Requisition: `หน่วยงานผู้ขอเบิก`

The selected value is stored and submitted through the existing `department`
field. No database schema or historical records change.

## Validation and testing

The existing non-empty server validation remains in place. Tests will verify
that the shared list is used by the contracts schema and all three forms, and
the existing PR end-to-end test will select a department rather than type one.
