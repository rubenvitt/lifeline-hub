# Backend — Regeln

Gilt für den Server (`src/`, `tests/`, `migrations/`), zusätzlich zur `AGENTS.md` der Wurzel.
Pfade ohne Präfix sind relativ zu `src/`. Fachblöcke mit Server- und Client-Anteil stehen
einmal, beim Client: ETB-Zähler und Modulzähler in `frontend/src/etb/AGENTS.md`, Betreuung und
Verpflegung in `frontend/src/betreuung/AGENTS.md`, Sitzung über mehrere Tabs (412) in
`frontend/src/auth/AGENTS.md`.

## Backend — Statuscode-Konvention (LFH-267/F22)

Verbindlich nach `src/error.rs`, in jeder Schicht, für Neues und Angefasstes:
**400** `Validation` — das Feld für sich (kaputtes JSON, falscher Typ, **unbekannter Enum-Wert**,
fehlendes oder **leeres** Pflichtfeld) · **422** `UnprocessableEntity` — der Zusammenhang
(Feld-Kombination, **Status-Übergang**, Zustand) · **409** `Conflict` — Nebenläufigkeit (CAS) oder
Lebenszyklus (storniert).
- Referenzpaare: `tests/freies_zeichen.rs`, `tests/einsatz_schaden.rs`;
  `abschliessen_ohne_grund_ist_400` gegen `abschluss_ohne_grund_ist_422_und_mit_grund_ok` nicht
  „harmonisieren".
- **409 hat zwei Quellen:** CAS (`basis_geaendert_at` in `schaden/repo.rs`, `tier/repo.rs`;
  Überschreiben-Dialog) und Lebenszyklus (kein Dialog). Das Frontend trennt nur heuristisch
  (`istKonflikt` in `frontend/src/api/client.ts`, `!v.overwrite`-Zweig in
  `SchaedenDetailPage.tsx`/`TiereDetailPage.tsx`) — ein neuer 409 in einer
  CAS-Route zieht den Zweig mit.
- **CAS-Baseline beim Öffnen einfrieren** (`components/useEditSitzung.ts`, gebrandete
  `CasBasis`; `starte` nimmt den Datensatz). Test braucht ein gemountetes `<Form form={form}>`.
- Legitimes 422 bei Sweeps nicht mitkippen (`lage_zone.rs`, `gefahr.rs`, `einsatzabschnitt.rs`,
  `sprechgruppe/repo.rs:pruefe_zuordenbar`, `auth.rs` „Code ungültig", `einsatz_uhs.rs`).
- Handler-Prechecks vor der DB bleiben (`einsatz_schaden.rs`/PATCH, `einsatz_tier.rs`/Status) —
  nur die 400-Erwartung belegt sie. Sicherheitsnetz
  `AppError::status()`: UNIQUE/FK → 409, CHECK → 422.
- **Extractor-Vertrag:** Bodies nur über `crate::extract::JsonBody`, Route-IDs nur über
  `crate::extract::PfadParam` (`tests/json_extractor_guard.rs`, `tests/path_extractor_guard.rs`,
  `tests/fehler_vertrag.rs`), damit Rejections im `{error}`-Format ankommen. `PfadParam` → 400,
  `EinsatzKontext` → 404 (`src/einsatz/kontext.rs`); beide sind orthogonal.

## Backend↔Frontend — Typ-Codegen (LFH-120)

Response-Typen werden generiert: `#[derive(ToSchema)]` → `src/api_doc.rs` →
`frontend/src/api/openapi.json` → `openapi-typescript` → `frontend/src/api/types.generated.ts`; `types.ts` ist nur Barrel.
- Nach jeder Response-DTO-/Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten
  Dateien mitcommitten.
- Enums wire-korrekt `#[serde(rename…)]`; Union-Strings `#[schema(value_type = Enum)]`
  (`Option<Enum>` bei `Option<String>`). **Enum-Wire-Kontrakt** in `tests/enum_wire_kontrakt.rs`
  (`enum_wire_as_str!`/`enum_wire!`, voll qualifizierte Pfade, bei `LiveEvent::ALLE` `contains`
  und Länge).
- **Noch handgepflegt:** Request-/Input-DTOs (`NeuerX`/`PatchX`) und drei `Record<>`-Maps
  (`OrgModulEinstellungen`, `ModulOverrides`, `ModulFreigaben` in `frontend/src/api/types.ts`).
- **Optionalität ehrlich machen** (Norm LFH-265, kein Sweep): `Option<T>` in Response-DTOs mit
  `skip_serializing_if = "Option::is_none"`; `#[serde(default)]`-Felder stattdessen
  `#[schema(required)]`. **Testfalle:** Presence per `contains_key`, nicht `== Value::Null`
  (`tests/ort_vorschau.rs`).

## Anhänge

**ETB-Anhänge (LFH-117)** (`docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md`)
- **Jeder modulgebundene Linker auf `anhang` ist EIN Eintrag in `anhang::repo::MODUL_LINKER`**;
  `LinkerStand`, `sweep_verwaiste`, `repo::loeschen`, `chat::repo::anlegen_mit_anhaengen`,
  `etb::repo::pruefe_anhaenge` (`modul_gebunden_sql`) lesen daraus; Chat ist die Ausnahme (n : m).
  Guard `jeder_fremdschluessel_auf_anhang_ist_registriert`. **Abschottungstests laufen als die
  ablegende Person** (`admin`, `common::schaden_anhang`), sonst sind sie ohne Eintrag grün.
- Kreuzsperren: ETB nimmt keine Chat-/modulgebundene Datei (422, `gebunden_meldung()`), Chat keine
  modulgebundene (400). Upload `POST …/etb/anhaenge` (Dokument-Allowlist, eine Datei je Anfrage),
  Download `GET …/etb/{eintrag_id}/anhaenge/{aid}`; Binden über `anhang_ids` in derselben
  Transaktion (`anlegen_idempotent`, `write_retry!`). **Append-only**, nur die Schwärzung löscht.
- **Heraufstufen aus dem Chat kopiert** (LFH-700): `anhang_ids` der Nachricht (explizit, leer =
  keine, ≤ 10, fremd → 400) gehen als neue `anhang`-Zeile an den Eintrag
  (`etb::repo::anhaenge_kopieren_tx`); die Chat-Datei wird nie ans ETB gebunden. Herleitung:
  `openspec/changes/archive/2026-10-01-lfh-700-heraufstufen-anhaenge/design.md`.
- Offline geht nur der Upload nicht. Während des Sendens ist die ganze Erfassung gesperrt;
  **Entwurfs-id = `client_id`**. **Replay nur bei DEMSELBEN Eintrag** (Typ, getrimmter Inhalt,
  Anhangsmenge; Route UND Transaktion), sonst 409; danach neue id (`entwurfNeuAusweisen`).
- Sendezustand gehört dem Entwurf (`EtbEntwurfsTabs`, `Versand`); Dateien in `EtbPage`
  (`useEntwurfsDateien`), ≤ 10, Dubletten prüft die Dateiwahl. Ungebundener Anhang gehört der
  hochladenden Person (sonst 404).

**Erfassungs-Anhänge (LFH-21, LFH-758)** (Specs `schaden-anhaenge`, `tier-anhaenge`,
`uhs-anhaenge`): Liste, Ablage, Soft-Delete und Download-Lookup stehen EINMAL im Kern
`anhang::erfassung`; ein Modul bringt nur einen `ErfassungsAblage`-Deskriptor (in
`ERFASSUNGS_ABLAGEN`), lädt seinen Besitzer im `write_retry!` (`BesitzerKopf`) und mappt die Zeile
auf sein DTO. Ein neues Modul braucht: Linker-Migration (Muster `0126`), Eintrag in `MODUL_LINKER`
(Guard `jede_erfassungs_ablage_steht_im_linker_register`), Schwärzungsregel `ZeileLoeschen` nach
`anhang`, Routendatei mit typisiertem Gate und `support::genau_eine_datei`, DTO samt Codegen.
**`{aid}` ist die Linker-id**; Allowlist `ERLAUBTE_MIME_ERFASSUNG` (Spiegel `ERFASSUNG_ACCEPT` in
`api/upload.ts`); `anhang::pruefe_vor_persist` vor, Anhang + Linker + ETB in EINEM
`write_retry!`. Entfernen = Soft-Delete mit roter Rückfrage; ETB nennt nie den Dateinamen;
storniert → 409 (Route und, gegen das Rennen, in der Transaktion). Tier-Anhänge ohne
Lese-Audit (wie Tiere insgesamt).
- **UHS-Lese-Audit (LFH-758):** jeder zugelassene Download einer UHS-Datei schreibt VOR der
  Antwort eine Zeile in `anhang_zugriff_audit` (`anhang::audit_repo`, auch bei 304), nach
  `original_freigeben`; scheitert sie, geht nichts hinaus. Abgewiesene Anfragen, Liste und
  Ablegen protokollieren nichts. `anhang_id` dort **ohne FK** (sonst wäre die Tabelle für den
  Linker-Guard ein Linker, und die Schwärzung nähme das Protokoll mit); `ablage` hält den Ort
  lesbar. Einsicht `GET …/uhs/{uid}/anhaenge/zugriffe` nur Einsatzleitung, selbst nicht
  protokolliert. Getrennt von `person_zugriff_audit` (LFH-757).

**Auslieferung (LFH-747)** (Spec `anhang-metadaten`, Herleitung
`openspec/changes/archive/2026-10-02-lfh-747-exif-bereinigung-auslieferung/design.md`):
gespeichert bleibt das Original (Beweismittel), **ausgeliefert wird bereinigt**.
- Jeder Anhang-Download läuft über `routes::support::anhang_antwort` mit einer `Fassung`; nur dort
  steht `anhang::repo::laden_bytes` (Guard `nur_support_liefert_anhang_bytes_aus`,
  `tests/anhang_metadaten.rs`). Ein neuer Linker liest `?fassung=` über `FassungParam` und ruft
  vor `Fassung::Original` `support::original_freigeben` (Einsatzleitung oder System-Admin der
  Einsatz-Org, sonst 403; System-ETB-Vermerk ohne Dateinamen, ohne Vermerk kein Original).
- Bereinigung in `anhang::metadaten`: Format aus den Magic Bytes, Positivlisten, fail-closed (422,
  nie das Original), Kontrollnetz nach jedem Format. Wer sie ändert, erhöht
  `BEREINIGUNG_VERSION` (steht im ETag `"<sha256>.b<n>"`).
- Testdaten mit Bild-Endung brauchen echte Bildbytes: ein `.jpg` mit Fantasie-Bytes antwortet
  beim Download mit 422.

## Backend — Org-Ereignisse (LFH-734)

Spec `org-live`; `src/live/org.rs`, `src/routes/live.rs`. Ereignisse `einsatzliste` und
`stammdaten` (`OrgLiveEvent`), Nutzlast `{}`, ohne `id:` und nie im Ring eines Einsatzes.
- **`einsatzliste` nur über `live::org::einsatzliste_melden`** nach dem Commit (Leser = org-weite
  Leser, System-Admins, Mitglieder, dazu eine gerade entfernte Person); ein Löschweg liest die
  Leser VOR dem `DELETE` (`einsatzleser_lesen`, `Einsatzleser::melden`). Jeder `einsatz`-Emitter
  läuft über `routes::einsatz::kopf_geaendert`, das beide meldet. Nie ein leeres Ereignis an die
  ganze Org für etwas Einsatzbezogenes: das ist der Metadaten-Kanal, den F01 geschlossen hat.
- **Katalog-Schreibrouten liegen unter einem Präfix aus `STAMMDATEN_PFADE`** (Middleware
  `stammdaten_live`); ein neuer Katalogpfad braucht einen Eintrag, Guard
  `tests/stammdaten_live_guard.rs`.

## Backend — Demo-Daten zur Laufzeit (LFH-690)

`src/demo/`, `src/routes/demo_daten.rs`; Schalter `--demo-daten`/`LIFELINE_DEMO_DATEN=true`
(Vorgabe aus). Herleitung: `openspec/changes/archive/2026-09-29-lfh-690-demo-daten-laufzeit-import/`.
- 404 ohne Schalter kommt aus der Registrierung (`RouterOptionen { demo_daten }`,
  `build_router_mit`); das Frontend liest nur `GET /api/demo-daten` (`admin/useDemoDaten.ts`).
- **Import ist eine Transaktion nur über `…_tx(conn)`-Funktionen** (eine Pool-Funktion unter
  offener `BEGIN IMMEDIATE` endet in 503); kein rohes SQL.
- **Löschen erreicht strukturell nur Demo-Daten** (Einsatz-ID aus `demo_import`, `org_id` in jedem
  WHERE, Stammdaten je Zeile im `SAVEPOINT`). Voraussetzung: FKs auf
  `fahrzeug`/`personal`/`material` `NO ACTION`/`RESTRICT`, nie `DEFERRABLE`
  (`src/demo/schema_tests.rs`).
- Einsatz-IDs werden nie wiederverwendet (`einsatz::repo::anlegen_tx`). Die Szenariouhr setzt
  `received_at = ereigniszeit` nur am Demo-Einsatz; nie eine FTS-Spalte per UPDATE ändern.
- **„Ist Demo“ hat eine Quelle: die Marke** (LFH-733). `ist_demo` in Stamm- und
  Dispositions-Antworten liest `demo_herkunft` live per `EXISTS` (Stamm-`SPALTEN`,
  `SELECT_AUFGELOEST`), nie ein gespeichertes Flag. Darstellung: `frontend/AGENTS.md`, „Farbe
  und Zeichen“. Herleitung: `openspec/changes/archive/2026-10-01-lfh-733-demo-marke-stammdaten/design.md`.

## Backend — Aufbewahrung (LFH-23)

Herleitung: `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md`.
- **Totalsperre bleibt** (`einsatz::berechtigung::darf_lesen`, auch für den System-Admin); das
  Archiv liest nur `/api/aufbewahrung` (`routes/aufbewahrung.rs`), Guard
  `archiv_namensraum_nur_lesend_und_admin` (`tests/aufbewahrung.rs`) — neue Routen dort
  eintragen, nicht lockern. Frontend: Verwaltung → „Aufbewahrung" (`admin/adminNav.tsx`), Akte
  unter `/admin/aufbewahrung/:einsatzId`.
- Archivzugriff nur für den System-Admin der eigenen Org (`fordere_archivzugriff`: fremd 403,
  unbekannt 404, aktiv 409). `PUT …/aufbewahrungsfrist` prüft die Org nicht (bekannte
  Inkonsistenz).
- **Akte ist eine Retain-Projektion** (`aufbewahrung/projektion.rs`, Guard
  `jede_archivspalte_ist_retain` über `klassifikation_von`), eigene DTOs.
- **Wiederherstellen braucht die neue Frist** (`einsatz::repo::wiederherstellen`, `retention_bis`
  Pflicht, Grenze `retention::karenz_grenze`). 409 bei geschwärzt oder
  abgelaufener Karenz, 422 bei nicht vorgemerkt bzw. vergangener Frist; Frist-PUT über
  `aufbewahrung::frist_sperre`, vor „unverändert → 200".
- **Nicht „vereinfachen":** die Frist-PUT-Antwort lässt an gesperrten Einsätzen Einsatzort,
  Koordinate, meldende Stelle und Sachverhalt weg; `soft_delete_einsatz` prüft die Fälligkeit im
  UPDATE erneut; `frist_setzen` schreibt nur an nicht vorgemerkten, nicht geschwärzten Einsätzen.
- Purge-Audit ist fail-closed (Akteurskette abschließende Person → Einsatzleitung → System-Admin
  der Einsatz-Org; ohne Akteur liefert `system_audit_tx` einen Fehler → Rollback, sichtbar nur
  per `tracing::error!`).
- **Scrub-Werte in System-ETB-Texten** stehen in `AUSNAHMEN_SYSTEM_ETB`
  (`tests/aufbewahrung_e2e.rs`) — kein Test bemerkt einen fehlenden Eintrag.
- **Geschwärzt heißt physisch weg** (LFH-725, Spec `aufbewahrung`): `db::connect` setzt
  `secure_delete = ON` (nicht `FAST`: das lässt die Overflow-Seiten gelöschter Anhang-BLOBs
  stehen), und nach einer Schwärzung schreibt der Purge-Lauf den WAL per
  `db::wal_zurueckschreiben` zurück. Die Haupt-DB nur über `db::connect` öffnen. Netz:
  `schwaerzung_hinterlaesst_keine_altbytes` (`einsatz/purge_scheduler.rs`). Herleitung und
  Messung: `openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`.

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Scan in `src/anhang/mod.rs` hinter Feature `clamav` (Default an). Keine `--clamav-addr` → No-op;
clamd erreichbar → Scan (Fund 422); clamd weg → **503 fail-closed** (oder `--clamav-fail-open`).
Wer `src/anhang/mod.rs`/`clamd_scan` anfasst, fährt auch `cargo test --no-default-features`.
`tests/karte_hintergrundbild_scan.rs` prüft 503 gegen `127.0.0.1:1`. `clamd_verbinden` hat zwei
cfg-Varianten (`unix:` nur unter `#[cfg(unix)]`; Windows → `ScannerNichtErreichbar`).
