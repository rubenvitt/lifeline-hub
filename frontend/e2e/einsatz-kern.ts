import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Einsatz über die Oberfläche anlegen (LFH-1114) — Muster `rollen-kern.ts`: wer den Dialog
 * „Neuen Einsatz anlegen“ braucht, nimmt ihn von hier statt einer Kopie. Wer die Oberfläche nicht
 * prüft, legt über die API an (`fernmeldeskizze-kern.ts`).
 *
 * Geklickt wird erst, wenn der Dialog steht. Unter Last (WebKit, viele Einsatzkacheln) maß
 * Playwright „Anlegen“ noch im Zoom (`ant-zoom-appear-active`, Ursprung am Knopf „Neuer
 * Einsatz“). Bis zum Klick wuchs der Dialog weiter, und der Klick fiel links oberhalb des Knopfs
 * in die Lücke des Formulars: kein POST, der Dialog blieb ohne Fehlermeldung offen
 * (`druck-fluss.spec.ts`, `meldebild-druck.spec.ts`).
 */

/** Öffnet „Neuen Einsatz anlegen“ und liefert den Dialog, sobald er eingeblendet ist. */
export async function einsatzDialogOeffnen(page: Page): Promise<Locator> {
  // eslint-disable-next-line no-restricted-syntax -- die eine Stelle, die den Dialog öffnet
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neuen Einsatz anlegen' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  // Die Vorbelegung ist Pflichtfeld: fehlte sie, hielte die Formularprüfung das Abschicken still
  // auf. So meldet sich dieser Fall hier mit Namen statt als offener Dialog nach dem Klick.
  await expect(dialog.getByLabel('Alarmzeit'), 'Vorbedingung: Alarmzeit vorbelegt').not.toHaveValue(
    '',
  );
  return dialog;
}

/** Legt einen Einsatz an und liefert seine DB-id; die Anlegen-Mutation navigiert in den Einsatz. */
export async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  const dialog = await einsatzDialogOeffnen(page);
  await dialog.getByLabel('Bezeichnung').fill(name);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/**
 * Legt einen Einsatz über die API an, ohne Seite (LLH-1665, Spec `e2e-zuschnitt`): für Fälle,
 * die den Dialog nicht prüfen und danach ohnehin ihre Seite per `goto` laden. Dieselben Werte
 * wie der Dialog ohne Vorlage: Einsatzart „Realeinsatz“ und Alarmzeit „jetzt“ sind die
 * Vorgaben des Servers. Der Dialog kostete die Einsatzliste, das Einblenden und das Laden des
 * neuen Einsatzes.
 */
export async function einsatzPerApi(page: Page, name: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung: name } });
  expect(antwort.ok(), `Einsatz „${name}“: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}
