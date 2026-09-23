# Design

## Context

Warum die Änderung kommt, steht in `proposal.md`, die Anforderungen in
`specs/lagekarte-betroffene/spec.md`. Die folgenden Punkte sind am Code gemessen
(Scope-Lauf vom 23.09.2026) und bestimmen den Weg:

- **Was es schon gibt:**
  - `MarkerTyp` kennt `person` seit LFH-613 (`pages/lagekarte/marker.ts`).
  - `personenMarker(personen, token)` (`personen/personenKarte.ts`) ist die fertige, reine
    Signatur: Auswahl der angetroffenen, nicht stornierten Personen mit vollständigem
    Koordinatenpaar, Beschriftung `R-042 · SK II`, Kürzel im Kreis, Farbe aus der
    Sichtungsachse und `ohneKoordinate`.
  - `OBJEKTART.person` und das Donut-Segment `person` sind gezogen.
- **Heutiger Ausschluss:**
  - `LagekartePage.tsx` filtert `m.typ !== 'person'` hart heraus.
  - `LayerSichtbar` hat zehn Schlüssel, `LAYER_DEFAULT` steht auf „alle an“, und
    `leseLayer` legt den Default unter gespeicherte Werte.
- **Rechte:**
  - `GET …/personen` ist serverseitig am Modul `personen` gegatet (403).
  - `istModulFreigegeben` im Client kennt die Org-Defaults nicht, der Server schon. Der
    Client kann also „frei“ sagen, während der Server 403 antwortet.
  - `LiveEvent::Person` ist auf `["personen"]` gegatet und gepinnt. Der Query-Key
    `einsatzKeys.personen(einsatzId)` wird davon invalidiert und von Dashboard, Chat,
    Palette und Personenseite geteilt.
- **Cluster:**
  - Es gibt genau eine geclusterte Quelle `marker-cluster` (`markerLayer.ts`).
  - Der DOM-Donut-Sync und der Spider-Controller in `Kartenflaeche.tsx` lesen fest aus
    dieser Quelle, ihre DOM-Map ist nach `cluster_id` geschlüsselt.
- **Kartenansichten:** `layer_sichtbar` ist einsatzweit geteilt und im Backend opakes JSON.
- **Historien-Modus:** Der Snapshot trägt keine Personen, weder in
  `lage_snapshot/repo.rs` noch in `snapshotDaten.ts`.

## Goals / Non-Goals

**Goals:**
- Eine Signatur für beide Karten: `personenMarker` bleibt die einzige Quelle für Auswahl,
  Beschriftung, Kürzel und Farbe.
- Die Zugriffsgrenze sitzt an der Query, nicht am Schalter.
- Kein Backend-Eingriff.

**Non-Goals:**
- **Keine schlanke Karten-Projektion** (DTO ohne Name und Notiz). Entschieden am 23.09.2026:
  Wer Zugriff hat, lädt die volle Liste heute schon an vier anderen Stellen.
- **Keine Personen in gesicherten Lageständen**, also keine Änderung an `lage_snapshot`,
  `REDIGIERBARE_MODUL_FELDER` oder der Schwärzung.
- **Keine Aufweitung von `LiveEvent::Person` auf `lagekarte`.** Das wäre der
  Metadaten-Leak, den `src/live/mod.rs` ausschließt.
- **Keine Personen in der Ort-Vorschau/Peilung.** Die prüft nur Einsatz-Lesezugriff.
- **Kein Datenraster für Personen im Inspector.** Zustand und Verbleib sind
  personenbezogen, der Titel trägt die Sichtung bereits.
- **Keine Liste „Nicht verortet“ für Personen.** Die Lücke zeigt die Betroffenen-Seite.
- Die Org-Default-Drift im Client wird hier nicht geschlossen, sondern nur still abgefangen
  (D2). Folgeticket LFH-669.

## Decisions

### D1 Aufhebung des LFH-613-Non-Goals
Das Non-Goal „Kein Personen-Layer auf der Lagekarte“ aus
`lfh-613-betroffene-zustand-fundort-verbleib/design.md` (Non-Goals, D8) ist mit diesem
Change aufgehoben. Die Führungsentscheidung vom 23.09.2026 hat die zwei Gründe von damals so
beantwortet:
- **Datenschutz:** Nur wer das Modul „Personen“ hat, sieht etwas (D2).
- **Dichte:** Die Ebene ist standardmäßig aus (D4), und die Personen clustern in einer eigenen
  Quelle (D5).

Der Kommentar an `MarkerTyp` („keine Lagekarten-Ebene“) wird mitgezogen.

### D2 Daten-Gate an der Query, 403 als Zustand statt Fehler
`useLagekarteDaten` bekommt eine Personen-Query auf dem **bestehenden** Key
`einsatzKeys.personen(einsatzId)`. Damit gibt es kein neues Cache-Fach, keinen neuen
Guard-Eintrag, und die Live-Invalidierung ist schon da.

- **Geladen wird nur**, wenn gleichzeitig gilt:
  - Live-Modus (`liveAn`),
  - die Modul-Overrides sind geladen (`isFetched`, nach dem Muster von
    `command-palette/useDatensaetze.ts:darfLaden`),
  - `istModulFreigegeben(personen, benutzer, overrides)`.
- **Der Zugriff wird als `personenZugriff` abgeleitet:**
  - `'ausgeblendet'`: Modul im Einsatz unsichtbar oder nicht `fertig`.
  - `'gesperrt'`: Rollensperre im Client ODER ein 403 aus der Query. Letzteres ist die
    Org-Default-Drift.
  - `'rueckblick'`: Historien-Modus.
  - `'frei'`: sonst.
- **Fehlerbehandlung:** Ein 403 kommt NICHT in `fehlerhafteQuellen`, nach dem Muster der
  Rückmeldungen (LFH-610). Jeder andere Fehler bei freiem Modul steht dort als
  „Betroffene“.
- **Nach einem Fehler** liefert der Hook `[]` statt der Altdaten, die react-query
  stehenlässt.

Die Alternative „nur 403-tolerant, ohne Vorab-Prüfung“ ist verworfen. Sie schickt für jeden
Benutzer ohne Recht einen sicher abgelehnten Request, und die Zeile könnte „ausgeblendet“
nicht von „gesperrt“ unterscheiden.

### D3 Personen nicht in `alleVerortet`
Die Personen-Marker laufen als eigene Liste `personenVerortet` neben `alleVerortet`. Das hat
zwei Gründe:
- `alleVerortet` speist Startausschnitt und Kopfzahl „verortet“. Beide sollen
  rechteunabhängig und ebenenunabhängig bleiben (Spec „Startausschnitt und Kopfzahl“).
- Nichts, was `alleVerortet` heute speist, muss einen Personen-Fall lernen.

Diese Stellen lesen die neue Liste zusätzlich:
- `sichtbareMarker` in `LagekartePage`, und zwar nur bei `layer.person && personenZugriff === 'frei'`.
- Die Zählung der Ebenen-Zeile `person`.
- Der Marker-Lookup in `onMarkerWaehlen` bzw. `aktiverMarker`. Ohne ihn täte ein Klick
  nichts.

Der harte Filter `m.typ !== 'person'` fällt weg. Vorher bekommt er einen Regressionstest,
denn heute ist er ungetestet.

### D4 Elfter Ebenen-Schlüssel `person`, Vorgabe aus, keine Bereinigung
- `person` kommt in `LayerSichtbar`, `LAYER_KEYS` und `EBENEN` (Name „Betroffene“).
- `LAYER_DEFAULT.person` steht ausdrücklich auf `false`. `leseLayer` legt den Default unter,
  deshalb öffnen Bestandsansichten ohne Schlüssel mit ausgeschalteter Ebene.
- Das Flag wird für Benutzer ohne Zugriff **nie** umgeschrieben. Die Sichtbarkeit berechnet
  sich aus `layer.person && personenZugriff === 'frei'`. Würde das Flag auf `false`
  „bereinigt“, überschriebe ein Benutzer ohne Recht beim Speichern die eingeschaltete Ebene
  der Führungskraft.
- Das Backend-JSON ist opak, eine Migration braucht es nicht.

Ein Fachebenen-Eintrag wäre der falsche Träger. Fachebenen sind Fremdquellen mit
Backend-Pfadparameter, die Schlüsselliste ist in `fachebenen.test.ts` gepinnt.

### D5 Eigene geclusterte Quelle `marker-personen`
- **Aufteilung:** `sorgeFuerMarkerLayer`/`reAnlegenMarker` teilen die clusterbaren Marker
  aus `baueMarkerFc` an EINER Stelle auf (`teileNachQuelle`): was `clusterQuelle: 'personen'`
  trägt, geht nach `marker-personen`, der Rest nach `marker-cluster`. Das Feld setzt NUR die
  Lagekarte. Die Betroffenen-Karte behält ihre Personen in `marker-cluster` samt
  Sichtungs-Donut, Trefferzone und Außenkante aus LFH-650; dort gibt es keine Kräfte, die ein
  Donut verdecken könnte. Datengetrieben statt per Kartenschalter, damit `kartenLayer.ts` nach
  einem Stilwechsel nichts weiter wissen muss (Merge mit LFH-650, 23.09.2026). Beim Umsetzen gewählt statt einer
  eigenen `bauePersonenFc` mit neuer Signatur, weil so weder `kartenLayer.ts` noch eine
  Konsumentin der Kartenfläche wissen muss, dass es zwei Quellen gibt. Die Personen-Quelle
  ist geclustert wie `marker-cluster` (Radius 45, `clusterMaxZoom` 14, `clusterProperties`).
- **Layer:** Personen tragen kein Icon und keinen Status. Sie brauchen deshalb nur Kreis,
  Kürzel und Plakette: `personen-kreis`, `personen-kurz`, `personen-label`. Diese Layer
  kommen in `MARKER_LAYER_REIHENFOLGE` **vor** alle übrigen Marker-Layer, liegen also unter
  den Kräften. Sie werden in die Klick-Layer aufgenommen.
- **Personen-Cluster als WebGL-Layer, nicht als DOM-Donut** (Review-Befund beim Umsetzen):
  Ein DOM-Donut hängt über dem Canvas. Er deckte ein Fahrzeugzeichen zu und fing dessen
  Klick ab, das verletzte „Cluster unter den Kräften“. Deshalb zeichnen
  `personen-cluster-kante`, `personen-cluster-kreis` und `personen-cluster-zahl` die Cluster,
  ganz unten in `MARKER_LAYER_REIHENFOLGE`. Die Füllung ist die Farbe der DRINGLICHSTEN
  Sichtung, darin stehen Zahl und Kürzel. Beides kommt aus derselben Aggregation `s_<kategorie>`
  wie der Sichtungs-Donut aus LFH-650, das Rosé aus LFH-613 entfällt. Die Einzel-Personen
  tragen dort Trefferzone und Außenkante wie in `marker-cluster` (`personen-treffer`,
  `personen-kante`). Der Donut-Sync bleibt bei `marker-cluster` allein; mit zwei
  Quellen hatte er zudem die Donuts einer nachladenden Quelle abgeräumt (Flackern).
  - Ein Karten-Klick fächert einen Personen-Cluster nur auf, wenn er das OBERSTE Feature am
    Punkt ist (`personenClusterTreffer`, rein). Liegt ein Kräfte-Zeichen darüber, gehört der
    Klick dem Zeichen.
  - Der Spider-Controller bekommt die Quelle mit (`oeffne(quelle, …)`), damit
    `getClusterLeaves`/`getClusterExpansionZoom` die richtige Quelle fragen. Sein
    Offen-Schlüssel ist `${quelle}:${cluster_id}`, denn `cluster_id` ist nur je Quelle
    eindeutig. Die Spider-Quellen bleiben gemeinsam.
- **Betroffene-Karte:** Sie nutzt dieselbe `Kartenflaeche`, ihre Personen landen dadurch in
  der neuen Quelle. Sichtbar ändert sich dort nichts, aber `e2e/betroffene-karte.spec.ts`
  liest dann `marker-personen` statt `marker-cluster`.

Verworfen: Personen in `marker-cluster` mit Donut-Segment. Das kostet nichts, schluckt bei
MANV-Dichte aber genau die Kräfte, die das Ticket schützen will.

### D6 Ebenen-Zeile mit Sperrzustand, Legende aus der Sichtungsachse
- **Zeile:** `EbenenZeilenKnopf` bekommt einen optionalen Sperrgrund. Die Darstellung
  folgt der Einsatz-Navigation (`einsatz/ModulPanel.tsx`: `disabled`, `LockOutlined` in
  `aria-hidden`-Hülle, Titel „Keine Berechtigung“). Eine gesperrte Zeile zeigt
  **keine Anzahl** und ist kein `role="switch"`-Ziel, das sich umschalten lässt. Der Grund
  steht im zugänglichen Namen und im sichtbaren Text, nicht nur in der Farbe (WCAG 1.4.1).
- **Die drei Zustände:**
  - `'ausgeblendet'`: keine Zeile.
  - `'gesperrt'`: Zeile mit dem Grund „Keine Berechtigung“.
  - `'rueckblick'`: Zeile mit dem Grund „Nicht in gesicherten Lageständen“.
- **Farbfeld der Zeile:** Es bekommt einen eigenen Fall in `ebenenFarbe`, die Rolle
  `neutral`. Der Default `bedien` wäre Blau, und Blau bedient. Die Marker selbst tragen
  Sichtungsfarben, ein einzelnes Farbfeld kann die nicht erklären. Das übernimmt die
  Legende.
- **Legende:** Eine neue Komponente `Sichtungslegende` erscheint unter der Zeile, nur bei
  `layer.person && personenZugriff === 'frei'`.
  - Sie liest `sichtung` aus `theme/statusFarben.ts` und `sichtungsfarben` aus
    `theme/tokens.ts`. Das Kürzel kommt aus `SK_KURZZEICHEN`, das dafür aus
    `personenKarte.ts` exportiert wird. Das Wort kommt aus `SK_WORT`.
  - Sie baut **kein** neues `Record<…, StatusDarstellung>` außerhalb von `statusFarben.ts`
    (`statusVertrag.guard`) und keinen Hexwert außerhalb von `theme/` (`gate5.guard`).
  - Sie ist kein Bedienziel und hat damit keinen Dichte-Boden.

### D7 Inspector: Link, Unterzeile, Verortung löschen
- `markerToUrl` bekommt den Fall `person` → `personDetailPfad(einsatzId, id)`. Das ist die
  Item-Route nach dem Deeplink-Muster, nicht `personenPfad(?person=)`. Heute fällt `person`
  still auf `einsatzdatenPfad`, weil der Switch einen Default hat.
- `inspectorExclude` bekommt einen expliziten Zweig `person` (leer).
- `loescheVerortung` bekommt den Zweig `person`: `aktualisierePerson` mit **nur**
  `{ antreff_lat: null, antreff_lon: null }`. Invalidiert werden `personen` und `person`,
  wie im Platzier-Zweig. Das Backend prüft Schreibrecht, Modul und die Paarregel. Heute
  steht der Knopf am Personen-Marker und tut nichts.
- Titel ist `marker.label` („R-042 · SK II“), Unterzeile `OBJEKTART.person` („Person“). Ein
  Datenraster gibt es nicht (Non-Goal).

### D8 Historien-Modus
Im Snapshot ist die Query aus (`liveAn`), `personenZugriff` steht auf `'rueckblick'`, und
`personenVerortet` ist leer. Die Zeile zeigt den Grund und keine Anzahl. Eine „0“ wäre
falsch, der Stand wurde schlicht nicht gesichert.

## Risks / Trade-offs

- **Volle Personenliste im Browser für die Kartenebene** → Datenminimierung ist bewusst nicht
  Teil dieses Changes (Entscheidung 23.09.2026). Dieselben Benutzer laden die Liste schon
  über Dashboard, Chat und Palette, und angezeigt wird nur Registriernummer plus Sichtung.
  Ein Test mit gesetztem Namen pinnt, dass nichts davon auf die Karte gelangt.
- **Org-Default-Drift** (Client „frei“, Server 403) → wird als `'gesperrt'` aufgefangen,
  nicht als Ausfall. Der eine abgelehnte Request bleibt. Die strukturelle Lösung, eine
  effektive Freigabe-Map vom Server, ist ein Folgeticket.
- **Umbau der Cluster-Mechanik in `Kartenflaeche`** trifft auch die Betroffenen-Karte und
  jede andere Konsumentin → Schlüssel `${quelle}:${cluster_id}` und die Quelle im
  Spider-Aufruf. jsdom rechnet kein WebGL, deshalb belegt ein e2e-Lauf beide Karten:
  Personen-Features liegen in `marker-personen`, kein `schluessel` mit Präfix `person-` in
  `marker-cluster`, Spider auf einem Personen-Cluster.
- **Rechteentzug während der Sitzung** → Der Live-Filter ist ein Snapshot beim
  Verbindungsaufbau. `person`-Events tragen nur IDs, der Refetch liefert sofort 403 und kippt
  auf `'gesperrt'`. Das ist akzeptiert und dokumentiert (`src/routes/live.rs`).
- **Elfter Schalter** → Zwei Bestandstests pinnen „zehn“: `leistenDaten.test.ts` (Abgleich
  `EBENEN` gegen die Fixture) und `Sidebar.test.tsx` (`toHaveLength(10)`). Der zweite wird
  zum Paar: 11 Zeilen mit Zugriff, 10 bei ausgeblendetem Modul.
- **MSW `onUnhandledRequest: 'error'`** → Ohne Anmeldung (`/auth/me` → 401) ist `personen`
  im Client freigegeben, weil keine Rolle nötig ist. Die Query läuft also in allen
  Lagekarten-Tests, und `basisHandler` braucht einen Standard-Handler für `…/personen`.

## Migration Plan

Keine Datenmigration. Bestehende Kartenansichten öffnen mit ausgeschalteter Ebene (D4).
Rückbau: den Schlüssel entfernen. Gespeicherte `person`-Werte bleiben dann als unbekannter
Schlüssel im opaken JSON liegen und schaden nicht.

## Open Questions

Keine, die Spec oder Aufgabenschnitt ändern.

Die Folgetickets hat die Umsetzung per `clickup-task-anlegen` angelegt, statt sie mitzunehmen:
- **LFH-669** Org-Default-Drift im Client-Gate.
- **LFH-670** Der Platzier-Auftrag `?platzieren=person:<id>` prüft nur das Schreibrecht, nicht
  das Modul „Personen“.
- **LFH-671** (aus der Prüfliste, Kriterium 5) Ausgeschaltete Ebenen-Zeilen stehen in `schwach`
  und erreichen im Tagmodus nur 5,8 : 1. Das ist Bestand und gilt für alle Zeilen.
