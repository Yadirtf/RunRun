import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Sin StrictMode: su doble montaje en desarrollo crearía dos motores 3D a la vez.
createRoot(document.getElementById('root')).render(<App />);

if (import.meta.env.DEV) import('./dev/testHarness.js');
