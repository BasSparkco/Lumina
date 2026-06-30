import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import PairingPage from './pages/PairingPage';
import PlayerPage from './pages/PlayerPage';

const router = createBrowserRouter([
  { path: '/', element: <PairingPage /> },
  { path: '/play', element: <PlayerPage /> },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
