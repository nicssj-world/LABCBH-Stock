import Link from 'next/link'
import type { ComponentProps } from 'react'
import { DocumentOpenIcon } from '@/components/ui/DocumentOpenIcon'
import { ViewIcon } from '@/components/inventory/InventoryDetailIcons'

type DetailIconLinkProps = Omit<ComponentProps<typeof Link>, 'aria-label' | 'children' | 'className' | 'title'> & {
  label: string
  title?: string
  icon?: 'document' | 'view'
  className?: string
}

export function DetailIconLink({ href, label, title = label, icon = 'document', className = '', ...props }: DetailIconLinkProps) {
  return (
    <Link
      {...props}
      href={href}
      className={`detail-action-icon ${className}`.trim()}
      aria-label={label}
      title={title}
    >
      {icon === 'document' ? <DocumentOpenIcon /> : <ViewIcon />}
    </Link>
  )
}
