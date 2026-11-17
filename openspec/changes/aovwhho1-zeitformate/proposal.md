# Proposal

## Why

Auf den Lageflächen stehen „1731“ neben „17:31“, „5:01 h“ neben „05:01 h“, „7 h 40“ und „301 min“,
„Stand 1731“ neben „Stand vor 0 s“. Der Titel des Lagebilds zeigt die Uhr, wird aber als Stand gelesen,
und er läuft offline weiter („1801“ neben „Stand vor 2 min“). Für Zeitpunkte gibt es schon eine Regel
(`zeitdarstellung`). Uhr, Dauer und Datenstand sind davon bisher ausgenommen, deshalb schreibt jede Stelle
sie anders. LLH-1750, Thema 3 der UI/UX-Analyse vom 12.11.2026, Entscheidungen vom 17.11.2026.

## What Changes

- **Eine Form für Dauern:** „45 min“, „8 h“, „5 h 01 min“. Ab 24 h schreibt eine laufende Dauer die
  Tage aus: „2 d 14 h“. Relative Angaben nehmen dieselbe Form: „vor 5 min“, „seit 1 h 05 min“,
  „in 2 h“, „noch 40 min“. Unter 1 min steht „gerade eben“ bzw. „in < 1 min“. Ein Kern
  `anzeige/dauer.ts` löst sieben Helfer und rund zehn eigene Stellen ab, ein Wächter verhindert neue.
- **Der Server zieht mit:** Der Schichtplan-Export schreibt „13 h 30 min“ statt „13:30 h“. Die
  Rhythmus-Texte im ETB haben die Form schon. Bereits geschriebene Einträge bleiben, wie sie sind.
- **Dauerfelder auf der Seite Ablösung** werden in der neuen Form vorbelegt („7 h 30 min“). Diese
  Form lesen sie auch als Eingabe. Die bisherigen Eingaben „7:30“, „7,5“, „8“ und „90 min“ gelten weiter.
- **Die Uhr im Kopf folgt der Zeitdarstellung:** taktisch „1731“, sonst „17:31“. Sie bleibt Gerätezeit.
  **Hebt E2 für die Uhr auf.** Lagemonitor und Großbild zeigen dieselbe Uhr.
- **Das Lagebild hat keine Uhr mehr neben dem Titel.** Dort steht nur noch der Datenstand.
- **Eine Form für den Datenstand:** überall absolut „Stand 1731“, ohne Netz „Stand 1731 · offline“.
  Auf Lagebild, Großbild und Lagemonitor folgt ab 1 min Alter „· vor 2 min“. „Stand vor 0 s“ gibt es
  nicht mehr. Das Lagebild bekommt die Offline-Marke.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `zeitdarstellung`: Neue Requirements für Dauern, die Uhr im Kopf und den Datenstand. „Eine
  Formatstelle“ umfasst jetzt auch Dauern; die Uhr ist keine Ausnahme mehr.
- `kraefte-zeitachse`: Die Zellen „Im Einsatz“, „Einsatzdauer“ und „Ruhe“ zeigen „7 h 40 min“ statt „7 h 40“.
- `kraefte-abloesung`: Dauerfelder und die Rhythmuszeile zeigen „7 h 30 min“ und „167 h 59 min“
  statt „7:30 h“ und „167:59 h“. Die Felder lesen die neue Form als Eingabe.
- `einsatzbericht`: Die Anlage Einheiten nennt die Einsatzzeit als „6 h 32 min“.
- `modul-benennung`: Neben dem Titel des Lagebilds steht der Datenstand, keine Uhrzeit.
- `grossbild-ansicht`: Das Großbild des Lagebilds zeigt die Uhr in der Form der Kopfuhr.

## Impact

- **Frontend:**
  - neuer Kern `anzeige/dauer.ts` mit Wächter
  - die Helfer und ihre Aufrufer in `einsatz/`, `pages/lage-dashboard/`, `abloesung/`, `kraefte/`,
    `lagebesprechung/`, `pages/uhs/`, `anzeige/abstand.ts`, `etb/`, `lage/wasBrennt.ts`, `geraet/`
  - `components/Kopfleiste.tsx` (Uhr), `components/Datenstand.tsx`, `LageDashboardPage.tsx`,
    `LagebesprechungGrossbild.tsx`, `LagemonitorPage.tsx`
  - die Unit-Tests dieser Stellen und die e2e-Specs, die Uhr oder Stand lesen
- **Backend:** `src/abloesung/schichtplan/ausgabe/plan.rs` (`dauer_text`), Gleichlauf-Test mit
  `src/abloesung/mod.rs` (`rhythmus_text`). Keine Migration, keine Schnittstelle.
- **Anleitungen:** `frontend/AGENTS.md`, „Zeitdarstellung“. Anwenderdoku: Kapitel mit Dauern oder
  Uhr in Text und Bildern.
- **Berührt LLH-1748** (andere Sitzung, Kennzahlenband in `lagebild.ts`): Diese Change ändert nur
  die Form der Einsatzdauer, nicht wo sie steht.
