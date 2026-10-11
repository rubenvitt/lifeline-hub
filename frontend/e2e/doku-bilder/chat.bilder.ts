import { request } from '@playwright/test';
import { stehendeAuswahl, waehleIn } from '../auswahl-kern';
import { mitgliedEintragen } from '../rollen-kern';
import {
  KONTEXTE,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';
import { kontoAnlegen } from '../konto-anlegen';

/**
 * Bilder des Kapitels „Chat“ (`docs/anwender/kapitel/chat.md`, LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep chat`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   chat.png               frontend/src/pages/ChatPage.tsx, chat/KanalListe.tsx,
 *                          chat/NachrichtenStrom.tsx, chat/NachrichtEingabe.tsx
 *   zu-etb-heraufstufen.png  frontend/src/chat/HeraufstufenModal.tsx
 *
 * Der Demo-Einsatz hat keinen Chat. Die Spec schreibt deshalb in ihn (eine zweite Person über die
 * API, der Admin über die Oberfläche), liest am Ende jeden Kanal (kein Ungelesen-Zähler in
 * späteren Bildern) und trägt die zweite Person wieder aus. Ins ETB stuft sie nichts herauf: ein
 * ETB-Eintrag ist unveränderlich und stünde in jedem späteren ETB-Bild.
 */

const KAPITEL = 'chat';

test.describe(KAPITEL, () => {
  test('Chat eines Einsatzes', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const basis = `/api/einsaetze/${demo.id}`;

    // Zweite Person im Einsatz: Führungspersonal, schreibt über die API.
    const eva = { benutzername: 'e.beispiel', passwort: 'doku-passwort-123' };
    const { id: evaId } = await kontoAnlegen(page.request, {
      anzeigename: 'Eva Beispiel',
      ...eva,
    });
    await mitgliedEintragen(page, String(demo.id), evaId, 'fuehrungspersonal');
    const evaApi = await request.newContext({ baseURL: test.info().project.use.baseURL });
    expect((await evaApi.post('/api/auth/login', { data: eva })).ok()).toBe(true);

    // Der erste Abruf legt „Allgemein“ an.
    const kanalNamens = async (name: string) => {
      const antwort = await page.request.get(`${basis}/chat/kanaele`);
      expect(antwort.ok(), `Kanäle: ${antwort.status()}`).toBe(true);
      const kanal = ((await antwort.json()) as { id: number; name: string }[]).find(
        (k) => k.name === name,
      );
      expect(kanal, `Kanal ${name}`).toBeTruthy();
      return kanal!;
    };
    const allgemein = await kanalNamens('Allgemein');
    const evaSchreibt = async (kanalId: number, inhalt: string) => {
      const antwort = await evaApi.post(`${basis}/chat/kanaele/${kanalId}/nachrichten`, {
        data: { inhalt, anhang_ids: [] },
      });
      expect(antwort.ok(), `Nachricht: ${antwort.status()} ${await antwort.text()}`).toBe(true);
    };
    await evaSchreibt(
      allgemein.id,
      'Abschnitt Nord: Keller Lindenstraße 4 bis 12 vollgelaufen, wir brauchen zwei Tauchpumpen.',
    );

    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/chat`);
    const kanalListe = page.getByRole('region', { name: 'Kanäle' });
    const strom = page.getByTestId('nachrichten-strom');
    await expect(strom).toContainText('Keller Lindenstraße');

    // Kanal anlegen.
    await kanalListe.getByRole('button', { name: 'Kanal anlegen' }).click();
    const neuerKanal = page.getByRole('dialog', { name: 'Neuer Kanal' });
    await neuerKanal.getByLabel('Name').fill('Abschnitt Nord');
    await neuerKanal
      .getByLabel('Beschreibung (optional)')
      .fill('Absprachen mit der Abschnittsleitung');
    await neuerKanal.getByRole('button', { name: 'Anlegen' }).click();
    await expect(neuerKanal).toBeHidden();
    const nordZeile = kanalListe.locator('[data-lfh="kanal-zeile"]', { hasText: 'Abschnitt Nord' });
    await expect(nordZeile).toBeVisible();

    // Eva schreibt im neuen Kanal: dort steht ein ungelesener Zähler.
    const nord = await kanalNamens('Abschnitt Nord');
    await evaSchreibt(
      nord.id,
      'Zufahrt Lindenstraße nur über den Gartenweg, Hauptstraße überflutet.',
    );
    await expect(nordZeile.locator('[data-lfh="kanal-ungelesen"]')).toContainText('1');

    // Eigene Nachricht: Enter sendet.
    const eingabe = page.getByPlaceholder('Nachricht…');
    await eingabe.fill('Verstanden. Zwei Tauchpumpen vom Stützpunkt sind unterwegs.');
    await eingabe.press('Enter');
    await expect(strom).toContainText('Zwei Tauchpumpen vom Stützpunkt sind unterwegs.');
    await expect(eingabe).toHaveValue('');
    await eingabe.blur();
    // Fükw-Breite, aber niedriger: unter zwei Nachrichten stünde sonst eine leere Fläche.
    await page.setViewportSize({ width: KONTEXTE.fuekw.width, height: 560 });
    await expect(eingabe).toBeInViewport();
    await fotografiere(page, KAPITEL, 'chat');
    await page.setViewportSize(KONTEXTE.fuekw);

    // Menü einer fremden Nachricht: kein „Bearbeiten“, kein „Löschen“.
    const evasMenue = strom.getByRole('button', { name: /Aktionen zu Nachricht von Eva Beispiel/ });
    await evasMenue.click();
    let menue = page.getByRole('menu');
    await expect(menue.getByRole('menuitem', { name: 'Zu ETB' })).toBeVisible();
    await expect(menue.getByRole('menuitem', { name: 'Zu Auftrag' })).toBeVisible();
    await expect(menue.getByRole('menuitem', { name: 'Bezug' })).toBeVisible();
    await expect(menue.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);

    // Zu ETB heraufstufen: bis zum Dialog, nicht abgeschickt (siehe Kopf).
    await menue.getByRole('menuitem', { name: 'Zu ETB' }).click();
    const heraufstufen = page.getByRole('dialog', { name: 'Zu ETB heraufstufen' });
    await expect(heraufstufen.getByLabel('Text')).toHaveValue(/Keller Lindenstraße/);
    await expect(heraufstufen.getByTitle('Meldung', { exact: true })).toBeVisible();
    await heraufstufen.getByRole('combobox', { name: 'ETB-Typ' }).click();
    const typen = await stehendeAuswahl(page);
    for (const typ of ['Meldung', 'Anordnung', 'Lage', 'Entscheidung']) {
      await expect(typen.getByTitle(typ, { exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(typen).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Zeiger vom Typfeld weg: sonst trägt es den Hover-Rahmen.
    await page.mouse.move(0, 0);
    await fotografiere(heraufstufen, KAPITEL, 'zu-etb-heraufstufen');
    await heraufstufen.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(heraufstufen).toBeHidden();

    // Bezug setzen: Typ, dann Objekt.
    await evasMenue.click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Bezug' }).click();
    const bezug = page.getByRole('dialog', { name: 'Bezug setzen' });
    // UHS: der Demo-Einsatz hat Unfallhilfsstellen, aber keine Schadenstellen.
    await waehleIn(bezug.getByRole('combobox', { name: 'Typ' }), 'UHS');
    await bezug.getByRole('combobox', { name: 'Objekt' }).click();
    const objekte = await stehendeAuswahl(page);
    const erstes = objekte.locator('.ant-select-item-option').first();
    const objektName = (await erstes.getAttribute('title')) ?? '';
    expect(objektName).not.toBe('');
    await erstes.click();
    await bezug.getByRole('button', { name: 'Speichern' }).click();
    await expect(bezug).toBeHidden();
    await expect(strom.locator('.ant-tag', { hasText: objektName })).toBeVisible();
    await evasMenue.click();
    menue = page.getByRole('menu');
    await expect(menue.getByRole('menuitem', { name: 'Bezug ändern' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Eigene Nachricht bearbeiten und eine zweite löschen.
    const eigenesMenue = strom.getByRole('button', { name: /Aktionen zu Nachricht von / }).last();
    await eigenesMenue.click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Bearbeiten' }).click();
    const bearbeiten = page.getByRole('dialog', { name: 'Nachricht bearbeiten' });
    const text = bearbeiten.getByRole('textbox');
    await text.fill(
      'Verstanden. Zwei Tauchpumpen vom Stützpunkt sind unterwegs, Eintreffen in 15 Minuten.',
    );
    await bearbeiten.getByRole('button', { name: 'Speichern' }).click();
    await expect(bearbeiten).toBeHidden();
    await expect(strom).toContainText('Eintreffen in 15 Minuten.');
    await expect(strom.getByText('bearbeitet', { exact: true })).toBeVisible();

    await eingabe.fill('Lagemeldung bitte zur vollen Stunde.');
    await eingabe.press('Enter');
    await expect(strom).toContainText('Lagemeldung bitte zur vollen Stunde.');
    await strom
      .getByRole('button', { name: /Aktionen zu Nachricht von / })
      .last()
      .click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Löschen' }).click();
    const frage = page.getByRole('dialog', { name: 'Nachricht wirklich löschen?' });
    await frage.getByRole('button', { name: 'Ja, löschen' }).click();
    await expect(strom.getByText('Nachricht gelöscht')).toBeVisible();
    await expect(strom).not.toContainText('Lagemeldung bitte zur vollen Stunde.');

    // Aufräumen: den neuen Kanal lesen (der Zähler verschwindet), Eva austragen.
    await nordZeile.click();
    await expect(strom).toContainText('Gartenweg');
    await expect(nordZeile.locator('[data-lfh="kanal-ungelesen"]')).toHaveCount(0);
    await evaApi.dispose();
    await fuelle(page, 'delete', `${basis}/mitglieder/${evaId}`);
  });
});
