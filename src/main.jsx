import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import App from './App.jsx';
import './styles.css';
import './studio.css';
import './app.css';
import './dashboard.css';

// Entry motion only runs once scripts are up, so a page without JS still shows everything.
document.documentElement.classList.add('js');
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
