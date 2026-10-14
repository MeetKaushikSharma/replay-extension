import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Light global reset
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7fafc; min-height: 100vh; }
  a { color: inherit; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
