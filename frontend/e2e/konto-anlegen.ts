import { expect, request, test, type APIRequestContext } from '@playwright/test';

/**
 * Legt ein Konto per API an und erledigt den Erstwechsel (LFH-1121, Spec `konto-einmalpasswort`):
 * die Anlage stellt jedes Konto unter Änderungszwang, sein erster Passwort-Login führte sonst in
 * „Neues Passwort festlegen“ statt in eine Sitzung. Danach meldet `passwort` direkt an.
 *
 * Der Wechsel läuft in einem eigenen API-Kontext, die Sitzung des Aufrufers (meist der Admin)
 * bleibt unberührt; die Sitzung aus dem Festlegen meldet er gleich wieder ab. Wer nur Zeilen für
 * eine Liste braucht und sich nie damit anmeldet, kommt ohne diesen Helfer aus.
 */
export async function kontoAnlegen(
  admin: APIRequestContext,
  daten: {
    anzeigename: string;
    benutzername: string;
    passwort: string;
    system_rolle?: 'admin' | 'keiner';
    org_rolle?: 'fuehrungskraft' | 'keine';
  },
): Promise<{ id: number }> {
  const start = `${daten.passwort}-start`;
  const antwort = await admin.post('/api/benutzer', { data: { ...daten, passwort: start } });
  expect(
    antwort.ok(),
    `Konto ${daten.benutzername}: ${antwort.status()} ${await antwort.text()}`,
  ).toBe(true);
  const { id } = (await antwort.json()) as { id: number };

  const person = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await person.post('/api/auth/login', {
      data: { benutzername: daten.benutzername, passwort: start },
    });
    expect(await login.json(), `Erstanmeldung ${daten.benutzername}`).toEqual({
      passwort_wechsel_erforderlich: true,
    });
    const festgelegt = await person.post('/api/auth/passwort/festlegen', {
      data: { neues_passwort: daten.passwort },
    });
    expect(festgelegt.ok(), `Festlegen ${daten.benutzername}: ${festgelegt.status()}`).toBe(true);
    expect((await person.post('/api/auth/logout')).ok()).toBe(true);
  } finally {
    await person.dispose();
  }
  return { id };
}
