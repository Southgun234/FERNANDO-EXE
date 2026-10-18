const API_URL = (import.meta.env.VITE_API_URL || 'https://fernandoexe.alwaysdata.net').replace(/\/$/, '')
export const TOKEN_STORAGE_KEY = 'fernando.exe.authToken'
export const ACTIVITY_STORAGE_KEY = 'fernando.exe.lastActivity'
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000
let authToken = null

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function saveToken(token) {
  authToken = token
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
  touchSession()
}

export function getToken() {
  const token = authToken || sessionStorage.getItem(TOKEN_STORAGE_KEY)
  const lastActivity = Number(sessionStorage.getItem(ACTIVITY_STORAGE_KEY))
  if (!token || !lastActivity || Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
    clearToken()
    return null
  }
  authToken = token
  return token
}

export function getLastActivity() {
  return Number(sessionStorage.getItem(ACTIVITY_STORAGE_KEY)) || 0
}

export function touchSession() {
  if (authToken || sessionStorage.getItem(TOKEN_STORAGE_KEY)) {
    sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()))
  }
}

export function clearToken() {
  authToken = null
  sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  sessionStorage.removeItem(ACTIVITY_STORAGE_KEY)
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token && options.auth !== false) headers.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch (error) {
    throw new ApiError(`Unable to reach the API. ${error.message}`)
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError(`The API returned an unreadable response (HTTP ${response.status}).`, response.status)
    }
  }

  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) {
      window.dispatchEvent(new Event('fernando:unauthorized'))
    }
    throw new ApiError(payload?.error || payload?.message || `Request failed (${response.status}).`, response.status)
  }
  return payload
}

async function requestBlob(path) {
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(`${API_URL}${path}`, { headers })
  } catch (error) {
    throw new ApiError(`Unable to reach the API. ${error.message}`)
  }

  if (!response.ok) {
    let payload = null
    try { payload = await response.json() } catch { /* The server may return a non-JSON error. */ }
    if (response.status === 401) window.dispatchEvent(new Event('fernando:unauthorized'))
    throw new ApiError(payload?.error || payload?.message || `Request failed (${response.status}).`, response.status)
  }
  return response.blob()
}

const json = (method, body) => ({ method, body: JSON.stringify(body) })
const resource = (name) => ({
  list: () => request(`/api/${name}`),
  create: (body) => request(`/api/${name}`, json('POST', body)),
  update: (id, body) => request(`/api/${name}/${id}`, json('PATCH', body)),
  remove: (id) => request(`/api/${name}/${id}`, { method: 'DELETE' }),
})

export const api = {
  health: () => request('/api/health', { auth: false }),
  signup: (body) => request('/api/signup', { ...json('POST', body), auth: false }),
  signin: (body) => request('/api/signin', { ...json('POST', body), auth: false }),
  profile: () => request('/api/profile'),
  stats: () => request('/api/dashboard/stats'),
  projects: resource('projects'),
  expenses: resource('expenses'),
  tasks: resource('tasks'),
  notes: resource('notes'),
  family: {
    members: () => request('/api/family/members'),
  },
  files: {
    list: () => request('/api/files'),
    upload: (formData) => request('/api/files/upload', { method: 'POST', body: formData }),
    get: (id) => request(`/api/files/${id}`),
    preview: (id) => requestBlob(`/api/files/${id}/thumbnail`),
    download: (id) => requestBlob(`/api/files/${id}/download`),
    remove: (id) => request(`/api/files/${id}`, { method: 'DELETE' }),
  },
}

export { API_URL }