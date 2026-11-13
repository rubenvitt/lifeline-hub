# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/kwc2yszvim6kg7tt610eppe8 (LLH-1841)

## Why

Ein ETB-Eintrag ist schnell geschrieben, solange er nur aus Text besteht. Für die eigentliche
Arbeit des ETB-Führers trägt das Einsatztagebuch aber nicht: Zeit, Absender und Empfänger, die einen
Eintrag ausmachen, sind die am schwersten zu setzenden und die am schlechtesten lesbaren Angaben
(UI/UX-Analyse vom 12.11.2026, LLH-1714). Am Fükw stehen 8 Einträge im Bild, Von → An in 10 px
grauer Mono-Schrift, drei Viertel des Bestands sind Systemeinträge, und eine nachgetragene Zeit
ging bis LLH-1842 still verloren. Den Umbau hat Ruben am 12.11.2026 als Entwurf freigegeben
(`docs/design/2026-11-12-etb/`).

## What Changes

- **Schreibzeile in der Reihenfolge des Papier-ETB:** Typ, Zeit, Von, An und Meldeweg stehen als
  feste, beschriftete Felder über dem Inhalt, Tab läuft sie der Reihe nach ab. „+ Feld“ und die
  Chips mit Editor entfallen; „+ Veranlassung“, „+ Anhang“ und „+ weiterer Entwurf“ bleiben als
  Textknöpfe. Der Typ ist eine Auswahl aus vier Segmenten. Die Kurzbefehle (`/typ`, `/zeit`, `@`)
  bleiben als Beschleuniger und füllen dieselben Felder.
- **Vorgabe für Von und An nach Typ:** Meldung An = eigene Stelle, Von leer; Anordnung Von = eigene
  Stelle, An leer; Entscheidung und Lage beide = eigene Stelle. Die eigene Stelle ist der
  bestehende Standard-Rufname.
- **Abweichende Ereigniszeit bleibt sichtbar:** Feld in Achtungsfarbe, Hinweis „Nachtrag · Ereignis
  vor n min“, Sendeknopf „Erfassen als 1912“.
- **„Auch in den Meldungseingang“** ersetzt „Nur protokollieren“: positiv benannt, bei Meldung und
  Lage sichtbar, Vorgabe an, aber aus, wenn Von und An die eigene Stelle sind.
- **Enter im Inhalt sendet immer nach dem Tastaturvertrag**, weil kein Feld-Editor mehr offen steht
  (LLH-1865 entfällt).
- **Vorschlagsfelder:** Enter und Tab übernehmen den obersten passenden Vorschlag; Freitext über
  einen eigenen Eintrag „… als Freitext übernehmen“ am Ende der Liste (LLH-1753, Teil Von/An).
- **Leseansicht mit Spalten** ab Breite `lg` in kompakter Dichte: Zeit · Nr. · Typ · Von → An ·
  Inhalt · Vermerk · ⋮. Von → An in Textschrift, nichts unter 12 px. Verweise und Marken („Meldung
  #5 ↗“, „Nachtrag · erfasst 1926“, „berichtigt durch Nr. 231“, „SOFORT“) stehen in der Spalte
  Vermerk statt in einer eigenen Zeile. Entscheidung und Lage mit Von = An zeigen „Vermerk EL“.
  Lange Einträge stehen einzeilig mit „mehr“. Ziel: 14 einzeilige Einträge je Schirm am Fükw.
- **Handschirm:** je Eintrag eine Kopfzeile (Zeit, Typ, Von → An) und der Text in voller Breite;
  die Schreibzeile ist eingeklappt eine Zeile (Typ, Inhalt).
- **Systemeinträge sind in der Vorgabe ausgeblendet**; der Umschalter „System n“ bleibt, der
  Seitenkopf nennt beide Zahlen.
- **Das Paneel „Bilanz“ entfällt:** Die Zahl je Typ steht am Typ-Segment der Filterleiste, der
  Sendestatus („alles übertragen“, „n ausstehend“) im Seitenkopf.
- **Filterleiste und Spaltenkopf kleben** unter dem Seitenkopf; ein gesetzter Filter ist an der
  Arbeitsposition sichtbar und löschbar.
- **Entwurfsreiter erst ab dem zweiten Entwurf**, „Vorschau“ nur bei Formatierung im Text.
- Nicht Teil: Druck des ETB (LLH-1837), Banner für eigene Einträge anderer Geräte (LLH-1833), der
  feste Rahmen der App (LLH-1727), die Empfängerauswahl im Dialog „Auftrag erteilen“ (Rest von
  LLH-1753), eine eigene Regel für unlesbare Zeiten (LLH-1866). Server und Wire bleiben unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `etb-schnellerfassung-tastatur`: feste Felder statt Chips, Typ als Segmentauswahl, sichtbare
  Ereigniszeit am Sendeknopf, Enter sendet ohne Ausnahme für offene Editoren, „Auch in den
  Meldungseingang“ statt „Nur protokollieren“, Platz der Einstellungen.
- `etb-absender-empfaenger`: Vorgabe für Von und An nach Typ; Von und An als feste Felder; Enter im
  Vorschlagsfeld nimmt den Vorschlag.
- `stammdaten-feld`: Enter und Tab übernehmen den obersten passenden Vorschlag, Freitext über einen
  eigenen Listeneintrag.
- `etb-zeitachse-darstellung`: Spaltenzeile in kompakter Dichte, Vermerkspalte, „Vermerk EL“,
  eingeklappte lange Einträge, Handschirm-Zeile, Systemeinträge in der Vorgabe aus.
- `etb-filterleiste`: Filterleiste und Spaltenkopf kleben unter dem Seitenkopf, Zahl je Typ am
  Segment.
- `etb-zaehler`: Bilanz-Leiste entfällt; Kopf nennt Einträge und ausgeblendete Systemeinträge.
- `bedien-wortlaut`: das Szenario „Bilanz des ETB“ nennt das Typ-Segment statt der Bilanz.
- `datensatz-aktionsmenue`: die Chips der ETB-Erfassung entfallen und mit ihnen ihr Kontextmenü.
- `ereigniszeit-vorgabe`: „Zeit-Chip“ wird das Feld Zeit; es zeigt „jetzt“ nach der Serveruhr.
- `zeiteingabe`: die Ereigniszeit der ETB-Erfassung steht im Feld Zeit statt im Chip.

## Impact

- Frontend: `frontend/src/etb/Schnellerfassung.tsx`, `MetaChip.tsx` (entfällt in der Erfassung),
  `RufnameAbfrage.tsx`, `standardRufname.ts`, `EtbZeitachse.tsx`, `EtbFilterleiste.tsx`,
  `EtbBilanz.tsx` (entfällt), `entwuerfe/EtbEntwurfsTabs.tsx`, `pages/EtbPage.tsx`,
  `components/StammdatenFeld.tsx` (auch `meldungen/MeldungFormular.tsx` nutzt es),
  `components/instrument/Schnellerfassungszeile.tsx`.
- Gemeinsame Bausteine bleiben: `Zeitachseneintrag` (elf weitere Nutzer) wird nicht umgebaut; die
  Spaltenzeile entsteht im ETB.
- Regeln: `frontend/src/etb/AGENTS.md` (Erfassung, Bilanz, ≥ 50 % Meldungstext, kompakte Zeile).
- e2e: `etb-zeilenhoehe`, `etb-chronologie`, `etb-filterleiste`, `etb-standard-rufname`,
  `etb-meldungseingang`, `etb-entwurf-tabs`, `leisten-flaeche`, `fokus-verdeckung`,
  `kontextmenue-etb`, `zeiteingabe-tippen`.
- Anwenderdoku: `docs/anwender/kapitel/einsatztagebuch.md` samt Bildern.
- Kein Backend, keine Migration, kein Wire-Feld.
