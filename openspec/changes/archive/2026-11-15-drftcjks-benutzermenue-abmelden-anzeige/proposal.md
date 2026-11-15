# Proposal

## Why

Die UI/UX-Analyse vom 12.11.2026 (LLH-1714, Thema 1, Aufgabe LLH-1730) hat zwei Mängel am
Benutzermenü gefunden. Erstens steht „Abmelden“ direkt unter „Profil“, und ein Klick führt ohne
Rückfrage sofort zu `/login`. Ein Fehlgriff im Einsatz beendet so die Sitzung. Zweitens sind
Darstellung (Hell/Dunkel), Bediendichte (mit Handschuh) und Helligkeit nur hinter den Initialen
oben rechts erreichbar. Wer sie in den Einstellungen sucht, findet sie dort nicht.

## What Changes

- „Abmelden“ rückt im Benutzermenü ans Ende, hinter „Hilfe“. „Profil“ bleibt direkt unter dem
  Kopf. Im Handschuh-Betrieb stehen „Profil“ und „Abmelden“ nicht mehr nebeneinander.
- „Abmelden“ fragt zurück, bevor die Sitzung endet: im Benutzermenü und in der Sprungpalette mit
  derselben Rückfrage.
- **BREAKING (Spec):** Die Zusage „Abmelden am Handy in jeder Dichte ohne Scrollen sichtbar“
  (`einsatztauglichkeit-layout`, LFH-952) entfällt. Im Handschuh-Betrieb am Handy rollt das Menü
  bis „Abmelden“.
- Die Einsatz-Einstellungen (Rail „Einst.“) bekommen einen Reiter „Anzeige“ mit Darstellung,
  Bediendichte und Helligkeit. Er gilt nur für dieses Gerät, ist ohne Rechtesperre bedienbar und
  bleibt es auch im abgeschlossenen Einsatz.
- Das Profil trägt dieselben drei Leisten im Paneel „Darstellung auf diesem Gerät“. So gibt es
  den Weg auch außerhalb eines Einsatzes.
- Die Kopfleiste ändert sich nicht.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `benutzermenue`: Reihenfolge der Einträge (Abmelden am Ende), Rückfrage beim Abmelden, Platz
  am Handy ohne die Zeile „Profil | Abmelden“, weitere Orte der drei Leisten (Reiter „Anzeige“,
  Profil).
- `einsatztauglichkeit-layout`: Die Anforderung „Benutzermenü: Abmelden ohne Rollen“ wird auf die
  Einsatzfunktion im Menükopf zurückgeschnitten; die Lage von „Abmelden“ regelt künftig nur noch
  `benutzermenue`.
- `bedien-dichte`: „Handschuh nur auf ausdrückliche Wahl“ zählt die neuen Wahlorte (Reiter
  „Anzeige“, Profil) mit auf.
- `sprungpalette`: Der Befehl „Abmelden“ führt über dieselbe Rückfrage.

## Impact

- Frontend: `components/BenutzerMenu.tsx`, `components/AnzeigeLeisten.tsx` (auch außerhalb des
  Menüs nutzbar), neue gemeinsame Rückfrage zum Abmelden (`auth/`), `command-palette/useBefehle.ts`,
  `routing/deeplinks.ts` (`EINSTELLUNGEN_SEKTIONEN`), `App.tsx` (Route), neue Sektion unter
  `pages/einstellungen/`, `pages/EinsatzEinstellungenPage.tsx` (Rechtehinweis),
  `pages/ProfilPage.tsx`.
- Tests: Unit-Tests des Menüs, der Palette und der Einstellungsseite; e2e-Specs und Helfer, die
  „Abmelden“ im Menü anklicken (Rückfrage bestätigen).
- Doku: Anwenderkapitel zu Anmelden/Abmelden, Bediendichte/Darstellung und Einsatz-Einstellungen.
- Backend, API und gespeicherte Schlüssel bleiben unverändert.
- Berührt Kopf und Menü des Rahmens, an dem LLH-1726 und LLH-1728 parallel arbeiten; der Kopf
  selbst bleibt hier unangetastet.
