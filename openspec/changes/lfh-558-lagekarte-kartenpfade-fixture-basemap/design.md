# Design

## Context

Motivation: proposal.md, „Why". Ausgangslage im Code:

- Der Stilwechsel läuft im `[style]`-Effekt von `pages/lagekarte/Kartenflaeche.tsx`:
  Spider schließen, Wächter neu schärfen, laufende Messung räumen, `setStyle(style, { diff: false })`,
  dann `planeReAnlegenNachStyle` (`kartenLayer.ts`) über den Render-Poller `wendeKartenDatenAn`.
  Unit-getestet ist der Poller gegen eine Fake-Karte (`kartenLayer.test.ts`), im Browser gefahren
  wurde der Wechsel bisher nur mit dem Blindstil (Themenwechsel „Hell" in
  `e2e/lagekarte-smoke.spec.ts`) oder als `setStyle(getStyle())` von außen. Beide Styles sind
  inline und laden im selben Takt; der asynchrone Online-Fall, für den der Poller existiert, lief
  nie.
- Freie taktische Zeichen (`typ: 'freies_zeichen'`) bekommen ihr Bild über den
  `styleimagemissing`-Zweig `tz|` (Altpaket, `erzeugeTaktischesZeichen` → `Image` → `addImage`).
  Fachobjekte laufen seit LFH-835 über den Resolver (`ez|`, e2e in `lagekarte-smoke.spec.ts`). Für
  `tz|` gibt es nur den Schlüssel-Test (`markerIcons.test.ts`), keinen Browser-Beleg.
- Die Abstufung: `map.on('error')` → `stilFehlerWaechter.meldeFehler` → `onStyleFehler` →
  `useKartenAnsicht.basemapFallback` (`online → offline → blind`), Anzeige getrennt von der Wahl.
  Unit-getestet sind Wächter und Zustand je für sich, die Kette nie im Browser.
- Die Fixture aus LFH-356 (`e2e/lagekarte-kachelpfad.spec.ts`): `page.route` auf
  `/api/karte/config`, Style-JSON und Kacheln; 33 Bytes handgeschriebenes Protobuf mit Layer
  `strassen`. Gemessene Falle: eine gescheiterte Kachel zählt für `loaded()` als geladen —
  „gelesen" heißt `querySourceFeatures` > 0.

## Goals / Non-Goals

**Goals:**

- Je Pfad aus LFH-356 ein Verdikt mit Beleg (D1), jedes „abgedeckt" mit Mutationsprobe.
- Die drei blinden Pfade im Browser fahren, mit Zusicherungen, die an einem dekodierten Merkmal
  bzw. an gezeichneten Features hängen, nicht an `loaded()` oder an Registrierung.

**Non-Goals:**

- Keine Änderung am Kartenverhalten, außer ein neuer Test deckt einen Fehler auf (dann hier behoben
  oder als eigenes Ticket vertagt, s. Risiken).
- Keine Abdeckung der Stufe `offline → blind` im Browser: ein Offline-Style ist inline, sein
  `style.load` feuert sofort; ein Style-Fehler vor dem Laden ist dort nicht herstellbar, ohne den
  Produktcode zu verbiegen (so steht es auch im Kopf von `stilFehlerWaechter.ts`). Die Stufe bleibt
  Unit-getestet.
- Kein Umbau bestehender Cluster-/Spider-/Bildgriff-Tests.

## Decisions

### D1 — Verdikt je Pfad

| Pfad (LFH-356) | Verdikt | Beleg |
|---|---|---|
| Basemap-Wechsel, `setStyle` `diff:false` + `planeReAnlegenNachStyle` | **neu e2e** | `e2e/lagekarte-kartengrundlage.spec.ts`, Test 1 |
| TZ-Icon über `styleimagemissing` (`tz|`) | **neu e2e** (im Test 1) | gezeichnetes `marker-symbol` mit `typ: freies_zeichen` vor und nach dem Wechsel |
| Cluster-Donuts, Spiderfy | **bereits abgedeckt** | `e2e/lagekarte-touch.spec.ts` („Tipps treffen Einzelzeichen, Cluster und aufgefächerte Zeichen"), `e2e/betroffene-karte.spec.ts` (Spider, Handschuh), `e2e/gate3-trefflaeche.spec.ts` (Donut-Maße), Unit `spiderfy.test.ts`, `clusterDonut.test.ts`; Mutationsprobe in diesem Task |
| `stilFehlerWaechter`-Abstufung online → offline | **neu e2e** | `e2e/lagekarte-kartengrundlage.spec.ts`, Test 2 |
| Abstufung offline → blind | **begründet vertagt** (nicht herstellbar, s. Non-Goals) | Unit `stilFehlerWaechter.test.ts`, `useKartenAnsicht.test.tsx` |
| `bildHandles.ts` | **bereits abgedeckt** | Unit `bildHandles.test.ts` (LFH-711, LFH-764); Mutationsprobe in diesem Task |

Warum e2e und nicht Unit für die drei neuen: jede der drei Aussagen hängt an einem Verhalten von
MapLibre selbst (asynchrones Laden eines URL-Styles, Ereignisreihenfolge `error`/`style.load`,
Bildanforderung beim Layout). Eine Fake-Karte bildet genau das nach, was bewiesen werden soll; die
bestehenden Unit-Tests tun das bereits und sind blind für diese Reihenfolgen.

### D2 — Ein Hilfsmodul für die Fixture-Basemap

`e2e/kartenFixture.ts` nimmt aus `lagekarte-kachelpfad.spec.ts` auf: den Kachel-Bau (mit dem
Byte-Kommentar), die Config-, Style- und Kachel-Routen. Neu ist nur, dass der Layername ein
Parameter ist: `vektorKachel(layer)` baut dieselbe Tile mit anderem Namen (die Längenbytes
folgen dem Namen). Die Offline-Grundlage braucht den Shortbread-Layer `streets`, die Online-Views
behalten `strassen`. Ein Test im Modul prüft nichts selbst; `lagekarte-kachelpfad.spec.ts` sichert
über `vektorKachel('strassen')` weiterhin die 33 Bytes (Längenvergleich plus Dekodieren).

Alternative: eine zweite handgeschriebene Konstante für `streets`. Verworfen, weil zwei
Byte-Folgen mit identischem Aufbau zweimal gepflegt würden; der Bau aus einer Vorlage ist genauso
bibliotheksfrei.

Der Spec-Ordner bindet weiterhin nicht gegen die Anwendung (Haken-Typen werden nachgebildet, wie in
den bestehenden Specs).

### D3 — Test 1: Wechsel zwischen zwei Online-Vektor-Views

- Config mit zwei Online-Views `Fixture A`/`Fixture B` (je eigener Style-Pfad, Source-Id
  `fixture-a`/`fixture-b`), `offline_verfuegbar: false`.
- Saat per API im selben Ausschnitt: Einsatzort (PATCH wie `lagekarte-smoke.spec.ts`), ein
  Abschnitt mit Fläche (`PATCH …/abschnitte/{id}/flaeche`), eine Zone (`POST …/zonen`), ein freies
  taktisches Zeichen (`POST …/freie-zeichen`, Grundzeichen ohne Sonderwerte). Fachebene: DWD per
  `page.route('**/api/karte/fachebenen/dwd')` mit einem Polygon, sichtbar geschaltet über die
  Leiste (kein Netz, Quelle ist die Fixture).
- Vorher: `fixture-a` dekodiert; `abschnitte`, `zonen`, `fachebene-dwd`, Marker- und
  Einsatzort-Quelle tragen ihre Features; `marker-symbol` zeichnet das freie Zeichen.
- Wechsel über die Grundlage-Leiste (`radiogroup` „Kartengrundlage", Radio „Fixture B"), also über
  den echten `[style]`-Effekt, nicht über `setStyle` von außen.
- Nachher: `fixture-a` fehlt im Style, `fixture-b` dekodiert, dieselben Quellen wieder befüllt,
  das freie Zeichen wieder gezeichnet, keine `pageerror`.

Gezeichnet statt registriert (`queryRenderedFeatures` auf `marker-symbol`): ein nur registriertes
Bild beweist nicht, dass der Layout-Lauf es hatte — dieselbe Lehre wie LFH-835.

### D4 — Test 2: Abstufung online → offline

- Config mit einer Online-View, deren Style-JSON per `route.fulfill({ status: 404 })` scheitert,
  und einer Offline-Region (`offline_verfuegbar: true`, `offline_regionen: [{ karte_id, tiles_url,
  format: 'vektor', maxzoom: 14 }]`), deren Kacheln die Fixture mit Layer `streets` liefert.
  Sprite und Glyphen der Offline-Grundlage kommen vom e2e-Backend (eingebettet); scheitern sie,
  stufte die Karte bis `blind` weiter — genau das soll der Test sehen.
- Zusicherungen: Source `basemap-<karte_id>` im Style und dekodiert (`streets`), die
  Online-Source nicht; die Grundlage-Leiste zeigt weiter die Online-View als `aria-checked`; genau
  eine Konsolen-Warnung „Basemap-Style nicht ladbar"; keine `pageerror`.
- Kachelfehler-Szenario der Spec („einzelne Kachel scheitert"): bleibt beim Unit-Test des Wächters
  (`stilFehlerWaechter.test.ts`); im Browser wäre es ein dritter Test mit eigenem Einsatz für eine
  Aussage, die an einer Zeile (`e.tile`) hängt. Laufzeit geht vor.

### D5 — Mutationsproben

Jede Probe wird von Hand gesetzt, der betroffene Test läuft rot, die Probe wird zurückgenommen;
das Ergebnis steht in `tasks.md` am Kästchen.

- Test 1: Aufruf `planeReAnlegenNachStyle` im `[style]`-Effekt entfernen; `tz|`-Zweig im
  `styleimagemissing`-Hörer früh verlassen; `diff: false` entfernen (erwartet rot laut Kommentar
  im Effekt — bleibt der Test grün, wird das dort vermerkt, nicht der Kommentar geglaubt).
- Test 2: `onStyleFehler?.()` im `error`-Hörer auskommentieren; Wächter so ändern, dass er nach
  `stilAngewandt()` nicht neu schärft, darf Test 2 **nicht** rot machen (Gegenprobe: nur eine
  Stufe wird gefahren).
- Bestehende Abdeckung: `spiderfyOffsets` auf konstanten Versatz → `spiderfy.test.ts` rot;
  Spider-Öffnen in `Kartenflaeche.tsx` unterdrücken → der Spider-Test in `lagekarte-touch.spec.ts`
  rot; Kantenwahl in `bildHandles.ts` (`scharfeGriffe`) umgehen → `bildHandles.test.ts` rot.

## Risks / Trade-offs

- [Laufzeit der e2e-Suite] → zwei Tests, je ein Einsatz, keine festen Wartezeiten; Warten nur per
  `expect.poll` auf Inhaltsanker, nie `networkidle` (LFH-385).
- [Die Fixture-Kachel liegt nicht im sichtbaren Ausschnitt] → Kacheln werden für jede Anfrage mit
  derselben Tile beantwortet; `querySourceFeatures` braucht nur eine geladene Kachel irgendwo im
  Viewport.
- [Ein neuer Test deckt einen echten Fehler auf, z. B. Abstufung bis `blind` durch einen
  gescheiterten Sprite-Abruf] → Ursache per `superpowers:systematic-debugging`; kleiner Fix hier
  (mit Unit-Test), größerer als eigenes Ticket über `clickup-task-anlegen`, der Test wird dann
  nicht aufgeweicht, sondern der Fund bleibt sichtbar vermerkt.
- [Doppelte Fixture-Pflege] → D2, ein Modul.
