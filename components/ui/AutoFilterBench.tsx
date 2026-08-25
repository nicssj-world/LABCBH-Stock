'use client'

import { useCallback, useEffect, useState, useTransition, type ChangeEvent, type FormEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useNavigationProgress } from '@/components/ui/RouteProgress'

export interface AutoFilterOption {
  value: string
  label: string
}

export type AutoFilterField =
  | {
      type: 'search'
      name: string
      label: string
      value?: string
      placeholder?: string
    }
  | {
      type: 'select'
      name: string
      label: string
      value?: string
      options: readonly AutoFilterOption[]
    }
  | {
      type: 'checkbox'
      name: string
      label: string
      checked?: boolean
      value?: string
    }

interface AutoFilterBenchProps {
  fields: readonly AutoFilterField[]
  ariaLabel: string
  className?: string
  showClear?: boolean
}

export function AutoFilterBench({ fields, ariaLabel, className = '', showClear = true }: AutoFilterBenchProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchField = fields.find((field): field is Extract<AutoFilterField, { type: 'search' }> => field.type === 'search')
  const initialSearch = searchField?.value ?? ''
  const currentSearch = searchField ? searchParams.get(searchField.name) ?? '' : ''
  const [search, setSearch] = useState(initialSearch)
  const [isPending, startTransition] = useTransition()
  const startNavigationProgress = useNavigationProgress()

  const replaceFilters = useCallback((nextParams: URLSearchParams) => {
    const query = nextParams.toString()
    // The results are re-read on the server, so this is a real wait even
    // though the page never changes. The status text alone left the stale
    // table looking like the answer.
    startNavigationProgress()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }, [pathname, router, startNavigationProgress])

  const setFilter = useCallback((name: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('page')
    if (value.trim()) nextParams.set(name, value)
    else nextParams.delete(name)
    replaceFilters(nextParams)
  }, [replaceFilters, searchParams])

  useEffect(() => {
    if (!searchField || search === currentSearch) return
    const timer = window.setTimeout(() => setFilter(searchField.name, search), 350)
    return () => window.clearTimeout(timer)
  }, [currentSearch, search, searchField, setFilter])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searchField) setFilter(searchField.name, search)
  }

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFilter(event.target.name, event.target.value)
  }

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>, value: string) => {
    setFilter(event.target.name, event.target.checked ? value : '')
  }

  const clearFilters = () => {
    setSearch('')
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('page')
    fields.forEach((field) => nextParams.delete(field.name))
    replaceFilters(nextParams)
  }

  return (
    <form className={`filter-bench ${className}`.trim()} onSubmit={handleSubmit} aria-label={ariaLabel}>
      {fields.map((field) => {
        if (field.type === 'search') {
          return (
            <label className="filter-bench__search" key={field.name}>
              {field.label}
              <input
                type="search"
                name={field.name}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={field.placeholder}
              />
            </label>
          )
        }

        if (field.type === 'select') {
          return (
            <label key={field.name}>
              {field.label}
              <select name={field.name} value={searchParams.get(field.name) ?? field.value ?? ''} onChange={handleSelectChange}>
                {field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
          )
        }

        const checked = searchParams.has(field.name)
          ? searchParams.get(field.name) === (field.value ?? '1')
          : Boolean(field.checked)
        return (
          <label className="field-toggle" key={field.name}>
            <input
              type="checkbox"
              name={field.name}
              value={field.value ?? '1'}
              checked={checked}
              onChange={(event) => handleCheckboxChange(event, field.value ?? '1')}
            />
            {field.label}
          </label>
        )
      })}
      {showClear && (
        <button className="lab-button lab-button--secondary filter-bench__clear" type="button" onClick={clearFilters}>
          ล้างตัวกรอง
        </button>
      )}
      <p className="filter-bench__status" aria-live="polite">{isPending ? 'กำลังกรองรายการ…' : 'ตัวกรองอัปเดตอัตโนมัติ'}</p>
    </form>
  )
}
