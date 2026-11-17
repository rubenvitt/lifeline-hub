# Design

## Context

Seit LLH-1743 (Change `t9jjrajy-alarmzeile-was-brennt`, D8) führt der Überblick, und das Lagebild
zeigt die Lage. Die Seite `pages/fuehrung/UeberblickPage.tsx` baut sich in der `DashboardFlaeche`
so auf: Alarmzeile, Startliste (nur mit offenen Punkten), Band „Führungsstand“ mit drei Zellen,
dann zwei `PaneelReihe`n mit je zwei Paneelen: `ueberblick-paneele` (Einsatzabschnitte | Offene
Vorgänge) und `ueberblick-paneele-fristen` (Nächste Marken | Entscheidungen). Beide Reihen warten
gemeinsam auf die Gliederung (`gliederungLaedt`, LLH-1481), Startliste, Band und Reihen beim ersten
Aufbau auf die Quellen der Startliste (`startlisteSchranke`, LLH-1815).

Gemessen auf `alpha` (Übungseinsatz, Bildlauf, Startliste sichtbar): Band 124 px hoch am Fükw und
am Tablet, 154 px am Handy; „Nächste Marken“ beginnt am Fükw bei y = 1309, am Tablet bei 1343, am
Handy bei 2173. Die Zahlen des Bands stehen alle schon im Paneel darunter: „Offene Vorgänge“ liest
Aufträge und Meldungen aus demselben Modulzähler (Spec `ueberblick-offene-vorgaenge`, „Die Zahl
eines Abschnitts ist die des Moduls“), der Kopf von „Einsatzabschnitte“ trägt „4 Abschnitte ·
5 Einheiten“. Abgestimmt am 17.11.2026 (Phase-1-Checkpoint von LLH-1748).

## Goals / Non-Goals

**Goals:**

- Fristen und Überfälliges stehen am Fükw über der Falz und am Handy direkt nach Alarmzeile
  und Startliste.
- Keine Zahl steht im Überblick zweimal.
- Kein neuer Layoutsprung beim Laden (D3).

**Non-Goals:**

- Inhalt, Folge und Zählweise der Paneele und der Alarmzeile.
- Das Band „Lage in Zahlen“ im Lagebild, der Fuß „Einsatzdauer“ des Modulpanels und die
  Schreibweise der Einsatzdauer (LLH-1750).
- Die überholte Formulierung „Kennzahl ‚Warnstufe‘ im Überblick“ in der Spec `gefahrenmatrix`
  (die Warnstufe steht seit Längerem als Hinweis im Seitenkopf). Sie kommt als eigene Aufgabe aufs
  Board, nicht in diese Change.
- Die doppelte Marke „Nächste Lagebesprechung“ im Übungseinsatz: Sie stammt aus den Demo-Daten
  (`src/demo/szenario.rs`, eine Erinnerung und ein Termin zur selben Zeit). Das Produkt legt keine
  solche Erinnerung an.

## Decisions

### D1 Das Band entfällt ersatzlos

Das Band „Führungsstand“ und mit ihm die Kennzahl-Helfer, die nur es liest, fallen weg. Es bleibt
keine Zahl ohne Heimat: Aufträge und Meldungen stehen in „Offene Vorgänge“, die Abschnitte im Kopf
ihres Paneels, Überfälliges in der Alarmzeile.

*Verworfen:* (a) Kürzen auf zwei Zellen (Aufträge, Meldungen). Die Doppelung bliebe, und ein Band
mit zwei Zellen spart wenig Höhe. (b) Ein Fristenband („Überfällig n“, „Nächste Frist“, „Neu n“).
Es wiederholte Alarmzeile und Nächste Marken und bräuchte eine neue Zählung über Quellen, die
heute keine gemeinsame Heimat hat. Beide Wege hat der Mensch am Checkpoint verworfen.

### D2 Reihe 1: Nächste Marken | Offene Vorgänge, Reihe 2: Einsatzabschnitte | Entscheidungen

Die beiden `PaneelReihe`n tauschen ihren linken Platz: „Nächste Marken“ kommt in die erste Reihe
vor „Offene Vorgänge“, „Einsatzabschnitte“ in die zweite vor die Entscheidungen. Unter `lg`
gestapelt gilt damit die Folge Marken, Vorgänge, Abschnitte, Entscheidungen. Die Kennungen der
Reihen werden umbenannt, damit sie den Inhalt beschreiben: `ueberblick-paneele` bleibt die erste,
`ueberblick-paneele-fristen` heißt `ueberblick-paneele-gliederung`. Die `data-lfh`-Anker der
Paneele selbst (`ueberblick-abschnitt`, `ueberblick-marke`, `offene-vorgaenge`) bleiben.

*Verworfen:* drei Paneele in Reihe 1 (Marken | Abschnitte | Vorgänge). Jedes Paneel würde
schmaler, und die Abschnittskarten mit Zahlspalte brechen dann schon am Fükw um.

*Folge:* Die Abschnittskarten rücken am Fükw unter die Falz. Was an ihnen brennt (Rückmeldung
überfällig, Ausfall, Lagezustand kritisch), nennt die Alarmzeile ganz oben.

### D3 Die Reihen warten auch auf die Quellen der Marken

Beide Reihen stehen weiter gemeinsam hinter `gliederungLaedt` und `startlisteSchranke`, dazu seit
der Umsetzung hinter `markenLaedt`: den Listen, aus denen „Nächste Marken“ rechnet (Aufträge,
Erinnerungen, Ablösungen, Programm, Pegel, Wetter). Gezählt wird nur das erste Laden (`isLoading`);
ein gesperrtes Modul fragt nicht an und hält nichts auf.

Ursprünglich sollten die Schranken unverändert bleiben. Der CLS-Test (`ueberblick-vorgaenge-cls`)
zeigte bei 390 px aber 0,12 bis 0,20 (Grenze 0,03): „Nächste Marken“ steht dort als erstes Paneel
und wuchs aus „wird abgerufen“ auf seine Marken, alles darunter rückte nach. Wie viele Marken
kommen, sagt keine Zahl vorher. Entschieden am 17.11.2026 mit dem Menschen.

*Verworfen:* (a) Eine feste Höhe für sechs Marken. Sie ließe am Handy rund 300 px leer, wenn wenig
ansteht. (b) Am Handy die alte Folge mit den Marken unten. Das widerspräche dem Ziel der Change
und dem Szenario „Fristen zuerst am Handy“.

*Folge:* Eine langsame Aufträge- oder Erinnerungsliste hält beim ersten Aufbau alles unter
Alarmzeile und Startliste auf, so wie es die Gliederung seit LLH-1481 schon tut. Die Platzhalter
der offenen Vorgänge (LLH-1430) greifen beim ersten Aufbau nur noch bei Meldungen und
Nachforderungen.

### D4 Beschreibung des Moduls „Überblick“

`modulRegistry.ts` beschreibt den Überblick mit „Fristen, Vorgänge, Entscheidungen“. Der Wortlaut
nennt, was oben steht, und ist nicht länger als der alte (Spec `modul-benennung`, „Lange
Beschreibung im Modulpanel“: vollständig bei 1440 px).

### D5 Der Szenarioname „Kennzahl auf dem Überblick“ bleibt

In `navigation-zuletzt-besucht` ändert sich das Szenario: Es klickt jetzt den Sprung „alle“ des
Abschnitts „Aufträge“ in „Offene Vorgänge“. Der Name bleibt, weil `openspec validate` beim
MODIFIED-Block ein Szenario ohne Namensgleichheit als weggefallen wertet. Das Aufzeichnen geschieht
weiter über die Klickerfassung der Seite, die jedes Modulziel auf dem Überblick merkt. Ein
Unit-Test hält es für diesen Sprung fest.

### D6 Regeln und Doku ziehen mit

`frontend/AGENTS.md` (Kennzahlenband, Dashboard-Baukasten „Reihe 1“, Rollen der Übersichten) sagt
danach: Das Lagebild trägt „Lage in Zahlen“, der Überblick kein Band. Das Design System wird
erzeugt (`pnpm -C frontend design-system`), weil seine READMEs diese Abschnitte tragen, und nach
dem Merge neu veröffentlicht. Das Anwenderkapitel `ueberblick.md` und sein Bild ändern sich nach
der Mitänderungsregel (`docs/anwender/AGENTS.md`), dazu jedes andere Kapitelbild, das den
Überblick zeigt.

## Risks / Trade-offs

- [Gewohnheit: Wer die Zahl oben anklickte, findet sie nicht mehr] → Dieselbe Zahl steht mit
  demselben Sprung im Abschnitt von „Offene Vorgänge“; das Anwenderkapitel beschreibt den Weg.
- [e2e-Specs messen am Band (Notizhöhe, Fugenraster, Kontrast, CLS)] → Die Überblick-Fälle
  entfallen oder messen an „Offene Vorgänge“. Die Fälle des Lagebilds bleiben und tragen die Regel
  „Kennzahlenband hält seine Höhe“ weiter.
- [Offene Vorgänge ist hoch, Reihe 1 wird lang] → Gewollt: Fristen und Vorgänge sind das, was zu
  tun ist. Die Höhe des Paneels ändert diese Change nicht.

## Migration Plan

Nur Frontend, keine gespeicherten Schlüssel. Ein Zurück ist ein Revert des PRs.
