import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Geteilte MSW-Server-Instanz; Handler werden pro Test via server.use() gesetzt.
 *
 * Default-Handler bleiben nach `server.resetHandlers()` (afterEach) als Fallback erhalten:
 * Seit LFH-234 rendert `renderMitProviders` einen `<AuthProvider>`, der beim Mount
 * `/api/auth/me` abruft. 401 → benutzer=null (anonym, = Vor-Migrations-Verhalten für den
 * admin-globalen Schreibrecht-Zweig). Tests, die einen konkreten Benutzer (z. B. System-Admin)
 * brauchen, überschreiben das per `server.use(http.get('/api/auth/me', …))`.
 */
export const server = setupServer(
  http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
);
