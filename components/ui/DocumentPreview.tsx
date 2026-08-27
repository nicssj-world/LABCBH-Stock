'use client'

import { PdfDocumentViewer } from '@/components/ui/PdfDocumentViewer'

export interface DocumentPreviewProps {
  src: string
  title: string
  fileName?: string | null
  mimeType?: string | null
  className?: string
}

function isImageFile({ src, fileName, mimeType }: Pick<DocumentPreviewProps, 'src' | 'fileName' | 'mimeType'>) {
  if (mimeType?.toLowerCase().startsWith('image/')) return true
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(`${fileName ?? ''} ${src}`)
}

export function DocumentPreview({ src, title, fileName, mimeType, className }: DocumentPreviewProps) {
  if (isImageFile({ src, fileName, mimeType })) {
    return (
      <div className={`document-preview document-preview--image${className ? ` ${className}` : ''}`}>
        {/* Private file routes need the browser's native image decoder and auth cookies. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} />
      </div>
    )
  }

  return <PdfDocumentViewer src={src} title={title} className={className} />
}
