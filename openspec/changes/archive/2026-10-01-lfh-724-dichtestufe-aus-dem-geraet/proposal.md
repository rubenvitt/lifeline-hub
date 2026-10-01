# Proposal

## Why

Sechs Modul-Prüflisten (LFH-342 · C7, LFH-343 · C8, LFH-345 · C10, LFH-346 · C11,
LFH-347 · C12, LFH-348 · C13) führen Zeile 2 („Handschuh-Modus“) auf „teilweise erfüllt“. Zwei
Dinge fehlen ihnen: eine festgelegte **Ableitung der Dichtestufe aus dem Einsatzkontext**, die
die Bedien-Leitlinie ausdrücklich offenließ („Was diese Leitlinie nicht entscheidet“), und die
**gerenderte 72-px-Messung an ihren eigenen Flächen**. Bis 25.09.2026 hingen beide an LFH-373,
einem Messauftrag für andere Flächen. Die Ableitung ist eine Funktion und braucht eine
nachlesbare Entscheidung.

Entscheidung vom 01.10.2026 (Mensch, Phase-1-Checkpoint): **Der Einsatzkontext ist das Gerät,
nicht die Person.** Die Leitlinie schneidet ihre vier Kontexte nach Gerät, Hand und Haltung
(Festlegung 1). Die Spec `bedien-arbeitsplatz` verbietet bereits, dass Arbeitsplatz oder
Funktion die Dichte vorbelegen. Eine S-Funktion sagt nichts darüber, ob jemand am Fükw sitzt
oder mit Handschuh am Tablet steht.

## What Changes

- **Die Regel wird festgeschrieben, nicht neu gebaut.** Die Stufe beim Sitzungsstart folgt
  genau einer Reihenfolge: gespeicherte Wahl des Geräts → Zeigerart (grob → `komfortabel`) →
  `kompakt`. Ein unbekannter gespeicherter Wert gilt als „keine Wahl“. `handschuh` entsteht nur
  durch ausdrückliche Wahl. Die Zeigerart wird einmal beim Sitzungsstart gelesen. Ändert sie
  sich während der Sitzung, bleibt die Stufe stehen. Rolle im Einsatz, Funktion (S1–S7, EL),
  Führungsstelle und Arbeitsplatz fließen nie ein. So verhält sich `theme/ThemeModeProvider.tsx`
  schon heute (LFH-361). Neu ist, dass eine Spec das festhält und ein Test jede Hälfte rot
  machen kann.
- **Beleg im Browser:** Ein e2e-Beleg zeigt die Ableitung mit echtem `(pointer: coarse)`.
  Bisher gibt es dafür nur Vitest mit gemocktem `matchMedia`. Die Gegenprobe zeigt, dass eine
  gespeicherte Wahl `kompakt` auf einem Touchgerät stehen bleibt.
- **72-px-Messung an den Flächen der sechs Prüflisten**, die heute keine Messung in
  `handschuh` haben. Jede Messung bekommt eine `kompakt`-Gegenprobe, die rot werden kann.
- **Prüflisten:** Zeile 2 der sechs Prüflisten erhält ein Verdikt aus Messung (Nachtrag
  LFH-724, Muster „Nachtrag LFH-373“). Der Abgleich
  `grep -rn "Einsatzkontext" docs/superpowers/specs` zeigt für die Stufenableitung keinen
  Verweis mehr auf LFH-373.
- **Projektregel:** `frontend/AGENTS.md` nennt die Ableitung und ihren Träger in einem Absatz.

## Capabilities

### New Capabilities
- `bedien-dichte`: Woraus die Bediendichte beim Sitzungsstart folgt, welche Quelle Vorrang hat
  und welche Quellen ausdrücklich nicht einfließen (Gegenstück zu `bedien-helligkeit`).

### Modified Capabilities
- `einsatztauglichkeit-layout`: Die Requirement „Trefffläche folgt der Dichtestufe“ nennt
  zusätzlich die Bedienziele der sechs Prüflisten-Flächen, die LFH-724 misst.

## Impact

- **Frontend:** `theme/ThemeModeProvider.tsx` (nur Kommentare und eine benannte reine
  Funktion, kein neues Verhalten), `theme/ThemeModeProvider.test.tsx`, neue bzw. erweiterte
  e2e-Specs unter `frontend/e2e/`.
- **Doku:** sechs Prüflisten unter `docs/superpowers/specs/` (Nachtrag je Datei),
  `frontend/AGENTS.md`. Die Bedien-Leitlinie bleibt als eingefrorenes Archiv unverändert. Ihr
  offener Punkt ist durch die neue Spec `bedien-dichte` beantwortet.
- **Kein Backend, keine Migration, keine neue Abhängigkeit, kein neuer Speicherschlüssel.**
