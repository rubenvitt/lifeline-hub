import { einsatzDialogOeffnen } from '../einsatz-kern';
import { KONTEXTE, anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatz auswählen und Oberfläche“
 * (`docs/anwender/kapitel/einsatz-oberflaeche.md`, LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatz-oberflaeche`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   einsatzliste.png    frontend/src/pages/EinsaetzePage.tsx
 *   arbeitsflaeche.png  frontend/src/einsatz/EinsatzLayout.tsx, einsatz/IconRail.tsx,
 *                       einsatz/ModulPanel.tsx, components/Kopfleiste.tsx,
 *                       einsatz/AlarmZentrale.tsx, pages/lage-dashboard/
 *   sprungpalette.png   frontend/src/command-palette/CommandPalette.tsx
 *   darstellung.png     frontend/src/components/BenutzerMenu.tsx
 */

const KAPITEL = 'einsatz-oberflaeche';

test.describe(KAPITEL, () => {
  test('Einsatzliste', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    // Fükw-Breite, aber nur so hoch wie Kopf und erste Kachelreihe: unter dem Raster ist die
    // Seite leer.
    await page.setViewportSize({ width: KONTEXTE.fuekw.width, height: 300 });
    await page.goto('/einsaetze');
    const kachel = page.locator('[data-lfh="einsatzkachel"]', { hasText: demo.bezeichnung });
    await expect(kachel).toBeVisible();
    await expect(kachel).toContainText('Deine Rolle: Einsatzleitung');
    const raster = page.getByTestId('einsaetze-raster');
    await expect(raster.getByRole('button', { name: 'Neuer Einsatz' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'einsatzliste');
    await page.setViewportSize(KONTEXTE.fuekw);

    // Nachgeklickt, aber nicht angelegt: ein zweiter Einsatz stünde in jedem späteren Bild.
    const dialog = await einsatzDialogOeffnen(page);
    for (const feld of ['Bezeichnung', 'Stichwort', 'Einsatzart', 'Alarmzeit']) {
      await expect(dialog.getByLabel(feld)).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();

    // Die Kachel öffnet den Einsatz, der Wechsler führt zurück zur Liste.
    await kachel.getByRole('link', { name: demo.bezeichnung }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/`));
    await page.locator('[data-lfh="kopf-einsatzname"]').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Alle Einsätze …' }).click();
    await expect(page).toHaveURL(/\/einsaetze$/);
  });

  test('Arbeitsfläche eines Einsatzes', async ({ page }) => {
    // Benachrichtigungen erlaubt wie an einem eingerichteten Gerät. Headless-Chromium meldet sie
    // stets als verweigert (auch nach `grantPermissions`), und die Kopfzeile zeigte
    // „Benachrichtigung blockiert“.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    });
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}`);
    // Ohne Wahl startet ein Einsatz im Überblick, das Panel steht ab `xl` offen.
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/ueberblick`));
    await expect(page.getByRole('heading', { level: 1, name: 'Überblick' })).toBeVisible();
    const kategorien = page.getByRole('navigation', { name: 'Kategorien' });
    await expect(kategorien.getByRole('button', { name: 'Führung' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-lfh="kopf-sync"]')).toHaveAttribute(
      'data-zustand',
      'verbunden',
    );
    await expect(page.getByRole('button', { name: 'Benachrichtigung erlaubt' })).toBeVisible();
    // Die Kennzahlen des Überblicks tragen Inhalt, bevor das Bild entsteht.
    await expect(page.getByRole('button', { name: 'Einsatzdaten' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'arbeitsflaeche');

    // Rail-Sprung: die Kategorie öffnet ihr erstes Modul.
    await kategorien.getByRole('button', { name: 'Kommunikation' }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/chat`));
    // „Menü“ klappt die Modulliste ein und wieder aus.
    await kategorien.getByRole('button', { name: 'Menü einklappen' }).click();
    await expect(kategorien.getByRole('button', { name: 'Menü ausklappen' })).toBeVisible();
    await kategorien.getByRole('button', { name: 'Menü ausklappen' }).click();
    await expect(kategorien.getByRole('button', { name: 'Menü einklappen' })).toBeVisible();
  });

  test('Sprungpalette', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await expect(page.getByRole('heading', { level: 1, name: 'Überblick' })).toBeVisible();
    await page.keyboard.press('Control+K');
    const feld = page.getByPlaceholder('Suchen: Module, Aktionen, Einstellungen …');
    await expect(feld).toBeFocused();
    await feld.fill('betr');
    const liste = page.locator('#cmd-liste');
    await expect(liste.getByRole('option', { name: /Betroffene/ }).first()).toBeVisible();
    await expect(liste.getByRole('option', { name: /Betreuung/ }).first()).toBeVisible();
    await fotografiere(page.locator('.ant-modal-container'), KAPITEL, 'sprungpalette');

    // ↵ öffnet den ersten Treffer, Esc schließt.
    await feld.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/(personen|betreuung)`));
    await page.keyboard.press('Control+K');
    await expect(feld).toBeFocused();
    await feld.fill('>');
    await expect(page.locator('[data-lfh="palette-modus"]')).toHaveText('Nur Aktionen');
    await feld.press('Escape');
    await expect(feld).toBeHidden();
  });

  test('Benutzermenü mit Darstellung, Bediendichte und Helligkeit', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    // Außerhalb eines Einsatzes: im Demo-Einsatz gilt eine Warnung (Warnstufe „hoch“), und die
    // dunklen Stufen stünden gesperrt da. Die Sperre prüft der Test unten im Einsatz.
    await page.goto('/einsaetze');
    await expect(
      page.locator('[data-lfh="einsatzkachel"]', { hasText: demo.bezeichnung }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    const menue = page.getByRole('menu');
    // Der Lauf stellt hell und kompakt ein (`playwright.doku.config.ts`); die Wahl trägt ✓.
    await expect(menue.getByRole('menuitem', { name: 'Hell ✓' })).toBeVisible();
    await expect(menue.getByRole('menuitem', { name: 'Kompakt ✓' })).toBeVisible();
    await expect(menue.getByRole('menuitem', { name: '100 % ✓' })).toBeVisible();
    await fotografiere(menue, KAPITEL, 'darstellung');

    // Nachgeklickt: eine Stufe wirkt sofort und bleibt gewählt.
    await menue.getByRole('menuitem', { name: '60 %', exact: true }).click();
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: '60 % ✓' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Im Einsatz mit Warnung: Boden 80 %, die Wahl bleibt stehen und nennt, was wirkt.
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await expect(page.getByRole('heading', { level: 1, name: 'Überblick' })).toBeVisible();
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    const imEinsatz = page.getByRole('menu');
    await expect(imEinsatz.getByText('Helligkeit · mind. 80 % (Warnung aktiv)')).toBeVisible();
    await expect(imEinsatz.getByRole('menuitem', { name: '60 % ✓ (wirkt 80 %)' })).toBeVisible();
    // Zurück auf 100 %, damit spätere Bilder hell bleiben (die Wahl liegt im Speicher des Geräts).
    await imEinsatz.getByRole('menuitem', { name: '100 %', exact: true }).click();
  });
});
