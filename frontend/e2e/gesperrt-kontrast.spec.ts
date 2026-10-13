import { expect, test, type Page } from '@playwright/test';
import { einsatzEinstellungenPfad } from '../src/routing/deeplinks';
import { LETZTE_EINSATZLEITUNG_TEXT } from '../src/stammdaten/rechteText';
import { pruefe } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Schrift gesperrter Knöpfe, Tag und Nacht (LLH-1228). antd leitete `colorTextDisabled` aus 25 %
 * Deckkraft ab; ein gesperrter Knopf lag auf seiner Sperrfläche Tag bei 1,81, Nacht bei 2,28.
 * Gesperrtes hält den Gesperrt-Boden ≥ 4,5 : 1 (Spec `textstufen-kontrast`), als Literal.
 * Gerechnet steht dasselbe in `src/theme/gesperrtKontrast.test.ts`; hier zählt, was der Browser
 * wirklich zeichnet, Sperrfläche und Grund darunter komponiert.
 *
 * GEMESSEN in der Zugriffsverwaltung eines frischen Einsatzes, beides stehend gesperrt:
 * „Hinzufügen“ (Primärknopf ohne gewählte Person) und „Entfernen“ an der einzigen Leitung
 * (Gefahrknopf, gesperrt mit Grund, LFH-966). Die Sperre ist Vorbedingung, sonst mäße der Spec
 * einen freien Knopf.
 */

const GESPERRT_BODEN = 4.5;

async function einsatzAnlegen(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Gesperrt-Kontrast ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

for (const modus of ['light', 'dark'] as const) {
  test(`Gesperrte Knöpfe halten den Gesperrt-Boden — ${modus}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await page.goto(einsatzEinstellungenPfad(id, 'zugriff'));

    const zugriff = page.getByRole('region', { name: 'Zugriff' });
    const hinzufuegen = zugriff.getByRole('button', { name: 'Hinzufügen' });
    const zeile = zugriff.getByRole('row').filter({ hasText: LETZTE_EINSATZLEITUNG_TEXT });
    const entfernen = zeile.getByRole('button', { name: 'Entfernen' });

    // Vorbedingung: beide Knöpfe stehen gesperrt.
    await expect(hinzufuegen).toBeDisabled();
    await expect(entfernen).toBeDisabled();

    await pruefe(hinzufuegen, GESPERRT_BODEN, `${modus}/Hinzufügen`);
    await pruefe(entfernen, GESPERRT_BODEN, `${modus}/Entfernen`);
  });
}
