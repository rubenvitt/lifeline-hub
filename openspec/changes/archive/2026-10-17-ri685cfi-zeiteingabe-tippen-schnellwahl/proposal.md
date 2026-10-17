# Proposal

## Why

Zeiten einzutragen ist in der ganzen Anwendung mühsam (Rubens Feedback LFH-1157/LFH-1162,
erneut am 17.10.2026: „super unusable“). Im Einsatz wird eine Zeit fast immer **diktiert oder
abgeschrieben** („Lage 1430“, „eingetroffen 101425“) oder liegt **kurz vor jetzt**. Der heutige
Baustein (`anzeige/ZeitpunktEingabe.tsx` über antds `DatePicker` mit `showTime`) verlangt dafür
einen Kalender mit zwei Scrollspalten zu je 24 bzw. 60 Zeilen, ein „OK“ je Feld, im Zeitraum sogar
zwei. Getippt wird nur im `format` des Aufrufers (vier verschiedene, keins taktisch), die Woche
beginnt am Sonntag (die dayjs-Sprache `de` ist nicht geladen), und das Panel deckt Prüfhinweise
unter dem Feld zu. Die Entscheidungen zur Schreibweise sind am 17.10.2026 gefallen (LLH-1045:
DTG `101430okt26`, Kurzform taktisch); der Baustein wird deshalb vor dem Formatkern (LLH-1053)
gebaut.

## What Changes

- **Textfeld zuerst:** Jede Zeiteingabe ist ein Mono-Textfeld. Getippt werden taktische
  Kurzformen (`1430`, `101430`, `101430okt26`), deutsche und ISO-Schreibweisen
  (`10.10.26 1430`, `2026-10-10 14:30`) und relative Angaben (`-5`, `-1h`, `+30`, `j`). Enter
  übernimmt, Escape verwirft, Verlassen übernimmt eine lesbare Eingabe.
- **Richtung nach Feldart:** Eine Uhrzeit ohne Tag gilt heute; in einem Feld für Ereignisse
  (Vergangenheit) wird daraus gestern, wenn sie sonst in der Zukunft läge, in einem Feld für
  Fristen morgen, wenn sie sonst vorbei wäre. Das Feld nennt „gestern“/„morgen“ sichtbar.
- **Deutung sichtbar, nichts still korrigiert:** Beim Tippen steht die Deutung am Feld
  (`= 161430okt26`). Eine unlesbare Eingabe wird nicht übernommen; das Feld nennt den Grund in
  wenigen Wörtern und zeigt den Wert, der weiter gilt.
- **Anzeige im Feld als DTG** `101430okt26` (Entscheidung E1), unabhängig vom bisherigen
  `format` des Aufrufers. **BREAKING (intern):** Die Props `format`, `showTime` und die übrigen
  antd-Picker-Props entfallen; alle 35 Aufrufe werden mechanisch nachgezogen.
- **Kalender als Nebenweg:** Ein Knopf am Feld öffnet einen Monatskalender (Woche ab Montag)
  mit einem Uhrzeitfeld und der Schnellwahl, auf schmalen Schirmen und in `handschuh` als
  Blatt am unteren Rand. Keine Scrollspalten, kein „OK“ pro Feld.
- **Eine Schnellwahl-Tabelle** `anzeige/zeitSchnellwahl.ts`: Ereignis „jetzt · −5 min ·
  −15 min“, Frist „+15 min · +30 min · +1 h · +2 h“, nach Serveruhr. Sie löst
  `components/terminSchnellwahl.ts` ab; Wiedervorlage und Lagebesprechung behalten ihre Knöpfe
  mit eigenem Bezug, lesen aber dieselbe Tabelle.
- **Zeitraum:** zwei solche Felder „Beginn“ und „Ende“; ein Ende ohne Tag bezieht sich auf den
  Tag des Beginns (liegt es davor, auf den Folgetag).
- **Regel und Wächter:** `frontend/AGENTS.md` „Zeiteingabe in der Anzeigezone“ wird
  fortgeschrieben (Parser, Feldart, Schnellwahl, kein `format`); der Guard verbietet antds
  `DatePicker`/`TimePicker` überall und den Kalender außerhalb von `anzeige/`.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `zeiteingabe`: neue Anforderungen zur Eingabe als Text (taktische, deutsche, ISO- und
  relative Schreibweisen), zur Richtung nach Feldart, zum Umgang mit unlesbarer Eingabe, zur
  Anzeige im Feld als DTG, zum Kalender als Nebenweg (Woche ab Montag, Uhrzeit ohne
  Scrollspalten), zur Schnellwahl und zum Ende eines Zeitraums ohne Tag. Die bestehenden
  Anforderungen (Anzeigezone, unverändertes Speichern, Zonenhinweis, Jetzt nach Serveruhr)
  gelten unverändert weiter.

## Impact

- **Frontend, Baustein:** `anzeige/ZeitpunktEingabe.tsx` (neu aufgebaut), neu
  `anzeige/zeitParser.ts`, `anzeige/zeitSchnellwahl.ts`, `anzeige/ZeitKalender.tsx` (Nebenweg),
  `anzeige/format.ts` (DTG nach E1 für das Feld), `anzeige/ZeitpunktEingabe.css` (Blatt),
  `anzeige/zeitEingabe.guard.test.ts`; dayjs-Sprache `de` in `main.tsx`.
- **Frontend, Aufrufer (35 in 29 Dateien):** `format`/`showTime` entfallen, Feldart wird
  gesetzt, wo sie aus dem Feld folgt; `components/terminSchnellwahl.ts` entfällt
  (Aufrufer `etb/WiedervorlageModal.tsx`, `lagebesprechung/TerminPaneel.tsx`,
  `lagebesprechung/LagebesprechungModal.tsx`). `components/InlineAngabe.tsx` und
  `etb/MetaChip.tsx` behalten ihren Vertrag (Enter sendet, Escape verwirft, `onOk`).
- **Tests:** 24 Vitest-Dateien und 6 e2e-Specs bedienen heute das antd-Panel („OK“,
  Kalenderzellen, Stundenspalte, Format-Strings); sie stellen auf Tippen bzw. den neuen
  Kalender um.
- **Doku:** Kapitel mit Zeitfeldern unter `docs/anwender/kapitel/` und deren Bilder
  (Mitänderungsregel); Design System „Lifeline Hub“ muss um den Baustein nachgezogen werden.
- **Backend, API, Wire-Format, Migrationen, Typ-Codegen:** unverändert.
- **Folgeaufgaben:** LLH-1077 (Rollout) schrumpft auf Feldart je Feld, e2e und Doku-Bilder, die
  hier nicht schon mitlaufen; LLH-1053 stellt die übrigen Anzeigen auf dieselbe DTG um und
  bringt die Gerätewahl (E3).
