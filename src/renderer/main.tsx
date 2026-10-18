import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/plus-jakarta-sans';
import { App } from './App';
import { applyThemeClass, readStoredTheme } from './lib/theme';
import './index.css';

// Apply the saved theme before the first paint so there is no light/dark flash
applyThemeClass(readStoredTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
