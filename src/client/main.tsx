import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { AppStateProvider } from './useAppState';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </ErrorBoundary>,
);
