# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/eon26eatq8w8wfhe44142chu (LLH-1720), Welle 2 mit den
Unteraufgaben LLH-1779 (`l8zlpr35`), LLH-1780 (`yvblv5xx`), LLH-1781 (`cfv89pp5`) und LLH-1782
(`i1f9s2w7`). Thema 6 der UI/UX-Analyse vom 12.11.2026 (LLH-1714). Welle 1 („Farbe“,
`eon26eat-farbe-entlasten`) ist seit 17.11.2026 auf `alpha`.

## Why

Status hat heute fünf bis sechs Formen: `StatusTag` (Fläche mit Rand, 90 Stellen), `StatusChip`
(randlos, 79 Stellen), rohes antd-`Tag` (rund 72 Stellen), farbige Mono-Wörter, Kanten und Balken.
Derselbe FMS-Status ist im Meldebild ein randloser Chip und unter Fahrzeuge ein umrandetes Tag.
Dazu sieht ein nicht bedienbares Etikett („betroffen“, „unterbesetzt“) genauso aus wie der
bedienbare Status. Im Handschuh-Betrieb trifft man 72 px, sieht aber 115 × 22 px.

Nach einem Statuswechsel ändert sich nur das Etikett. Es gibt keinen Hinweis und kein Rückgängig,
und das Menü nennt das Fahrzeug nicht. Am Tablet öffnet es oberhalb des Fensters, im
Handschuh-Betrieb fehlen S9 und S0. Ein Wechsel in der falschen Zeile bleibt unbemerkt.

Das FMS-Tableau ist aus einem Meter nicht lesbar: Der Status steht in 11 px, der Rufname in 13 px,
der Fahrzeugtyp fehlt, und die Fläche bleibt größtenteils leer.

## What Changes

- **Ein Status-Baustein** (`l8zlpr35`): `Status` zeigt jeden Zustand gleich, randlos, getönt, mit
  Formzeichen und Wort, in zwei Größen. Er ersetzt `StatusTag`, `StatusChip` und die farbigen
  Mono-Wörter. Kennzeichnungen ohne Zustand („ad-hoc“, „Einheitsführer“, Typen, Herkunft) werden
  eine neutrale `Marke`. Rohes antd-`Tag` ist außerhalb der beiden Bausteine verboten (ESLint).
- **Rahmen heißt bedienbar** (`yvblv5xx`): Nur was man bedienen kann, trägt einen Rahmen. Der
  bedienbare Status ist ein getönter Knopf mit Rahmen in der Rollenfarbe, Pfeil ▾ und 14-px-Schrift,
  sichtbar so hoch wie seine Trefferfläche (30/48/72 px je Dichte). Entfernbare Filter-Marken
  tragen ebenfalls einen Rahmen. **BREAKING** für Tests und e2e, die `.ant-tag` oder
  `data-lfh="status-chip"` suchen.
- **Statuswechsel mit Quittung** (`cfv89pp5`): Das Statusmenü eines Fahrzeugs nennt den Rufnamen
  als Kopf und liegt immer ganz im Fenster (im Handschuh-Betrieb in zwei oder drei Spalten). Nach jeder Wahl,
  auch per Zifferntaste im Tableau, erscheint „85-1: S2 → S3 · Rückgängig“. Rückgängig ist ein
  echter Rücknahmeweg im Server: Status und „seit“ von vorher, das Zeitachsen-Ereignis gestrichen,
  ein ETB-Eintrag „zurückgenommen“, 409 wenn inzwischen geändert. Zunächst nur Fahrzeug-FMS.
- **FMS-Tableau als Tableau** (`i1f9s2w7`): Je Kachel ein großer getönter Statusblock (Ziffer
  40 px) als Auslöser, Rufname 22 px Mono, Fahrzeugtyp und Einheit, Mindestbreite 240 px.

## Capabilities

### New Capabilities
- `status-darstellung`: Wie ein Zustand angezeigt wird (ein Baustein, zwei Größen, Formzeichen,
  kein Rahmen), wie eine Kennzeichnung ohne Zustand aussieht, und dass ein Rahmen „bedienbar“
  heißt, samt Höhe und Kontrast des bedienbaren Status.
- `fahrzeugstatus-quittung`: Statusmenü eines Fahrzeugs (Kopf, im Fenster), Hinweis nach dem
  Wechsel und Rücknahme im Server.
- `fms-tableau`: Aufbau und Lesbarkeit der Kacheln des FMS-Tableaus.

### Modified Capabilities

Keine. `statusrollen` und `farbrollen-kontrast` gelten unverändert; die Marke bleibt neutral und
hält den Textboden wie bisher.

## Impact

- Frontend: `components/instrument/Status.tsx` (neu `Status`, `Marke`), `components/StatusTag.tsx`
  und `StatusChip` (entfallen), `components/StatusWahl.tsx` (Knopfform, Kopf, Menü im Fenster),
  rund 110 Dateien mit Statusanzeigen, rund 43 Dateien mit rohem `Tag`, `kraefte/FmsTableau.tsx`,
  `pages/FahrzeugePage.tsx`, `pages/einheit/FahrzeugeBesatzung.tsx`, `api/einsatzFahrzeuge.ts`,
  `kommunikation/rueckgaengig.tsx`, `frontend/eslint.config.js`, Wächter in `theme/`.
- Backend: neue Route `POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/status/zuruecknehmen`,
  Antwort des Status-PATCH um einen Rücknahmebeleg erweitert (`src/routes/einsatz_fahrzeug.rs`,
  `src/fahrzeug/disposition_repo.rs`, `src/zeitachse/repo.rs`), Typ-Codegen. Keine Migration.
- Regeln: `frontend/AGENTS.md` (Bausteine, Bausteinwahl, Farbachsen, FMS-Tableau, Rückwege).
- Erzeugt: Design System (neue Karten `Status`, `Marke`, Statusknopf), Anwenderbilder fast aller
  Kapitel, `openapi.json`/`types.generated.ts`.
