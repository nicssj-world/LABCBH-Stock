import {
  isPoFileTypeAllowed,
  PO_MAX_FILE_SIZE_BYTES,
} from './storage'

/** Large scans are reduced before they leave the browser; PDFs stay unchanged. */
export const PO_MAX_IMAGE_DIMENSION = 2200
export const PO_IMAGE_JPEG_QUALITY = 0.82

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('อ่านไฟล์ภาพ PO ไม่สำเร็จ'))
    }
    image.src = objectUrl
  })
}

/**
 * Validates the same file contract as the storage bucket and compresses image
 * files to a bounded JPEG. The original PDF is returned untouched.
 */
export async function preparePoFile(file: File): Promise<File> {
  if (!isPoFileTypeAllowed(file.type)) {
    throw new Error('ไฟล์ PO ต้องเป็น JPG, PNG, WEBP หรือ PDF')
  }
  if (file.size === 0) throw new Error('ไฟล์ PO ว่างเปล่า')
  if (file.size > PO_MAX_FILE_SIZE_BYTES) {
    throw new Error('ไฟล์ PO ต้องมีขนาดไม่เกิน 10 MB')
  }
  if (file.type === 'application/pdf') return file

  const image = await loadImage(file)
  const largestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const scale = largestSide > PO_MAX_IMAGE_DIMENSION ? PO_MAX_IMAGE_DIMENSION / largestSide : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('เตรียมไฟล์ภาพ PO ไม่สำเร็จ')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('บีบอัดไฟล์ภาพ PO ไม่สำเร็จ'))),
      'image/jpeg',
      PO_IMAGE_JPEG_QUALITY,
    )
  })

  const baseName = file.name.replace(/\.[^/.]+$/, '').trim() || 'po'
  return new File([blob], `${baseName}.jpg`, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

export function formatPoFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
