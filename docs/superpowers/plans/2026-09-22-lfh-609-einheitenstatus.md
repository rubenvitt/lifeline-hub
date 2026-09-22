# LFH-609 Einheitenstatus (FMS) mit „Seit“: Umsetzungsplan

> **Für agentische Ausführende:** PFLICHT-SUB-SKILL: superpowers:executing-plans (inline). Die Schritte stehen als Checkboxen (`- [ ]`).

**Ziel:** Jede Einheit erhält einen Status mit „Seit“-Zeitstempel. Ist ihr ein Fahrzeug zugeordnet, wird der Status aus den Fahrzeugen abgeleitet, sonst wird er von Hand gesetzt. Das Fahrzeug erhält `status_seit`. Meldebild (Zeile, Kacheln), Lagekarte „Ausgewählt“ und Überblick-Raster zeigen den Status.

**Architektur:** Die Ableitung passiert serverseitig in `einheit::repo` als reine Funktion über die Fahrzeugmitglieder, damit alle Konsumenten eine gemeinsame Wahrheit lesen und der Status nicht mit Filtern im Frontend wechselt. Der Handstatus liegt als eigene Spalte an `einsatz_einheit` und wird über einen eigenen Endpunkt gesetzt, mit ETB-Systemeintrag. Er ist nur zulässig, solange die Einheit kein Fahrzeug hat (422). Das `fahrzeug`-Live-Ereignis invalidiert zusätzlich die Einheiten.

**Tech Stack:** Rust/axum/sqlx (SQLite), utoipa-Codegen → `types.generated.ts`, React/antd, Vitest, Playwright.

**Spec:** Die Entscheidungen des Auftraggebers vom 22.09.2026 (ClickUp LFH-609, Gespräch):
1. Der Status der Einheit ist **aus den Fahrzeugen abgeleitet**. Haben alle Fahrzeuge denselben Status, gilt er, „Seit“ ist der jüngste Wechsel in diesen Status. Sonst gilt **„gemischt“** mit Verteilung und ohne „Seit“.
2. Eine Einheit **ohne Fahrzeug** bekommt einen **Handstatus als Rückfall**.
3. UI-Umfang: Zeile und Karte, **zusätzlich die Kacheln** (Einheiten je Status wie Entwurf S6) und das **Überblick-Raster** (bereit/gebunden/Ausfall aus dem Einheitenstatus).
4. Das FMS-Tableau ist ein eigener Task (LFH-642) und nicht Teil dieses Plans.

## Globale Randbedingungen

- Keine erfundenen Daten: Ein unbekannter Zeitpunkt bleibt `null` und wird als „—“ angezeigt. Bestandszeilen werden **nicht** nachgefüllt.
- Statuscodes nach `src/error.rs`: unbekannter Status → **400** (`Validation`), Handstatus an einer Einheit mit Fahrzeug → **422** (`UnprocessableEntity`).
- Handler lesen den Body über `crate::extract::JsonBody` und Pfade über `PfadParam`.
- Jede neue Spalte einer einsatzbezogenen Tabelle steht in `src/einsatz/schwaerzung_registry.rs`.
- Ein neues Enum steht in `src/api_doc.rs` **und** in `tests/enum_wire_kontrakt.rs`.
- `Option<T>`-Felder neuer Response-DTOs tragen `#[serde(skip_serializing_if = "Option::is_none")]`.
- Der Ton kommt nur aus der Statuskategorie (`statusKategorie`), `S<fms_anker>` ist reine Beschriftung (Kopfkommentar `meldebildRaster.ts`).
- Kein neues `size="small"` an interaktiven Elementen. Keine Hex-Literale außerhalb von `theme/`.
- Zeiten sind UTC ohne Zonenkennung (`datetime('now')`) und werden über den vorhandenen Zeitformatierer angezeigt.
- Gates: `./scripts/check-all.sh`. Nach der DTO-Änderung `scripts/check-typ-codegen.sh` ausführen und die generierten Dateien mitcommitten.

---

### Task 1: `status_seit` am Fahrzeug

**Dateien:**
- Anlegen: `migrations/0108_status_seit.sql` (inklusive der Einheitenspalten aus Task 2, damit es EINE Migration ist)
- Ändern: `src/fahrzeug/disposition_repo.rs` (SELECT, Row, `zu_anzeige`, beide INSERTs, `aktualisiere_tx`), `src/fahrzeug/mod.rs` (`EinsatzFahrzeugAnzeige.status_seit`), `src/einsatz/schwaerzung_registry.rs`
- Test: `tests/einsatz_fahrzeug.rs`

Migration:
```sql
-- LFH-609: Zeitpunkt des letzten Statuswechsels („Seit“) für Fahrzeug und Einheit,
-- dazu der Handstatus einer Einheit ohne Fahrzeug. Bestandszeilen bleiben NULL: den
-- Zeitpunkt früherer Wechsel kennt niemand, und ein Nachfüllen aus disponiert_at wäre
-- ein erfundener Wert.
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_seit TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN status_id INTEGER REFERENCES fahrzeug_status(id);
ALTER TABLE einsatz_einheit ADD COLUMN status_seit TEXT;
```

`aktualisiere_tx`: `status_seit = CASE WHEN ?1 IS NOT NULL AND ?1 IS NOT status_id THEN datetime('now') ELSE status_seit END` **vor** der Zeile `status_id = COALESCE(...)`. SQLite liest in SET die alten Werte, deshalb ist die Reihenfolge egal. Die Zeile steht trotzdem zuerst, damit sie sich so liest, wie sie wirkt. Die beiden INSERTs setzen `status_seit = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END`.

- [ ] Test: Nach dem Disponieren ist `status_seit` gesetzt. Nach einem Statuswechsel ist es ≥ dem alten Wert und die Spalte ist geschrieben. Ein PATCH nur mit Bemerkung lässt `status_seit` unverändert, ebenso ein PATCH mit **gleichem** Status. Für den Vergleich wird der Wert per SQL auf einen alten Zeitpunkt gesetzt und danach geprüft, ob er bleibt oder springt.
- [ ] Test rot sehen, implementieren, grün. Registry: `retain("status_seit", G_ZEIT)` an `einsatz_fahrzeug`, `retain("status_id", G_FK)` und `retain("status_seit", G_ZEIT)` an `einsatz_einheit`.
- [ ] Commit `feat(fahrzeug): status_seit je Disposition (LFH-609)`.

### Task 2: Handstatus der Einheit (Endpunkt)

**Dateien:**
- Ändern: `src/einheit/repo.rs` (neue Funktion `setze_status_tx`), `src/routes/einsatz_einheit.rs` (Handler `status_setzen`), `src/app.rs` (Route `PUT /api/einsaetze/{id}/einheiten/{eid}/status`)
- Test: `tests/einsatz_einheit.rs`

Body `{ "status_id": i64 | null }`. `null` löscht den Handstatus. Das Feld ist Pflicht, ein fehlendes Feld ist 400 (Extractor). Ablauf: Schreibrecht-Gate wie bei `fahrzeug_zuordnen` (`schreib_gate`), Status in der Org sonst 400 „Unbekannter Status“, die Einheit hat ≥ 1 Fahrzeug → 422 „Die Einheit führt ihren Status über ihre Fahrzeuge“. In EINER Tx: UPDATE `status_id`, `status_seit` (nur bei echtem Wechsel `datetime('now')`, bei `null` ebenfalls NULL), und bei einem Wechsel der System-ETB `Einheit «X»: Status «alt» → «neu»` („—“ für leer). Danach `sse_einheit`. Antwort: 200 mit `EinheitAnzeige`.

- [ ] Tests: setzen → 200, `status.quelle == "hand"`, `status_seit` gesetzt, ein ETB mehr; gleicher Status erneut → kein weiterer ETB; unbekannte id → 400; Einheit mit Fahrzeug → 422; Beobachter → 403; `null` → Status weg.
- [ ] Rot, implementieren, grün. Commit `feat(einheit): Handstatus für Einheiten ohne Fahrzeug (LFH-609)`.

### Task 3: Abgeleiteter Einheitenstatus im DTO

**Dateien:**
- Ändern: `src/einheit/mod.rs` (Typen), `src/einheit/mitglied_repo.rs` (`fahrzeug_mitglieder_map` mit Status-Join), `src/einheit/repo.rs` (Row-Spalten `status_id`, `status_seit` samt Join, reine Funktion `leite_status_ab`, `zu_anzeige_batch`), `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`, `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`, `frontend/src/api/types.ts` (Re-Export)
- Test: Unit-Tests in `src/einheit/repo.rs`, Integration in `tests/einsatz_einheit.rs`

Typen:
```rust
/// Woher der Status einer Einheit kommt (LFH-609).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EinheitStatusQuelle { Fahrzeuge, Gemischt, Hand, Ohne }

/// Ein Status (Katalogeintrag) — wie am Fahrzeug aufgelöst.
pub struct StatusWert { status_id: i64, label: String, kategorie: StatusKategorie, farbe: Option<String>, fms_anker: Option<i64> }

/// Anteil eines Status an einer gemischten Einheit; `status: None` = Fahrzeuge ohne Status.
pub struct StatusAnteil { status: Option<StatusWert>, anzahl: u32 }

pub struct EinheitStatus {
    quelle: EinheitStatusQuelle,
    status: Option<StatusWert>,          // Fahrzeuge|Hand
    kategorie: Option<StatusKategorie>,  // einheitlich, auch bei „gemischt“ mit gleicher Kategorie
    seit: Option<String>,                // nur Fahrzeuge (max, alle bekannt)|Hand
    verteilung: Vec<StatusAnteil>,       // nur Gemischt, nach Katalog-sortier
}
```
`EinheitMitgliedFahrzeug` erhält `status: Option<StatusWert>` und `status_seit: Option<String>`.

Regel `leite_status_ab(fahrzeuge, hand, hand_seit)`:
- keine Fahrzeuge → `Hand` mit Status, wenn gesetzt, sonst `Ohne`;
- alle Fahrzeuge mit demselben `status_id` (nicht null) → `Fahrzeuge`, `seit` = Maximum, aber `None`, sobald ein `status_seit` fehlt;
- alle Fahrzeuge ohne Status → `Ohne`;
- sonst `Gemischt` mit Verteilung, `kategorie` nur, wenn alle Fahrzeuge einen Status mit derselben Kategorie haben.
Ein gesetzter Handstatus an einer Einheit mit Fahrzeug wird **nicht** angezeigt. Er bleibt gespeichert und gilt wieder, wenn die Fahrzeuge die Einheit verlassen, mit seinem damaligen „Seit“.

- [ ] Unit-Tests für alle fünf Fälle plus „ein `seit` fehlt → `None`“ und „gemischt, gleiche Kategorie → kategorie gesetzt“.
- [ ] Integration: Einheit + zwei Fahrzeuge, beide zugeordnet (Initialstatus gleich) → `fahrzeuge`; eines auf einen anderen Status → `gemischt`, Verteilung 1/1.
- [ ] `check-typ-codegen.sh`, Codegen committen. Commit `feat(einheit): abgeleiteter Status mit Seit im DTO (LFH-609)`.

### Task 4: Live-Ereignis und Invalidierung

**Dateien:** `frontend/src/api/queryKeys.ts` (`fahrzeug: [fahrzeuge, einheiten]`), der Bestandstest der Stream-Map (mit `grep -rl EINSATZ_STREAM_EVENTS frontend/src` finden), sowie die Fahrzeug-Status-Mutationen im Frontend (Invalidierung von `einsatzKeys.einheiten`, wo sie nur `fahrzeuge` invalidieren).

- [ ] Test auf die Map zuerst (`fahrzeug` enthält `einsatz-einheiten`), rot, dann ändern. Commit.

### Task 5: Meldebild: Zeile, „Seit“, Kacheln, Handstatus

**Dateien:** `frontend/src/kraefte/meldebildRaster.ts` (+Test), `frontend/src/pages/KraefteuebersichtPage.tsx` (+Test), `frontend/src/kraefte/Statusband.tsx`

- `RasterZeile` erhält `einheitStatus: EinheitStatusAnzeige | null` und `seit: string | null`. Die reine Funktion `einheitStatusAnzeige(s: EinheitStatus, katalog)` liefert `{ ton, code, wort, gemischt: Array<{code, wort, anzahl}> | null, hand: boolean }`. „gemischt“ zeigt das Wort „gemischt“ und die Verteilung als Text („2× S4 · 1× S3“), Ton aus `kategorie`, sonst neutral.
- Neue Spalte **„Seit“** nach „Status“ (Mono, formatiert mit dem Zeitformatierer der Seite).
- Die Statuszelle einer Einheitenzeile zeigt den Einheitenstatus. Die bisherige Mittelverteilung bleibt als Nebentext. Einheiten ohne Fahrzeug tragen mit Schreibrecht eine `StatusWahl` über den FMS-Katalog, die `PUT …/status` aufruft. Ohne Schreibrecht erscheint ein reines Etikett.
- `einheitBand(einheiten, katalog)` ersetzt `fahrzeugBand` im Statusband: Einheiten je Status (Handstatus und Fahrzeugstatus zählen gleich), dazu je eine Zelle „gemischt“ und „ohne Status“, wenn belegt. `personalBand` bleibt als zweite Reihe. `fahrzeugBand` fällt weg, wenn es keinen anderen Verwender hat.
- Der Kopfkommentar „WEGGELASSEN … LFH-609“ wird fortgeschrieben.
- [ ] Tests: Ableitung (alle Quellen), Band zählt je Einheit, keine Kraft verschwindet; Seite: Handstatus-Auslöser nur bei Einheiten ohne Fahrzeug und mit Schreibrecht, „Seit“-Spalte vorhanden.

### Task 6: Lagekarte „Ausgewählt“

**Dateien:** `frontend/src/pages/lagekarte/leistenDaten.ts` (+Test), `Inspector.test.tsx`

- Einheit: `Status` (Code · Wort bzw. „gemischt“, Rolle aus der Kategorie) und `Seit` (`zeit(seit)` oder „—“). Fahrzeug: zusätzlich `Seit` aus `status_seit`. Die Bestandstests „KEIN Status/Seit (LFH-609)“ werden in positive Aussagen umgeschrieben.

### Task 7: Überblick-Raster aus dem Einheitenstatus

**Dateien:** `frontend/src/pages/fuehrung/ueberblickDaten.ts` (+Test), `UeberblickPage.tsx` (Beschriftung/Kommentar)

- `mittel` zählt je Abschnitt (kumuliert über den Teilbaum, wie `einheiten`) die **Einheiten** nach `status.kategorie`: verfuegbar → bereit, gebunden → gebunden, nicht_verfuegbar → Ausfall, keine Kategorie → `ohne`. Die Beschriftung der Seite ändert sich von „Mittel“ auf „Einheiten“.

### Task 8: Doku, Prüfliste, Gates

- `docs/design/2026-09-21-neuentwurf/umsetzung.md`: „FMS-Status/„Seit“ je Einheit“ aus der Lückenliste nehmen und die Entscheidung kurz festhalten.
- Die Prüfliste Einsatztauglichkeit für das Meldebild wird fortgeschrieben (Datei per `grep -rl "Prüfliste" docs/superpowers/specs | grep -i meldebild` finden; gibt es keine, gehört eine kurze Liste in den PR).
- `./scripts/check-all.sh` grün.
