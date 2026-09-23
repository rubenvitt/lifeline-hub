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
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
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

/**
 * Zeichnen-Steuerung und Zeitachse dürfen sich nicht überlagern (LFH-355, AK3).
 *
 * Gemessen wird mit echten Bounding-Boxen, weil genau das in jsdom nicht geht — die
 * Vitest-Seite (`KartenFuss.test.tsx` und die beiden Band-Tests) kann nur die Struktur
 * pinnen, aus der die Zusicherung folgt. Die Rechnung ist die gewöhnliche
 * Rechteck-Schnittmenge: überlappt wird nur, wenn sich BEIDE Achsen überschneiden.
 */
async function ohneUeberdeckung(page: Page, wo: string) {
  const steuerung = page.locator('[data-lfh="karten-fuss"] > .ant-card');
  const zeitachse = page.locator('[data-lfh="zeitachse"]');
  const a = await steuerung.boundingBox();
  const b = await zeitachse.boundingBox();
  expect(a, `${wo}: Zeichnen-Steuerung hat keine Box`).not.toBeNull();
  expect(b, `${wo}: Zeitachse hat keine Box`).not.toBeNull();
  const ueberlappt =
    a!.x < b!.x + b!.width &&
    b!.x < a!.x + a!.width &&
    a!.y < b!.y + b!.height &&
    b!.y < a!.y + a!.height;
  expect(
    ueberlappt,
    `${wo}: Steuerung ${JSON.stringify(a)} überlappt Zeitachse ${JSON.stringify(b)}`,
  ).toBe(false);
  // Und zwar in der gemeinten Richtung: die Steuerung schwenkt ÜBER der Leiste ein,
  // statt sich irgendwo daneben zu verstecken.
  expect(a!.y + a!.height, `${wo}: Steuerung steht nicht über der Zeitachse`).toBeLessThanOrEqual(
    b!.y,
  );
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

  // Das Control-Gerüst der Map lebt: beweist, dass sie nicht nur konstruiert wurde, sondern
  // ihr Control-/DOM-Gerüst aufgebaut hat. Seit dem Neuentwurf (S5) gibt es kein
  // `NavigationControl` mehr — Zoom/Nordung/Zeichnen sind eigene Knöpfe über der Karte. Das
  // MapLibre-eigene Control, das bleibt, ist die `AttributionControl`; dazu die
  // Maßstabsleiste, die MapLibre selbst in das Band des Kartenfußes schreibt (`ScaleControl`
  // über `onAdd`) — sie trägt nur Text, wenn die Map ihr erstes `move` gerechnet hat.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached();
  await expect(page.locator('[data-lfh="massstab"] .maplibregl-ctrl-scale')).toHaveText(/\d/);
  await expect(page.getByRole('button', { name: 'Hineinzoomen' })).toBeVisible();

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

  // DEFAULT-ZUSTAND, ausdrücklich (LFH-355). Bis dahin klappte dieser Test die Zeitachse
  // hier ein — nicht kosmetisch, sondern als Umgehung: die ausgeklappte SnapshotLeiste lag
  // mit `left:12/right:12` über die volle Kartenbreite, auf demselben zIndex (5) wie die
  // ZeichnenSteuerung und später im DOM, und verdeckte deren Buttons vollständig (gemessen:
  // Klick auf „Abbrechen" lief in den 30-s-Timeout mit „<div> intercepts pointer events").
  // Damit blieb genau der Zustand ungetestet, den ein neuer Nutzer antrifft — der
  // localStorage-Schlüssel ist ungesetzt, die Leiste also ausgeklappt.
  //
  // Seit beide Bänder im `KartenFuss` stapeln, ist die Umgehung weg. Die Zeile unten bleibt
  // als VORBEDINGUNG stehen: fiele die Leiste künftig weg oder startete sie eingeklappt,
  // wären die Überdeckungsmessungen darunter still wertlos statt rot.
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();

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

  await ohneUeberdeckung(page, 'Desktop 1280 px');

  // Der eigentliche Beleg für LFH-355 ist DIESER Klick, nicht die Boxen-Rechnung darüber:
  // er ist die Messung, die vorher in den Timeout lief. `toBeVisible()` war auf dem
  // verdeckten Button grün — CSS-Sichtbarkeit ist in Playwright keine Klickbarkeit, und
  // diese Falle ist generisch für die Suite, nicht auf diese Stelle beschränkt.
  //
  // Abbrechen fährt zugleich `stoppen()` → `draw.stop()` → Adapter-`unregister()` mit
  // `removeLayer`/`removeSource`. Der Abbau ist eine eigene MapLibre-API-Fläche und
  // damit eine eigene Bruchstelle — deshalb wird er mitgelaufen, nicht nur der Aufbau.
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  // Schmale Fläche (LFH-355, AK3). 1024 × 768 ist der Führungs-Tablet-Kontext der
  // Bedien-Leitlinie; dort steht die 300-px-Leiste noch RECHTS neben der Karte (ab `lg`).
  // Darunter rutscht sie seit dem Neuentwurf (S5) unter die Karte, und die
  // ZeichnenSteuerung ist auf `min(320px, 100%)` gedeckelt — die Karte trägt dann die volle
  // Breite. Die Zeichenwerkzeuge liegen im Paneel „Zeichnen" der Leiste (für Schreibende
  // vorgabemäßig offen).
  await page.setViewportSize({ width: 1024, height: 768 });
  // Unter `xl` startet die Zeitachse ohne gemerkte Wahl EINGEKLAPPT (Nacharbeit 22.09.2026,
  // `startEingeklappt` in SnapshotLeiste.tsx) — ausgeklappt frass sie bei 1024 px drei
  // Zeilen. Die Überdeckungsmessung braucht aber die ausgeklappte Leiste, sonst wäre sie
  // still wertlos: also bewusst einblenden, wie es eine Einsatzkraft täte.
  await page.getByRole('button', { name: 'Zeitachse einblenden' }).click();
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await ohneUeberdeckung(page, 'Tablet 1024 px');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

/**
 * Startansicht (Nacharbeit 22.09.2026, `lagekarte/startAnsicht.ts`): ein verorteter Einsatz
 * öffnet auf seinem Einsatzort, nicht auf „Mitte Deutschland, Zoom 5". Hier und nicht in
 * Vitest, weil die Anwendung an der echten Karteninstanz hängt — und weil der gemessene Fehler
 * ein StrictMode-Fall war: der Start wurde auf der ersten, sofort wieder entfernten Karte
 * „verbraucht", die sichtbare zweite blieb auf der Übersicht. e2e läuft unter Vite-Dev mit
 * StrictMode AN und fängt genau das.
 *
 * Dazu der Kartenfuß: er liegt über der Karte und darf mit ausgeklappter Zeitachse und einem
 * gesicherten Stand nicht über eine Zeile hinauswachsen (vorher brach die Stand-Reihe in eine
 * zweite Zeile um).
 */
test('Lagekarte: startet auf dem Einsatzort; die Zeitachse deckt die Karte nicht zu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  const ort = { lat: 49.3519, lon: 9.1457 };
  // Der Kopf-PATCH ist ein VOLLERSATZ (`KopfdatenUpdate`) — deshalb aus dem Bestand gebaut.
  const e = (await (await page.request.get(`/api/einsaetze/${eid}`)).json()) as Record<
    string,
    unknown
  >;
  const antwort = await page.request.patch(`/api/einsaetze/${eid}`, {
    data: {
      bezeichnung: e.bezeichnung,
      stichwort: e.stichwort ?? null,
      einsatzart: e.einsatzart,
      leitstellen_nr: e.leitstellen_nr ?? null,
      einsatzort: e.einsatzort ?? null,
      einsatzort_lat: ort.lat,
      einsatzort_lon: ort.lon,
      meldende_stelle: e.meldende_stelle ?? null,
      sachverhalt: e.sachverhalt ?? null,
      anzahl_betroffene_initial: e.anzahl_betroffene_initial ?? null,
      begonnen_at: e.begonnen_at,
    },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const stand = await page.request.post(`/api/einsaetze/${eid}/lage-snapshots`, {
    data: { bezeichnung: 'Stand vor Ort' },
  });
  expect(stand.ok(), await stand.text()).toBeTruthy();
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return null;
          const c = map.getCenter();
          return { zoom: Math.round(map.getZoom()), lat: c.lat, lon: c.lng };
        }),
      { timeout: 15_000, message: 'Karte steht nicht auf dem Einsatzort' },
    )
    .toEqual({ zoom: 14, lat: expect.closeTo(ort.lat, 4), lon: expect.closeTo(ort.lon, 4) });

  const zeitachse = page.locator('[data-lfh="zeitachse"]');
  await expect(zeitachse.getByRole('button', { name: 'Stand vor Ort' })).toBeVisible();
  const hoehe = (await zeitachse.boundingBox())!.height;
  const zeile = (await page.getByRole('button', { name: 'Aktuell' }).boundingBox())!.height;
  // Eine Zeile = höchstes Steuerelement plus die Polsterung des Bands (2 × 8 px) und Rand.
  expect(hoehe, `Zeitachse ${hoehe}px hoch bei ${zeile}px Zeilenhöhe`).toBeLessThan(zeile * 2);

  // Unter `xl` ist die Karte eng (1024 px: Modulpanel, Karte und Leiste nebeneinander) — dort
  // startet die Zeitachse ohne gemerkte Wahl eingeklappt, statt drei Zeilen Karte zu decken.
  // Oben wurde nicht geklappt, es gibt also keine gemerkte Wahl; zur Sicherheit geräumt.
  await page.evaluate(() => localStorage.removeItem('lfh:lagekarte:zeitachse-eingeklappt'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Zeitachse einblenden' })).toBeVisible();
  await expect(page.locator('[data-lfh="zeitachse"]')).toHaveCount(0);
});

/**
 * Messwerkzeug (LFH-616). Hier und nicht in Vitest, weil der tragende Teil die Ereignisfolge
 * des ECHTEN terra-draw ist: welche Features es bei `create` meldet (die Figur UND eigene
 * Hilfspunkte), wann `finish` kommt und ob der Wert bei der Bewegung mitläuft. Der Unit-Test
 * von `messZeichnung.ts` fährt eine nachgebaute Folge — dieser prüft, ob sie stimmt.
 */
test('Lagekarte: Messwerkzeug misst Strecke und Fläche und schließt mit Escape', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);

  const knopf = page.getByRole('button', { name: 'Messen' });
  await knopf.click();
  await expect(knopf).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  const wert = page.locator('[data-lfh="messwert"]');
  await expect(wert).toHaveText('—');

  const box = (await canvas.boundingBox())!;
  const punkt = (dx: number, dy: number) => ({
    x: box.x + box.width / 2 + dx,
    y: box.y + box.height / 2 + dy,
  });

  // Strecke: zwei Punkte, der Wert läuft schon vor dem Abschluss mit.
  await page.mouse.click(punkt(-120, 0).x, punkt(-120, 0).y);
  await page.mouse.move(punkt(0, 0).x, punkt(0, 0).y, { steps: 4 });
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);
  await page.mouse.click(punkt(0, 0).x, punkt(0, 0).y);
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);

  // Kartenwechsel mitten in einer Messung (Review LFH-616): „Hell" ergibt einen anderen
  // Blind-Stil, also `setStyle` mit `diff: false` — das wirft die Sources des Adapters weg.
  // Ohne Räumen davor warf die nächste Zeigerbewegung (`setData` auf `undefined`). Erwartet:
  // die Messung beginnt in derselben Form neu und nimmt wieder Punkte an.
  await page.mouse.click(punkt(-120, 40).x, punkt(-120, 40).y);
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: /Hell/ }).click();
  await expect(wert).toHaveText('—');
  await page.mouse.click(punkt(-120, -40).x, punkt(-120, -40).y);
  await page.mouse.move(punkt(60, -40).x, punkt(60, -40).y, { steps: 4 });
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);
  await page.mouse.click(punkt(60, -40).x, punkt(60, -40).y);
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();

  // Fläche: drei Punkte, dann Inhalt und Umfang. Alle ÜBER der Mitte — unter ihr liegt das
  // Mess-Band im Kartenfuß, ein Klick dort träfe den Knopf statt der Karte.
  await page.getByRole('radio', { name: 'Fläche' }).click();
  await expect(wert).toHaveText('—');
  for (const [dx, dy] of [
    [-100, -120],
    [100, -120],
    [0, -20],
  ]) {
    await page.mouse.click(punkt(dx, dy).x, punkt(dx, dy).y);
  }
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
  await expect(wert).toHaveText(/(m²|ha|km²)\s*Umfang \d/);

  // Direkt aus dem Messen ins Zeichnen (Review LFH-616): drei terra-draw-Instanzen auf EINER
  // Karte. Mit dem gemeinsamen Vorgabe-Präfix „td" legte die Zone ihre Sources an, solange
  // die Messung sie noch hielt — MapLibre warf „Source … already exists", die Seite brach
  // ab. Die Effekte laufen in Deklarationsreihenfolge, das Stoppen der Messung kommt zu spät.
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  await expect(knopf).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // Escape beendet das Werkzeug, der Knopf springt zurück.
  await knopf.click();
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  await expect(knopf).toHaveAttribute('aria-pressed', 'false');

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
