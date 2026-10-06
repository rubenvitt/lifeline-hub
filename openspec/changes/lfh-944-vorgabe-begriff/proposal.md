# Proposal

## Why

Für einen voreingestellten Wert stehen in der Oberfläche heute drei Wörter nebeneinander:
„Default“ und „Fallback“ in den Org-Einstellungen, „Standard“ in den Einsatz-Einstellungen für
dieselben Felder („Europe/Berlin (Fallback)“ dort, „Europe/Berlin (Standard)“ hier,
„Standard (Org): …“ als Hinweis). Wer vor einer Großlage die Vorgaben einrichtet, kann nicht
sicher sagen, ob ein leeres Feld unbedenklich ist und welcher Wert dann gilt. Der Platzhalter
der Zeitzone widerspricht zudem dem Verhalten: Er nennt „Europe/Berlin“, leer gilt aber die
Gerätezeit (`anzeige/format.ts`, `inZone`).

Ruben hat in der Klärungsrunde zur vierten Welle des Bedienbarkeits-Audits am 06.10.2026
entschieden: **Voreingestellte Werte heißen „Vorgabe“** („Leer = Vorgabe des Systems“). Diese
Change schreibt das als Regel fest und zieht den Bestand nach. Die übrigen Befunde von LFH-944
(Kopfleiste, Zweiter Faktor, Personen-Detail) sind reine Textkorrekturen ohne Regel und laufen
im selben Branch außerhalb dieser Change.

## What Changes

- **Neue Regel:** Ein Wert, der greift, wenn niemand etwas wählt oder einträgt, heißt in jedem
  sichtbaren Text „Vorgabe“. „Default“ und „Fallback“ kommen im sichtbaren Text nicht mehr vor,
  „Standard“ nicht in dieser Bedeutung. Die Regel steht in der neuen Fähigkeit
  `bedien-begriffe` und als Zeile in `frontend/AGENTS.md`.
- **Ein Wortlaut, eine Datei:** Die Bausteine (`(Vorgabe)` am Platzhalter, „Leer = Vorgabe des
  Systems.“, „Vorgabe der Organisation: …“) stehen einmal in `components/vorgabeText.ts`, nach
  dem Muster von `stammdaten/rechteText.ts`.
- **Ebenen bleiben unterscheidbar:** System-Vorgabe (fest im Code), Vorgabe der Organisation
  (Verwaltung), Wert des Einsatzes. Der Einsatz zeigt die Org-Vorgabe als „Vorgabe der
  Organisation: 24 Stunden“ statt „Standard (Org): 24 Stunden“.
- **Platzhalter sagen, was gilt:** Zeitzone leer = „Gerätezeit (Vorgabe)“, Tooltip gleichlautend.
- **Bestand nachziehen:** Anzeige-Konventionen, Einsatz-Vorgaben (heute „Einsatz-Defaults“,
  auch im Verwaltungsmenü), Einsatz-Einstellungen Allgemein und Verhalten, Anmeldeverfahren
  („Anmeldewege“ statt „Login-Wege“), Online-Kartenquellen („Kartengrundlage“ statt
  „Basemap“), Meldungsfrist, Führungsfunktionen, Organisation.
- **Wächter:** Ein Vitest-Guard findet „Default“, „Fallback“ und „Standard“ in sichtbarem Text
  unter `frontend/src` (Kommentare und Bezeichner ausgenommen). Ausnahmen stehen mit Grund in
  einer Liste.
- **Ausnahme Eigennamen:** „Standard-Rufname“ (Spec `etb-absender-empfaenger`,
  `fuehrungsfunktionen`) und „Standardansicht“ der Lagekarte (Spec `betreuung-lagekarte`) sind
  benannte Dinge mit eigener Spec und bleiben samt „Als Standard“ im Ansichtsmenü, bis Ruben
  anders entscheidet.

## Capabilities

### New Capabilities
- `bedien-begriffe`: Feste Begriffe der Oberfläche, die über einzelne Module hinaus gelten;
  zuerst „Vorgabe“ für voreingestellte Werte.

### Modified Capabilities
- `einsatznummer`: Die Requirement „Bedienoberfläche“ nennt die Verwaltungsseite
  „Einsatz-Defaults“; sie heißt künftig „Einsatz-Vorgaben“.

## Impact

- Frontend: `pages/einstellungen/*` (Anzeige, EinsatzDefaults, EinsatzAllgemein,
  EinsatzVerhalten, Anmeldeverfahren, `einsatzEinstellungenForm.ts`), `admin/adminNav.tsx`,
  `karten/*`, `meldungen/MeldungFormular.tsx`, `stammdaten/{Organisation,Fuehrungsfunktionen}Tab.tsx`; neu `components/vorgabeText.ts` und
  `components/vorgabe.guard.test.ts`.
- Tests: Vitest der genannten Seiten; e2e-Anker auf „Einsatz-Defaults“ und „Benötigte Rolle
  (Default)“ (`gate1-ueberlauf`, `fokus-verdeckung`, `verwaltung-vereinheitlicht`).
- Kein Backend, keine Migration, keine API-Änderung. Routen bleiben (`/admin/einstellungen/einsatz`).
