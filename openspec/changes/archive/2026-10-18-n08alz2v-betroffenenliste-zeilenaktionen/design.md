# Design

## Context

- **Spalten:** `personen/personenSpalten.tsx` beschreibt die Spalten der Liste, auch am Gerät
  (`GeraetBetroffenePage`, `GeraetPatientenPage`). Schreibbar ist nur „Zustand“
  (`ZustandSchreiben`/`ZustandZelle`). Sichtung, Status, Verbleib und Fundort sind reine
  Anzeige. Eine Aktionsspalte gibt es nicht, nur „Abgleich vorschlagen“ für Vermisste.
- **Liste:** `pages/PersonenPage.tsx` zeigt die Liste über `Datensicht`. Der Zeilenklick öffnet
  das Detail, Zeilenfehler gehen über `zeilenFehler`, und der Zufluss hält die Liste per Schleuse
  (`datensicht-zufluss`, LFH-1020). Portal-Menüs gelten nicht als Verlassen (`pruefeVerlassen`).
- **Muster:** Den Statuswechsel aus der Statusanzeige gibt es schon (`components/StatusWahl.tsx`,
  `frontend/AGENTS.md`), ebenso das Zeilenmenü (`MenueAusloeser`, ab drei Aktionen, LFH-616).
- **Wort:** „Fundort“ steht an 9 sichtbaren Stellen bei Personen, „Antreffort“ an 5 bei Personen
  und 4 bei Tieren.

## Goals / Non-Goals

**Goals:** Sichten, Verbleib und Verorten aus der Zeile; Lücken in der Zelle schließen; ein Wort.

**Non-Goals:**
- sortier- und filterbare Tabellen (Querschnitt LLH-1022)
- Tabellenbreite bei 1440 px (LFH-1149); die neue Spalte hält die Fließspalten-Regel (LFH-523)
- „Zustand / Verdacht“ (kommt in `y18v58dt-patientenkopf-bezuege`)

## Decisions

1. **Sichtungszelle als Auslöser.** Mit Schreibrecht wird `SkTag` zum Knopf. Er hat einen
   zugänglichen Namen („Sichtung R-007 ändern“) und eine Trefferfläche in Steuerhöhe. Ein Tipp
   öffnet ein antd-`Popover` (Portal) mit `SichtungsWahl` und „Übernehmen“. `onClick` stoppt die
   Weitergabe, sodass kein Zeilenklick folgt. Am UHS-Gerät gilt dasselbe, weil das Gerät Sichtung
   schreiben darf.
   - Verworfen: ein Dialog. Er kostet einen Tipp mehr und verdeckt die Liste.
2. **Verbleib.** In der leeren Verbleib-Zelle einer angetroffenen Person steht der Knopf
   „Verbleib erfassen“. Er öffnet den bestehenden Dialog `VerbleibErfassung`. Ein Paneel geht in
   einer Tabelle nicht, und der Dialog hat schon Fehler am Ort.
3. **Zeilenmenü.** Eine schmale Aktionsspalte am Ende mit `MenueAusloeser` und den Einträgen
   „Sichten“, „Verbleib erfassen“ und „Auf Lagekarte verorten“. Verorten steht nur mit Modul
   Lagekarte und nicht am Gerät, und zwar per `lagekartePfad(…, { platzieren, zurueck: true })`.
   Unter `md` (Kartenform der `Datensicht`) steht das Menü im Kartenfuß.
4. **Schleuse.** Das Popover und das Menü melden „offen“ an die `Datensicht`-Schleuse
   (`haltGrund`). Gibt es dafür noch keinen Eingang, kommt ein Prop `halten` dazu. Der Zufluss wartet
   wie bei Fokus.
5. **Zeilenfehler.** Die Fehler von Sichtung und Verbleib aus der Zeile laufen über
   `useZeilenFehler` je Personen-ID in `zeilenFehler`, neben den Abgleich-Fehlern.
6. **Nur Ansicht.** Ohne Schreibrecht steht der vorhandene Hinweis „Nur Ansicht · Grund“ (M16)
   über der Liste, und die Spalten fallen auf die Anzeige zurück.
7. **Fundort.** Alle UI-Texte zu `antreff_ort` heißen „Fundort“, auch bei Tieren und in den
   Aufbewahrungstexten (`aufbewahrung/kategorieText.ts`). Ein Wort-Test in `personen/` prüft
   Maske, Detail, Liste, Druck und Vorschau. Für Tiere prüft ihn der Seitentest. Die Kommentare im
   Code folgen dem Wort, wo sie die Oberfläche beschreiben.

## Risks / Trade-offs

- [Geteilte Spalten treffen die Geräte] → Die Gerätevarianten laufen über `useGeraetDarf`. Die
  Gerätetests (`GeraetPatientenPage`, `GeraetBetroffenePage`) werden mitgeprüft.
- [Eine weitere Spalte verbreitert die Tabelle] → Die Aktionsspalte hat feste Breite (Steuerhöhe)
  und keine Beschriftung, Fließspalten-Regel LFH-523.
