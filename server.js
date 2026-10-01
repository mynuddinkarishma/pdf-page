import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const PORT = 5000
const DATA_DIR = path.join(__dirname, 'data')
const USERS_PATH = path.join(DATA_DIR, 'users.json')
const TRAFFIC_PATH = path.join(DATA_DIR, 'traffic.json')
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
const OAUTH_CALLBACK_BASE_URL = (process.env.OAUTH_CALLBACK_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')
const OAUTH_STATE_TTL = 10 * 60 * 1000
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000
const oauthStates = new Map()
const sessions = new Map()

const defaultTraffic = {
  totalRequests: 0,
  totalUsers: 0,
  pageViews: 0,
  conversions: 0,
  routes: {},
  lastEvent: null,
  lastUpdated: null,
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function ensureFile(filePath, defaultValue) {
  ensureDataDir()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8')
  }
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return raw ? JSON.parse(raw) : fallback
  } catch (error) {
    return fallback
  }
}

function writeJson(filePath, data) {
  ensureDataDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function syncUserCount() {
  const users = readJson(USERS_PATH, [])
  const traffic = readJson(TRAFFIC_PATH, defaultTraffic)
  traffic.totalUsers = Array.isArray(users) ? users.length : 0
  traffic.lastUpdated = new Date().toISOString()
  writeJson(TRAFFIC_PATH, traffic)
  return traffic
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    passwordSalt: salt,
    passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
  }
}

function verifyPassword(password, user) {
  if (!user.passwordHash || !user.passwordSalt) {
    return user.password === String(password)
  }

  const candidate = Buffer.from(hashPassword(String(password), user.passwordSalt).passwordHash, 'hex')
  const stored = Buffer.from(user.passwordHash, 'hex')
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
}

function oauthConfig(provider) {
  if (provider === 'google') {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    }
  }
  if (provider === 'github') {
    return {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
    }
  }
  return null
}

function redirectWithAuthError(response, error) {
  const destination = new URL('/', FRONTEND_ORIGIN)
  destination.searchParams.set('auth_error', error)
  response.redirect(destination.toString())
}

function setSessionCookie(response, sessionId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `pdfflow_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`,
  )
}

function sessionForRequest(request) {
  const cookie = (request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('pdfflow_session='))
  if (!cookie) return null

  const sessionId = cookie.slice('pdfflow_session='.length)
  const session = sessions.get(sessionId)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId)
    return null
  }

  const user = readJson(USERS_PATH, []).find((item) => item.id === session.userId)
  return user ? { sessionId, user } : null
}

async function responseJson(response) {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description || data.message || 'The identity provider rejected the request.')
  }
  return data
}

async function getProviderProfile(provider, accessToken) {
  if (provider === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profile = await responseJson(response)
    if (!profile.email_verified) throw new Error('Google did not verify this email address.')
    return { id: String(profile.sub), email: profile.email, name: profile.name }
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'PDFFlow',
  }
  const profile = await responseJson(await fetch('https://api.github.com/user', { headers }))
  const emails = await responseJson(await fetch('https://api.github.com/user/emails', { headers }))
  const verifiedEmail = emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified)

  if (!verifiedEmail) throw new Error('GitHub did not provide a verified email address.')
  return { id: String(profile.id), email: verifiedEmail.email, name: profile.name || profile.login }
}

function saveOAuthUser(provider, profile) {
  const users = readJson(USERS_PATH, [])
  const email = String(profile.email || '').trim().toLowerCase()
  let user = users.find((item) => item.oauthProviders?.some((identity) => identity.provider === provider && identity.id === profile.id))
    || users.find((item) => item.email.toLowerCase() === email)

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      name: String(profile.name || email.split('@')[0]).trim(),
      email,
      createdAt: new Date().toISOString(),
      oauthProviders: [],
    }
    users.push(user)
  }

  user.oauthProviders = user.oauthProviders || []
  if (!user.oauthProviders.some((identity) => identity.provider === provider && identity.id === profile.id)) {
    user.oauthProviders.push({ provider, id: profile.id })
  }
  writeJson(USERS_PATH, users)
  syncUserCount()
  return user
}

ensureFile(USERS_PATH, [])
ensureFile(TRAFFIC_PATH, defaultTraffic)

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const traffic = readJson(TRAFFIC_PATH, defaultTraffic)
    traffic.totalRequests = (traffic.totalRequests || 0) + 1
    const routeKey = req.path
    traffic.routes = traffic.routes || {}
    traffic.routes[routeKey] = (traffic.routes[routeKey] || 0) + 1
    traffic.lastUpdated = new Date().toISOString()
    traffic.lastEvent = {
      method: req.method,
      path: req.path,
      at: traffic.lastUpdated,
    }
    writeJson(TRAFFIC_PATH, traffic)
  }
  next()
})

app.get('/', (req, res) => {
  res.json({
    name: 'PDFFlow API',
    status: 'ok',
    health: '/api/health',
    endpoints: ['/api/signup', '/api/signin', '/api/session', '/api/traffic'],
  })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', port: PORT })
})

app.get('/api/auth/:provider', (req, res) => {
  const { provider } = req.params
  const config = oauthConfig(provider)
  if (!config) return redirectWithAuthError(res, 'provider_not_supported')
  if (!config.clientId || !config.clientSecret) {
    return redirectWithAuthError(res, `${provider}_not_configured`)
  }

  const state = crypto.randomBytes(32).toString('hex')
  oauthStates.set(state, { provider, expiresAt: Date.now() + OAUTH_STATE_TTL })
  for (const [storedState, value] of oauthStates) {
    if (value.expiresAt < Date.now()) oauthStates.delete(storedState)
  }

  const callbackUrl = `${OAUTH_CALLBACK_BASE_URL}/api/auth/${provider}/callback`
  const destination = new URL(config.authorizeUrl)
  destination.searchParams.set('client_id', config.clientId)
  destination.searchParams.set('redirect_uri', callbackUrl)
  destination.searchParams.set('response_type', 'code')
  destination.searchParams.set('scope', config.scope)
  destination.searchParams.set('state', state)
  if (provider === 'google') destination.searchParams.set('prompt', 'select_account')
  res.redirect(destination.toString())
})

app.get('/api/auth/:provider/callback', async (req, res) => {
  const { provider } = req.params
  const state = oauthStates.get(String(req.query.state || ''))
  oauthStates.delete(String(req.query.state || ''))

  if (req.query.error || !state || state.provider !== provider || state.expiresAt < Date.now()) {
    return redirectWithAuthError(res, `${provider}_failed`)
  }

  const config = oauthConfig(provider)
  if (!config?.clientId || !config.clientSecret || !req.query.code) {
    return redirectWithAuthError(res, `${provider}_failed`)
  }

  try {
    const callbackUrl = `${OAUTH_CALLBACK_BASE_URL}/api/auth/${provider}/callback`
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: String(req.query.code),
        redirect_uri: callbackUrl,
        ...(provider === 'google' ? { grant_type: 'authorization_code' } : {}),
      }),
    })
    const tokenData = await responseJson(tokenResponse)
    if (!tokenData.access_token) throw new Error('The identity provider did not return an access token.')

    const profile = await getProviderProfile(provider, tokenData.access_token)
    const normalizedEmail = String(profile.email || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('The identity provider returned an invalid email.')

    const user = saveOAuthUser(provider, { ...profile, email: normalizedEmail })
    const sessionId = crypto.randomBytes(32).toString('hex')
    sessions.set(sessionId, { userId: user.id, expiresAt: Date.now() + SESSION_TTL })
    setSessionCookie(res, sessionId)
    return res.redirect(FRONTEND_ORIGIN)
  } catch (error) {
    console.error(`${provider} OAuth callback failed:`, error.message)
    return redirectWithAuthError(res, `${provider}_failed`)
  }
})

app.get('/api/session', (req, res) => {
  const session = sessionForRequest(req)
  if (!session) return res.json({ user: null })
  return res.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
  })
})

app.post('/api/signout', (req, res) => {
  const session = sessionForRequest(req)
  if (session) sessions.delete(session.sessionId)
  res.setHeader('Set-Cookie', 'pdfflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  return res.json({ message: 'Signed out.' })
})

app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {}
  const normalizedName = String(name || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedPassword = String(password || '')

  if (!normalizedName || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedPassword.length < 8) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 8 characters.' })
  }

  const users = readJson(USERS_PATH, [])
  const existingUser = users.find((user) => user.email.toLowerCase() === normalizedEmail)

  if (existingUser) {
    return res.status(409).json({ message: 'An account with this email already exists.' })
  }

  const savedUser = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    ...hashPassword(normalizedPassword),
    createdAt: new Date().toISOString(),
  }

  users.push(savedUser)
  writeJson(USERS_PATH, users)
  syncUserCount()

  return res.status(201).json({
    message: 'Account created successfully.',
    user: { id: savedUser.id, name: savedUser.name, email: savedUser.email },
  })
})

app.post('/api/signin', (req, res) => {
  const { email, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  const users = readJson(USERS_PATH, [])
  const user = users.find((item) => item.email === normalizedEmail)

  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ message: 'Email or password is incorrect.' })
  }

  if (user.password) {
    Object.assign(user, hashPassword(String(password)))
    delete user.password
    writeJson(USERS_PATH, users)
  }

  return res.json({
    message: 'Signed in successfully.',
    user: { id: user.id, name: user.name, email: user.email },
  })
})

app.get('/api/traffic', (req, res) => {
  const traffic = readJson(TRAFFIC_PATH, defaultTraffic)
  const users = readJson(USERS_PATH, [])
  traffic.totalUsers = Array.isArray(users) ? users.length : 0
  res.json(traffic)
})

app.post('/api/traffic/record', (req, res) => {
  const { type = 'conversion', format = 'PDF to Word', fileName = 'report.pdf', path: pagePath } = req.body || {}
  const traffic = readJson(TRAFFIC_PATH, defaultTraffic)
  traffic.pageViews = traffic.pageViews || 0

  if (type === 'conversion') {
    traffic.conversions = (traffic.conversions || 0) + 1
  }
  if (type === 'pageview') {
    traffic.pageViews += 1
  }

  traffic.lastEvent = {
    type,
    format,
    fileName,
    path: pagePath,
    at: new Date().toISOString(),
  }
  traffic.lastUpdated = new Date().toISOString()

  writeJson(TRAFFIC_PATH, traffic)

  return res.json({
    message: 'Conversion tracked successfully.',
    traffic,
  })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
