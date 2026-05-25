import { apiGet } from './client';

/** Dev-Benutzer, wie vom feature-gegateten `/api/dev/users` geliefert.
 *  Spiegelt das Backend-`DevBenutzerResponse`. */
export interface DevBenutzer {
  benutzername: string;
  passwort: string;
  anzeigename: string;
  /** Menschenlesbares Rollen-Label, z.B. "Admin". */
  rolle: string;
}

/** Lädt die aktiven Dev-Benutzer. Wirft `ApiError` (z.B. 404, wenn das
 *  Backend ohne Feature läuft) — Aufrufer ignorieren das still. */
export function devBenutzerLaden(): Promise<DevBenutzer[]> {
  return apiGet<DevBenutzer[]>('/api/dev/users');
}
