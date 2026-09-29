# Proposal

## Why

Der Neuentwurf „Instrumententafel“ führt unter Lage das Modul „Wetter & Pegel“. LFH-620 hat
entschieden, es als Fachmodul zu bauen, sobald LFH-606 die Pegel an den Einsatz bindet. Das
ist inzwischen geschehen, und LFH-628 hat den erwarteten Höchststand ergänzt. Heute stehen
die Pegel nur als eine Kennzahl im Dashboard. Wetter gibt es nur als bundesweite
Kartenfachebene (DWD-Warnungen). Diese Fachebene ist nicht auf das Einsatzgebiet gefiltert
und zeigt nicht, wie alt ihr Stand ist. Eine Wettervorhersage für den Einsatzort gibt es gar
nicht. Wer wissen will, ob das Wasser steigt oder Sturm kommt, muss heute die Lagekarte
aufmachen, die Ebene einschalten und selbst schauen, welche Polygone den Einsatzort treffen.

## What Changes

- Neues Fachmodul **Wetter & Pegel** mit Modul-Key `wetter-pegel`, Kategorie Lage, Route
  `/einsaetze/:einsatzId/wetter-pegel`. Es steht in der Registry hinter „Gefahren“ und vor
  „Lagemeldungen“.
- **Pegel auf der Modulseite**: je maßgeblichem Pegel Wert, Trend (cm/h), Datenstand,
  Prognose/Höchststand (LFH-628) und ein **24-h-Verlauf** als eigene SVG-Verlaufslinie. Die
  Pflege (festlegen, ordnen, Prognose) bleibt in Einstellungen › Pegel. Die Modulseite
  verlinkt dorthin.
- **Pegelabruf auf 24 h**: PEGELONLINE wird mit `start=P1D` statt `PT3H` abgefragt. Der
  Trend rechnet unverändert über 60 min.
- Neuer Endpunkt `GET /api/einsaetze/{id}/pegel/verlauf` liefert die Reihe je Pegel. Er ist
  modul-los wie die übrigen Pegel-Routen.
- **Wetter für den Einsatzort** über **Bright Sky** (`api.brightsky.dev`, freie JSON-API auf
  DWD-Open-Data):
  - gültige **DWD-Warnungen** der Warnzelle (Gemeinde), in der der Einsatzort liegt,
    getrennt nach „gilt jetzt“ und „angekündigt“;
  - eine **Vorhersage** für die nächsten 24 Stunden (MOSMIX): Temperatur, Niederschlag,
    Wind und Böen.
- Neuer Endpunkt `GET /api/einsaetze/{id}/wetter`, am Modul gegated (Marker `WetterPegel`).
  Ohne Einsatzort liefert er einen ausdrücklichen Zustand „kein Ort“ statt einer leeren
  Liste.
- **Datenstand ehrlich**:
  - Jeder Teil trägt seinen Abrufzeitpunkt. Ein alter Stand wird als „veraltet“ markiert.
  - Fällt eine Quelle aus und liegt kein Stand vor, steht „Stand unbekannt“.
  - Eine Warnung, deren Ende verstrichen ist, verschwindet auch aus einem alten Stand.
- **Vertragskarte** `dwdWarnstufe` in `theme/statusFarben.ts`: die vier DWD-Stufen mit den
  amtlichen Bezeichnungen als zweitem Kanal.
- **Pegel-Kennzahl im Dashboard und Überblick-Marke „Erwarteter Höchststand“** zeigen aufs
  neue Modul, solange es für die Person sichtbar ist. Sonst zeigen sie wie bisher auf
  Einstellungen › Pegel.
- Dazu Registry-Eintrag, `MODUL_KEYS`/Marker/`PFAD_KEY`, Codegen der neuen Response-Typen,
  e2e-Gates und die **Prüfliste Einsatztauglichkeit**.

## Capabilities

### New Capabilities

- `lage-wetter-pegel`: Die Lage-Sicht auf Wasserstand und Wetter am Einsatzort. Sie umfasst
  die Pegel mit 24-h-Verlauf, die gültigen DWD-Warnungen der Warnzelle des Einsatzorts, eine
  24-h-Vorhersage sowie die Kennzeichnung von veraltetem und unbekanntem Stand.

### Modified Capabilities

(keine: `lagekarte-fachebenen` bleibt unberührt. Die DWD-Kartenebene holt weiter
`Warnungen_Gemeinden_vereinigt` direkt vom DWD-GeoServer.)

## Impact

- **Datenbank:** keine Migration. Verlauf und Wetter liegen im Nachschlage-Cache
  (`fachebenen_cache`).
- **Externe Quelle neu:** `api.brightsky.dev` ist öffentlich und ohne Schlüssel nutzbar. Es
  gelten die Nutzungsbedingungen des DWD, der Quellenvermerk „Datenbasis: Deutscher
  Wetterdienst“ ist Pflicht. Die Basis-URL steht am `FachebenenState`, damit Tests nie ins
  Netz gehen.
- **Backend:**
  - neu: `src/wetter/` (Abruf, Auswertung, DTOs) und `src/routes/wetter.rs`;
  - `src/pegel/abruf.rs` (Fenster P1D, Verlauf), `src/pegel/mod.rs` (DTO), `src/routes/pegel.rs`;
  - `src/karte/mod.rs` (Basis-URL), `src/einsatz/modul.rs`, `src/app.rs`, `src/routes/mod.rs`,
    `src/api_doc.rs`.
- **API:** zwei neue GET-Endpunkte, bestehende Endpunkte unverändert.
- **Frontend:**
  - neu: `pages/WetterPegelPage.tsx` mit `wetter/`-Bausteinen, darunter die Verlaufslinie;
  - `api/pegel.ts`, neu `api/wetter.ts`;
  - `api/queryKeys.ts`, `routing/deeplinks.ts`, `einsatz/modulRegistry.ts`, `App.tsx`;
  - `theme/statusFarben.ts`, `pages/lage-dashboard/lagebild.ts`,
    `pages/fuehrung/UeberblickPage.tsx`;
  - generierte Typen.
- **Tests und Guards:**
  - Backend: `tests/modul_override.rs`, `tests/einsatz_kontext_guard.rs`, `tests/pegel.rs`,
    neu `tests/wetter.rs`;
  - Frontend: `statusFarben.test.ts`, `queryKeys`-Guards, `EinsatzLayout.test.tsx`
    (Lage-Keys), neue e2e-Spec für die Route.
