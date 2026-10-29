import { existsSync } from 'node:fs';

// For local development: reads server/.env (copied from .env.example) into the environment before anything else looks at it.
// Variables that are already set win, so on a host such as Railway (which sets them itself and has no .env file) this does nothing.
// Import this FIRST in every command-line entry point.
if (existsSync('.env')) process.loadEnvFile('.env');
