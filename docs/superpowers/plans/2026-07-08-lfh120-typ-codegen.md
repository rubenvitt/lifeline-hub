# LFH-120 Typ-Codegen (utoipa → openapi-typescript) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (sequential, main-loop — NOT parallel/worktree fan-out: shared domain enums are referenced across modules and file mutations would collide). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend-`serde`-Response-Typen werden zur Wahrheitsquelle der Frontend-Typen: utoipa erzeugt eine OpenAPI-Spec, `openapi-typescript` daraus `types.generated.ts`; `frontend/src/api/types.ts` wird zum Re-Export-Barrel. Ein `git diff --exit-code` auf der committeten generierten Datei + `tsc` machen Backend↔Frontend-Typ-Drift zu einem Build-/Test-Fehler statt einem stillen Laufzeit-`undefined`.

**Architecture:** `#[derive(ToSchema)]` auf allen Response-Structs; `#[schema(value_type = X)]` auf `String`-Enum-Feldern zeigt auf die bestehenden Domänen-Enums (die ToSchema + wire-korrektes `rename`/`rename_all` bekommen). Ein `#[derive(OpenApi)]`-Doc listet alle Schemas (nur `components/schemas`, **keine** `paths` in v1 — Pfad-/Operations-Contract ist rein additiv nachrüstbar). Ein `#[test]` schreibt die Spec deterministisch; ein pnpm-Skript ruft `openapi-typescript`; ein Gate-Skript prüft, dass die committete Datei aktuell ist.

**Tech Stack:** Rust `utoipa = "5"` (ToSchema/OpenApi derive), `openapi-typescript@7` (pnpm dlx/devDep), Vitest/tsc als FE-Gate, `cargo test` als BE-Gate.

## Global Constraints

- **Kein CI vorhanden** → das Gate ist ein lokal/im-`cargo test`-laufender Drift-Check (`git diff --exit-code` auf `types.generated.ts`) + `pnpm typecheck`. Nicht auf GitHub-Actions verlassen.
- **Rust-Gate ist `cargo test`** (Repo ist NICHT fmt/clippy-clean; `clippy -D warnings` crate-weit vorbestehend rot). Neue Derives/Code müssen unter dem bestehenden Baum bauen; im Bestandsstil editieren.
- **Env-Hygiene fürs Gate:** `env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL -u AWS_ALLOW_HTTP cargo test` (Dev-Vars leaken aus mise/.env und kippen den SSRF-Loopback-Security-Test).
- **rust-embed:** `#[folder="frontend/dist"]` → im frischen Worktree muss `frontend/dist/` existieren (Platzhalter `index.html` genügt), sonst bricht der Backend-Build.
- **Wire-Format bleibt exakt:** snake_case-Felder, deutsche Typ-/Feldnamen, `_at`-Zeitstempel als `string`. Codegen darf NICHT anglisieren/camelCasen.
- **Nullability:** generiertes `feld?: T | null` (optional+nullable) wird akzeptiert (harmloser Superset; kein Post-Processing-Transform).
- **pnpm via mise:** `mise exec pnpm@11.10.0 -- pnpm -C <abs-pfad> …` (non-interactive Shell hat node/pnpm nicht aktiv).

## Scope (v1)

- **DRIN:** alle ~54 Response-Structs (`*Anzeige`/`*Detail`/`*Antwort`) als `components/schemas`; **alle ~58 Unions als generierte Unions** — die ~25 mit bestehendem `as_str()`-Enum (Task 1) UND die ~33 Orphan-Unions über **neu angelegte** wire-korrekte Rust-Enums (Task 1b); `types.generated.ts` committet + Barrel + Gate. **Volle Abdeckung, keine `string`-Regression** (Entscheidung 2026-07-08).
- **Orphan-Enum-Ansatz (kein sqlx-Umbau):** Das Response-Feld bleibt `String`; das neue Enum ist reiner **Schema-Anker** via `#[schema(value_type = NeuesEnum)]`. Das Enum wird NICHT in den Struct eingebettet und NICHT von sqlx dekodiert — es trägt nur die wire-korrekten Varianten + `ToSchema`.
- **Wahrheitsquelle für Orphan-Wire-Werte:** NICHT blind die `types.ts`-Literale übernehmen (die könnten selbst gedriftet sein), sondern gegen die **DB-CHECK-Constraints** (`migrations/`) bzw. den werteschreibenden Backend-Code verifizieren; Diskrepanz types.ts↔Backend als Befund melden.
- **DRAUSSEN (bewusst, additiv nachrüstbar):**
  - **Pfad-/Operations-Contract** (`#[utoipa::path]` auf 139 Handlern) → Folge-Schritt.
  - **Input-/Patch-DTOs** (~70, PATCH-null-vs-absent-Semantik) → Folge-Schritt.

---

### Task 1: Enum-Wire-Guard-Test (Korrektheits-Wirbelsäule)

Sichert die Invariante `serde_json::to_value(variant) == json!(variant.as_str())` für **jedes** union-relevante Domänen-Enum, BEVOR die generierten Unions verdrahtet werden. `as_str()` existiert gerade, weil manche Wire-Werte nicht trivial aus dem Variantennamen folgen — ein Enum, dessen `as_str()` kein `rename_all` trifft, erzeugt sonst eine **still falsche** Union (kein Gate fängt das).

**Files:**
- Create: `tests/enum_wire_kontrakt.rs`
- Modify (nach rot): die Enum-Definitionen mit abweichenden `as_str()`-Werten (per-Variante `#[serde(rename="…")]`)

**Interfaces:**
- Consumes: die bestehenden `as_str()`-Impls der Domänen-Enums.
- Produces: garantiert, dass Serde-Serialisierung jedes union-Enums == `as_str()` — Voraussetzung dafür, dass `#[schema(value_type=Enum)]` in Task 3 korrekte Unions liefert.

- [ ] **Step 1: Failing Test schreiben.** Für jedes union-relevante Enum (uhs: UhsTyp/UhsStatus/PlatzTyp/Verfuegbarkeit/BelegungsArt; person: PersonStatus/Geschlecht/Sichtungskategorie/VerbleibArt; schaden: SchadenStatus/SchadenTyp/Ausmass/AbschlussGrund; tier: TierStatus/Spezies/TierGeschlecht/AbschlussGrund; material: MaterialStatus; etb: EtbTyp/MeldeWeg; bereitstellungsraum: BrStatus/ObjektTyp/BrBelegungsArt; chat: BezugTyp; einsatz: EinsatzRolle; staerke: StaerkePosition) je Variante asserten:

```rust
// tests/enum_wire_kontrakt.rs — Guard: Serde-Wire == as_str() für jede Variante.
// Macht die generierten utoipa-Unions (Task 3) verlässlich. Bei rot: per-Variante
// #[serde(rename="…")] am Enum ergänzen, bis Serde == as_str().
use lifeline_hub::uhs::{UhsTyp, UhsStatus, PlatzTyp, Verfuegbarkeit, BelegungsArt};
// … weitere use-Importe analog

macro_rules! wire_eq {
    ($($variant:expr),+ $(,)?) => {
        $(assert_eq!(
            serde_json::to_value(&$variant).unwrap(),
            serde_json::json!($variant.as_str()),
            "Serde-Wire != as_str() für {:?} — utoipa-Union würde still falsch generieren", $variant
        );)+
    };
}

#[test]
fn serde_wire_gleich_as_str() {
    wire_eq!(UhsTyp::Patientenablage, UhsTyp::Behandlungsplatz, UhsTyp::Verletztensammelstelle, UhsTyp::Sonstige);
    wire_eq!(UhsStatus::Geplant, UhsStatus::Aktiv, UhsStatus::Aufgeloest);
    // … alle Varianten aller oben gelisteten Enums (aus den jeweiligen as_str()-match-Armen ablesen)
}
```

Voraussetzung: jedes getestete Enum muss `Serialize` ableiten (die meisten tun es bereits) und `pub` sein. Fehlt `Serialize`, ergänzen.

- [ ] **Step 2: Rot laufen lassen.** `env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL -u AWS_ALLOW_HTTP cargo test --test enum_wire_kontrakt` — Erwartung: FAIL genau bei den Enums, deren `as_str()` nicht der Default-Serde-Serialisierung (PascalCase) entspricht (praktisch alle ohne `rename_all`).

- [ ] **Step 3: Enums wire-korrekt annotieren.** Pro Enum die Serde-Darstellung an `as_str()` ausrichten: wenn `as_str()` == snake_case-des-Variantennamens → `#[serde(rename_all = "snake_case")]`; sonst per-Variante `#[serde(rename = "<exakter as_str-Wert>")]`. Beispiel unregelmäßig:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub enum StaerkePosition {
    #[serde(rename = "fuehrer")] Fuehrer,       // as_str() = "fuehrer" (kein snake_case-Treffer bei Umlaut-Auflösung prüfen)
    // … an die realen as_str()-Werte anpassen
}
```

Gleichzeitig `utoipa::ToSchema` an jedes dieser Enums mitderiven (wird in Task 3 gebraucht).

- [ ] **Step 4: Grün laufen lassen.** `cargo test --test enum_wire_kontrakt` (mit `env -u …`) → PASS. Zusätzlich volle Lib-Suite grün: `env -u … cargo test --lib`.

- [ ] **Step 5: Commit.** `git add tests/enum_wire_kontrakt.rs src/**/mod.rs src/staerke.rs && git commit -m "test(lfh-120): Enum-Wire-Guard + Domänen-Enums serde-wire-korrekt + ToSchema"`

---

### Task 1b: Orphan-Unions als wire-korrekte Rust-Enums anlegen (~33)

Die ~33 `types.ts`-Unions ohne Backend-Enum (SystemRolle, OrgRolle, EinsatzStatus, Einsatzart, BasemapModus, Zeitformat, EinheitenSystem, Koordinatenformat, Dienststatus, StatusKategorie, Betriebsart, VerbleibStatus, AbgleichStatus, Gefahrentyp, Schutzobjekt, Warnstufe, ZoneTyp, LageberichtVorlageKey, LageberichtStatus, BefehlVorlageKey, BefehlStatus, AuftragPrioritaet, AuftragBearbeitungsstatus, EmpfaengerTyp, Richtung, MeldungPrioritaet, MeldungStatus, Meldungsart, MeldungMeldeweg, NachforderungPrioritaet, NachforderungStatus, AdressatKategorie, …) bekommen je ein Rust-Enum als reinen Schema-Anker.

**Files:**
- Modify: die jeweiligen Domänen-Module (`src/org/`, `src/einsatz/`, `src/config.rs`, `src/gefahr/`, `src/lage_zone/`, `src/lagebericht/`, `src/befehl/`, `src/auftrag/`, `src/meldung/`, `src/nachforderung/`, `src/personal/`, `src/fahrzeug/`, …) — Enum ins fachlich passende Modul.
- Modify: `tests/enum_wire_kontrakt.rs` (Guard um die neuen Enums erweitern).

**Interfaces:**
- Produces: je Orphan-Union ein `pub enum` mit `Serialize, ToSchema` + wire-korrektem `rename`/`rename_all`; als `value_type`-Anker in Task 2 nutzbar.

- [ ] **Step 1: Wire-Werte verifizieren (pro Union).** Für jede Orphan-Union die autoritativen Wire-Werte bestimmen: `grep` das Feld im Response-Struct → die schreibende Stelle (Repo/Handler) → die DB-CHECK-Constraint in `migrations/`. Gegen die `types.ts`-Literale abgleichen. **Diskrepanz = Befund** (nicht still die types.ts-Variante nehmen).

- [ ] **Step 2: Enum + Guard-Zeile schreiben (rot).** Pro Union ein Enum, z.B.:

```rust
/// LFH-120: Schema-Anker für die `system_rolle`-Union (Wire aus DB-CHECK `…`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")] // oder per-Variante #[serde(rename="…")], wenn Wire ≠ snake_case
pub enum SystemRolle { Admin, Keiner }
```

Guard-Zeile in `tests/enum_wire_kontrakt.rs` ergänzen: assert, dass jede Variante zum erwarteten Wire-String serialisiert (erwartete Strings aus Step 1, NICHT aus dem Variantennamen abgeleitet).

- [ ] **Step 3: Grün.** `env -u … cargo test --test enum_wire_kontrakt` → PASS für alle neuen Enums.

- [ ] **Step 4: Lib grün.** `env -u … cargo test --lib` → PASS (neue Enums brechen nichts).

- [ ] **Step 5: Commit.** `git add -A src/ tests/ && git commit -m "feat(lfh-120): wire-korrekte Rust-Enums für ~33 Orphan-Unions (Schema-Anker)"`

---

### Task 2: `#[derive(ToSchema)]` auf alle Response-Structs (mechanischer Sweep)

**Files:**
- Modify: alle `src/**/*.rs` mit `pub struct *Anzeige|*Detail|*Antwort` (~54, Liste via Befehl unten) + die referenzierten flachen Sub-Structs (z.B. `Staerke`, `Abschnitt`).

**Interfaces:**
- Consumes: —
- Produces: jeder Response-Struct implementiert `utoipa::ToSchema` → wird in Task 3 als Schema listbar.

- [ ] **Step 1: Ziel-Liste erzeugen.** `grep -rlE "pub struct [A-Za-z0-9_]+(Anzeige|Detail|Antwort)" src/` — das sind die zu bearbeitenden Dateien.

- [ ] **Step 2: Pro Struct annotieren.** In jeder Datei `use utoipa::ToSchema;` ergänzen (falls fehlt) und `ToSchema` in die `#[derive(…)]`-Liste jedes Response-Structs aufnehmen. Bei `String`-Feldern, die einer Domänen-Union entsprechen (`typ`, `status`, `geschlecht`, `art`, `kategorie`, …), den Override setzen — Muster (spike-erprobt):

```rust
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct PersonAnzeige {
    // …
    #[schema(value_type = PersonStatus)]
    pub status: String,
    #[schema(value_type = Geschlecht)]
    pub geschlecht: Option<String>,
    // …
}
```

`serde_json::Value`-Felder (z.B. GeoJSON): **kein** `value_type = Object` (ergibt `Record<string, never>`), sondern Default lassen → `unknown`. (In Task 0-Spike war `FachebeneAntwort.features` auf `Object` gesetzt; auf Default zurücknehmen.)

- [ ] **Step 3: Bauen.** `env -u … cargo build --lib` → grün. Compiler listet fehlende ToSchema-Impls transitiv referenzierter Typen; diese nachziehen.

- [ ] **Step 4: Lib-Tests grün.** `env -u … cargo test --lib` → PASS.

- [ ] **Step 5: Commit.** `git add -A src/ && git commit -m "feat(lfh-120): ToSchema auf alle Response-DTOs + Enum-Feld-Overrides"`

---

### Task 3: OpenApi-Doc + deterministischer Spec-Emitter (ersetzt Spike-Modul)

**Files:**
- Create: `src/api_doc.rs` (öffentliches `ApiDoc` mit allen Schemas)
- Modify: `src/lib.rs` (`pub mod api_doc;`), `src/spike_codegen.rs` **löschen** + `#[cfg(test)] mod spike_codegen;` aus `lib.rs` entfernen
- Create: `tests/openapi_spec_aktuell.rs` (Gate-Test)

**Interfaces:**
- Produces: `lifeline_hub::api_doc::ApiDoc::openapi()` → vollständige Spec; `frontend/src/api/openapi.json` (committet).

- [ ] **Step 1: ApiDoc anlegen** mit `#[derive(OpenApi)] #[openapi(components(schemas(… alle Response-Structs + Domänen-Enums …)))]`. (Vollständige Schema-Liste; leere `paths` in v1.)

- [ ] **Step 2: Emit-Test schreiben** (`tests/openapi_spec_aktuell.rs`):

```rust
// Schreibt die Spec und schlägt fehl, wenn die committete Datei veraltet ist (Drift-Gate).
#[test]
fn openapi_json_ist_aktuell() {
    let aktuell = lifeline_hub::api_doc::ApiDoc::openapi().to_pretty_json().unwrap();
    let pfad = concat!(env!("CARGO_MANIFEST_DIR"), "/frontend/src/api/openapi.json");
    let alt = std::fs::read_to_string(pfad).unwrap_or_default();
    if alt.trim() != aktuell.trim() {
        std::fs::write(pfad, &aktuell).unwrap(); // lokal aktualisieren…
        panic!("openapi.json war veraltet — neu geschrieben. Bitte committen + `pnpm gen:types` laufen lassen.");
    }
}
```

- [ ] **Step 3: Rot→grün.** Erster Lauf schreibt `openapi.json` + failt; zweiter Lauf grün. `env -u … cargo test --test openapi_spec_aktuell`.

- [ ] **Step 4: Spike-Reste entfernen** (`src/spike_codegen.rs`, `target/spike-*`), `cargo test --lib` grün.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(lfh-120): OpenApi-Doc (alle Schemas) + committete openapi.json + Drift-Gate-Test"`

---

### Task 4: `types.generated.ts` + pnpm-Generator + Namens-Barrel

**Files:**
- Create: `frontend/src/api/types.generated.ts` (committet, `// @generated`)
- Modify: `frontend/package.json` (Script `gen:types` + `openapi-typescript` devDep)
- Modify: `frontend/src/api/types.ts` → Re-Export-Barrel

**Interfaces:**
- Consumes: `frontend/src/api/openapi.json`.
- Produces: die bestehenden Typnamen (`Uhs`, `PersonDetail`, …) als Re-Exports der generierten `components["schemas"][…]`.

- [ ] **Step 1: Generator-Script + devDep.** In `frontend/package.json`: `"gen:types": "openapi-typescript src/api/openapi.json -o src/api/types.generated.ts"`, `openapi-typescript@^7` als devDependency.

- [ ] **Step 2: Generieren.** `mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend install && mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend gen:types`.

- [ ] **Step 3: Barrel bauen.** `types.ts` auf Re-Exports umstellen — **Namens-Mapping** Rust `XxxAnzeige` ↔ FE `Xxx` (Suffix `Anzeige` fällt weg), Detail/Antwort direkt:

```ts
// frontend/src/api/types.ts — Barrel über die generierten Schemas (LFH-120).
import type { components } from './types.generated';
type S = components['schemas'];

export type Uhs = S['UhsAnzeige'];
export type UhsDetail = S['UhsDetail'];
export type UhsTyp = S['UhsTyp'];
// … alle Namen; ~33 Orphan-Unions ohne Rust-Enum bleiben hier handgepflegt (Task 5).
```

- [ ] **Step 4: Typecheck.** `mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend typecheck` → grün (fängt jeden fehlenden/falsch gemappten Namen über die 168 Importer). Fehlmappings iterativ fixen.

- [ ] **Step 5: Commit.** `git add frontend/ && git commit -m "feat(lfh-120): generierte types.generated.ts + Namens-Barrel (types.ts re-exportiert)"`

---

### Task 5: Orphan-Unions einordnen + Gate verdrahten + Doku

**Files:**
- Modify: `frontend/src/api/types.ts` (handgepflegte Orphan-Unions belassen/markieren)
- Create: `scripts/check-typ-codegen.sh` (Gate-Runner) + kurze Doku in `docs/`

**Interfaces:**
- Produces: reproduzierbares Gate `cargo test openapi_json_ist_aktuell` + `git diff --exit-code frontend/src/api/{openapi.json,types.generated.ts}` + `pnpm typecheck`.

- [ ] **Step 1: Vollständigkeit prüfen.** `grep -oE "^export type [A-Za-z0-9_]+" frontend/src/api/types.ts` — jede ehemalige Union muss jetzt ein Re-Export einer generierten `components["schemas"][…]`-Union sein (aus Task 1/1b), KEINE handgepflegte `= '…'|…` mehr (Ausnahme: die 2 `Record<>`-Maps OrgModulEinstellungen/ModulOverrides, die keine Union sind). Verbleibende handgepflegte Union = Lücke → zurück zu Task 1b.

- [ ] **Step 2: Gate-Skript.** `scripts/check-typ-codegen.sh`: baut/emittiert die Spec, ruft `gen:types`, dann `git diff --exit-code frontend/src/api/openapi.json frontend/src/api/types.generated.ts` (bricht bei uncommittetem Drift), dann `pnpm typecheck`.

- [ ] **Step 3: Verifizieren.** Negativprobe: ein Backend-Feld probeweise umbenennen → Skript bricht (`git diff`/`tsc`); zurücksetzen.

- [ ] **Step 4: Doku.** Kurzer Abschnitt (z.B. in `CLAUDE.md` oder `docs/`): „Response-Typen werden aus Rust generiert; nach Struct-/Enum-Änderung `pnpm gen:types` + committen; Orphan-Unions & Input-DTOs sind noch handgepflegt (Folge-Arbeit)."

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(lfh-120): Codegen-Gate-Skript + Orphan-Union-Doku + Handbuch"`

---

## Self-Review

- **Spec-Abdeckung:** Akzeptanzkriterium „Kern-DTOs generiert" → Task 2/3/4. „Feld-Rename bricht Build/Test" → Task 3 (`git diff`-Gate) + Task 4 (`tsc`). Enum-Wert-Sicherheit → Task 1 (Guard) + Task 2 (Overrides). Orphan-Unions/Input-DTOs/Pfade explizit als Folge-Arbeit deklariert (Scope-Abschnitt + Task 5).
- **Korrektheits-Falle adressiert:** Task 1 verhindert still-falsche Unions (Serde-Wire == as_str()).
- **Reihenfolge:** Guard (1) VOR Sweep (2) VOR Doc/Generate (3/4) — die Unions sind erst nach Task 1 vertrauenswürdig.
- **Namens-Mapping-Risiko** (XxxAnzeige↔Xxx) ist durch `tsc` über 168 Importer abgesichert (Task 4 Step 4).
