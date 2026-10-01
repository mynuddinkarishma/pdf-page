import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, FileText, Github, Lock, Mail, ShieldCheck, User, Zap } from 'lucide-react'
import './App.css'

export default function App() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
            <p className="brand-description">Convert, merge, split, and edit PDFs with lightning speed and military-grade security. Join millions of professionals today.</p>
            <div className="feature-list">
              <div className="feature-item"><div className="feature-icon"><FileText size={24} /></div><div><h4>Lossless Conversion</h4><p>Keep your formatting intact.</p></div></div>
              <div className="feature-item"><div className="feature-icon"><Zap size={24} /></div><div><h4>Lightning Fast</h4><p>Process large files in seconds.</p></div></div>
              <div className="feature-item"><div className="feature-icon"><ShieldCheck size={24} /></div><div><h4>Secure &amp; Private</h4><p>256-bit encryption for all files.</p></div></div>
            </div>
          </div>
          <div className="brand-footer">© 2026 PDFFlow Inc. All rights reserved.</div>
        </aside>
        <main className="form-panel">
          <div className="form-card">
            <div className="mode-toggle"><div className={`toggle-slider ${isSignUp ? 'right' : ''}`} /><button type="button" className={!isSignUp ? 'toggle-button active' : 'toggle-button'} onClick={() => setIsSignUp(false)}>Sign In</button><button type="button" className={isSignUp ? 'toggle-button active' : 'toggle-button'} onClick={() => setIsSignUp(true)}>Sign Up</button></div>
            <div className="form-header"><h2>{isSignUp ? 'Create an account' : 'Welcome back'}</h2><p>{isSignUp ? 'Start converting PDFs for free today.' : 'Enter your details to access your dashboard.'}</p></div>
            <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
              {isSignUp && <div className="field-group"><label className="field-label" htmlFor="name">Full Name</label><div className="input-wrap"><User size={20} className="field-icon" /><input id="name" placeholder="Full Name" required /></div></div>}
              <div className="field-group"><label className="field-label" htmlFor="email">Email Address</label><div className="input-wrap"><Mail size={20} className="field-icon" /><input id="email" type="email" placeholder="Email Address" required /></div></div>
              <div className="field-group"><div className="password-header"><label className="field-label" htmlFor="password">Password</label>{!isSignUp && <a href="#" className="link-text">Forgot password?</a>}</div><div className="input-wrap"><Lock size={20} className="field-icon" /><input id="password" type={showPassword ? 'text' : 'password'} placeholder="Password" required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
              {isSignUp && <div className="field-group"><label className="field-label" htmlFor="confirm-password">Confirm Password</label><div className="input-wrap"><Lock size={20} className="field-icon" /><input id="confirm-password" type={showPassword ? 'text' : 'password'} placeholder="Confirm Password" required /></div></div>}
              {!isSignUp && <div className="remember-row"><label className="remember-me"><input type="checkbox" /><span>Remember me</span></label><a href="#" className="link-text">Forgot password?</a></div>}
              <button type="submit" className="primary-button">{isSignUp ? 'Create Account' : 'Sign In'} <ArrowRight size={18} /></button>
            </form>
            <div className="divider"><span>Or continue with</span></div>
            <div className="social-row"><button type="button" className="social-button"><span className="google-logo">G</span>Google</button><button type="button" className="social-button"><Github size={18} />GitHub</button></div>
            <div className="switch-footer"><span>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</span> <button type="button" onClick={() => setIsSignUp((value) => !value)}>{isSignUp ? 'Sign In' : 'Sign up for free'}</button></div>
          </div>
        </main>
      </div>
    </div>
  )
}
