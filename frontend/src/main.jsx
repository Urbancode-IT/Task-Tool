import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { BrandingProvider } from './branding/BrandingContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrandingProvider>
        <App />
      </BrandingProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
