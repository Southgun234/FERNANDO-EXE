import { useCallback, useEffect, useState } from 'react'
import {
  Activity, ArrowRight, ArrowUpRight, Bell, Blocks, BriefcaseBusiness,
  Check, ChevronDown, CircleHelp, CreditCard, FileText, Folder, FolderKanban,
  LayoutDashboard, ListTodo, LoaderCircle, LogOut, Menu, MoreHorizontal, Plus, Search,
  Settings2, ShieldCheck, Terminal, Upload, Wallet, X,
} from 'lucide-react'
import { api, clearToken, getLastActivity, getToken, IDLE_TIMEOUT_MS, saveToken, touchSession } from './services/api'
import './App.css'

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', group: 'CORE', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', group: 'MANAGE', icon: FolderKanban },
  { id: 'finance', label: 'Finance', group: 'MANAGE', icon: Wallet },
  { id: 'workspace', label: 'Workspace', group: 'PERSONAL', icon: Blocks },
  { id: 'cloud', label: 'Family Cloud', group: 'PERSONAL', icon: Folder },
]

const EMPTY_DATA = { projects: [], expenses: [], tasks: [], notes: [], files: [], familyMembers: [], stats: null }
const STATUSES = ['active', 'completed', 'on_hold', 'archived']

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
    setAuthError(message)
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
  if (!token || !user) return <AuthScreen health={health} healthError={healthError} initialError={authError} onSignedIn={handleSignedIn} />
  return <Dashboard user={user} health={health} healthError={healthError} initialSuccess={welcome} onLogout={logout} />
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
  const [form, setForm] = useState({ first_name: '', last_name: '', username: '', email: '', phone: '+254', password: '' })
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
      if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim() || !form.phone.trim()) return setError('Complete every field to create your account.')
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

function Field({ label, name, type = 'text', value, onChange, autoComplete, required = true, placeholder }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} required={required} /></label>
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

function Dashboard({ user, health, healthError, initialSuccess, onLogout }) {
  const [section, setSection] = useState('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [data, setData] = useState(EMPTY_DATA)
  const [loadState, setLoadState] = useState('loading')
  const [loadErrors, setLoadErrors] = useState({})
  const [dialog, setDialog] = useState(null)
  const [toast, setToast] = useState('')
  const [success, setSuccess] = useState(initialSuccess)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    const entries = [
      ['stats', api.stats()], ['projects', api.projects.list()], ['expenses', api.expenses.list()],
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
    const service = api[resource]
    if (item) await service.update(item.id, value)
    else await service.create(value)
    setDialog(null)
    refresh()
    celebrate(`${resourceLabel(resource)} ${item ? 'updated' : 'created'}`, 'Saved to your private workspace.', resource === 'notes' || resource === 'tasks' ? 'workspace' : resource)
  }

  async function deleteResource(resource, item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    try {
      await api[resource].remove(item.id)
      refresh()
      celebrate(`${resourceLabel(resource)} deleted`, 'Your workspace is up to date.', resource === 'notes' || resource === 'tasks' ? 'workspace' : resource)
    } catch (error) { notify(error.message) }
  }

  const pageTitle = NAV_ITEMS.find((item) => item.id === section)?.label || 'Overview'
  const todayLabel = new Intl.DateTimeFormat('en-KE', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()).toUpperCase()
  const openCreate = (resource) => setDialog({ resource, item: null })
  const openEdit = (resource, item) => setDialog({ resource, item })
  const selectSection = (value) => { setSection(value); setMobileNav(false) }

  return <div className="app-shell" data-section={section}>
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
        <div className="profile-row"><div className="avatar">{initials(user)}</div><div className="profile-copy"><strong>{user.first_name} {user.last_name}</strong><span>@{user.username}</span></div><button className="icon-button logout-button" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></button></div>
      </div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>RERE CLOUD</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div></div>
        <div className="topbar-right"><HealthPill health={health} detail={healthError} /><span className="topbar-divider" /><button className="icon-button notification-button" aria-label="Notifications" title="Notifications" onClick={() => notify('No new notifications.')}><Bell size={17} /></button><div className="topbar-avatar" title={`${user.first_name} ${user.last_name}`}>{initials(user)}</div></div>
      </header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">{section === 'overview' ? `${todayLabel} / YOUR WORKSPACE` : `PERSONAL / ${pageTitle.toUpperCase()}`}</p><h1>{section === 'overview' ? `Good to have you here, ${user.first_name}.` : pageTitle}</h1><p className="page-subtitle">{section === 'overview' ? 'Here’s what’s happening across your workspace.' : pageDescription(section)}</p></div><button className="button button-primary heading-action" onClick={() => openCreate(section === 'finance' ? 'expenses' : section === 'workspace' ? 'tasks' : 'projects')}><Plus size={16} />{section === 'finance' ? 'Add expense' : section === 'workspace' ? 'New task' : 'New project'}</button></div>
        {(health === 'offline' || health === 'degraded') && <div className="api-warning dashboard-warning" role="status"><strong>API connection issue</strong><span>{healthError || 'The health check did not report a healthy service.'}</span><small>If this is a CORS error, set Flask <code>FRONTEND_ORIGIN</code> to this frontend’s origin and restart Flask.</small></div>}
        {loadState === 'loading' ? <DashboardSkeleton /> : <>
          {section === 'overview' && <Overview data={data} errors={loadErrors} onNavigate={selectSection} onCreate={openCreate} />}
          {section === 'projects' && <ProjectsPage projects={data.projects} error={loadErrors.projects} onCreate={() => openCreate('projects')} onEdit={(item) => openEdit('projects', item)} onDelete={(item) => deleteResource('projects', item)} />}
          {section === 'finance' && <FinancePage expenses={data.expenses} error={loadErrors.expenses} onCreate={() => openCreate('expenses')} onEdit={(item) => openEdit('expenses', item)} onDelete={(item) => deleteResource('expenses', item)} />}
          {section === 'workspace' && <WorkspacePage tasks={data.tasks} notes={data.notes} errors={loadErrors} onCreate={openCreate} onEdit={openEdit} onDelete={deleteResource} onRefresh={refresh} notify={notify} celebrate={celebrate} />}
          {section === 'cloud' && <FamilyCloudPage files={data.files} error={loadErrors.files} familyMembers={data.familyMembers} membersError={loadErrors.familyMembers} onRefresh={refresh} notify={notify} />}
        </>}
      </div>
      <footer className="main-footer"><span><span className="footer-pip" /> ALL SYSTEMS OPERATIONAL</span><span>RERE CLOUD <b>·</b> BUILT FOR FOCUS</span></footer>
    </main>
    {dialog && <ResourceDialog resource={dialog.resource} item={dialog.item} onClose={() => setDialog(null)} onSave={saveResource} />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {success && <SuccessOverlay title={success.title} message={success.message} tone={success.tone} onDone={() => setSuccess(null)} />}
  </div>
}

function resourceLabel(resource) {
  return { projects: 'Project', expenses: 'Expense', tasks: 'Task', notes: 'Note' }[resource] || 'Item'
}

function pageDescription(section) {
  return {
    projects: 'Track the work you are building, one project at a time.',
    finance: 'A clear view of personal expenses recorded in your workspace.',
    workspace: 'Tasks and notes, kept close to the work.',
    cloud: 'Family memories, shared media, and the private archive for your trusted circle.',
  }[section]
}

function Overview({ data, errors, onNavigate, onCreate }) {
  const projectStats = data.stats?.projects
  const taskStats = data.stats?.tasks
  const expenseStats = data.stats?.expenses
  const stats = [
    { label: 'Total projects', value: projectStats?.total, icon: BriefcaseBusiness, delta: projectStats ? `${projectStats.completed ?? 0} completed` : null, color: 'red', target: 'projects' },
    { label: 'Active projects', value: errors.projects ? null : data.projects.filter((project) => project.status === 'active').length, icon: Activity, delta: errors.projects ? 'Unavailable' : projectStats ? `${Math.max(0, (projectStats.total || 0) - (projectStats.completed || 0))} in progress` : null, color: 'green', target: 'projects' },
    { label: 'Open tasks', value: taskStats ? (taskStats.total || 0) - (taskStats.completed || 0) : null, icon: ListTodo, delta: taskStats ? `${taskStats.pending ?? 0} pending` : null, color: 'amber', target: 'workspace' },
    { label: 'Recorded expenses', value: expenseStats?.total_amount != null ? currency(expenseStats.total_amount) : null, icon: CreditCard, delta: expenseStats ? `${expenseStats.total ?? 0} entries` : null, color: 'blue', target: 'finance' },
  ]
  const updates = [
    ...data.projects.slice(0, 2).map((item) => ({ title: item.title, detail: `Project ${item.status?.replace('_', ' ') || 'updated'}`, date: item.updated_at || item.created_at, icon: FolderKanban })),
    ...data.tasks.slice(0, 2).map((item) => ({ title: item.title, detail: `Task ${item.status?.replace('_', ' ') || 'updated'}`, date: item.updated_at || item.created_at, icon: ListTodo })),
    ...data.notes.slice(0, 1).map((item) => ({ title: item.title, detail: 'Note updated', date: item.updated_at || item.created_at, icon: FileText })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 4)

  return <div className="overview-layout">
    <section className="stats-grid" aria-label="Workspace statistics">{stats.map(({ label, value, icon: Icon, delta, color, target }) => <button className="stat-card" key={label} onClick={() => onNavigate(target)}><div className="stat-top"><span>{label}</span><span className={`stat-icon icon-${color}`}><Icon size={17} /></span></div><strong className="stat-value">{value == null ? '—' : value}</strong><span className="stat-foot">{delta || (errors.stats ? 'Stats unavailable' : 'No records yet')}<ArrowUpRight size={13} /></span></button>)}</section>
    {(errors.stats || errors.projects || errors.tasks || errors.expenses) && <InlineError message="Some dashboard data could not be loaded. Check your API connection or sign in again." />}
    <div className="overview-columns">
      <section className="panel projects-panel"><PanelHeading title="Recent projects" kicker="YOUR WORK" action="View all" onAction={() => onNavigate('projects')} /><div className="recent-projects">{data.projects.length ? data.projects.slice(0, 4).map((project) => <div className="recent-project" key={project.id}><span className="project-glyph"><Blocks size={16} /></span><span className="recent-project-copy"><strong>{project.title}</strong><small>{project.description || 'No description provided'}</small></span><StatusBadge status={project.status} /><span className="row-date">{friendlyDate(project.updated_at || project.created_at)}</span></div>) : <EmptyState icon={FolderKanban} title={errors.projects ? 'Projects unavailable' : 'Nothing in progress yet'} detail={errors.projects ? errors.projects : 'Your projects will show up here once you create one.'} action={!errors.projects && { label: 'Create a project', onClick: () => onCreate('projects') }} />}</div></section>
      <section className="panel activity-panel"><PanelHeading title="Recent activity" kicker="LATEST UPDATES" /><div className="activity-list">{updates.length ? updates.map((update, index) => <div className="activity-item" key={`${update.title}-${index}`}><span className="activity-icon"><update.icon size={15} /></span><div><strong>{update.title}</strong><span>{update.detail}</span></div><time>{friendlyDate(update.date)}</time></div>) : <EmptyState icon={Activity} title={errors.projects || errors.tasks ? 'Activity unavailable' : 'Quiet for now'} detail="Recent project, task, and note updates will appear here." />}</div></section>
    </div>
    <div className="overview-bottom">
      <section className="panel quick-panel"><PanelHeading title="Quick actions" kicker="GET MOVING" /><div className="quick-actions"><QuickAction icon={FolderKanban} label="New project" hint="Start something new" onClick={() => onCreate('projects')} /><QuickAction icon={CreditCard} label="Add expense" hint="Record a purchase" onClick={() => onCreate('expenses')} /><QuickAction icon={ListTodo} label="Create task" hint="Capture a next step" onClick={() => onCreate('tasks')} /><QuickAction icon={FileText} label="Write a note" hint="Save a thought" onClick={() => onCreate('notes')} /></div></section>
      <section className="terminal-panel"><div className="terminal-head"><span><Terminal size={14} /> SYSTEM SNAPSHOT</span><span className="terminal-live"><i /> LIVE</span></div><div className="terminal-body"><p><span>01</span><b>api.status</b><em>{errors.stats ? 'partial' : 'operational'}</em></p><p><span>02</span><b>workspace.projects</b><em>{data.stats?.projects?.total ?? '—'} records</em></p><p><span>03</span><b>workspace.notes</b><em>{data.stats?.notes?.total ?? '—'} records</em></p><p className="terminal-prompt"><span>›</span> ready<span className="cursor-block" /></p></div></section>
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

function FinancePage({ expenses, error, onCreate, onEdit, onDelete }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [dateRange, setDateRange] = useState('all')
  const categories = [...new Set(expenses.map((expense) => expense.category).filter(Boolean))].sort()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const filtered = expenses.filter((expense) => {
    const expenseDate = expense.expense_date ? new Date(`${String(expense.expense_date).slice(0, 10)}T00:00:00`) : null
    const dateMatches = dateRange === 'all' || (expenseDate && expenseDate >= (dateRange === 'month' ? monthStart : thirtyDaysAgo) && expenseDate <= now)
    return dateMatches && (category === 'all' || expense.category === category) && `${expense.title} ${expense.category}`.toLowerCase().includes(query.toLowerCase())
  })
  const total = expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
  const categoryTotals = categories.map((name) => ({ name, total: expenses.filter((expense) => expense.category === name).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0) })).sort((a, b) => b.total - a.total)
  const maxCategory = Math.max(1, ...categoryTotals.map((item) => item.total))
  return <>
    <div className="finance-summary"><section className="finance-total"><div><p className="eyebrow">TOTAL RECORDED</p><span className="finance-value">{currency(total)}</span><small>Across {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</small></div><span className="finance-total-icon"><Wallet size={21} /></span></section><section className="finance-insight"><span className="insight-symbol"><Activity size={17} /></span><div><p className="eyebrow">SPENDING SNAPSHOT</p><strong>{categoryTotals.length ? `${categoryTotals.length} categories tracked` : 'No categories yet'}</strong><small>{categoryTotals.length ? `Top category: ${categoryTotals[0].name}` : 'Category summaries appear as you record expenses.'}</small></div></section></div>
    <section className="panel finance-panel"><div className="panel-heading finance-list-heading"><div><p className="eyebrow">TRANSACTION LOG</p><h2>Recent expenses</h2></div><div className="finance-filters"><label className="search-box compact-search"><Search size={15} /><input aria-label="Search expenses" placeholder="Search..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-wrap"><span className="sr-only">Filter expenses by date</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="all">All dates</option><option value="month">This month</option><option value="30days">Last 30 days</option></select><ChevronDown size={14} /></label><label className="select-wrap"><span className="sr-only">Filter expenses by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label></div></div>
      {error && <InlineError message={error} />}
      {filtered.length ? <div className="expense-table-wrap"><table className="expense-table"><thead><tr><th>DESCRIPTION</th><th>CATEGORY</th><th>DATE</th><th>AMOUNT</th><th aria-label="Actions" /></tr></thead><tbody>{filtered.map((expense) => <tr key={expense.id}><td><span className="expense-title"><span className="expense-mark"><CreditCard size={15} /></span>{expense.title}</span></td><td><span className="category-tag">{expense.category}</span></td><td>{friendlyDate(expense.expense_date)}</td><td className="amount-cell">{currency(expense.amount)}</td><td><div className="row-actions"><button className="icon-button" title="Edit expense" aria-label={`Edit ${expense.title}`} onClick={() => onEdit(expense)}><Settings2 size={15} /></button><button className="icon-button danger-hover" title="Delete expense" aria-label={`Delete ${expense.title}`} onClick={() => onDelete(expense)}><X size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={CreditCard} title={error ? 'Expenses could not be loaded' : query || category !== 'all' || dateRange !== 'all' ? 'No matching expenses' : 'No expenses recorded'} detail={error || (query || category !== 'all' || dateRange !== 'all' ? 'Try another search, category, or date range.' : 'Your expense history will appear here after you add your first entry.')} action={!error && !query && category === 'all' && dateRange === 'all' ? { label: 'Add an expense', onClick: onCreate } : undefined} />}
    </section>
    {categoryTotals.length > 0 && <section className="panel category-panel"><PanelHeading title="By category" kicker="SPENDING MIX" /><div className="category-breakdown">{categoryTotals.map(({ name, total: amount }, index) => <div className="category-row" key={name}><div className="category-row-top"><span>{name}</span><strong>{currency(amount)}</strong></div><div className="category-track"><span style={{ width: `${Math.max(2, amount / maxCategory * 100)}%` }} className={`category-fill category-fill-${index % 4}`} /></div></div>)}</div></section>}
  </>
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
  const closePhotoPreview = useCallback(() => setSelectedPhoto(null), [])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('category', category)
    setUploadState({ phase: 'uploading', name: file.name })
    try {
      await api.files.upload(formData)
      onRefresh()
      notify('Uploaded to your family cloud.')
      setUploadState({ phase: 'success', name: file.name })
      await new Promise((resolve) => window.setTimeout(resolve, 1050))
    } catch (requestError) {
      notify(requestError.message)
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
      <div className="panel-heading"><div><p className="eyebrow">PRIVATE ARCHIVE</p><h2>Family cloud</h2></div></div>
      <div className="cloud-upload-row">
        <label className="select-wrap"><span className="sr-only">File category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="photo">Photos</option><option value="video">Videos</option><option value="document">Documents</option><option value="other">Other</option></select><ChevronDown size={14} /></label>
        <label className="button button-primary cloud-upload-button" htmlFor="family-cloud-upload">
          {uploadState?.phase === 'uploading' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
          {uploadState?.phase === 'uploading' ? 'Uploading...' : 'Upload file'}
        </label>
        <input id="family-cloud-upload" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xlsx,.txt,.csv" onChange={handleUpload} disabled={Boolean(uploadState)} hidden />
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
              <div className="family-gallery-grid">
                {monthFiles.map((file) => (
                  <article className="family-card" key={file.id}>
                    <FamilyPhotoPreview file={file} onPreview={() => setSelectedPhoto(file)} />
                    <div className="family-card-body">
                      <strong title={file.original_name}>{file.original_name}</strong>
                      <small>{friendlyDate(file.file_date || file.created_at)}</small>
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

  return <div className={`upload-veil ${complete ? 'upload-complete' : ''}`} role="status" aria-live="polite">
    <div className="upload-dialog">
      <div className={`upload-mark ${complete ? 'upload-mark-done' : ''}`}>
        {complete ? <Check size={32} strokeWidth={2.5} /> : <LoaderCircle size={30} className="spin" />}
      </div>
      <p className="eyebrow">{complete ? 'SAVED TO FAMILY CLOUD' : 'SECURE TRANSFER'}</p>
      <h2>{complete ? 'Upload complete' : 'Uploading your file'}</h2>
      <p className="upload-file-name">{state.name}</p>
      <div className="upload-progress" aria-hidden="true"><span /></div>
      <small>{complete ? 'Your memory is ready to preview.' : 'Keeping this window open while your file is saved.'}</small>
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

function ResourceDialog({ resource, item, onClose, onSave }) {
  const [form, setForm] = useState(() => makeInitialForm(resource, item))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const schema = {
    projects: { title: 'Project', fields: [['title', 'Project name'], ['description', 'Description', 'textarea'], ['status', 'Status', 'select', STATUSES]] },
    expenses: { title: 'Expense', fields: [['title', 'Expense name'], ['amount', 'Amount (KES)', 'number'], ['category', 'Category'], ['expense_date', 'Date', 'date'] ] },
    tasks: { title: 'Task', fields: [['title', 'Task title'], ['description', 'Description', 'textarea'], ['status', 'Status', 'select', ['pending', 'in_progress', 'completed']], ['due_date', 'Due date', 'date'] ] },
    notes: { title: 'Note', fields: [['title', 'Title'], ['content', 'Note', 'textarea'] ] },
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
    if (resource === 'expenses') payload.amount = Number(payload.amount)
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