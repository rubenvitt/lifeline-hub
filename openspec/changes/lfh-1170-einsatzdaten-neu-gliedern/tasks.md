# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Gates aus dem Frontend-Ordner über `mise exec -- pnpm …`.

## 1. Zugriff als Einstellungs-Sektion (D1)

- [ ] 1.1 `EinstellungenSektion` um `'zugriff'` erweitern und `{ key: 'zugriff', label: 'Zugriff' }` hinten an `EINSTELLUNGEN_SEKTIONEN` hängen; Deeplink-Test `einsatzEinstellungenPfad(5, 'zugriff')` → `/einsaetze/5/einstellungen/zugriff` und Reihenfolge-Pin (erste Sektion bleibt `allgemein`) in `routing/deeplinks.test.ts` grün
- [ ] 1.2 `pages/einstellungen/EinsatzZugriff.tsx` anlegen (Daten über `useEinstellungenDaten`, `MitgliederAbschnitt` mit `darfEinsatzLeiten` bzw. `istEinsatzLeitung`, `RechteHinweis` „Nur die Einsatzleitung verwaltet den Zugriff“ für alle anderen am aktiven Einsatz) und in `EINSTELLUNGEN_ROUTEN` (`App.tsx`) einhängen; Vitest `EinsatzZugriff.test.tsx`: Einsatzleitung sieht „Hinzufügen“, Führungspersonal sieht gesperrte Rollen, kein „Hinzufügen“/„Entfernen“ und den Hinweis, abgeschlossener Einsatz zeigt keinen zweiten Hinweis
- [ ] 1.3 `MitgliederAbschnitt` den oberen Außenabstand über eine Prop oder den Aufrufer setzen lassen, sonst unverändert; `MitgliederAbschnitt.test.tsx` grün
- [ ] 1.4 e2e `einstellungen-schmal.spec.ts` um die Sektion „Zugriff“ bei 390 px ergänzen (kein Querlauf, „Entfernen“ ohne Wischen erreichbar, Rückfrage öffnet sich) — die Messung, die bisher `einsatzdaten-schmal.spec.ts` für das Paneel trug, wandert mit; `trefflaeche-pruefflaechen.spec.ts` um die Ziele der Sektion ergänzen

## 2. Einsatzdaten: ein Bearbeitungsweg (D2, D3)

- [ ] 2.1 Bezeichnung als Pflicht-Zeile (`TextAngabe` mit `pflicht`): Vitest — Speichern sendet genau `{ bezeichnung }`, nur Leerzeichen sendet nichts und zeigt den Pflichthinweis an der Zeile, unverändert sendet nichts, Ortspfad zeigt den neuen Namen
- [ ] 2.2 Koordinate als Zeile (`InlineAngabe<KoordinatenWert>` mit `KoordinatenEingabe`, Prüfung per `istLatLon`); `EinsatzdatenPage.tsx` mit Begründung in `DIREKT` von `anzeige/koordinatenFeld.guard.test.ts`; Vitest — gültig sendet genau das Paar, leer sendet beide `null`, unlesbar sendet nichts und lässt die Eingabe mit Fehler an der Zeile offen, Beobachter sieht keine Aufforderung
- [ ] 2.3 Vollformular entfernen (`bearbeiten`, `Form`, `FormWerte`, `TEXTFELDER`, `geaenderteKopfdaten`, `geoeffnetRef`, `speichernMutation`, Knopf „Bearbeiten“) samt seiner Tests; Vitest belegt die Abwesenheit von „Bearbeiten“ und „Einsatzdaten bearbeiten“; `tsc` und ESLint ohne ungenutzte Importe

## 3. Einsatzdaten: Gliederung und Seitenkopf (D4, D5)

- [ ] 3.1 Seitenkopf-`meta` aus Einsatznummer und Leitstellen-Nr. („ · “, Leere fällt weg); Vitest — beide, nur eine, keine (kein `meta`-Text); Nachtragen der Leitstellen-Nr. an der Zeile zeigt sie im Kopf
- [ ] 3.2 Klappbereich „Technische Angaben“ entfernen; Paneele „Einsatz“, „Einsatzort“, „Erstmeldung“ mit den Zeilen aus D4, „Angelegt“ statt „Angelegt am (techn.)“; Vitest — kein Auslöser „Technische Angaben“, jede Angabe im erwarteten Paneel (`region` mit Namen), jede Angabe genau einmal
- [ ] 3.3 `breite="voll"` und Paneel-Raster (eine Spalte unter `xl`, zwei ab `xl`, DOM-Reihenfolge Einsatz → Einsatzort → Erstmeldung → Eigene Führungsstelle); Vitest mit gemocktem `abBreite('xl')` prüft Spaltenzahl und Reihenfolge
- [ ] 3.4 „Einsatzbericht drucken“ und „Zugriff verwalten“ (nur `darfEinsatzLeiten`, `sprung`, Ziel `einsatzEinstellungenPfad(id, 'zugriff')`) als `weitere`, `aktionen` leer, Paneel „Zugriff“ von der Seite entfernt; Vitest — Einsatzleitung sieht den Nebenweg und springt, Beobachter und Führungspersonal sehen ihn nicht, Einsatzbericht bleibt für alle
- [ ] 3.5 e2e nachziehen: `einsatzdaten-inline.spec.ts` (kein Aufklappen, Leitstellen-Nr. im Kopf), `einsatzdaten-schmal.spec.ts` (Paneele statt „Lagedaten“, kein Formularzweig, Zugriff-Teil entfällt hier), `einsatzabschluss.spec.ts` (kein „Bearbeiten“) und jede weitere Fundstelle aus `grep -rn "Lagedaten\|Technische Angaben\|'Bearbeiten'\|name: 'Zugriff'" frontend/e2e` auf Einsatzdaten; Handy 390 px ohne Überlauf belegt
- [ ] 3.6 Prüfliste Einsatztauglichkeit (15 Kriterien) für Einsatzdaten und die Sektion „Zugriff“ als `pruefliste.md` in dieser Change, jede Zeile mit Verdikt

## 4. Regeln, Specs und Anwenderdoku (D6)

- [ ] 4.1 `frontend/AGENTS.md`, „Inline-Bearbeitung und Status“: Satz zu den Einsatzdaten nach D6 ersetzen; `prettier --check` über `frontend/` grün; Verweise auf „Vollformular“/„Technische Angaben“ in Code-Kommentaren per Grep bereinigt
- [ ] 4.2 Anwenderdoku: `docs/anwender/kapitel/einsatzdaten.md`, `einsatz-einstellungen.md`, `rechte-im-einsatz.md` fortschreiben; Bildskripte `frontend/e2e/doku-bilder/einsatzdaten.bilder.ts`, `rechte-im-einsatz.bilder.ts` (Pfad `…/einstellungen/zugriff`), `einsatz-einstellungen.bilder.ts` anpassen und die Bilder neu erzeugen (`pnpm doku:bilder --grep "einsatzdaten|rechte-im-einsatz|einsatz-einstellungen"`); Doku-Wächter aus `docs/anwender/AGENTS.md` grün

## 5. Abschluss-Prüfung

- [ ] 5.1 `./scripts/check-all.sh` grün (lokal oder im CI-Lauf des PRs)
- [ ] 5.2 Code-Review (`superpowers:requesting-code-review`) ohne offene blockierende Befunde

## Workflow follow-up

- Purpose der Haupt-Spec `einsatzdaten-bearbeitung` beim Archivieren nachziehen (kein Vollformular mehr).
- `/opsx:archive lfh-1170-einsatzdaten-neu-gliedern` im selben Branch vor dem PR.
- PR gegen `alpha`, Board-Status LFH-1170 auf `in review`.
