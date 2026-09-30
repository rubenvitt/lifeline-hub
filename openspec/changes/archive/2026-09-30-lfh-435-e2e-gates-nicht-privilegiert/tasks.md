# Tasks

Jede Aufgabe mit Durchgang gilt erst als erledigt, wenn (a) der neue Test grün läuft, (b) die
Mutationsprobe nach D8 in `pruefliste.md` steht (Nicht-Admin rot, Admin grün) und (c)
`git diff --stat` nach der Probe keine Mutation mehr zeigt. Einzelläufe:
`mise exec -- pnpm -C <abs>/frontend exec playwright test <spec> -g "<name>"`. Wird ein neuer
Durchgang rot, gilt D5.

## 1. Grundlage

- [x] 1.1 `pruefliste.md` im Change-Ordner anlegen: das Inventar (Spec × Rolle heute ×
  gemessene Routen × rollenabhängig? mit Datei:Zeile × geplanter Durchgang) aus dem Scope-Lauf
  übernehmen, dazu leere Abschnitte „Mutationsproben“ und „Laufzeit“. Verifikation: Jede Spec
  aus proposal.md (Wellen 1 und 2) hat eine Zeile mit Verdikt.
- [x] 1.2 Baseline-Laufzeit von `pnpm e2e` (bzw. `./scripts/check-all.sh --nur=e2e`) auf dem
  unveränderten Stand messen und in die Prüfliste eintragen. Verifikation: Zahl mit Datum und
  Befehl steht drin.
- [x] 1.3 `frontend/e2e/rollen-kern.ts` nach D1 bauen (`anmeldenAls`, `anmeldenAlsAdmin`,
  `benutzerAnlegen`, `mitgliedEintragen`, `wechsleZu`). Den LFH-337-Test in
  `kopfzeile-schmal.spec.ts` und den LFH-460-Block in `gate1-ueberlauf.spec.ts` darauf
  umstellen. Verifikation: beide Tests grün, `pnpm lint` und `tsc` grün.

## 2. Welle 1: Kern-Gates

- [x] 2.1 `kopfzeile-schmal`: den Nicht-Admin-Test zusätzlich auf 1024 px, mit Vorbedingung
  „Tag ‚Keine Berechtigung‘ sichtbar, kein freier Link“ und Messung beider Achsen.
  Mutationsprobe: der Tag bekommt `minWidth: 2000`. Verifikation: Test grün, Probe
  festgehalten.
- [x] 2.2 `gate1-ueberlauf`: `Freistellung` um `rolle` erweitern (D6), Abgleich und Totmeldung
  über Modul, Breite und Rolle. Verifikation: bestehende Admin-Tests grün. Eine probeweise
  Beobachter-Freistellung meldet im Admin-Durchgang nichts frei (Probe festgehalten, nicht
  committet).
- [x] 2.3 `gate1-ueberlauf`: `gate1Routen(einsatzId, rolle)` mit `ankerLesend` und
  `vorbedingungLesend` (D4). Seeding um einen ETB-Eintrag ergänzen. Admin-Routen: für den
  Beobachter die Umleitung auf `/einsaetze` zusichern statt messen. Verifikation:
  Admin-Durchgänge unverändert grün.
- [x] 2.4 `gate1-ueberlauf`: je Prüfbreite ein Test `… · Beobachter` (Seeding als Admin,
  Mitglied `beobachter`, `wechsleZu`). Vorbedingungen: Rechtehinweis auf Ablösung, Verpflegung,
  Betreuung und Überblick, keine ETB-Erfassungsleiste, kein „Neuer Einsatz“. Mutationsprobe:
  `RechteHinweis` mit `minWidth: 2000`. Verifikation: vier Tests grün, Probe festgehalten.
- [x] 2.5 `gate1-ueberlauf`: je Prüfbreite ein Test `… · Führungskraft` über
  `/admin/stammdaten/fahrzeuge` und `/admin/einstellungen/einsatz`, mit der Vorbedingung
  „Rechtehinweis sichtbar, Zeilenaktionen gesperrt“. Die Umleitung von `/admin/benutzer` wird
  zugesichert. Mutationsprobe: Rechtehinweis breiter. Verifikation: grün, Probe festgehalten.
- [x] 2.6 `gate3-trefflaeche`: Geschwistertest „Globale Kopfzeile (ohne Verwaltungsrecht)“ über
  die Staffel auf 1024 px. Der gedämpfte Eintrag und der Tag sind zugesichert, die übrigen
  Kopfziele halten die Stufe. Mutationsprobe: der Tag zwingt den Suchzugang unter den Boden.
  Verifikation: grün, Probe festgehalten.
- [x] 2.7 `gate3-trefflaeche`: Beobachter-Geschwister für Stab, Ablösung, Kräfteübersicht,
  Betreuung, Verpflegung und Betroffene-Liste. Versteckte Ziele werden als abwesend
  zugesichert, gesperrte als `toBeDisabled` und in der Stufe gemessen, die Messmenge je Test
  ist nie leer. Mutationsprobe je Test: gesperrte Aktion bzw. Rechtehinweis im Nur-Lese-Zweig
  mit fester Kompaktgröße. Verifikation: grün, Proben festgehalten.
- [x] 2.8 `trefflaeche-tablet`: Führungskraft-Geschwister für den Kippschalter-Test auf
  `/admin/einstellungen/anmeldung` (Sperrgrund „nur Admins“ je Zeile zugesichert, kein
  Zeilenüberlauf, Kippschalter in der Stufe) und Beobachter-Geschwister für die
  Personal-Modulzeilen. Mutationsprobe: Sperrgrund `nowrap` + `minWidth`. Verifikation: grün,
  Proben festgehalten.
- [x] 2.9 Welle 1 gesamt: `pnpm lint`, `check-fmt.sh`, alle geänderten Specs zusammen mit
  `--workers` wie in der CI. Verifikation: grün, Laufzeit der Welle in der Prüfliste.

## 3. Welle 2: übrige rollenabhängige Specs

- [x] 3.1 `einstellungen-schmal`: Durchgang als Führungspersonal (Module gesperrt + Hinweis)
  und als Beobachter (alle Sektionen mit Hinweis) auf 390 px. Verifikation: grün, Probe
  festgehalten.
- [x] 3.2 `uhs-hoehe` und `uhs-grundriss-touch`: Beobachter auf 390/1024 px. Kopf ohne
  Aktionen, die Platzkarte öffnet die Person direkt, Trefffläche „Person öffnen“, kein
  Querlauf. Verifikation: grün, Probe festgehalten.
- [x] 3.3 `leisten-flaeche` (Gefahren und Lagekarte): Beobachter mit Alert „Nur Lesezugriff“
  über der Matrix. Fläche und Verschiebung gemessen, Sidebar-Aktionen als abwesend zugesichert.
  Verifikation: grün, Probe festgehalten.
- [x] 3.4 `kraefte-schmal` und `datensicht-schmal`: Beobachter auf den Kräfteseiten und
  Personal. Statusbedienung abwesend, Position als Text, kein Querlauf. Verifikation: grün,
  Probe festgehalten.
- [x] 3.5 `betroffene-schmal`: Beobachter auf Personen und Tieren. Kopfaktionen abwesend, die
  Karte kollabiert nicht, kein Querlauf. Verifikation: grün, Probe festgehalten.
- [x] 3.6 `lagebericht-schmal`: Beobachter auf Liste und Detail, „Neuer Bericht“ abwesend.
  Verifikation: grün, Probe festgehalten.
- [x] 3.7 `lagekarte-leiste-dichte`: Beobachter-Leiste mit Fachebenen ohne Inspector-Aktionen,
  Treffflächen der verbleibenden Ziele. Verifikation: grün, Probe festgehalten.
- [x] 3.8 `katalogtabelle-schmal` und `verwaltung-vereinheitlicht`: Führungskraft auf
  Stammdaten und Einsatz-Vorgaben (390 px), Rechtehinweis, gesperrte Zeilenaktionen.
  Verifikation: grün, Probe festgehalten.
- [x] 3.9 `chat-layout`: Beobachter. Der Alert ersetzt die Eingabe, die Höhenkette hält
  (`toBeInViewport`), kein Querlauf. Verifikation: grün, Probe festgehalten.
- [x] 3.10 Jede Inventarzeile ohne Durchgang trägt in `pruefliste.md` ein begründetes Verdikt
  („nicht rollenabhängig“ bzw. Nachzug mit Ticketnummer). Verifikation: keine Zeile ohne
  Verdikt.

## 4. Abschluss

- [x] 4.1 `CLAUDE.md` unter „Qualitäts-Gates“: eine Zeile „Ein Layout-Gate prüft jeden
  rollenabhängigen Zustand mit mindestens einer nicht-privilegierten Rolle (Hilfe
  `e2e/rollen-kern.ts`, Vorbedingung vor Messung, Mutationsprobe; LFH-435)“. Verifikation:
  Zeile steht drin, Verweise existieren.
- [x] 4.2 Laufzeit nach dem Umbau messen, Delta gegen 1.2 in die Prüfliste. Bei mehr als 30 %
  Ausdünnung nach dem Risiko in design.md, begründet. Verifikation: Zahlen stehen drin.
- [x] 4.3 `./scripts/check-all.sh` komplett. Verifikation: Gesamtstatus grün, Log nach
  `ÜBERSPRUNGEN` durchsucht.
