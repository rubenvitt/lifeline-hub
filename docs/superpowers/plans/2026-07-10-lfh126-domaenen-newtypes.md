# LFH-126: Domänenwerte als Newtypes/Enums — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan batch-by-batch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stringly-typed Domänenwerte (Rollen/Status/Arten) crate-weit als Rust-Enums/Newtypes führen, sodass ungültige Werte als Compile- oder sauberer 422/400-Fehler statt als DB-500 auftreten — **volle Tiefe**: auch die internen Schichten (FromRow-Structs, Repo-Params, Response-DTOs) der schon-am-Rand-sicheren Cluster werden durchgängig typisiert.

**Architektur:** Handler-Guard-Ansatz (KEIN serde-reject am Extractor): Request-DTOs bleiben `String`-Felder (laut CLAUDE.md handgepflegt/FE-lokal) und werden im Handler per `Enum::parse(...).ok_or(Validation/UnprocessableEntity)` geführt → die sprechenden deutschen Fehlertexte bleiben erhalten. Der **interne** Fluss (nach dem parse) und die FromRow-/Response-Schichten führen echte Enums. Das Enum ist Single Source of Truth; DB-CHECK + OpenAPI-Union leiten sich davon ab.

**Tech Stack:** Rust, axum, sqlx (SQLite), utoipa/ToSchema, serde. Enums tragen `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]` + `#[serde(rename_all = "snake_case")]` (oder explizite `#[serde(rename=…)]` wo der Wire-String abweicht).

## Global Constraints

- **Gate ist `cargo test`** (NICHT `cargo fmt`/`clippy` — Repo ist nicht fmt-clean, `clippy -D warnings` crate-weit vorbestehend rot). Im Bestandsstil editieren.
- **Dev-Env-Leck neutralisieren** vor jedem Testlauf: `env -u AWS_ACCESS_KEY_ID -u AWS_ALLOW_HTTP -u AWS_ENDPOINT -u AWS_REGION -u AWS_SECRET_ACCESS_KEY -u KS_BASE_URL -u KS_BIND -u KS_STORAGE_BUCKET -u KS_TOKEN -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_KARTEN_SERVICE_TOKEN -u LIFELINE_KARTEN_SERVICE_URL -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL rtk proxy cargo test` (sonst kippt u. a. der SSRF-Loopback-Test).
- **Status-Codes NICHT vereinheitlichen** (400 bleibt 400, 422 bleibt 422 pro Endpoint) — orthogonaler Verhaltens-Change, ausgeklammert.
- **serde-reject am Extractor NICHT einführen** — Request-DTOs bleiben `String` + Handler-`parse`.
- **OfflineKarte (`karte/registry/repo.rs` status/format/kachel_schema) ausgeklammert** — einziger Full-Codegen-Fall, orthogonale Karten-Domäne → eigener Task.
- **Codegen-Vertrag (CLAUDE.md LFH-120):** Sobald ein Response-DTO-Feld von `String` (mit `#[schema(value_type=Enum)]`-Anker) auf ein echtes `Enum` wechselt, MUSS `scripts/check-typ-codegen.sh` laufen und `openapi.json` + `types.generated.ts` **unverändert** bleiben (No-Op), sofern jede Variante byte-genau auf ihren bestehenden Wire-String mappt. Ein Diff = Wire-Abweichung = Fehler. Neue/geänderte Enum-Varianten müssen in `tests/enum_wire_kontrakt.rs` gegen ihren Wire-String stehen.
- **Wire-Guard eng:** `tests/enum_wire_kontrakt.rs` nur für Enums ergänzen, die dieser Task tatsächlich anfasst/neu verankert — nicht den bestehenden Guard „komplettieren".
- **Batch-Disziplin:** Jeder Batch schließt mit grünem `cargo test` (betroffene Test-Binaries + einmal die volle Suite pro Batch-Merge) und einem eigenen Commit `refactor(lfh-126): <cluster> …`. Kein Batch wird begonnen, bevor der vorige grün + committed ist.

---

## Refactor-Muster (Anatomie eines Cluster-Batches)

Referenz-Umsetzung am Cluster Einsatz (Batch 1). Jeder weitere Batch folgt exakt diesen Schritten mit seinen Enum-Namen/Wire-Werten/Files.

1. **Enum vervollständigen** (`src/<modul>/mod.rs`): Falls das Enum nur Schema-Anker ist (kein `as_str`/`parse`), `as_str()` (→ die bestehenden `const &str`) und `parse(&str) -> Option<Self>` ergänzen — Muster wie `EinsatzRolle` (`src/einsatz/mod.rs:72-90`). Falls nur eine `[&str; N]`-Konstante + `ist_gueltig`-Fn existiert (gefahr/lage_zone): ein echtes Enum einführen, das exakt dieselben Wire-Werte trägt.
2. **Request-Rand typisieren** (`src/routes/<modul>.rs`): Wo der Handler heute einen freien `&str`-Guard (`ARRAY.contains` / inline `matches!` / manuelles `!=`) macht, auf `Enum::parse(&feld).ok_or_else(|| AppError::<Validation|UnprocessableEntity>("<bestehender Text>"))?` umstellen. Fehlermeldung + Status-Code **wörtlich** wie bisher.
3. **Interne Schichten durchfädeln** (volle Tiefe): FromRow-Struct-Felder `String` → `Enum` via `#[sqlx(try_from = "String")]` (dazu `TryFrom<String>` aus `parse` ableiten) ODER, wo FromRow-Decode zu invasiv ist, das Feld in der Anzeige-/Mapping-Schicht konvertieren. Repo-Fn-Parameter `&str` → `Enum` (Aufrufer geben schon typisierte Werte).
4. **Response-DTO** (`src/<modul>/mod.rs` `XxxAnzeige`): Feld `String` (mit `#[schema(value_type=Enum)]`) → echtes `Enum`-Feld; den `value_type`-Anker entfernen (serde leitet die Union jetzt selbst ab).
5. **Wire-Guard** (`tests/enum_wire_kontrakt.rs`): Für jede Variante des angefassten Enums einen Eintrag `assert_eq!(Enum::X.as_str(), "wire")` bzw. serde-Roundtrip, falls noch nicht vorhanden.
6. **Codegen** (nur wenn ein Response-DTO-Feld in Schritt 4 geändert wurde): `scripts/check-typ-codegen.sh` laufen; `git diff --exit-code openapi.json types.generated.ts` MUSS leer sein.
7. **Verifikation**: betroffene Test-Binaries grün, dann volle Suite grün. Commit.

---

## Task 0 (Batch 1): Einsatz-Cluster — Muster + empirischer Codegen-Test

**Warum zuerst:** Enthält mit `EinsatzRolle` den saubersten Response-DTO-Anker (schon Enum + `as_str` + im Wire-Guard) → ideal, um die **codegen-neutral-Annahme empirisch zu bestätigen**, bevor 13 weitere Cluster darauf bauen. `EinsatzStatus`/`Einsatzart` liefern den „Anker-ohne-as_str"-Fall.

**Files:**
- Modify: `src/einsatz/mod.rs` (EinsatzStatus/Einsatzart `as_str`+`parse` ergänzen; `Einsatz` FromRow status/einsatzart → Enum; `EinsatzAnzeige`/`MitgliedAnzeige` DTO-Felder → Enum)
- Modify: `src/routes/einsatz.rs` (Guards `:490` einsatz_rolle, `:588` ist_gueltige_einsatzart, DTO-Felder `:461`/`:557`)
- Modify: `tests/enum_wire_kontrakt.rs` (EinsatzStatus/Einsatzart ergänzen; EinsatzRolle ist schon drin)
- Regen (erwartet No-Op): `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`

**Interfaces:**
- Produces: `EinsatzStatus::{as_str,parse}`, `Einsatzart::{as_str,parse}` (Signaturen wie `EinsatzRolle`) — von späteren Batches als Muster referenziert, nicht als Abhängigkeit.

- [ ] **Step 1:** `EinsatzStatus` + `Einsatzart` je `as_str()` + `parse()` ergänzen (exakt das `EinsatzRolle`-Muster, Wire-Werte = die bestehenden `const &str` STATUS_* / EINSATZART_*).
- [ ] **Step 2:** `cargo test --test einsatz` (betroffen) — grün halten; Enum-Ergänzung ist additiv.
- [ ] **Step 3:** Handler-Guard `ist_gueltige_einsatzart` (`src/routes/einsatz.rs:588`) auf `Einsatzart::parse` umstellen, Fehlertext/Status wörtlich beibehalten.
- [ ] **Step 4:** `EinsatzAnzeige.status`/`.einsatzart` und `MitgliedAnzeige.einsatz_rolle` von `String` → `EinsatzStatus`/`Einsatzart`/`EinsatzRolle`; `#[schema(value_type=…)]`-Anker entfernen. FromRow `Einsatz.status`/`.einsatzart` via `#[sqlx(try_from="String")]` + `TryFrom<String>`.
- [ ] **Step 5:** `tests/enum_wire_kontrakt.rs`: EinsatzStatus (`aktiv`/`abgeschlossen`) + Einsatzart (`realeinsatz`/`uebung`/`sanitaetsdienst`/`bereitstellung`) ergänzen.
- [ ] **Step 6 (KRITISCH):** `scripts/check-typ-codegen.sh` laufen; `git diff --exit-code frontend/src/api/openapi.json frontend/src/api/types.generated.ts`. **Erwartet: leer.** Bei Diff → Wire-Abweichung; STOP und untersuchen, bevor weitere Batches.
- [ ] **Step 7:** volle Suite grün (`env -u … rtk proxy cargo test`). Commit `refactor(lfh-126): Einsatz-Cluster (Rolle/Status/Art) typisieren + Codegen-No-Op verifiziert`.

**→ CHECKPOINT nach Batch 1:** Ergebnis von Step 6 dem User berichten (Annahme bestätigt/widerlegt), bevor die Serien-Batches laufen.

---

## Weitere Batches (je nach Muster, Reihenfolge = aufsteigende Invasivität)

Jeder Batch: Muster-Schritte 1–7, eigener Commit, grün. Enum-Namen/Wire-Werte/Orte aus dem LFH-126-Scope (Domain-Reader).

- [ ] **Batch 2 — Person** (`src/person/mod.rs`; CHECK 0020/0023; Guards `src/routes/einsatz_person.rs:101,126,294,385`): Status / Geschlecht / Sichtungskategorie — Enums vorhanden (parse/as_str), DTO-Felder String → Enum, FromRow durchfädeln.
- [ ] **Batch 3 — Tier** (`src/tier/mod.rs`; `src/routes/einsatz_tier.rs`): Status / Spezies / Geschlecht / AbschlussGrund.
- [ ] **Batch 4 — Schaden** (`src/schaden/mod.rs`; `src/routes/einsatz_schaden.rs`): Status / Typ / Ausmass / AbschlussGrund. Werte doppelt in schaden+geschaedigt (0032/0033) — identischer CHECK.
- [ ] **Batch 5 — UHS** (`src/uhs/mod.rs`; `src/routes/einsatz_uhs.rs`): Typ / Status / PlatzTyp / Verfuegbarkeit / BelegungsArt — alle im Wire-Guard, saubere Musterfälle.
- [ ] **Batch 6 — Bereitstellungsraum** (`src/bereitstellungsraum/mod.rs`; `belegung_repo.rs`, `routes/einsatz_bereitstellungsraum.rs`): BrStatus / ObjektTyp / BrBelegungsArt.
- [ ] **Batch 7 — Gefahr** (`src/gefahr/mod.rs`; `src/routes/gefahr.rs:111,117,123`): GEFAHRENTYPEN[13] / SCHUTZOBJEKTE[5] / WARNSTUFEN[5] — **echtes Enum aus `[&str;N]`-Array einführen** (Array-contains → Enum::parse). Kombinations-Regel `kombination_gueltig` bleibt Handler-Logik.
- [ ] **Batch 8 — Lage-Zone** (`src/lage_zone/mod.rs`; `src/routes/lage_zone.rs:106,112,118`): TYPEN[5] / GEOMETRIE_TYPEN[2] — Array → Enum. `geometrie_klasse_passt` bleibt Handler-Logik.
- [ ] **Batch 9 — ETB + BausteinTyp-Subset** (`src/etb/mod.rs`, `src/etb_baustein/mod.rs`; `etb.rs`/`etb_baustein.rs`): `EtbTyp` (6 Varianten) + **neuen `BausteinTyp`-Subset-Newtype (4 Varianten)** einführen, der die etb_baustein-CHECK-Grenze compile-fest macht (ersetzt den `.filter(ist_baustein_typ)`-Guard). Höchster Bug-Präventions-Wert.
- [ ] **Batch 10 — Benutzer-Rollen** (`src/routes/benutzer.rs:21-23,57-67`; CHECK 0002/0003): system_rolle / org_rolle — **raw String, kein Enum heute** → Newtype/Enum einführen (`SystemRolle`/`OrgRolle` existieren als Anker in `auth/mod.rs:104,106`; parse/as_str ergänzen), inline `!=`-Guards → `parse`.
- [ ] **Batch 11 — Person verbleib/abgleich** (`src/routes/einsatz_person.rs:522,687`; `abgleich_repo.rs:68`): inline `matches!`-Guards → Enum::parse. abgleich.status 3-Wert-CHECK, Guard erlaubt bewusst 2 (Übergang) — Semantik beibehalten.
- [ ] **Batch 12 — Material/Katalog** (`src/material/mod.rs`, `src/katalog.rs`; einsatz_material.rs, sprechgruppe.rs, personal_status.rs, fahrzeug_status.rs): MaterialStatus + Katalog-Betriebsart/Dienststatus/Kategorie — `ist_gueltige_*`-Frei-String-Guards → Enum::parse. Dienststatus via bool-Toggle (kein User-String) bleibt.
- [ ] **Batch 13 — Bucket C (kein DB-CHECK)** (auftrag/meldung/nachforderung/chat): code-validierte Enums OHNE DB-CHECK. **Nur Code-Typisierung** (migrationsfrei) — KEINE CHECK-ADD-Migration (sqlx-0.9-no-tx-Sumpf, ausgeklammert). auftrag.empfaenger_typ HAT CHECK (0048/0057), regulär.

---

## Ausgeklammert (bewusst, dokumentiert)

- **OfflineKarte** status/format/kachel_schema (`karte/registry/repo.rs`) — Full-Codegen-Fall, eigener Task.
- **DB-CHECK-Erzwingung für Bucket C** (auftrag/meldung/nachforderung/chat) — CHECK-ADD-Rebuild = sqlx-0.9-no-tx-Territorium, eigener Task.
- **Mehrspalten-/Cross-Field-CHECKs** (schaden/tier/uhs_platz/abgleich) — profitieren nicht von Single-Field-Newtypes, bleiben Effektivzustand-Handler-Logik (MEMORY patch-xor-effektivzustand), unberührt lassen.
- **Status-Code-Vereinheitlichung** (400↔422) — orthogonal.

## Self-Review-Notiz

Spec-Abdeckung: alle 14 Domänencluster des Scope aus einem Batch adressiert (Einsatz, Person, Tier, Schaden, UHS, Bereitstellungsraum, Gefahr, Lage-Zone, ETB, Benutzer-Rollen, verbleib/abgleich, Material/Katalog, Bucket C). Reihenfolge: schon-verankerte-Enum-Cluster (2–6) vor Array→Enum (7–8) vor Subset/raw-String (9–11) — steigende Invasivität. Batch 1 validiert das Codegen-Fundament empirisch, bevor die Serie läuft.
