if (import.meta.env.DEV) {
  import("react-grab").catch((err) =>
    console.error("[React Grab] failed to load:", err)
  );
}

import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Login from './Login';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

function Root() {
  const [loggedIn, setLoggedIn] = useState(
    () => localStorage.getItem('readai_logged_in') === 'true'
  );

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return <App onLogout={() => {
    localStorage.removeItem('readai_logged_in');
    setLoggedIn(false);
  }} />;
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
