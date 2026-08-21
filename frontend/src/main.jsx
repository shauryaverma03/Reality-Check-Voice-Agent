import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { initTheme } from './theme.js';
import './styles.css';

// Idempotent with the blocking inline script in index.html (which already
// set the theme before first paint) — this just keeps the DOM attribute in
// sync in case that script didn't run for some reason.
initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
