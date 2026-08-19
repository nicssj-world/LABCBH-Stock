import Link from 'next/link'
import type { ComponentProps } from 'react'
import { ViewIcon } from '@/components/inventory/InventoryDetailIcons'

type DetailIconLinkProps = Omit<ComponentProps<typeof Link>, 'aria-label' | 'children' | 'className' | 'title'> & {
  label: string
  title?: string
  className?: string
}

export function DetailIconLink({ href, label, title = label, className = '', ...props }: DetailIconLinkProps) {
  return (
    <Link
      {...props}
      href={href}
      className={`detail-action-icon ${className}`.trim()}
      aria-label={label}
      title={title}
    >
      <ViewIcon />
    </Link>
  )
}
