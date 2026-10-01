import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  FileType,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  User,
  Zap,
} from 'lucide-react'
import './App.css'

const conversionOptions = [
  { label: 'PDF to Word', description: 'Edit PDF text in Word format', icon: FileText },
  { label: 'Word to Excel', description: 'Turn table data into spreadsheets', icon: FileType },
  { label: 'PDF to JPG', description: 'Download each PDF page as an image', icon: FileImage },
  { label: 'Image to PDF', description: 'Convert JPG, PNG, and more', icon: FileImage },
  { label: 'Any File to PDF', description: 'Free document conversion online', icon: Sparkles },
]

const defaultStats = {
  totalRequests: 0,
  totalUsers: 0,
  conversions: 0,
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Request failed')
  }

  return data
}

export default function App() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [selectedFormat, setSelectedFormat] = useState('PDF to Word')
  const [traffic, setTraffic] = useState(defaultStats)
  const [statusMessage, setStatusMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [conversionMessage, setConversionMessage] = useState('')
  const [isConverting, setIsConverting] = useState(false)

  const refreshTraffic = async () => {
    try {
      const data = await fetchJson('/api/traffic')
      setTraffic({
        totalRequests: data.totalRequests ?? 0,
        totalUsers: data.totalUsers ?? 0,
        conversions: data.conversions ?? 0,
      })
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('auth_error')
    if (authError) {
      const provider = authError.startsWith('google_') ? 'Google' : 'GitHub'
      setStatusMessage(authError.endsWith('_not_configured')
        ? `${provider} sign-in is not configured. Add its OAuth credentials to .env and restart the server.`
        : `${provider} sign-in could not be completed. Please try again.`)
      window.history.replaceState({}, '', window.location.pathname)
    }

    fetchJson('/api/session')
      .then(({ user }) => {
        if (user) setIsLoggedIn(true)
      })
      .catch(() => {})

    const pageViewKey = `pdfflow-page-view:${window.location.pathname}`
    if (sessionStorage.getItem(pageViewKey)) {
      refreshTraffic()
      return
    }

    sessionStorage.setItem(pageViewKey, 'recorded')
    fetchJson('/api/traffic/record', {
      method: 'POST',
      body: JSON.stringify({ type: 'pageview', path: window.location.pathname }),
    }).then(refreshTraffic).catch((error) => console.error(error))
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = {
      name: form.name?.value?.trim() || '',
      email: form.email.value.trim(),
      password: form.password.value,
    }

    if (!formData.email || !formData.password) {
      setStatusMessage('Please enter a valid email and password.')
      return
    }

    if (isSignUp && !formData.name) {
      setStatusMessage('Please add your full name.')
      return
    }

    setIsSubmitting(true)
    setStatusMessage('')

    try {
      const endpoint = isSignUp ? '/api/signup' : '/api/signin'
      const result = await fetchJson(endpoint, {
        method: 'POST',
        body: JSON.stringify(formData),
      })

      setStatusMessage(result.message)
      setIsLoggedIn(true)
      await refreshTraffic()
    } catch (error) {
      setStatusMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await fetchJson('/api/signout', { method: 'POST' })
    } catch (error) {
      console.error('Could not clear the server session:', error)
    } finally {
      setIsLoggedIn(false)
    }
  }

  const handleConvert = async () => {
    if (!selectedFile) {
      setConversionMessage('Choose a file to convert first.')
      return
    }

    setIsConverting(true)
    setConversionMessage('Converting your file...')

    try {
      const { convertFile } = await import('./conversion')
      const result = await convertFile(selectedFile, selectedFormat)
      const downloadUrl = URL.createObjectURL(result.blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = downloadUrl
      downloadLink.download = result.fileName
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setConversionMessage('Conversion complete. Your download has started.')

      try {
        await fetchJson('/api/traffic/record', {
          method: 'POST',
          body: JSON.stringify({
            type: 'conversion',
            format: selectedFormat,
            fileName: selectedFileName,
          }),
        })
        await refreshTraffic()
      } catch (error) {
        console.error('Could not record conversion traffic:', error)
      }
    } catch (error) {
      setConversionMessage(error.message || 'Conversion failed. Please try another file.')
    } finally {
      setIsConverting(false)
    }
  }

  if (isLoggedIn) {
    return (
      <div className="converter-page">
        <div className="converter-shell">
          <header className="topbar">
            <div className="brand-row">
              <div className="brand-mark small"><FileText size={22} /></div>
              <span className="brand-name">PDFFlow</span>
            </div>

            <nav className="nav-links">
              <button type="button">Home</button>
              <button type="button">Convert</button>
              <button type="button">Tools</button>
              <button type="button">Pricing</button>
            </nav>

            <button type="button" className="logout-button" onClick={handleSignOut}>
              Switch account
            </button>
          </header>

          <main className="converter-content">
            <section className="hero-panel">
              <div>
                <p className="eyebrow">Free online converter</p>
                <h1>Convert any file for free.</h1>
                <p className="hero-copy">
                  PDF to Word, Word to Excel, image to PDF, and more—fast, secure, and ready in seconds.
                </p>
              </div>

              <div className="stats-row">
                <div className="stat-box">
                  <strong>{traffic.totalRequests}</strong>
                  <span>traffic hits</span>
                </div>
                <div className="stat-box">
                  <strong>{traffic.totalUsers}</strong>
                  <span>saved users</span>
                </div>
                <div className="stat-box">
                  <strong>{traffic.conversions}</strong>
                  <span>conversions</span>
                </div>
              </div>
            </section>

            <section className="converter-grid">
              <div className="upload-card">
                <div className="section-header">
                  <h2>Upload your file</h2>
                  <span className="chip success"><CheckCircle2 size={14} /> Safe and private</span>
                </div>

                <label className="dropzone" htmlFor="file-upload">
                  <UploadCloud size={38} />
                  <span>Drop files here or click to browse</span>
                  <small>{selectedFileName || 'No file selected'}</small>
                  <input
                    id="file-upload"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null
                      setSelectedFile(file)
                      setSelectedFileName(file?.name || '')
                      setConversionMessage('')
                    }}
                  />
                </label>

                <div className="select-group">
                  <label htmlFor="format-select">Convert to</label>
                  <select
                    id="format-select"
                    value={selectedFormat}
                    onChange={(event) => setSelectedFormat(event.target.value)}
                  >
                    <option>PDF to Word</option>
                    <option>Word to Excel</option>
                    <option>PDF to JPG</option>
                    <option>Any File to PDF</option>
                  </select>
                </div>

                <button type="button" className="convert-button" onClick={handleConvert} disabled={isConverting}>
                  {isConverting ? 'Converting...' : 'Convert now'} <ArrowRightLeft size={18} />
                </button>
                {conversionMessage && <p className="conversion-message" role="status" aria-live="polite">{conversionMessage}</p>}
              </div>

              <div className="formats-card">
                <div className="section-header">
                  <h2>Popular conversions</h2>
                  <span className="chip">Free</span>
                </div>

                <div className="option-list">
                  {conversionOptions.map(({ label, description, icon: Icon }) => (
                    <button
                      type="button"
                      key={label}
                      className={`option-item ${selectedFormat === label ? 'active' : ''}`}
                      onClick={() => setSelectedFormat(label)}
                    >
                      <span className="option-icon"><Icon size={18} /></span>
                      <span className="option-copy">
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="bottom-panel">
              <div className="feature-banner">
                <div>
                  <p className="eyebrow">No registration needed</p>
                  <h3>Convert your documents in seconds.</h3>
                </div>
                <button type="button" className="download-button">
                  <Download size={16} /> Download sample
                </button>
              </div>
            </section>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <aside className="brand-panel">
          <div>
            <div className="brand-header">
              <div className="brand-mark"><FileText size={28} /></div>
              <span className="brand-name">PDFFlow</span>
            </div>
            <div className="brand-copy"><h1>Master Your Documents.</h1></div>
            <p className="brand-description">
              Convert, merge, split, and edit PDFs with lightning speed and military-grade security. Join millions of professionals today.
            </p>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon"><FileText size={24} /></div>
                <div>
                  <h4>Lossless Conversion</h4>
                  <p>Keep your formatting intact.</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon"><Zap size={24} /></div>
                <div>
                  <h4>Lightning Fast</h4>
                  <p>Process large files in seconds.</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon"><ShieldCheck size={24} /></div>
                <div>
                  <h4>Secure &amp; Private</h4>
                  <p>256-bit encryption for all files.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="brand-footer">© 2026 PDFFlow Inc. All rights reserved.</div>
        </aside>

        <main className="form-panel">
          <div className="form-card">
            <div className="mode-toggle">
              <div className={`toggle-slider ${isSignUp ? 'right' : ''}`} />
              <button type="button" className={!isSignUp ? 'toggle-button active' : 'toggle-button'} onClick={() => setIsSignUp(false)}>
                Sign In
              </button>
              <button type="button" className={isSignUp ? 'toggle-button active' : 'toggle-button'} onClick={() => setIsSignUp(true)}>
                Sign Up
              </button>
            </div>

            <div className="form-header" key={isSignUp ? 'signup' : 'signin'}>
              <h2>{isSignUp ? 'Create an account' : 'Welcome back'}</h2>
              <p>{isSignUp ? 'Start converting PDFs for free today.' : 'Enter your details to access your dashboard.'}</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              {isSignUp && (
                <div className="field-group">
                  <label className="field-label" htmlFor="name">Full Name</label>
                  <div className="input-wrap">
                    <User size={20} className="field-icon" />
                    <input id="name" placeholder="Full Name" required />
                  </div>
                </div>
              )}

              <div className="field-group">
                <label className="field-label" htmlFor="email">Email Address</label>
                <div className="input-wrap">
                  <Mail size={20} className="field-icon" />
                  <input id="email" type="email" placeholder="Email Address" required />
                </div>
              </div>

              <div className="field-group">
                <div className="password-header">
                  <label className="field-label" htmlFor="password">Password</label>
                  {!isSignUp && <a href="#" className="link-text">Forgot password?</a>}
                </div>
                <div className="input-wrap">
                  <Lock size={20} className="field-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {isSignUp && (
                <div className="field-group">
                  <label className="field-label" htmlFor="confirm-password">Confirm Password</label>
                  <div className="input-wrap">
                    <Lock size={20} className="field-icon" />
                    <input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm Password"
                      required
                    />
                  </div>
                </div>
              )}

              {!isSignUp && (
                <div className="remember-row">
                  <label className="remember-me">
                    <input type="checkbox" />
                    <span>Remember me</span>
                  </label>
                  <a href="#" className="link-text">Forgot password?</a>
                </div>
              )}

              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'} <ArrowRight size={18} />
              </button>

              {statusMessage && <p className="status-message">{statusMessage}</p>}
            </form>

            <div className="divider"><span>Or continue with</span></div>

            <div className="social-row">
              <a href="/api/auth/google" className="social-button"><span className="google-logo">G</span>Continue with Google</a>
            </div>

            <div className="switch-footer">
              <span>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</span>
              <button type="button" onClick={() => setIsSignUp((value) => !value)}>
                {isSignUp ? 'Sign In' : 'Sign up for free'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
