# Tasks

## 1. Server: Such-Kern und Kurzadresse

- [x] 1.1 `src/geocoding/suche.rs`: Anfrage mit `addressdetails=1`, `OrtTreffer.kurz` aus den Adressteilen („Straße Nr, PLZ Ort“, fehlende Teile ohne Trennzeichen); Unit-Tests für volle Adresse, nur Ort, ohne Teile und den Parameter am Stub, zuerst rot
- [x] 1.2 Gemeinsamen Kern aus `src/routes/karte_ort_suche.rs` nach `src/routes/ort_suche.rs` ziehen (`pruefe_suchtext`, DTOs, `antwort_aus`, `kurz` mit `skip_serializing_if`); bestehende Unit-Tests wandern mit und bleiben grün, `tests/karte_ort_suche.rs` grün
- [x] 1.3 `scripts/check-typ-codegen.sh`: `openapi.json` und `frontend/src/api/types.generated.ts` neu, beide mitcommitten

## 2. Server: neue Einstiege

- [x] 2.1 `GET /api/einsaetze/{id}/ort-suche` mit `EinsatzVerwaltungszugriff`, Umgebung = Einsatzort, `PFAD_KEY` ohne Modul; Integrationstests in `tests/ort_suche.rs`: Führungspersonal ohne Lagekarte 200 mit Treffern und `viewbox`, Beobachter 403, fremde Org 403, Suchtext zu kurz 400, Geocoder geschlossen → `nicht_erreichbar` mit 200 (Stub nicht gefragt, wo verlangt); `tests/einsatz_kontext_guard.rs` grün
- [x] 2.2 `GET /api/ort-suche` mit `darf_einsatz_anlegen()`, Geocoder der Org des Benutzers, ohne `viewbox`; Integrationstests: Führungskraft 200, Helfer 403 ohne Geocoder-Anfrage, zwei Orgs mit verschiedenen Geocodern → Anfrage am Stub der eigenen Org, 400 bei zu kurzem Text
- [x] 2.3 Schema-Pfade der DTOs in `src/api_doc.rs` und `tests/enum_wire_kontrakt.rs` auf `routes::ort_suche` (das OpenAPI-Dokument führt keine Pfade); Codegen erneut prüfen

## 3. Server: Einsatzort beim Anlegen, Prüfung der Koordinate

- [x] 3.1 Prüfhelfer für die Koordinate in `src/routes/einsatz.rs` (Bereich 400, Paar 422); Integrationstests am PATCH: lat 91 → 400, nur lon → 422, Wert neben `null` → 422, Paar `null` leert; zuerst rot
- [x] 3.2 `NeuerEinsatz` und `repo::NeuerEinsatzDaten` um `einsatzort`, `einsatzort_lat`, `einsatzort_lon` erweitern, dieselbe Prüfung; Integrationstests: Anlegen mit Treffer speichert alle drei, mit Freitext nur die Adresse, ohne Feld nichts, lat 91 → 400

## 4. Frontend: API und Bausteine

- [x] 4.1 `api/ortSuche.ts` (`sucheOrtImEinsatz`, `sucheOrtInOrg`), Query-Keys `einsatzKeys.einsatzortSuche` und `globalKeys.orgOrtSuche` in `api/queryKeys.ts` als nicht live und nicht offline eingeordnet; `api/einsaetze.ts` `NeuerEinsatz` um den Einsatzort; Guard-Tests der Query-Keys grün
- [x] 4.2 `anzeige/Ortsfeld.tsx` mit Vitest (MSW): Tippen fragt nicht, Enter sucht ohne Formular-Submit, „Ort suchen“ sucht, < 3 Zeichen fragt nicht, Treffer setzt Text = Kurzadresse und Koordinate, Textänderung verwirft Koordinate und Treffer, Zustände „ausgelastet“/„nicht erreichbar“ mit „Erneut suchen“, „Keine Adresse zu …“, offline gesperrt mit Wortlaut; jeder Test zuerst rot
- [x] 4.3 `anzeige/Kartenausschnitt.tsx` nach dem Muster der Lagemonitor-Karte; Vitest mit gemocktem `maplibre-gl`: ohne Punkt „Nicht verortet“ und keine Karte, mit Punkt eine Karte und eine Nadel mit `aria-label`

## 5. Frontend: Einsatzdaten

- [x] 5.1 Paneel „Einsatzort“ (`EinsatzortPaneel`) mit Zeile „Adresse“ (`InlineAngabe<OrtsfeldWert>`, `sucheOrtImEinsatz`) und Zeile „Koordinate“ (`InlineAngabe` mit `KoordinatenEingabe`); Kopfleiste zeigt den Einsatzort ohne Aufforderung, „Koordinate“ verlässt „Lagedaten“; Vitest: Treffer → genau ein PATCH mit drei Feldern, nur Text → `{ einsatzort }`, Koordinate MGRS → Paar, Koordinate leeren → Paar `null`, Beobachter ohne Aufforderung und ohne Suche, Kopfleiste ohne „Einsatzort bearbeiten“; bestehende Zeilentests angepasst und grün
- [x] 5.2 Kartenausschnitt und `OrtZeile` im Paneel, Sprung „Auf Lagekarte zeigen ↗“ nur bei Koordinate und Lagekarten-Recht; Vitest für beide Fälle

## 6. Frontend: Einsatz anlegen

- [x] 6.1 Fünftes Feld „Einsatzort“ im `ErfassungsModal` von `EinsaetzePage` (Ortsfeld mit `sucheOrtInOrg`, Ausschnitt 120 px nach der Wahl), Kommentar zur Feldobergrenze fortgeschrieben; Vitest: Anlegen mit Treffer sendet drei Felder, mit Freitext nur `einsatzort`, leer keines

## 7. Regeln, e2e, Doku

- [x] 7.1 `frontend/AGENTS.md`, „Inline-Bearbeitung und Status“: Einsatzort und Koordinate als Zeilen im Paneel „Einsatzort“, Bezeichnung weiter nur im Vollformular; Hinweis auf `anzeige/Ortsfeld.tsx` (Suche auf Enter/Knopf, Spec `ortsfeld`); Prettier grün
- [x] 7.2 e2e `e2e/einsatzort-ortssuche.spec.ts`: Einsatzdaten → Einsatzort suchen (Geocoder per `page.route` gemockt), Treffer wählen, speichern, Ausschnitt mit Nadel sichtbar, Kopfleiste zeigt die Kurzadresse; Anlegen mit Treffer; Handy 390 px ohne Überlauf
- [x] 7.3 `docs/anwender/kapitel/einsatzdaten.md` (Paneel Einsatzort, Suche auf Enter/Knopf, Freitext, Koordinate von Hand, ohne Netz) und `einsatz-oberflaeche.md` (Feld beim Anlegen); Bilder nach `docs/anwender/AGENTS.md` nachgezogen; Doku-Wächter grün

## 8. Review (Phase 4)

- [x] 8.0 Befunde aus dem Review umgesetzt: `einsatz::EINSATZORT_MAX` (500) samt Spiegel, Bereich (400) vor Paar (422) auch im PATCH, Rechte-Test Admin eigene/fremde Org und abgeschlossener Einsatz; Ortsfeld gibt den Fokus nach der Wahl ins Feld, Escape schließt die Liste zuerst, „Ort suchen“ gesperrt ohne suchbaren Text; Sprung zur Lagekarte mit Steuerhöhe; `Form.useWatch` im Formular; 390 px auch als Führungspersonal und mit Koordinaten-Zeile; Feldbudget-Ausnahme in `frontend/AGENTS.md`

## 9. Nachweis

- [ ] 9.1 Gates: `cargo test` der berührten Tests, tsc, Lint, Prettier, Vitest komplett, `scripts/check-all.sh --nur schnell`, e2e `einsatzort-ortssuche.spec.ts`, `einsatzdaten-inline.spec.ts`, `einsatzdaten-schmal.spec.ts`, `lagekarte-ortssuche.spec.ts`

## Workflow follow-up

- `/opsx:archive lfh-1175-einsatzort-ortssuche` im selben Branch vor dem PR (Spec-Sync: neue Spec `ortsfeld`, Deltas `einsatzdaten-bearbeitung`, `lagekarte-ortssuche`).
- Folgeticket „Eigener Geocoder“ (Photon o. ä., Adapter, Takt je Geocoder, Vorschläge beim Tippen) anlegen; LFH-1248 auf den Rest zuschneiden (Nadel ziehen, Karte groß, `ohneSuche`, Regel).
