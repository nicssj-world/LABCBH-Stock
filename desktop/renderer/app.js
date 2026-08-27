(() => {
  'use strict'

  const api = window.backupDesktop
  const state = {
    settings: null,
    status: null,
    logs: [],
    setupStep: 1,
    busy: false,
    activeProfileId: 'stock',
    setupProfileId: 'stock',
    drafts: new Map(),
  }

  const el = {
    setupView: document.getElementById('setup-view'),
    dashboardView: document.getElementById('dashboard-view'),
    setupForm: document.getElementById('setup-form'),
    setupFeedback: document.getElementById('setup-feedback'),
    dashboardFeedback: document.getElementById('dashboard-feedback'),
    headerStatus: document.getElementById('header-status'),
    headerProfile: document.getElementById('header-profile'),
    headerDot: document.querySelector('.header-meta .status-dot'),
    setupProfilePicker: document.getElementById('setup-profile-picker'),
    dashboardProfilePicker: document.getElementById('dashboard-profile-picker'),
    setupProfileCount: document.getElementById('setup-profile-count'),
    setupProfileName: document.getElementById('setup-profile-name'),
    setupProfileRef: document.getElementById('setup-profile-ref'),
    dashboardTitle: document.getElementById('dashboard-title'),
    dashboardSubtitle: document.getElementById('dashboard-subtitle'),
    next: document.getElementById('setup-next'),
    back: document.getElementById('setup-back'),
    save: document.getElementById('setup-save'),
    openSettings: document.getElementById('open-settings'),
    backupNow: document.getElementById('backup-now'),
    testConnection: document.getElementById('test-connection'),
    openFolder: document.getElementById('open-folder'),
    refresh: document.getElementById('refresh-status'),
    chooseFolder: document.getElementById('choose-folder'),
    choosePgDump: document.getElementById('choose-pg-dump'),
    setupSteps: [...document.querySelectorAll('[data-setup-step]')],
    progressSteps: [...document.querySelectorAll('[data-progress-step]')],
    supabaseUrl: document.getElementById('supabase-url'),
    serviceRoleKey: document.getElementById('service-role-key'),
    databaseUrl: document.getElementById('database-url'),
    backupRoot: document.getElementById('backup-root'),
    pgDumpPath: document.getElementById('pg-dump-path'),
    runnerId: document.getElementById('runner-id'),
    scheduleEnabled: document.getElementById('schedule-enabled'),
    scheduleFields: document.getElementById('schedule-fields'),
    scheduleDay: document.getElementById('schedule-day'),
    scheduleTime: document.getElementById('schedule-time'),
    latestSubtitle: document.getElementById('latest-subtitle'),
    latestChip: document.getElementById('latest-status-chip'),
    latestValue: document.getElementById('latest-value'),
    latestDetail: document.getElementById('latest-detail'),
    latestSize: document.getElementById('latest-size'),
    latestRunner: document.getElementById('latest-runner'),
    localCount: document.getElementById('local-count'),
    runnerSubtitle: document.getElementById('runner-subtitle'),
    runnerChip: document.getElementById('runner-status-chip'),
    pgDumpStatus: document.getElementById('pg-dump-status'),
    scheduleStatus: document.getElementById('schedule-status'),
    backupRootStatus: document.getElementById('backup-root-status'),
    historyBody: document.getElementById('history-body'),
  }

  function text(value) {
    return typeof value === 'string' ? value : ''
  }

  function profiles() {
    return Array.isArray(state.settings?.profiles) ? state.settings.profiles : []
  }

  function profileById(profileId) {
    return profiles().find((profile) => profile.id === profileId) || null
  }

  function activeProfile() {
    return profileById(state.activeProfileId) || profileById('stock') || profiles()[0] || null
  }

  function setupProfile() {
    return profileById(state.setupProfileId) || profileById('stock') || profiles()[0] || null
  }

  function errorMessage(cause) {
    return text(cause?.message) || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  }

  function formatDate(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }

  function formatBytes(bytes) {
    const value = Number(bytes)
    if (!Number.isFinite(value) || value < 0) return '—'
    if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(2)} GiB`
    if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(2)} MiB`
    if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`
    return `${value.toLocaleString('th-TH')} B`
  }

  function setBusy(button, busy, label) {
    if (!button) return
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      button.classList.add('is-loading')
      button.textContent = label || 'กำลังดำเนินการ'
    } else {
      button.disabled = false
      button.removeAttribute('aria-busy')
      button.classList.remove('is-loading')
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml
    }
  }

  function setFeedback(target, message, tone = 'info') {
    if (!target) return
    target.hidden = !message
    target.dataset.tone = tone
    target.textContent = message || ''
  }

  function setHeader(status, tone = 'neutral', profileLabel = '') {
    el.headerStatus.textContent = status
    el.headerProfile.textContent = profileLabel || '—'
    el.headerDot.className = `status-dot status-dot--${tone}`
  }

  function setChip(target, label, tone = 'neutral') {
    target.className = `status-chip status-chip--${tone}`
    target.innerHTML = '<span class="status-chip__dot" aria-hidden="true"></span><span></span>'
    target.lastElementChild.textContent = label
  }

  function setFieldError(input, message) {
    const error = document.getElementById(`${input.id}-error`)
    input.setAttribute('aria-invalid', message ? 'true' : 'false')
    if (message) input.setAttribute('aria-describedby', `${input.id}-error`)
    else input.removeAttribute('aria-describedby')
    if (error) error.textContent = message || ''
  }

  function clearFieldErrors(inputs) {
    for (const input of inputs) setFieldError(input, '')
  }

  function profileStatusLabel(profile) {
    if (!profile?.configured) return profile?.migratedFromStaging ? 'ตั้งค่า Production' : 'ต้องตั้งค่า'
    if (!profile.pgDumpAvailable) return 'รอ pg_dump'
    if (profile.configurationSource) return 'พร้อม · ใช้การตั้งค่าร่วม'
    if (profile.schedule?.enabled && profile.schedule?.taskInstalled) return 'พร้อม · ตั้งเวลาแล้ว'
    return 'พร้อมใช้งาน'
  }

  function profileStatusTone(profile) {
    if (!profile?.configured) return 'warning'
    if (!profile.pgDumpAvailable) return 'info'
    return 'success'
  }

  function profileInitial(profile) {
    return text(profile?.shortLabel || profile?.label).slice(0, 1).toUpperCase() || '?'
  }

  function renderProfilePicker(target, selectedId) {
    if (!target) return
    target.textContent = ''
    for (const profile of profiles()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'profile-option'
      button.dataset.profileId = profile.id
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', profile.id === selectedId ? 'true' : 'false')
      button.classList.toggle('is-selected', profile.id === selectedId)

      const marker = document.createElement('span')
      marker.className = `profile-option__marker profile-option__marker--${profileStatusTone(profile)}`
      marker.textContent = profileInitial(profile)
      marker.setAttribute('aria-hidden', 'true')

      const copy = document.createElement('span')
      copy.className = 'profile-option__copy'
      const label = document.createElement('strong')
      label.textContent = profile.label
      const detail = document.createElement('span')
      const sharedLabel = profile.sharedDatabaseKey ? 'ฐานข้อมูลร่วม' : ''
      detail.textContent = [profile.expectedProjectRef, sharedLabel, profileStatusLabel(profile)].filter(Boolean).join(' · ')
      if (profile.sharedDatabaseLabel) button.title = profile.sharedDatabaseLabel
      copy.append(label, detail)

      const arrow = document.createElement('span')
      arrow.className = 'profile-option__arrow'
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>'
      arrow.setAttribute('aria-hidden', 'true')
      button.append(marker, copy, arrow)
      target.append(button)
    }
  }

  function renderProfilePickers() {
    renderProfilePicker(el.setupProfilePicker, state.setupProfileId)
    renderProfilePicker(el.dashboardProfilePicker, state.activeProfileId)
    const ready = profiles().filter((profile) => profile.configured).length
    el.setupProfileCount.textContent = `${ready}/${profiles().length || 2} พร้อมใช้งาน`
  }

  function updateSetupProfileBand() {
    const profile = setupProfile()
    if (!profile) return
    el.setupProfileName.textContent = profile.label
    el.setupProfileRef.textContent = profile.expectedProjectRef
    const marker = document.querySelector('.active-profile-band__marker')
    if (marker) marker.textContent = profileInitial(profile)
  }

  function showSetup(step = 1, message = '', tone = 'info') {
    state.setupStep = step
    el.setupView.hidden = false
    el.dashboardView.hidden = true
    updateSetupStep()
    renderProfilePickers()
    updateSetupProfileBand()
    setFeedback(el.setupFeedback, message, tone)
    setHeader('ต้องตั้งค่าโปรเจค', 'warning', setupProfile()?.label)
    window.requestAnimationFrame(() => {
      const focusTarget = step === 1 ? el.supabaseUrl : el.backupRoot
      focusTarget?.focus()
    })
  }

  function showDashboard() {
    el.setupView.hidden = true
    el.dashboardView.hidden = false
    setFeedback(el.setupFeedback, '')
    renderProfilePickers()
    setHeader('พร้อมสำรองข้อมูล', 'success', activeProfile()?.label)
  }

  function updateSetupStep() {
    for (const step of el.setupSteps) step.hidden = Number(step.dataset.setupStep) !== state.setupStep
    for (const progress of el.progressSteps) {
      const number = Number(progress.dataset.progressStep)
      progress.classList.toggle('is-active', number === state.setupStep)
      progress.classList.toggle('is-complete', number < state.setupStep)
    }
  }

  function draftFor(profile) {
    return state.drafts.get(profile?.id) || null
  }

  function populateForm(settings = state.settings) {
    const profile = setupProfile()
    if (!profile) return
    const draft = draftFor(profile)
    el.supabaseUrl.value = text(draft?.supabaseUrl || profile.supabaseUrl)
    el.serviceRoleKey.value = text(draft?.serviceRoleKey)
    el.databaseUrl.value = text(draft?.databaseUrl)
    el.backupRoot.value = text(draft?.backupRoot || profile.backupRoot)
    el.pgDumpPath.value = text(draft?.pgDumpPath || profile.pgDumpPath)
    el.runnerId.value = text(draft?.runnerId || settings?.runnerId || settings?.defaultRunnerId)
    el.scheduleEnabled.checked = draft?.schedule?.enabled === true || profile.schedule?.enabled === true
    el.scheduleDay.value = String(draft?.schedule?.day || profile.schedule?.day || 1)
    el.scheduleTime.value = text(draft?.schedule?.time || profile.schedule?.time || '02:00')
    updateScheduleFields()
    clearFieldErrors([el.supabaseUrl, el.serviceRoleKey, el.databaseUrl, el.backupRoot, el.pgDumpPath, el.runnerId])
  }

  function captureDraft() {
    const profile = setupProfile()
    if (!profile) return
    state.drafts.set(profile.id, {
      supabaseUrl: el.supabaseUrl.value.trim(),
      serviceRoleKey: el.serviceRoleKey.value.trim(),
      databaseUrl: el.databaseUrl.value.trim(),
      backupRoot: el.backupRoot.value.trim(),
      pgDumpPath: el.pgDumpPath.value.trim(),
      runnerId: el.runnerId.value.trim(),
      schedule: {
        enabled: el.scheduleEnabled.checked,
        day: Number(el.scheduleDay.value),
        time: el.scheduleTime.value,
      },
    })
  }

  function updateScheduleFields() {
    el.scheduleFields.style.opacity = el.scheduleEnabled.checked ? '1' : '.58'
    el.scheduleFields.querySelectorAll('input, select').forEach((input) => { input.disabled = !el.scheduleEnabled.checked })
  }

  function validateConnectionStep() {
    const inputs = [el.supabaseUrl, el.serviceRoleKey, el.databaseUrl]
    clearFieldErrors(inputs)
    let valid = true
    const supabaseUrl = el.supabaseUrl.value.trim().replace(/\/$/, '')
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(supabaseUrl)) {
      setFieldError(el.supabaseUrl, 'กรุณาระบุ URL ในรูปแบบ https://ชื่อโปรเจกต์.supabase.co')
      valid = false
    }
    const existing = setupProfile()?.configured === true
    if (!existing && !el.serviceRoleKey.value.trim()) {
      setFieldError(el.serviceRoleKey, 'กรุณาระบุ service role key ของโปรเจคนี้')
      valid = false
    }
    if (!existing && !el.databaseUrl.value.trim()) {
      setFieldError(el.databaseUrl, 'กรุณาระบุ PostgreSQL connection string ของโปรเจคนี้')
      valid = false
    }
    if (el.serviceRoleKey.value.trim() && el.serviceRoleKey.value.trim().length < 20) {
      setFieldError(el.serviceRoleKey, 'service role key สั้นเกินไป กรุณาตรวจสอบค่าที่คัดลอกมา')
      valid = false
    }
    if (el.databaseUrl.value.trim()) {
      try {
        const parsed = new URL(el.databaseUrl.value.trim())
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) throw new Error()
        const hostRef = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname)
        const urlRef = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(supabaseUrl)
        if (hostRef && urlRef && hostRef[1].toLowerCase() !== urlRef[1].toLowerCase()) throw new Error('project mismatch')
      } catch (cause) {
        setFieldError(el.databaseUrl, cause?.message === 'project mismatch'
          ? 'database URL เป็นคนละโปรเจคกับ Supabase project URL'
          : 'ต้องเป็น PostgreSQL URL ที่มี username และ password')
        valid = false
      }
    }
    return valid
  }

  function validateStorageStep() {
    const inputs = [el.backupRoot, el.pgDumpPath, el.runnerId]
    clearFieldErrors(inputs)
    let valid = true
    if (!el.backupRoot.value.trim()) {
      setFieldError(el.backupRoot, 'กรุณาเลือกโฟลเดอร์เก็บไฟล์สำรอง')
      valid = false
    }
    if (!el.runnerId.value.trim()) {
      setFieldError(el.runnerId, 'กรุณาระบุชื่อ runner')
      valid = false
    }
    if (el.scheduleEnabled.checked && !/^([01]\d|2[0-3]):[0-5]\d$/.test(el.scheduleTime.value)) {
      setFeedback(el.setupFeedback, 'กรุณาระบุเวลาในรูปแบบ HH:MM', 'error')
      valid = false
    }
    return valid
  }

  function formPayload() {
    return {
      profileId: state.setupProfileId,
      supabaseUrl: el.supabaseUrl.value.trim(),
      serviceRoleKey: el.serviceRoleKey.value.trim(),
      databaseUrl: el.databaseUrl.value.trim(),
      backupRoot: el.backupRoot.value.trim(),
      pgDumpPath: el.pgDumpPath.value.trim(),
      runnerId: el.runnerId.value.trim(),
    }
  }

  function schedulePayload(profileId = state.setupProfileId) {
    return {
      profileId,
      enabled: el.scheduleEnabled.checked,
      day: Number(el.scheduleDay.value),
      time: el.scheduleTime.value,
    }
  }

  function renderLogs(logs) {
    state.logs = Array.isArray(logs) ? logs.filter(Boolean).slice(-80) : []
    const rows = state.logs.slice().reverse().slice(0, 10)
    el.historyBody.textContent = ''
    if (!rows.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 3
      cell.className = 'empty-cell'
      cell.textContent = 'ยังไม่มี log ของโปรเจคนี้'
      row.append(cell)
      el.historyBody.append(row)
      return
    }
    for (const line of rows) {
      const match = /^(\S+)\s+\[([A-Z]+)\]\s+(.*)$/.exec(line)
      const row = document.createElement('tr')
      const time = document.createElement('td')
      const event = document.createElement('td')
      const detail = document.createElement('td')
      time.textContent = match ? formatDate(match[1]) : '—'
      event.textContent = match ? (match[2] === 'SUCCESS' ? 'สำเร็จ' : match[2] === 'ERROR' ? 'ผิดพลาด' : match[2] === 'WARNING' ? 'ต้องตรวจสอบ' : 'ระบบ') : 'ระบบ'
      event.className = match ? `log-level--${match[2]}` : ''
      detail.textContent = match ? match[3] : line
      row.append(time, event, detail)
      el.historyBody.append(row)
    }
  }

  function updateDashboardProfileCopy(profile) {
    if (!profile) return
    el.dashboardTitle.textContent = `สำรอง ${profile.label}`
    const targetLabel = profile.sharedDatabaseKey ? 'ฐานข้อมูล Production ร่วม' : `project ${profile.expectedProjectRef}`
    el.dashboardSubtitle.textContent = `${profile.description} · ${targetLabel}`
  }

  function renderStatus(status) {
    state.status = status || {}
    const profile = status?.profile || activeProfile()
    updateDashboardProfileCopy(profile)
    const latest = status?.latestLocal
    const configured = status?.configured === true && profile?.configured !== false
    el.localCount.textContent = String(status?.localCount || 0)
    el.backupRootStatus.textContent = text(status?.backupRoot || profile?.backupRoot) || '—'
    el.latestRunner.textContent = text(latest?.runnerId || status?.runnerId) || '—'
    el.latestSize.textContent = latest ? formatBytes(latest.bytes) : '—'

    if (!configured) {
      el.latestSubtitle.textContent = 'โปรดตั้งค่าการเชื่อมต่อของโปรเจคนี้ก่อน'
      el.latestValue.textContent = `ยังไม่ได้ตั้งค่า ${profile?.label || 'โปรเจคนี้'}`
      el.latestDetail.textContent = 'กด “ตั้งค่าโปรเจค” แล้วเลือกโปรเจคนี้จากรายการ'
      setChip(el.latestChip, 'ยังไม่ได้ตั้งค่า', 'warning')
    } else if (latest) {
      el.latestSubtitle.textContent = `ตรวจสอบจาก manifest.json · ${formatDate(latest.completedAt)}`
      el.latestValue.textContent = formatDate(latest.completedAt)
      el.latestDetail.textContent = `${latest.fileName} · SHA-256 ${latest.sha256.slice(0, 12)}…`
      setChip(el.latestChip, 'สำเร็จ', 'success')
    } else {
      el.latestSubtitle.textContent = 'ยังไม่พบไฟล์สำเร็จในโฟลเดอร์นี้'
      el.latestValue.textContent = `ยังไม่มี backup ของ ${profile?.label || 'โปรเจคนี้'}`
      el.latestDetail.textContent = 'เมื่อสำเร็จจะแสดงเวลา ขนาด และ checksum ที่นี่'
      setChip(el.latestChip, 'ยังไม่มีข้อมูล', 'neutral')
    }

    const pgDumpAvailable = status?.pgDumpAvailable === true || profile?.pgDumpAvailable === true
    if (state.busy) {
      setChip(el.runnerChip, 'กำลังทำงาน', 'info')
      el.runnerSubtitle.textContent = 'กำลังสร้างและตรวจสอบไฟล์สำรอง'
      setHeader('กำลังสำรองข้อมูล', 'warning', profile?.label)
    } else if (!configured) {
      setChip(el.runnerChip, 'ต้องตั้งค่า', 'warning')
      el.runnerSubtitle.textContent = 'เลือกโปรเจคนี้ในหน้าตั้งค่าเพื่อเริ่มใช้งาน'
      setHeader('ต้องตั้งค่าโปรเจค', 'warning', profile?.label)
    } else if (pgDumpAvailable) {
      setChip(el.runnerChip, 'พร้อมใช้งาน', 'success')
      el.runnerSubtitle.textContent = `Runner ${text(status?.runnerId) || 'ไม่ระบุ'} พร้อมทำงาน`
      setHeader('พร้อมสำรองข้อมูล', 'success', profile?.label)
    } else {
      setChip(el.runnerChip, 'รอ pg_dump', 'warning')
      el.runnerSubtitle.textContent = 'เลือก pg_dump.exe ในการตั้งค่าก่อนเริ่มงาน'
      setHeader('ต้องเตรียมเครื่องมือ', 'warning', profile?.label)
    }
    el.pgDumpStatus.textContent = pgDumpAvailable ? (text(status?.pgDumpPath || profile?.pgDumpPath) || 'พบ pg_dump.exe ในเครื่อง') : 'ยังไม่พบ pg_dump.exe'

    const schedule = status?.schedule || profile?.schedule
    if (schedule?.enabled && schedule.taskInstalled) {
      el.scheduleStatus.textContent = `ทุกวันที่ ${schedule.day} เวลา ${schedule.time} · Task Scheduler เปิดอยู่`
    } else if (schedule?.enabled) {
      el.scheduleStatus.textContent = 'เปิดไว้ แต่ Task Scheduler ยังไม่พร้อม'
    } else {
      el.scheduleStatus.textContent = 'ปิดอยู่ · สำรองเองได้จากปุ่มด้านบน'
    }
    renderLogs(status?.logs || state.logs)
    renderProfilePickers()
  }

  async function refreshStatus(profileId = state.activeProfileId) {
    try {
      const status = await api.getStatus(profileId)
      renderStatus(status)
    } catch (cause) {
      setFeedback(el.dashboardFeedback, errorMessage(cause), 'error')
    }
  }

  async function selectSetupProfile(profileId) {
    captureDraft()
    state.setupProfileId = profileId
    populateForm(state.settings)
    showSetup(1)
  }

  async function selectDashboardProfile(profileId) {
    state.activeProfileId = profileId
    state.logs = []
    renderProfilePickers()
    setFeedback(el.dashboardFeedback, '')
    await refreshStatus(profileId)
  }

  async function handleSave(event) {
    event.preventDefault()
    setFeedback(el.setupFeedback, '')
    if (!validateStorageStep()) return
    if (!validateConnectionStep()) {
      state.setupStep = 1
      updateSetupStep()
      setFeedback(el.setupFeedback, 'ตรวจสอบข้อมูลการเชื่อมต่อที่ยังไม่ครบ แล้วลองอีกครั้ง', 'error')
      el.supabaseUrl.focus()
      return
    }
    const payload = formPayload()
    setBusy(el.save, true, 'กำลังบันทึกโปรเจค')
    try {
      state.settings = await api.saveSettings(payload)
      state.drafts.delete(state.setupProfileId)
      state.activeProfileId = state.setupProfileId
      state.settings = await api.setSchedule(schedulePayload(state.setupProfileId))
      renderProfilePickers()
      const nextProfile = profiles().find((profile) => !profile.configured)
      if (nextProfile) {
        setFeedback(el.setupFeedback, `บันทึก ${setupProfile()?.label || 'โปรเจคนี้'} แล้ว · เลือก ${nextProfile.label} ด้านบนเพื่อตั้งค่าต่อ`, 'success')
        updateSetupProfileBand()
      } else {
        showDashboard()
        await refreshStatus(state.activeProfileId)
        const sharedMessage = profileById(state.activeProfileId)?.sharedDatabaseKey
          ? ' · พร้อมสำรองฐานข้อมูล Production เดียวกันทั้ง Stock และ Portal'
          : ''
        setFeedback(el.dashboardFeedback, `ตั้งค่า ${profileById(state.activeProfileId)?.label || 'โปรเจคนี้'} เรียบร้อยแล้ว${sharedMessage}`, 'success')
      }
    } catch (cause) {
      setFeedback(el.setupFeedback, errorMessage(cause), 'error')
    } finally {
      setBusy(el.save, false)
    }
  }

  async function handleTestConnection() {
    setFeedback(el.dashboardFeedback, '')
    setBusy(el.testConnection, true, 'กำลังตรวจสอบ')
    try {
      const result = await api.testConnection(state.activeProfileId)
      if (result.pgDumpAvailable) {
        setFeedback(el.dashboardFeedback, `เชื่อมต่อสำเร็จ · พบ pg_dump.exe แล้ว · project ${result.projectRef}`, 'success')
      } else {
        setFeedback(el.dashboardFeedback, `เชื่อมต่อ Supabase สำเร็จ แต่ยังไม่พบ pg_dump.exe · project ${result.projectRef}`, 'info')
      }
      await refreshStatus(state.activeProfileId)
    } catch (cause) {
      setFeedback(el.dashboardFeedback, errorMessage(cause), 'error')
    } finally {
      setBusy(el.testConnection, false)
    }
  }

  async function handleBackup() {
    if (state.busy) return
    const profile = activeProfile()
    if (!profile?.configured) {
      setFeedback(el.dashboardFeedback, `ยังไม่ได้ตั้งค่า ${profile?.label || 'โปรเจคนี้'} กรุณาเปิด “ตั้งค่าโปรเจค”`, 'error')
      return
    }
    if (!window.confirm(`เริ่มสำรองฐานข้อมูล Production ร่วมของ ${profile.label} ลงเครื่องนี้ตอนนี้หรือไม่?`)) return
    state.busy = true
    setFeedback(el.dashboardFeedback, `กำลังสร้างไฟล์สำรอง Production ร่วมของ ${profile.label} อาจใช้เวลาตามขนาดฐานข้อมูลและความเร็วเครือข่าย`, 'info')
    setBusy(el.backupNow, true, 'กำลังสำรองโปรเจค')
    renderStatus(state.status)
    try {
      const result = await api.runBackup(state.activeProfileId)
      if (result.status === 'succeeded') {
        setFeedback(el.dashboardFeedback, `สำรอง ${profile.label} สำเร็จ · ${formatBytes(result.bytes)} · SHA-256 ${result.sha256.slice(0, 16)}…`, 'success')
      } else if (result.status === 'failed') {
        setFeedback(el.dashboardFeedback, result.error || 'การสำรองไม่สำเร็จ กรุณาดูคำแนะนำด้านล่าง', 'error')
      } else if (result.status === 'waiting') {
        setFeedback(el.dashboardFeedback, result.reason || 'งานถูกรอให้ runner อื่นทำงาน', 'info')
      } else {
        setFeedback(el.dashboardFeedback, result.reason || 'ข้ามการสำรองรอบนี้', 'info')
      }
      await refreshStatus(state.activeProfileId)
    } catch (cause) {
      setFeedback(el.dashboardFeedback, errorMessage(cause), 'error')
    } finally {
      state.busy = false
      setBusy(el.backupNow, false)
      if (state.status) renderStatus(state.status)
    }
  }

  async function openSettings() {
    state.settings = await api.getSettings()
    state.setupProfileId = state.activeProfileId
    populateForm(state.settings)
    showSetup(1, state.settings?.error || '', state.settings?.error ? 'error' : 'info')
  }

  async function init() {
    if (!api) {
      setHeader('ไม่พบส่วนเชื่อมต่อของแอป', 'danger')
      return
    }
    api.onLog((entry) => {
      if (!entry) return
      if (!entry.profileId || entry.profileId === state.activeProfileId) {
        state.logs.push(`${entry.at} [${String(entry.level || 'info').toUpperCase()}] ${entry.message}`)
        renderLogs(state.logs)
      }
    })
    const settings = await api.getSettings()
    state.settings = settings
    const firstConfigured = profiles().find((profile) => profile.configured)
    state.activeProfileId = firstConfigured?.id || 'stock'
    state.setupProfileId = state.activeProfileId
    renderProfilePickers()
    if (settings?.configured) {
      showDashboard()
      await refreshStatus(state.activeProfileId)
    } else {
      populateForm(settings)
      showSetup(1, settings?.error || '', settings?.error ? 'error' : 'info')
    }
  }

  el.next.addEventListener('click', () => {
    if (!validateConnectionStep()) return
    captureDraft()
    state.setupStep = 2
    updateSetupStep()
    window.requestAnimationFrame(() => el.backupRoot.focus())
  })
  el.back.addEventListener('click', () => {
    captureDraft()
    state.setupStep = 1
    updateSetupStep()
    el.supabaseUrl.focus()
  })
  el.setupForm.addEventListener('submit', handleSave)
  el.scheduleEnabled.addEventListener('change', updateScheduleFields)
  el.openSettings.addEventListener('click', () => { void openSettings() })
  el.backupNow.addEventListener('click', () => { void handleBackup() })
  el.testConnection.addEventListener('click', () => { void handleTestConnection() })
  el.refresh.addEventListener('click', () => { void refreshStatus(state.activeProfileId) })
  el.openFolder.addEventListener('click', async () => {
    try { await api.openBackupFolder(state.activeProfileId) } catch (cause) { setFeedback(el.dashboardFeedback, errorMessage(cause), 'error') }
  })
  el.chooseFolder.addEventListener('click', async () => {
    const folder = await api.pickDirectory()
    if (folder) el.backupRoot.value = folder
  })
  el.choosePgDump.addEventListener('click', async () => {
    const file = await api.pickPgDump()
    if (file) el.pgDumpPath.value = file
  })
  el.setupProfilePicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-id]')
    if (button) void selectSetupProfile(button.dataset.profileId)
  })
  el.dashboardProfilePicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-id]')
    if (button) void selectDashboardProfile(button.dataset.profileId)
  })
  document.querySelectorAll('[data-toggle-secret]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.toggleSecret)
      if (!input) return
      input.type = input.type === 'password' ? 'text' : 'password'
    })
  })

  void init().catch((cause) => {
    setHeader('เริ่มแอปไม่สำเร็จ', 'danger')
    setFeedback(el.setupFeedback, errorMessage(cause), 'error')
    el.setupView.hidden = false
    el.dashboardView.hidden = true
  })
})()
