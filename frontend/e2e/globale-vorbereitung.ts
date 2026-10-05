import { expect, request, type FullConfig } from '@playwright/test';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Standard-Rufname des Admins (LFH-894). Ohne ihn fragte jede ETB-Erfassung zuerst nach dem
 * Rufnamen, und die Von/An-Pflicht hielte jeden über die Oberfläche geschriebenen Eintrag auf.
 * Er gilt für den ganzen Lauf, weil die Temp-DB über den Lauf lebt und der Admin in fast jeder
 * Spec schreibt. Wer die Abfrage selbst prüft, nimmt eine frisch angelegte Person
 * (`etb-standard-rufname.spec.ts`).
 */
export const E2E_STANDARD_RUFNAME = { von: 'ELW 1', an: 'ELW 1' };

/**
 * Läuft nach dem Start der Webserver, vor der ersten Spec. Jeder Shard der CI hat sein eigenes
 * Backend und läuft deshalb hier durch.
 */
export default async function globaleVorbereitung(config: FullConfig) {
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
  } finally {
    await api.dispose();
  }
}
