# Tasks

Zunder: LLH-1814 (https://zunder.rubeen.dev/#/aufgabe/sa41jgmjprnbu20m6btunaz4). Jede Aufgabe
per TDD: erst der rote Test, dann der Code.

## 1. Abschluss im ETB (D3)

- [x] 1.1 `tests/einsatz_abschluss.rs`: Abschluss schreibt genau einen System-Eintrag „Einsatz abgeschlossen“ mit der abschließenden Person als Erfasser, ein zweiter Aufruf am abgeschlossenen Einsatz keinen; Test rot, dann grün
- [x] 1.2 `repo::abschliessen` schreibt den Eintrag als ersten nach dem `UPDATE` (nur bei `rows_affected == 1`) und gibt die Kennung in `etb_eintrag_ids` mit; bestehende Tests, die ETB-Einträge nach dem Abschluss zählen, nachziehen und `cargo test` für die betroffenen Dateien grün

## 2. Prüfung offener Punkte (D1)

- [x] 2.1 Response-DTO `AbschlussPruefung` (Gruppen `kraefte`, `auftraege`, `meldungen`, `nachforderungen`, `betroffene` mit `anzahl` und Kurzliste ≤ 5) und Repo-Funktion, die die „offen“-Regeln aus `einsatz/zaehler.rs` wiederverwendet (gemeinsame Funktion bzw. Prädikat, kein zweiter Wortlaut); Unit-Test der Kurzliste und Grenzen
- [x] 2.2 Route `GET /api/einsaetze/{id}/abschluss/pruefung` mit `EinsatzLeitungszugriff`, in `src/app.rs` und `src/api_doc.rs`; Integrationstest: Einheit „3 – Auf Anfahrt“ und Betroffene ohne Verbleib erscheinen, entlassene Einheit nicht, Zählung trotz ausgeblendetem Modul, Führungspersonal/Beobachter 403, abgeschlossener Einsatz 409
- [x] 2.3 `scripts/check-typ-codegen.sh` laufen lassen, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten; Gate grün

## 3. Wiederöffnen im Backend (D4, D5)

- [x] 3.1 Bestehende Sperren bestimmen und als Prädikat fassen: Spalten/Tabellen für Löschvormerkung (`geloescht_at`), Schwärzung (Einsatz, Kategorie), offenen Schwärzungsantrag, Archiv, Verwahrung, Abräumen; Unit-Test je Sperre (422)
- [x] 3.2 Gate `EinsatzWiedereroeffnungszugriff` in `einsatz/kontext.rs` (Org-Floor → kein Gerät → Einsatzleitung oder Admin der Einsatz-Org → Lese-Policy, ohne `fordere_aktiv`), in `SANKTIONIERTE_GATES` eintragen; `tests/einsatz_kontext_guard.rs` und `scripts/adr-fuer.sh`-Regeln (ADR-0005) grün
- [x] 3.3 `repo::wiedereroeffnen` mit Grund: Spiegel 409, nicht abgeschlossen 422, älter als `NACHLAUF_STUNDEN` 422, Sperren 422, CAS-`UPDATE` (0 Zeilen 409), Rücknahme nach D5 vor dem `UPDATE`, ETB-Eintrag mit Grund, Abschlusszeitpunkt und abschließender Person; Integrationstests für jeden Fall, Einsatzleitung nach 2 h ok, 25 h → 422, Admin der Org ohne Rolle ok, Führungspersonal/Beobachter/Führungskraft/fremder Admin/Gerät 403, Grund fehlt/leer 400
- [x] 3.4 Rücknahme-Tests in `tests/aufbewahrung.rs`: automatische Frist zurückgenommen (mit ETB), manuelle Frist bleibt, automatische Kategorie-Fristen samt Vormerkung gelöscht, manuelle Kategorie-Frist bleibt, `nachbereitung_bis` zurückgenommen, erneuter Abschluss setzt alle Fristen ab dem neuen Zeitpunkt; Kopplung und API-Freigabe bleiben beendet
- [x] 3.5 Route `POST /api/einsaetze/{id}/wiedereroeffnen` (Body `{grund}` über `JsonBody`, Längengrenze wie ETB-Inhalt), Live-Meldungen (`kopf_geaendert`, ETB), `src/app.rs`, `src/api_doc.rs`, Typ-Codegen erneut; Test: nach dem Wiederöffnen ist ein ETB-Eintrag wieder möglich
- [x] 3.6 Spiegel: Test, dass ein beim Führer wieder geöffneter Einsatz über den Spiegel-Log beim Gegenüber wieder `aktiv` ist (Muster der Spiegel-Tests unter `tests/`); schlägt das fehl, verweigert `wiedereroeffnen` bei laufendem Spiegel mit 409 und der Test belegt die Verweigerung
- [x] 3.7 `EinsatzAnzeige` um `abgeschlossen_von_name` (Anzeigename der abschließenden Person, `null` am aktiven Einsatz und bei Gerätesitzungen wie die übrigen Personenfelder); Test in `tests/einsatz_abschluss.rs`, Typ-Codegen und `tests/enum_wire_kontrakt.rs` falls betroffen
- [x] 3.8 Regel in `src/AGENTS.md` nur, falls 3.2 eine neue Gate-Familie einführt, die dort aufgezählt ist (sonst nichts); `scripts/adr-fuer.sh src/einsatz/kontext.rs` geprüft

## 4. Oberfläche (D2, D6)

- [x] 4.1 `api/einsaetze.ts`: `ladeAbschlussPruefung`, `oeffneEinsatzWieder`; Query-Key in `einsatzKeys` (Regel Query-Keys `frontend/AGENTS.md`); Vitest für die Aufrufe
- [x] 4.2 `einsatz/schreibrecht.ts`: `darfEinsatzWiedereroeffnen(einsatz, jetzt)` samt Konstante der 24 Stunden; Vitest für Einsatzleitung, Admin der Org, fremder Admin, Führungspersonal, Spiegel, Fristgrenze
- [x] 4.3 `pages/einsatzdaten/EinsatzAbschlussDialog.tsx`: Kopf ohne Kürzung, „Noch offen“ mit Zahl und Sprung je Gruppe (Deeplink-Helfer aus `routing/deeplinks.ts`, nur sichtbare Module), „Nichts offen“, Satz zu Kräften und zu Kopplungen, Eingabefeld, roter Knopf erst bei passender Nummer oder Bezeichnung, Fehler im Dialog; Vitest: Knopf inaktiv bei falschem Text, aktiv bei Nummer in Kleinbuchstaben und bei Bezeichnung ohne Nummer, Lade- und Fehlerzustand
- [x] 4.4 `EinsatzdatenPage.tsx`: Paneel „Einsatzabschluss“ öffnet den Dialog statt `Popconfirm`; am abgeschlossenen Einsatz „Abgeschlossen am … von …“ und „Einsatz wieder öffnen…“ mit „bis …“ und Pflicht-Grund; Vitest in `EinsatzdatenPage.test.tsx` umstellen (Popconfirm-Erwartungen entfallen), Paneel fehlt für Führungspersonal/Beobachter
- [x] 4.5 Guard der roten Rückfragen (`bedien-wortlaut`, „Rote Rückfragen werden geprüft“) grün; `pnpm lint`, `tsc` und Prettier im Frontend grün
- [ ] 4.6 `frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“: Abschluss im Dialog mit Eintippen, binnen 24 h wieder zu öffnen; Prettier grün

## 5. e2e, Bilder und Anwenderdoku

- [ ] 5.1 `frontend/e2e/einsatzabschluss.spec.ts` umstellen: Dialog mit offenem Punkt, Eintippen, Abschluss, Wiederöffnen mit Grund, ETB zeigt beide Einträge; Lauf grün
- [ ] 5.2 `docs/anwender/kapitel/einsatzabschluss.md` nach `docs/anwender/AGENTS.md` (Kapitelform, `quellen:`): offene Punkte, Eintippen, gebundene Kräfte, Wiederöffnen binnen 24 h, was beendet bleibt; „keinen Weg zurück“ entfällt; `einsatzdaten.md`/`aufbewahrung.md` wo sie den Abschluss beschreiben; Wächter der Anwenderdoku grün
- [ ] 5.3 Bildlauf `frontend/e2e/doku-bilder/einsatzabschluss.bilder.ts`: Bild des Dialogs statt `abschluss-rueckfrage.png`, Bild „Einsatz wieder öffnen“; Bilder erzeugt und eingebunden

## 6. Verifikation

- [ ] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (lokaler Lauf vor dem PR; Ergebnis im PR unter „Geprüft“)

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (LLH-1811, Phase 4), dann `/opsx:archive` im selben Branch.
