import { useCallback, useEffect, useState } from 'react'
import {
  Activity, ArrowRight, ArrowUpRight, Bell, Blocks, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Copy, CreditCard, FileText,
  FileSpreadsheet, Folder, FolderKanban, Image, LayoutDashboard, ListTodo, LoaderCircle, LogOut, Menu,
  MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, StickyNote, Target,
  Terminal, Upload, Users, Wallet, X,
} from 'lucide-react'
import { api, clearToken, getLastActivity, getToken, IDLE_TIMEOUT_MS, saveToken, touchSession } from './services/api'
import './App.css'

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', group: 'CORE', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', group: 'MANAGE', icon: FolderKanban },
  { id: 'finance', label: 'Finance', group: 'MANAGE', icon: Wallet },
  { id: 'workspace', label: 'Workspace', group: 'PERSONAL', icon: Blocks },
  { id: 'cloud', label: 'Photos & Videos', group: 'PERSONAL', icon: Folder },
]

const EMPTY_DATA = { projects: [], expenses: [], tasks: [], notes: [], files: [], familyMembers: [], financeAccounts: [], financeCategories: [], budgets: [], goals: [], stats: null }
const STATUSES = ['active', 'completed', 'on_hold', 'archived']
const OCCUPATIONS = [
  { value: 'student', label: 'Student' },
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'homemaker', label: 'Homemaker' },
  { value: 'caregiver', label: 'Caregiver' },
  { value: 'retired', label: 'Retired' },
  { value: 'other', label: 'Other' },
]
const OCCUPATION_PROFILES = {
  student: { title: 'Your study dashboard', subtitle: 'Keep learning, deadlines, projects, and personal finances in view.', projects: 'Study and personal projects', projectAction: 'New study project', taskAction: 'Study task', taskHint: 'Keep your next deadline close', priority: ['Open tasks', 'Total projects', 'Recorded expenses', 'Active projects'] },
  employed: { title: 'Your work and life dashboard', subtitle: 'Balance work priorities, personal projects, and household finances.', projects: 'Work and personal projects', projectAction: 'New work project', taskAction: 'Work task', taskHint: 'Capture your next work priority', priority: ['Active projects', 'Open tasks', 'Recorded expenses', 'Total projects'] },
  self_employed: { title: 'Your business dashboard', subtitle: 'Keep projects, tasks, and business spending visible in one place.', projects: 'Business and personal projects', projectAction: 'New business project', taskAction: 'Business task', taskHint: 'Move your next project forward', priority: ['Total projects', 'Recorded expenses', 'Open tasks', 'Active projects'] },
  homemaker: { title: 'Your household dashboard', subtitle: 'Coordinate household projects, family tasks, and everyday spending.', projects: 'Household and personal projects', projectAction: 'New household project', taskAction: 'Family task', taskHint: 'Keep a household task in view', priority: ['Open tasks', 'Recorded expenses', 'Total projects', 'Active projects'] },
  caregiver: { title: 'Your care and home dashboard', subtitle: 'Keep care-related tasks, projects, and household spending organized.', projects: 'Care and household projects', projectAction: 'New care project', taskAction: 'Care task', taskHint: 'Keep the next care task close', priority: ['Open tasks', 'Recorded expenses', 'Active projects', 'Total projects'] },
  retired: { title: 'Your personal dashboard', subtitle: 'Stay on top of personal projects, plans, and everyday finances.', projects: 'Personal projects', projectAction: 'New personal project', taskAction: 'Personal task', taskHint: 'Keep a plan moving forward', priority: ['Recorded expenses', 'Open tasks', 'Total projects', 'Active projects'] },
  other: { title: 'Your personal dashboard', subtitle: 'Here’s what’s happening across your workspace.', projects: 'Recent projects', projectAction: 'New project', taskAction: 'Create task', taskHint: 'Capture a next step', priority: ['Total projects', 'Active projects', 'Open tasks', 'Recorded expenses'] },
}

function friendlyDate(value) {
  if (!value) return 'No date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function currency(value) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(amount)
    : 'KES --'
}

function amountInCents(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

function expenseDateKey(value) {
  const text = String(value || '')
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDate) return isoDate[1]
  const date = new Date(text)
  return Number.isNaN(date.getTime())
    ? ''
    : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function donutSlicePath(startAngle, endAngle) {
  const point = (radius, angle) => {
    const radians = (angle - 90) * Math.PI / 180
    return [100 + radius * Math.cos(radians), 100 + radius * Math.sin(radians)]
  }
  const [outerStartX, outerStartY] = point(78, startAngle)
  const [outerEndX, outerEndY] = point(78, endAngle)
  const [innerStartX, innerStartY] = point(48, startAngle)
  const [innerEndX, innerEndY] = point(48, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${outerStartX} ${outerStartY} A 78 78 0 ${largeArc} 1 ${outerEndX} ${outerEndY} L ${innerEndX} ${innerEndY} A 48 48 0 ${largeArc} 0 ${innerStartX} ${innerStartY} Z`
}

function buildDonutSlices(items, totalCents, colors) {
  return items.reduce((result, item, index) => {
    const startAngle = result.angle
    const endAngle = startAngle + item.cents / totalCents * 360
    return {
      angle: endAngle,
      slices: [...result.slices, {
        ...item,
        color: colors[index % colors.length],
        startAngle,
        endAngle,
        percentage: item.cents / totalCents * 100,
      }],
    }
  }, { angle: 0, slices: [] }).slices
}

function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'F'
}

function App() {
  const [token, setToken] = useState(() => getToken())
  const [user, setUser] = useState(null)
  const [checkingSession, setCheckingSession] = useState(Boolean(getToken()))
  const [health, setHealth] = useState('checking')
  const [healthError, setHealthError] = useState('')
  const [authError, setAuthError] = useState('')
  const [welcome, setWelcome] = useState(null)
  const [booting, setBooting] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => setBooting(false), 1450)
    return () => window.clearTimeout(timeout)
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const result = await api.health()
      setHealth(result?.status === 'ok' && result?.database === 'connected' ? 'online' : 'degraded')
      setHealthError(result?.status === 'ok' ? '' : 'The API health check reported a database or service issue.')
    } catch (error) {
      setHealth('offline')
      setHealthError(error.message)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(checkHealth, 0)
    const interval = window.setInterval(checkHealth, 60000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [checkHealth])

  useEffect(() => {
    const handleUnauthorized = () => {
      clearToken()
      setToken(null)
      setUser(null)
      setAuthError('Your session expired. Please sign in again.')
    }
    window.addEventListener('fernando:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('fernando:unauthorized', handleUnauthorized)
  }, [])

  useEffect(() => {
    if (!token) return
    let active = true
    api.profile().then((result) => {
      if (active) setUser(result.user)
    }).catch((error) => {
      if (active) {
        clearToken()
        setToken(null)
        setAuthError(error.message)
      }
    }).finally(() => {
      if (active) setCheckingSession(false)
    })
    return () => { active = false }
  }, [token])

  const handleSignedIn = (result) => {
    saveToken(result.token)
    setAuthError('')
    setUser(result.user)
    setToken(result.token)
    setWelcome({ title: 'Access granted', message: 'Welcome back to your private workspace.', tone: 'private' })
  }

  const logout = useCallback((message = '') => {
    clearToken()
    setToken(null)
    setUser(null)
    setAuthError(typeof message === 'string' ? message : '')
  }, [])

  const signOut = useCallback(() => {
    clearToken()
    setToken(null)
    setUser(null)
    setAuthError('')
    setSigningOut(true)
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 7000
    window.setTimeout(() => setSigningOut(false), duration)
  }, [])

  useEffect(() => {
    if (!token) return
    let lastActivity = getLastActivity() || Date.now()
    let lastStoredActivity = lastActivity
    let lastRecordedActivity = lastActivity
    let timeout

    const scheduleSignout = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(
        () => logout('Signed out after five minutes of inactivity.'),
        Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivity)),
      )
    }
    const recordActivity = () => {
      const now = Date.now()
      if (now - lastRecordedActivity < 1000) return
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        logout('Signed out after five minutes of inactivity.')
        return
      }
      lastActivity = now
      lastRecordedActivity = now
      if (now - lastStoredActivity >= 10000) {
        touchSession()
        lastStoredActivity = now
      }
      scheduleSignout()
    }
    const verifyOnReturn = () => {
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        logout('Signed out after five minutes of inactivity.')
      } else {
        recordActivity()
      }
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }))
    window.addEventListener('focus', verifyOnReturn)
    document.addEventListener('visibilitychange', verifyOnReturn)
    scheduleSignout()

    return () => {
      window.clearTimeout(timeout)
      events.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
      window.removeEventListener('focus', verifyOnReturn)
      document.removeEventListener('visibilitychange', verifyOnReturn)
    }
  }, [token, logout])

  if (booting || checkingSession) return <main className="boot-screen">
    <div className="boot-stage">
      <div className="boot-logo-wrap"><span className="boot-orbit boot-orbit-one" /><span className="boot-orbit boot-orbit-two" /><img className="boot-logo" src="/rere-cloud-logo.svg" alt="Rere Cloud" /></div>
      <div className="boot-progress"><span /></div>
      <p><i /> ESTABLISHING PRIVATE NETWORK <i /></p>
    </div>
  </main>
  if (signingOut) return <SignOutScreen />
  if (!token || !user) return <AuthScreen health={health} healthError={healthError} initialError={authError} onSignedIn={handleSignedIn} />
  return <Dashboard user={user} health={health} healthError={healthError} initialSuccess={welcome} onLogout={logout} onSignOut={signOut} />
}

function SignOutScreen() {
  return <main className="signout-screen" role="status" aria-live="polite">
    <div className="signout-stage">
      <div className="signout-emblem" aria-hidden="true">
        <span className="signout-orbit signout-orbit-one" />
        <span className="signout-orbit signout-orbit-two" />
        <img src="/rere-cloud-mark.svg" alt="" />
        <span className="signout-lock"><ShieldCheck size={17} /></span>
      </div>
      <p className="signout-kicker"><i /> SECURE SESSION <i /></p>
      <h1>Leaving your<br /><em>workspace.</em></h1>
      <div className="signout-status"><span><i /> CREDENTIAL CLEARED</span><span>SESSION CLOSED</span></div>
      <div className="signout-progress"><span /></div>
      <p className="signout-foot">RERE CLOUD <b>·</b> PRIVATE NETWORK</p>
    </div>
  </main>
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><img src="/rere-cloud-mark.svg" alt="" /></span>
    <span className="brand-type">RERE <span>Cloud</span><small>THE RERE'S PRIVATE NETWORK</small></span>
  </div>
}

function HealthPill({ health, detail = '' }) {
  const label = { checking: 'CHECKING API', online: 'API CONNECTED', degraded: 'API DEGRADED', offline: 'API OFFLINE' }[health]
  return <span className={`health-pill health-${health}`} title={detail || label} aria-label={`${label}${detail ? `: ${detail}` : ''}`}><i />{label}</span>
}

function AuthScreen({ health, healthError, initialError, onSignedIn }) {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ first_name: '', last_name: '', username: '', email: '', phone: '+254', occupation: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const [success, setSuccess] = useState(null)
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!form.username.trim() || !form.password) return setError('Enter your username and password.')
    if (mode === 'signup') {
      if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim() || !form.phone.trim() || !form.occupation) return setError('Complete every field to create your account.')
      if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await api.signup({ ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim(), username: form.username.trim(), email: form.email.trim(), phone: form.phone.trim() })
        setMode('signin')
        setNotice(result.message || 'Account created. Sign in to continue.')
        setSuccess({ title: 'Profile created', message: 'Your private workspace profile is ready. Sign in to continue.', tone: 'private' })
      } else {
        const result = await api.signin({ username: form.username.trim(), password: form.password })
        onSignedIn(result)
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen">
    <div className="auth-ambient" aria-hidden="true" />
    <header className="auth-top"><Brand compact /><HealthPill health={health} detail={healthError} /></header>
    <section className="auth-content">
      <div className="auth-kicker"><span className="red-pip" /> THE RERE'S PRIVATE NETWORK <span className="auth-kicker-line" /></div>
      <h1>{mode === 'signin' ? <>Your system.<br /><em>Your rules.</em></> : <>Build your<br /><em>workspace.</em></>}</h1>
      <p className="auth-intro">{mode === 'signin' ? 'A personal workspace for Fernando and the people in his network.' : 'Set up a workspace profile for someone in Fernando’s trusted circle.'}</p>
      {(health === 'offline' || health === 'degraded') && <div className="api-warning" role="status"><strong>API connection issue</strong><span>{healthError || 'The health check did not report a healthy service.'}</span><small>If this is a CORS error, set Flask <code>FRONTEND_ORIGIN</code> to this frontend’s origin and restart Flask.</small></div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && <div className="form-row">
          <Field label="First name" name="first_name" value={form.first_name} onChange={update} autoComplete="given-name" />
          <Field label="Last name" name="last_name" value={form.last_name} onChange={update} autoComplete="family-name" />
        </div>}
        <Field label="Username" name="username" value={form.username} onChange={update} autoComplete="username" />
        {mode === 'signup' && <>
          <Field label="Email address" name="email" type="email" value={form.email} onChange={update} autoComplete="email" />
          <Field label="Kenyan phone number" name="phone" type="tel" value={form.phone} onChange={update} autoComplete="tel" />
          <Field label="Occupation" name="occupation" type="select" value={form.occupation} onChange={update} options={OCCUPATIONS} />
        </>}
        <Field label="Password" name="password" type="password" value={form.password} onChange={update} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={16} className="spin" /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'}<ArrowRight size={16} /></>}</button>
      </form>
      <p className="auth-switch">{mode === 'signin' ? 'Part of Fernando’s network?' : 'Already have a profile?'} <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice('') }}>{mode === 'signin' ? 'Create profile' : 'Sign in'}</button></p>
    </section>
    <footer className="auth-foot"><span><ShieldCheck size={14} /> SECURE SESSION</span><span>BUILD 01.26 <i /> ALL SYSTEMS {health === 'online' ? 'NOMINAL' : 'STANDBY'}</span></footer>
    {success && <SuccessOverlay title={success.title} message={success.message} onDone={() => setSuccess(null)} />}
  </main>
}

function Field({ label, name, type = 'text', value, onChange, autoComplete, required = true, placeholder, options = [] }) {
  return <label className="field"><span>{label}</span>{type === 'select' ? <select name={name} value={value} onChange={onChange} required={required}><option value="">Select occupation</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={name} type={type} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} required={required} />}</label>
}

function SuccessOverlay({ title, message, tone = 'private', onDone }) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, 2100)
    return () => window.clearTimeout(timeout)
  }, [onDone])

  return <div className={`success-backdrop success-tone-${tone}`} onClick={onDone}>
    <section className="success-card" role="status" aria-live="polite" aria-label={`${title}. ${message}`} onClick={(event) => event.stopPropagation()}>
      <div className="success-check" aria-hidden="true"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" /><path d="m16 28 8 8 17-18" /></svg></div>
      <p className="success-kicker">CONFIRMED / SAVED</p>
      <h2>{title}</h2>
      <p className="success-message">{message}</p>
      <button className="success-dismiss" onClick={onDone}>Continue</button>
    </section>
  </div>
}

function Dashboard({ user, health, healthError, initialSuccess, onLogout, onSignOut }) {
  const [section, setSection] = useState('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [data, setData] = useState(EMPTY_DATA)
  const [loadState, setLoadState] = useState('loading')
  const [loadErrors, setLoadErrors] = useState({})
  const [dialog, setDialog] = useState(null)
  const [toast, setToast] = useState('')
  const [success, setSuccess] = useState(initialSuccess)
  const [saving, setSaving] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    const entries = [
      ['stats', api.stats()], ['projects', api.projects.list()], ['expenses', api.expenses.list()],
      ['financeAccounts', api.finance.accounts.list()], ['financeCategories', api.finance.categories.list()],
      ['budgets', api.finance.budgets.list()], ['goals', api.finance.goals.list()],
      ['tasks', api.tasks.list()], ['notes', api.notes.list()], ['files', api.files.list()],
      ['familyMembers', api.family.members()],
    ]
    Promise.all(entries.map(async ([key, promise]) => {
      try { return [key, await promise, null] }
      catch (error) { return [key, null, error] }
    })).then((results) => {
      if (!active) return
      const next = { ...EMPTY_DATA }
      const errors = {}
      for (const [key, result, error] of results) {
        if (error) errors[key] = error.message
        else if (key === 'stats') next[key] = result
        else if (key === 'files') next[key] = result?.files || []
        else if (key === 'familyMembers') next[key] = result?.members || []
        else if (key === 'financeAccounts') next[key] = result?.accounts || []
        else if (key === 'financeCategories') next[key] = result?.categories || []
        else if (key === 'budgets') next[key] = result?.budgets || []
        else if (key === 'goals') next[key] = result?.goals || []
        else next[key] = result?.[key] || []
      }
      setData(next)
      setLoadErrors(errors)
      setLoadState('ready')
      if (results.some(([, , error]) => error?.status === 401)) onLogout()
    })
    return () => { active = false }
  }, [refreshKey, onLogout])

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])
  const notify = useCallback((message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }, [])
  const celebrate = useCallback((title, message, tone = section) => {
    setSuccess({ title, message, tone })
  }, [section])

  async function saveResource(resource, value, item) {
    const service = api[resource] || api.finance[resource]
    setSaving({ phase: 'uploading', label: 'Save', name: `${item ? 'Updating' : 'Creating'} ${resourceLabel(resource).toLowerCase()}` })
    try {
      if (item) await service.update(item.id, value)
      else await service.create(value)
      setSaving({ phase: 'success', label: 'Save', name: `${resourceLabel(resource)} saved` })
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      setSaving(null)
      setDialog(null)
      refresh()
      celebrate(`${resourceLabel(resource)} ${item ? 'updated' : 'created'}`, 'Saved to your private workspace.', resource === 'notes' || resource === 'tasks' ? 'workspace' : resource)
    } catch (error) {
      setSaving(null)
      throw error
    }
  }

  async function deleteResource(resource, item) {
    const itemName = item.title || item.name || item.category || 'this record'
    if (!window.confirm(`Delete "${itemName}"? This cannot be undone.`)) return
    try {
      const service = api[resource] || api.finance[resource]
      await service.remove(item.id)
      refresh()
      celebrate(`${resourceLabel(resource)} deleted`, 'Your workspace is up to date.', resource === 'notes' || resource === 'tasks' ? 'workspace' : resource)
    } catch (error) { notify(error.message) }
  }

  const pageTitle = NAV_ITEMS.find((item) => item.id === section)?.label || 'Overview'
  const todayLabel = new Intl.DateTimeFormat('en-KE', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()).toUpperCase()
  const openCreate = (resource) => setDialog({ resource, item: null })
  const openEdit = (resource, item) => setDialog({ resource, item })
  async function contributeToGoal(goal, accountId, amount) {
    setSaving({ phase: 'uploading', label: 'Save', name: `Allocating to ${goal.title}` })
    try {
      const result = await api.finance.goals.contribute(goal.id, { account_id: Number(accountId), amount: Number(amount) })
      setSaving({ phase: 'success', label: 'Save', name: `+${result.xp_earned} XP earned` })
      await new Promise((resolve) => window.setTimeout(resolve, 800))
      setSaving(null)
      refresh()
      celebrate('Contribution saved', `${result.xp_earned} XP added to ${goal.title}.`, 'finance')
    } catch (error) {
      setSaving(null)
      notify(error.message)
    }
  }
  const selectSection = (value) => { setSection(value); setMobileNav(false) }

  const occupation = OCCUPATION_PROFILES[user.occupation] ? user.occupation : 'other'
  const occupationProfile = OCCUPATION_PROFILES[occupation]

  return <div className="app-shell" data-section={section} data-occupation={occupation.replaceAll('_', '-')}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-head"><Brand /><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
      <div className="system-state"><span className="status-dot" /><span>SYSTEM ONLINE</span><span className="system-version">v1.0.4</span></div>
      <nav className="side-nav" aria-label="Main navigation">
        {['CORE', 'MANAGE', 'PERSONAL'].map((group) => <div className="nav-group" key={group}>
          <p className="nav-heading">{group}</p>
          {NAV_ITEMS.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${section === id ? 'nav-active' : ''}`} onClick={() => selectSection(id)}><Icon size={17} /><span>{label}</span>{id === 'workspace' && data.tasks.filter((task) => task.status !== 'completed').length > 0 && <b className="nav-count">{data.tasks.filter((task) => task.status !== 'completed').length}</b>}</button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-panel"><div className="storage-icon"><Terminal size={16} /></div><div><strong>Workspace</strong><span>{data.stats ? `${data.stats.projects?.total ?? 0} projects · ${data.stats.notes?.total ?? 0} notes` : 'Personal environment'}</span></div><MoreHorizontal size={17} /></div>
        <div className="profile-row"><div className="avatar">{initials(user)}</div><div className="profile-copy"><strong>{user.first_name} {user.last_name}</strong><span>@{user.username}</span></div><button className="icon-button logout-button" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
      </div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>RERE CLOUD</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div></div>
        <div className="topbar-right"><HealthPill health={health} detail={healthError} /><span className="topbar-divider" /><button className="icon-button notification-button" aria-label="Notifications" title="Notifications" onClick={() => notify('No new notifications.')}><Bell size={17} /></button><div className="topbar-avatar" title={`${user.first_name} ${user.last_name}`}>{initials(user)}</div></div>
      </header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">{section === 'overview' ? `${todayLabel} / ${occupation.replaceAll('_', ' ').toUpperCase()} WORKSPACE` : `PERSONAL / ${pageTitle.toUpperCase()}`}</p><h1>{section === 'overview' && occupation !== 'other' ? `${occupationProfile.title}, ${user.first_name}.` : section === 'overview' ? `Good to have you here, ${user.first_name}.` : pageTitle}</h1><p className="page-subtitle">{section === 'overview' ? occupationProfile.subtitle : pageDescription(section)}</p></div><button className="button button-primary heading-action" onClick={() => openCreate(section === 'finance' ? 'expenses' : section === 'workspace' ? 'tasks' : 'projects')}><Plus size={16} />{section === 'finance' ? 'Add expense' : section === 'workspace' ? 'New task' : section === 'overview' ? occupationProfile.projectAction : 'New project'}</button></div>
        {(health === 'offline' || health === 'degraded') && <div className="api-warning dashboard-warning" role="status"><strong>API connection issue</strong><span>{healthError || 'The health check did not report a healthy service.'}</span><small>If this is a CORS error, set Flask <code>FRONTEND_ORIGIN</code> to this frontend’s origin and restart Flask.</small></div>}
        {loadState === 'loading' ? <DashboardSkeleton /> : <>
          {section === 'overview' && <Overview data={data} errors={loadErrors} onNavigate={selectSection} onCreate={openCreate} occupation={occupation} />}
          {section === 'projects' && <ProjectsPage projects={data.projects} error={loadErrors.projects} onCreate={() => openCreate('projects')} onEdit={(item) => openEdit('projects', item)} onDelete={(item) => deleteResource('projects', item)} />}
          {section === 'finance' && <FinancePage expenses={data.expenses} accounts={data.financeAccounts} categories={data.financeCategories} budgets={data.budgets} goals={data.goals} error={loadErrors.expenses} financeError={loadErrors.financeAccounts || loadErrors.financeCategories || loadErrors.budgets || loadErrors.goals} onCreate={openCreate} onEdit={(item) => openEdit('expenses', item)} onDelete={deleteResource} onContribute={contributeToGoal} onNotify={notify} />}
          {section === 'workspace' && <WorkspacePage tasks={data.tasks} notes={data.notes} errors={loadErrors} onCreate={openCreate} onEdit={openEdit} onDelete={deleteResource} onRefresh={refresh} notify={notify} celebrate={celebrate} />}
          {section === 'cloud' && <FamilyCloudPage files={data.files} error={loadErrors.files} familyMembers={data.familyMembers} membersError={loadErrors.familyMembers} onRefresh={refresh} notify={notify} />}
        </>}
      </div>
      <footer className="main-footer"><span><span className="footer-pip" /> ALL SYSTEMS OPERATIONAL</span><span>RERE CLOUD <b>·</b> BUILT FOR FOCUS</span></footer>
    </main>
    {dialog && <ResourceDialog resource={dialog.resource} item={dialog.item} categories={data.financeCategories} accounts={data.financeAccounts} onClose={() => setDialog(null)} onSave={saveResource} />}
    {saving && <UploadStatusOverlay state={saving} />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {success && <SuccessOverlay title={success.title} message={success.message} tone={success.tone} onDone={() => setSuccess(null)} />}
  </div>
}

function resourceLabel(resource) {
  return { projects: 'Project', expenses: 'Transaction', tasks: 'Task', notes: 'Note', accounts: 'Account', categories: 'Category', budgets: 'Budget', goals: 'Financial goal' }[resource] || 'Item'
}

function pageDescription(section) {
  return {
    projects: 'Track the work you are building, one project at a time.',
    finance: 'A clear view of personal expenses recorded in your workspace.',
    workspace: 'Tasks and notes, kept close to the work.',
    cloud: 'Family memories, shared media, and the private archive for your trusted circle.',
  }[section]
}

function Overview({ data, errors, onNavigate, onCreate, occupation = 'other' }) {
  const profile = OCCUPATION_PROFILES[occupation] || OCCUPATION_PROFILES.other
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const monthKey = todayKey.slice(0, 7)
  const openTasks = data.tasks.filter((task) => task.status !== 'completed')
  const completedTasks = data.tasks.length - openTasks.length
  const overdueTasks = openTasks.filter((task) => task.due_date && String(task.due_date).slice(0, 10) < todayKey)
  const upcomingTasks = [...openTasks].sort((first, second) => {
    const firstDue = first.due_date ? String(first.due_date).slice(0, 10) : '9999-99-99'
    const secondDue = second.due_date ? String(second.due_date).slice(0, 10) : '9999-99-99'
    return firstDue.localeCompare(secondDue)
  }).slice(0, 3)
  const activeProjects = data.projects.filter((project) => project.status === 'active')
  const monthlyExpenses = data.expenses.filter((expense) => expense.transaction_type !== 'income' && expenseDateKey(expense.expense_date).slice(0, 7) === monthKey)
  const monthlyIncome = data.expenses.filter((expense) => expense.transaction_type === 'income' && expenseDateKey(expense.expense_date).slice(0, 7) === monthKey)
  const monthlySpend = monthlyExpenses.reduce((total, expense) => total + amountInCents(expense.amount), 0) / 100
  const monthlyIncomeTotal = monthlyIncome.reduce((total, expense) => total + amountInCents(expense.amount), 0) / 100
  const availableBalance = data.financeAccounts.reduce((total, account) => total + (Number(account.balance) || 0), 0)
  const trackedBudget = data.budgets.reduce((mostUsed, budget) => {
    const amount = Number(budget.amount) || 0
    const spent = Number(budget.spent) || 0
    return !mostUsed || (amount > 0 && spent / amount > (Number(mostUsed.spent) || 0) / (Number(mostUsed.amount) || 1))
      ? budget
      : mostUsed
  }, null)
  const budgetProgress = trackedBudget && Number(trackedBudget.amount)
    ? Math.min(100, (Number(trackedBudget.spent) || 0) / Number(trackedBudget.amount) * 100)
    : 0
  const taskProgress = data.tasks.length ? Math.round(completedTasks / data.tasks.length * 100) : 0
  const stats = [
    { label: 'Active projects', value: errors.projects ? null : activeProjects.length, icon: FolderKanban, delta: errors.projects ? 'Unavailable' : `${data.projects.length} total projects`, color: 'red', target: 'projects' },
    { label: 'Open tasks', value: errors.tasks ? null : openTasks.length, icon: ListTodo, delta: errors.tasks ? 'Unavailable' : `${overdueTasks.length} overdue`, color: 'amber', target: 'workspace' },
    { label: 'Spent this month', value: errors.expenses ? null : currency(monthlySpend), icon: CreditCard, delta: errors.expenses ? 'Unavailable' : `${monthlyExpenses.length} expense records`, color: 'blue', target: 'finance' },
    { label: 'Shared library', value: errors.files ? null : data.files.length, icon: Image, delta: errors.files ? 'Unavailable' : `${data.familyMembers.length} connected members`, color: 'green', target: 'cloud' },
  ]
  const updates = [
    ...data.projects.map((item) => ({ title: item.title, detail: `Project · ${item.status?.replace('_', ' ') || 'updated'}`, date: item.updated_at || item.created_at, icon: FolderKanban })),
    ...data.tasks.map((item) => ({ title: item.title, detail: `Task · ${item.status?.replace('_', ' ') || 'updated'}`, date: item.updated_at || item.created_at, icon: ListTodo })),
    ...data.notes.map((item) => ({ title: item.title, detail: 'Note · saved to workspace', date: item.updated_at || item.created_at, icon: StickyNote })),
    ...data.expenses.map((item) => ({ title: item.title, detail: `${item.transaction_type === 'income' ? 'Income' : 'Expense'} · ${currency(item.amount)}`, date: item.expense_date || item.created_at, icon: CreditCard })),
    ...data.files.map((item) => ({ title: item.original_name || item.filename || 'Shared file', detail: 'Added to shared library', date: item.file_date || item.created_at, icon: Image })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 5)

  return <div className="overview-layout">
    <section className="stats-grid" aria-label="Workspace statistics">{stats.map(({ label, value, icon: Icon, delta, color, target }) => <button className="stat-card" key={label} onClick={() => onNavigate(target)}><div className="stat-top"><span>{label}</span><span className={`stat-icon icon-${color}`}><Icon size={17} /></span></div><strong className="stat-value">{value == null ? '—' : value}</strong><span className="stat-foot">{delta || 'No records yet'}<ArrowUpRight size={13} /></span></button>)}</section>
    {Object.keys(errors).length > 0 && <InlineError message="Some overview details could not be loaded. Sections with unavailable data are marked; other workspace information is still shown." />}
    <div className="overview-focus-grid">
      <section className="focus-card">
        <div className="focus-glow" aria-hidden="true" />
        <div className="focus-card-heading"><span className="focus-icon"><Sparkles size={16} /></span><span className="eyebrow">YOUR NEXT STEPS</span><button className="text-action" onClick={() => onNavigate('workspace')}>All tasks<ArrowRight size={14} /></button></div>
        <div className="focus-title-row"><div><h2>{overdueTasks.length ? 'A few things need attention.' : openTasks.length ? 'Keep your momentum going.' : 'You’re all caught up.'}</h2><p>{errors.tasks ? errors.tasks : overdueTasks.length ? `${overdueTasks.length} ${overdueTasks.length === 1 ? 'task is' : 'tasks are'} past due.` : openTasks.length ? `${openTasks.length} open ${openTasks.length === 1 ? 'task' : 'tasks'} across your workspace.` : 'Add a task whenever something comes up.'}</p></div><button className="focus-add" aria-label="Create a task" onClick={() => onCreate('tasks')}><Plus size={17} /></button></div>
        {upcomingTasks.length ? <div className="focus-task-list">{upcomingTasks.map((task) => {
          const isOverdue = task.due_date && String(task.due_date).slice(0, 10) < todayKey
          return <button className="focus-task" key={task.id} onClick={() => onNavigate('workspace')}><span className={`focus-task-check ${isOverdue ? 'is-overdue' : ''}`}><Check size={12} /></span><strong>{task.title}</strong><span className={isOverdue ? 'focus-task-overdue' : ''}>{task.due_date ? (isOverdue ? 'Overdue' : friendlyDate(task.due_date)) : 'No due date'}</span></button>
        })}</div> : <button className="focus-empty" onClick={() => onCreate('tasks')}><Plus size={14} /> Add your first task</button>}
      </section>
      <section className="progress-card">
        <div className="progress-card-heading"><div><p className="eyebrow">WORKSPACE PULSE</p><h2>A little progress adds up.</h2></div><span className="pulse-icon"><Activity size={17} /></span></div>
        <div className="task-progress-meta"><span>Task completion</span><strong>{errors.tasks ? '—' : `${taskProgress}%`}</strong></div>
        <div className="task-progress-track"><span style={{ width: `${errors.tasks ? 0 : taskProgress}%` }} /></div>
        <div className="pulse-breakdown"><div><CheckCircle2 size={15} /><strong>{errors.tasks ? '—' : completedTasks}</strong><span>completed</span></div><div><Clock3 size={15} /><strong>{errors.tasks ? '—' : openTasks.length}</strong><span>still open</span></div><div><FolderKanban size={15} /><strong>{errors.projects ? '—' : activeProjects.length}</strong><span>in motion</span></div></div>
      </section>
    </div>
    <div className="overview-detail-grid">
      <section className="panel overview-detail-card finance-glance">
        <PanelHeading title="Money at a glance" kicker="FINANCE" action="Open finance" onAction={() => onNavigate('finance')} />
        <div className="finance-glance-total"><span>Available balance</span><strong>{errors.financeAccounts ? 'Unavailable' : currency(availableBalance)}</strong><small>Across {data.financeAccounts.length} {data.financeAccounts.length === 1 ? 'account' : 'accounts'}</small></div>
        <div className="finance-glance-row"><span>This month’s spending</span><strong>{errors.expenses ? 'Unavailable' : currency(monthlySpend)}</strong></div>
        <div className="finance-glance-row"><span>Income recorded</span><strong className="income-value">{errors.expenses ? 'Unavailable' : currency(monthlyIncomeTotal)}</strong></div>
        {data.budgets.length > 0 && <div className="budget-glance"><div className="budget-glance-label"><span>{trackedBudget?.category} · {trackedBudget?.period} budget</span><strong>{errors.budgets ? 'Unavailable' : `${Math.round(budgetProgress)}%`}</strong></div><div className="budget-glance-track"><span style={{ width: `${errors.budgets ? 0 : budgetProgress}%` }} /></div><small>{errors.budgets ? errors.budgets : `${currency(trackedBudget?.spent)} of ${currency(trackedBudget?.amount)} · most-used of ${data.budgets.length}`}</small></div>}
        {data.goals.length > 0 && <div className="goal-glance"><Target size={15} /><span>{data.goals.length} savings {data.goals.length === 1 ? 'goal' : 'goals'}</span><strong>{currency(data.goals.reduce((total, goal) => total + (Number(goal.saved_amount) || 0), 0))} saved</strong></div>}
        {!data.financeAccounts.length && !data.expenses.length && !data.budgets.length && !data.goals.length && <p className="detail-empty">{errors.financeAccounts || errors.expenses || errors.budgets || errors.goals || 'Add an account, transaction, budget, or goal to start your financial overview.'}</p>}
      </section>
      <section className="panel overview-detail-card workspace-glance">
        <PanelHeading title="Your workspace" kicker="NOTES & PLANS" action="Open workspace" onAction={() => onNavigate('workspace')} />
        <div className="resource-count-row"><span className="resource-icon"><StickyNote size={16} /></span><span><strong>{errors.notes ? '—' : data.notes.length} saved notes</strong><small>Ideas and details, all in one place</small></span><ArrowRight size={14} /></div>
        {data.notes.length > 0 ? <div className="note-glance-list">{data.notes.slice(0, 2).map((note) => <div className="note-glance-item" key={note.id}><span>{note.title}</span><time>{friendlyDate(note.updated_at || note.created_at)}</time></div>)}</div> : <p className="detail-empty">{errors.notes || 'Your latest notes will show up here.'}</p>}
        <button className="inline-create" onClick={() => onCreate('notes')}><Plus size={14} /> Write a note</button>
      </section>
      <section className="panel overview-detail-card shared-glance">
        <PanelHeading title="Shared moments" kicker="FAMILY CLOUD" action="Open library" onAction={() => onNavigate('cloud')} />
        <div className="shared-summary"><div className="shared-summary-icon"><Image size={19} /></div><div><strong>{errors.files ? '—' : data.files.length}</strong><span>photos, videos & files</span></div></div>
        <div className="shared-members"><Users size={15} /><span>Connected family</span><strong>{errors.familyMembers ? '—' : data.familyMembers.length}</strong></div>
        <p className="detail-empty">{errors.files || errors.familyMembers || (data.files.length ? 'Your shared library is up to date.' : 'Family photos and videos will appear here when shared.')}</p>
      </section>
    </div>
    <div className="overview-columns">
      <section className="panel projects-panel"><PanelHeading title={profile.projects} kicker="PROJECT TRACKER" action="View all" onAction={() => onNavigate('projects')} /><div className="recent-projects">{data.projects.length ? data.projects.slice(0, 4).map((project) => <div className="recent-project" key={project.id}><span className="project-glyph"><Blocks size={16} /></span><span className="recent-project-copy"><strong>{project.title}</strong><small>{project.description || 'No description provided'}</small></span><StatusBadge status={project.status} /><span className="row-date">{friendlyDate(project.updated_at || project.created_at)}</span></div>) : <EmptyState icon={FolderKanban} title={errors.projects ? 'Projects unavailable' : 'Nothing in progress yet'} detail={errors.projects ? errors.projects : 'Your projects will show up here once you create one.'} action={!errors.projects && { label: profile.projectAction, onClick: () => onCreate('projects') }} />}</div></section>
      <section className="panel activity-panel"><PanelHeading title="Recent activity" kicker="ACROSS YOUR WORKSPACE" /><div className="activity-list">{updates.length ? updates.map((update, index) => <div className="activity-item" key={`${update.title}-${index}`}><span className="activity-icon"><update.icon size={15} /></span><div><strong>{update.title}</strong><span>{update.detail}</span></div><time>{friendlyDate(update.date)}</time></div>) : <EmptyState icon={Activity} title="Quiet for now" detail="Recent project, task, note, finance, and library activity will appear here." />}</div></section>
    </div>
    <div className="overview-bottom">
      <section className="panel quick-panel"><PanelHeading title="Quick actions" kicker="GET MOVING" /><div className="quick-actions"><QuickAction icon={FolderKanban} label={profile.projectAction} hint="Start something new" onClick={() => onCreate('projects')} /><QuickAction icon={CreditCard} label="Add expense" hint="Record a purchase" onClick={() => onCreate('expenses')} /><QuickAction icon={ListTodo} label={profile.taskAction} hint={profile.taskHint} onClick={() => onCreate('tasks')} /><QuickAction icon={FileText} label="Write a note" hint="Save a thought" onClick={() => onCreate('notes')} /></div></section>
      <section className="terminal-panel"><div className="terminal-head"><span><Terminal size={14} /> WORKSPACE SNAPSHOT</span><span className="terminal-live"><i /> {Object.keys(errors).length ? 'PARTIAL' : 'IN SYNC'}</span></div><div className="terminal-body"><p><span>01</span><b>projects.active</b><em>{errors.projects ? 'unavailable' : `${activeProjects.length} records`}</em></p><p><span>02</span><b>workspace.notes</b><em>{errors.notes ? 'unavailable' : `${data.notes.length} records`}</em></p><p><span>03</span><b>finance.accounts</b><em>{errors.financeAccounts ? 'unavailable' : `${data.financeAccounts.length} records`}</em></p><p><span>04</span><b>cloud.shared_files</b><em>{errors.files ? 'unavailable' : `${data.files.length} records`}</em></p></div></section>
    </div>
  </div>
}

function PanelHeading({ title, kicker, action, onAction }) {
  return <div className="panel-heading"><div><p className="eyebrow">{kicker}</p><h2>{title}</h2></div>{action && <button className="text-action" onClick={onAction}>{action}<ArrowRight size={14} /></button>}</div>
}

function QuickAction({ icon: Icon, label, hint, onClick }) {
  return <button className="quick-action" onClick={onClick}><span className="quick-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{hint}</small></span><ArrowRight size={14} className="quick-arrow" /></button>
}

function StatusBadge({ status = 'active' }) {
  const label = status.replaceAll('_', ' ')
  return <span className={`status-badge status-${status}`}>{label}</span>
}

function ProjectsPage({ projects, error, onCreate, onEdit, onDelete }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('grid')
  const filtered = projects.filter((project) => (filter === 'all' || project.status === filter) && `${project.title} ${project.description || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <div className="toolbar"><label className="search-box"><Search size={16} /><input aria-label="Search projects" placeholder="Search projects..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label><label className="select-wrap"><span className="sr-only">Filter projects by status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select><ChevronDown size={14} /></label><div className="view-toggle"><button aria-label="Grid view" className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Blocks size={16} /></button><button aria-label="List view" className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><ListTodo size={16} /></button></div></div>
    {error && <InlineError message={error} />}
    {filtered.length ? <div className={`project-grid ${view === 'list' ? 'project-list' : ''}`}>{filtered.map((project) => <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-card-icon"><Blocks size={18} /></span><div className="card-menu"><button className="icon-button" aria-label={`Edit ${project.title}`} title="Edit project" onClick={() => onEdit(project)}><Settings2 size={16} /></button><button className="icon-button danger-hover" aria-label={`Delete ${project.title}`} title="Delete project" onClick={() => onDelete(project)}><X size={16} /></button></div></div><h3>{project.title}</h3><p className="project-description">{project.description || 'No description provided.'}</p><div className="project-card-footer"><StatusBadge status={project.status} /><span>{friendlyDate(project.updated_at || project.created_at)}</span></div></article>)}</div> : <EmptyState icon={FolderKanban} title={error ? 'Projects could not be loaded' : query || filter !== 'all' ? 'No matching projects' : 'No projects yet'} detail={error || (query || filter !== 'all' ? 'Try a different search or status filter.' : 'Create a project to start organizing your work.')} action={!error && !query && filter === 'all' ? { label: 'Create project', onClick: onCreate } : undefined} />}
  </>
}

function DonutChart({ slices, total, totalLabel, description }) {
  return <div className="category-donut-wrap"><svg className="category-donut" viewBox="0 0 200 200" role="img" aria-label={description}><circle className="donut-track" cx="100" cy="100" r="63" />{slices.length === 1 ? <circle cx="100" cy="100" r="63" fill="none" stroke={slices[0].color} strokeWidth="30"><title>{`${slices[0].name}: ${currency(slices[0].total)}`}</title></circle> : slices.map((slice) => <path key={slice.name} d={donutSlicePath(slice.startAngle, slice.endAngle)} fill={slice.color} stroke="#111318" strokeWidth="2"><title>{`${slice.name}: ${currency(slice.total)} (${slice.percentage.toFixed(1)}%)`}</title></path>)}</svg><div className="category-donut-total"><strong>{currency(total)}</strong><span>{totalLabel}</span></div></div>
}

function PieLegend({ slices }) {
  return <div className="category-pie-legend">{slices.map((slice) => <div className="category-pie-item" key={slice.name}><span className="category-pie-label"><i style={{ backgroundColor: slice.color }} />{slice.name}</span><strong>{slice.percentage.toFixed(1)}%</strong><small>{currency(slice.total)}</small></div>)}</div>
}

function FinancePage({ expenses, accounts, categories: savedCategories, budgets, goals, error, financeError, onCreate, onEdit, onDelete, onContribute, onNotify }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [dateRange, setDateRange] = useState('all')
  const [exportError, setExportError] = useState('')
  const categories = [...new Set([...savedCategories.map((item) => item.name), ...expenses.map((item) => item.category)].filter(Boolean))].sort()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const filtered = expenses.filter((expense) => {
    const dateKey = expenseDateKey(expense.expense_date)
    const transactionDate = dateKey ? new Date(`${dateKey}T00:00:00`) : null
    const dateMatches = dateRange === 'all' || (transactionDate && transactionDate >= (dateRange === 'month' ? monthStart : thirtyDaysAgo) && transactionDate <= now)
    return dateMatches && (category === 'all' || expense.category === category) && `${expense.title} ${expense.category} ${expense.account_name || ''}`.toLowerCase().includes(query.toLowerCase())
  })
  async function exportTransactions() {
    setExportError('')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Rere Cloud'
      workbook.created = new Date()

      const transactionsSheet = workbook.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] })
      transactionsSheet.columns = [
        { header: 'Date', key: 'date', width: 16 },
        { header: 'Description', key: 'description', width: 32 },
        { header: 'Type', key: 'type', width: 14 },
        { header: 'Category', key: 'category', width: 22 },
        { header: 'Account', key: 'account', width: 22 },
        { header: 'Amount (KES)', key: 'amount', width: 18, style: { numFmt: '#,##0.00;[Red]-#,##0.00' } },
      ]
      transactionsSheet.addRows(filtered.map((expense) => ({
        date: expenseDateKey(expense.expense_date) || '',
        description: expense.title || '',
        type: expense.transaction_type || 'expense',
        category: expense.category || 'Uncategorized',
        account: expense.account_name || 'Unassigned',
        amount: Number(expense.amount) || 0,
      })))
      transactionsSheet.autoFilter = { from: 'A1', to: `F${filtered.length + 1}` }

      const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242730' } } }
      transactionsSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle })

      const income = filtered.filter((expense) => expense.transaction_type === 'income').reduce((sum, expense) => sum + amountInCents(expense.amount), 0) / 100
      const spending = filtered.filter((expense) => expense.transaction_type !== 'income').reduce((sum, expense) => sum + amountInCents(expense.amount), 0) / 100
      const summarySheet = workbook.addWorksheet('Summary')
      summarySheet.columns = [{ header: 'Summary', key: 'label', width: 28 }, { header: 'Value', key: 'value', width: 28 }]
      summarySheet.addRows([
        { label: 'Report generated', value: new Date().toLocaleString('en-KE') },
        { label: 'Date filter', value: dateRange === 'month' ? 'This month' : dateRange === '30days' ? 'Last 30 days' : 'All dates' },
        { label: 'Category filter', value: category === 'all' ? 'All categories' : category },
        { label: 'Search', value: query || 'None' },
        { label: 'Transactions exported', value: filtered.length },
        { label: 'Total income (KES)', value: income },
        { label: 'Total expenses (KES)', value: spending },
        { label: 'Net cash flow (KES)', value: income - spending },
      ])
      summarySheet.getRow(1).eachCell((cell) => { cell.style = headerStyle })
      for (const row of [6, 7, 8]) summarySheet.getCell(`B${row}`).numFmt = '#,##0.00;[Red]-#,##0.00'

      const categoryTotals = new Map()
      for (const expense of filtered) {
        const name = expense.category || 'Uncategorized'
        const totals = categoryTotals.get(name) || { expense: 0, income: 0, count: 0 }
        totals[expense.transaction_type === 'income' ? 'income' : 'expense'] += amountInCents(expense.amount)
        totals.count += 1
        categoryTotals.set(name, totals)
      }
      const categorySheet = workbook.addWorksheet('By category', { views: [{ state: 'frozen', ySplit: 1 }] })
      categorySheet.columns = [
        { header: 'Category', key: 'category', width: 24 },
        { header: 'Expenses (KES)', key: 'expense', width: 20, style: { numFmt: '#,##0.00;[Red]-#,##0.00' } },
        { header: 'Income (KES)', key: 'income', width: 20, style: { numFmt: '#,##0.00;[Red]-#,##0.00' } },
        { header: 'Net (KES)', key: 'net', width: 18, style: { numFmt: '#,##0.00;[Red]-#,##0.00' } },
        { header: 'Transactions', key: 'count', width: 16 },
      ]
      categorySheet.addRows([...categoryTotals].sort(([first], [second]) => first.localeCompare(second)).map(([name, totals]) => ({
        category: name,
        expense: totals.expense / 100,
        income: totals.income / 100,
        net: (totals.income - totals.expense) / 100,
        count: totals.count,
      })))
      categorySheet.autoFilter = { from: 'A1', to: `E${categoryTotals.size + 1}` }
      categorySheet.getRow(1).eachCell((cell) => { cell.style = headerStyle })

      const fileData = await workbook.xlsx.writeBuffer()
      const file = new Blob([fileData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `rere-cloud-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onNotify(`Downloaded ${filtered.length} transactions to Excel.`)
    } catch (error) {
      setExportError(`Could not create the Excel file. ${error.message}`)
    }
  }
  const spendingCents = expenses.filter((item) => item.transaction_type !== 'income').reduce((sum, item) => sum + amountInCents(item.amount), 0)
  const incomeCents = expenses.filter((item) => item.transaction_type === 'income').reduce((sum, item) => sum + amountInCents(item.amount), 0)
  const spendingTotal = spendingCents / 100
  const incomeTotal = incomeCents / 100
  const totalBalance = accounts.reduce((sum, account) => sum + (Number(account.balance) || 0), 0)
  const categoryCents = new Map()
  expenses.forEach((item) => {
    if (item.transaction_type === 'income') return
    const name = item.category || 'Uncategorized'
    categoryCents.set(name, (categoryCents.get(name) || 0) + amountInCents(item.amount))
  })
  const categoryTotals = [...categoryCents].map(([name, cents]) => ({ name, cents, total: cents / 100 }))
    .filter((item) => item.cents > 0)
    .sort((first, second) => second.cents - first.cents)
  const pieColors = ['#df5964', '#d19d58', '#6da8d1', '#6cb88a', '#a18ad1', '#d784b1']
  const pieCategories = categoryTotals.length > 6
    ? [...categoryTotals.slice(0, 5), { name: 'Other', cents: categoryTotals.slice(5).reduce((sum, item) => sum + item.cents, 0) }]
    : categoryTotals
  const pieSlices = buildDonutSlices(pieCategories, spendingCents, pieColors)
  const cashFlowCents = spendingCents + incomeCents
  const cashFlowSlices = buildDonutSlices([
    { name: 'Spending', cents: spendingCents, total: spendingTotal },
    { name: 'Income', cents: incomeCents, total: incomeTotal },
  ].filter((item) => item.cents > 0), cashFlowCents, ['#df5964', '#6cb88a'])
  const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    const monthly = expenses.filter((item) => expenseDateKey(item.expense_date).slice(0, 7) === key)
    return {
      label: new Intl.DateTimeFormat('en-KE', { month: 'short' }).format(month),
      spent: monthly.filter((item) => item.transaction_type !== 'income').reduce((sum, item) => sum + amountInCents(item.amount), 0) / 100,
      income: monthly.filter((item) => item.transaction_type === 'income').reduce((sum, item) => sum + amountInCents(item.amount), 0) / 100,
    }
  })
  const maxMonth = Math.max(1, ...monthlyTrend.flatMap((month) => [month.spent, month.income]))
  const incomeLinePoints = monthlyTrend.map((month, index) => `${index * 100 + 50},${94 - month.income / maxMonth * 84}`).join(' ')
  const chartKey = monthlyTrend.map((month) => `${month.spent}-${month.income}`).join(':')
  const dailyTrend = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13 + index)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const cents = expenses.filter((item) => item.transaction_type !== 'income' && expenseDateKey(item.expense_date) === key).reduce((sum, item) => sum + amountInCents(item.amount), 0)
    return { key, label: String(day.getDate()), date: new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(day), spent: cents / 100 }
  })
  const maxDailySpend = Math.max(0.01, ...dailyTrend.map((day) => day.spent))
  const dailySpendingPoints = dailyTrend.map((day, index) => `${index * 100 + 50},${94 - day.spent / maxDailySpend * 84}`).join(' ')
  const dailyChartKey = dailyTrend.map((day) => `${day.key}-${day.spent}`).join(':')
  return <div className="finance-layout">
    {financeError && <InlineError message={financeError} />}
    <div className="finance-actions"><div className="finance-action-group"><button className="button button-primary" onClick={() => onCreate('expenses')}><Plus size={15} />Add transaction</button><button className="button button-quiet" onClick={() => onCreate('accounts')}><Plus size={15} />Add account</button><button className="button button-quiet" onClick={() => onCreate('categories')}><Plus size={15} />Add category</button></div><div className="finance-action-group"><button className="button button-secondary" onClick={() => onCreate('budgets')}><Plus size={15} />New budget</button><button className="button button-secondary" onClick={() => onCreate('goals')}><Plus size={15} />New goal</button></div></div>
    <section className="account-grid" aria-label="Money accounts">
      <article className="account-total"><p className="eyebrow">TOTAL AVAILABLE</p><strong>{currency(totalBalance)}</strong><span>Across {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span></article>
      {accounts.map((account) => <article className="account-card" key={account.id}><div><Wallet size={17} /><button className="icon-button danger-hover" title={`Delete ${account.name}`} aria-label={`Delete ${account.name}`} onClick={() => onDelete('accounts', account)}><X size={15} /></button></div><strong>{account.name}</strong><span>{currency(account.balance)}</span></article>)}
      {!accounts.length && <button className="account-empty" onClick={() => onCreate('accounts')}><Plus size={17} />Add your first account</button>}
    </section>
    <div className="finance-summary"><section className="finance-total"><div><p className="eyebrow">TOTAL SPENDING</p><span className="finance-value">{currency(spendingTotal)}</span><small>{expenses.filter((item) => item.transaction_type !== 'income').length} expenses recorded</small></div><span className="finance-total-icon"><CreditCard size={21} /></span></section><section className="finance-insight"><span className="insight-symbol"><ArrowUpRight size={17} /></span><div><p className="eyebrow">INCOME RECORDED</p><strong>{currency(incomeTotal)}</strong><small>{categories.length} reusable categories</small></div></section></div>
    <div className="finance-chart-grid">
      <section className="panel finance-chart-panel"><PanelHeading title="Cash flow" kicker="LAST SIX MONTHS" /><div className="chart-legend"><span><i className="legend-spending" />Spending</span><span><i className="legend-income" />Income</span></div><div className="month-chart" role="img" aria-label="Monthly spending bars and income trend line for the last six months">{monthlyTrend.map((month, index) => <div className="month-chart-column" key={`${month.label}-${month.spent}-${month.income}`}><div className="month-bars"><span className="month-bar month-bar-spending" title={`Spending ${currency(month.spent)}`} style={{ height: `${month.spent ? Math.max(3, month.spent / maxMonth * 100) : 0}%`, animationDelay: `${index * 65}ms` }} /></div><span>{month.label}</span></div>)}<svg key={chartKey} className="income-line-chart" viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true"><polyline pathLength="1" points={incomeLinePoints} /><g>{monthlyTrend.map((month, index) => <circle key={month.label} cx={index * 100 + 50} cy={94 - month.income / maxMonth * 84} r="3.2"><title>{`${month.label} income: ${currency(month.income)}`}</title></circle>)}</g></svg></div></section>
      <section className="panel finance-chart-panel"><PanelHeading title="Spending by category" kicker="ALL RECORDED" />{pieSlices.length ? <div className="category-pie-layout"><DonutChart slices={pieSlices} total={spendingTotal} totalLabel="Total spending" description={`Spending by category: ${pieSlices.map((slice) => `${slice.name} ${slice.percentage.toFixed(1)} percent`).join(', ')}`} /><PieLegend slices={pieSlices} /></div> : <p className="chart-empty">Category totals appear after expenses are recorded.</p>}</section>
      <section className="panel finance-chart-panel"><PanelHeading title="Income vs spending" kicker="ALL RECORDED" />{cashFlowSlices.length ? <div className="category-pie-layout"><DonutChart slices={cashFlowSlices} total={cashFlowCents / 100} totalLabel="Total recorded" description={`Recorded cash flow: ${cashFlowSlices.map((slice) => `${slice.name} ${slice.percentage.toFixed(1)} percent`).join(', ')}`} /><PieLegend slices={cashFlowSlices} /></div> : <p className="chart-empty">Income and spending appear after transactions are recorded.</p>}</section>
      <section className="panel finance-chart-panel daily-chart-panel"><PanelHeading title="Daily spending" kicker="LAST 14 DAYS" /><div className="chart-legend"><span><i className="legend-daily" />Expenses by day</span><span className="daily-scale">Scale max: {currency(maxDailySpend)}</span></div><div className="month-chart daily-chart" role="img" aria-label="Daily expenses over the last 14 days, scaled independently from income">{dailyTrend.map((day, index) => <div className="month-chart-column" key={`${day.key}-${day.spent}`}><div className="month-bars"><span className="month-bar month-bar-spending" title={`${day.date}: ${currency(day.spent)}`} style={{ height: `${day.spent ? Math.max(2, day.spent / maxDailySpend * 100) : 0}%`, animationDelay: `${index * 35}ms` }} /></div><span title={day.date}>{day.label}</span></div>)}<svg key={dailyChartKey} className="income-line-chart daily-line-chart" viewBox="0 0 1400 100" preserveAspectRatio="none" aria-hidden="true"><polyline pathLength="1" points={dailySpendingPoints} /><g>{dailyTrend.map((day, index) => <circle key={day.key} cx={index * 100 + 50} cy={94 - day.spent / maxDailySpend * 84} r={day.spent ? '3' : '1.5'}><title>{`${day.date}: ${currency(day.spent)}`}</title></circle>)}</g></svg></div></section>
    </div>
    <div className="finance-plan-grid">
      <section className="panel finance-plan-panel"><PanelHeading title="Budgets" kicker="SPENDING LIMITS" action="Add budget" onAction={() => onCreate('budgets')} />{budgets.length ? <div className="finance-plan-list">{budgets.map((budget) => { const spent = Number(budget.spent) || 0; const limit = Number(budget.amount) || 0; const percent = limit ? Math.min(100, spent / limit * 100) : 0; return <article className="budget-row" key={budget.id}><div className="budget-row-top"><div><strong>{budget.category}</strong><small>{budget.period} budget</small></div><button className="icon-button danger-hover" aria-label={`Delete ${budget.category} budget`} title="Delete budget" onClick={() => onDelete('budgets', { ...budget, title: budget.category })}><X size={15} /></button></div><div className="budget-progress"><span className={percent >= 100 ? 'budget-over' : ''} style={{ width: `${percent}%` }} /></div><div className="budget-numbers"><span>{currency(spent)} spent</span><strong>{currency(limit)}</strong></div></article> })}</div> : <EmptyState icon={Activity} title="No budgets yet" detail="Set a category limit to track spending against your plan." action={{ label: 'Create budget', onClick: () => onCreate('budgets') }} />}</section>
      <section className="panel finance-plan-panel"><PanelHeading title="Financial goals" kicker="SAVING JOURNEY" action="Add goal" onAction={() => onCreate('goals')} />{goals.length ? <div className="finance-plan-list">{goals.map((goal) => <GoalProgress key={goal.id} goal={goal} accounts={accounts} onDelete={() => onDelete('goals', { ...goal, title: goal.title })} onContribute={onContribute} />)}</div> : <EmptyState icon={Wallet} title="No goals yet" detail="Create a goal, allocate money, and earn XP as your savings grow." action={{ label: 'Create goal', onClick: () => onCreate('goals') }} />}</section>
    </div>
    <section className="panel finance-panel"><div className="panel-heading finance-list-heading"><div><p className="eyebrow">TRANSACTION LOG</p><h2>Income and expenses</h2></div><div className="finance-filters"><label className="search-box compact-search"><Search size={15} /><input aria-label="Search transactions" placeholder="Search..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-wrap"><span className="sr-only">Filter transactions by date</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="all">All dates</option><option value="month">This month</option><option value="30days">Last 30 days</option></select><ChevronDown size={14} /></label><label className="select-wrap"><span className="sr-only">Filter transactions by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label><button className="button button-secondary export-button" onClick={exportTransactions} disabled={Boolean(error) || !filtered.length} title={error ? 'Transactions are unavailable' : filtered.length ? 'Download the filtered transaction history as an Excel workbook' : 'No transactions match the current filters'}><FileSpreadsheet size={15} />Download Excel</button></div></div>
      {error && <InlineError message={error} />}
      {exportError && <InlineError message={exportError} />}
      {filtered.length ? <div className="expense-table-wrap"><table className="expense-table"><thead><tr><th>DESCRIPTION</th><th>TYPE</th><th>CATEGORY</th><th>ACCOUNT</th><th>DATE</th><th>AMOUNT</th><th aria-label="Actions" /></tr></thead><tbody>{filtered.map((expense) => <tr key={expense.id}><td><span className="expense-title"><span className="expense-mark"><CreditCard size={15} /></span>{expense.title}</span></td><td><span className={`transaction-type transaction-${expense.transaction_type || 'expense'}`}>{expense.transaction_type || 'expense'}</span></td><td><span className="category-tag">{expense.category}</span></td><td>{expense.account_name || 'Unassigned'}</td><td>{friendlyDate(expense.expense_date)}</td><td className={`amount-cell ${expense.transaction_type === 'income' ? 'amount-income' : ''}`}>{expense.transaction_type === 'income' ? '+' : '-'}{currency(expense.amount)}</td><td><div className="row-actions"><button className="icon-button" title="Edit transaction" aria-label={`Edit ${expense.title}`} onClick={() => onEdit(expense)}><Settings2 size={15} /></button><button className="icon-button danger-hover" title="Delete transaction" aria-label={`Delete ${expense.title}`} onClick={() => onDelete('expenses', expense)}><X size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={CreditCard} title={error ? 'Transactions could not be loaded' : query || category !== 'all' || dateRange !== 'all' ? 'No matching transactions' : 'No transactions recorded'} detail={error || (query || category !== 'all' || dateRange !== 'all' ? 'Try another search, category, or date range.' : 'Add income or expenses to start tracking your accounts.')} action={!error && !query && category === 'all' && dateRange === 'all' ? { label: 'Add transaction', onClick: () => onCreate('expenses') } : undefined} />}
    </section>
  </div>
}

function GoalProgress({ goal, accounts, onDelete, onContribute }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [amount, setAmount] = useState('')
  const saved = Number(goal.saved_amount) || 0
  const target = Number(goal.target_amount) || 0
  const progress = target ? Math.min(100, saved / target * 100) : 0
  return <article className="goal-row"><div className="goal-row-top"><div><strong>{goal.title}</strong><small>{goal.target_date ? `Target ${friendlyDate(goal.target_date)}` : 'No target date'}</small></div><button className="icon-button danger-hover" aria-label={`Delete ${goal.title}`} title="Delete goal" onClick={onDelete}><X size={15} /></button></div><div className="goal-progress"><span style={{ width: `${progress}%` }} /></div><div className="goal-numbers"><span>{currency(saved)} of {currency(target)}</span><strong>{Math.floor(Number(goal.xp) || 0)} XP</strong></div><div className="goal-contribute"><label className="select-wrap"><span className="sr-only">Account for contribution to {goal.title}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={!accounts.length}><option value="">Account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></label><input aria-label={`Contribution amount for ${goal.title}`} type="number" min="0.01" step="0.01" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} /><button className="button button-quiet small-button" disabled={!accountId || !amount} onClick={() => { onContribute(goal, accountId, amount); setAmount('') }}>Allocate</button></div></article>
}

function WorkspacePage({ tasks, notes, errors, onCreate, onEdit, onDelete, onRefresh, notify, celebrate }) {
  const [tab, setTab] = useState('tasks')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const filteredTasks = tasks.filter((task) => (filter === 'all' || task.status === filter) && `${task.title} ${task.description || ''}`.toLowerCase().includes(query.toLowerCase()))
  const filteredNotes = notes.filter((note) => `${note.title} ${note.content || ''}`.toLowerCase().includes(query.toLowerCase()))

  async function toggleTask(task) {
    try {
      await api.tasks.update(task.id, { status: task.status === 'completed' ? 'pending' : 'completed' })
      onRefresh()
      if (task.status === 'completed') notify('Task marked as pending.')
      else celebrate('Task completed', 'One more thing off your list.', 'workspace')
    } catch (error) { notify(error.message) }
  }

  return <>
    <div className="workspace-toolbar"><div className="tabs" role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'tab-active' : ''} onClick={() => setTab('tasks')}><ListTodo size={15} />Tasks<span>{tasks.filter((task) => task.status !== 'completed').length}</span></button><button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'tab-active' : ''} onClick={() => setTab('notes')}><FileText size={15} />Notes<span>{notes.length}</span></button></div><div className="workspace-actions"><label className="search-box compact-search"><Search size={15} /><input aria-label={`Search ${tab}`} placeholder={`Search ${tab}...`} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button button-primary" onClick={() => onCreate(tab)}><Plus size={15} />New {tab === 'tasks' ? 'task' : 'note'}</button></div></div>
    {tab === 'tasks' ? <>
      <div className="task-filters"><button className={filter === 'all' ? 'filter-active' : ''} onClick={() => setFilter('all')}>All tasks</button><button className={filter === 'pending' ? 'filter-active' : ''} onClick={() => setFilter('pending')}>Pending</button><button className={filter === 'in_progress' ? 'filter-active' : ''} onClick={() => setFilter('in_progress')}>In progress</button><button className={filter === 'completed' ? 'filter-active' : ''} onClick={() => setFilter('completed')}>Completed</button></div>
      {errors.tasks && <InlineError message={errors.tasks} />}
      {filteredTasks.length ? <div className="task-list">{filteredTasks.map((task) => <article className={`task-row ${task.status === 'completed' ? 'task-complete' : ''}`} key={task.id}><button className={`task-check ${task.status === 'completed' ? 'checked' : ''}`} aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => toggleTask(task)}>{task.status === 'completed' && <Check size={13} />}</button><div className="task-content"><strong>{task.title}</strong><p>{task.description || 'No details added.'}</p></div><StatusBadge status={task.status} /><span className="task-due">{task.due_date ? `Due ${friendlyDate(task.due_date)}` : 'No due date'}</span><div className="row-actions"><button className="icon-button" title="Edit task" aria-label={`Edit ${task.title}`} onClick={() => onEdit('tasks', task)}><Settings2 size={15} /></button><button className="icon-button danger-hover" title="Delete task" aria-label={`Delete ${task.title}`} onClick={() => onDelete('tasks', task)}><X size={15} /></button></div></article>)}</div> : <EmptyState icon={ListTodo} title={errors.tasks ? 'Tasks could not be loaded' : query || filter !== 'all' ? 'No matching tasks' : 'No tasks on your list'} detail={errors.tasks || 'Add a task to keep your next steps in view.'} action={!errors.tasks && !query && filter === 'all' ? { label: 'Create a task', onClick: () => onCreate('tasks') } : undefined} />}
    </> : <>
      {errors.notes && <InlineError message={errors.notes} />}
      {filteredNotes.length ? <div className="notes-grid">{filteredNotes.map((note) => <article className="note-card" key={note.id}><div className="note-top"><span className="note-icon"><FileText size={16} /></span><div className="row-actions"><button className="icon-button" title="Edit note" aria-label={`Edit ${note.title}`} onClick={() => onEdit('notes', note)}><Settings2 size={15} /></button><button className="icon-button danger-hover" title="Delete note" aria-label={`Delete ${note.title}`} onClick={() => onDelete('notes', note)}><X size={15} /></button></div></div><h3>{note.title}</h3><p>{note.content || 'This note is empty.'}</p><time>{friendlyDate(note.updated_at || note.created_at)}</time></article>)}</div> : <EmptyState icon={FileText} title={errors.notes ? 'Notes could not be loaded' : query ? 'No matching notes' : 'No notes saved'} detail={errors.notes || 'Capture an idea or keep useful details close at hand.'} action={!errors.notes && !query ? { label: 'Write a note', onClick: () => onCreate('notes') } : undefined} />}
    </>}
  </>
}

function FamilyCloudPage({ files, error, familyMembers, membersError, onRefresh, notify }) {
  const [category, setCategory] = useState('photo')
  const [view, setView] = useState('gallery')
  const [uploadState, setUploadState] = useState(null)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [familyBusy, setFamilyBusy] = useState('')
  const closePhotoPreview = useCallback(() => setSelectedPhoto(null), [])

  async function createInvite() {
    setFamilyBusy('invite')
    try {
      const result = await api.family.createInvite()
      setInviteCode(result.code)
      notify('Family invite created. It expires in seven days.')
    } catch (requestError) {
      notify(requestError.message)
    } finally {
      setFamilyBusy('')
    }
  }

  async function joinFamily(event) {
    event.preventDefault()
    setFamilyBusy('join')
    try {
      const result = await api.family.join(joinCode.trim())
      setJoinCode('')
      setInviteCode('')
      setView('gallery')
      onRefresh()
      notify(result.message || 'Family archive connected.')
    } catch (requestError) {
      notify(requestError.message)
    } finally {
      setFamilyBusy('')
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode)
      notify('Invite code copied.')
    } catch {
      notify('Copy is unavailable in this browser. Select the invite code to copy it.')
    }
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    let uploadedCount = 0
    try {
      for (const [index, file] of files.entries()) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('category', category)
        setUploadState({ phase: 'uploading', label: 'Upload', name: files.length > 1 ? `${index + 1} of ${files.length} · ${file.name}` : file.name })
        await api.files.upload(formData)
        uploadedCount += 1
      }
      onRefresh()
      notify(files.length > 1 ? `${files.length} photos uploaded to your family cloud.` : 'Uploaded to your family cloud.')
      setUploadState({ phase: 'success', label: 'Upload', name: files.length > 1 ? `${files.length} photos` : files[0].name })
      await new Promise((resolve) => window.setTimeout(resolve, 1050))
    } catch (requestError) {
      if (uploadedCount) onRefresh()
      notify(uploadedCount ? `${uploadedCount} of ${files.length} files uploaded. ${requestError.message}` : requestError.message)
    } finally {
      setUploadState(null)
      event.target.value = ''
    }
  }

  async function handleDelete(file) {
    if (!window.confirm(`Delete "${file.original_name}" from the family cloud?`)) return
    try {
      await api.files.remove(file.id)
      onRefresh()
      notify('File removed from the cloud.')
    } catch (requestError) {
      notify(requestError.message)
    }
  }

  async function handleDownload(file) {
    try {
      const blob = await api.files.download(file.id)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = file.original_name
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
    } catch (requestError) {
      notify(requestError.message)
    }
  }

  const grouped = files.reduce((acc, file) => {
    acc[file.category] = acc[file.category] || []
    acc[file.category].push(file)
    return acc
  }, {})

  const photoFiles = grouped.photo || []
  const videoFiles = grouped.video || []
  const photosByMonth = [...photoFiles]
    .sort((first, second) => String(second.file_date || second.created_at || '').localeCompare(String(first.file_date || first.created_at || '')))
    .reduce((months, file) => {
      const dateValue = file.file_date || file.created_at || ''
      const monthKey = /^\d{4}-\d{2}/.test(dateValue) ? dateValue.slice(0, 7) : 'undated'
      months[monthKey] = months[monthKey] || []
      months[monthKey].push(file)
      return months
    }, {})
  const photoMonthGroups = Object.entries(photosByMonth).sort(([first], [second]) => {
    if (first === 'undated') return 1
    if (second === 'undated') return -1
    return second.localeCompare(first)
  })
  const familyHighlights = [
    { label: 'Photos saved', value: photoFiles.length },
    { label: 'Videos saved', value: videoFiles.length },
    { label: 'Shared family docs', value: (grouped.document || []).length + (grouped.other || []).length },
    { label: 'Family archive', value: 'Private' },
  ]

  return <div className="cloud-layout">
    <section className="panel cloud-upload-panel">
      <div className="panel-heading"><div><p className="eyebrow">PRIVATE FAMILY MEDIA</p><h2>Photos & videos</h2></div></div>
      <div className="cloud-upload-row">
        <label className="select-wrap"><span className="sr-only">File category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="photo">Photos</option><option value="video">Videos</option><option value="document">Documents</option><option value="other">Other</option></select><ChevronDown size={14} /></label>
        <label className="button button-primary cloud-upload-button" htmlFor="family-cloud-upload">
          {uploadState?.phase === 'uploading' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
          {uploadState?.phase === 'uploading' ? 'Uploading...' : 'Upload file'}
        </label>
        <input id="family-cloud-upload" type="file" accept={category === 'photo' ? 'image/*' : 'video/*,.pdf,.doc,.docx,.xlsx,.txt,.csv'} multiple={category === 'photo'} onChange={handleUpload} disabled={Boolean(uploadState)} hidden />
      </div>
      <div className="family-sharing-tools">
        <div className="family-sharing-intro"><strong>Connect family accounts</strong><span>Invite another signed-in account to share this private archive. Both accounts’ family files are kept.</span></div>
        <div className="family-share-actions">
          <button className="button button-quiet" type="button" onClick={createInvite} disabled={Boolean(familyBusy)}>{familyBusy === 'invite' ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{familyBusy === 'invite' ? 'Creating code...' : 'Create invite code'}</button>
          {inviteCode && <div className="family-invite-code"><code>{inviteCode}</code><button className="icon-button" type="button" title="Copy invite code" aria-label="Copy invite code" onClick={copyInvite}><Copy size={15} /></button></div>}
          <form className="family-join-form" onSubmit={joinFamily}><input aria-label="Family invite code" autoComplete="off" maxLength={64} placeholder="Enter invite code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} required /><button className="button button-secondary" type="submit" disabled={Boolean(familyBusy)}>{familyBusy === 'join' ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />}{familyBusy === 'join' ? 'Joining...' : 'Join family'}</button></form>
        </div>
      </div>
      <div className="cloud-stats-row">
        {familyHighlights.map((item) => <div className="cloud-stat" key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
      </div>
      {error && <InlineError message={error} />}
    </section>

    <section className="panel cloud-files-panel">
      <div className="panel-heading"><div><p className="eyebrow">FAMILY HUB</p><h2>Shared memories</h2></div></div>
      <div className="family-tabs" role="tablist" aria-label="Family media sections">
        <button type="button" className={view === 'gallery' ? 'active' : ''} onClick={() => setView('gallery')}>Gallery</button>
        <button type="button" className={view === 'movies' ? 'active' : ''} onClick={() => setView('movies')}>Movies</button>
        <button type="button" className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>Family tree</button>
      </div>

      {view === 'gallery' && <div className="cloud-groups">
        {photoFiles.length ? <div className="cloud-month-list">
          {photoMonthGroups.map(([monthKey, monthFiles]) => (
            <section className="cloud-month" key={monthKey}>
              <div className="cloud-month-heading">
                <h3>{monthKey === 'undated' ? 'Date unavailable' : new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}-01T12:00:00`))}</h3>
                <span>{monthFiles.length} {monthFiles.length === 1 ? 'photo' : 'photos'}</span>
              </div>
              <div className="family-gallery-grid family-photo-grid">
                {monthFiles.map((file) => (
                  <article className="family-card" key={file.id}>
                    <FamilyPhotoPreview file={file} onPreview={() => setSelectedPhoto(file)} />
                    <div className="family-card-body">
                      <strong title={file.original_name}>{file.original_name}</strong>
                      <small>{friendlyDate(file.file_date || file.created_at)}</small>
                      <small>Uploaded by {file.uploader_name || 'Family member'}</small>
                      <div className="row-actions family-actions">
                        <button className="button button-quiet small-button" onClick={() => handleDownload(file)}>Download</button>
                        <button className="icon-button danger-hover" onClick={() => handleDelete(file)} aria-label={`Delete ${file.original_name}`}><X size={15} /></button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div> : <EmptyState icon={Folder} title="No family photos yet" detail="Upload your family photo memories here and they will appear in the gallery." />}
      </div>}

      {view === 'movies' && <div className="cloud-groups">
        {videoFiles.length ? <div className="family-gallery-grid">
          {videoFiles.map((file) => (
            <article className="family-card" key={file.id}>
              <FamilyMoviePreview file={file} />
              <div className="family-card-body">
                <strong>{file.original_name}</strong>
                <small>{friendlyDate(file.file_date || file.created_at)}</small>
                <small>Uploaded by {file.uploader_name || 'Family member'}</small>
                <div className="row-actions family-actions">
                  <button className="button button-quiet small-button" onClick={() => handleDownload(file)}>Download</button>
                  <button className="icon-button danger-hover" onClick={() => handleDelete(file)} aria-label={`Delete ${file.original_name}`}><X size={15} /></button>
                </div>
              </div>
            </article>
          ))}
        </div> : <EmptyState icon={Folder} title="No family movies yet" detail="Add movie nights, family clips, and keepsakes to this private movie vault." />}
      </div>}

      {view === 'tree' && <div className="family-tree-layout">
        {membersError && <InlineError message={membersError} />}
        <div className="family-tree-grid">
          {familyMembers.map((member, index) => {
            const name = `${member.first_name} ${member.last_name}`.trim()
            const tone = ['rose', 'amber', 'blue', 'mint', 'violet', 'gold'][index % 6]
            return <article className={`family-node ${tone}`} key={member.id}>
              <div className="family-node-avatar">{initials(member)}</div>
              <strong>{name}</strong>
              <span className="family-node-role">{member.role}</span>
              <small>@{member.username}</small>
              <time>{member.joined_at ? `Joined ${friendlyDate(member.joined_at)}` : 'Family member'}</time>
            </article>
          })}
        </div>
        <div className="family-tree-summary">
          <h3>{familyMembers.length ? `${familyMembers.length} connected ${familyMembers.length === 1 ? 'member' : 'members'}` : 'Your family network'}</h3>
          <p>{familyMembers.length ? 'These are the accounts currently connected to this private family space. Family relationships can be added separately from account access.' : membersError || 'There are no connected family accounts yet.'}</p>
        </div>
      </div>}
      {selectedPhoto && <FamilyPhotoLightbox key={selectedPhoto.id} file={selectedPhoto} onClose={closePhotoPreview} />}
    </section>
    {uploadState && <UploadStatusOverlay state={uploadState} />}
  </div>
}

function FamilyPhotoPreview({ file, onPreview }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = ''
    api.files.preview(file.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setSrc(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id])

  return <button type="button" className="family-card-art family-art-photo family-photo-open" onClick={onPreview} aria-label={`Preview ${file.original_name}`}>
    {src && <img src={src} alt="" loading="lazy" />}
    <span className="family-card-tag">Photo</span>
    <span className="family-photo-open-hint"><ArrowUpRight size={15} />Preview</span>
    {!src && <span className="family-preview-state">{failed ? 'Preview unavailable' : 'Loading photo...'}</span>}
  </button>
}

function FamilyPhotoLightbox({ file, onClose }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = ''
    api.files.download(file.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setSrc(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return <div className="photo-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="photo-lightbox-panel" role="dialog" aria-modal="true" aria-label={`Photo preview: ${file.original_name}`}>
      <header className="photo-lightbox-head">
        <div><p className="eyebrow">PHOTO PREVIEW</p><h2>{file.original_name}</h2><span>{friendlyDate(file.file_date || file.created_at)}</span></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close photo preview"><X size={18} /></button>
      </header>
      <div className="photo-lightbox-stage">
        {src ? <img src={src} alt={file.original_name} /> : <div className="photo-lightbox-loading"><LoaderCircle className={failed ? '' : 'spin'} size={24} /><span>{failed ? 'Could not load this photo.' : 'Opening photo...'}</span></div>}
      </div>
    </section>
  </div>
}

function UploadStatusOverlay({ state }) {
  const complete = state.phase === 'success'
  const label = state.label || 'Upload'

  return <div className={`upload-veil ${complete ? 'upload-complete' : ''}`} role="status" aria-live="polite">
    <div className="upload-dialog">
      <div className={`upload-mark ${complete ? 'upload-mark-done' : ''}`}>
        {complete ? <Check size={32} strokeWidth={2.5} /> : <LoaderCircle size={30} className="spin" />}
      </div>
      <p className="eyebrow">{complete ? `${label.toUpperCase()} COMPLETE` : `${label.toUpperCase()} IN PROGRESS`}</p>
      <h2>{complete ? `${label} complete` : `${label === 'Save' ? 'Saving' : 'Uploading'} your item`}</h2>
      <p className="upload-file-name">{state.name}</p>
      <div className="upload-progress" aria-hidden="true"><span /></div>
      <small>{complete ? 'Your changes are ready.' : 'Please keep this window open while your changes are saved.'}</small>
    </div>
  </div>
}

function FamilyMoviePreview({ file }) {
  const [src, setSrc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  async function loadMovie() {
    setLoading(true)
    setError('')
    try {
      const blob = await api.files.download(file.id)
      setSrc(URL.createObjectURL(blob))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return <div className="family-card-art family-art-video">
    {src ? <video src={src} controls preload="metadata" aria-label={file.original_name} /> : <>
      <span className="family-card-tag">Movie</span>
      <button className="family-movie-load" onClick={loadMovie} disabled={loading}>{loading ? 'Loading movie...' : error ? 'Try again' : 'Load movie'}</button>
      {error && <span className="family-preview-error">{error}</span>}
    </>}
  </div>
}

function ResourceDialog({ resource, item, categories = [], accounts = [], onClose, onSave }) {
  const categoryOptions = categories.map((category) => category.name)
  const [form, setForm] = useState(() => ({
    ...makeInitialForm(resource, item),
    ...(resource === 'expenses' ? {
      category: item?.category || categoryOptions[0] || 'General',
      account_id: item?.account_id ? accounts.find((account) => account.id === item.account_id)?.name || '' : accounts[0]?.name || '',
      transaction_type: item?.transaction_type || 'expense',
    } : {}),
    ...(!item && resource === 'budgets' ? { category: categoryOptions[0] || 'General', period: 'monthly' } : {}),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const schema = {
    projects: { title: 'Project', fields: [['title', 'Project name'], ['description', 'Description', 'textarea'], ['status', 'Status', 'select', STATUSES]] },
    expenses: { title: 'Transaction', fields: [['transaction_type', 'Type', 'select', ['expense', 'income']], ['title', 'Description'], ['amount', 'Amount (KES)', 'number'], ['category', 'Category', 'select', categoryOptions.length ? categoryOptions : ['General']], ['account_id', 'Account', 'select', accounts.map((account) => account.name)], ['expense_date', 'Date', 'date'] ] },
    tasks: { title: 'Task', fields: [['title', 'Task title'], ['description', 'Description', 'textarea'], ['status', 'Status', 'select', ['pending', 'in_progress', 'completed']], ['due_date', 'Due date', 'date'] ] },
    notes: { title: 'Note', fields: [['title', 'Title'], ['content', 'Note', 'textarea'] ] },
    accounts: { title: 'Account', fields: [['name', 'Account name'], ['balance', 'Starting balance (KES)', 'number']] },
    categories: { title: 'Category', fields: [['name', 'Category name']] },
    budgets: { title: 'Budget', fields: [['category', 'Category', 'select', categoryOptions.length ? categoryOptions : ['General']], ['amount', 'Limit (KES)', 'number'], ['period', 'Period', 'select', ['daily', 'weekly', 'monthly', 'yearly']]] },
    goals: { title: 'Financial goal', fields: [['title', 'Goal name'], ['target_amount', 'Target amount (KES)', 'number'], ['target_date', 'Target date', 'date']] },
  }[resource]

  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    setError('')
    const payload = { ...form }
      if (!item) for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key]
        if (resource === 'expenses') {
          payload.amount = Number(payload.amount)
          payload.account_id = accounts.find((account) => account.name === payload.account_id)?.id
        }
        if (resource === 'accounts' || resource === 'budgets') payload.amount = Number(payload.amount)
        if (resource === 'goals') payload.target_amount = Number(payload.target_amount)
      /*
      <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-head"><div><p className="eyebrow">{item ? 'UPDATE RECORD' : 'NEW RECORD'}</p><h2 id="modal-title">{item ? `Edit ${schema.title.toLowerCase()}` : `Create ${schema.title.toLowerCase()}`}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><form onSubmit={submit}><div className="modal-fields">{schema.fields.map(([name, label, type = 'text', options]) => <label className={`field ${type === 'textarea' ? 'field-wide' : ''}`} key={name}><span>{label}</span>{type === 'textarea' ? <textarea name={name} rows={name === 'content' ? 7 : 4} maxLength={name === 'content' ? 20000 : 5000} value={form[name] || ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} /> : type === 'account' ? <select name={name} required value={form[name] || ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}><option value="">{accounts.length ? 'Choose account' : 'Create an account first'}</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {currency(account.balance)}</option>)}</select> : type === 'select' ? <select name={name} required value={form[name] || options[0]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}>{options.map((option) => <option value={option} key={option}>{option.replaceAll('_', ' ')}</option>)}</select> : <input name={name} type={type} required={!['description', 'content', 'due_date', 'target_date'].includes(name)} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '0.01' : undefined} maxLength={['title', 'name'].includes(name) ? 200 : undefined} value={form[name] || ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />}</label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}{resource === 'expenses' && !accounts.length && <p className="form-error" role="status">Create an account before recording a transaction.</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || (resource === 'expenses' && !accounts.length)}>{busy && <LoaderCircle size={15} className="spin" />}{busy ? 'Saving...' : item ? 'Save changes' : `Create ${schema.title.toLowerCase()}`}</button></div></form></section></div>
      */
    setBusy(true)
    try { await onSave(resource, payload, item) }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-head"><div><p className="eyebrow">{item ? 'UPDATE RECORD' : 'NEW RECORD'}</p><h2 id="modal-title">{item ? `Edit ${schema.title.toLowerCase()}` : `Create ${schema.title.toLowerCase()}`}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><form onSubmit={submit}><div className="modal-fields">{schema.fields.map(([name, label, type = 'text', options]) => <label className={`field ${type === 'textarea' ? 'field-wide' : ''}`} key={name}><span>{label}</span>{type === 'textarea' ? <textarea name={name} rows={name === 'content' ? 7 : 4} maxLength={name === 'content' ? 20000 : 5000} value={form[name] || ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} /> : type === 'select' ? <select name={name} value={form[name] || options[0]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}>{options.map((option) => <option value={option} key={option}>{option.replaceAll('_', ' ')}</option>)}</select> : <input name={name} type={type} required={name === 'title'} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '0.01' : undefined} maxLength={name === 'title' ? 200 : undefined} value={form[name] || ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />}</label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy && <LoaderCircle size={15} className="spin" />}{busy ? 'Saving...' : item ? 'Save changes' : `Create ${schema.title.toLowerCase()}`}</button></div></form></section></div>
}

function makeInitialForm(resource, item) {
  if (item) return { ...item, amount: item.amount == null ? '' : String(item.amount), expense_date: String(item.expense_date || '').slice(0, 10), due_date: String(item.due_date || '').slice(0, 10) }
  const today = new Date().toISOString().slice(0, 10)
  if (resource === 'projects') return { status: 'active' }
  if (resource === 'tasks') return { status: 'pending' }
  if (resource === 'expenses') return { expense_date: today }
  return {}
}

function EmptyState({ icon: Icon, title, detail, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={19} /></span><h3>{title}</h3><p>{detail}</p>{action && <button className="button button-secondary" onClick={action.onClick}><Plus size={15} />{action.label}</button>}</div>
}

function InlineError({ message }) {
  return <div className="inline-error" role="alert"><CircleHelp size={16} /><span>{message}</span></div>
}

function DashboardSkeleton() {
  return <div className="skeleton-content" aria-label="Loading dashboard"><div className="stats-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton stat-skeleton" key={item} />)}</div><div className="skeleton large-skeleton" /><div className="skeleton medium-skeleton" /></div>
}

export default App