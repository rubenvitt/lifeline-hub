import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Arbeiten ohne Netz“ (`docs/anwender/kapitel/ohne-netz.md`, LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep ohne-netz`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   etb-ohne-netz.png  frontend/src/live/LiveStatusBanner.tsx, components/Kopfleiste.tsx,
 *                      components/Datenstand.tsx, etb/EtbZeitachse.tsx, etb/Schnellerfassung.tsx
 *
 * Der vorgemerkte Eintrag geht nie hinaus: Der Test endet ohne Netz, und mit dem Browserkontext
 * verschwindet die Warteschlange. Ein gesendeter ETB-Eintrag stünde unveränderlich in jedem
 * späteren ETB-Bild.
 */

const KAPITEL = 'ohne-netz';

test.describe(KAPITEL, () => {
  test('Einsatztagebuch ohne Netz mit vorgemerktem Eintrag', async ({ page, context }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/etb`);
    const feld = page.getByPlaceholder(/Inhalt/);
    await expect(feld).toBeVisible();
    await expect(page.locator('[data-lfh="kopf-sync"]')).toHaveAttribute(
      'data-zustand',
      'verbunden',
    );

    await context.setOffline(true);
    // Kopfzeile, Seitenkopf und Betriebszeile zeigen das fehlende Netz.
    await expect(page.locator('[data-lfh="kopf-sync"]')).toHaveAttribute('data-zustand', 'offline');
    await expect(page.getByText(/^Stand \d\d:\d\d · offline$/)).toBeVisible();
    await expect(page.getByText('Offline — keine Verbindung zum Server.')).toBeVisible();

    // Erfassen wie mit Netz: der Eintrag wird vorgemerkt.
    await feld.fill('Funkmeldung Abschnitt Nord: Pegel am Mühlbach steigt weiter.');
    await feld.press('Enter');
    const ausstehend = page.locator('.etb-ausstehend');
    await expect(ausstehend).toContainText('Pegel am Mühlbach');
    await expect(ausstehend).toContainText('vorgemerkt');
    await expect(page.getByLabel('1 ausstehende Offline-Aktion')).toContainText('ausstehend');
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await fotografiere(page, KAPITEL, 'etb-ohne-netz');
    // Kein `setOffline(false)`: der Eintrag bliebe nicht vorgemerkt, sondern ginge ins ETB.
  });
});
