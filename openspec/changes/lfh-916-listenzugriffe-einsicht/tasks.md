# Tasks

## 1. Backend — Abfragen (`src/person/audit_repo.rs`)

- [x] 1.1 `liste_listenweit(pool, einsatz_id)` per TDD: Tests zeigen, dass nur Zeilen ohne Person dieses Einsatzes kommen (kein `detail`/`anhang`, kein fremder Einsatz), die neuesten zuerst mit Benutzername; `cargo test person::audit_repo` grün
- [x] 1.2 `liste_je_person` um das Erfassungsfenster erweitern (design.md D3) per TDD: Tests für Export nach der Erfassung (drin), Druck davor (draußen), Export nach Stornierung (draußen), gleiche Sekunde an beiden Grenzen (drin), fremder Einsatz (draußen); der bestehende Test `druck_eintrag_ohne_person` wird auf die neue Regel umgestellt; `cargo test person::audit_repo` grün

## 2. Backend — Endpunkt

- [x] 2.1 Handler `einsatz_person::listenzugriffe` und Route `GET /api/einsaetze/{id}/personen/listenzugriffe` in `src/app.rs` per TDD in `tests/einsatz_person.rs`: Leitung bekommt Export und Druck neueste zuerst; Führungspersonal und Beobachter 403; zweimaliges Öffnen ändert die Zahl der Protokollzeilen nicht; abgeschlossener Einsatz liefert die Einträge
- [x] 2.2 Bestehende Integrationstests, die nach Export oder Druck die Einsicht je Person zählen, auf die neue Menge anpassen (es gab keinen: kein bestehender Test zählt nach Export oder Druck die Einsicht je Person) und einen Test ergänzen, der „Liste exportiert“ in der Einsicht je Person einer vorher erfassten Person zeigt; `cargo test --test einsatz_person` grün

## 3. Frontend — Einsicht an der Personenliste

- [x] 3.1 `ladePersonenListenzugriffe(einsatzId)` in `api/einsatzPerson.ts` und Key `einsatzKeys.personenListenzugriffe` mit Eintrag in `NICHT_LIVE_KEYS` samt Begründung; `queryKeys.test.ts` und der Guard-Test grün
- [x] 3.2 Schnellansicht `personen/ListenzugriffeDrawer.tsx` (KatalogTabelle Wann · Wer · Art über `zugriffArtText`, leerer Zustand, Ladefehler) per TDD mit Vitest: lädt erst offen, zeigt die Einträge in Serverfolge
- [x] 3.3 Kopf-Knopf „Listenzugriffe“ in `pages/PersonenPage.tsx` nur bei `istEinsatzLeitung`; Vitest: Leitung sieht den Knopf und öffnet die Ansicht, Führungspersonal sieht ihn nicht
- [x] 3.4 Hinweissatz im Abschnitt „Zugriffs-Audit“ der `PersonenDetailPage` (Listenzugriffe erscheinen, wenn die Person in der Liste stand); bestehender Vitest der Detailseite grün
- [x] 3.5 Regelzeile in `frontend/src/personen/AGENTS.md` (Ort der Einsicht, nicht live, unprotokolliert, Spec `personen-zugriffsprotokoll`); Prettier grün

## 4. Integration

- [ ] 4.1 `./scripts/check-all.sh` sowie Vitest und Rust-Tests lokal grün (umgebungsbedingte Abweichungen gegen `alpha` gegengeprüft)
