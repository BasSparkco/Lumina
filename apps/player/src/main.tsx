import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import './lib/fontImports';
import { installGlobalCrashWatchdog } from './lib/crashRecovery';
import { ErrorBoundary } from './components/ErrorBoundary';
import PairingPage from './pages/PairingPage';
import PlayerPage from './pages/PlayerPage';
import PlaylistPreviewPage from './pages/PlaylistPreviewPage';

installGlobalCrashWatchdog();

const router = createBrowserRouter([
  { path: '/', element: <PairingPage /> },
  { path: '/play', element: <PlayerPage /> },
  { path: '/preview', element: <PlaylistPreviewPage /> },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
