import { expect, type Page } from '@playwright/test';

/**
 * Anmeldung für e2e über die API (LLH-1665, Spec `e2e-zuschnitt`, „Anmeldung über die API“).
 *
 * Über das Formular kostete jede Anmeldung zwei volle App-Starts (`/login`, danach die
 * Einsatzliste), bevor der Fall seine Seite überhaupt lud: bei rund 1.300 Anmeldungen je Lauf
 * ein spürbarer Teil der e2e-Zeit. `page.request` teilt die Cookies mit dem Browserkontext, die
 * Sitzung gilt also für die nächste Navigation. Das Formular prüfen nur noch die Specs, die die
 * Anmeldung selbst prüfen; der Riegel in `frontend/eslint.config.js` nennt sie.
 *
 * - `startseite: true` (Vorgabe) lädt danach die Einsatzliste und wartet auf ihre URL: dieselbe
 *   Nachbedingung wie der frühere Formularweg, jeder Aufrufer bleibt gültig.
 * - `startseite: false` lädt nichts; der Fall steuert seine Seite selbst per `goto` an. Das spart
 *   auch die Einsatzliste und vermeidet abgebrochene Abrufe, die WebKit als Seitenfehler meldet
 *   (LLH-1051, früher `anmeldenOhneStartseite`).
 *
 * Eine Antwort ohne Sitzung (Änderungszwang LFH-1121, Zweitfaktor) ist ein Fehler hier, nicht
 * erst auf der nächsten Seite: ohne die Zusicherung stünde der Fall still auf `/login`.
 */
export async function anmeldenPerApi(
  page: Page,
  benutzername: string,
  passwort: string,
  { startseite = true }: { startseite?: boolean } = {},
) {
  const antwort = await page.request.post('/api/auth/login', { data: { benutzername, passwort } });
  expect(
    antwort.ok(),
    `Anmelden ${benutzername}: ${antwort.status()} ${await antwort.text()}`,
  ).toBe(true);
  expect(
    await antwort.json(),
    `Anmelden ${benutzername}: Sitzung erwartet, nicht Änderungszwang oder Zweitfaktor`,
  ).toMatchObject({ benutzername });
  if (startseite) {
    await page.goto('/einsaetze');
    await expect(page).toHaveURL(/\/einsaetze/);
  }
}
