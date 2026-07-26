# Gestaltungssprache (LFH-352 · A0)

**Stand:** 2026-07-26 · **Status: entschieden — die Gestaltungssprache ist Richtung E ·
Lagekarte nachts.** Farben aus A, Dichte aus B, Formensprache aus C. Der Rest dieses Dokuments
hält fest, wie die Entscheidung zustande kam, was sie bereits mitentscheidet und was sie
ausdrücklich offen lässt.

**Prüfstand:** `/gestaltung/:einsatzId` (Sandbox-Route, Wegwerf-Gerüst)
**Datengrundlage:** echter Einsatz mit echtem Lagebild — nicht erfunden, nicht ideal.

**Verworfen und warum:**

|                       | Grund der Verwerfung                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A · Nachtbrücke**   | Farbwelt überzeugt und wurde übernommen; Flächenwirkung (Radius 10, Schatten) und Dichte blieben hinter B und C zurück.           |
| **B · Werkzeugtafel** | Entsättigtes Grüngrau und Radius-0-Härte wurden nicht als die Handschrift der Anwendung gesehen; die **Dichte** wurde übernommen. |
| **C · Kartenwerk**    | Kartenblauer Grundton und Papier-Hell traten hinter A's Nachtblau zurück; die **Formensprache** wurde vollständig übernommen.     |
| **D · Nachtkarte**    | Zwischenschritt: bewies, dass Tiefe und Fachsprache orthogonal sind. Von E überholt, weil D die Dichte von A behielt.             |

---

## Was zur Entscheidung steht

Drei Richtungen, gebaut als **lauffähiger Code an derselben echten Seite** (Lage-Dashboard),
mit denselben echten Daten, in **echten Schriften**, je hell und dunkel, bei 1366 / 1024 / 390 px,
in den vier Datenzuständen (Daten · lädt · Fehler · leer).

|                     | A · Nachtbrücke                            | B · Werkzeugtafel                                 | C · Kartenwerk                                 |
| ------------------- | ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| **Haltung**         | Die Anmeldeseite konsequent weitergedacht  | Nüchternes Instrument, keine Show                 | Messtischblatt, Fachsprache der Karte          |
| **Fläche**          | Tiefe: Radius 10 px, Schatten als Erhebung | Radius 0, keine Schatten, kollabiertes Rasternetz | Radius 0, Umrissrahmen, feines Gitter im Grund |
| **Schrift Text**    | IBM Plex Sans                              | Atkinson Hyperlegible Next                        | Archivo                                        |
| **Schrift Kopf**    | IBM Plex Sans Condensed                    | Atkinson Hyperlegible Next                        | Archivo Narrow                                 |
| **Schrift Zahl**    | IBM Plex Mono                              | Atkinson Hyperlegible Mono                        | JetBrains Mono                                 |
| **Schriftbudget**   | 117,6 KB · 6 Schnitte                      | **56,2 KB · 5 Schnitte**                          | 96,6 KB · 6 Schnitte                           |
| **Marker**          | Balken                                     | Quadrat                                           | Dreieck (DV-102-Formensprache)                 |
| **Grundton hell**   | kühles Blaugrau                            | entsättigtes Grüngrau                             | Papier / Messtischblatt                        |
| **Grundton dunkel** | Nachtblau, sehr dunkel                     | dunkles Olivgrau                                  | Kartenblau                                     |

Alle drei sind **echte Alternativen**, keine Abstufungen derselben Idee. Alle drei setzen
dieselben Sweep-Befunde um (Wortlaut statt nackter Zähler, zweiter Kanal neben der Farbe,
`tabular-nums`, Instrumentenband, Fehler ≠ leer) — sie unterscheiden sich in der Haltung,
nicht im Funktionsumfang.

### Runde 2 (26.07.): B ist raus, D kommt dazu

Der Auftraggeber hat **A und C** als Favoriten benannt, **B ist damit verworfen** — die
entsättigte Werkzeugtafel war die nüchternste und dichteste Richtung, aber nicht die, in der
sich die Anwendung wiedererkennen soll.

A und C liegen nicht so weit auseinander, wie die Vorrunde annahm („C lässt sich nicht
mischen"). Diese Annahme galt für den **Grundton** — sie gilt nicht für die **Formensprache**.
Deshalb steht jetzt eine vierte Richtung zur Wahl, gebaut als echte Kreuzung:

|              | D · Nachtkarte                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aus A**    | Flächenwirkung und Ruhe: Radius 8 px, Schatten als Erhebung, dunkler Grund fürs Fahrzeug, der glühende Akzentstrich der Anmeldeseite als Marke        |
| **Aus C**    | Formensprache: Dreiecksmarker nach DV 102, Messtischblatt-Raster als leiser Grund, gesperrte Versalien als Kartenbeschriftung, kartenblauer Bedienton |
| **Schrift**  | Archivo Narrow für die Köpfe (kartografisch, schmal) über IBM Plex Sans / Plex Mono (bester Ziffernsatz der Kandidaten)                               |
| **Budget**   | 110,1 KB · 6 Schnitte                                                                                                                                 |
| **Kontrast** | alle Ziele erfüllt, tragende Linien 3,03:1 in beiden Modi                                                                                             |

D beantwortet die Frage, die zwischen A und C steht: **muss man sich zwischen der Tiefe der
Anmeldeseite und der Fachsprache der Karte entscheiden?** Die Antwort ist nein — die Tiefe
sitzt in Fläche, Radius und Schatten, die Fachsprache in Ikonografie, Raster und Beschriftung.
Beides ist orthogonal und lässt sich zusammen tragen.

### Runde 3 (26.07.): E · Lagekarte nachts — Farben A, Dichte B, Stil C

Der Auftraggeber hat die Zusammensetzung präzisiert: **„die Farben aus A, die Dichte aus B, den
Stil aus C"**. Das ist keine vierte Meinung, sondern eine sauber zerlegte — und genau die
Zerlegung, die der Aufbau der Sandbox hergibt, weil Farbe, Raster und Form als getrennte
Rollen liegen und nicht in einem Stil verklebt sind.

| Aus            | Was genau                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Farben** | Nachtblau `#0b0e13` / `#161c25`, blaue Bedienfarbe `#6fb4ec`, Alarm/Achtung/Normal aus A, der glühende rote Akzentstrich der Anmeldeseite als Marke. Heller Modus: A's kühles Blaugrau.              |
| **B · Dichte** | 13,5 px Grundschrift, 11/18 px Polsterung, 30 px Zeilenhöhe, Kennzahlen 62 px statt 76 px, Fugen 8 px. Rund ein Drittel mehr Inhalt je Fläche als A.                                                 |
| **C · Stil**   | Radius 0, Umrissrahmen statt Erhebung, Messtischblatt-Raster im Grund (in A-Blau gezogen), Dreiecksmarker nach DV 102, weit gesperrte Kartenbeschriftung, Archivo / Archivo Narrow / JetBrains Mono. |

**Die eine nötige Abweichung von A:** die Trennlinie. In A ist sie schmückend (1,63:1), weil
Radius und Schatten die Kachel mittragen. Im Stil C **trägt der Rahmen die Kachel** — damit
wird die Linie zum WCAG-1.4.11-Fall und liegt bei **3,04:1 dunkel / 3,07:1 hell**. Alle
übrigen Farbrollen sind byte-gleich mit A.

Budget: **96,6 KB · 6 Schnitte** (Archivo + Archivo Narrow + JetBrains Mono). Alle
Kontrastziele erfüllt.

## Was in allen drei Richtungen schon entschieden ist

Diese Punkte sind **nicht** Teil der Wahl — sie gelten unabhängig davon, welche Richtung
gewinnt, weil alle drei sie gleich lösen:

- **Rot ist Gefahr, nichts anderes.** `--gs-bedien` ist in jeder Richtung eine andere,
  nicht-rote Farbe (A Blau, B Petrol, C Kartenblau). Das Markenrot lebt nur noch am
  Akzentstrich (`--gs-marke`). **Damit ist LFH-315 entschieden** — der Fokus-Ring läuft in
  der Bedienfarbe und liest sich nicht mehr als Fehlerzustand.
- **Fehler sieht nicht mehr aus wie leer.** Der Fehlerzustand trägt Rahmen, Zeichen, den Satz
  „Stand unbekannt — nicht als Lage melden" und einen Wiederholen-Knopf; die Kennzahl zeigt
  `?` statt einer Zahl. Der Leerzustand trägt eine ruhige Fläche mit einem Handlungsangebot.
- **Jeder Leerzustand führt zu einer Aktion** (heute: 1 von 46).
- **Kennzahlen tragen Wortlaut**, nicht nur Zähler: „hoch" statt „3", „Suche läuft" statt „2".
- **Zweiter Kanal neben der Farbe** (WCAG 1.4.1): Stufenkante an der Kennzahl, Text in jeder
  Plakette, Form am Zeilenmarker.
- **`tabular-nums` überall dort, wo fachlich gezählt wird** — Stärke, DTG, Koordinaten,
  Funkrufnamen, laufende Nummern.
- **Container-Queries statt Viewport-Media-Queries.** Ein Breakpoint, der nur am
  Designer-Monitor stimmt, ist keiner.
- **Übergänge 120 ms**, `prefers-reduced-motion` respektiert.

## Was die Entscheidung war — und was sie widerlegt hat

Die Vorrunde hielt drei Punkte für die eigentliche Wahl. Zwei davon haben sich als
Scheinalternativen erwiesen, weil der Sandbox-Aufbau Farbe, Raster und Form als **getrennte
Rollen** hält statt sie in einem Stil zu verkleben:

1. **„Dichte oder Atmosphäre"** — falsch gestellt. E trägt A's Farbwelt bei B's Dichte; die
   Dichte sitzt in Polsterung, Grundschriftgröße und Zeilenhöhe, nicht in der Farbe.
2. **„C lässt sich nicht mischen"** — galt nur für den Grundton. Die Formensprache
   (Dreiecksmarker, Kartenraster, gesperrte Beschriftung) ist von ihm unabhängig und wurde
   vollständig übernommen, während der Grundton A blieb.
3. **Was tatsächlich zu entscheiden war**, blieb übrig: wie weit die Fachsprache in die
   Oberfläche reicht. Die Antwort ist: weit — DV-102-Formen tragen Marker und Sektionsmarken,
   das Messtischblatt-Raster liegt im Grund. Das ist der authentischste Unterscheider dieser
   Anwendung, und es ist auch das Risiko: **das Raster muss diszipliniert bleiben**, sonst
   wird aus der Kartensprache Dekoration.

## Gemessenes, nicht Behauptetes

**Kontrast** — geprüft gegen die A1-Ziele (Tag ≥ 7:1, Nacht ≥ 5:1, nie unter 4,5:1,
Zustände/Rahmen/Fokusring ≥ 3:1; Quellen im Anhang `ergebnis.md` an LFH-327).
Prüfskript rechnet die Rollen direkt aus `varianten.css`, inklusive Auflösung der
`rgba()`-Linien über ihrer Fläche.

- **Alle Textrollen aller fünf Richtungen erfüllen ihr Ziel** — der schwächste Wert liegt bei
  4,80:1 gegen ein Ziel von 4,5:1, die Fließtext-Rollen zwischen 10,48:1 und 18,17:1.
- **Für E gemessen:** Text auf Fläche 13,47:1 (dunkel) / 18,17:1 (hell) · gedämpft 6,99 / 7,58 ·
  Bedienfarbe und Fokusring 7,67 / 6,59 · Alarm 6,80 / 6,78 · tragende Linie 3,04 / 3,07.
- **Trennlinien:** wo der Rahmen oder die Fuge die Kachel **trägt** (B, C, D, E), sind sie ein
  WCAG-1.4.11-Fall und liegen bei ≥ 3:1. In A allein trägt zusätzlich Radius und Schatten —
  dort bleibt die Linie schmückend (1,63:1 / 1,90:1) und ist kein Gate. **Das ist die einzige
  Farbrolle, in der E von A abweicht**; alle übrigen sind wertgleich.

**Schrift** — alle Kandidaten SIL OFL 1.1, `latin`-Subset (deutsche Diakritika und `ß`
vollständig), lokal ausgeliefert, kein CDN. Zeichenunterscheidbarkeit an einem gerenderten
Specimen geprüft (`1 l I` · `0 O` · `5 S` · `8 B` · `2 Z` · `6 b 9 g`):

- **Atkinson** zeichnet die **geschlitzte Null** und ein `l` mit Schwanz — der deutlichste
  Ziffernsatz der drei, und die einzige Familie, die explizit auf Unterscheidbarkeit
  gezeichnet wurde. Kleinstes Budget.
- **Plex Mono** trennt `1 l I` sauber über Serifen an `I` und Bogen an `l`.
- **JetBrains Mono** hat die kräftigsten Ziffern, `0` mit Punkt.

**Budget:** **E braucht 96,6 KB in 6 Schnitten** (Archivo 400/500/700, Archivo Narrow 600,
JetBrains Mono 400/600) — gut unter dem 200-KB-Deckel. Der Ordner enthält derzeit noch alle
Kandidaten (270,4 KB); Plex und Atkinson fliegen mit dem Aufräumen der Sandbox raus.

## Umgesetzt (26.07.2026)

A0 ist vollständig — die Sprache steht nicht nur im Dokument, sondern in der Anwendung:

|                       | Wo                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rollen, TS-Seite**  | `frontend/src/theme/tokens.ts` — Farbrollen je Modus, Abstandsraster, Form, Schriftrollen, plus `antdToken()` als **einzige** Ableitungsrichtung zu antd |
| **Rollen, CSS-Seite** | `frontend/src/theme/rollen.css` — dieselben Werte als statische Custom Properties unter `:root` / `[data-theme='dark']`                                  |
| **Driftschutz**       | `frontend/src/theme/rollen.guard.test.ts` — 43 Prüfungen, die beide Seiten Wert für Wert vergleichen                                                     |
| **Bausteine**         | `frontend/src/theme/sprache.css` — die fünf Signatur-Elemente, ausschließlich aus `--lfh-*` gebaut                                                       |
| **Schriften**         | `frontend/src/theme/schriften.css` + `src/assets/fonts/` — 96,6 KB, 6 Schnitte, OFL-Texte daneben                                                        |
| **Referenzseite**     | `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx` — das echte Dashboard in E                                                                     |
| **Anmeldeseite**      | `frontend/src/pages/LoginPage.css` — Akzentstrich, Marke und TOTP-Ziffern auf die Rollen gezogen                                                         |

**Warum die CSS-Rollen statisch sind und nicht aus dem Provider kommen:** `index.html` setzt
`data-theme` synchron vor dem React-Mount. Eine Property, die erst ein `useEffect` an `<html>`
hängt, existiert beim ersten Paint nicht — jede Regel, die sie liest, fiele auf ihren Fallback,
und im Nachtbetrieb wäre das ein weißer Blitz.

**Warum die Redundanz einen Test braucht:** eine Drift zwischen `tokens.ts` und `rollen.css`
**bricht nichts**. Kein Fehler, kein roter Build — die antd-Fläche trüge nur eine andere Farbe
als die handgeschriebene daneben, und das fiele erst jemandem im Einsatz auf. Derselbe Grund,
aus dem die Wire-Strings der Query-Keys byte-gepinnt sind.

### Gemessene Nachweise

- **Offline:** Anwendung mit hart abgebrochenen Fremd-Anfragen geladen — 0 externe Requests,
  alle drei Familien geladen, Fließtext rendert in `LFH Archivo`, Zahlen in
  `LFH JetBrains Mono`. Keine Systemschrift-Ersetzung.
- **Budget:** `du -ch frontend/src/assets/fonts/*.woff2` → 108K Blockgröße, 96,6 KB echt.
- **Kein CDN:** `grep -rn "fonts.googleapis\|fonts.gstatic" frontend/` = 0 Treffer.
- **Testsuite:** 1600 Vitest-Tests grün, `pnpm lint --max-warnings 0` und `tsc` sauber.

### Was der Umbau am Verhalten geändert hat

- **Kennzahl-genaue Datenzustände.** Vorher zeigte eine tote Abfrage `—` wie „nichts
  vorhanden". Jetzt zeigt jede Kennzahl den Zustand **ihrer eigenen** Quelle: `?` plus „Stand
  unbekannt" bei Fehler, `····` beim Laden. Ein Ausfall der Gefahrenmatrix macht die
  Patientenzahl daneben **nicht** unkenntlich — dafür gibt es einen eigenen Test.
- **Die Seitenüberschrift ist weg.** Die Bezeichnung steht im Instrumentenband; die
  Überschriften-Ebene gehört den Kachelköpfen. `App.test.tsx` und der Dashboard-Test sind
  mitgezogen, nicht gelöscht — sie belegen weiterhin dieselben Zahlen.
- **Die alten Kachel-Komponenten sind entfallen** (`BetroffeneKachel`, `KraefteKachel`,
  `InfrastrukturKachel`, `LageberichtKachel`, `AuftraegeKachel`, `MeldungenKachel`,
  `KennzahlenLeiste`, `klickbar`). Ihre Logik lebt in `lagebild.ts`, ihre Form in `sprache.css`.

### Container-Queries statt Viewport — mit sichtbarer Folge

Die Referenzseite bricht bei **1366 px Viewport** auf zwei Kachelspalten, weil Sidebar und
Modulpanel rund 420 px wegnehmen und der Inhalt real ~950 px hat. Das ist kein Fehler, sondern
der Zweck: der Breakpoint richtet sich nach der Fläche, die der Inhalt wirklich hat. Eine
Viewport-Media-Query hätte hier drei Spalten in 950 px gequetscht.

## Was bewusst noch nicht entschieden ist

- **`cssVar: true` am `ConfigProvider`.** Die Sandbox umgeht antd vollständig; die
  Referenzseite wird es nicht können. `LoginPage.css:83` nutzt heute
  `var(--ant-color-primary, #a8071a)` und läuft still auf den Fallback, weil `cssVar` nicht
  aktiv ist. Die Umstellung hat App-weiten Rendering-Radius und gehört als eigene, bewusste
  Entscheidung in A2 (LFH-328) — nicht nebenbei.
- **Die Dichte-Staffel** (kompakt / komfortabel / Handschuh) — das ist A1 (LFH-327). E setzt
  heute **eine** Dichte (die kompakte aus B); ob Tablet und mobil eine komfortablere Stufe
  bekommen, entscheidet A1.
- **Taktische Zeichen als vollständige Modul-Ikonografie.** E nimmt die Formensprache in
  Marker und Sektionsmarken auf; die Ableitung echter DV-102-Signaturen aus
  `taktischesZeichen.ts` für Modulnavigation und Listenzeilen steht noch aus.
- **Das Instrumentenband** ist in E gestalterisch gesetzt (DTG, Einsatz, Gesamtstärke,
  Verbindungszustand); die Funktion — Zeitformat, taktische Uhr, Zeit-Schnellzugriff — bleibt
  bei LFH-294/295.

## Sandbox — was danach verschwindet

`frontend/src/pages/gestaltung/` (Harness, Muster, Varianten-CSS, Schriften-CSS), die Route
`/gestaltung/:id` in `App.tsx` und die nicht gewählten Schriftschnitte. Bewusst **nicht** in
`frontend/src/routing/deeplinks.ts` eingetragen — die Sandbox ist kein Deeplink-Ziel.

Was **bleibt** und in A2 übergeht: das Rollen-Vokabular aus dem Kopf von `varianten.css`
(Flächen, Linien, Text, Bedienung, Status, Marke, Schrift, Form, Raster, Erhebung, Stimme)
und der `.gs--e`-Block mit seinen Werten. Es ist bereits token-förmig — genau die Übergabe,
die LFH-352 Schritt 7 verlangt.

**Vor dem Aufräumen nicht wegwerfen:** die vier verworfenen Theme-Layer bleiben bis zur
gemergten Referenzseite im Branch stehen. Wer beim Umbau merkt, dass eine Entscheidung nicht
trägt, will vergleichen können — und ein gelöschter Layer ist teurer wiederherzustellen als
stehenzulassen.

## Signatur-Elemente von E (die drei aus Schritt 4)

1. **Der Akzentstrich als Marke** — der glühende 36 × 3 px Balken der Anmeldeseite, unverändert
   aus `LoginPage.css` übernommen. Bindet die Anwendung an die eine Fläche, die schon
   Handschrift hatte.
2. **Das Dreieck als Sektionsmarke** — die DV-102-Formensprache trägt Kachelköpfe und
   Zeilenmarker. Statusstufen werden dadurch auch ohne Farbe unterscheidbar (zweiter Kanal).
3. **Zahlen als Instrument** — JetBrains Mono mit `tabular-nums` auf allen fachlichen Zahlen;
   die Stärke in BOS-Schreibweise (`5/6/24//35`) ist das größte Element der Kräfte-Kachel.
4. **Das Instrumentenband** — schmal, immer sichtbar, immer an derselben Stelle: Marke, Einsatz,
   DTG, Gesamtstärke, Verbindungszustand.
5. **Gesperrte Versalien als Metadaten-Stimme** — Etiketten, Spaltenköpfe und Absender in
   2,2 px Sperrung; das ist der Unterschied zwischen Formular und Werkzeug.
