import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import PairingPage from './pages/PairingPage';
import PlayerPage from './pages/PlayerPage';
const router = createBrowserRouter([
    { path: '/', element: _jsx(PairingPage, {}) },
    { path: '/play', element: _jsx(PlayerPage, {}) },
]);
const root = document.getElementById('root');
if (!root)
    throw new Error('Root element not found');
createRoot(root).render(_jsx(StrictMode, { children: _jsx(RouterProvider, { router: router }) }));
//# sourceMappingURL=main.js.map