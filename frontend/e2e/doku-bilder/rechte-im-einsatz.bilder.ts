import { waehleIn, zeigtWahl } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Rechte im Einsatz“ (`docs/anwender/kapitel/rechte-im-einsatz.md`,
 * LFH-1129).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep rechte-im-einsatz`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zugriff.png  frontend/src/pages/MitgliederAbschnitt.tsx
 *
 * Die aufgenommene Person wird am Ende wieder entfernt (über die Oberfläche, das ist der zweite
 * Ablauf des Kapitels): Spätere Bilder zeigen den Zugriff des Demo-Einsatzes unverändert.
 */

const KAPITEL = 'rechte-im-einsatz';

test.describe(KAPITEL, () => {
  test('Abschnitt „Zugriff“ der Einsatzdaten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await fuelle(page, 'post', '/api/benutzer', {
      anzeigename: 'Lea Probe',
      benutzername: 'l.probe',
      passwort: 'doku-passwort-123',
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
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
});
