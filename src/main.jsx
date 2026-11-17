import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { registerServiceWorker } from './lib/push.js';
import { captureInstallPrompt } from './lib/install.js';

captureInstallPrompt();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

window.addEventListener('load', () => { registerServiceWorker(); });
