# Design

## Context

Motivation siehe `proposal.md`. Der Unterbau steht: `GET /api/karte/fachebenen/{quelle}`
(`src/routes/karte.rs`) verzweigt je Quelle auf `karte::quellen::fetch_*`, die über
`liefere_mit_swr` einen Cache in der eigenen Cache-DB fahren (frisch → sofort, veraltet →
alten Stand + Hintergrund-Refresh, kalt → einmal blockierend, Fehler → `offline`). Das
Frontend schaltet Ebenen über `FACHEBENEN`/`fachebeneKeys()`, lädt sie in
`useFachebenen` und legt sie über den generischen Pfad `reAnlegenAlles` an — der braucht
für eine neue Ebene **keine** Änderung, er iteriert die aktiven Ebenen. Die
nächstliegende Vorlage ist LFH-77 (`hochwasser`): Punkte, deren Stufe backendseitig als
Wire-Wort normalisiert, frontendseitig über den Statusfarb-Vertrag eingefärbt und über
den Radius zweitkodiert wird.

**Gemessen am 21.09.2026 (BfS-WFS):**

| Befund | Wert |
|---|---|
| Layer `opendata:odlinfo_odl_1h_latest`, `outputFormat=application/json` | HTTP 200, ~890 KB, ~1,1 s |
| Sonden | 1 676, Punkte in EPSG:4326 (`[lon, lat]`), `id` eindeutig |
| Betriebsstatus | 1 584 „in Betrieb" (mit Wert) · 81 „defekt" · 11 „Testbetrieb" (beide **ohne** Wert und ohne Messende) |
| Wertebereich heute | 0,042 – 0,234 µSv/h, Median 0,106; Einheit durchgehend `µSv/h`, `duration` `1h` |
| Messende | 1 496 Sonden aktuelle Stunde, 73 drei Stunden zurück, 8 eine Stunde zurück |
| Normalisiert (6 Properties) | ~358 KB roh, ~36 KB gzip |
| Zeitreihen `odlinfo_timeseries_odl_24h` | parametrisierte Sicht: **eine Sonde je Abruf** (`viewparams=kenn:…`, 365 Tageswerte, ~145 KB); ohne Parameter immer Flensburg |
| Nachbar-Layer `odl_brutto_1h`, `odlinfo_sitelist` | Abruf lief über 120 s — nicht verwendet |

Lizenz laut BfS-Nutzungsbedingungen (`imis.bfs.de/geoportal/resources/sitepolicy.html`):
GeoNutzV bzw. Datenlizenz Deutschland – Namensnennung – 2.0, Auflage „sachliche
Darstellung". Keine Abrufbeschränkung dokumentiert.

## Goals / Non-Goals

**Goals:**
- ODL-Ebene nach dem Fachebenen-Muster, ohne neuen Mechanismus.
- Die Bewertung ist ehrlich über ihre Herkunft und nicht allein farbkodiert.

**Non-Goals:**
- Standortbezogener Grundpegel je Sonde (Faktor zur eigenen Historie) — Folgeticket.
- Zeitreihen- oder Verlaufsanzeige je Sonde, Niederschlags-Layer des BfS.
- Einsatzmessungen (Messtrupps, Messfahrzeuge) — die Ebene zeigt nur das ortsfeste Netz.
- Eine eigene Stufe „veraltet" (siehe Entscheidung 6).

## Decisions

### 1. Quelle: der dokumentierte Layer `odlinfo_odl_1h_latest`, ein Abruf je Refresh
Ein einziger WFS-Abruf liefert alle Sonden samt Wert — wie DWD. **Verworfen:** die
Nachbar-Layer (`odl_brutto_1h`, `sitelist`) — undokumentiert auf der BfS-Schnittstellenseite
und im Test über 120 s hängend. Der Abruf nutzt den gemeinsamen `reqwest`-Client mit
seiner 8-s-Schranke (`karte/mod.rs`); ein stehender GeoServer parkt damit den
Hintergrund-Refresh nicht. Ein eigener Timeout wie `KRITIS_TIMEOUT` (30 s) ist nicht
nötig: der gemessene Abruf braucht ~1 s, und KRITIS verlängert die Schranke, statt sie zu
verkürzen.

### 2. TTL 600 s, Frontend-Poll 600 s
Die Quelle hat Stundentakt; eine kürzere TTL (300 s wie DWD) holt 890 KB, ohne frischer zu
werden. Eine Stunde TTL ließe dagegen einen neuen Stundenwert bis zu einer Stunde
liegen — in einer radiologischen Lage zu lang. 600 s begrenzt die Verzögerung auf zehn
Minuten über die Veröffentlichung hinaus bei sechs Abrufen je Stunde.

### 3. Bänder im Backend, Wire-Wörter beidseitig gepinnt
Die Stufe wird in `normalisierung.rs` aus dem Messwert gebildet (`keine_messung` /
`normal` / `erhoeht` / `stark_erhoeht`), nicht im Frontend — dieselbe Arbeitsteilung wie
`hochwasser.klasse`: die Grenze steht an genau einem Ort, und Tests/Clients sehen dasselbe
Wort. Wie bei LFH-77 stehen die Wörter in keinem OpenAPI-Schema (Properties sind
`HashMap<String, Value>`), deshalb Pin in Rust (`odl_tests`) **und** im Frontend
(`fachebenen.test.ts`/`odlStil.test.ts`); der frontendseitige Rückfall für ein unbekanntes
Wort ist `keine_messung` (erfindet keine Bewertung). Die Grenzen sind inklusiv nach unten
(0,2 → `normal`): das BfS nennt den natürlichen Bereich „zwischen 0,05 und 0,2".

**Die Bänder sind eine Projekt-Entscheidung** (Rückfrage an den Menschen) und so benannt:
0,2 ist die vom BfS genannte Obergrenze des natürlichen Bereichs, 0,6 = 3 × 0,2 lehnt
sich an den vom BfS genannten Faktor 3 an — der dort aber **standortbezogen** gemeint ist.
**Verworfen:** eigener Grundpegel aus der Abrufhistorie (mehr Bau, Kaltstart, Median
wandert in einer mehrtägigen Lage mit); reine Messwertanzeige ohne Bewertung (verfehlt das
Akzeptanzkriterium).

### 4. Statusfarben: 17. Vertragskarte `odlStufe` in `theme/statusFarben.ts`
Die Stufe ist eine Statusfarbe und gehört in den A2-Vertrag, nicht in `pages/` —
`statusVertrag.guard.test.ts` verbietet eine `Record<…, StatusDarstellung>` außerhalb der
Datei, und der Abdeckungstest (`statusFarben.test.ts`, heute 16) zählt auf 17 hoch. Das
ist die „eigene Entscheidung" für eine weitere Karte, die CLAUDE.md verlangt: sie ist mit
diesem Design getroffen. Rollen: `keine_messung` neutral, `normal` normal, `erhoeht`
achtung, `stark_erhoeht` alarm. Die Labels tragen die Herkunft mit („über natürlichem
Bereich", nicht „gefährlich").

### 5. Darstellung: eingebackene Farbe + Radius (`odlStil.ts`), Wort im Inspector
Vorlage `hochwasserStil.ts`: `faerbeOdl(fc, token)` schreibt `farbe` (aufgelöster Token,
Hell/Dunkel) und `radius` je Feature; `fachebenenLayer.ts` liest beides bereits per
`coalesce`. Radien 3 / 4 / 7 / 9 — die Lücke zwischen `normal` und `erhoeht` ist
absichtlich groß, damit eine erhöhte Sonde zwischen ~1 600 normalen heraussticht.
`keine_messung` bleibt sichtbar (klein, neutral): eine ausgefallene Sonde ist in einer
CBRN-Lage eine Lücke im Lagebild, die man sehen muss. Der Inspector zeigt Standortname,
Wert (drei Nachkommastellen, deutsches Zahlformat, µSv/h), Messende in Ortszeit,
Betriebsstatus, Stufe als `StatusTag` und den Satz „Einteilung des Lifeline Hub nach dem
vom BfS genannten natürlichen Bereich (0,05–0,2 µSv/h) — kein amtlicher Schwellenwert".

### 6. Kein eigenes „veraltet"
73 Sonden stehen gemessen drei Stunden zurück. Eine Stufe „veraltet" bräuchte eine
Schwelle, die die Quelle nicht vorgibt, und verdeckte den Messwert. Stattdessen steht das
Messende im Inspector; eine Stufe richtet sich allein nach dem Wert.

### 7. Panel und Persistenz
`FACHEBENEN.odl`: Label „Strahlung / ODL (BfS)", eigener Ebenenton `#7cb305` (keiner der
sechs belegten Töne), `pollMs: 600_000`, nicht bbox-abhängig, `geltung` „nur ortsfeste
BfS-Sonden (Stundenwerte) — keine Einsatzmessungen". Reihenfolge in `fachebeneKeys()`
hinter `hochwasser`. `leseFachebenen` bekommt `odl: o.odl === true` als **Aufzählung**
(kein Spread), `defaultFachebenenSichtbar` `odl: false`. Kein bbox, keine Zoomgrenze:
~358 KB normalisiert liegen in der Größenordnung von `hochwasser`, 1 676 Kreise zeichnet
MapLibre ohne Clustering.

## Risks / Trade-offs

- [Regen hebt Werte bis Faktor 3 → Sonden in Gebieten mit hohem Grundpegel werden
  zeitweise „über natürlichem Bereich"; gemessen standen schon heute zwei Sonden über 0,2]
  → Label und Inspector-Satz sagen, was die Stufe bedeutet; Doku nennt den Effekt;
  Grundpegel-Folgeticket.
- [BfS ändert Layer/Feldnamen] → Normalisierung toleriert fehlende Felder, ein
  Formatbruch endet als leere/offline Ebene mit Log, nie als 5xx; Rust-Test pinnt die
  erwarteten Felder.
- [~890 KB je Refresh beim BfS] → sechs Abrufe je Stunde für die ganze Instanz, nicht je
  Nutzer (Cache-DB + Inflight-Sperre).
- [Die 17. Vertragskarte weitet den Vertrag] → bewusst, begründet in Entscheidung 4.

## Migration Plan

Keine Migration: die Sichtbarkeit liegt in bestehenden opaken JSON-Spalten, der Cache in
der bestehenden Cache-DB. Rückbau = Ebene aus `FACHEBENEN` und `match`-Arm entfernen; ein
gespeichertes `odl: true` wird dann ignoriert.
