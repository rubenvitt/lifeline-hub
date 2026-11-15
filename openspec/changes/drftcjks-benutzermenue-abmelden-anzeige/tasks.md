# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/drftcjksxrh0vazqkadyuegy (LLH-1730)

## 1. Rückfrage zum Abmelden (D2, D3)

- [x] 1.1 Test zuerst: Hook/Komponente der Rückfrage (`auth/`): `fragAbmelden()` öffnet „Abmelden?“ mit „Abbrechen“ (Anfangsfokus) und rotem „Abmelden“; Bestätigen ruft `logout()` und navigiert bei `true` nach `/login`, bei `false` (412) bleibt die Route; „Abbrechen“ und Escape ändern nichts (Vitest rot, dann grün)
- [x] 1.2 Rückfrage umsetzen (antd `Modal`, Ladezustand während `logout()`), Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“; Tests aus 1.1 grün

## 2. Benutzermenü (D1)

- [x] 2.1 `components/BenutzerMenu.test.tsx` anpassen und erweitern: Reihenfolge Kopf, „Profil“, „Anzeige“, „Benachrichtigungen“, „Neuigkeiten“, „Hilfe“, „Abmelden“; Abmelden folgt nicht auf Profil, auch in `handschuh`; Klick auf „Abmelden“ öffnet die Rückfrage statt abzumelden; Bestätigen meldet ab (rot, dann grün)
- [x] 2.2 `components/BenutzerMenu.tsx` umbauen: Abmelden ans Ende hinter Trenner, halbe Zeile aus D11 entfernen, Rückfrage einhängen; Kommentare (LFH-952, U89, D11) auf den neuen Stand bringen; `AppLayout.test.tsx` und weitere Unit-Tests mit „Abmelden“ grün

## 3. Sprungpalette

- [x] 3.1 Test zuerst (`command-palette/`): ↵ auf „Abmelden“ schließt die Palette, öffnet die Rückfrage mit Fokus auf „Abbrechen“ und beendet die Sitzung nicht; Bestätigen meldet ab; `nav:abmelden` bleibt `nichtMerkbar` (rot, dann grün)
- [x] 3.2 Rückfrage im `CommandPaletteProvider` einhängen, `useBefehle` reicht `fragAbmelden` statt `logout` weiter (`command-palette/typen.ts`, `befehle.ts`); Tests aus 3.1 und bestehende Palettentests grün

## 4. Anzeige-Leisten außerhalb des Menüs (D5)

- [x] 4.1 `components/AnzeigeLeisten.tsx`: Überschrift abschaltbar bei erhaltenem zugänglichem Gruppennamen, Höchstbreite für Seiten; Unit-Test: ohne Überschrift heißt die Gruppe weiter „Anzeige“, die Leisten wirken sofort (rot, dann grün)

## 5. Reiter „Anzeige“ in den Einsatz-Einstellungen (D4)

- [x] 5.1 Test zuerst (`pages/EinsatzEinstellungenPage.test.tsx` o. ä.): Reiter „Anzeige“ ist der letzte, „Allgemein“ bleibt erstes Redirect-Ziel; Wahl „Handschuh“ setzt die Dichte; Beobachter im abgeschlossenen Einsatz bedient alle Leisten ohne Rechtehinweis (rot, dann grün)
- [x] 5.2 Sektion `anzeige` in `EINSTELLUNGEN_SEKTIONEN` und `EinstellungenSektion` (`routing/deeplinks.ts`), Route in `App.tsx`, Sektion unter `pages/einstellungen/` mit Paneel „Anzeige auf diesem Gerät“ und Hinweissatz; Rechtehinweis in `pages/EinsatzEinstellungenPage.tsx` für `anzeige` aus; Tests aus 5.1 grün, ebenso Wächter über Sektionen und Routen

## 6. Profil (D6)

- [x] 6.1 Test zuerst (`pages/ProfilPage.test.tsx`): Paneel „Darstellung auf diesem Gerät“ trägt die drei Leisten mit dem aktiven Wert, die Zeitdarstellung bleibt darunter (rot, dann grün)
- [x] 6.2 Leisten in `pages/ProfilPage.tsx` einbauen; Test aus 6.1 grün

## 7. e2e und Bildlauf

- [ ] 7.1 Helfer in `e2e/menue-kern.ts`: Abmelden über das Benutzermenü samt Rückfrage; alle Specs und Bilder-Specs umstellen, die „Abmelden“ im Menü klicken (`benutzermenue`, `rahmen-stehen-bleiben`, `dichte-ableitung`, `lagebild-offline`, `geraet-raeumung`, `doku-bilder/anmelden-abmelden` u. a.; Abschluss per `grep` nach `'Abmelden'` in `frontend/e2e`)
- [ ] 7.2 e2e `benutzermenue.spec.ts`: 390 × 844 `komfortabel` alle Einträge bis „Abmelden“ im Fenster; `handschuh` Profil und drei Leisten ohne Rollen, Abmelden nach Rollen erreichbar, Rückfrage mit Abbrechen und Bestätigen; Palette „Abmelden“ öffnet die Rückfrage; Reiter „Anzeige“ wählt Handschuh (gezielter Lauf grün, chromium)
- [ ] 7.3 Bildlauf: betroffene Bilder des Benutzermenüs neu (`doku-bilder/anmelden-abmelden.bilder.ts`, `einsatz-oberflaeche.bilder.ts`), Bild der Rückfrage und des Reiters „Anzeige“ dort, wo die Kapitel sie zeigen (Lauf grün, Bilder geprüft)

## 8. Anwenderdoku (Mitänderungsregel)

- [x] 8.1 `docs/anwender/kapitel/anmelden-abmelden.md`: Abmelden am Menüende mit Rückfrage, auch aus der Sprungpalette
- [x] 8.2 `docs/anwender/kapitel/einsatz-oberflaeche.md` (Aufzählung des Benutzermenüs, Darstellung: drei Orte), `docs/anwender/kapitel/einsatz-einstellungen.md` (Reiter „Anzeige“), `docs/anwender/kapitel/profil-sicherheit.md` (Paneel „Darstellung auf diesem Gerät“); `quellen:` der Kapitel nachziehen; Doku-Wächter grün

## 9. Abschluss

- [x] 9.1 `grep` nach Kommentaren und Texten mit „Profil und Abmelden“, „direkt unter dem Kopf“, „Abmelden ohne Rollen“ in `frontend/src`, `frontend/e2e`, `docs/` und `.claude/`; Verweise auf die umbenannte Anforderung nachziehen
- [ ] 9.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Ergebnis im PR unter „Geprüft“

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandeln.
- `/opsx:archive drftcjks-benutzermenue-abmelden-anzeige` im selben Branch, dann PR gegen
  `alpha` mit Bildern der Änderung (`pr-bilder/drftcjks/`).
