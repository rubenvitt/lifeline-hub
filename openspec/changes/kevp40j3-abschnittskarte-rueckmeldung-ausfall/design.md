# Design

## Context

- `pages/fuehrung/ueberblickDaten.ts` `abschnittZeilen` baut je oberstem Abschnitt eine Zeile aus
  `baueKraeftebild`. Rückmeldung: `letzteImTeilbaum` (jüngste über Abschnitts- und
  Einheitenmeldungen). Status: `einheitenVerteilung` zählt Einheiten nach `status.kategorie`
  (`nicht_verfuegbar` → „Ausfall“).
- `UeberblickPage.tsx` `abschnittGliederung` zeigt Lagezustand (Kante und `StatusTag`), die
  Verteilung „bereit/gebunden/Ausfall“ und die letzte Rückmeldung in `rollen.schwach`. Die Seite
  hat eine Uhr (`useJetzt`).
- Meldebild: `rueckmeldungDerZeile`/`rueckmeldungZustand` je Einheit; Ausfall einer Einheit aus
  ihren eigenen Mitteln (`verteilungAus`) und `materialAusfall` (inkl. Beladung, D14).
- Change `g1u57q0f-meldebild-alarm-etiketten` liefert `RUECKMELDUNG_ROLLE.ueberfaellig = alarm`,
  `rueckmeldungUeberfaelligSeit` und `grundWort`.

## Goals / Non-Goals

**Goals:** Eine schweigende oder ausgefallene Einheit macht ihren Abschnitt im Überblick laut, mit
denselben Zahlen wie das Meldebild.

**Non-Goals:** Lagezustand automatisch ableiten; Alarmzeile über alle Quellen (LLH-1743, Welle 2);
Zählweise der Stärken (LLH-1744, Welle 3).

## Decisions

1. **Daten im Memo, Urteil im Render.** `abschnittZeilen` führt je Zeile `einheitIds` des
   Teilbaums und den summierten Ausfall (`ausfallMittel`, `ausfallMaterial`). Das Urteil über die
   Rückmeldung hängt an der Uhr. Deshalb rechnet eine reine Funktion
   `abschnittRueckmeldung(zeile, je, jetzt)` → `{ ueberfaellig: number; laengsteSeitMin: number | null;
   keine: number } | null` im Render (Muster `rueckmeldungDerZeile`). `null`, solange die
   Rückmeldungen nicht feststehen.
   *Verworfen:* nur die jüngste Rückmeldung beurteilen. Billig, verdeckt aber genau den
   Schadensfall.
2. **Ausfall aus einem gemeinsamen Kern.** Der Ausfall einer Einheit (eigene Mittel
   `nicht_verfuegbar` + `materialAusfall` inkl. Beladung) wird als reine Funktion aus
   `meldebildRaster.ts` gehoben (`kraefte/einheitAusfall.ts`). Meldebild und Überblick rufen ihn.
   Die Summe über die Einheiten des Teilbaums zählt jede Einheit einmal, weil jede nur ihre eigenen
   Mittel zählt (Spec `kraeftebaum`).
   *Verworfen:* Zahl der Problem-Einheiten. Verliert „Ausfall Material“ als eigene Aussage.
   *Verworfen:* die Statuszelle umdefinieren. Dann summiert sich die Verteilung nicht mehr auf die
   Einheitenzahl.
3. **Wortlaut über `grundWort`** aus Change `g1u57q0f-…`, erweitert um die Mehrzahl
   („3 Einh. Rückm. überfällig, längste seit 47 min“, „2 Einh. ohne Rückm.“). Darstellung als
   `StatusChip ton="alarm"` im Kopf der Karte, direkt hinter dem Lagezustand. So steht das Signal
   neben „planmäßig“ und nicht unten in der grauen Zeile.
4. **Lagezustand bleibt** (Entscheidung am Phase-1-Checkpoint). Er ist eine Beurteilung der
   Führung (LFH-608) und schreibt bei Wechsel einen ETB-Eintrag. Eine automatische Eskalation wäre
   eine zweite Lage-Wahrheit ohne Eintrag.
5. **Statuszelle „nicht verfügbar“.** Wort und Rolle der dritten Verteilungszelle: „nicht
   verfügbar“, Rolle bleibt alarm.
6. **Regel** in `frontend/AGENTS.md`, „Eine Heimat je Zahl“: Ausfall einer Einheit nur über den
   gemeinsamen Kern; Rückmeldung eines Abschnitts je Einheit, nie über die jüngste allein.

## Risks / Trade-offs

- [Rechenlast je Uhrtakt] → `abschnittRueckmeldung` läuft über eine Map je Einheit, O(Einheiten);
  bei 30-s-Takt unkritisch.
- [Karte wird höher] → Chips nur bei Befund; Zeile bricht um. CLS-Wächter des Überblicks laufen
  mit.
- [Ohne Abschnitt] → Die Sammelzeile „Ohne Abschnitt“ bekommt dieselbe Beurteilung. Ihre Einheiten
  melden ebenso zurück.
