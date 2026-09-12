import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke der Lagekarte: das EINZIGE automatisierte Netz unter MapLibre/WebGL.
//
// Warum es diese Datei gibt: `Kartenflaeche.tsx` ist die einzige Stelle, die
// `new maplibregl.Map` aufruft — und sie wurde von KEINEM Test je ausgeführt.
// `LagekartePage.test.tsx` stubbt die Komponente komplett weg, alle übrigen
// Lagekarten-Unit-Tests arbeiten mit `import type` (wegkompiliert) oder handgebauten
// `fakeMap()`-Attrappen. Ein Bruch in MapLibre selbst (Versionswechsel, ESM-Interop,
// WebGL-Anforderung) oder im terra-draw-Adapter blieb damit vollständig unsichtbar:
// die Suite wäre grün und die Karte tot. jsdom kann das prinzipiell nicht abdecken
// (kein Layout, kein WebGL); Playwright-Chromium liefert WebGL2 via SwiftShader.
//
// `page.on('pageerror')` ist der Backstop für die Fehler, die KEINE Spur im DOM
// hinterlassen — ein geworfener Fehler in einem Timer, einem Karten-Callback oder einem
// async Handler, der die Karte trotzdem stehen lässt. Der Listener ist scharf: mit einem
// injizierten `setTimeout(() => { throw … })` im Map-Init-Effekt wird die letzte Zeile
// dieses Tests rot (gemessen, 2× wegen StrictMode). Für einen Fehler im Render oder im
// Effekt selbst greifen dagegen schon die DOM-Assertionen darüber: `LagekartePage` kommt
// per `lazy()`, im gesamten `src/` gibt es KEINE ErrorBoundary — der React-Root reißt
// also ab und die Karte fehlt schlicht. Genau diesen Fall übersieht der bestehende
// Palette-Test (command-palette.spec.ts), der die Lagekarte zwar öffnet, aber nur URL
// und Palettenzustand prüft — beides überlebt eine leere Seite.
//
// Deterministisch ohne Netzwerk: die e2e-Suite fährt auf einer frischen Temp-DB ohne
// konfigurierte Basemap. `baueBasemapStyle` fällt dann auf `blindStyle` zurück
// (`sources: {}` + ein Background-Layer). Die Map konstruiert also garantiert, Canvas
// und Controls erscheinen — und es wird nie eine Kachel geladen. Der Test hängt damit
// weder an einem Tile-Server noch an Seed-Daten.
//
// DIESE ENTSCHEIDUNG BLEIBT, und der Kachel-Pfad ist trotzdem geprüft — nur nicht hier
// (LFH-356). Wer eine Zusicherung über Kacheln, `transformRequest`/`absolutiereProxyAnfrage`
// oder den Offline-Vorratscache des Tile-Workers sucht oder ergänzen will, findet sie in
// `lagekarte-kachelpfad.spec.ts` (Fixture-Basemap per `page.route`, Vector-Source durch den
// Worker) und `lagekarte-offline-precache.spec.ts` (Prod-Bundle vom e2e-Backend, Service
// Worker, `setOffline`). Diese Datei bleibt der schnelle, quellenlose Lebensnachweis.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Minimalausschnitt der MapLibre-Instanz, den `window.__lfhKarte` (DEV-Haken in
 * Kartenflaeche.tsx) für diesen Test bereitstellen muss. Bewusst NICHT der echte
 * maplibre-Typ: der Spec-Ordner soll nicht gegen die Karten-Bibliothek binden, und ein
 * Versionssprung darf diesen Test nicht typseitig mitreißen — er soll ihn fachlich prüfen.
 */
interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  isSourceLoaded(id: string): boolean;
  loaded(): boolean;
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  // Der Name darf KEINEN Modulnamen enthalten. Alle Specs teilen sich eine Datenbank, und
  // die Kommandopalette durchsucht Module UND Einsätze in derselben Optionsliste. Ein
  // Einsatz „E2E Lagekarte …" ließ command-palette.spec.ts mit einer strict-mode-Verletzung
  // scheitern (`getByRole('option', { name: /Lagekarte/ })` traf 2 Elemente) — und zwar nur
  // je nach Worker-Reihenfolge, also als Flake (gemessen: 1/0/2 Fehlschläge in 3 Läufen).
  await page.getByLabel('Bezeichnung').fill(`E2E Kartensmoke ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
}

test('Lagekarte: MapLibre startet, Controls leben, terra-draw greift', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/lagekarte`);

  // Anker statt Timeout: der Container gehört React, das Canvas erzeugt erst MapLibre.
  // `LagekartePage` kommt per lazy() und zeigt bis zur geladenen Karten-Config ein Spin —
  // auf ein festes Warteintervall wäre hier kein Verlass.
  const karte = page.getByTestId('kartenflaeche');
  await expect(karte).toBeVisible();

  const canvas = karte.locator('canvas.maplibregl-canvas');
  // GENAU eins, nicht „mindestens eins": unter Vite-Dev ist React StrictMode AN, der
  // Map-Init-Effekt läuft also doppelt. Bliebe das Cleanup (`map.remove()`) aus oder
  // würde es in einer neuen MapLibre-Version anders greifen, stünden zwei Canvas im
  // Container — sichtbar wäre die Karte trotzdem. toHaveCount(1) fängt genau das und
  // wartet dabei das StrictMode-Remount-Fenster aus.
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();

  // NavigationControl lebt: beweist, dass die Map nicht nur konstruiert wurde, sondern
  // ihr Control-/DOM-Gerüst aufgebaut hat.
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();

  // Und jetzt das, was das DOM NICHT verrät: arbeitet die Karte überhaupt?
  // Alles oben — Canvas, `toHaveCount(1)`, Controls, weiter unten der Cursor — ist auch dann
  // grün, wenn der maplibre-Tile-Worker tot ist. Gemessen mit einer stummen `window.Worker`-
  // Attrappe: fünf von fünf Assertionen grün, keine `pageerror`, während real nur 1 statt 6
  // Quellen existierten, `isSourceLoaded` false war und `map.loaded()` false blieb — also keine
  // Marker, keine Zonen, keine Fachebenen, kein `load`-Event. Eine tote Karte, die aussieht wie
  // eine lebende. Seit maplibre 6 hängt genau das an einer explizit verdrahteten Worker-URL
  // (`setWorkerUrl` in Kartenflaeche.tsx), deren Fehlkonfiguration mit exit 0 durchläuft.
  //
  // `map.loaded()` ist der eine Boolean, der kippt: er verlangt geladenen Style UND geladene
  // Quellen, und die GeoJSON-Quellen gehen zwingend durch den Worker — auch ohne Basemap, ohne
  // eine einzige Kachel.
  //
  // Geprüft wird bewusst NUR `loaded()`, nicht „alle Quellen sind geladen": `isSourceLoaded` je
  // Quelle flapt, weil der React-Datenpfad `setData` nachzieht und jede Neuzuweisung die Quelle
  // bis zur Worker-Antwort wieder als ungeladen führt — gemessen, `abschnitte` blieb 15 s false,
  // während die Karte längst arbeitete. Eine Assertion darauf wäre ein Flake mit Ansage. Die
  // ungeladenen Quellen kommen trotzdem mit, aber als DIAGNOSE in der Fehlermeldung, nicht als
  // Bedingung — damit ein Fehlschlag zeigt, WO es klemmt, statt nur „false".
  //
  // FALLE für den nächsten, der das hier „schärfer" machen will: `map.areTilesLoaded()` klingt
  // nach der eigentlich richtigen Prüfung und ist wertlos — bei stummem Worker gemessen TRUE
  // (Vergleichsmessung lebend/tot: loaded true/false, areTilesLoaded true/TRUE). Wer darauf
  // umstellt, baut eine Zeile ein, die nie anschlägt.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return 'kein Karten-Handle (window.__lfhKarte fehlt)';
          const quellen = Object.keys(map.getStyle()?.sources ?? {});
          // Zweiter, von maplibre ENTKOPPELTER Beleg: die Quellenzahl misst unser eigenes
          // Verhalten statt einen Bibliotheks-Boolean, dessen Semantik ein v7 stillschweigend
          // ändern könnte. Gemessen: 6 Quellen bei lebender Karte, 1 bei totem Worker — alles
          // außer `abschnitte` legt erst der `load`-Handler an, und `load` feuert nur, wenn der
          // Worker antwortet. Die Zahl steigt monoton (nichts entfernt Quellen wieder), flapt
          // also nicht wie `isSourceLoaded`. Schwelle bewusst locker, damit ein Umbau der
          // Kartenebenen den Test nicht grundlos rot färbt.
          if (quellen.length < 2) return `nur ${quellen.length} Quelle(n): ${quellen.join(', ')}`;
          if (map.loaded()) return 'geladen';
          const ungeladen = quellen.filter((q) => !map.isSourceLoaded(q));
          return `map.loaded() ist false; ungeladen: ${ungeladen.join(', ') || '(keine)'}`;
        }),
      {
        timeout: 15_000,
        message: 'Karte wird nie fertig — Verdacht: maplibre-Worker antwortet nicht',
      },
    )
    .toBe('geladen');

  // Zeitachse einklappen — nicht kosmetisch, sondern Voraussetzung: die ausgeklappte
  // SnapshotLeiste liegt mit `left:12/right:12` über die volle Kartenbreite, bei gleichem
  // zIndex (5) wie die ZeichnenSteuerung und später im DOM. Sie überdeckt deren Buttons
  // daher vollständig (gemessen: Klick auf „Abbrechen" läuft in den Timeout, „<div>
  // intercepts pointer events"). `toBeVisible()` würde das NICHT bemerken — CSS-Sichtbarkeit
  // ist keine Klickbarkeit. Eingeklappt schrumpft die Leiste auf einen Button unten links.
  await page.getByRole('button', { name: 'Zeitachse ausblenden' }).click();

  // terra-draw: der Adapter ruft beim Start `addSource`/`addLayer` auf der Map auf und
  // setzt den Cursor über `map.getCanvas().style.cursor`. Der Cursor ist der einzige
  // DOM-sichtbare Beleg, dass der Adapter die Map wirklich übernommen hat — und er ist
  // nicht redundant: die „Abschließen"/„Abbrechen"-Buttons kommen aus reinem React-State
  // und stehen auch dann da, wenn terra-draw gar nichts tut. Gemessen mit einem
  // no-op-`starten()`: Buttons grün, Cursor rot („grab" statt „crosshair"). Ein
  // Versionswechsel, der den Adapter still wirkungslos macht, hinge allein an dieser Zeile.
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');

  // Abbrechen fährt `stoppen()` → `draw.stop()` → Adapter-`unregister()` mit
  // `removeLayer`/`removeSource`. Der Abbau ist eine eigene MapLibre-API-Fläche und
  // damit eine eigene Bruchstelle — deshalb wird er mitgelaufen, nicht nur der Aufbau.
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
