# Tasks

## 1. Ableitungsregel als reine Funktion (D2, D3)

- [x] 1.1 `theme/dichte.test.ts` mit der Wahrheitstafel anlegen: (`kompakt`, `komfortabel`, `handschuh`, `null`, unbrauchbarer Wert) × (grob, fein). Zuerst rot sehen (Datei `dichte.ts` fehlt), dann `startDichte` in `theme/dichte.ts` schreiben (nur `./tokens` importieren) und grün sehen. `mise exec -- pnpm -C frontend vitest run src/theme/dichte.test.ts`
- [x] 1.2 `ThemeModeProvider.tsx` auf `startDichte(localStorage.getItem(…), zeigerIstGrob())` umstellen und die Konstanten `DICHTE_DEFAULT*` nach `dichte.ts` ziehen. Der Dateikopf verweist auf die Spec `bedien-dichte`. Beleg: die bestehenden Blöcke LFH-329 und LFH-361 in `ThemeModeProvider.test.tsx` bleiben grün.
- [x] 1.3 Vitest-Fall „ein Zeigerwechsel während der Sitzung ändert die Stufe nicht“ in `ThemeModeProvider.test.tsx`: `change` auf dem gemockten `MediaQueryList` feuern, Stufe bleibt `kompakt`. Mutationsprobe: ein probeweise eingebauter Zuhörer macht den Fall rot (danach entfernen).
- [x] 1.4 Wache `theme/dichteQuelle.guard.test.ts`: Die Importe von `dichte.ts` sind genau `./tokens`, und `ThemeModeProvider.tsx` importiert nichts aus `api/`, `auth/`, `einsatz/`, `fuehrung/`, `stab/` oder `react-router`. Mutationsprobe: ein probeweiser Import aus `fuehrung/` macht sie rot.

## 2. Browser-Beleg der Ableitung (D4)

- [x] 2.1 `e2e/dichte-ableitung.spec.ts` mit `hasTouch` auf `/login`: ohne Wahl `komfortabel`, Wahl `kompakt` bleibt `kompakt`, unbrauchbarer Wert ergibt `komfortabel`, Wahl `handschuh` bleibt `handschuh`. Geprüft wird jeweils `html[data-dichte]` und die Höhe des Anmelde-Knopfs im Fenster der Stufe (Muster `dichte.spec.ts`). Die Datei läuft grün.
- [x] 2.2 Test „die Wahl gehört zum Gerät“ in derselben Datei: Admin wählt `handschuh` über das Benutzermenü, meldet sich ab, eine zweite Person (`rollen-kern.ts`) meldet sich an, danach steht weiter `handschuh`. Der Test läuft grün.

## 3. Messhelfer in einen Kern (D5)

- [ ] 3.1 Vorher `e2e/gate3-trefflaeche.spec.ts` vollständig laufen lassen und das Ergebnis festhalten.
- [ ] 3.2 Helfer (`STAFFEL`, `SUBPIXEL`, `stelleDichte`, `haeltStufe`, `alleHaltenStufe`, `kurzeAchseHaelt`, `ruhigeHoehe`, `gegenprobe`, `anmelden`, `einsatzAnlegen`, `anlegen`, `NUR_SCHREIBENDE`) nach `e2e/trefflaeche-kern.ts` verschieben, gate3 importiert sie. Eigener Commit ohne Verhaltensänderung. Beleg: gate3 läuft danach mit derselben Testzahl grün, `pnpm -C frontend lint` ist grün.

## 4. 72-px-Messung an den Prüflisten-Flächen (D5, D6)

Je Abschnitt: `kompakt` und `handschuh` messen, Gegenprobe `kompakt < handschuh` je Zielsorte,
Rollen-Geschwister in `handschuh` mit Vorbedingung Rechtehinweis. Neue Tests in
`e2e/trefflaeche-pruefflaechen.spec.ts`, sofern nicht anders genannt. Ein rotes Ziel wird nach
D6 behandelt (lokal beheben mit Vitest/e2e-Beleg, sonst Folgeticket).

- [ ] 4.1 C7 · ETB: Textfeld und Senden-Knopf der Schnellerfassung (der Rest ist durch LFH-373 gemessen). Beobachter-Geschwister: Schnellerfassung abwesend oder gesperrt, Rechtehinweis steht. Grün.
- [ ] 4.2 C8 · Meldungen, Erinnerungen, Nachforderungen: Primäraktion des Seitenkopfs und die Aktionsknöpfe je Karte (Seed je eine Meldung, Erinnerung, Nachforderung über die API). Beobachter-Geschwister. Grün.
- [ ] 4.3 C8 · Aufträge (Tab „Aufträge“ und Tab „Befehle“) und Chat (Eingabefeld, Senden-Knopf). Seed: ein Auftrag, ein Befehl, eine Chatnachricht. Beobachter-Geschwister. Grün.
- [ ] 4.4 C10 · Einsatz-Einstellungen (Sektionen allgemein, verhalten, aufbewahrung, pegel: Felder und Speichern-Knopf) und Einsatzdaten. Beobachter-Geschwister. Grün.
- [ ] 4.5 C10 · Profil und `/admin/einstellungen/anzeige`: Formularfelder und Speichern-Knopf. Grün.
- [ ] 4.6 C11 · Tabelle 1: dritter Eintrag `handschuh` in der `STAFFEL` von `e2e/verwaltung-vereinheitlicht.spec.ts` (Zeilenhöhe 72, Abstände aus `theme/tokens.ts`). Die Datei läuft grün.
- [ ] 4.7 C11 · Tabelle 2 Fahrzeug-Detailseite (Felder, Speichern-Knopf) und Tabelle 3 `/admin/einstellungen/einsatz` (Modulzeilen auf der Admin-Route selbst). Führungskraft-Geschwister. Grün.
- [ ] 4.8 C12 · Einsatzabschnitte (Baumansicht): Aktionen eines Baumknotens und der Detailkarte (`?abschnitt=<id>`). Seed: zwei Abschnitte, eine Einheit. Beobachter-Geschwister. Grün.
- [ ] 4.9 C12 · Bereitstellungsraum-Detail: „zuweisen“-Knöpfe der Leiste „Kräfte ohne BR“, Raumwechsler, Aktionen der Belegungsliste. Seed: zwei BR, Ad-hoc-Personal und -Fahrzeug, eine Belegung. Beobachter-Geschwister. Grün.
- [ ] 4.10 C13 · Lagebericht-Detail (Abschnittsköpfe, Formularfelder), Berichtsliste (Karten) und Lagemeldungen (Aktionen). Seed: ein Lagebericht, eine lagerelevante Meldung. Beobachter-Geschwister. Grün.
- [ ] 4.11 Für jedes rote Ziel aus 4.1–4.10: Behebung mit Beleg oder Folgeticket auf dem Entwicklungsboard. Bei Folgeticket die Delta-Spec per `/opsx:update` kürzen (D6). Ohne rotes Ziel abhaken mit dem Vermerk „keins“.

## 5. Prüflisten und Projektregel (D7)

- [ ] 5.1 Je Prüfliste (C7, C8, C10, C11, C12, C13) den Abschnitt „Nachtrag LFH-724“ schreiben: Verdikt je Tabelle mit messendem Test (Datei + Titel) und Verweis auf die Spec `bedien-dichte`. Zeile 2 auf das Verdikt nachziehen, veraltete Zeilenangaben auf Testtitel umstellen. Beleg: `grep -rn "Einsatzkontext" docs/superpowers/specs` zeigt für die Stufenableitung keinen Verweis auf LFH-373, und keine Zeile 2 der sechs Dateien steht mehr auf „teilweise erfüllt“ ohne Folgeticket.
- [ ] 5.2 `frontend/AGENTS.md`: ein Absatz „Bediendichte (LFH-724)“ mit der Reihenfolge, dem Träger `theme/dichte.ts` und dem Verweis auf die Spec. Die Datei bleibt prettier-sauber (`scripts/check-fmt.sh`).

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (bzw. Bündel `schnell` lokal plus e2e der neuen und geänderten Dateien; Volllauf belegt die CI des PRs).
- [ ] 6.2 Review-Workflow (Bugs, Konventionen, Tests) und `superpowers:requesting-code-review`; bestätigte Findings abgearbeitet.
