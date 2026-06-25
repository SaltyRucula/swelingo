/**
 * Shared API constants.
 *
 * `BASE_URL` is the single source of truth for the backend URL across the
 * entire frontend.  It is baked into the Expo bundle at build time from the
 * `EXPO_PUBLIC_API_URL` environment variable (set in `app/.env`).
 *
 * - Development: set `EXPO_PUBLIC_API_URL=http://localhost:3001` in `app/.env`
 * - Production:  set `EXPO_PUBLIC_API_URL=https://swelingo.com`   in `app/.env`
 */
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
