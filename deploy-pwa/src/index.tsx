import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { DataProvider } from './contexts/DataContext';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
