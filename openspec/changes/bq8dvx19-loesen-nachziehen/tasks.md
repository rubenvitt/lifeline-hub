# Tasks

Jede Aufgabe entsteht per TDD: erst der Test, der ohne die Änderung rot ist.

## 1. Rückgängig nur, wenn frei (Backend)

- [x] 1.1 Material-PATCH nimmt `?nur_wenn_frei=1`; liegt der Posten an einem anderen Ort, 409 mit `ort_text_tx`, nichts geschrieben; am Zielort selbst 2xx. Nachweis: Integrationstest nach dem Muster `fahrzeug_zuruecknehmen_nur_wenn_frei` (frei, woanders → 409 mit Text, Zustand unverändert, ohne Schalter verschiebt)
- [x] 1.2 `besatzung_repo::require_besatzung_frei_tx` und Schalter an `besatzung_zuordnen`; 409 „<Name> sitzt inzwischen auf «<Fzg>»“. Nachweis: Repo-Unittest und Integrationstest wie 1.1
- [x] 1.3 Schalter an `einsatz_uhs_kraefte::zuordnen`, Prüfung an `alt` nach der Geräte-Regel; 409 nennt die UHS. Nachweis: Integrationstest wie 1.1, Geräte-403 bleibt (bestehender Test grün)

## 2. Rücknahme eines Austritts (Backend)

- [x] 2.1 Migration `ruecknahme_von` an `br_belegung` und `person_uhs_belegung` (Nummer > jede auf `origin/alpha`, `scripts/check-migrationen.sh`). Nachweis: `db::tests`, Spiegel-Wächter `schema::tests::jeder_fremdschluessel_ist_eingeordnet` grün
- [x] 2.2 BR: `belegung_repo` Rücknahme in einer Transaktion mit Riegel (Austritt dieser Kraft, kein Ausrücken, jüngstes Ereignis, nicht zurückgenommen, ≤ 10 min, Eintritt-Vorbedingungen). Nachweis: Repo-Tests je Ablehnung (nichts geschrieben) und Erfolg (Cache `aktueller_br_id` wieder gesetzt)
- [x] 2.3 BR: „seit“ und Kennzahlen übergehen das Paar (`letztes_je_objekt`, Kennzahl-Abfrage). Nachweis: Repo-Test Eintritt 13:42 → Austritt → Rücknahme, `seit_at` und `laengste_seit_at` 13:42
- [x] 2.4 BR: Route `POST …/belegung/{belegung_id}/zuruecknehmen`, Rechte wie der Austritt, Eintrag in den Routen der Geräte, ETB „Austragen … zurückgenommen“, Verlauf zeigt die Rücknahme. Nachweis: Integrationstests in `tests/einsatz_bereitstellungsraum.rs` (Erfolg mit ETB, 409 je Riegel, Gerät des Raums darf, fremdes Gerät nicht)
- [x] 2.5 UHS: `belegung_repo` Rücknahme mit Riegel und Platzlogik (Platz frei oder in Aufbereitung ohne fremdes Ereignis → zurück auf den Platz; sonst Wartebereich, `ohne_platz`). Nachweis: Repo-Tests für Platz zurück, Platz vergeben, Person in anderer UHS, zu spät, schon zurückgenommen
- [x] 2.6 UHS: `aufenthalt.seit` übergeht das Paar. Nachweis: Repo-Test seit 13:10 → Austritt → Rücknahme, `seit` 13:10
- [x] 2.7 UHS: Route `POST …/personen/{pid}/uhs-belegung/{belegung_id}/zuruecknehmen`, Rechte wie der Austritt, Geräte-Listen, ETB pseudonym. Nachweis: Integrationstests in `tests/einsatz_uhs.rs`
- [x] 2.8 Antwort-DTOs mit `ruecknahme_von` (und Hülle mit `ohne_platz`), `scripts/check-typ-codegen.sh`, beide generierten Dateien mit. Nachweis: Skript grün

## 3. Frontend: Rückwege mit Schalter

- [ ] 3.1 API-Optionen `nurWennFrei` an `updateDisposition`/`setOrt`, `ordneBesatzungZu`, `ordneKraftZu` über `zuruecknahmeQuery`. Nachweis: Tests prüfen die URL `…?nur_wenn_frei=1`
- [ ] 3.2 Alle Rückgängig-Aufrufe senden den Schalter: `MaterialAmOrt`, `FahrzeugeBesatzung` (`besatzungZurueck`), `FahrzeugePage` (`besatzungZurueckMutation`), `UhsKraefte`; die bewussten Wege nicht. Nachweis: bestehende Tests auf die URL mit Schalter umgestellt, Test für den bewussten Weg ohne Schalter
- [ ] 3.3 Ablehnung (409) an der gehaltenen Zeile, sonst am bisherigen Ort. Nachweis: Test je Stelle mit 409-Antwort

## 4. Frontend: gehaltene Zeile

- [ ] 4.1 `UhsKraefte`: `useHoldGeloest`, „Gelöst“ träge an der Stelle von „Abziehen“, „Rückgängig“ an der Stelle der Funktion, übrige Teile unsichtbar, Laufzustand je Zeile. Nachweis: Tests nach `FahrzeugeBesatzung.test.tsx` „Rückweg nach dem Lösen“ (zwei schnelle Tipps, Rückgängig in der Zeile, Fallen nach Verlassen)
- [ ] 4.2 Besatzungsblock der `FahrzeugePage`: dasselbe, „Rückgängig“ an der Stelle von Position/Funktion, `loading` und Sperre je Zeile. Nachweis: Test zwei schnelle Tipps → genau ein DELETE, gehaltene Zeile mit „Gelöst“

## 5. Frontend: Material am Ort

- [ ] 5.1 `MaterialAmOrt`: bei `isAusgebbar` „Lösen“ ins ⋮ (`WeitereAktionen`, `ZeilenMenueAusloeser`, `useZeilenMenueKontext` am Namensteil), „Ausgeben“ bleibt Knopf, sonst Knopf „Lösen“; gehalten ⋮ unsichtbar und „Gelöst“ träge. Nachweis: `MaterialAmOrt.test.tsx` (Menü, Kontextmenü, gehaltene Zeile), Guards `menueFarbe`, `kontextMenue` grün
- [ ] 5.2 Abhängige Tests nachziehen (`EinheitMaterial`, `MaterialTab`, `materialSchreibweg`, `BrDetailPage`) und e2e `material-am-ort.spec.ts`, `trefflaeche-pruefflaechen.spec.ts` (C15). Nachweis: Vitest grün, e2e-Specs lokal grün

## 6. Frontend: Austragen rückgängig

- [ ] 6.1 API `nimmBrAustrittZurueck`, `nimmUhsAustrittZurueck`; Typ `ruecknahme_von` in den Belegungsschritten. Nachweis: Typprüfung (`tsc`) grün
- [ ] 6.2 `BrDetailPage`: nach „Austragen“ `zeigeRueckgaengig` mit Rücknahme; nicht bei „Abrufen und austragen“ und „Ausrücken“; Ablehnung im Seitenhinweis. Nachweis: `BrDetailPage.test.tsx`
- [ ] 6.3 `PersonenDetailPage`: Hinweis mit Rückgängig nach „Austragen“, Hinweis bei `ohne_platz`, Ablehnung unter den Handlungen. Nachweis: `PersonenDetailPage.test.tsx`
- [ ] 6.4 `Grundriss`: Hinweis mit Rückgängig nach „zurückweisen“, Ablehnung im Seitenhinweis. Nachweis: Grundriss-Test
- [ ] 6.5 `wartetSeit` übergeht das Paar aus Austritt und Rücknahme. Nachweis: `dringlichkeit.test.ts`

## 7. Regeln, Doku, Abschluss

- [ ] 7.0 Verweise auf die umbenannten Anforderungen („Eine gelöste Zeile hält ihre Stelle“ → „Gelöste Zeile hält ihre Stelle“, „Eine Zuordnung lösen“ → „Lösen einer Zuordnung“) in `useHoldGeloest.ts`, `FahrzeugeBesatzung.tsx`, `FahrzeugeBesatzung.test.tsx` und weiteren Treffern nachziehen. Nachweis: `grep -rn "Eine gelöste Zeile hält" frontend src` leer
- [ ] 7.1 `frontend/AGENTS.md` „Beenden: Verb, Ort und Sicherung je Art“: LLH-1924-Lücken streichen, Rücknahme des Austritts und den Schalter `nur_wenn_frei` an allen Rückwegen nennen. Nachweis: Diff, Prettier grün
- [ ] 7.2 Anwenderdoku (`fahrzeuge.md`, `geraet-uhs.md`, `bereitstellungsraeume.md`, Personen/UHS) nach `docs/anwender/AGENTS.md`, Bilder über den Bildlauf, wo sich eine abgebildete Stelle ändert. Nachweis: Doku-Wächter grün
- [ ] 7.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün. Nachweis: Lauf im PR unter „Geprüft“

## Workflow follow-up

- Review vor dem PR (Prüfliste, Gegenprüfung), dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
