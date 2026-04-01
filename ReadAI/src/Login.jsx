import { useState } from 'react'

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (username === 'varun' && password === 'Password') {
      localStorage.setItem('readai_logged_in', 'true')
      onLogin()
    } else {
      setError('Invalid username or password')
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100%',
    }}>
      <h1 style={{ marginBottom: '0.25em' }}>ReadAI</h1>
      <p style={{ color: '#888', marginBottom: '2em', marginTop: 0 }}>Sign in to continue</p>

      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1em',
        width: '100%',
        maxWidth: '320px',
      }}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => { setUsername(e.target.value); setError('') }}
          style={{
            padding: '0.6em 1em',
            fontSize: '1em',
            borderRadius: '8px',
            border: '1px solid #444',
            backgroundColor: '#1a1a1a',
            color: 'inherit',
            fontFamily: 'inherit',
            outline: 'none',
          }}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError('') }}
          style={{
            padding: '0.6em 1em',
            fontSize: '1em',
            borderRadius: '8px',
            border: '1px solid #444',
            backgroundColor: '#1a1a1a',
            color: 'inherit',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        {error && (
          <p style={{ color: '#ff6b6b', margin: 0, fontSize: '0.9em' }}>{error}</p>
        )}

        <button type="submit" style={{ marginTop: '0.5em' }}>
          Sign in
        </button>
      </form>
    </div>
  )
}

export default Login
