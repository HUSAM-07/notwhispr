import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import '@excalidraw/excalidraw/index.css';
import './styles.css';

if (window.location.hash === '#overlay') {
  document.documentElement.classList.add('overlay-route');
  document.body.classList.add('overlay-route');
} else if (window.location.hash === '#mindmap') {
  document.documentElement.classList.add('mindmap-route');
  document.body.classList.add('mindmap-route');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
