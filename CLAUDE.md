# CLAUDE.md

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.

Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

Die UI-Form richtet sich nach Umfang/Interaktion des Inhalts (LFH-19):

- **Vollseite / eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`) → umfangreiche
  Detail-/Bearbeitungsansichten: mehrere Sektionen/Tabs, >~5 Felder, Workflow, Deep-Link-würdig.
  Referenzmuster: `BefehlDetailPage`, `PersonenDetailPage`.
- **Modal / Dialog** → kurze, blockierende Aktion: Bestätigung, kleines Formular (≤~3 Felder).
- **Inline / Expander** → kontextbezogener Zusatzinhalt, der die Seite nicht verlässt.
- **Drawer** → nur schlanker, fokussierter Quick-View (read-only Vorschau) oder
  Schnellerfassung (≤~4 Felder). Referenz: `PersonDetailDrawer`. Kein Bearbeiten
  umfangreicher Entitäten, keine mehrteiligen Tabs.

Faustregel: Sobald ein Drawer Tabs bekommt, einen Edit-Modus mit vielen Feldern trägt
oder breiter als ~480 px sein muss, gehört der Inhalt auf eine eigene Route.
Details/Inventar: `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Modulübergreifende Deeplinks folgen einem festen Muster (LFH-25):

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → das Modul hat eine eigene
  Vollseiten-Detailansicht (uhs, br, lagebericht, befehl, person, tier, schaden).
- **Query-Param-Selektion** `/einsaetze/:id/<modul>?<modul>=<id>` → das Zielobjekt wird in
  einer Listenseite selektiert/als Drawer geöffnet, weil (noch) keine Detail-Route existiert
  (`?einheit=`, `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`,
  `?auftrag=`, `?gefahrengebiet=`, ETB `?eintrag=`). `?neu=1` fokussiert die Schnellerfassung.

Faustregel: Vollseiten-Detail vorhanden → Item-Route, sonst Query-Param. Param-Namen sind
sprechend (`:<modul>Id`, Query-Key Modul-Singular) und nutzen die stabile DB-`id` (nicht die
laufende Anzeigennummer).

**Quelle der Wahrheit:** `frontend/src/routing/deeplinks.ts` (zentrale, unit-getestete
URL-Builder) — keine inline-Template-Literals für Einsatz-Pfade. `parseRouteId` dort
validiert Route-IDs (positive Ganzzahl, sonst Redirect auf die Liste).
Details: `docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`.

## Frontend — Query-Key-Registry (LFH-122/307/312)

**Quelle der Wahrheit:** `frontend/src/api/queryKeys.ts` — seit LFH-307 mit zwei Hälften:

- **`einsatzKeys`** (Prefixe in `EINSATZ_KEYS`) für alles unter einer `einsatzId`. Hängt am
  SSE-Fan-out: `EINSATZ_STREAM_EVENTS` mappt Wire-Event → invalidierte Prefixe, und jeder
  managed Key ist **genau einmal** klassifiziert (live via Event **oder** `NICHT_LIVE_KEYS`).
- **`globalKeys`** (Prefixe in `GLOBAL_KEYS`) für alles darüber: Mandant/Organisation,
  Stammdaten-Kataloge, Instanz/Betrieb, externe Quellen. Bewusst **nicht** `ORG_KEYS` —
  `admin-karte`/`karte-config` sind instanzweit, `fachebene` bezeichnet Fremdquellen.

**Kein Inline-String-Array als Query-Key.** Erzwungen von `queryKeys.guard.test.ts` über einen
TS-AST-Scanner (`queryKeyScan.ts`), nicht mehr per Regex: mehrzeilige Literale sind sichtbar,
Kommentare erzeugen strukturell keinen Fehlalarm, der Quote-Stil ist egal, und ein bare-Literal,
das in einen lokalen Key-Helfer fließt (`inval('einsatz-uhs')`), fliegt ebenfalls auf. Der
Scanner trennt zwei Radien — **weit** (jedes Array-Literal, für die Denylist-Guards) und **eng**
(nur echte Query-Key-Kontexte, für den Allowlist-Guard); ohne diese Trennung wären Konstanten
wie `['KB','MB','GB','TB']` Fehlalarme. Was der Guard **nicht** sieht, steht als Liste in seinem
Kopfkommentar — die ist Teil des Vertrags, nicht Beiwerk.

**Wire-Strings sind eingefroren und byte-gepinnt** (`globalKeys.test.ts`). Grund: ein geänderter
Query-Key **bricht nichts** — er trifft still ein anderes Cache-Fach. Kein Fehler, kein roter
Test, kein auffälliger Request; die Komponente lädt neu und eine Invalidierung anderswo läuft
ins Leere. Deshalb prüft der Byte-Pin gegen **handgeschriebene Literale**, nie gegen
`GLOBAL_KEYS.x` — sonst prüfte er die Konstante gegen sich selbst.

**Sub-Key-Konvention:** getyptes String-Union-Token als zweites Element (`Dienstfilter`,
`AdminKarteBereich`), **kein** Filter-Objekt; der **argumentlose** Accessor ist zugleich der
Invalidierungs-Prefix (TanStack matcht per Prefix), Filter-Varianten hängen an. Deshalb zwei
Accessoren (`personal()` **und** `personalListe('alle')`) statt eines optionalen Arguments.

**Zwei gemessene Testfallen** in diesem Bereich:

- Cache-Tests **ohne** mounted Observer dürfen nicht `neuerQueryClient()` nutzen — dessen
  `gcTime: 0` räumt einen per `setQueryData` gesetzten, unbeobachteten Eintrag beim ersten
  `await` weg, und `isStale()`-Assertions werden trivial grün. `new QueryClient()` nehmen;
  Tests **mit** gerenderter Komponente dürfen `neuerQueryClient()`.
- Charakterisierungstests bauen ihre Keys als **Literale**, nicht über die Factory. Sonst sind
  beide Seiten aus derselben Quelle gebaut und matchen auch bei kaputter Factory (gemessen:
  `adminKarte()` verbogen → Literal-Variante rot, Accessor-Variante grün geblieben).

Die org/instanz/extern-Gliederung in `GLOBAL_KEYS` ist **Dokumentation**, nicht maschinell
erzwungen (gemessen: kein `qc.clear`/`removeQueries`/`resetQueries` im Produktivcode, also kein
Konsument). Kommt einer dazu, gehört sie in eine XOR-Partition nach dem Muster von
`NICHT_LIVE_KEYS` gehoben.

## Frontend — Lint-Disziplin

`pnpm lint` läuft mit `--max-warnings 0`: Warnings brechen das Gate genauso hart wie
Errors (LFH-168). Sie werden **behoben, nicht ignoriert** — und zwar an der Wurzel:

- `react-hooks/exhaustive-deps` strukturell lösen (z. B. Primitive statt Objekt in die
  Deps, `useMemo`/`useCallback` zur Identitäts-Stabilisierung), nicht die fehlende
  Dependency stumpf hineinzwingen, wenn das den Effekt ungewollt neu auslösen würde.
- `eslint-disable` nur als **begründete Ausnahme**, wenn der echte Fix nachweislich falsch
  wäre (z. B. eine Dependency, die den Effekt bewusst *nicht* neu triggern soll): dann
  zeilengenau (`eslint-disable-next-line <regel>`) **an der gemeldeten Stelle** — die
  exhaustive-deps-Warnung sitzt auf der Deps-Array-Zeile, nicht auf dem `useEffect(` — und
  **mit Kommentar, warum**. Keine pauschalen Datei-/Block-Disables, keine toten Direktiven
  (eslint meldet ungenutzte Disables selbst). Referenz: `LagekartePage` Blob-URL-Effekt (LFH-166).

## Qualitäts-Gates — ein Kommando (LFH-235/F17)

Es gibt weiterhin **kein CI**. Die Durchsetzungsinstanz ist lokal:

```bash
./scripts/check-all.sh     # alle Gates, vor dem Merge
```

Reihenfolge (billig → teuer): `check-fmt.sh` → `pnpm lint` → `check-typ-codegen.sh`
(enthält `tsc`) → `cargo test --workspace` → Vitest → `check-deps.sh` → `pnpm e2e`.

- **Env-Hygiene ist Teil des Gates.** `scripts/lib/dev-env.sh` räumt alle
  `LIFELINE_*`/`KS_*`/`AWS_*`-Variablen aus dem Testlauf. Nicht durch eine handgepflegte
  `env -u`-Liste ersetzen — genau deren Drift (3 Einträge gegen 13 gesetzte Variablen)
  hat die Suite unbemerkt rot gefärbt. Wo möglich gehört die Isolation **in den Test**
  (`config::tests::parse_hermetisch`, `karte::KarteConfig`), nicht in den Wrapper: ein
  Gate, das nur durch seinen eigenen Wrapper grün ist, verfehlt den Zweck.
- **Optionaler pre-push-Hook** (nur die schnellen Gates, ~1 min):
  `git config core.hooksPath .githooks`. Die vollen Suiten bleiben bewusst draußen —
  ein Hook, der jeden Push minutenlang blockiert, wird per `--no-verify` umgangen.
- **Bewusst nicht im Gate:** `cargo clippy -D warnings` — der Bestand hat ~27 Warnungen,
  ein rot geborenes Gate wird abgeschaltet statt befolgt.
- **e2e läuft als Schritt 7 mit** (LFH-309): die Playwright-Suite ist selbsttragend —
  sie startet Backend und Vite selbst auf freien Ports, mit Temp-DB je Lauf, und stört
  einen parallel laufenden Dev-Stack auf 8080/5173 nicht. **`pnpm e2e` braucht kein
  separat gestartetes Backend mehr**; der alte Hinweis „Backend muss separat laufen
  (siehe Step 5)" verwies auf einen Schritt, den es im Repo nie gab, und ist weg.
  Bauen kann die Suite das Binary nicht, deshalb fährt Schritt 7 nur, wenn
  `target/debug/lifeline-hub` existiert, und überspringt sonst mit lautem Hinweis statt
  zu brechen. Praktisch greift dieser Guard im Sammel-Gate nie, weil `cargo test
  --workspace` (Schritt 4) das bin-Target ohnehin mitbaut — e2e ist hier also faktisch
  immer dabei (+~30 s). Der Guard schützt die Fälle daneben: verkürzte Läufe, einzeln
  von Hand aufgerufene Schritte.
- **Kein `| tail` um Gate-Kommandos** — das maskiert den Exit-Code, und eine rote Suite
  sieht dann grün aus.

`scripts/check-deps.sh` (LFH-253/G01) prüft Abhängigkeiten gegen RUSTSEC/GHSA. Fehlt
`cargo-audit`, warnt es laut und exitet 0 statt zu brechen. Bekannte, bewertete Advisories
stehen mit Begründung in `.cargo/audit.toml` — was dort **nicht** steht, bricht den Build.

## Backend↔Frontend — Typ-Codegen (LFH-120)

Die Frontend-Response-Typen werden **aus dem Rust-Backend generiert**, nicht mehr von Hand
gepflegt. Wahrheitsquelle: die `#[derive(ToSchema)]`-Response-Structs + Domänen-Enums →
`src/api_doc.rs` (utoipa `ApiDoc`) → `frontend/src/api/openapi.json` → `openapi-typescript`
→ `frontend/src/api/types.generated.ts`. `frontend/src/api/types.ts` ist nur noch ein
**Re-Export-Barrel** über die generierten Schemas (Namens-Mapping Rust `XxxAnzeige` ↔ FE `Xxx`).

- **Nach einer Backend-Typänderung** (Struct-/Enum-/Feld-Änderung an einem Response-DTO):
  `scripts/check-typ-codegen.sh` laufen lassen und die regenerierten `openapi.json` +
  `types.generated.ts` **mitcommitten**. Das Skript ist das Drift-Gate (kein CI): es emittiert
  die Spec, regeneriert die TS, bricht per `git diff --exit-code`, wenn etwas nicht committet
  ist, und fährt `tsc`. Ein Feld-Rename bricht damit Build/Test statt still zur Laufzeit.
- **Enum-Werte:** Domänen-Enums tragen wire-korrektes `#[serde(rename…)]`; `String`-Felder,
  die eine Union tragen, bekommen `#[schema(value_type = Enum)]` (bei `Option<String>`:
  `value_type = Option<Enum>` — sonst verliert utoipa die Nullability). Neue/geänderte
  Enum-Varianten müssen im Guard `tests/enum_wire_kontrakt.rs` gegen ihren Wire-String stehen.
- **Noch handgepflegt** (bewusst, FE-lokal in `types.ts`): Request-/Input-DTOs (`NeuerX`/`PatchX`,
  PATCH-null-vs-absent-Semantik) und die 2 `Record<>`-Maps. Der Pfad-/Operations-Contract
  (`#[utoipa::path]`) ist additiv nachrüstbar, in v1 nicht enthalten.
- **Optionalität ehrlich machen (Norm ab LFH-265):** `Option<T>`-Felder von Response-DTOs
  bekommen `#[serde(skip_serializing_if = "Option::is_none")]` — sonst schickt das Backend
  `feld: null`, während der generierte Typ `feld?: T | null` sagt, und der Client kann `absent`
  und `null` nicht auseinanderhalten. Bei Feldern, die **kein** `Option<T>` sind, aber
  `#[serde(default)]` tragen, ist `skip_serializing_if` **falsch** (es würde den Default-Wert
  weglassen = echte Wire-Verschlechterung); dort macht `#[schema(required)]` die Spec ehrlich
  (gemessen: das Feld landet in `required`). **Norm ja, Sweep nein** — verbindlich für neue und
  ohnehin angefasste Felder, kein Bestands-Sweep.
  **Testfalle:** `assert_eq!(v["feld"], Value::Null)` unterscheidet einen FEHLENDEN Key nicht
  von `null` — serde_json liefert beim Index-Zugriff auf ein Object in beiden Fällen `Null`.
  Presence wird deshalb per `v.as_object().unwrap().contains_key("feld")` geprüft; sonst bleibt
  der Test nach der Umstellung grün und belegt nichts (`tests/ort_vorschau.rs` ist die Referenz).

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Der clamd-Virenscan der Uploads (`src/anhang/mod.rs`) hängt am Cargo-Feature `clamav`, das
seit LFH-224 **Default-AN** ist: `clamav-client` ist ein reiner Rust-INSTREAM-Client (nur
`tokio`, kein FFI/keine Signatur-DB im Prozess) → das Binary bleibt **single-binary**. Der
echte Scanner `clamd` ist unvermeidlich ein **separater Laufzeit-Daemon** (Sidecar/systemd/apt);
ohne `--clamav-addr` ist der Seam ein **No-op** → kein zweiter Prozess nötig, kein Compose.
Verhalten: keine Adresse → No-op; Adresse + erreichbarer clamd → echter Scan (Fund → 422);
Adresse + clamd weg/Timeout → **fail-closed 503** (Default) bzw. `--clamav-fail-open` → durch.

**Folge fürs Testen:** Der Scan-Pfad läuft jetzt im **Default-`cargo test`** (rottet nicht mehr
still). Der reine No-op-/Fehlkonfig-Stub (`#[cfg(not(feature = "clamav"))]`) läuft nur unter
**`cargo test --no-default-features`** — wer `src/anhang/mod.rs`/`clamd_scan` anfasst, sollte
beide fahren. Der Scan-Wiring-Test (`tests/karte_hintergrundbild_scan.rs`) übt gegen
`127.0.0.1:1` (ECONNREFUSED) in BEIDEN Builds den fail-closed-503-Pfad. Es gibt kein CI.

## Backend — Statuscode-Konvention (LFH-267/F22)

Die in `src/error.rs` dokumentierte Konvention ist **verbindlich**. Sie ist bewusst **am
Bestand ausgerichtet** (F22 Teil B): wo Doku und Code auseinanderliefen, wurde die Doku
angepasst, statt ~59 Handler umzuschreiben, die niemand als falsch empfand.

| Code | `AppError`-Variante | Wann |
|---|---|---|
| **400** | `Validation` | **Das Feld für sich** ist unbrauchbar: kaputtes JSON, falscher Feldtyp, **unbekannter Enum-Wert** (Body *und* Query-Filter), strukturell fehlendes Pflichtfeld, **vorhandenes aber leeres Pflichtfeld** |
| **422** | `UnprocessableEntity` | Jedes Feld für sich ist in Ordnung, aber **der Zusammenhang** verbietet die Aktion: XOR-verletzende Feld-Kombination, **ungültiger Status-Übergang**, Zustandsverletzung |
| **409** | `Conflict` | **Nebenläufigkeit** oder **Lebenszyklus**: CAS-/Sperrkonflikt, storniertes Objekt |

Trennlinie 400 ↔ 422: **400 bewertet das Feld isoliert** — fehlt es, ist es vom falschen Typ,
trägt es einen unbekannten Enum-Wert oder ist es leer, dann ist die Eingabe schon für sich
genommen unbrauchbar. **422 bewertet erst den Zusammenhang** — die *Kombination* mehrerer
Felder oder der *Zustand des Objekts* verbietet die Aktion.

Ein leeres Pflichtfeld ist deshalb **400**, nicht 422: es scheitert am Feld, nicht am
Zusammenhang. Das ist auch, was die klare Mehrheit im Bestand tut (`AppError::Validation` mit
„… darf nicht leer sein" in `einsatz.rs`, `benutzer.rs`, `meldung.rs`, `nachforderung.rs`,
`etb.rs`, `karte.rs`, `sprechgruppe.rs`, `erinnerung.rs` u. a.). Das Frontend unterscheidet
400 und 422 nicht (keine Status-400-Prüfung), der Unterschied ist reine API-Hygiene.

Referenz-Testpaare für die Linie:

- **400 auf beiden Wegen** — `tests/freies_zeichen.rs`: `fehlendes_grundzeichen_ist_400`
  (scheitert am Extractor, `String` ohne `#[serde(default)]`) und `leeres_grundzeichen_ist_400`
  (scheitert an der Handler-Validierung).
- **422 aus dem Zusammenhang** — `tests/einsatz_schaden.rs`: `geschaedigt_beide_felder_ist_422`
  (Feld-Kombination) und `uebergeben_aus_abgeschlossen_ist_422` (Status-Übergang).

**409 hat ZWEI Quellen, die nicht verschmelzen dürfen** (Ursache des LFH-299/300-Fehlers):

1. **CAS / optimistisches Lock** — `basis_geaendert_at` passt nicht (`schaden/repo.rs`,
   `tier/repo.rs`). Das Frontend bietet hier einen Überschreiben-Dialog an.
2. **Lebenszyklus / Storno** — das Objekt ist storniert o. ä. (`einsatz_schaden.rs`).
   Ein Überschreiben-Dialog ist hier **sinnlos** und führt in eine Endlosschleife.

Die Unterscheidung ist im Frontend heute nur **Heuristik**, kein Vertrag: `istKonflikt`
(`frontend/src/api/client.ts`) prüft bloß `status === 409`; getrennt wird erst über den
`!v.overwrite`-Zweig in `SchaedenDetailPage.tsx` / `TiereDetailPage.tsx`. **Wer einen neuen
409 in einer Route mit CAS-Dialog einführt, muss diesen Zweig mitziehen** — sonst läuft die
Seite wieder in „Überschreiben?"-Schleifen. Ein maschinenlesbarer Fehler-Code im `{error}`-Body
wäre die saubere Lösung und ist bewusst vertagt.

**Die Konvention gilt in jeder Schicht**, nicht nur in `src/routes/`. Die ~89
`AppError::Validation`-Stellen in `repo`/`parse`/`config` wurden bewusst **nicht** auditiert
(kein Sweep über den Bestand) — die Regel ist verbindlich für Neues und für Stellen, die man
ohnehin anfasst.

**Angleichung erledigt (LFH-305).** Die früher hier gelisteten Abweichungen sind aufgelöst:
unbekannte Enum-Werte liefern jetzt 400 in `einsatz_schaden.rs` (Query-Filter, Anlegen,
PATCH), `gefahr.rs`, `lage_zone.rs`, `befehl.rs`, `lagebericht.rs` und `organisation.rs`;
die Pflichtfeld-Ausreißer in `einsatz_schaden.rs` (Anlegen, PATCH, Übergabe-Adressat,
Abschlussgrund) sind entwirrt und unterscheiden „fehlt" / „ist leer" / „ist unbekannt" jetzt
per eigener Meldung. Wer hier etwas zurückdreht, dreht eine getestete Entscheidung zurück.

**Referenz-Testpaar für die feine Linie** — zwei Stellen, die gleich aussehen und es nicht
sind: `einsatz_schaden.rs`/`abschliessen` ist ein **dedizierter** Aktions-Endpunkt, der
Abschlussgrund ist dort unbedingt Pflicht → das Feld scheitert isoliert → **400**
(`abschliessen_ohne_grund_ist_400`). `einsatz_tier.rs`/`status` ist der **generische**
Status-Endpunkt, der Grund ist dort nur bei Zielstatus `abgeschlossen` Pflicht → das ist ein
Zusammenhang → **422** (`abschluss_ohne_grund_ist_422_und_mit_grund_ok`), während der
*unbekannte* Enum-Wert derselben Stelle 400 liefert. Beide Stellen tragen einen Kommentar,
der auf die jeweils andere verweist — wer sie „harmonisiert", bricht einen gepinnten Test.

**Nicht betroffen, legitimes 422 — beim nächsten Sweep NICHT mitkippen:**
`lage_zone.rs` (Typ × Geometrie-Klasse, kaputtes GeoJSON, `geometrie.type` ≠ `geometrie_typ`,
Gefahrengebiet-Zuordnung an eine Nicht-Gefahrengebiet-Zone — alles Feld-*Kombinationen*),
`gefahr.rs` (Gefahrentyp × Schutzobjekt), `einsatzabschnitt.rs:261` (kaputtes GeoJSON),
`sprechgruppe/repo.rs:207` (referenzielle Zuordenbarkeit), `auth.rs:1288` („Code ungültig" —
ein TOTP-Einmalcode scheitert am kryptographischen Vergleich, nicht an der Form; das ist ein
Zustandsfehler), `einsatz_uhs.rs:264/270/277/516` (lat/lon-Paar, Koordinaten- und
Mengen-Ranges) und `einsatz_uhs.rs:359` (Status-Übergang). **`einsatz_uhs.rs` hat keine
Enum-Abweichung** — alle sieben Enum-Parse-Stellen der Datei nutzen bereits `Validation`.

**Vorsicht bei `einsatz_schaden.rs`/PATCH und `einsatz_tier.rs`/Status:** dort binden die
Repos `typ`/`ausmass`/`abschluss_grund` als **rohen String**, und die CHECKs aus
`migrations/0033` bzw. `0031` kommen über das Sicherheitsnetz unten wieder als **422**
heraus. Entfernt man einen Handler-Precheck, antwortet die Route also lautlos wieder mit dem
alten Code statt mit 500 — ein Test, der 422 erwartet, wäre auch ganz ohne Precheck grün.
Nur die 400-Erwartung beweist, dass der Precheck vor der DB greift (per Mutationsprobe belegt).

**Sicherheitsnetz (LFH-245):** nicht vorab abgefangene DB-Constraint-Verletzungen bekommen in
`AppError::status()` automatisch einen fachlichen Code — UNIQUE/FK → **409**, CHECK → **422**,
statt eines nackten 500. Per-Handler-Prechecks bleiben für präzise Meldungen zuständig.

**Extractor-Vertrag:** Handler nehmen Request-Bodies **ausschließlich** über
`crate::extract::JsonBody` entgegen, nie über `axum::Json` — nur so folgt auch eine
Deserialisierungs-Rejection dem `{error}`-JSON-Format. `axum::Json` bleibt für **Responses**
richtig. Erzwungen von `tests/json_extractor_guard.rs`; querschnittliche Fehlerfälle
(405, unbekannter API-Pfad, kaputter Body) deckt `tests/fehler_vertrag.rs` ab.
Noch offen (LFH-317, abgespalten von LFH-305): `Path`-Rejections antworten weiterhin
`text/plain`. Bewusst **nach** der LFH-121/230-Kontextmigration einzuplanen — jedes Modul, das
auf den typisierten `EinsatzKontext`-Extractor wechselt, verliert sein rohes `Path` und damit
den Swap.
