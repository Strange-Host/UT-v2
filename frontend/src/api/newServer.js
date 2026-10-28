// Which server the screens talk to. On by default: the screens use the new PostgreSQL/TypeScript server through the
// adapters in ./adapters, which hand each page the shapes it already expects.
// Set VITE_USE_NEW_SERVER=false only to point the screens back at the legacy backend.
export const USE_NEW_SERVER = import.meta.env.VITE_USE_NEW_SERVER !== 'false';

// Zero-config like the legacy default: the new server is on the machine that served this page, port 3000.
export const NEW_API_BASE_URL = import.meta.env.VITE_NEW_API_URL
  || `${window.location.protocol}//${window.location.hostname || 'localhost'}:3000/api`;
