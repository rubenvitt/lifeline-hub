# Proposal

## Why

Auf den Listenseiten eines Einsatzes frisst das Werkzeug die Seite (LLH-1786, Thema 7 der
UI/UX-Analyse vom 12.11.2026). Die erste Datenzeile liegt im Handschuh-Betrieb bei 1180 × 820 auf
der Betroffenenliste bei y = 883, also außerhalb des Fensters, am Handy (390 × 844) auf Betroffene,
Fahrzeuge und Betreuung bei 627–731. Ursache sind gestapelte Werkzeugreihen: bis zu sechs
gleichrangige Kopfknöpfe, die in den Stufen 48 und 72 umbrechen, eine eigene Stärkezeile (auf
Fahrzeuge doppelt, weil der Gruppenzähler der Tabelle dieselben Zahlen wiederholt), Kennzahlenbänder
ohne Klappe und am Handy Ansichtswahl und Filter in eigenen Reihen.

## What Changes

- **Nebenwege nach Breite und Stufe:** Was über `weitere` der `EinsatzSeite` läuft (Drucken, CSV,
  Listenzugriffe, „Versorgt und entlassen“ …), steht in `komfortabel` und `handschuh` auch ab `md`
  hinter dem einen Auslöser „Weitere“. In `kompakt` bleiben es ab `md` eigene Knöpfe, unter `md`
  bleibt das Menü wie bisher.
- **Stärke im Seitenkopf:** Auf Fahrzeuge, Personal und Einheiten steht die Stärke samt
  Fahrzeugverfügbarkeit als Meta neben dem Titel statt als eigene Zeile über der Tabelle. Der
  Gruppenzähler der Fahrzeugtabelle, der dieselbe Aufteilung wiederholt, entfällt.
- **Kennzahlen einklappbar:** Das Statusband des Meldebilds und die Unterbringungs-Kennzahlen der
  Betreuung bekommen einen Klappkopf. Vorgabe offen; der Zustand wird je Seite auf dem Gerät
  gemerkt. Eingeklappt bleibt eine Zeile mit den Zahlen in Kurzform. Die Sichtungszeile der
  Betroffenen bleibt immer offen (Handschirm-Anforderung).
- **Meldebild:** „Drucken“ und „In Lagebericht übernehmen“ wandern aus der Werkzeugzeile in die
  Nebenwege des Seitenkopfs. Die Ausnahme „Kräfteübersicht trägt keinen Nebenweg“ entfällt.
- **Handy:** Ansichtswahl und Filter (Betroffene: Status, „Abgeschlossene zeigen“, Ansicht;
  Fahrzeuge: Ansicht) stehen unter `md` hinter einem Knopf „Filter (n)“ im Seitenkopf, wie im ETB.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: „Der Seitenkopf bündelt Nebenwege unter md“ gilt künftig auch für
  die Stufen 48 und 72 ab `md`; neu kommen die Stärke im Seitenkopf der Kräfteseiten, einklappbare
  Kennzahlenbänder über Listen, Filter und Ansichtswahl hinter einem Knopf am Handschirm und eine
  messbare Obergrenze für die Lage der ersten Datenzeile.

## Impact

- Frontend: `components/EinsatzSeite.tsx` (`NebenwegeImKopf`), `kraefte/Verdichtungszeile.tsx`,
  `components/instrument/Kennzahl.tsx` bzw. ein Klapp-Baustein, `kraefte/Statusband.tsx`,
  `components/Datensicht.tsx` (Gruppenzähler abschaltbar), Seiten `PersonenPage`,
  `KraefteuebersichtPage`, `FahrzeugePage`, `PersonalPage`, `EinheitenPage`, `BetreuungPage`.
- Regeln: `frontend/AGENTS.md` (Nebenwege im Kopf, Seitenkopf), Gerätespeicher-Liste in
  `frontend/src/offline/AGENTS.md` (neuer Schlüssel für die Klappe).
- Tests: Vitest der Seiten und von `EinsatzSeite.weitere`, e2e, die „Drucken“/„CSV“ als Knopf
  klicken (`betroffene-handy`, `meldebild-druck`, `modul-listen-druck`, `druck-fluss`,
  `gate1-ueberlauf`, `trefflaeche-*`, `kraefte-seitenkopf`, `rahmen-cls-dichte`), Bildlauf der
  Anwenderdoku.
- Design System neu erzeugen (Seitenkopf und Kennzahlenband sind vorgestellte Bausteine).
- Kein Backend, keine Migration, keine API.
