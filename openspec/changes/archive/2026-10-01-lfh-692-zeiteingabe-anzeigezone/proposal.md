# Proposal

## Why

Zeiten werden in der Zeitzone der Organisation **angezeigt** (`inZone(…, konventionen)`), aber in
der Zeitzone des Browsers **eingegeben** (`dayjs.utc(…).local()`, antds `DatePicker`/`RangePicker`).
Steht der Laptop im Fükw auf UTC und die Organisation auf Europe/Berlin, zeigt die Karte „Mittag
12:00–13:30“, der Bearbeiten-Dialog 10:00–11:30. Wer dort auf 12:00 „korrigiert“, speichert
14:00 Berliner Zeit — still, ohne Fehlermeldung, auch in beweissichernden Unterlagen wie dem ETB
(LFH-692, aufgefallen im Review von LFH-634). Das Muster steckt in allen 23 Eingabestellen, nicht
nur in der Verpflegung.

## What Changes

- **Eine Zone für Anzeige und Eingabe:** Jede Zeiteingabe zeigt die Wanduhrzeit der Anzeigezone
  (dieselben `AnzeigeKonventionen` wie die Anzeige) und liest die gewählte Uhrzeit in dieser Zone.
  Ein Speichern ohne Änderung verschiebt nichts.
- **Zentraler Baustein statt Wandlung je Modul:** zwei Eingabe-Bausteine (Zeitpunkt, Zeitraum)
  in `anzeige/`. Formularwerte bleiben absolute Zeitpunkte; die Wandlung in die Wanduhrzeit
  passiert nur an der Grenze zum Picker. Die verstreuten Helfer `alsOrtszeit`, `wireZuPicker`/
  `pickerZuWire`, die drei `dayjsZuWire`-Kopien und `terminZeitpunkt` fallen weg bzw. delegieren.
- **Zonenhinweis:** Weicht die Browserzone von der Anzeigezone ab, nennt jede Zeiteingabe die
  Zone sichtbar. Ein eigener „Jetzt“-Knopf ersetzt antds browserlokalen.
- **Tagesgrenzen in der Anzeigezone:** „keine Zukunftstage“ (Kräfte-Zeitachse, Betreuung) und
  die Gruppierung „heute/überfällig“ (Aufträge, Erinnerungen) rechnen in der Anzeigezone.
- **Zeit in Texten:** Titelvorschlag des Lageberichts, Stand-Zeit des Bedarfsvorschlags
  (Verpflegung), Uhrzeit im Alarm-Hinweis und im ETB-Metachip in der Anzeigezone.
- **Außerhalb eines Einsatzes:** „Einsatz anlegen“ nutzt die Zeitzone der Organisation, die
  Archivakte die Zone des archivierten Einsatzes (bzw. die der Organisation).
- **Fehler nebenbei:** Ein wiederhergestellter ETB-Entwurf zeigt seine Ereigniszeit nicht mehr in
  UTC.
- **Regel + Guard:** `frontend/AGENTS.md` schreibt fest, dass Zeiteingaben nur über die
  Bausteine laufen; ein Guard-Test macht einen direkten `DatePicker` und `.local()` außerhalb
  von `anzeige/` rot.

## Capabilities

### New Capabilities

- `zeiteingabe`: wie Zeitpunkte und Zeiträume in der Oberfläche eingegeben werden — in welcher
  Zone sie erscheinen und gelesen werden, was „jetzt“ und „heute“ bei der Eingabe bedeuten, wann
  die Zone benannt wird und welche Zone außerhalb eines Einsatzes gilt.

### Modified Capabilities

- `einsatzdaten-bearbeitung`: Anforderung „Zeitpunkte ohne Zonenversatz“ — die Zeilenbearbeitung
  zeigt Alarmzeit und Nächste Lagebesprechung in der Anzeigezone statt in der lokalen Zeit des
  Browsers (die Leseansicht zeigte schon die Anzeigezone; beide widersprachen sich).

## Impact

- **Frontend:** neuer Baustein unter `anzeige/` (Zeitpunkt-/Zeitraum-Eingabe, Wandlungskern,
  Org-Provider für Seiten außerhalb eines Einsatzes). Umgestellt werden alle Picker-Stellen:
  `verpflegung/VerpflegungDialoge.tsx`, `etb/EtbFilterleiste.tsx`, `etb/WiedervorlageModal.tsx`,
  `etb/MetaChip.tsx`, `abloesung/AbloesungDialoge.tsx`, `betreuung/BetreuungDialoge.tsx`,
  `kraefte/KraftZeitachse.tsx`, `personen/LagedatenFelder.tsx`, `meldungen/MeldungFormular.tsx`,
  `erinnerung/ErinnerungFormular.tsx`, `auftraege/AuftragFormular.tsx`,
  `infotelefon/AnrufErfassung.tsx`, `stab/LagebesprechungModal.tsx`,
  `pages/EinsatzdatenPage.tsx`, `pages/EinsaetzePage.tsx`, `pages/PressePage.tsx`,
  `pages/PressemitteilungDetailPage.tsx`, `pages/LageberichtePage.tsx`,
  `pages/LageberichtDetailPage.tsx`, `pages/einstellungen/PegelPrognoseModal.tsx`,
  `aufbewahrung/WiederherstellenDialog.tsx`, `aufbewahrung/FristPaneel.tsx`; dazu
  `etb/filterZeit.ts`, `stab/lagebesprechungZustand.ts`, `kommunikation/gruppierung.ts`,
  `etb/entwuerfe/entwurfModell.ts`, `verpflegung/useBedarfsvorschlag.ts`,
  `einsatz/AlarmZentrale.tsx` / `einsatz/EinsatzLayout.tsx`, `aufbewahrung/ArchivAktePage.tsx`.
- **Backend, API, Wire-Format:** unverändert (UTC ohne Zonenkennung, Pegel ISO mit `Z`).
- **Regeln:** `frontend/AGENTS.md` (Abschnitt Inline-Bearbeitung nennt bisher
  `wireZuPicker`/`pickerZuWire`).
