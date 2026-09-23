# Tasks

Arbeitsweise: jede Aufgabe per `superpowers:test-driven-development`. Erst der rote Test,
dann der Code. Pfade relativ zu `frontend/src/`.

## 1. Regressionsschutz vor dem Umbau

- [x] 1.1 In `pages/LagekartePage.test.tsx` einen Test anlegen: Liefert `…/personen` eine
  Person mit Koordinate, zeigt die Karte bei Bestandsansicht und ohne Layer-Flag keinen
  `marker-person-*`. Zusätzlich `basisHandler` um einen Standard-Handler `…/personen` → `[]`
  ergänzen. Verifikation: Der Test ist grün gegen den heutigen harten Filter, und die übrigen
  59 Tests bleiben grün.
- [x] 1.2 In `personen/personenKarte.test.ts` einen Fall mit gesetztem `name`/`vorname`
  anlegen: Das `label` ist genau `R-042 · SK II` und enthält keinen Namensteil.
  Verifikation: Vitest grün, Mutationsprobe „Name ins Label“ färbt ihn rot.

## 2. Ebenen-Schlüssel und Vorgabe (D4)

- [x] 2.1 `person` in `LayerSichtbar` (`pages/lagekarte/Sidebar.tsx`), `LAYER_KEYS` und
  `LAYER_DEFAULT` (`person: false`) in `pages/lagekarte/useKartenAnsicht.ts` sowie in
  `EBENEN` (`leistenDaten.ts`, Name „Betroffene“) eintragen. `ebenenFarbe` bekommt den Fall
  `person` → `neutral`. Verifikation: Neue Tests in `useKartenAnsicht.test.tsx`:
  gespeicherte Ansicht ohne Schlüssel → aus; Umschalten macht die Ansicht schmutzig; das
  Speichern trägt `person: true`. Dazu `leistenDaten.test.ts`: Fixture auf elf Schlüssel,
  `ebenenFarbe('person')` ≠ `bedien`.

## 3. Daten-Gate (D2, D3, D8)

- [x] 3.1 In `pages/lagekarte/useLagekarteDaten.ts` die Overrides-Query
  (`einsatzKeys.modulOverrides`) und die Personen-Query auf `einsatzKeys.personen(einsatzId)`
  anlegen, mit `enabled: liveAn && overrides.isFetched && istModulFreigegeben(...)`.
  `personenVerortet` über `personenMarker` ableiten, nach einem Fehler `[]`. Verifikation:
  `useLagekarteDaten.test.tsx`, freies Modul → Marker da; Override `sichtbar:false` → kein
  Request an `…/personen` (MSW-Zähler 0).
- [x] 3.2 `personenZugriff` (`'frei'|'gesperrt'|'ausgeblendet'|'rueckblick'`) ableiten.
  Ein 403 der Query wird zu `'gesperrt'`, der Snapshot zu `'rueckblick'`. Verifikation:
  Hook-Tests je Zustand. Den Paarfall 403 gegen 500 prüfen: nur 500 bringt „Betroffene“
  in `fehlerhafteQuellen`.
- [x] 3.3 `neuLaden` um die Personen-Query ergänzen, nur bei freiem Modul. `markerLaden`
  bleibt OHNE Personen: es gatet allein den Startausschnitt, und der hängt nach D3 nicht an
  Personen (beim Umsetzen gemessen: einziger Konsument `LagekartePage.tsx`, `startOffen`).
  `personenVerortet` darf nicht in `alleVerortet` landen. Verifikation: Hook-Test,
  `alleVerortet` enthält keinen `person`-Typ, auch wenn Personen geladen sind.

## 4. Lagekarten-Seite verdrahten (D3)

- [x] 4.1 In `pages/LagekartePage.tsx` den harten Filter entfernen. `sichtbareMarker`
  bekommt `personenVerortet` nur bei `layer.person && personenZugriff === 'frei'`. Der
  Marker-Lookup für `aktiverMarker`/`onMarkerWaehlen` sieht beide Listen. Startausschnitt
  und `verortetAnzahl` bleiben auf `alleVerortet`. Verifikation: Paartest mit Ansicht
  `person: true`: mit Zugriff erscheint `marker-person-*`; mit 403 und Override-Sperre
  keiner und kein Ausfallbanner. Außerdem: gleiche Kopfzahl „verortet“ mit und ohne
  Personen, und ein Klick auf `marker-person-*` füllt „Ausgewählt“.
- [x] 4.2 `ebenenZeilen` (`leistenDaten.ts`) zählt `person` aus `personenVerortet` und
  bekommt den Zugriffszustand. Bei `'ausgeblendet'` gibt es keine Zeile, bei
  `'gesperrt'`/`'rueckblick'` eine Zeile mit Sperrgrund und ohne Anzahl. Verifikation:
  `leistenDaten.test.ts` je Zustand.

## 5. Ebenen-Zeile und Legende (D6)

- [x] 5.1 `EbenenZeilenKnopf` bekommt den Sperrzustand: `disabled`, `LockOutlined` in einer
  `aria-hidden`-Hülle, den Grund als sichtbaren Text und im zugänglichen Namen, keine Anzahl.
  Verifikation: `Sidebar.test.tsx`. `toHaveLength(10)` wird zum Paar (11 mit Zugriff, 10
  ausgeblendet). Die gesperrte Zeile ist nicht umschaltbar (kein `onLayerToggle`-Aufruf),
  hat keine Ziffer, und `queryByRole('img')` in der Zeile liefert `null`.
- [x] 5.2 `SK_KURZZEICHEN` aus `personen/personenKarte.ts` nutzen (war bereits exportiert) und die Komponente
  `pages/lagekarte/Sichtungslegende.tsx` bauen: sieben Einträge aus `sichtung`,
  `sichtungsfarben`, Kürzel und `SK_WORT`. Sie wird nur bei eingeschalteter, freier Ebene
  gerendert. Verifikation: Komponententest mit sieben Einträgen und Wortlaut je Eintrag;
  Sidebar-Paartest „Ebene an → Legende da, aus → weg“. `statusVertrag.guard`, `gate5.guard`
  und `farbliteral.guard` bleiben grün.

## 6. Inspector (D7)

- [x] 6.1 `markerToUrl` bekommt den Fall `person` → `personDetailPfad`, `inspectorExclude`
  den Zweig `person`. Verifikation: `markerToUrl.test.ts` mit dem neuen Fall;
  `Inspector.test.tsx` mit gesetztem Namen: der Titel ist `R-042 · SK II`, `Kowalski`/`Anna`
  sind nicht im Dokument, der Link zeigt auf `/einsaetze/1/personen/<id>`.
- [x] 6.2 `loescheVerortung` (`pages/lagekarte/useKartenInteraktion.ts`) bekommt den Zweig
  `person`: PATCH nur mit `antreff_lat/antreff_lon: null`, danach Invalidierung von
  `personen`/`person`. Verifikation: `useKartenInteraktion.test.tsx` mit dem exakten
  PATCH-Body und beiden Invalidierungen, nach dem Muster des Platzier-Tests.

## 7. Eigene Cluster-Quelle (D5)

- [x] 7.1 `pages/lagekarte/markerLayer.ts`: Personen in ihre eigene Quelle leiten. Beim Umsetzen
  vereinfacht: statt `bauePersonenFc` plus neuer Signatur teilt `reAnlegenMarker` die Menge
  aus `baueMarkerFc` intern auf (`teileNachQuelle`, EINE Stelle der Zuordnung); damit
  ändern sich weder `kartenLayer.ts` noch eine Konsumentin der Kartenfläche. Dazu die geclusterte Quelle
  `marker-personen` mit den Layern `personen-kreis`, `personen-kurz`, `personen-label`
  (in der Reihenfolge ganz unten, in den Klick-Layern) und `reAnlegenMarker` mit drei
  Collections. `kartenLayer.ts` wird mitgezogen. Verifikation: `markerLayer.test.ts`,
  Person landet nur in der Personen-FC, Reihenfolge Personen-Layer vor `marker-status-ring`,
  `beschriftung` ohne Name.
- [x] 7.2 `pages/lagekarte/Kartenflaeche.tsx`: Donut-Sync und Spider-Controller über die
  Liste der Cluster-Quellen führen. DOM-Map-Schlüssel `${quelle}:${cluster_id}`,
  `oeffneSpider` mit Quelle. Verifikation: bestehende Kartenflaeche- und
  Lagekarten-Tests grün; eine reine Hilfsfunktion für den Schlüssel mit Unit-Test
  „zwei Quellen, gleiche `cluster_id` → zwei Schlüssel“.
- [x] 7.3 Kommentare nachziehen: `marker.ts` (`MarkerTyp`: keine Lagekarten-Ebene mehr),
  `Sidebar.tsx` (Platzier-Typ), `leistenDaten.ts` („zehn“), `clusterDonut.ts`.
  Verifikation: Beim `rg "keine Lagekarten-Ebene|zehn Schalter" frontend/src` bleibt kein
  veralteter Treffer.

## 8. Browser-Beleg (e2e)

- [x] 8.1 `e2e/betroffene-karte.spec.ts` auf die Quelle `marker-personen` umstellen.
  Verifikation: Der Spec ist grün, und ein Personen-Schlüssel steht nicht in
  `marker-cluster`.
- [x] 8.2 Neuer Spec `e2e/lagekarte-betroffene.spec.ts`:
  - Als Nicht-Admin: Person mit Koordinate anlegen und Ebene einschalten → Feature in
    `marker-personen`. Mit Override `personen` `sichtbar:false` → kein Feature, keine
    Zeile.
  - Ein Fahrzeug neben dreißig Personen bleibt in `marker-cluster` ein Einzel-Feature.
  - Ein Personen-Cluster fächert auf.

  Verifikation: `pnpm e2e` grün. Mutationsprobe „Person in `marker-cluster`“ färbt den
  Spec rot.

## 9. Abschluss

- [x] 9.1 Prüfliste Einsatztauglichkeit (15 Kriterien,
  `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`) für die
  geänderte Lagekarten-Leiste ausfüllen und im Change ablegen
  (`openspec/changes/lfh-648-lagekarte-betroffene-ebene/pruefliste.md`). Jede Zeile trägt
  ein Verdikt. Verifikation: Datei vorhanden, keine Zeile „nicht geprüft“.
- [ ] 9.2 Folgetickets per `clickup-task-anlegen`: (a) Org-Default-Drift im Client-Gate
  (`istModulGesperrt` kennt keine Org-Defaults), (b) der Platzier-Auftrag
  `?platzieren=person:` prüft nur das Schreibrecht, nicht das Modul „Personen“.
  Verifikation: Beide Tickets sind auf dem Entwicklungsboard angelegt und in der
  Abschlussmeldung genannt.
- [ ] 9.3 `./scripts/check-all.sh` vollständig ausführen. Verifikation: Exit-Code 0,
  ohne `| tail`.
