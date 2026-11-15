# Design

## Context

Die Stufe eines Gefahrengebiets ist das Maximum über alle gesetzten Zellen (`src/gefahr/repo.rs`,
LLH-1090: gesetzte Zellen gelten auch ohne Bestätigung). Ob jemand die Matrix bestätigt hat, sagt
das eigene Feld `beurteilt_at`. Der Wortlaut dafür steht an einer Stelle,
`frontend/src/pages/gefahren/beurteilung.ts` (`NICHT_BEURTEILT`, `beurteilungText`); alle
Abnehmer lesen dort, bis auf den Gebietskopf `GefahrenBeurteilung.tsx`, der „beurteilt“ als
Literal schreibt. Die Gebietsliste zeigt `StatusTag` (Stufe) · Name · Zusatz aus `gebietAussage`.

Anlass und Ziel: proposal.md.

## Goals / Non-Goals

**Goals:**
- Ein Wort für den offenen Zustand („unbestätigt“) und eines für den erledigten („bestätigt“), aus
  einer Quelle.
- In der Gebietsliste stehen Stufe und Vorläufigkeit in einem Etikett.

**Non-Goals:**
- Kein Backend: Feldnamen (`beurteilt_at`, `beurteilt_von_name`), der ETB-Satz „… bestätigt.“ und
  die Kommentare im generierten Typ bleiben (Grenzwerte, `AGENTS.md` „Bezeichner-Sprache“).
- Der Lagezustand eines Abschnitts („nicht beurteilt“, LFH-608) bleibt unberührt.
- Bezeichner wie `istBeurteilt` werden nicht umbenannt; die Konstante bekommt einen neuen Namen
  `UNBESTAETIGT`, weil sie Wortlaut trägt und sonst lügt.

## Decisions

1. **Wort „unbestätigt“.** Es sagt, was fehlt (eine Bestätigung), passt zum Knopf
   „Beurteilung bestätigen“ und ist kurz genug für die 240-px-Gebietsspalte und den Überblick-Kopf
   („1 unbestätigt“).
   Verworfen: „Beurteilung offen“ (bricht in der Gebietsspalte um, „1 Beurteilung offen“ liest sich
   holprig); nur die Gebietsliste ändern (zwei Wörter für einen Zustand).
2. **Gegenstück „bestätigt <DTG> · <Name>“.** Ein Wortpaar statt „beurteilt“/„unbestätigt“, das zwei
   Verben mischt. `beurteilungText` liefert beide; `GefahrenBeurteilung.tsx` nimmt das Wort aus
   `beurteilung.ts` (Konstante `BESTAETIGT`), damit es keine zweite Quelle gibt; die Zeit bleibt
   dort in Mono gesetzt.
3. **Gebietsliste: Zusatz im Etikett.** `GefahrenPage` übergibt `StatusTag` eine Darstellung aus
   `warnstufeKarte[stufe]` mit dem Wortlaut `„<label> · unbestätigt“` (Rolle und Form der Stufe
   bleiben), gebaut von einer reinen Funktion `gebietEtikett(gebiet)` neben `gebietAussage`.
   `gebietAussage` liefert für ein unbestätigtes Gebiet `null` (kein zweiter Zusatz). So steht der
   Widerspruch nicht mehr in zwei Elementen, und Farbe bleibt nie der einzige Kanal.
   Verworfen: gestricheltes Etikett „hoch?“ (neue Darstellungssorte in `statusFarben.ts`, das Wort
   ist ohnehin nötig); Server liefert die Stufe erst nach Bestätigung (verwirft Information,
   widerspricht LLH-1090).
4. **Stufe keine.** Auch „keine · unbestätigt“ trägt den Zusatz; ein offenes Gebiet darf nicht wie
   eine Entwarnung aussehen (LLH-1090).

## Risks / Trade-offs

- [Breiteres Etikett bricht in der 240-px-Spalte um] → `Space wrap` bricht zwischen Etikett und
  Name; „akut · unbestätigt“ ist das längste Wort, Messung im Bildlauf `gefahren`.
- [e2e und Bildlauf suchen „nicht beurteilt“] → alle Fundstellen per `git grep` in derselben
  Aufgabe nachziehen; der Rest-Grep auf „nicht beurteilt“ unter `pages/gefahren`,
  `lage-dashboard`, `fuehrung`, `lageberichte` muss leer sein.
- [Purpose der Hauptspec nennt noch „nicht beurteilt“] → beim Archivieren direkt in
  `openspec/specs/gefahrenmatrix/spec.md` nachziehen (Aufgabe 3.2).
