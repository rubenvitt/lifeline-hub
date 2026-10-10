# Proposal

## Why

Im Firefox-Druck des Einsatzberichts kann ein Titel vor einer langen Tabelle (mehr als
`KURZE_TABELLE` = 12 Zeilen: ETB-Entscheidungen, Anlage Einheiten, Anlage Personal) allein oder
nur mit dem Spaltenkopf am Seitenende stehen; die erste Zeile folgt erst auf der nächsten Seite.
LFH-1098 hat das bewusst offen gelassen (Entscheidung 09.10.2026), weil jeder gemessene Weg
entweder eine fast leere Seite oder den wiederholten Tabellenkopf kostete. Firefox 157 setzt
`break-after: avoid` weiterhin nicht um (Minimalprobe aus LFH-813, nachgemessen am 10.10.2026);
Abwarten löst es also nicht.

Eine Probe (Firefox 157, Titel in 31 Lagen über das Seitenende geschoben) zeigt den Ist-Stand:
20 von 31 Lagen schlecht (6 × nur Kopf, 8 × Titel allein, Rest bei Lagen, in denen Firefox den
Titel zufällig mitnimmt). Ein neuer Weg, der „Deckel“, hält Titel, Kopf und erste Zeile in allen
31 Lagen zusammen, wiederholt den Kopf auf jeder Folgeseite und lässt höchstens die Höhe von
Titel, Kopf und erster Zeile frei.

## What Changes

- **Deckel vor langen Tabellen, nur im Firefox-Druck:** Vor einer Tabelle mit Titel und mehr als
  `KURZE_TABELLE` Zeilen steht eine nicht brechende Hülle mit deckendem Grund. Sie trägt die Titel
  und eine Kopie der Tabelle, von der nur Kopf und erste Zeile Höhe haben. Die echte Tabelle folgt
  dahinter, um die Höhe ihres Kopfes hochgezogen: ihr erster Kopf liegt unter dem Deckel, ihre
  erste Zeile hat dort keine Höhe. Auf jeder Folgeseite wiederholt sie ihren Kopf wie bisher.
- **Gleiche Spalten ohne feste Breiten:** Beide Tabellen sehen dieselben Inhalte. Was nicht
  sichtbar sein soll, steht als Maßzeile der Höhe 0 darin; die automatische Spaltenbreite bleibt.
- **Chromium, WebKit und Bildschirm unverändert:** Dort ist der Deckel ausgeblendet und die erste
  Zeile normal; das Blatt bleibt, wie es ist (Chromium hält Titel, Kopf und erste Zeile schon über
  `break-after: avoid` zusammen).
- **Kurze Tabellen unverändert:** bis `KURZE_TABELLE` Zeilen bleibt die Hülle `titelblock-tabelle`
  (LFH-1098), die die ganze Tabelle mitnimmt.
- **Regel fortgeschrieben** in `frontend/src/druck/AGENTS.md` („Abschnittstitel stehen im
  Titelblock“), Messwerkzeug der Verschiebeprobe neben der Change.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einsatzbericht`: neue Anforderung „Titel bleibt bei seiner Tabelle“ — ein Titel vor einer
  Tabelle steht im Ausdruck mit Kopf und erster Zeile auf derselben Seite, ohne fast leere Seite
  davor und mit wiederholtem Kopf.

## Impact

- `frontend/src/druck/einsatzbericht/Bloecke.tsx` (Deckel um lange Tabellen mit Titel),
  `frontend/src/druck/druck.css` (Mechanik unter `@supports (-moz-appearance: none)`),
  `frontend/src/druck/AGENTS.md` (Regel).
- Tests: `Bloecke.test.tsx`, `druck/druck.test.ts`, `e2e/einsatzbericht-druck.spec.ts`
  (Ausrichtung im Firefox-Projekt).
- Kein Backend, keine API, keine Abhängigkeit. Die PDF-Textebene enthält den verdeckten ersten
  Kopf der echten Tabelle ein zweites Mal (unsichtbar auf Papier).
