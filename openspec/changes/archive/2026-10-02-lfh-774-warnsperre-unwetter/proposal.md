# Proposal

## Why

Die Warnsperre des Helligkeitsreglers (LFH-397) kennt zwei Merkmale: ein Gefahrengebiet auf
`hoch`/`akut` und eine überfällige Bestätigungspflicht. Eine amtliche Unwetterwarnung am
Einsatzort (DWD schwer/extrem) sperrt bisher nicht. Wer im Fükw nachts dimmt, kann also eine
laufende Unwetterlage mitdimmen. Am Checkpoint von LFH-397 wurde das vertagt, weil das Wetter nur
auf der Modulseite abgefragt wurde. Ein Abruf im Einsatzrahmen wäre ein zusätzlicher Dauerabruf
eines externen Dienstes gewesen.

Diesen Grund gibt es seit LFH-663 nicht mehr. Der Einsatzrahmen fragt das Wetter für den
Modulzähler „Wetter & Pegel“ und den Unwetterhinweis ohnehin alle 5 min ab
(`wetterAbfrage`, Schlüssel `einsatzKeys.wetter`). Die Sperre kann dasselbe Cache-Fach lesen und
braucht keine eigene Anfrage.

## What Changes

- **Drittes Merkmal „aktive Warnung“:** Eine Unwetterwarnung **gilt jetzt** am Einsatzort, und
  ihre Stufe legt der Statusvertrag `dwdWarnstufe` auf die Rolle `alarm` (heute `schwer` und
  `extrem`). Gelesen wird aus dem Vertrag, eine eigene Stufenliste gibt es nicht. Ändert sich
  der Vertrag, zieht die Sperre mit.
- **Nur Warnungen, die jetzt gelten.** Eine angekündigte Warnung (Beginn in der Zukunft) sperrt
  nicht. Läuft eine Warnung ab, endet ihr Beitrag ohne neuen Abruf.
- **Nur ein verwertbarer Stand zählt** (`aktuell`/`veraltet`, wie beim Unwetterzähler). Ein
  DWD-Ausfall (`zustand: ausfall`), ein Einsatz ohne Ort, ein zu alter Stand, ein gescheiterter
  Abruf oder fehlendes Netz tragen nichts bei. Das ist die bestehende Spec-Regel, nach der ein
  Lade- oder Fehlerzustand keine Warnung ist.
- **Nur mit Freigabe des Moduls `wetter-pegel`.** Ist das Modul ausgeblendet oder gesperrt,
  wird das Wetter für die Sperre nicht abgefragt, und ein noch vorhandener Cache zählt nicht.
- **Kein zusätzlicher Abruf:** gleicher Schlüssel und gleiche Abruffunktion wie Modulzähler und
  Modulseite (`api/wetter.ts:wetterAbfrage`).

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `bedien-helligkeit`: Die Anforderung „Aktive Warnung“ bekommt das dritte Merkmal (c), die
  jetzt geltende Unwetterwarnung mit Rolle `alarm` aus einem verwertbaren Stand. Dazu kommen
  Szenarien für „gilt jetzt“, „angekündigt“, „Ausfall“ und „Modul ausgeblendet“.

## Impact

- **Frontend:** `einsatz/aktiveWarnung.ts` (neues Eingabefeld, Kommentar), `einsatz/useAktiveWarnung.ts`
  (Wetterquelle), Tests `einsatz/aktiveWarnung.test.ts` und `einsatz/useAktiveWarnung.test.tsx`.
- **Abruf:** keiner zusätzlich. `useAktiveWarnung` teilt Schlüssel und Abruffunktion mit
  `useModulZaehler` und der Modulseite. TanStack Query fragt je Einsatz einmal ab.
- **Backend, DTOs, Migrationen:** unverändert.
- **Bedienung:** Das Benutzermenü nennt weiter „Warnung aktiv“ und den Boden. Die Quelle nennt
  es nicht, auch heute bei Gefahrengebiet und Bestätigung nicht. Den Unwetterhinweis in der
  AlarmZentrale und den Modulzähler gibt es schon (LFH-663).
