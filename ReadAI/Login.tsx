import React, { useState } from 'react';

interface LoginProps {
  onLogin: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (username === 'varun' && password === 'Password') {
      localStorage.setItem('readai_logged_in', 'true');
      onLogin();
    } else {
      setError('Invalid username or password');
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
      <h1 className="text-3xl font-semibold text-zinc-100 mb-1 tracking-tight">EchoNote AI</h1>
      <p className="text-zinc-500 text-sm mb-8">Sign in to continue</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-xs">
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => { setUsername(e.target.value); setError(''); }}
          className="bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-zinc-600 transition-colors"
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          className="bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-zinc-600 transition-colors"
        />

        {error && (
          <p className="text-red-400 text-xs">{error}</p>
        )}

        <button
          type="submit"
          className="mt-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
        >
          Sign in
        </button>
      </form>
    </div>
  );
};

export default Login;
