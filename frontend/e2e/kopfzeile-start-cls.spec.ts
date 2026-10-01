import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts } from './cls-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-637: Der Seitenstart einer Einsatzseite bleibt auf dem Führungs-Tablet (1024 px) unter
 * CLS 0,1 (Kriterium 12, Spec `einsatztauglichkeit-layout`).
 *
 * Der Befund: Die Alarmzentrale zeigte den Tonstatus vor der ersten Antwort der Audio-Prüfung
 * als „Ton blockiert" an. Mit „Desktop blockiert" und „VERBINDE" brach die Kopfzeile für etwa
 * 0,5 s auf zwei Reihen um und schob die ganze Fläche 52 px nach unten (CLS 0,46). Das traf nur
 * Läufe, in denen die Prüfung langsam antwortet; unter macOS und in schnellen Läufen stand der
 * Status schon beim ersten Bild fest. Deshalb HÄLT die Spec die Prüfung an: `resume()` antwortet
 * erst nach {@link PRUEFUNG_MS}, und bis dahin meldet der AudioContext `suspended`. So misst jeder
 * Lauf den langsamen Fall, statt vom Tempo der Maschine abzuhängen.
 *
 * `/einsatzdaten` mit Absicht: eine Route ohne eigenes Nachladen, an der jeder Shift der
 * Kopfzeile gehört. Zwei Rollen (LFH-435): der Benutzerkopf trägt die Einsatzfunktion, seine
 * Breite hängt also an der Rolle.
 */

/** Der „gut"-Schwellwert für CLS (https://web.dev/articles/cls) als Literal. */
const CLS_GUT = 0.1;

/** Führungs-Tablet aus der Bedien-Leitlinie. */
const TABLET = { width: 1024, height: 768 };

/** So lange antwortet die Audio-Prüfung nicht — länger als das Ruhefenster aus `cls-kern`. */
const PRUEFUNG_MS = 1500;

/**
 * Verzögert die Audio-Prüfung für jedes Dokument dieser Seite. `state` meldet `suspended`, bis
 * das verzögerte `resume()` durch ist; sonst übersprangen Läufe mit autoplay-freiem Chromium die
 * Prüfung ganz. `__lfhAudioFrei` sagt dem Test, wann die Prüfung geantwortet hat.
 */
async function haelteAudioPruefungAn(page: Page) {
  await page.addInitScript((verzoegerung: number) => {
    const AC = window.AudioContext;
    if (!AC) return;
    const w = window as unknown as { __lfhAudioFrei: boolean };
    w.__lfhAudioFrei = false;
    const basis = Object.getPrototypeOf(AC.prototype) as object;
    const stateEcht = Object.getOwnPropertyDescriptor(basis, 'state')!.get!;
    Object.defineProperty(AC.prototype, 'state', {
      configurable: true,
      get(this: AudioContext) {
        return w.__lfhAudioFrei ? stateEcht.call(this) : 'suspended';
      },
    });
    const resumeEcht = AC.prototype.resume;
    AC.prototype.resume = function (this: AudioContext) {
      return new Promise<void>((fertig) => setTimeout(fertig, verzoegerung))
        .then(() => resumeEcht.call(this))
        .finally(() => {
          w.__lfhAudioFrei = true;
        });
    };
  }, PRUEFUNG_MS);
}

async function einsatzAnlegen(page: Page): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Kopfstart ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

/**
 * Misst den Seitenstart in einem frischen Dokument: Navigation, Prüfung läuft, Prüfung antwortet,
 * Ruhe. Die Vorbedingung „Prüfung läuft noch" wird VOR der Antwort belegt — sonst wäre ein grüner
 * Lauf auch einer, in dem die Prüfung schon beim ersten Bild fertig war.
 */
async function messeSeitenstart(page: Page, einsatzId: string, rolle: string) {
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  const alarm = page.locator('[data-lfh="kopf-alarm"]');
  await expect(alarm, `${rolle}: Alarmzentrale steht`).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __lfhAudioFrei: boolean }).__lfhAudioFrei),
    `${rolle}: Vorbedingung — die Audio-Prüfung läuft noch`,
  ).toBe(false);
  // Der ungeprüfte Ton ist keine Störung und trägt kein Wort. EINE Lesung statt
  // `not.toContainText`: die Zusicherung wiederholt sich, bis sie passt, und wartete damit
  // genau das Ende der Prüfung ab, das sie ausschließen soll.
  expect(await alarm.textContent(), `${rolle}: ungeprüft heißt nicht „blockiert"`).not.toContain(
    'Ton',
  );

  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __lfhAudioFrei: boolean }).__lfhAudioFrei),
      { message: `${rolle}: die Audio-Prüfung muss antworten`, timeout: 10_000 },
    )
    .toBe(true);
  const messung = await ruheShifts(page);
  test.info().annotations.push({ type: 'messwert', description: `${rolle}: ${bericht(messung)}` });
  expect(
    messung.summe,
    `${rolle} — Seitenstart bei 1024 px: ${bericht(messung)}`,
  ).toBeLessThanOrEqual(CLS_GUT);
}

test('Kopfzeile: der Seitenstart bei 1024 px bleibt unter CLS 0,1, auch wenn die Audio-Prüfung zögert', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(TABLET);
  await beobachteShifts(page);
  await haelteAudioPruefungAn(page);
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);

  await messeSeitenstart(page, einsatzId, 'Admin');

  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await messeSeitenstart(page, einsatzId, 'Beobachter');
});
