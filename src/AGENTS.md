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
Lebenszyklus (storniert) · **413** `PayloadTooLarge` — Body über dem Limit der Route, vor dem
Handler (`JsonBody`, LFH-1074).
- Referenzpaar, nicht „harmonisieren": `tests/einsatz_schaden.rs`
  (`abschliessen_ohne_grund_ist_400` gegen `abschluss_ohne_grund_ist_422_und_mit_grund_ok`).
  Reine 400er-Referenz: `tests/freies_zeichen.rs` (`ohne_zeichenform_ist_400`,
  `leere_zeichenform_ist_400`, `altes_format_ist_400`; seit LLH-1160 gibt es dort keinen 422 mehr).
- **409 hat zwei Quellen:** CAS (Zeilen-CAS `basis_geaendert_at` in `schaden/repo.rs`,
  `tier/repo.rs`; Feld-CAS `erwartet` in `person/repo.rs`; Rückfrage „Zwischenzeitlich
  geändert“ mit Überschreiben) und Lebenszyklus (kein Dialog). Das Frontend trennt nur
  heuristisch (`istKonflikt` in `frontend/src/api/client.ts`, `!v.overwrite`-Zweig in
  `SchaedenDetailPage.tsx`/`TiereDetailPage.tsx`) — ein neuer 409 in einer
  CAS-Route zieht den Zweig mit.
- **CAS-Baseline beim Öffnen einfrieren**: das Sammelbearbeiten von Tier und Schaden über
  `components/useEditSitzung.ts` (gebrandete `CasBasis`; `starte` nimmt den Datensatz); Test
  braucht ein gemountetes `<Form form={form}>`.
- **Personendaten nutzen Feld-CAS** (LLH-1103, design.md D1 der Change
  `f8218h1i-personendaten-feldweise`): der PATCH `…/personen/{pid}` trägt in `erwartet` je
  geändertem Feld den Wert beim Öffnen (`null` = leer, Koordinate nur als Paar), und
  `person::repo::aktualisiere` hängt je Feld `AND <spalte> IS ?` an. Sichtung, Status, PAT oder
  ein anderes Feld lösen so keinen 409 aus; ein Altwert ohne Änderung desselben Felds und eine
  halbe Koordinate sind 422, ein leerer Altwert trifft auch eine leere Zeichenkette,
  ohne `erwartet` wird ohne Vergleich geschrieben. `basis_geaendert_at` bleibt als Wire-Feld für
  ältere Clients.
- Legitimes 422 bei Sweeps nicht mitkippen (`lage_zone.rs`, `gefahr.rs`, `einsatzabschnitt.rs`,
  `sprechgruppe/repo.rs:pruefe_zuordenbar`, `auth.rs` „Code ungültig", `einsatz_uhs.rs`).
- Handler-Prechecks vor der DB bleiben (`einsatz_schaden.rs`/PATCH, `einsatz_tier.rs`/Status) —
  nur die 400-Erwartung belegt sie. Sicherheitsnetz
  `AppError::status()`: UNIQUE/FK → 409, CHECK → 422.
- **Extractor-Vertrag:** Bodies nur über `crate::extract::JsonBody`, Route-IDs nur über
  `crate::extract::PfadParam` (`tests/json_extractor_guard.rs`, `tests/path_extractor_guard.rs`,
  `tests/fehler_vertrag.rs`), damit Rejections im `{error}`-Format ankommen. `PfadParam` → 400,
  `EinsatzKontext` → 404 (`src/einsatz/kontext.rs`); beide sind orthogonal.

## Backend — Eingabegrenzen (LFH-937, LFH-1074)

Spec `eingabegrenzen`, Herleitung
`openspec/changes/archive/2026-10-06-lfh-937-eingabegrenzen/design.md`. Neu und Angefasstes:
- **Freitext an einem Schreibendpunkt hat eine Grenze:** Konstante `<FELD>_MAX` im Modul, das
  das Feld besitzt, Prüfung über `routes::support::pflicht_max`/`pflicht_max_tri`/`optional_max`
  (`hoechstens` für schon getrimmten Text): Zeichen nach dem Trimmen, 400
  „{Feld} darf höchstens {max} Zeichen lang sein“, vor jedem 422 des Zusammenhangs.
- **Text, der unverändert ins ETB gelangt, trägt die ETB-Grenzen** (`etb::INHALT_MAX`,
  `etb::PARTEI_MAX`) an seinem Eingang, nicht in `etb::repo`: Systemtexte dürfen dort nicht
  scheitern. Ein neuer Weg ins ETB prüft selbst.
- **Listen von außen** werden gegen ein `*_MAX` geprüft (400) und entdoppelt, bevor eine
  Abfrage läuft. **ID-Listen** brauchen zum Prüfen und Schreiben eine von N unabhängige Zahl
  von Anweisungen (`json_each(?)`, Muster `sprechgruppe::repo::ersetzen_tx`); die
  **Auftragsempfänger** bleiben je Zeile geprüft und geschrieben, gedeckelt durch
  `auftrag::EMPFAENGER_MAX` (gezählt vor dem Entdoppeln). Die **Sammel-Disposition**
  (`kraefte_disposition`, LLH-1100) prüft ihre Menge in einer `json_each`-Abfrage je Art, schreibt
  aber je Kraft (Disposition, Zeitachse, Einheit, Besatzung), gedeckelt durch
  `kraefte_disposition::SAMMEL_MAX` (gezählt vor dem Entdoppeln); eine Ablehnung nennt den Grund
  je Zeile (`AppError::Zeilen`, 422 `{error, zeilen}`) und schreibt nichts. Ebenso das **Bilden
  aus einer Vorlage** (`einheit::aus_vorlage`, LLH-1049): eine `json_each`-Abfrage je Art für
  den Zustand, Schreiben je Kraft über den Baustein, gedeckelt durch `SAMMEL_MAX` je Liste und
  `aus_vorlage::KNOTEN_MAX` Einheiten. Ebenso der **Vollzug der Ablösung** (LLH-1132): Prüfen
  und Schreiben der Ablöser-Liste über `json_each`, Folgeschichten je Ablöser, gedeckelt durch
  `abloesung::ABLOESER_MAX`; beim Besatzungswechsel (LLH-1150) Prüfen der neuen Besatzung und
  Umhängen beider Besatzungen über `json_each`, Zeitachse und Zeile je Person, gedeckelt durch
  `abloesung::BESATZUNG_MAX`.
- **Geometrien** von Zonen und Flächen gehen durch `lage_zone::pruefe_geometrie_groesse` und
  `pruefe_geometrie_struktur` (400); kaputtes JSON und falscher Typ bleiben 422.
- **Body-Limit** (LFH-1074): jede Route nimmt höchstens `JSON_BODY_MAX` (256 KiB, `app.rs`) an,
  sonst 413 vor dem Handler; kein legitimer JSON-Body kommt darüber (Sweep vom 09.10.2026). Ein
  eigenes Limit trägt nur eine Route, deren legitimer Body größer sein kann, als Konstante in
  `app.rs`/`transfer.rs` (`tests/zulassung_guard.rs`):
  - Anmeldung, Zweitfaktor, Code-Einlösen, Koppeln (4 KiB), Passkey-Abschlüsse (16 KiB): enger,
    öffentlich.
  - Uploads (`UPLOAD_BODY_MAX`), Logo (1 MiB + 64 KiB): Multipart mit Datei.
  - Zone anlegen, Abschnittsfläche setzen (`GEOMETRIE_BODY_MAX`, 320 KiB): Geometrie bis 256 KiB
    plus Rahmen, damit die Geometrieprüfung (400) die wirksame Grenze bleibt.
  Ein neues Feld, das den Body über 256 KiB tragen kann, braucht zuerst eine Feldgrenze, dann eine
  Ausnahme hier.
- **Spiegel:** jede Grenze, die eine Maske kennt, steht in `frontend/src/api/eingabegrenzen.ts`;
  `tests/eingabegrenzen_spiegel.rs` vergleicht Name für Name. Neue Grenze → beide Seiten und
  die Tabelle im Test.

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
`uhs-anhaenge`; Herleitung `openspec/changes/archive/2026-10-02-lfh-758-anhaenge-tiere-uhs/design.md`): Liste, Ablage, Soft-Delete und Download-Lookup stehen EINMAL im Kern
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
- **UHS-Plan (LFH-999)** (Spec `uhs-plan`, Herleitung
  `openspec/changes/archive/2026-10-05-lfh-999-uhs-plan-hintergrund/design.md`): der Plan unter
  dem Platz-Layout ist **kein Anhang**, sondern eigene, bereinigte Bytes in `uhs_plan` (einer je
  UHS, `uhs::plan`, `routes::uhs_plan`). Seine Anzeige (`GET …/uhs/{uid}/plan/bild`) schreibt
  weder Lese-Audit noch ETB; nur die Übernahme aus einem UHS-Anhang (`…/plan/aus-anhang`) ist
  EIN protokollierter Abruf, vor dem Lesen der Bytes über `support::anhang_bereinigt_kopieren`.
  Keinen Verweis vom Plan auf einen Anhang einführen: das Audit verlöre seine Aussage.

**Personen-Anhänge (LFH-757)** (Spec `personen-anhaenge`, Herleitung
`openspec/changes/archive/2026-10-02-lfh-757-personen-anhaenge/design.md`): `einsatz_person_anhang` im Register;
`routes::person_anhang`, sonst wie Schaden-Anhänge (Linker-id, `ERLAUBTE_MIME_ERFASSUNG`, eine
Transaktion, Soft-Delete, ETB „Person R-007: Foto abgelegt“). **Lese-Audit:** `datei` schreibt
nach Fassung-, Linker- und Original-Prüfung und VOR `anhang_antwort` eine Zeile `anhang` in
`person_zugriff_audit`, auch bei 304, Original und den Vorschau-Fassungen; scheitert sie, keine
Bytes. Liste ohne Audit. Die Detailseite zeigt deshalb kein Vorschaubild (`vorschau: false`).

**Dokument-Anlagen (LFH-1028)**: `lagebericht_anlage` und `befehl_anlage` im Register, eine
Umsetzung für beide Dokumentarten (`vorlagendokument::anlage`, `Dokumentart::ANLAGEN`). Arten
`fernmeldeskizze` und `lageplan` (LLH-1051); eine neue Art braucht Variante UND CHECK-Neubau
beider Linker (Muster `0230_dokument_anlage_lageplan.sql`). Nur PNG
(`ERLAUBTE_MIME_ANLAGE`), höchstens zehn je Dokument; Ablegen und Entfernen nur im Entwurf, in der
Transaktion geprüft (422). Entfernen löscht die Bytes (der Entwurf steht nicht im ETB); die
Freigabe schreibt den Abschnitt „Anlagen“ in denselben ETB-Snapshot, das Fortschreiben kopiert
Bytes und Stand in die neue Version. Keine Originalfassung (400). Die Schwärzung nimmt die Anlage
mit der Kategorie `anhaenge`, der ETB-Wortlaut bleibt.

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

**Vorschau (LFH-759)** (Spec `anhang-vorschau`, Herleitung
`openspec/changes/archive/2026-10-02-lfh-759-bildvorschau-anhaenge/design.md`):
- `?fassung=vorschau` (≤ 256 px) und `grossansicht` (≤ 1600 px) laufen durch dieselbe
  `anhang_antwort`, mit den Gates der Route und ohne ETB-Vermerk. `anhang::vorschau` kodiert
  JPEG/PNG/GIF/WebP/TIFF neu (Ausrichtung angewendet, keine Metadaten), in `spawn_blocking` und
  höchstens `VORSCHAU_PARALLEL` zugleich: `platz_holen` vor dem BLOB, der Platz geht mit der
  Arbeit (`erzeugen_mit_platz`), ein Abbruch gibt ihn nicht frei; gespeichert wird nichts. HEIC/HEIF → 422, das dekodiert
  der Browser. Wer die Erzeugung ändert, erhöht `VORSCHAU_VERSION` (ETag `"<sha256>.v<n>.<k|g>"`).
- `inline` und `image/jpeg` nur für diese beiden Fassungen; alles andere bleibt `attachment` mit
  gespeichertem `mime`. Jede Anhang-Antwort trägt `nosniff` (auch ohne die Schicht, s.
  „Schutzköpfe“) und `ANHANG_CSP`.
- Frontend: Bild-Anhänge zeigen `components/AnhangVorschau.tsx` (über `DownloadAnker` mit `mime`
  oder direkt), nie ein `<img>` auf die Download-Adresse und nie `fassung=original` zur Anzeige.
  In einer Überlagerung ohne Bedienelemente (Palettenvorschau) `grossansicht={false}`.
  Eine künftige App-CSP muss `img-src blob:`, `worker-src 'self'` und `'wasm-unsafe-eval'`
  erlauben (HEIC-Decoder, `frontend/src/heic/`).
- **HEIC-Decoder austauschbar halten** (LGPL 3.0, LFH-1000, `frontend/src/heic/LIESMICH.md`):
  Glue und WASM von libheif gehen unverändert unter `/bibliotheken/libheif/` aus, nie in einen
  Chunk unter `assets/` gebündelt (Build-Wächter in `frontend/vite.config.ts`); der Worker lädt
  sie zur Laufzeit. `static_files.rs` liefert sie mit `no-cache` und ETag und nimmt aus
  `--heic-decoder-verzeichnis` genau diese zwei Namen.

## Backend — Schutzköpfe (LFH-797)

- **Jede Antwort trägt `X-Content-Type-Options: nosniff`** über die äußerste Schicht in
  `app.rs` (`SetResponseHeaderLayer::if_not_present`, Spec `http-schutzkoepfe`), auch Panik-500,
  Lastabwurf, 405 und der Frontend-Fallback. Eine neue Route braucht dafür nichts.
- Eine Route darf den Kopf zusätzlich selbst setzen (Anhang, Logo, Karten-Assets: dort sichern
  ihn Handler-Tests ohne Router); `if_not_present` hält ihn einfach. Nachweis
  `tests/schutzkoepfe.rs`.
- Unter `nosniff` verwirft der Browser Skripte und Styles mit falschem Typ: jede neue Endung in
  `static_files::content_type` braucht ihren richtigen MIME-Typ. Weitere Köpfe (App-CSP, HSTS
  …) sind eine eigene Entscheidung, s. „Anhänge“ zur CSP.

## Backend — Antwortkompression und Phasenlisten (LFH-940)

- **Gepackt wird nur JSON ab 1 KiB ohne `ETag`/`Cache-Control`** (`CompressionLayer` mit
  `nur_json_ab` in `app.rs`, gzip und br, Stufe fest `ANTWORT_KOMPRESSION_STUFE`). SSE puffert
  sonst, Anhänge, Kacheln und Frontend-Dateien bleiben roh; Brotli auf Vorgabestufe 11 kostet
  den kleinen Server mehr, als es spart. Ein neuer
  Antworttyp, der gepackt werden soll, kommt ins Prädikat, nicht als zweite Schicht. Nachweis
  `tests/antwortkompression.rs`.
- **Eine Liste, die mit dem Einsatz wächst, trennt nach Phase** (`kommunikation::phase_und_seite`):
  `phase=offen` ungeblättert, `phase=abgeschlossen` mit Cursor `vor_zeit` + `vor_id` (beide
  oder keiner, sonst 422), Ordnung Abschlusszeit absteigend und `id` als Gleichstand, `limit`
  geklemmt auf `[1, SEITE_MAX]`. Zahlen über den ganzen Bestand kommen aus einem eigenen
  `…/kennzahlen`-Abruf über dieselben SQL-Fragmente, nie aus der geladenen Seite.
  Ausnahme: Verlaufsreihen je Stelle (Belegungsreihe der Betreuungsstelle, Verlauf des
  Bereitstellungsraums) sind ungeblättert und laden beim Aufklappen; die Reihe einer Stelle
  bleibt klein (Specs `betreuung-meldeverlauf`, „Meldereihe einer Betreuungsstelle lesen“, und
  `bereitstellungsraum-belegung`, „Verlauf eines Raums lesen“).
- **In einer geblätterten Liste steht jede Einschränkung, die Zeilen ausblendet**
  (Gerätebindung), im SQL vor dem `LIMIT`. Ein `retain` danach machte Seiten kurz und den
  Cursor falsch.
- **Auswahlfelder lesen eine Projektion ohne Freitexte** (`…/personen/auswahl`,
  `…/schaeden/auswahl`), nicht die Vollliste.
- **Das Presse-Log trennt nach Phase wie die Meldungen** (LFH-1075), Ordnung und Cursor über
  `eingang_at`; offen ist nur `offen`. `…/medienkontakte/kennzahlen` trägt Zahlen und Namen der
  Medien, nie Personenbezug. `art=` (kommagetrennt, nur mit `phase`) engt beide Phasen vor dem
  `LIMIT` ein (LLH-1096, Kopffilter „Art“).
- **Ausnahme: das Informationstelefon blättert ohne Phase** (LLH-732): ein Protokoll ist eine
  gemischte Zeitachse, und bei einer Großlage gehen auch die offenen Rückrufe in die Hunderte.
  `…/infotelefon` liefert immer eine Seite (`kommunikation::parse_page`, Cursor `eingang_at` + `id`),
  `status` ist Filter, nicht Phase; `…/infotelefon/zaehler` zählt über dieselbe
  `filter_clause` (Parität in `tests/infotelefon_zaehler.rs`).
- **Eine Liste mit wählbarer Sortierung blättert über Schlüssel und Nummer** (LFH-1075,
  `schaden::repo::SortSpalte`): `sortierung=<spalte>_<ab|auf>`, Cursor `vor_wert` + `vor_nr`,
  Gleichstand über die Registriernummer in derselben Richtung; Sortierung oder Cursor ohne
  `limit` 422. Suche per `LIKE … ESCAPE '\'` mit maskiertem `%`/`_` über dasselbe WHERE-Fragment
  wie die Kennzahlen. Ohne `limit` bleibt die Vollliste (Druck, Bericht, Snapshot).
- **Suche einer geblätterten Liste: `q` getrimmt, leer = keine Suche, über 200 Zeichen 400**,
  Muster nur aus `db::suche::like_muster`. Die Auftragsliste trägt sie wie die Schadenliste
  (`…/auftraege?q=` und `…/auftraege/kennzahlen?q=`: Kennung `#n`, Text, Empfänger).

## Backend — Benutzername und KDF (LFH-921, LFH-981)

Spec `passwort-anmeldung`, Herleitung
`openspec/changes/archive/2026-10-05-lfh-921-981-anmeldung-benutzername/design.md`.
- **Ein Name von außen geht durch `auth::benutzername::normalisiere`** (Trim, höchstens 128
  Zeichen, sonst 400) — als erster Schritt, vor Sperre, Audit und Log. Login, Passkey-Start,
  Anlage und `bootstrap_admin` tun das; ein neuer Eingang auch.
- **Ein Name von außen wird mit `benutzername = ? COLLATE NOCASE` gesucht**; eindeutig ist er ohne
  Groß-/Kleinschreibung (Index aus `0151`, Verstoß → 409). `NOCASE` faltet nur A–Z; wer Namen
  vergleicht (SSO-Kollision, `rate_limit::konto`), faltet ebenso mit `to_ascii_lowercase`.
- Namen in `auth_audit` kürzt `audit::schreibe` selbst; Log-Felder der Anmeldung nehmen
  `benutzername::fuer_protokoll`. Die 429-Zeile nennt keinen Namen.
- **Nur ein 401 ist ein Fehlversuch** (`rate_limit::fehlversuch`, `login_fehlgeschlagen`); ein 503
  aus dem KDF-Gate geht unverändert durch.
- **Argon2 im Handler nur über `provider::password::hash_gedrosselt`** (KDF-Gate, Andrang,
  `spawn_blocking`). Synchrones `password::hash` bleibt `bootstrap.rs`, `dev/seed.rs` und Tests.
  Neue Passwörter höchstens 128 Zeichen (`pruefe_passwort_laenge`), sonst passen sie nicht in die
  4-KiB-Grenze des Logins.

## Backend — Admin-Spur (LFH-1005)

- **Eine Admin-Aktion, die den Zugang ändert, schreibt nach ihrem Commit genau einen Eintrag über
  `auth::admin_audit::schreibe`** (Tabelle `admin_audit`, nicht `auth_audit`): Konto anlegen,
  deaktivieren, reaktivieren, Rolle ändern, Zweitfaktor zurücksetzen, Anmeldeweg schalten. Auch
  ein zweiter Weg zur selben Wirkung (PATCH `bearbeiten`) schreibt; eine abgewiesene Aktion nicht.
- Der Eintrag schlägt nie nach außen durch (wie `audit::schreibe`). Eine neue Aktion braucht eine
  Variante in `AdminAktion` und eine Migration für den CHECK; Nachweis `tests/admin_audit.rs`.
- Frist 365 Tage (`admin_audit::AUFBEWAHRUNG_TAGE`), Purge-Lauf Phase C.
- **Gelesen werden Anmelde- und Admin-Spur nur über `routes::zugangsprotokoll`** (LFH-1097,
  `/mnt/project-files/lfh-1097/design.md`): nur System-Admin, das Lesen schreibt keine Spur, der
  Kontofilter wird wie beim Schreiben gekürzt (`benutzername::fuer_protokoll`) und mit
  `COLLATE NOCASE` verglichen; Nachweis `tests/zugangsprotokoll.rs`.
- **Jede Zeile trägt die Org als Schnappschuss** (`org_id`, LLH-1151, Migration 0191): gelesen
  wird `org_id = <Org des Admins> OR org_id IS NULL`. `audit::schreibe` setzt sie selbst (Konto,
  sonst versuchter Name), `admin_audit::schreibe` aus der handelnden Person; NULL heißt
  serverweit (versuchter Name ohne Konto). Ein Rebuild einer der Tabellen nimmt die Spalte mit.
  Nachweis `tests/zugangsprotokoll.rs` (`jede_org_liest_nur_ihre_spur`).

## Backend — Admin-Schreibwege am Einsatz (LFH-1066)

- **Ein System-Admin schreibt ohne Mitgliedschaft nur an Einsätzen seiner eigenen Org**; lesen
  darf er serverweit (Org-Floor, `darf_fremdeinsatz_lesen`). Eine Mitgliedschaft mit
  Schreibrolle trägt über die Org-Grenze. Fremd ohne Mitgliedschaft: 403, vor dem 409 des
  Freeze.
- Kopfdaten, Einstellungen und Führungsstelle tragen das zentral über
  `EinsatzVerwaltungszugriff` (`fordere_schreibrecht_oder_admin`); Frist-PUT, Kategorien-Frist,
  Original-Abruf und Modul-Override prüfen `benutzer.org_id == einsatz.org_id` im Handler. Ein
  neuer Admin-Schreibweg nimmt den Extractor oder dieselbe Prüfung, nie `ist_admin()` allein.
- Der Client spiegelt das über `BenutzerAnzeige.org_id` (`darfEinsatzVerwalten`,
  `darfModuleVerwalten` in `frontend/src/einsatz/schreibrecht.ts`). Nachweis
  `tests/einsatz_verwaltungsrecht.rs`.
- **Modul-Schreibwege nur mit Einsatzrolle, auch für den Admin** (LFH-1118):
  `EinsatzSchreibzugriff`, `EinsatzLeitungszugriff` und `fordere_schreibrecht` fragen allein die
  Rolle. Ihr Client-Spiegel `darfImEinsatzSchreiben`/`darfEinsatzLeiten` nimmt darum keinen
  Benutzer; eine Admin-Ausnahme gehört in eine Verwaltungsprüfung, nie in diese beiden.

## Backend — Org-Ereignisse (LFH-734)

Spec `org-live`; `src/live/org.rs`, `src/routes/live.rs`. Ereignisse `einsatzliste` und
`stammdaten` (`OrgLiveEvent`), Nutzlast `{}`, ohne `id:` und nie im Ring eines Einsatzes. Dazu
`org_benachrichtigung` (LLH-1207) mit Kennungen als Nutzlast, nur an ihren Empfänger
(`OrgEmpfaenger::Benutzer`, ohne Admin-Ausnahme), s. „Benachrichtigungen“.
- **`einsatzliste` nur über `live::org::einsatzliste_melden`** nach dem Commit (Leser = org-weite
  Leser, System-Admins, Mitglieder, dazu eine gerade entfernte Person); ein Löschweg liest die
  Leser VOR dem `DELETE` (`einsatzleser_lesen`, `Einsatzleser::melden`). Jeder `einsatz`-Emitter
  läuft über `live::org::kopf_melden`, das beide meldet: die Routen über
  `routes::einsatz::kopf_geaendert`, der Purge-Lauf direkt (LFH-996). Nie ein leeres Ereignis an die
  ganze Org für etwas Einsatzbezogenes: das ist der Metadaten-Kanal, den F01 geschlossen hat.
- **Katalog-Schreibrouten liegen unter einem Präfix aus `STAMMDATEN_PFADE`** (Middleware
  `stammdaten_live`); ein neuer Katalogpfad braucht einen Eintrag, Guard
  `tests/stammdaten_live_guard.rs`.

## Backend — Benachrichtigungen (LLH-1207)

Spec `benachrichtigungen`, Herleitung `openspec/changes/archive/2026-10-15-kcjecn9e-benachrichtigungskonzept/design.md`
(D1–D4, D6); `src/benachrichtigung/`, `src/routes/benachrichtigung.rs`.
- **Ein Schreibweg oder Scheduler meldet nach dem Commit nur über `benachrichtigung::melden`**
  mit einem `Anlass` (Art, Bezug, Auslöser per `von`, Adressaten per `an`). Wer etwas bekommt,
  entscheidet allein `aufloesung::empfaenger`: dort stehen alle Ausschlüsse (Auslöser,
  Gerätekonten, inaktive Konten, kein Leserecht am Einsatz oder am Modul des Bezugs,
  abgeschaltete Hinweis-Art). Kein Aufrufer filtert selbst, keiner schreibt in die Tabelle.
- **Kein Text in der Tabelle:** eine Zeile je Empfänger mit Art, Stufe und Bezug. Titel,
  Detailzeile und Pfad bildet `text::bilden` beim Lesen; die Detailzeile liest nur Retain-Spalten
  (Guard `detail_liest_nur_retain_spalten`). Eine neue Art braucht Variante, Titel, Migration
  für den CHECK (`check_listen_entsprechen_dem_katalog`) und ihre Stufe in `stufe()`; ein neuer
  Bezug sein Modul (`BenachrichtigungBezugTyp::modul`) und seinen Pfad.
- **Zustellung nur über `benachrichtigung::zustellen`:** Einsatz-Arten als `benachrichtigung`,
  EINE Nachricht je `melden` mit der Nutzlast je Empfänger (`LiveHub::publiziere_an`): ein Platz
  im Ring, gleich wie viele Empfänger. Der Strom gibt live und im Replay jeder Verbindung nur die
  Nutzlast ihres Nutzers, Fremden nichts (`LiveNachricht::fuer`, fail-closed ohne Liste); nie je
  Empfänger eine eigene Ring-Nachricht, das drängt bei Alarmen die anderen Clients in `lagged`.
  Org-Arten als `org_benachrichtigung`. Die Nutzlast trägt nur Kennungen, den Text holt der
  Client per `GET`.
- **Lesen prüft das Recht erneut** (`aufloesung::Leserecht`): fremd, unbekannt oder ohne Recht am
  Einsatz bzw. am Modul des Bezugs ist 404, nie 403.
- Ein Fehler in `melden` lässt die committete Anfrage nicht scheitern (geloggt). Aufräumen
  (quittiert nach 24 h, offen nach 12 h) läuft im Erinnerungs-Scheduler; mit dem Einsatz fallen
  die Zeilen per `ON DELETE CASCADE`. Nachweis `tests/benachrichtigung.rs`.
- **Für alle erledigt nur über `benachrichtigung::erledigen`** (LLH-1062): ist der Anlass selbst
  vorbei (eine gesichtete Meldung, eine gesehene Lagemeldung), quittiert es die offenen Zeilen
  ALLER Empfänger zu diesem Bezug und stellt jedem sein Quittier-Ereignis zu. Ein Alarm wird so
  nie erledigt; ihn quittiert jeder selbst.
- **Neu adressiert nur über `benachrichtigung::umadressieren`** (LLH-1381): ändert sich, wer
  gemeint ist (korrigierte Empfängerfunktion), löst es den neuen Anlass über
  `aufloesung::empfaenger` auf, erledigt die offenen Zeilen der nicht mehr Gemeinten und legt nur
  für Gemeinte ohne jede Zeile zum Bezug eine an: je Person höchstens eine.
- **Web Push (LLH-1223, Spec `web-push`) nur aus `melden`:** nach `zustellen` dieselben
  Ereignisse an die Abos der Empfänger (`web_push::WebPush::versenden`), nebenläufig, nie
  abgewartet. Die Nutzlast ist das Live-Ereignis (nur Kennungen), verschlüsselt nach RFC 8291;
  nie Text. Ziele nur aus `PUSH_DIENSTE` (https, Port 443, keine Weiterleitung), sonst wäre das
  Abo ein SSRF-Weg. Das Abo hängt per CASCADE an `session`; ohne `--web-push` ist
  `LiveHub::web_push()` `None` und die Routen antworten 404. Nachweis `tests/web_push.rs`.

## Backend — Meldungsmodell (LLH-1027)

Begriffe, Datenfluss, Migrations-SQL und Folgestellen:
`docs/design/2026-10-21-meldungsmodell/README.md`. Spec `meldungseingang`.
- **Eine Quelle `meldung` (LLH-1031, Migration 0233):** „Lagemeldung“ ist eine Meldungsart,
  „lagerelevant“ ein Merkmal. Die Lage-Angaben sind Spalten der Meldung (`lage_text` NULL =
  Wortlaut gilt, `lat`/`lon`, `lage_uebergeben_*`, `lage_gesehen_*`); eine Tabelle
  `lage_meldung` oder eine zweite Kennung gibt es nicht. Liste, Modulzähler, Marker
  (`geocoding/marker.rs`) und Kenntnisnahme lesen `meldung WHERE lagerelevant = 1` über die
  Fragmente `lage_sicht_sql!`/`is_neu_sql!` in `meldung/repo.rs`. Die Drahtform von
  `LageMeldungAnzeige` bleibt die alter Lage-Stände (`id = meldung_id`, neue Felder kommen nur
  hinzu); ein neues Feld dort ist im Client in `LageMeldungStand` optional.
- **Invariante „Art Lagemeldung ⇒ lagerelevant“** hält `repo::apply_lage_invariante_tx`, gerufen
  in `repo::einfuegen_tx` (also jeder Anlegeweg über `anlegen` oder `anlegen_zu_etb_tx`:
  Meldungsroute, Gerät, Eintreffen am Bereitstellungsraum, Demo, ETB); kein Handler setzt das
  Flag selbst. Übernahme anderer Arten nur über
  `repo::als_lagerelevant` (idempotent, Ort nur solange keiner besteht, erste Übergabe schreibt den
  ETB-Systemeintrag mit Verweis, LLH-1104). Verortet wird beim Anlegen nur eine Lagemeldung
  (sonst 422).
- **Auto-ETB:** Art Lagemeldung schreibt `etb::TYP_LAGE`, jede andere Art `TYP_MELDUNG`.
- **ETB → Meldung (LLH-1037):** `routes/etb.rs::erfassen` legt bei `in_meldungseingang: true`
  (nur Typ `meldung`/`lage`, sonst 422; Art `lagemeldung` bzw. `sonstige`) Eintrag und Meldung in
  **einer** Transaktion an: `etb::repo::anlegen_idempotent_mit_meldung` ruft
  `meldung::repo::anlegen_zu_etb_tx` (Validierung und Invariante wie `anlegen`, beidseitiger
  Backlink, **kein** Auto-ETB). Von/An werden Absender/Empfänger, eine Zeit `jetzt()` gilt für
  Eingang und Eintrag. Dieselbe `client_id` dedupliziert beide; eine Wiederholung mit anderer
  Kopplung ist 409 (`ist_derselbe_eintrag` vergleicht `mit_meldung`). Fehlt das Feld, wird nur
  protokolliert (ältere Clients und Warteschlangen-Zeilen). Ohne Freigabe im Modul Meldungen 403
  (`fordere_zielmodul::<Meldungen>`), nie stilles Herunterstufen. Live-Ereignisse und Hinweis
  laufen über `meldung::live_publikation_sicherstellen`, auch im Replay-Pfad; die Meldung verhält
  sich danach wie eine erfasste. Nachweis `tests/etb_meldungseingang.rs`.
- **Kenntnisnahme über die Meldung:** `POST …/meldungen/{mid}/lage-gesehen` und
  `POST …/lage/gesehen` mit `meldung_ids` (höchstens `LAGE_GESEHEN_MAX`); beide stehen in
  `PFAD_KEY` auf `lagemeldungen`, nicht auf `meldungen`.
- **Schwärzung:** die Lage-Spalten sind Teil der Regel `meldung` (`lage_text` NullSetzen,
  `lat`/`lon` behalten, Zeiten und Benutzer-FKs behalten).
- **Korrektur (LLH-1066):** `PATCH …/meldungen/{mid}` (`routes/meldung_korrektur.rs`, Schreiben
  in `meldung/korrektur.rs`, eine Transaktion) ändert Art, Priorität, Richtung, Von-Bezug (als
  Paar; eine id außerhalb des Einsatzes 422, anders als beim Erfassen), Empfänger und die
  Lage-Angaben. Wortlaut, Absender, Meldeweg, Ereigniszeit und Eingang → 422, ein unbekanntes Feld
  400. Art → Lagemeldung übernimmt jetzt durch den Ändernden (neu für die Kenntnisnahme), danach
  `apply_lage_invariante_tx`; weg von Lagemeldung bleibt die Lagerelevanz. `lagerelevant: false`
  ist bei Art Lagemeldung 422, sonst leert die Rücknahme Lage-Text, Ort, Übernahme und
  Kenntnisnahme. Versetzen und Entfernen des Orts gehen nur hier, nicht über `als_lagerelevant`.
  Heraufstufen zu sofort (LLH-1380) alarmiert nach dem Commit über `meldung::sofortalarm_melden`,
  höchstens einmal je Meldung: Merker `meldung.sofortalarm_at`, gesetzt in der Korrektur-Tx,
  sobald die Meldung vorher oder nachher sofort ist (Invariante: jetzt sofort oder Merker ⇒ hat
  alarmiert); nicht pflichtig → Pflicht und Frist ab jetzt. Ein Systemeintrag je wirksamer Korrektur
  mit Verweis auf die Meldung; Empfänger und Lage-Text stehen darin ohne Wert (Scrub). Geräte
  erreichen die Route nicht (keine Routenliste).
  Die Empfängerfunktion (LLH-1381) prüft der Handler wie beim Erfassen
  (`routes::meldung::empfaenger_funktion_pruefen`) und schreibt sie in eigener Anweisung derselben
  Tx; ändert sie sich, richtet `meldung::benachrichtigung::empfaengerfunktion_korrigiert` die
  Hinweise neu aus, nur solange die Meldung „Neu“ ist.

## Backend — Bereitstellungsraum (LLH-1085, LLH-1107)

Specs `bereitstellungsraum-belegung` und `bereitstellungsraum-lagekarte`;
`src/bereitstellungsraum/abruf.rs`, `src/bereitstellungsraum/belegung_repo.rs`,
`src/bereitstellungsraum/repo.rs`, `src/routes/einsatz_bereitstellungsraum.rs`.
- **`abruf_tx` schreibt kein ETB.** Der Aufrufer schreibt genau einen Satz
  (`AbrufErgebnis::etb_text`) per `etb::system_audit_tx` in derselben Transaktion; der Auftrag
  entsteht über `auftrag::repo::anlegen_tx` darin, die Folgen nach dem Commit über
  `auftrag::nach_erteilung`. Ein weiterer Abrufweg (LLH-1132) ruft denselben Baustein und hält
  sich an dieselbe Regel; nie ein zweiter Satz für Mitgenommene oder Auftrag.
- **Verband-Austritt und Wechsel-Sperre stehen in `belege_tx`, nicht in der Route.** Der Austritt
  einer abgerufenen Einheit bucht ihre mitgenommenen Untereinheiten mit aus; ein Wechsel einer
  abgerufenen Kraft ist 422. So gilt das für jeden Weg, der `belege_tx` ruft (Route, Gerät).
- „Abgerufen“ ist abgeleitet aus dem jüngsten Ereignis je Kraft, nie gespeichert; `seit` und
  `aktueller_br_id` sehen nur `eintritt`, `wechsel` und `austritt`.
- **Die Koordinate des Raums prüft `repo::update_tx`, nicht der Handler** (LLH-1107): das
  wirksame Paar aus Eingabe und Rohstand derselben Schreibtransaktion (`write_retry!`), dann
  `support::pruefe_koordinate`; ein vorab gelesener Stand könnte das Paar zerreißen. Der PATCH
  schreibt nie ETB, auch nicht für die Koordinate, und meldet immer `sse_br`; einen
  Leerlauf-Riegel oder `still_geaendert` wie die Betreuung braucht er nicht. Ein Neubau der
  Tabelle nimmt `lat`/`lon` mit (`db::tests::migration_*_bereitstellungsraum_lage`).
- **Listeneinträge entstehen nur in `repo::list_eintraege`**: die Liste der Route und der
  Lage-Snapshot lesen dieselbe Zusammensetzung; die Stellenbindung eines Geräts filtert danach
  die Route. Ein neues Feld am Listeneintrag kommt dorthin, nicht in die Route.

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
- Einsatz-IDs werden nie wiederverwendet (`einsatz::repo::anlegen_tx`, über `demo_import` und
  `aufbewahrung_loeschprotokoll`). Die Szenariouhr setzt
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
  unbekannt 404, aktiv 409). `PUT …/aufbewahrungsfrist` schneidet gleich (LFH-753): Admin nur
  der Einsatz-Org, sonst Einsatzleitung (auch org-fremd); der Client spiegelt das über
  `BenutzerAnzeige.org_id`. Nach Fristablauf hat die Einsatzleitung bewusst keinen **UI**-Weg;
  der PUT bleibt ihr bis zur Vormerkung (≤ 10 min) offen, danach nur das Wiederherstellen des
  Org-Admins — kein Lesegate nachrüsten (Herleitung:
  `openspec/changes/archive/2026-10-02-lfh-753-frist-put-org-pruefung/design.md`, D3).
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
- **Scrub-Werte in System-ETB-Texten** (LFH-752): Werte von Betroffenen (Schaden, Person, Tier,
  UHS-Belegung: Ort, Adressat, Verbleib-Ziel, Notiz) und Dokumenttitel gehören nie in den
  Wortlaut — nur Registriernummer, Enum, Kategorie, Ablage-Verweis (`Ablage ETB 12`). Bewusst
  behalten werden Einsatzkräfte, Lagestruktur, Führungsmodule und Enum-Labels; jede solche Stelle
  steht mit `gruppe` in `AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`), die Liste wird nie
  um eine Spalte aus `GESPERRT` länger. Kein Test bemerkt einen fehlenden Eintrag. Herleitung:
  `openspec/changes/archive/2026-10-02-lfh-752-system-etb-ohne-scrub-werte/design.md`.
- **Löschersuchen nach Art. 17** (LFH-751, Spec `aufbewahrung-loeschersuchen`, Herleitung
  `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md`): Antrag
  für Einsatz oder genau eine Person (`aufbewahrung::antrag`, Tabelle `schwaerzung_antrag`), nur
  System-Admin der Einsatz-Org, nur abgeschlossen; 24 h zurücknehmbar, dann Vollzug in Phase A2
  des Purge-Laufs (`vollziehe_faellige`, zählt für den WAL-Rückschrieb). Kein Sofort-Auslöser
  ohne diese 24 h.
- **Geräte erfahren Schwärzung und Sperre über den Kopf** (LFH-996, Spec
  `lagebild-offline-lesen`): `EinsatzAnzeige.teilschwaerzungen` zählt vollzogene
  Personen-Anträge und geschwärzte Kategorien (`teilschwaerzungen_spalte!` und
  `teilschwaerzungen_joins!` in `einsatz/repo.rs`, in `laden` und `liste_fuer`). Vormerkung (Phase A), Vollzug mit Wirkung und Kategorie-Schwärzung
  rufen nach dem Commit `kopf_melden`; Phase B und D bleiben stumm (der Einsatz ist seit der
  Vormerkung gesperrt). Wer eine neue Teilschwärzung baut, zählt sie dort mit und meldet den
  Kopf. Herleitung: `openspec/changes/archive/2026-10-05-lfh-996-schwaerzung-clients-raeumen/design.md`.
- **Personen-Scrub nur über `PERSONENBEZUEGE`** (`einsatz/schwaerzung_person.rs`): je
  Personenart Bezug und `Mit`/`Ohne(Grund)` je Scrub-Spalte; Strategie kommt aus `TABELLEN`, nie
  eine eigene. Eine neue Tabelle mit FK auf `einsatz_person`, `einsatz_personal`,
  `infotelefon_anruf` oder `medienkontakt` braucht dort einen Eintrag (Guard
  `jeder_personenverweis_ist_als_bezug_deklariert`); ein Datei-Linker an einer Person (Registry
  `ZeileLoeschen`) steht stattdessen in `PERSONENANHAENGE`, der Vollzug löscht seine Dateien
  (LFH-769). Freitexte, die eine Person nur erwähnen, bleiben bis zur Einsatz-Schwärzung.
- **Die Personensuche (`aufbewahrung::suche`) ist die einzige Archiv-Stelle, die Scrub-Spalten
  liest**: nur ganze Wörter bzw. ≥ 6 Ziffern, Antwort pseudonym, `no-store`, Suchtext nie
  geloggt, schreibt nichts (Guard `archiv_namensraum_nur_lesend_und_admin`, benannte
  Nicht-GET-Menge).
- **Geschwärzt heißt physisch weg** (LFH-725, Spec `aufbewahrung`): `db::connect` setzt
  `secure_delete = ON` (nicht `FAST`: das lässt die Overflow-Seiten gelöschter Anhang-BLOBs
  stehen) und `journal_size_limit` (LFH-928), und nach einer Schwärzung oder einem Sweep mit
  Löschungen schreibt der Purge-Lauf den WAL per `db::wal_zurueckschreiben` zurück. Die Haupt-DB
  nur über `db::connect` öffnen. Netz:
  `schwaerzung_hinterlaesst_keine_altbytes` (`einsatz/purge_scheduler.rs`). Herleitung und
  Messung: `openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`.
- **Fristen je Datenkategorie** (LFH-749, Spec `aufbewahrung-kategorien`): jede Scrub-Spalte
  trägt im Typ eine `Zuordnung` (Kategorie, Personenstamm, Einsatz); die Kategorie-Spalten pinnt
  `kategorie_zuordnung_ist_gepinnt`, eine neue Tabelle mit FK auf `einsatz_person` entscheidet
  sich in `behandlungsbezug_kennt_jede_personentabelle` (beide `einsatz/schwaerzung_registry.rs`).
  Eine Kategorie wirkt nur früher als die Einsatz-Frist und sperrt nicht; der Personenstamm geht
  erst, wenn alle Zwecke der Person geschwärzt sind. Herleitung:
  `openspec/changes/archive/2026-10-02-lfh-749-fristen-je-datenkategorie/design.md`.
- **Daten einer Kategorie in einem eingefrorenen JSON-Dokument** (LFH-1069): folgt die Spalte
  der Einsatz-Frist, steht der Schlüssel in `JSON_TEILE` (`einsatz/schwaerzung_registry.rs`)
  und wird mit der Kategorie ein leeres Array (heute `lage_snapshot.daten` → `$.bilder`,
  `anhaenge`). Wer in ein solches Dokument Daten einer Kategorie aufnimmt, trägt ihn dort ein;
  kein Guard bemerkt das Fehlen.
- **Endgültige Löschung des Skeletts** (LFH-750, Spec `aufbewahrung`): Phase D des Purge-Laufs
  (`einsatz/skelett_loeschung.rs`) löscht einen geschwärzten Einsatz samt ETB, sobald die
  Org-Einstellung `skelett_dauer_tage` (ab Abschluss, frühestens die Schwärzung) abgelaufen ist;
  ohne Einstellung bleibt das Skelett. Einzige Spur ist `aufbewahrung_loeschprotokoll` (keine
  Bezeichnung, kein Ort, kein ETB-Text), geschrieben in derselben Transaktion, Akteur
  fail-closed wie beim Purge-Audit. Erstmaliges Setzen und Verkürzen der Frist ohne
  `skelett_dauer_bestaetigt` → 409. Das Protokoll sperrt ID und Einsatznummer
  (`einsatz::repo::anlegen_tx`). Herleitung:
  `openspec/changes/archive/2026-10-02-lfh-750-skelett-endgueltig-loeschen/design.md`.

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Scan in `src/anhang/mod.rs` hinter Feature `clamav` (Default an). Keine `--clamav-addr` → No-op;
clamd erreichbar → Scan (Fund 422); clamd weg → **503 fail-closed** (oder `--clamav-fail-open`).
Wer `src/anhang/mod.rs`/`clamd_scan` anfasst, fährt auch `cargo test --no-default-features`.
`tests/karte_hintergrundbild_scan.rs` prüft 503 gegen `127.0.0.1:1`. `clamd_verbinden` hat zwei
cfg-Varianten (`unix:` nur unter `#[cfg(unix)]`; Windows → `ScannerNichtErreichbar`).
