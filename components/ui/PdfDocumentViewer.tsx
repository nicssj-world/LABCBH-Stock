'use client'

import { useEffect, useRef, useState } from 'react'

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocumentLoadingTask = ReturnType<PdfJsModule['getDocument']>
type PdfDocumentProxy = Awaited<PdfDocumentLoadingTask['promise']>
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>
type PdfRenderTask = ReturnType<PdfPageProxy['render']>

let pdfJsModulePromise: Promise<PdfJsModule> | null = null

function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        return pdfjs
      })
      .catch((error) => {
        pdfJsModulePromise = null
        throw error
      })
  }
  return pdfJsModulePromise
}

function previewErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.toLowerCase().includes('password')) {
    return 'เอกสารนี้มีรหัสผ่าน จึงยังไม่สามารถแสดงใน popup ได้'
  }
  return 'ไม่สามารถแสดงเอกสารใน popup ได้ กรุณาลองใหม่อีกครั้ง'
}

export interface PdfDocumentViewerProps {
  src: string
  title: string
  className?: string
}

export function PdfDocumentViewer({ src, title, className }: PdfDocumentViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [status, setStatus] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const measure = () => {
      if (element.clientWidth > 0) setViewportWidth(element.clientWidth)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadingTask: PdfDocumentLoadingTask | null = null
    let loadedDocument: PdfDocumentProxy | null = null

    void loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return null
        setPdfDocument(null)
        setPageCount(0)
        setStatus('loading')
        setError(null)
        loadingTask = pdfjs.getDocument({ url: src })
        return loadingTask.promise
      })
      .then((document) => {
        if (!document) return
        loadedDocument = document
        if (cancelled) {
          void document.destroy()
          return
        }
        setPdfDocument(document)
        setPageCount(document.numPages)
        setStatus('rendering')
      })
      .catch((caught) => {
        if (cancelled) return
        setError(previewErrorMessage(caught))
        setStatus('error')
      })

    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy()
      if (loadedDocument) void loadedDocument.destroy()
    }
  }, [src, retryKey])

  useEffect(() => {
    if (!pdfDocument || pageCount === 0 || viewportWidth === 0) return

    let cancelled = false
    const renderTasks: PdfRenderTask[] = []

    const renderPages = async () => {
      setStatus('rendering')
      const targetWidth = Math.min(Math.max(viewportWidth - 32, 220), 960)

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (cancelled) return
        const canvas = canvasRefs.current.get(pageNumber)
        if (!canvas) continue

        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) {
          page.cleanup()
          return
        }

        const baseViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: targetWidth / baseViewport.width })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Canvas context is unavailable')

        canvas.width = Math.ceil(viewport.width * outputScale)
        canvas.height = Math.ceil(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        context.save()
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.restore()

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderTasks.push(renderTask)
        await renderTask.promise
        page.cleanup()
      }

      if (!cancelled) setStatus('ready')
    }

    void renderPages().catch((caught) => {
      if (cancelled) return
      setError(previewErrorMessage(caught))
      setStatus('error')
    })

    return () => {
      cancelled = true
      renderTasks.forEach((task) => task.cancel())
    }
  }, [pdfDocument, pageCount, viewportWidth])

  const setCanvasRef = (pageNumber: number) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) canvasRefs.current.set(pageNumber, canvas)
    else canvasRefs.current.delete(pageNumber)
  }

  const isBusy = status === 'loading' || status === 'rendering'
  const statusLabel = status === 'loading'
    ? 'กำลังโหลดเอกสาร…'
    : status === 'rendering'
      ? 'กำลังจัดหน้าเอกสาร…'
      : status === 'ready'
        ? `เอกสาร ${pageCount} หน้า พร้อมเลื่อนดู`
        : 'เกิดข้อผิดพลาดในการแสดงเอกสาร'

  return (
    <section
      className={`pdf-document-viewer${className ? ` ${className}` : ''}`}
      aria-busy={isBusy}
      aria-label={title}
    >
      <div className="pdf-document-viewer__statusbar" role="status" aria-live="polite">
        <span>{statusLabel}</span>
        {pageCount > 0 && status !== 'error' && (
          <span className="pdf-document-viewer__page-count">{pageCount} หน้า</span>
        )}
      </div>

      {status === 'error' ? (
        <div className="pdf-document-viewer__error" role="alert">
          <p>{error ?? 'ไม่สามารถแสดงเอกสารใน popup ได้'}</p>
          <div className="pdf-document-viewer__error-actions">
            <button type="button" className="lab-button lab-button--secondary" onClick={() => setRetryKey((value) => value + 1)}>
              ลองใหม่
            </button>
            <a className="lab-link-button lab-link-button--secondary" href={src} target="_blank" rel="noreferrer">
              เปิดเอกสารในแท็บใหม่
            </a>
          </div>
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="pdf-document-viewer__viewport"
          tabIndex={0}
          role="region"
          aria-label={`พื้นที่เลื่อนดู ${title}`}
        >
          {status === 'loading' && (
            <div className="pdf-document-viewer__loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          <div className="pdf-document-viewer__pages">
            {Array.from({ length: pageCount }, (_, index) => {
              const pageNumber = index + 1
              return (
                <figure className="pdf-document-viewer__page" key={pageNumber}>
                  <canvas
                    ref={setCanvasRef(pageNumber)}
                    role="img"
                    aria-label={`หน้า ${pageNumber} จาก ${pageCount} ของ ${title}`}
                  />
                  <figcaption className="visually-hidden">หน้า {pageNumber} จาก {pageCount}</figcaption>
                </figure>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
