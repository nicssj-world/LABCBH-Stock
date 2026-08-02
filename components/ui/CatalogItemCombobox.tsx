'use client'

import { useId, useMemo, useState, type KeyboardEvent } from 'react'

export interface CatalogItemComboboxOption {
  id: string
  label: string
  hint: string
  searchText?: string
}

export interface CatalogItemComboboxProps {
  label: string
  placeholder: string
  options: readonly CatalogItemComboboxOption[]
  onSelect: (id: string) => void
  instruction?: string
}

export function CatalogItemCombobox({
  label,
  placeholder,
  options,
  onSelect,
  instruction = 'พิมพ์รหัส LS หรือชื่อรายการ แล้วเลือกจากคำแนะนำ',
}: CatalogItemComboboxProps) {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const listId = `${inputId}-options`
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const matches = useMemo(() => {
    if (!normalizedQuery) return []

    return options
      .filter((option) => {
        const searchable = `${option.label} ${option.hint} ${option.searchText ?? ''}`
        return searchable.toLocaleLowerCase('th').includes(normalizedQuery)
      })
      .slice(0, 8)
  }, [normalizedQuery, options])

  const choose = (id: string) => {
    onSelect(id)
    setQuery('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && matches[0]) {
      event.preventDefault()
      choose(matches[0].id)
    }
    if (event.key === 'Escape') setQuery('')
  }

  return (
    <div className="catalog-combobox">
      <label className="field-row" htmlFor={inputId}>
        {label}
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-expanded={matches.length > 0}
          aria-describedby={hintId}
        />
      </label>
      <small className="catalog-combobox__hint" id={hintId}>{instruction}</small>

      {matches.length > 0 && (
        <div className="catalog-combobox__suggestions" id={listId} role="listbox" aria-label="คำแนะนำรายการ">
          {matches.map((option) => (
            <button type="button" role="option" aria-selected={false} key={option.id} onClick={() => choose(option.id)}>
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      )}

      {normalizedQuery && matches.length === 0 && (
        <p className="catalog-combobox__empty" role="status">
          ไม่พบรายการ ลองพิมพ์รหัส LS หรือชื่อรายการอื่น
        </p>
      )}
    </div>
  )
}
