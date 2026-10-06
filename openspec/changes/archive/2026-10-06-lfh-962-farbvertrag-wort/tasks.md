## 1. Vertrag (D1, D2)

- [x] 1.1 Tests zuerst (`theme/statusFarben.test.ts`): „aufgelöst“ neutral, `besatzungsUrteil` vollständig, Kartenzahl 33.
- [x] 1.2 `besatzungsUrteil` und neutrales „aufgelöst“ in `theme/statusFarben.ts`. Mutationsprobe: `aufgeloest` zurück auf `alarm` → 1.1 rot.

## 2. Anzeigen

- [x] 2.1 Gliederungsbaum: Chip „ohne Leiter“, Lagezustand als `StatusTag` am Rand (`AbschnittKnoten.test.tsx`, Mutationsproben).
- [x] 2.2 Fahrzeuge: Urteil über `StatusTag`, „Ist … · Soll …“ (`FahrzeugePage.test.tsx`, Mutationsprobe „nicht erfasst“ gestrichen → rot).
- [x] 2.3 Meldungen: kein `danger` an „Sofortmeldung“ und „Bestätigen“, Guard nachgezogen (Mutationsproben).
- [x] 2.4 Legende oben im Überblick, Spaltenkopf „Fahrzeuge und Personal“ mit Legende im Meldebild.

## 3. e2e und Abschluss

- [x] 3.1 `e2e/farbvertrag-wort.spec.ts`: Wort sichtbar, kein Überhang bei 390 und 1440, als Admin und Beobachter; Mutationsprobe rot.
- [x] 3.2 `frontend/AGENTS.md`: Kartenzahl und Beleg nachgezogen.
- [x] 3.3 Bündel `schnell`, volle Vitest-Suite, berührte e2e-Specs grün (Lauf vom 06.10.2026); `check-all.sh` belegt die CI des PRs.
