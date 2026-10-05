import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

// ETB-Entwurf-Tabs und Autosave; nach dem Anlegen wird direkt die ETB-Modul-URL angesteuert.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  // App navigiert nach dem Anlegen automatisch in den Einsatz (Default-Modul).
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const m = page.url().match(/\/einsaetze\/(\d+)/);
  const id = m![1];
  await page.goto(`/einsaetze/${id}/etb`);
  return id;
}

/** Steht ein Entwurf mit genau diesem Inhalt im Entwurfsspeicher (`etb/entwuerfe/entwurfStore.ts`)? */
async function entwurfGesichert(page: Page, inhalt: string): Promise<boolean> {
  return page.evaluate(
    (gesucht) =>
      new Promise<boolean>((fertig) => {
        const anfrage = indexedDB.open('lifeline-etb-entwuerfe');
        // Gibt es die Datenbank noch nicht, legte `open` sie leer an, und die App bekäme ihren
        // Speicher nie: den Anlegeschritt abbrechen, das verwirft die leere Datenbank wieder.
        anfrage.onupgradeneeded = () => anfrage.transaction?.abort();
        anfrage.onerror = () => fertig(false);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          const lesen = db.transaction('entwuerfe').objectStore('entwuerfe').getAll();
          lesen.onsuccess = () => {
            db.close();
            fertig((lesen.result as { inhalt: string }[]).some((e) => e.inhalt === gesucht));
          };
          lesen.onerror = () => {
            db.close();
            fertig(false);
          };
        };
      }),
    inhalt,
  );
}

test('ETB-Entwurf-Tab: Eintrag erfassen landet in der Zeitachse, Entwurf-Tab wird wieder leer', async ({
  page,
}) => {
  await anmelden(page);
  const name = `E2E ETB ${Date.now()}`;
  await einsatzAnlegenUndOeffnen(page, name);

  // Beim Öffnen ist ein leerer Entwurf-Tab aktiv (Erfassungsfeld + Erfassen-Button da).
  const feld = page.getByPlaceholder('Inhalt …');
  await expect(feld).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erfassen', exact: true })).toBeVisible();

  // Eintrag erfassen. Während des Tippens spiegelt das Tab-Label den Inhalt (Autosave);
  // nach dem Absenden schließt der Tab und ein neuer leerer Tab ('Neuer Eintrag') wird aktiv.
  const inhalt = `Lagemeldung ${Date.now()}`;
  await feld.fill(inhalt);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Erst den stabilen Zustand nach dem Absenden abwarten: Feld geleert, Tab auf einen neuen
  // leeren Entwurf zurückgesetzt. Während des Tippens spiegelt das Tab-Label den Inhalt, ein
  // `getByText(inhalt)` träfe dann Tab-Label und textarea.
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue('');

  // Der erfasste Eintrag steht in der Zeitachse; die Region grenzt ihn gegen Tab-Label und
  // Eingabefeld ab.
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(zeitachse.getByText(inhalt, { exact: true })).toBeVisible();
});

test('ETB-Entwurf-Autosave: getippter Entwurf überlebt einen Reload', async ({ page }) => {
  await anmelden(page);
  const name = `E2E Autosave ${Date.now()}`;
  await einsatzAnlegenUndOeffnen(page, name);

  const entwurf = `Angefangen, nicht gesendet ${Date.now()}`;
  await page.getByPlaceholder('Inhalt …').fill(entwurf);

  /*
   * Erst neu laden, wenn der Entwurf in IndexedDB steht (LFH-536). Der Autosave schreibt ohne
   * Verzögerung, aber asynchron, und ein Reload direkt nach `fill` kam ihm zuvor: in rund 4 von
   * 25 CI-Läufen war das Feld danach leer. Gemessen mit 6-fach gedrosselter CPU: ohne dieses Tor
   * 15 von 15 rot, jedes Mal mit leerem Entwurfsspeicher (das Schreiben kam nie an), mit Tor
   * 0 von 15.
   * Kein Mensch lädt binnen Millisekunden nach dem letzten Tastendruck neu. Das Tor liest
   * deshalb den gespeicherten Stand selbst. Das Tab-Label wäre kein Beleg, es spiegelt nur den
   * React-State.
   */
  await expect.poll(() => entwurfGesichert(page, entwurf)).toBe(true);

  // Reload: der lokal (IndexedDB) gesicherte Entwurf muss im Eingabefeld erhalten bleiben.
  await page.reload();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue(entwurf);
});

/**
 * LFH-521: Speicherung beim Reload nachweislich AUSSTEHEND. Die IndexedDB-Transaktion des
 * Entwurfs wird offen gehalten (Leseanfragen in Schleife), bis das Neuladen sie abbricht — der
 * Verlustpfad aus dem Sammel-Gate von LFH-460, hier ohne Zufall. Der Schalter lebt nur im
 * Fenster vor dem Reload; die neue Seite schreibt ungehindert.
 */
async function entwurfsSpeicherungAnhalten(page: Page) {
  await page.addInitScript(() => {
    const fenster = window as typeof window & { __lfhHalten?: boolean; __lfhGehalten?: number };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      const anfrage = put.apply(this, args as Parameters<IDBObjectStore['put']>);
      if (fenster.__lfhHalten && this.name === 'entwuerfe') {
        const halten = (ereignis: Event) => {
          const laufend = (ereignis.target as IDBRequest).source as IDBObjectStore;
          laufend.count().onsuccess = halten;
        };
        anfrage.addEventListener('success', halten);
        fenster.__lfhGehalten = (fenster.__lfhGehalten ?? 0) + 1;
      }
      return anfrage;
    } as IDBObjectStore['put'];
  });
}

test('ETB-Entwurf-Autosave: Entwurf mit ausstehender Speicherung überlebt den Reload (LFH-521)', async ({
  page,
}) => {
  await entwurfsSpeicherungAnhalten(page);
  await anmelden(page);
  await einsatzAnlegenUndOeffnen(page, `E2E Autosave ausstehend ${Date.now()}`);
  const feld = page.getByPlaceholder('Inhalt …');
  await expect(feld).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __lfhHalten?: boolean }).__lfhHalten = true;
  });

  const entwurf = `Ausstehend, nicht gesendet ${Date.now()}`;
  await feld.fill(entwurf);
  // Vorbedingung, kein Speicher-Wartepunkt: der Schreibauftrag ist erteilt und hängt.
  await page.waitForFunction(
    () => ((window as typeof window & { __lfhGehalten?: number }).__lfhGehalten ?? 0) > 0,
  );

  await page.reload();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue(entwurf);
});

test('ETB-Entwurf-Autosave: bereits gespeicherter Entwurf kommt nach dem Reload vollständig zurück (LFH-521)', async ({
  page,
}) => {
  await anmelden(page);
  await einsatzAnlegenUndOeffnen(page, `E2E Autosave gespeichert ${Date.now()}`);

  const entwurf = `Gespeichert, nicht gesendet ${Date.now()}`;
  await page.getByPlaceholder('Inhalt …').fill(entwurf);
  // Hier IST der Wartepunkt die Aussage: der Entwurf liegt auf der Platte, und kein Vorlauf
  // (LFH-521) steht mehr aus — die Wiederherstellung trägt allein die IndexedDB.
  await page.waitForFunction(async (text) => {
    if (Object.keys(localStorage).some((k) => k.startsWith('lifeline-etb-entwuerfe-ausstehend')))
      return false;
    const db = await new Promise<IDBDatabase>((ok, fehler) => {
      const anfrage = indexedDB.open('lifeline-etb-entwuerfe');
      anfrage.onsuccess = () => ok(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
    });
    try {
      const alle = await new Promise<{ inhalt: string }[]>((ok, fehler) => {
        const anfrage = db.transaction('entwuerfe').objectStore('entwuerfe').getAll();
        anfrage.onsuccess = () => ok(anfrage.result as { inhalt: string }[]);
        anfrage.onerror = () => fehler(anfrage.error);
      });
      return alle.some((e) => e.inhalt === text);
    } finally {
      db.close();
    }
  }, entwurf);

  await page.reload();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue(entwurf);
});

/**
 * Das × verwirft einen Entwurf mit Inhalt erst nach der Rückfrage (LFH-957). Geklickt, nicht nur
 * gesehen (LFH-355): ein Knopf hinter einer Überdeckung bestünde ein `toBeVisible()`. Auch als
 * Führungspersonal, denn die Erfassung hängt an der Einsatzrolle (LFH-435).
 */
for (const rolle of ['admin', 'fuehrungspersonal'] as const) {
  test(`ETB-Entwurf verwerfen (${rolle}): × fragt nach, „Behalten“ hält den Text, „Verwerfen“ nimmt ihn`, async ({
    page,
  }) => {
    await anmelden(page);
    const id = await einsatzAnlegenUndOeffnen(page, `E2E Verwerfen ${Date.now()}`);
    if (rolle !== 'admin') {
      await wechsleZuRolle(page, rolle, id);
      await page.goto(`/einsaetze/${id}/etb`);
    }

    const feld = page.getByPlaceholder('Inhalt …');
    const inhalt = `Wasserstand Pegel Mühlbach ${Date.now()}`;
    await feld.fill(inhalt);
    await expect.poll(() => entwurfGesichert(page, inhalt)).toBe(true);

    const dialog = page.getByRole('dialog', { name: 'Entwurf verwerfen?' });
    await page.getByRole('button', { name: 'Entwurf verwerfen' }).click();
    await dialog.getByRole('button', { name: 'Behalten' }).click();
    await expect(dialog).toBeHidden();
    await expect(feld).toHaveValue(inhalt);

    await page.getByRole('button', { name: 'Entwurf verwerfen' }).click();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page.getByPlaceholder('Inhalt …')).toHaveValue('');
    await expect.poll(() => entwurfGesichert(page, inhalt)).toBe(false);
  });
}
