import Link from 'next/link'
import type { ComponentProps } from 'react'
import { OpenDetailIcon, ViewIcon } from '@/components/inventory/InventoryDetailIcons'

type DetailIconLinkProps = Omit<ComponentProps<typeof Link>, 'aria-label' | 'children' | 'className' | 'title'> & {
  label: string
  title?: string
  icon?: 'view' | 'open'
  className?: string
}

export function DetailIconLink({ href, label, title = label, icon = 'open', className = '', ...props }: DetailIconLinkProps) {
  return (
    <Link
      {...props}
      href={href}
      className={`detail-action-icon ${className}`.trim()}
      aria-label={label}
      title={title}
    >
      {icon === 'open' ? <OpenDetailIcon /> : <ViewIcon />}
    </Link>
  )
}
