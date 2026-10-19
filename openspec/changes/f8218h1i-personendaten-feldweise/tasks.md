## 1. Grenzen für Personen-Freitexte — LLH-1329 (jr8h0lyy), Backend

- [x] 1.1 Konstanten `PERSON_NAME_MAX`, `PERSON_ANGABE_MAX`, `PERSON_ZUSTAND_MAX`, `PERSON_NOTIZ_MAX`, `VERLAUFSNOTIZ_MAX` in `src/person/mod.rs` (D7), gespiegelt in `frontend/src/api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`.
- [x] 1.2 Prüfung im Anlegen (`AnlegenBody`), im PATCH (nur genannte Felder) und im Notiz-POST mit der Meldung „{Feld} darf höchstens {max} Zeichen lang sein“. Servertests je Feld: an der Grenze angenommen, ein Zeichen mehr 400, Person unverändert; PATCH eines anderen Felds bei Altbestand über der Grenze geht durch.
- [x] 1.3 Zähler (`zeichenGrenze`) an Aufnahme (`personen/AufnahmeFelder.tsx`), Schnellerfassung, Notizzeile im Kopf und „Zustand / Verdacht“; nie kürzen. Vitest je Maske.

## 2. Feld-CAS und Geburtsdatum am Server — LLH-1103 (f8218h1i), Backend

- [x] 2.1 `PatchBody.erwartet` (optional, gleiche Feldnamen, Tri-State-Werte), `repo::aktualisiere` hängt je Feld `AND <spalte> IS ?` an (Koordinate als Paar); 409 bei vorhandener Person, 404 sonst; `erwartet`-Feld ohne Änderung desselben Felds 400. `basis_geaendert_at` bleibt unverändert nutzbar.
- [x] 2.2 Tests (`tests/einsatz_person.rs`): gleicher Altwert schreibt; fremd geänderter Wert 409 und nichts geschrieben; Sichtung, Status, PAT-Nummer und ein anderes Feld zwischendurch lösen keinen 409 aus; leerer Altwert (`null`) gegen gesetzten Wert 409; Koordinate als Paar; ohne `erwartet` wie bisher; Bind-Reihenfolge-Test erweitert.
- [x] 2.3 Geburtsdatum im PATCH: `YYYY-MM-DD`, gültiger Kalendertag, nicht in der Zukunft (D6), sonst 400; Leeren erlaubt. Tests.
- [x] 2.4 Typ-Codegen (`scripts/check-typ-codegen.sh`), falls der Request-Typ im OpenAPI erscheint; `src/AGENTS.md` (CAS-Baseline: Personen nutzen Feld-CAS, `useEditSitzung` nur noch Tier und Schaden).

## 3. Bausteine — LLH-1103 (f8218h1i), Frontend

- [x] 3.1 `anzeige/kalenderdatum.ts`: `parseKalenderdatum`, `formatKalenderdatum` (D6). Vitest: alle Schreibweisen, zweistelliges Jahr an der Jahrhundertgrenze, 29.02., Zukunft, Unsinn, Rohanzeige alter Werte, Zone ohne Einfluss.
- [x] 3.2 `components/InlineAngabe.tsx`: `pruefe` (Meldung mit `FeldFehler` aus LLH-1101, `aria-describedby`, Senden gesperrt), `gesperrt` (Grund sichtbar, Auslöser nicht bedienbar), `onEntwurf`, Knopfabstand. Vitest; bestehende Nutzer und ihre Tests unverändert grün.
- [x] 3.3 `components/offeneBearbeitung` (D4): Kontext für eine offene, geänderte Bearbeitung je Seite, speist `useFormularVerlassenSchutz`/`VerlassenRueckfrage`, liefert anderen Feldern den Sperrgrund. Vitest mit `renderMitProviders(…, { datenRouter: true })`: Rückfrage bei Entwurf, keine ohne Änderung, „Bleiben“ behält, „Verwerfen“ wechselt.

## 4. Personendaten feldweise — LLH-1103 (f8218h1i), Frontend

- [ ] 4.1 `api/einsatzPerson.ts`: `savePersonFeld(einsatzId, personId, feld, wert, erwartet)` (ein Feld, Feld-CAS); `aktualisierePerson` bleibt für Kopf und andere Aufrufer.
- [ ] 4.2 Abschnitt „Personendaten“ (`personen/Personendaten.tsx` oder Schreibzweig in `StammdatenRaster`): jede Angabe als `InlineAngabe` (Name, Vorname, Geschlecht, Geburtsdatum, Alter 0–120, Herkunft, Fundort, Koordinate mit Verorten-Link, vermisst seit bei Vermissten, Melder, Notiz) mit Grenzen und Zähler; Erfolg „{Feld} gespeichert“; Ablehnung am Feld; 409 → Rückfrage mit aktuellem Wert (D2).
- [ ] 4.3 Zeile „Ohne Angabe“ als Knöpfe „+ Etikett“ mit Schreibrecht (D5), Satz ohne Schreibrecht; Fokus beim Öffnen und nach dem Speichern (`useFokusRueckgabe`).
- [ ] 4.4 Ohne Netz alles gesperrt mit einem Grund (D8), auch „Zustand / Verdacht“ im Kopf (`personen/personenSpalten.tsx`, `ZustandSchreiben`).
- [ ] 4.5 `pages/PersonenDetailPage.tsx`: Primäraktion „Bearbeiten“, Sammelformular, `useEditSitzung` und der alte Konfliktdialog entfallen; `personen/personBearbeiten.ts` bis auf `verortenLinkStil` gelöscht. Geburtsdatum als „TT.MM.JJJJ“ in `personenSpalten`, `PersonVorschau`, `PersonDruckBlatt`.
- [ ] 4.6 Tests umschreiben: `PersonenDetailPage.test.tsx` (Kopfleiste, Stammdaten, CAS, „Ohne Angabe“, Koordinate LFH-613), `.speicherfehler.test.tsx`, `personBearbeiten.test.ts`, `geraet/GeraeteHuelle.test.tsx`, `geraet/GeraetBetreuungsstelle.test.tsx`. Neue Fälle: ein PATCH je Feld mit nur diesem Feld, 409-Rückfrage mit Überschreiben und Verwerfen, Prüffehler am Feld (Alter, Datum, Koordinate, Länge), Rückfrage beim Verlassen, Sperre ohne Netz, Beobachter ohne Knöpfe, Vermisste.

## 5. Regeln, Doku, Nachweise

- [ ] 5.1 Regeln: `frontend/AGENTS.md` („Inline-Bearbeitung und Status“: Personendaten nur feldweise; „Zeiteingabe in der Anzeigezone“: Ausnahme Kalenderdatum; „Formularseiten“: Verlassen-Schutz für ein offenes Einzelfeld über den Merker; `InlineAngabe`-Erweiterung in der Bausteinliste), `frontend/src/personen/AGENTS.md` („Personen-Detail“, leere Angaben als Knöpfe), `frontend/src/offline/AGENTS.md` (Personendaten ohne Netz gesperrt). Prettier grün.
- [ ] 5.2 Anwenderdoku: `betroffene.md` neuer Ablauf „Personendaten ergänzen und berichtigen“, „Den Fundort verorten“, „Ohne Netz“, „Rechte“; `ohne-netz.md`. Bild der Personendaten in `e2e/doku-bilder/betroffene.bilder.ts`, falls ein Bild den Ablauf trägt; Doku-Wächter grün.
- [ ] 5.3 e2e: `personen-detail.spec.ts` (leeres Feld ergänzen, Wert ändern, Rückfrage beim Verlassen), `betroffene-handy.spec.ts` (Struktur der Personendaten), `gate3-trefflaeche.spec.ts` (Knöpfe „+ …“ und Wertknöpfe in 30/48/72). `tsc` und `eslint` über `frontend/e2e` grün.
- [ ] 5.4 Gate-Bündel `schnell` und `frontend` von `scripts/check-all.sh` grün, Rust gezielt für `einsatz_person`, `person_verlauf`, `eingabegrenzen_spiegel`, `geraet_kopplung` und `--lib`.
