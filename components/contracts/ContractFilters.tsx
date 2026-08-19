'use client'

import { FormEvent, useCallback, useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface ContractFiltersProps {
  search: string
  fiscalYear: string
  contractType: string
  department: string
  procurementStage: string
  showEnded: boolean
  showOlder: boolean
  showWatchlist: boolean
  fiscalYears: number[]
  contractTypes: Array<{ value: string; label: string }>
  departments: string[]
  procurementStages: Array<{ value: string; label: string }>
}

export function ContractFilters({
  search: initialSearch,
  fiscalYear,
  contractType,
  department,
  procurementStage,
  showEnded,
  showOlder,
  showWatchlist,
  fiscalYears,
  contractTypes,
  departments,
  procurementStages,
}: ContractFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(initialSearch)
  const [isPending, startTransition] = useTransition()

  const replaceFilters = useCallback((nextParams: URLSearchParams) => {
    const query = nextParams.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }, [pathname, router, startTransition])

  const setFilter = useCallback((name: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('page')
    if (value.trim()) nextParams.set(name, value)
    else nextParams.delete(name)
    replaceFilters(nextParams)
  }, [replaceFilters, searchParams])

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilter(event.target.name, event.target.value)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilter('search', search)
  }

  const clearFilters = () => {
    setSearch('')
    const nextParams = new URLSearchParams()
    if (showEnded) nextParams.set('showEnded', '1')
    if (showOlder) nextParams.set('showOlder', '1')
    if (showWatchlist) nextParams.set('watchlist', '1')
    replaceFilters(nextParams)
  }

  useEffect(() => {
    if (search === initialSearch) return
    const timer = window.setTimeout(() => setFilter('search', search), 350)
    return () => window.clearTimeout(timer)
  }, [initialSearch, search, setFilter])

  return (
    <form className="filter-bench contract-filters" onSubmit={handleSubmit} aria-label="ตัวกรองรายการสัญญา">
      <label className="filter-bench__search">
        ค้นหาสัญญา
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ชื่อสัญญา คู่สัญญา หรือเลขที่"
        />
      </label>
      <label>
        ปีงบประมาณ
        <select name="fiscalYear" value={fiscalYear} onChange={handleSelectChange}>
          <option value="">ทุกปีงบประมาณ</option>
          {fiscalYears.map((year) => <option value={year} key={year}>{year}</option>)}
        </select>
      </label>
      <label>
        ประเภท
        <select name="contractType" value={contractType} onChange={handleSelectChange}>
          <option value="">ทุกประเภท</option>
          {contractTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
        </select>
      </label>
      <label>
        หน่วยงาน
        <select name="department" value={department} onChange={handleSelectChange}>
          <option value="">ทุกหน่วยงาน</option>
          {departments.map((dept) => <option value={dept} key={dept}>{dept}</option>)}
        </select>
      </label>
      <label>
        ขั้นตอน
        <select name="stage" value={procurementStage} onChange={handleSelectChange}>
          <option value="">ทุกขั้นตอน</option>
          {procurementStages.map((stage) => <option value={stage.value} key={stage.value}>{stage.label}</option>)}
        </select>
      </label>
      <button className="lab-button lab-button--secondary contract-filters__clear" type="button" onClick={clearFilters}>
        ล้างตัวกรอง
      </button>
      <p className="contract-filters__status" aria-live="polite">{isPending ? 'กำลังกรองรายการ…' : 'เลือกตัวกรองเพื่อแสดงผลทันที'}</p>
    </form>
  )
}
