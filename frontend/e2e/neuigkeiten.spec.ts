import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kanalVon, zerlegeChangelog } from '../scripts/changelog-zerlegen.mjs';

/**
 * Neuigkeiten nach einem Update (Spec `neuigkeiten`, Change neuigkeiten-versionshinweise).
 *
 * Ein echtes Update lässt sich im e2e-Lauf nicht fahren: der Server trägt seine Version aus dem
 * Build. Der Test setzt deshalb den Lesestand in der Lauf-Datenbank auf die Version davor, so wie
 * ein Start nach einem Update ihn hinterließe. Die Version selbst liefert `/api/health`, die
 * Vorgänger liest der Test aus der `CHANGELOG.md` des Repos.
 *
 * Jeder Schritt ist ein Klick oder eine Anzeige, kein direkter Aufruf der Funktionen.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

function datenbank(): string {
  const lauf = process.env.LIFELINE_E2E_LAUF;
  if (!lauf) throw new Error('LIFELINE_E2E_LAUF fehlt — läuft der Test außerhalb der Suite?');
  return (JSON.parse(lauf) as { datenbank: string }).datenbank;
}

function setzeLesestand(version: string) {
  const db = new DatabaseSync(datenbank());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare(
      'UPDATE instanz_versionsstand SET gelesen_bis = ?, zuletzt_gestartet = ? WHERE id = 1',
    ).run(version, version);
  } finally {
    db.close();
  }
}

function lesestand(): string | null {
  const db = new DatabaseSync(datenbank());
  try {
    const zeile = db.prepare('SELECT gelesen_bis FROM instanz_versionsstand WHERE id = 1').get() as
      { gelesen_bis: string | null } | undefined;
    return zeile?.gelesen_bis ?? null;
  } finally {
    db.close();
  }
}

async function anmelden(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('nach einem Update: Karte, Punkt und Seite führen zum Lesestand', async ({
  page,
  request,
}) => {
  const health = (await (await request.get('/api/health')).json()) as { version: string };
  const eintraege = zerlegeChangelog(readFileSync(join(process.cwd(), '../CHANGELOG.md'), 'utf8'));
  const gleicherKanal = eintraege.filter((e) => e.kanal === kanalVon(health.version));
  expect(gleicherKanal[0].version, 'die laufende Version steht oben im Archiv').toBe(
    health.version,
  );
  const vorher = gleicherKanal[1].version;

  setzeLesestand(vorher);
  await anmelden(page);

  // Die Karte nennt die Versionen seit dem Lesestand.
  await expect(page.getByText(`Neu seit ${vorher}: 1 Version`)).toBeVisible();

  // Der Punkt am Benutzermenü zeigt die ungelesene Version.
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await expect(page.getByLabel('ungelesen')).toBeVisible();
  await page.getByRole('menuitem', { name: /Neuigkeiten/ }).click();

  // Die Seite öffnet mit dem Abschnitt seit der letzten Version und markiert die Version als gelesen.
  await expect(page).toHaveURL(/\/neuigkeiten$/);
  await expect(page.getByText('Seit deiner letzten Version')).toBeVisible();
  await expect.poll(lesestand).toBe(health.version);

  // Zurück auf die Einsatzliste ist die Karte weg.
  await page.goto('/einsaetze');
  await expect(page.getByText(/Neu seit/)).toHaveCount(0);
});
