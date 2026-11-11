# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Pfade ohne Präfix sind relativ zu `frontend/src/`. Vor jedem „fertig“
`superpowers:verification-before-completion`.

## 1. Segmentleiste für das Menü (D3, D4)

- [x] 1.1 `components/instrument/Segmentleiste.tsx`: optionale Eigenschaft für volle Breite (Leiste `flex`, Zellen wachsen gleich, Wort mittig); Test in `Segmentleiste.test.tsx`, ohne die Eigenschaft unverändert
- [x] 1.2 Test: gewählter Wert, der zugleich `gesperrt` ist (Helligkeit 40 % bei Boden 80 %), bleibt ausgewählt und in der Tab-Reihenfolge; Pfeile springen über gesperrte Segmente. Falls rot, in `Segmentleiste` ergänzen

## 2. Benutzermenü (D1, D2, D4)

- [x] 2.1 `components/BenutzerMenu.test.tsx` auf die neue Form: Reihenfolge Kopf, Profil, Abmelden, Gruppe „Anzeige“, Benachrichtigungen, Neuigkeiten, Hilfe; kein „Rückmeldung“, kein „Lizenzen“
- [x] 2.2 Gruppe „Anzeige“ mit drei benannten Leisten (Darstellung, Bediendichte, Helligkeit in %) als Gruppen-Inhalt; `aria-checked` am gewählten Wert; Wahl wirkt sofort, Menü bleibt offen (Test)
- [x] 2.3 Tastatur: Pfeile/Pos1/Ende/Leertaste/Enter in einer Leiste gehen nicht an das Menü (Fokus bleibt in der Leiste, Menü bleibt offen; Test)
- [x] 2.4 Helligkeitssperre: Etikett nennt Boden und Grund, Stufen unter dem Boden gesperrt mit Grund, Zeile „Gewählt W %, wirkt N %“ bei Wahl unter dem Boden (Tests wie bisher in `BenutzerMenu.test.tsx`, umgestellt)
- [x] 2.5 Einträge „Rückmeldung“ und „Lizenzen“ entfernen; „Hilfe“ öffnet die Hilfe mit `state: { von: <Pfad> }` (Test)
- [x] 2.6 Menübreite 320 px ab `md`, am Handy Fensterbreite − 16 px; Maße der Staffel (30/48/72) aus den Tokens, kein fester Pixelwert für Höhen
- [x] 2.8 Handschuh (D11): „Profil“ und „Abmelden“ nebeneinander in einer Zeile, Kopf knapper (Rollen neben dem Namen, Benutzername und Version in einer Zeile); Unit-Test für Lage und Wählbarkeit, e2e `benutzermenue` belegt die Lage im Fenster
- [x] 2.9 Helligkeit im Handschuh (D12): Menü ab `md` im Handschuh 480 px; in voller Breite entfällt die Mindestbreite der Segmente (Zellen teilen gleich, Höhe und Zielabstand bleiben); Unit-Tests, e2e misst Abstand ≥ 16 px und kein Überstand bei 390 × 844 und 1024 × 768
- [x] 2.7 `components/AppLayout.test.tsx`, `einsatz/EinsatzLayout.test.tsx`, `neuigkeiten/Benutzermenue.neuigkeiten.test.tsx`, `theme/rahmenKontrast.test.ts` auf Leisten und Rollen umstellen

## 3. Hilfe-Seite (D5, D6)

- [x] 3.1 `hilfe/HilfePage.test.tsx`: Übersicht trägt „Rückmeldung geben ↗“ und „Lizenzen ↗“; in einer Gerätesitzung fehlt „Rückmeldung geben“, „Lizenzen“ bleibt; mit Kapitel in der Adresse fehlt der Abschnitt
- [x] 3.2 Abschnitt in der Übersicht umsetzen (`hilfe/HilfePage.tsx`, `hilfe/Hilfe.css`), nicht in der Druckwurzel; Rückmeldung öffnet `rueckmeldungsAdresse` mit `von` aus dem Router-State, sonst dem eigenen Pfad, mit `noopener,noreferrer` (Test: Bereich `/einsatz/:id/etb` bei `von` aus dem ETB)

## 4. Eingänge (D7)

- [x] 4.1 `alarm/EingaengeKnopf.tsx`: Link „Benachrichtigungen einstellen →“ am Fuß von Klappfläche und Blatt; schließt die Fläche und führt auf `BENACHRICHTIGUNGEN_PFAD` (Test)

## 5. e2e und Bildlauf (D9)

- [x] 5.1 Helfer in `e2e/menue-kern.ts`: Anzeige im Benutzermenü wählen (Leiste und Wert über Rollen), ein gemeinsamer Weg für alle Specs
- [x] 5.2 Specs umstellen, die Darstellung, Dichte oder Helligkeit über das Menü setzen oder prüfen (`dichte-ableitung`, `kopfzeile-schmal`, `lagekarte-smoke`, `lagekarte-zeichnen-korrigierbar`, `rahmen-stehen-bleiben`, `gate3-trefflaeche`, `neuigkeiten`, `hilfe` u. a.; Abschlussprüfung per `grep` nach `menuitem` mit den alten Namen)
- [x] 5.3 e2e `benutzermenue` (neu oder in bestehender Spec): 390 × 844 `komfortabel` ganzes Menü im Fenster; `handschuh` Abmelden und alle drei Leisten ohne Rollen; Tastatur in einer Leiste; Eingänge-Link führt auf Benachrichtigungen
- [x] 5.4 Bildlauf: `doku-bilder/anmelden-abmelden.bilder.ts` (`benutzermenue*.png`), `doku-bilder/einsatz-oberflaeche.bilder.ts` (`darstellung*.png`), neues Bild der Hilfe-Übersicht mit Rückmeldung, falls das Kapitel `rueckmeldung` eines zeigt

## 6. Anwenderdoku (Mitänderungsregel)

- [x] 6.1 `docs/anwender/kapitel/einsatz-oberflaeche.md`: Abschnitt Darstellung (Leisten statt Liste mit Häkchen), Benachrichtigungen (zweiter Weg aus den Eingängen), Aufzählung des Benutzermenüs
- [x] 6.2 `docs/anwender/kapitel/rueckmeldung.md`: Weg über die Hilfe statt über das Menü, Bereich der App aus der vorherigen Seite, gekoppelte Geräte; `quellen:` um `frontend/src/hilfe/HilfePage.tsx` ergänzen
- [x] 6.3 `docs/anwender/kapitel/anmelden-abmelden.md` prüfen (Bildunterschrift), `profil-sicherheit.md` prüfen; Lizenzen erwähnen, wo bisher das Menü genannt war

## 7. Entwurf, Design System, Abschluss (D10)

- [x] 7.1 Zeichenflächen und `canvas.json` aus dem Artifact nach `docs/design/2026-11-11-benutzermenue/`
- [x] 7.2 `mise exec -- pnpm -C frontend design-system`, Erzeugtes unter `docs/design/design-system/project/` mitcommitten (Segmentleiste geändert)
- [x] 7.3 Kommentare im Code nachziehen, die „Umschaltgruppen“, „✓ im Text“ oder die alten Einträge nennen (`BenutzerMenu.tsx`, `command-palette/befehle.ts`, `theme/darstellungOptionen.ts`, `rueckmeldung/adresse.ts`)
- [ ] 7.4 `./scripts/check-all.sh` grün (Gate-Lauf dieses Branches)
- [ ] 7.5 `superpowers:requesting-code-review`, bestätigte Befunde abarbeiten

## Workflow follow-up

- `/opsx:archive g7ta82x8-benutzermenue-entschlacken` im selben Branch, dann PR gegen `alpha` mit
  Bildern der Änderung (`pr-bilder/g7ta82x8/`).
- Nach dem Merge: Design System neu veröffentlichen (`frontend/AGENTS.md`, „Größere UI-Entwürfe
  über das Design System“).
