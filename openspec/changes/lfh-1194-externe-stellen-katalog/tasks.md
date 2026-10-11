# Tasks

## 1. Katalog im Backend

- [ ] 1.1 Migration `org_externe_stelle` nach design.md D3 (CHECKs, `UNIQUE(org_id, bezeichnung)`, partieller UNIQUE-Index für `zustaendig`, Kopfkommentar „Org-Stammdatum, nicht in der Schwärzungs-Registry“). Nummer per `scripts/check-migrationen.sh` gegen `origin/alpha`. Prüfung: `db::tests::migrationsnummern_sind_eindeutig` grün.
- [ ] 1.2 Modul `src/externe_stelle/` mit `wire_enum! ExterneStelleArt` (D2), DTO `ExterneStelle` (D4), Grenzen `BEZEICHNUNG_MAX`/`KURZ_MAX` (D5) und Repo (liste mit `nur_aktive` und Sortierung nach D2, anlegen, patche mit Markierungswechsel in einer Transaktion). Test zuerst als Repo-Unit-Tests: Sortierung, Duplikat → Conflict, Markierung wechselt, Deaktivieren entfernt die Markierung, fremde Org → NotFound. Prüfung: Tests rot, dann grün.
- [ ] 1.3 Test zuerst `tests/externe_stelle.rs` für die Szenarien der Spec `stammdaten-externe-stellen` (Anlegen 201, 400 leer/Art/Überlänge, 409 Duplikat, 403 ohne Admin, Liste aktiv/alle, Org-Grenze Liste und PATCH 404, gleicher Name in zwei Orgs, Reaktivieren, Markierung: Wechsel, 422 bei Polizei, 422 bei Artwechsel der zuständigen, 422 bei `aktiv:false`+`zustaendig:true`, Deaktivieren entfernt sie). Dann Handler `src/routes/externe_stelle.rs` (`JsonBody`/`PfadParam`, Tri-State) und Routen in `src/app.rs`. Prüfung: `cargo test --test externe_stelle` grün.
- [ ] 1.4 Live: Präfix `/api/externe-stellen` in `STAMMDATEN_PFADE`, Modul in `KATALOG_MODULE` von `tests/stammdaten_live_guard.rs`, POST-Zeile in der Routentabelle von `tests/org_live.rs`. Prüfung: beide Tests grün, ein abgelehntes POST (409) verteilt kein `stammdaten`.
- [ ] 1.5 Typ-Codegen: `ExterneStelle` und `ExterneStelleArt` in `src/api_doc.rs`, Enum in `tests/enum_wire_kontrakt.rs`, `scripts/check-typ-codegen.sh` laufen lassen. Prüfung: Skript grün, `openapi.json` und `types.generated.ts` mitcommittet, Barrel `api/types.ts` exportiert beide.
- [ ] 1.6 Grenzen spiegeln: `EXTERNE_STELLE_BEZEICHNUNG_MAX`, `EXTERNE_STELLE_KURZ_MAX` in `frontend/src/api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`. Prüfung: `cargo test --test eingabegrenzen_spiegel` grün.

## 2. Grenze für die meldende Stelle

- [ ] 2.1 Test zuerst (Szenarien der Delta-Spec `eingabegrenzen`): 201 Zeichen → 400 mit „Meldende Stelle“ und 200, Einsatz unverändert; genau 200 → gespeichert; Altwert von 300 Zeichen bleibt beim Patch der Leitstellen-Nr. stehen. Dann `MELDENDE_STELLE_MAX` (D5) im PATCH `src/routes/einsatz.rs` nur auf `Some(Some(_))` prüfen. Prüfung: Tests rot, dann grün.
- [ ] 2.2 `MELDENDE_STELLE_MAX` in `api/eingabegrenzen.ts` und im Spiegeltest. Prüfung: `cargo test --test eingabegrenzen_spiegel` grün.

## 3. Verwaltung im Frontend

- [ ] 3.1 `api/externeStellen.ts` (liste, anlegen, ändern; Request-Typen von Hand) und Query-Key `GLOBAL_KEYS.externeStellen` mit Token `'aktiv' | 'alle'` (D9), live über `ORG_STREAM_EVENTS.stammdaten`, in `LAGEBILD_OFFLINE` ausdrücklich draußen mit Grund im Kommentar. Prüfung: `globalKeys.test.ts`, `queryKeys.test.ts` und `lagebildOffline.guard.test.ts` grün (Wire-String `externe-stellen` eingefroren).
- [ ] 3.2 Test zuerst `stammdaten/ExterneStelleFormModal.test.tsx`: Bezeichnung und Art sichtbar, Checkbox „Zuständige Leitstelle“ nur bei Art Leitstelle, Rufnummer und Funkrufname im Klappteil (Feldbudget mit `forceRender` und Gegenprobe), `maxLength` aus `eingabegrenzen.ts`, Enter sendet. Dann das Modal mit `ErfassungsModal` (D10). Prüfung: Tests grün.
- [ ] 3.3 Test zuerst `stammdaten/ExterneStellenTab.test.tsx`: Tabelle mit Art-Gruppen-Reihenfolge, Marke „zuständig“ als Wort, Filter Art und aktiv/inaktiv, Deaktivieren und Reaktivieren über das Aktionsmenü, ohne Admin-Recht gesperrt mit Grund. Dann den Tab mit `KatalogTabelle`. Prüfung: Tests grün.
- [ ] 3.4 Eintrag in `admin/adminNav.tsx` nach den Stichworten, nachgezogen in `adminNav.test.tsx`, `stammdaten/rechteGate.test.tsx` und `components/katalogTabelle.guard.test.ts` (`KATALOGE`). Prüfung: die drei Tests grün, Route `/admin/…/externe-stellen` erreichbar.
- [ ] 3.5 Anwenderkapitel `docs/anwender/kapitel/stammdaten.md`: Katalog in der Aufzählung, Abschnitt zur zuständigen Leitstelle, `quellen:` ergänzt, Bild nach `docs/anwender/AGENTS.md` falls die fotografierte Ansicht sich ändert. Prüfung: `hilfe/anwenderdoku.guard.test.ts` grün.

## 4. Vorschläge in Einsatzdaten und Nachforderung

- [ ] 4.1 Test zuerst für `stammdaten/externeStellenVorschlaege` (D6): Gruppen in der Reihenfolge nach D2, zuständige Leitstelle vorn mit Marke, nur aktive Stellen, Teilwortsuche ohne Groß-/Kleinschreibung, `zustaendigeLeitstelle`. Dann das Modul. Prüfung: Tests grün.
- [ ] 4.2 Test zuerst in `pages/EinsatzdatenPage.test.tsx`: Zeile „Meldende Stelle“ zeigt gruppierte Vorschläge, Wahl sendet genau `{ meldende_stelle: "ILS Musterkreis" }`, Freitext wird gespeichert, unverändert sendet nichts, Vollformular mit denselben Vorschlägen, `maxLength` 200. Dann Umbau nach D7. Prüfung: Tests grün, bestehende Szenarien der Spec `einsatzdaten-bearbeitung` weiter grün.
- [ ] 4.3 Test zuerst in `nachforderungen/NachforderungFormular.test.tsx`: Vorbelegung mit der zuständigen Leitstelle beim Öffnen und nach dem Absetzen, auch wenn die Liste erst später kommt; eigene Eingabe bleibt bei Kategoriewechsel; ohne zuständige Leitstelle leer; Vorschläge vorhanden. Dann Umbau nach D8. Prüfung: Tests grün, Erfassungs-Norm-Tests (`Erfassung.test.tsx`) grün.
- [ ] 4.4 Anwenderkapitel `einsatzdaten.md` (Vorschläge, Freitext bleibt) und `nachforderung.md` (Vorbelegung) samt `quellen:`. Prüfung: `hilfe/anwenderdoku.guard.test.ts` grün.

## 5. Integration

- [ ] 5.1 Playwright-Prüfung am laufenden Stack: Admin legt „ILS Musterkreis“ als zuständige Leitstelle an, ein zweiter Tab zeigt sie in den Einsatzdaten ohne Neuladen, die Nachforderung ist vorbelegt. Prüfung: Screenshot und Ablauf im PR.
- [ ] 5.2 `./scripts/check-all.sh` vollständig grün. Prüfung: Gesamtstatus aus dem Lauf (bzw. CI des PRs).

## Workflow follow-up

- Kommentar an LFH-1284: Einsatzdaten (meldende Stelle) und Nachforderung (Adressat) beim Bau von `StammdatenFeld` umstellen; Quelle `externeStellen` ist `stammdaten/externeStellenVorschlaege`.
- Folgeticket über `clickup-task-anlegen`: Kommunikationsplan S6 „Externe Stelle hinzufügen“ aus dem Katalog (Abbildung der Arten nach design.md D2) und Lücke „Leitstelle“ mit der zuständigen Leitstelle.
- Nach der Umsetzung `/opsx:archive` im selben Branch, dann erst der PR (Regel aus `AGENTS.md`).
