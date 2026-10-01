# Proposal

## Why

Die DWD-Fachebene der Lagekarte zeichnet jede Warnung, die der WFS liefert. Sie fragt nicht,
ob die Warnung schon gilt oder längst abgelaufen ist. Ein Stand, der nach einem gescheiterten
Refresh im Cache steht, kommt bis zum Cache-Deckel von 48 h als `ok` an. Am 23.09.2026 enthielt
die Ebene ausschließlich Warnungen, deren Beginn noch in der Zukunft lag, und sah trotzdem so aus
wie eine aktive Lage. Der Inspector färbt die Schwere außerdem mit eigenen antd-Farben, „Gering“
in Blau. Das widerspricht der Regel „Rot bedient nichts, Blau ist Bedienung“ (LFH-662, Befund
aus LFH-633).

Seit dem Ticket hat sich der Bestand bewegt. LFH-591 hat `abgerufen` eingeführt und markiert
einen DWD-Stand nach 30 min als „veraltet“. LFH-595 hat die Emojis im Inspector durch den
Ikonensatz ersetzt. Offen bleiben die Gültigkeit der einzelnen Warnung, eine harte Obergrenze
für alte Warnstände und die Farben der Schwere.

## What Changes

- **Abgelaufene DWD-Warnungen fallen weg.** Bei jeder Auslieferung entfernt der Server
  Warnungen mit `EXPIRES ≤ jetzt`, auch aus einem Stand, der aus dem Cache kommt. Im Cache
  bleiben sie ungefiltert. Die Lagekarte filtert gehaltene Daten im Minutentakt nach derselben
  Regel, weil ihr Poll nur alle fünf Minuten läuft und bei einem Ausfall des eigenen Servers
  ganz aussetzt.
- **Angekündigte DWD-Warnungen sind unterscheidbar.** Ihr Beginn (`ONSET`) liegt in der
  Zukunft. Auf der Karte haben sie eine gestrichelte Kontur und eine schwächere Fläche. Im
  Inspector steht das Wort „angekündigt“ mit dem Beginn als DTG. Beide Kanäle tragen ein Wort
  bzw. eine Form und nicht nur Farbe.
- **Obergrenze für Warnebenen.** Für DWD und NINA liefert der Server einen Cache-Stand, der
  älter als **6 h** ist, nicht mehr aus. Er behandelt ihn wie einen fehlenden Eintrag: einmal
  abrufen, und scheitert das, antwortet er `offline`. Die übrigen Ebenen behalten das
  Stale-Serving bis 48 h. Die Grenze entspricht `OBERGRENZE_WARNUNGEN_S` des Wetter-Moduls
  (LFH-633).
- **Schwere im Inspector aus dem Statusfarb-Vertrag.**
  - DWD nutzt die bestehende Vertragskarte `dwdWarnstufe` mit den amtlichen Bezeichnungen
    („Wetterwarnung“ … „Extremes Unwetter“).
  - NINA bekommt die neue Vertragskarte `capSchwere`: „Extrem“ und „Schwer“ → `alarm`, „Mäßig“
    und „Gering“ → `achtung`.
  - Keine Stufe ist Blau. Die eigenen `SCHWERE`-Farben im Inspector entfallen.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagekarte-fachebenen`: neue Anforderungen zur Gültigkeit von DWD-Warnungen (abgelaufen,
  angekündigt), zur Obergrenze der Warnebenen und zur Schwere-Darstellung im Inspector. Das
  Szenario „Veralteter Stand aus dem Zwischenspeicher“ der Anforderung zum Abrufzeitpunkt nennt
  jetzt ausdrücklich eine Ebene ohne Obergrenze.

## Impact

- **Backend:** `src/karte/quellen.rs`
  - `liefere_mit_swr` bekommt eine optionale Obergrenze. Die Wegwahl wird eine reine Funktion,
    nach dem Vorbild von `autobahn_weg`.
  - `fetch_dwd` filtert bei der Auslieferung.
  - `fetch_nina` bekommt die Obergrenze.

  Keine Migration, keine Änderung am Umschlag oder an den generierten Typen.
- **Frontend:**
  - `pages/lagekarte/dwdGueltigkeit.ts`: neue reine Funktion, die abgelaufene Warnungen
    entfernt und angekündigte markiert.
  - `pages/lagekarte/useFachebenen.ts`: wendet die Funktion mit Minutentakt an.
  - `pages/lagekarte/fachebenenLayer.ts`: Polygonebenen mit gestrichelter Kontur und schwächerer
    Fläche für markierte Features.
  - `pages/lagekarte/FachebenenInspector.tsx`: Schwere über den Vertrag, Zeile „angekündigt“.
  - `theme/statusFarben.ts`: neue Karte `capSchwere`, `ALLE_MAPS` wächst von 29 auf 30.
- **Regeln und Doku:**
  - `frontend/AGENTS.md`: die Kartenzahl in „Ein Status gehört in den Vertrag“.
  - `frontend/src/pages/lagekarte/AGENTS.md`: eine Regelzeile zur Gültigkeit der Warnebenen.
  - `docs/fachebenen-quellen.md`: Offline-Absatz mit Obergrenze, DWD-Zeile.
- **API:** Verhalten ändert sich, die Form nicht. Die DWD-Antwort enthält weniger Features, und
  ein alter Warnstand kommt als `offline`.
