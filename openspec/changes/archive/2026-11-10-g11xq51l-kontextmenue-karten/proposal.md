## Why

Seit LLH-1596 öffnen Zeilen und Karten der `Datensicht` per Rechtsklick, langem Druck und Tastatur
ein Kontextmenü mit ihren Aktionen. Die Karten, die ihre Knöpfe selbst zeichnen (Meldung,
Nachforderung, Auftrag, Ablösung, Verpflegung) und die Nachrichten im Chat zeigen dort weiter das
Browsermenü. Wer am Fükw-Rechner auf einer Meldung rechtsklickt, bekommt „Seite neu laden“ statt
„Bestätigen“. Diese Change bindet diese Stellen an den Baustein an (LLH-1598, Stufe 2 von
LLH-1590).

Zunder: https://zunder.rubeen.dev/#/aufgabe/g11xq51lcroleeh4soclf9w7 (LLH-1598, Eltern LLH-1590)

## What Changes

- **Kontextmenü einer Karte mit mehreren Knöpfen:** Es zeigt alle Knöpfe der Aktionszeile, die
  etwas tun, in ihrer Reihenfolge, danach die Einträge des ⋮-Menüs. Unumkehrbares steht rot hinter
  einem Trenner. Ein Knopf, der vorher nachfragt, fragt aus dem Menü im Dialog mit demselben Titel
  nach. Gesperrte Knöpfe stehen gesperrt mit ihrem Grund im Menü. Sprünge („Ausgabe öffnen“) und
  Auswahlfelder („Bearbeiter zuweisen“) kommen nicht hinein (abgestimmt mit Ruben am 09.11.2026).
- **Eine Quelle:** Jede Karte beschreibt ihre Aktionen einmal als Daten. Knopfzeile, ⋮-Menü und
  Kontextmenü entstehen daraus. Ob die Karte unter drei Aktionen Knöpfe zeigt oder ab drei bündelt,
  ändert am Kontextmenü nichts.
- **Angebunden:** Chat-Nachrichten (`chat/NachrichtenStrom.tsx`), Meldungskarte,
  Nachforderungskarte, Auftragskarte (`AuftragKarte` mit `AuftragHandlungen`), Ablösungskarte,
  Verpflegungsstellen und Zeitfensterkarte. Die Tabellen der Betreuungsstellen und
  Evakuierungsbezirke bekommen das Menü über die `Datensicht`: ihre Primäraktion („Belegung
  melden“, „Stand melden“) und ihr ⋮ wandern in den Kartenplan, die Spalte „Aktionen“ speist sich
  daraus.
- **Anhang im Chat:** Ein Anhang ist ein Download-Link; dort bleibt das Browsermenü („Link
  speichern unter“), wie auf jedem Link.
- **Baustein:** `useKontextMenue` teilt seine Fensterhörer und Riegel über alle Instanzen, statt
  sie je Instanz neu anzulegen. Seine Schnittstelle bleibt. Neu dazu kommt ein kleiner
  Kartenbaustein, der Hook und `KontextMenue` für einen einzelnen Datensatz zusammenfasst.
- **Bewusst ohne Kontextmenü:** der Ausgabe-Zählschirm der Verpflegung (`AusgabeAnsicht`). Sein ⋮
  ist die Auswahl „Weitere Kostform“, kein Menü eines Datensatzes, und ein langer Druck auf eine
  Zähltaste darf kein Menü öffnen. Ebenso die Detailansicht eines Auftrags (Detailköpfe, wie in
  LLH-1590 entschieden) und die Auswahlliste der Aufträge (`AuftragListenKarte`, ohne Aktionen).
- **Nicht in dieser Change:** ETB-Zeitachse und Meta-Chips (LLH-1597), Tabellen außerhalb der
  `Datensicht` (LLH-1599), Schichtplan-Raster (LLH-1600), Gliederung (LLH-1601).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `datensatz-aktionsmenue`: Das Kontextmenü einer Karte mit mehreren Knöpfen zeigt alle
  handelnden Knöpfe vor den ⋮-Einträgen, ohne Sprünge und Auswahlfelder. Ein Zählschirm hat
  bewusst kein Kontextmenü.

## Impact

- Frontend:
  - geändert: `components/useKontextMenue.ts` (geteilte Hörer), `components/Liste.tsx`
    (`ListenEintrag` nimmt die Handler an);
  - neu: Kartenbaustein in `components/` (Hook + Menü eines einzelnen Datensatzes) und die
    Abbildung von Kartenaktionen auf Menüeinträge mit Rückfrage;
  - angebunden: `chat/NachrichtenStrom.tsx`, `meldungen/MeldungKarte.tsx`,
    `nachforderungen/NachforderungKarte.tsx`, `auftraege/AuftragTeile.tsx` und
    `auftraege/AuftragKarte.tsx`, `abloesung/AbloesungKarte.tsx`, `verpflegung/StellenListe.tsx`,
    `verpflegung/ZeitfensterKarte.tsx`, `betreuung/StellenBlock.tsx`, `betreuung/BezirkTabelle.tsx`.
- Regeln: `frontend/AGENTS.md`, Regel „Kontextmenü nur über den Baustein“ (Karten, Zählschirm).
- Doku: Anwenderkapitel, die Rechtsklick an Listen beschreiben (`docs/anwender/`), soweit sie
  Karten nennen.
- Kein Backend, keine Migration, kein Vertrag.
