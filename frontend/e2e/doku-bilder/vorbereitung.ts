import { expect, request, type FullConfig } from '@playwright/test';
import { E2E_STANDARD_RUFNAME } from '../globale-vorbereitung';
import { ADMIN, ADMIN_PW } from '../rollen-kern';

/**
 * Vorbereitung des Bildlaufs (LFH-1128, Design LFH-1127, D3): meldet den Admin an, setzt den
 * Standard-Rufnamen wie im e2e-Lauf (sonst hielte die Von/An-Pflicht jede ETB-Erfassung auf) und
 * spielt die Demo-Daten ein (`POST /api/demo-daten`, Backend mit `--demo-daten`). Läuft einmal je
 * Lauf nach dem Start der Webserver; die Temp-DB ist neu, der Import also nie doppelt.
 *
 * Was die Demo-Daten nicht tragen, füllt die Bilder-Spec des Kapitels selbst über die API
 * (`fuelle` in `kern.ts`).
 */
export default async function vorbereitung(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const api = await request.newContext({ baseURL });
  try {
    const login = await api.post('/api/auth/login', {
      data: { benutzername: ADMIN, passwort: ADMIN_PW },
    });
    expect(login.ok(), `Admin-Anmeldung: ${login.status()} ${await login.text()}`).toBe(true);
    const gesetzt = await api.put('/api/benutzer-einstellungen/etb_standard_rufname', {
      data: { wert: JSON.stringify(E2E_STANDARD_RUFNAME) },
    });
    expect(gesetzt.ok(), `Standard-Rufname: ${gesetzt.status()} ${await gesetzt.text()}`).toBe(
      true,
    );
    const demo = await api.post('/api/demo-daten');
    expect(demo.status(), `Demo-Daten: ${demo.status()} ${await demo.text()}`).toBe(201);
  } finally {
    await api.dispose();
  }
}
