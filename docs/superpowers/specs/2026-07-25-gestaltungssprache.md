# Gestaltungssprache — Entscheidungsvorlage (LFH-352 · A0)

**Stand:** 2026-07-26 · **Status:** Richtungsentscheidung offen — dies ist die Vorlage, nicht
das Ergebnis. Sobald entschieden ist, wird dieses Dokument zur Spec umgeschrieben: die
gewählte Richtung mit ihren Werten und Begründungen, die beiden anderen als verworfene
Alternativen mit dem Grund der Verwerfung.

**Prüfstand:** `/gestaltung/:einsatzId` (Sandbox-Route, Wegwerf-Gerüst)
**Datengrundlage:** echter Einsatz mit echtem Lagebild — nicht erfunden, nicht ideal.

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

## Was die Wahl tatsächlich entscheidet

1. **Dichte.** Der Unterschied zwischen A und B ist vor allem Informationsmenge je Fläche.
   Diese Frage prägt den Arbeitsalltag stärker als die Farbwahl.
2. **Tag oder Nacht als Leitfall.** A ist als Nachtmodus gedacht und im hellen Modus die
   Übersetzung; B umgekehrt. **A und B teilen dieselbe Struktur** und lassen sich als
   Nacht-/Tagmodus einer Sprache kombinieren. **C lässt sich nicht mischen** — C ist ganz
   oder gar nicht.
3. **Wie weit die Fachsprache trägt.** C nimmt die DV-102-Formensprache in die Oberfläche
   (Dreiecksmarker, Umrissrahmen, Kartenraster). Das ist der authentischste Unterscheider —
   und das höchste Risiko, weil das Raster diszipliniert bleiben muss.

## Gemessenes, nicht Behauptetes

**Kontrast** — geprüft gegen die A1-Ziele (Tag ≥ 7:1, Nacht ≥ 5:1, nie unter 4,5:1,
Zustände/Rahmen/Fokusring ≥ 3:1; Quellen im Anhang `ergebnis.md` an LFH-327).
Prüfskript rechnet die Rollen direkt aus `varianten.css`, inklusive Auflösung der
`rgba()`-Linien über ihrer Fläche.

- **Alle Textrollen aller drei Richtungen erfüllen ihr Ziel** — der schwächste Wert liegt bei
  4,80:1 gegen ein Ziel von 4,5:1, die Fließtext-Rollen zwischen 10,48:1 und 18,17:1.
- **Trennlinien:** in B (die Fuge _ist_ die Kachelgrenze) und C (der Umrissrahmen _ist_ die
  Kachel) sind sie tragend im Sinne von WCAG 1.4.11 und wurden auf ≥ 3:1 angehoben
  (B dunkel 3,01:1 · B hell 3,04:1 · C dunkel 3,06:1 · C hell 3,09:1). In A trägt zusätzlich
  Radius und Schatten — dort bleibt die Linie schmückend (1,63:1 / 1,90:1) und ist kein Gate.

**Schrift** — alle Kandidaten SIL OFL 1.1, `latin`-Subset (deutsche Diakritika und `ß`
vollständig), lokal ausgeliefert, kein CDN. Zeichenunterscheidbarkeit an einem gerenderten
Specimen geprüft (`1 l I` · `0 O` · `5 S` · `8 B` · `2 Z` · `6 b 9 g`):

- **Atkinson** zeichnet die **geschlitzte Null** und ein `l` mit Schwanz — der deutlichste
  Ziffernsatz der drei, und die einzige Familie, die explizit auf Unterscheidbarkeit
  gezeichnet wurde. Kleinstes Budget.
- **Plex Mono** trennt `1 l I` sauber über Serifen an `I` und Bogen an `l`.
- **JetBrains Mono** hat die kräftigsten Ziffern, `0` mit Punkt.

**Budget:** jede Paarung liegt unter dem 200-KB-Deckel. Der Ordner enthält aktuell alle drei
(270,4 KB) — nach der Entscheidung bleibt **eine** übrig.

## Was bewusst noch nicht entschieden ist

- **Die Richtung selbst** — das ist der Ergebnisgegenstand dieses Tasks.
- **`cssVar: true` am `ConfigProvider`.** Die Sandbox umgeht antd vollständig; die
  Referenzseite wird es nicht können. `LoginPage.css:83` nutzt heute
  `var(--ant-color-primary, #a8071a)` und läuft still auf den Fallback, weil `cssVar` nicht
  aktiv ist. Die Umstellung hat App-weiten Rendering-Radius und gehört als eigene, bewusste
  Entscheidung in A2 (LFH-328) — nicht nebenbei.
- **Feineres Subsetting** (nur die tatsächlich benutzten Zeichen) — lohnt erst, wenn feststeht,
  welche Familie bleibt.
- **Die Dichte-Staffel** (kompakt / komfortabel / Handschuh) — das ist A1 (LFH-327).
- **Taktische Zeichen als Modul-Ikonografie.** C deutet die Formensprache an; die
  vollständige Ableitung aus `taktischesZeichen.ts` ist nach der Entscheidung zu bauen.

## Sandbox — was danach verschwindet

`frontend/src/pages/gestaltung/` (Harness, Muster, Varianten-CSS, Schriften-CSS), die Route
`/gestaltung/:id` in `App.tsx` und die nicht gewählten Schriftschnitte. Bewusst **nicht** in
`frontend/src/routing/deeplinks.ts` eingetragen — die Sandbox ist kein Deeplink-Ziel.

Was **bleibt** und in A2 übergeht: das Rollen-Vokabular aus dem Kopf von `varianten.css`
(Flächen, Linien, Text, Bedienung, Status, Marke, Schrift, Form, Raster, Erhebung, Stimme).
Es ist bereits token-förmig — genau die Übergabe, die LFH-352 Schritt 7 verlangt.
