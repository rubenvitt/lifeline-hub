import { waehleIn, zeigtWahl } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Rechte im Einsatz“ (`docs/anwender/kapitel/rechte-im-einsatz.md`,
 * LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep rechte-im-einsatz`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zugriff.png          frontend/src/pages/MitgliederAbschnitt.tsx,
 *                        frontend/src/pages/einstellungen/EinsatzZugriff.tsx
 *   mitglied-stelle.png  frontend/src/pages/MitgliederAbschnitt.tsx (FuehrungsstelleModal)
 *
 * Die aufgenommene Person wird am Ende wieder entfernt (über die Oberfläche, das ist der zweite
 * Ablauf des Kapitels): Spätere Bilder zeigen den Zugriff des Demo-Einsatzes unverändert.
 */

const KAPITEL = 'rechte-im-einsatz';

test.describe(KAPITEL, () => {
  test('Reiter „Zugriff“ der Einstellungen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await fuelle(page, 'post', '/api/benutzer', {
      anzeigename: 'Lea Probe',
      benutzername: 'l.probe',
      passwort: 'doku-passwort-123',
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/zugriff`);
    const zugriff = page.getByRole('region', { name: 'Zugriff' });
    await expect(zugriff.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();

    // Aufnehmen: Person, Rolle, „Hinzufügen“.
    const auswahl = zugriff.getByRole('combobox');
    await waehleIn(auswahl.nth(0), 'Lea Probe');
    await waehleIn(auswahl.nth(1), 'Führungspersonal');
    await zugriff.getByRole('button', { name: 'Hinzufügen' }).click();
    const rolle = zugriff.getByRole('combobox', { name: 'Rolle von Lea Probe' });
    await expect(rolle).toBeVisible();
    await zeigtWahl(rolle, 'Führungspersonal');
    await expect(zugriff.getByText('Gesperrt: letzte Einsatzleitung')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await fotografiere(zugriff, KAPITEL, 'zugriff');

    // Rolle ändern, dann entziehen.
    await waehleIn(rolle, 'Beobachter');
    const zeile = zugriff.getByRole('row').filter({ hasText: 'Lea Probe' });
    await zeile.getByRole('button', { name: 'Entfernen' }).click();
    const frage = page.locator('.ant-popconfirm').filter({ hasText: 'Mitglied entfernen?' });
    await frage.getByRole('button', { name: 'Entfernen' }).click();
    await expect(zugriff.getByRole('combobox', { name: 'Rolle von Lea Probe' })).toHaveCount(0);
  });

  test('Dialog „Führungsstelle für …“ eines Mitglieds', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const mitglieder = (await (
      await page.request.get(`/api/einsaetze/${demo.id}/mitglieder`)
    ).json()) as { benutzer_id: number; einsatz_rolle: string; fuehrungsfunktion: string | null }[];
    const leitung = mitglieder.find((m) => m.einsatz_rolle === 'einsatzleitung');
    expect(leitung, 'der Demo-Einsatz hat eine Einsatzleitung').toBeDefined();
    if (!leitung!.fuehrungsfunktion) {
      await fuelle(page, 'put', `/api/einsaetze/${demo.id}/mitglieder/${leitung!.benutzer_id}`, {
        einsatz_rolle: 'einsatzleitung',
        fuehrungsfunktion: 'el',
        fuehrungsstelle: null,
      });
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einstellungen/zugriff`);
    await page.getByRole('button', { name: /^Führungsstelle für .+ bearbeiten$/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Führungsstelle für / });
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    // Der Fokus stünde sonst im Feld (Fokusring und Cursor im Bild).
    await dialog.getByRole('combobox', { name: 'Führungsstelle' }).blur();
    await fotografiere(dialog, KAPITEL, 'mitglied-stelle');
  });
});
