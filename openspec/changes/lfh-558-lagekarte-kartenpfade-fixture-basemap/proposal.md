# Proposal

## Why

LFH-356 hat den Kachel-Pfad der Lagekarte mit einer Fixture-Basemap ohne Netz fahrbar gemacht
(`e2e/lagekarte-kachelpfad.spec.ts`) und dabei fünf weitere Kartenpfade als „nicht Teil dieses
Tasks" offen gelassen. Seitdem sind zwei davon durch andere Tasks abgedeckt worden, drei sind im
Browser weiterhin blind: der Wechsel zwischen zwei **Online-Vektor**-Grundlagen über die
Grundlage-Wahl, die Zeichenerzeugung für freie taktische Zeichen über `styleimagemissing` und die
Abstufung „online → offline" bei einem Style-Ladefehler. Gerade der Online-Wechsel ist der Fall,
für den die Re-Anlage nach `setStyle` gebaut wurde („beim Online-Wechsel bleibt `styledata` aus,
bis die Tiles geladen sind"), und er lief bisher nie in einem Browser — alle bestehenden
Stilwechsel-Tests fahren den Blindstil, dessen Style inline ist und sofort lädt.

## What Changes

- **Verdikt je Pfad** aus LFH-356 (Tabelle in `design.md`, D1):
  - Basemap-Wechsel zwischen zwei Online-Vektor-Views → **neu e2e**.
  - Freie taktische Zeichen (`tz|`) über `styleimagemissing` → **neu e2e**, im selben Test wie der
    Wechsel (gezeichnet vor und nach dem Wechsel).
  - `stilFehlerWaechter`-Abstufung online → offline → **neu e2e** (Style-JSON 404 per
    `route.fulfill`, Offline-Region aus der Fixture).
  - Cluster-Donuts und Spiderfy → **bereits abgedeckt** (`e2e/lagekarte-touch.spec.ts`,
    `e2e/betroffene-karte.spec.ts`, `e2e/gate3-trefflaeche.spec.ts`, Unit `spiderfy.test.ts`,
    `clusterDonut.test.ts`); hier nur die Mutationsprobe nachgereicht.
  - `bildHandles.ts` → **bereits abgedeckt** (Unit `bildHandles.test.ts` aus LFH-711/LFH-764);
    hier nur die Mutationsprobe nachgereicht.
- Die Fixture-Basemap (Kachel-Bytes, Config-/Style-/Kachel-Routen) wandert aus
  `lagekarte-kachelpfad.spec.ts` in ein gemeinsames Hilfsmodul unter `e2e/`, damit der neue Test
  sie mit anderem Layernamen und zwei Views nutzen kann. Weiterhin keine Kachel-Bibliothek und
  keine echten Kacheldaten im Repo.
- Kein Produktcode ändert sich, solange die neuen Tests grün sind. Wird beim Fahren ein Fehler
  sichtbar (etwa eine Abstufung bis `blind`, weil ein Offline-Nebenabruf scheitert), wird er in
  diesem Task behoben oder als eigenes Ticket vertagt.

## Capabilities

### New Capabilities

- `lagekarte-kartengrundlage`: Verhalten der Lagekarte beim Wechsel der Kartengrundlage und bei
  einer nicht ladbaren Grundlage — das Lagebild bleibt vollständig, eine nicht ladbare
  Online-Grundlage stuft die Anzeige einmal ab, ohne die Wahl zu ändern.

### Modified Capabilities

(keine)

## Impact

- Tests: neues `frontend/e2e/lagekarte-kartengrundlage.spec.ts` (zwei Tests), neues
  Hilfsmodul `frontend/e2e/kartenFixture.ts`, `frontend/e2e/lagekarte-kachelpfad.spec.ts` nutzt
  es.
- Produktcode: voraussichtlich keiner (`pages/lagekarte/Kartenflaeche.tsx`,
  `kartenLayer.ts`, `useKartenAnsicht.ts` sind die geprüften Stellen).
- Doku: Nachweis-Zeile im Lagekarten-Absatz von `CLAUDE.md`.
- Kein Backend, keine API, keine Migration, kein neuer Netzbedarf der e2e-Suite. Laufzeit: zwei
  zusätzliche Tests, je ein Einsatz, keine Wartezeiten über das Laden der Fixture hinaus.
