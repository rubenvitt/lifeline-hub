# Backend — Regeln

Gilt für den Server (`src/`, `tests/`, `migrations/`), zusätzlich zur `AGENTS.md` der Wurzel.
Pfade ohne Präfix sind relativ zu `src/`. Fachblöcke mit Server- und Client-Anteil stehen
einmal, beim Client: ETB-Zähler und Modulzähler in `frontend/src/etb/AGENTS.md`, Betreuung und
Verpflegung in `frontend/src/betreuung/AGENTS.md`, Sitzung über mehrere Tabs (412) in
`frontend/src/auth/AGENTS.md`. Migrationsvergabe und Tabellenumbau (auch für `db/migrationslauf.rs`)
stehen in `migrations/AGENTS.md`.

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
  `tier/repo.rs`, `verpflegung/repo.rs` für Zeitfenster; Feld-CAS `erwartet` über den Baustein
  `src/feld_cas.rs` in `person/repo.rs`, am Einsatzkopf, an der Einheit und an der eigenen
  Führungsstelle (LLH-1831), an Abschnitt, Gefahrengebiet, Programmpunkt, Dispositionen,
  Betreuungsstelle und den Positionswegen der Lage (LLH-1945); Rückfrage „Zwischenzeitlich geändert“ mit „Meine Änderung
  übernehmen“) und Lebenszyklus (kein Dialog). Das Frontend trennt nur
  heuristisch (`istKonflikt` in `frontend/src/api/client.ts`, `!v.overwrite`-Zweig in
  `SchaedenDetailPage.tsx`/`TiereDetailPage.tsx`) — ein neuer 409 in einer
  CAS-Route zieht den Zweig mit. Ausgezeichnet ist der Sperrkonflikt bei UHS und
  Bereitstellungsraum (LLH-1920) und beim Feld-CAS an Einsatzkopf, Einheit und Führungsstelle
  (LLH-1831): `AppError::Veraltet` antwortet 409 mit `grund: "veraltet"`, das
  `BearbeitbaresPaneel` fragt dort nur bei ihm (`isVeraltet`); ein anderer 409 derselben Route
  (storniert, doppelte Bezeichnung) steht als Grund am Paneel. Eine neue CAS-Route nimmt
  `Veraltet`.
- **403 der Einsatz-Lesesperre trägt einen Grund** (LLH-1819): `fordere_lesezugriff` und der
  Org-Floor antworten `AppError::KeinLesezugriff(LeseSperre)` mit `grund` `kein_mitglied`,
  `nachlauf_abgelaufen` oder `nicht_mehr_lesbar` (`einsatz::berechtigung::lese_sperre`).
  `kein_mitglied` wird zuerst geprüft, damit ein Fremder nichts über gelöschte oder abgelaufene
  Einsätze erfährt. Jeder andere 403 bleibt `Forbidden`; das Frontend liest den Grund in
  `frontend/src/einsatz/sackgasse.ts`.
- **CAS-Baseline beim Öffnen einfrieren**: das Sammelbearbeiten von Tier und Schaden über
  `components/useEditSitzung.ts` (gebrandete `CasBasis`; `starte` nimmt den Datensatz); Test
  braucht ein gemountetes `<Form form={form}>`.
- **Feld-CAS an Kopf, Einheit und Führungsstelle** (LLH-1831, design.md D1/D2 der Change
  `nvhnqynd-konflikt-und-aenderungsvermerk`): dieselbe Form wie die Personendaten, alle Altwerte
  einer Anfrage und das Schreiben in EINER Transaktion; Listen (Verbindungen) als Ganzes, die
  Soll-Stärke und das Qualifikationssoll der Einheit gegen den wirksamen Wert (eigener, sonst des
  Typs). Jeder dieser Schreibwege setzt den **Änderungsvermerk** je geänderter Angabe in
  `einsatz_feld_vermerk` (LLH-1834, `einsatz::feld_vermerk`), auch ohne `erwartet`; kein
  ETB-Eintrag daraus. Eine neue Angabe an diesen Wegen kommt in die feste Feldliste des Vermerks.
- **Feld-CAS ohne Änderungsvermerk** (LLH-1945): Abschnitt, Gefahrengebiet, Programmpunkt, die
  Dispositionen von Personal, Fahrzeug und Material, die Betreuungsstelle sowie `…/position` und
  `…/flaeche` nehmen `erwartet` in derselben Form (Prüfung `feld_cas::pruefe_felder`, Vergleich in
  der Schreibtransaktion über `check_zeile_tx` oder als Suffix des einen UPDATE, 0 Zeilen über
  `ohne_treffer` zu 409 `Veraltet` oder 404). Die Stärke-Position vergleicht den wirksamen Wert,
  der Material-Ort ist eine Gruppe aller vier Spalten. Kein Eintrag in `einsatz_feld_vermerk`.
- **Personendaten nutzen Feld-CAS** (LLH-1103, design.md D1 der Change
  `f8218h1i-personendaten-feldweise`): der PATCH `…/persons/{pid}` trägt in `erwartet` je
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
- **Der Anzeigename eines Kontos** (`auth::ANZEIGENAME_MAX`, LLH-1702) wird an der Maske wie
  jeder Freitext mit 400 abgelehnt. Ein Name, den kein Mensch hier eingibt (Stammdaten einer
  gekoppelten Instanz, SSO-Erstanmeldung, Stellvertreter eines fremden Kontos, jeder neue
  Eingang), geht durch `auth::truncate_anzeigename` und wird gekürzt übernommen, ohne Hinweis:
  das Konto soll deshalb nicht fehlen.
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
  `abloesung::BESATZUNG_MAX`. Ebenso die Personen eines **Schichtplan-Blocks** (LLH-1552): Prüfen
  und Schreiben je Art über `json_each`, gedeckelt durch `schichtplan::PLAN_PERSONEN_MAX`.
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

## Backend↔Frontend — Property-Tests (LLH-2090)

Gilt für Backend (`proptest`) und Frontend (`fast-check`).

- **Wofür:** eine reine Funktion (ohne DB, Netz, Uhr) mit einer Eigenschaft, die für jede Eingabe
  gilt: Hin und zurück (formatieren/lesen, schreiben/parsen), Idempotenz (zweimal wie einmal),
  Invarianten (liegt nach `jetzt`, sitzt auf dem Raster, Textfolge gleich Zeitfolge), Gleichwertigkeit
  (schnell gegen einfach). Beispieltests bleiben daneben; die Eigenschaft ersetzt sie nicht.
- **Form:** Rust in `mod eigenschaften` im Testmodul der Datei (`src/zeit.rs`,
  `src/erinnerung/faelligkeit.rs`), Testname als Satz. Frontend als
  `<name>.eigenschaften.test.ts` neben dem Beispieltest
  (`frontend/src/routing/listenZustand.eigenschaften.test.ts`). Vorgabe der Fallzahl (256 bzw. 100)
  nicht senken, um Laufzeit zu sparen; ein langsamer Generator wird enger, nicht seltener.
- **Was die Kodierung bewusst verwirft,** steht als Erwartung im Test (Funktion `erwartet`), mit
  Grund, nie als stiller Filter im Generator. So bleibt eine Grenze sichtbar, die fast-check findet.
- **Ein Gegenbeispiel ist ein Befund:** beheben und den geschrumpften Fall zusätzlich als
  Beispieltest festhalten. Die Saatdatei unter `proptest-regressions/` wird nur committet, wenn sie
  einen echten Fehler festhält; Saaten aus einer Mutationsprobe werden gelöscht.
- **Beleg:** eine Mutationsprobe am Code macht die Eigenschaft rot (wie bei jedem Test,
  `AGENTS.md`, „Qualitäts-Gates“).

## Backend — Öffentliche API v1 (LLH-1653)

Vertrag für Fremdsysteme unter `/api/v1/` ([ADR-0096](../docs/architektur/entscheidungen/ADR-0096-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1-zusage-ab-1-0.md),
Spec `oeffentliche-api-vertrag`, Herleitung
`openspec/changes/archive/2026-11-12-h5zpb97t-oeffentliche-api-vertrag/design.md`):
- **Routen nur in `public_api::router()`** per `.routes(routes!(handler))`, jeder Handler mit
  `#[utoipa::path]` und vollem Pfad `/api/v1/…`. Kein `.route(…)` dort, kein `/api/v1`-Pfad in
  `app.rs` (`tests/public_api.rs`); so steht jede Route im Dokument.
- **Eigene Schemas:** v1-Antworten und -Eingaben sind eigene Typen in `public_api`, aufgenommen in
  `PublicApiDoc`; nie ein Typ aus `api_doc.rs` (die interne API hat keine Zusage). Wire-Namen nach
  der Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
- **Fehler:** v1-Handler geben `Result<_, ApiError>` zurück; `AppError` und `sqlx::Error` gehen per
  `?` über. Ein besonderer Fall nimmt seinen Code ausdrücklich (`ApiError::new(ErrorCode::…, …)`).
  Was neben dem Handler scheitert, ergänzen `public_api::error_code_layer` (an den Routen, vor der
  Kompression) und `public_api::contract_layer` (außen). Jede Route nennt im Dokument ihre
  besonderen Fehler und `status = "default"` mit `ApiErrorBody`. Ein neuer Code kommt nur hinzu
  (Enum, `description.md`, `tests/enum_wire_kontrakt.rs`); keiner wird umbenannt oder entfernt.
- **Drift:** nach jeder Änderung an einer v1-Route, einem v1-Schema oder `description.md`
  `cargo test --test public_api_spec_aktuell` und `docs/api/public-v1.json` mitcommitten
  (`scripts/check-typ-codegen.sh`, Schritt 2).
- **Grenzen:** Body höchstens `PUBLIC_API_BODY_MAX` (64 KiB, `app.rs`), vor jedem Handler, auch
  einem, der den Body roh liest, und ohne `Content-Length` (`public_api::body_limit_layer`
  puffert ihn; ein Handler bekommt den Body ganz); jede Antwort `Cache-Control: no-store`
  (`public_api::contract_layer`, montiert in `app.rs`). Die innere Schicht setzt den Kopf nicht,
  sonst packte die Kompression keine v1-Antwort mehr.
- **Einwurf** (LLH-1654, [ADR-0023](../docs/architektur/entscheidungen/ADR-0023-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md),
  Spec `einwurf-zugang`): die einzigen v1-Routen ohne `MachineClient`. Die Prüfungen stehen in
  genau einer Funktion (`check_einwurf` in `public_api/einwurf/routen.rs`), TLS-Nachweis zuerst; wer eine
  Einwurf-Route ergänzt, ruft sie auf. **Kein `tracing`-Aufruf nennt Pfad, Abfrage, Schlüssel
  oder Hash** (die Kennung des Zugangs genügt); der Span trägt den Pfad schon maskiert
  (`pfad_fuer_protokoll`, Test `app::tests::einwurf_schluessel_steht_in_keiner_logzeile`). Eine
  Antwort trägt nie Daten und unterscheidet neu nicht von wiederholt. Was ein Schlüsselinhaber je
  Aufruf auslösen kann, loggt als `log_drossel::SammelzeileJe` je Zugang.

## Backend — Ausgangsereignisse für Fremdsysteme (LLH-1655)

Outbox `maschine_ereignis` und Abruf `GET /api/v1/events`
([ADR-0038](../docs/architektur/entscheidungen/ADR-0038-ausgangsereignisse-fuer-fremdsysteme-entstehen-per-trigger-und-je-zugang.md),
Spec `ereignis-abruf`, Herleitung
`openspec/changes/archive/2026-11-13-umeqho2b-outbox-ereignis-abruf/design.md`):
- **Kein Schreibweg in Rust schreibt in `maschine_ereignis`.** Jede Zeile entsteht in einem
  Trigger (`migrations/0345_maschine_ereignis_trigger.sql`), in der Transaktion der Änderung und
  je Zeile in `maschinenzugang_freigabe` (Änderungen nur für gültige Zugänge, das Ende für alle).
  Ein schon geschriebenes `einsatz.closed` bleibt beim Löschen des Einsatzes stehen.
  `public_api::events` liest und löscht nur. Auch Tests
  erzeugen Ereignisse über Freigabe, Kopf und Lage; direkt fügt nur ein, wer ein Alter braucht
  (`tests/public_api_events.rs`, `altes_ereignis`).
- **Ein neues Feld im v1-Schema `Einsatz`** kommt mit seiner Spalte in
  `public_api::einsaetze::KOPF_SPALTEN`, und eine neue Migration baut `einsatz_ereignis_kopf` neu
  (Wächter `tests/public_api_ereignis_trigger.rs`, `der_kopf_trigger_kennt_genau_die_kopfspalten`).
  Sonst bliebe `einsatz.updated` für dieses Feld aus.
- **Liest die Lage aus einer weiteren Tabelle** (`public_api::lage::QUELLEN`), kommt sie in
  `public_api::events::LAGE_ARTEN` und in den Trigger `einsatz_aenderung_ereignis_i`, wieder per
  neuer Migration (Wächter `lage_arten_sind_die_quellen_der_lage_und_stehen_im_trigger`). Der
  Trigger hängt am Änderungslog `einsatz_aenderung`; eine Lage-Tabelle muss deshalb gespiegelt
  sein.
- **Die Freigabe endet als gelöschte Zeile**, nie per `INSERT OR REPLACE` (löscht ohne
  DELETE-Trigger).
- **Eine neue Ereignisart** kommt in `EventType` und in den CHECK von `maschine_ereignis.type`
  (neue Migration, Abgleich in `tests/public_api_events.rs`); keine wird umbenannt.
- **Der wartende Abruf** hält zwischen zwei Nachfragen keine Datenbankverbindung und nimmt seinen
  Platz aus `events::Warteraum`; die Route steht nicht in `zulassung::OHNE_ZULASSUNGSGRENZE`.

## Backend — Webhooks (LLH-1656)

Zweiter Leser der Outbox: `public_api::webhook`
([ADR-0046](../docs/architektur/entscheidungen/ADR-0046-webhooks-sind-mit-dem-instanzschluessel-signiert-und-gehen-nur-an-gepruefte-adressen.md),
Spec `webhook-zustellung`, Herleitung
`openspec/changes/archive/2026-11-14-z6ds0ed9-webhooks-outbox/design.md`):
- **Lesen wie der Abruf:** `events::naechstes` mit den gewählten Arten, geschnitten mit
  `events::sichtbare_arten` des Zugangs. Eine neue Ereignisart braucht deshalb nichts Eigenes für
  Webhooks; sie erscheint in der Auswahl, sobald `EventType` sie kennt (Frontend: `ART_TEXT`,
  `ART_RECHT` in `frontend/src/api/anbindungen.ts`).
- **Ausgehend nur über `webhook::ziel::client`:** kein zweiter Client für Webhooks, keine
  Zustellung an einer Prüfung von `check_url` vorbei (IP-Literale umgehen den Resolver). Einzige
  Ausnahme ist `ziel::hole_fingerabdruck`: er baut über dieselbe `ziel::baue_client` einen Client,
  der nach dem Zertifikat abbricht und nie eine Anfrage sendet (Fingerabdruck unten).
- **Der Lauf hält während der HTTP-Anfrage keine Datenbankverbindung**; das Ergebnis schreibt er
  danach in einer Transaktion (`write_retry!`). Tests stellen über einen eigenen `Zusteller` zu;
  Loopback ist für den echten Weg immer gesperrt, einen Schalter dafür gibt es nicht.
- **Der CAS-Stand `geaendert_at` steigt streng** (`repo::neuer_stand`): die Zeit hat
  Sekunden-Auflösung.
- **Fingerabdruck** (LLH-1872,
  [ADR-0092](../docs/architektur/entscheidungen/ADR-0092-ein-webhook-mit-fingerabdruck-vertraut-nur-diesem-zertifikat.md)):
  ein Client je `(lan, pin)` aus `ziel::client`, TLS nur über
  `instanz::zertifikat::tls_config`, das Abrufen vom Ziel nur über `ziel::hole_fingerabdruck`
  mit dem `Erfasser`. Ein geänderter Fingerabdruck zählt im Repo wie ein neues Ziel.

## Backend — Adapter (LLH-2017)

Anbindungen, die Lifeline Hub selbst abruft (Divera, HiOrg, Postfach …): `src/adapter/`
([ADR-0077](../docs/architektur/entscheidungen/ADR-0077-geheimnisse-der-adapter-liegen-nur-verschluesselt-und-adapter-rufen-nur-ueber-den-rahmen-ab.md),
Design-Doc `docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`):
- **Eine neue Anbindung ist eine Art** (`adapter::art::AdapterArt`) im Verzeichnis
  `art::Verzeichnis::produktiv()`: Code, Plätze für Geheimnisse, Einstellungsfelder, Intervall,
  Abruf. Kein eigener Lauf, keine eigene Tabelle für Zustand oder Geheimnisse, keine eigene Route
  zum Setzen von Zugangsdaten. Tests bringen eine eigene Art mit (`tests/adapter_testart/`), keine
  `#[cfg(test)]`-Art im Verzeichnis.
- **Abruf in zwei Phasen:** `abrufen` nur Netz über den `AbrufKontext` (`request`/`get`, `send`,
  `read_json`/`read_text` mit eigenem Deckel), `Uebernahme::uebernehmen` nur Datenbank in der
  Transaktion des Laufs. `uebernehmen` kann bei belegter Datenbank mehrmals laufen; es schreibt
  idempotent in den Vertrag der Art.
- **Kein Client außerhalb von `adapter::ziel`** (`Zweck::Adapter`), keine Anfrage an `check_url`
  vorbei, keine Weiterleitung. Ein Ziel im LAN nur mit der LAN-Ausnahme des Adapters. Jede
  Adapter-URL prüft `ziel::check_adapter_url`; `http` nur für eine Art mit
  `AdapterArt::http_im_lan`, nur mit LAN-Ausnahme und nur zu einem privaten IP-Literal, nie zu
  einem Hostnamen (LLH-2110,
  [ADR-0105](../docs/architektur/entscheidungen/ADR-0105-adapter-rufen-http-nur-zu-privaten-ip-literalen.md)).
  Die Fremdebene (LLH-2100) ruft über `adapter::ziel::fetch_bedingt` ab.
- **Geheimnisse:** nur über `PUT/DELETE /api/admin/adapter/{id}/secrets/{platz}`; gelesen und
  entschlüsselt nur im Lauf (`adapter::lauf`) und, für die eigenen Routen der Art, im Live-Abruf
  (`adapter::live::live_kontext`, LLH-2107,
  [ADR-0098](../docs/architektur/entscheidungen/ADR-0098-adapter-rufen-fuer-ihre-eigenen-routen-auch-ausserhalb-des-laufs-ab.md)):
  je Abruf entschlüsselt, nie zwischengespeichert, über denselben `AbrufKontext`; verweigert bei
  unbekanntem, angehaltenem oder Eingriff brauchendem Adapter, gesperrtem Speicher und Org am Hub
  (`LiveVerweigert`). `live_kontext` nimmt die Org der Anfrage und die Art, deren Route ihn
  baut; ein Adapter einer anderen Org oder einer anderen Art ist `Unbekannt`. Ein Geheimnis geht nie in Log, Fehlertext, Antwort oder Admin-Spur; ein
  `Fehlschlag` trägt nur einen `AdapterFehler`-Code und den Status.
  Einen Schlüsselwechsel schlüsselt `lauf::umschluesseln` beim Start in einer Transaktion um
  (LLH-2025); sonst ändert nichts ein Chiffrat, ohne den Wert neu zu setzen.
  Ein PATCH, der ein neues Ziel einträgt (`art::has_neues_ziel`: anderer oder neuer Host einer
  URL), entfernt die Geheimnisse; eine neue Art mit URL-Feldern erbt das, ohne eigenen Code.
- **Fehlercodes:** ein neuer Code kommt in `AdapterFehler` samt Einteilung in
  `zustand::braucht_eingriff` und Enum-Kontrakt; ein Text des Ziels wird nie gespeichert. Seine
  Bezeichnung für die Meldung steht in `benachrichtigung::adapter::fehler_text`, gleichlautend mit
  `frontend/src/api/adapter.ts`.
- **Flüchtige Arten** (LLH-2105, `AdapterArt::fluechtig`): was die Art liefert, geht nur in den
  Speicher, nie in die Datenbank (`uebernehmen` schreibt dort nichts Fachliches). Der Takt zählt ab
  Laufbeginn (`repo::save_erfolg(…, ab)`, sonst ab Laufende), damit der Abstand der Bilder fest
  bleibt. Eine Versuchszeile steht nur bei Zustandswechsel: bei Fehlschlag, und bei dem Erfolg, der
  eine Störung beendet (`fehlversuche > 0` oder Meldung offen); ein Erfolg im Dauerlauf schreibt
  keine, `letzter_erfolg_at` zeigt das Leben.
- **Störung melden** (LLH-2026,
  [ADR-0086](../docs/architektur/entscheidungen/ADR-0086-stoerungen-einer-anbindung-melden-sich-am-ort-adapter-einmal-an-die-admins-der-org.md)):
  nur der Lauf meldet, über den Merker `adapter.gemeldet` (`repo::mark_gemeldet` in seiner
  Transaktion, `zustand::meldung_nach_fehlschlag` entscheidet: Eingriff sofort, gestört ab 30
  Minuten, gesperrter Speicher nie). Ein Admin-Schreibweg, der einen Stopp aufhebt oder setzt
  (Fortsetzen, Anhalten, Geheimnis, wirksame Änderung), räumt mit `repo::clear_gemeldet` und
  `benachrichtigung::erledigen_adapter` ab; Löschen quittiert in seiner Transaktion
  (`repo::quittieren_fuer_adapter_in`, Ereignis nach dem Commit).
- **Ablage einer Art** (LLH-2097, `veranstaltung_extern`): eine Art, die nicht flüchtig ist, legt
  in eine eigene Tabelle mit FK auf `adapter` (`ON DELETE CASCADE`) ab, je Adapter eine Zeile je
  Fremdkennung. `uebernehmen` vergleicht einen Fingerabdruck und schreibt bei Gleichstand nichts;
  eine Lieferung gilt ganz oder gar nicht (eine ungültige Zeile ist `antwort_ungueltig`). Keine
  Admin-Spur je Zeile: der Lauf ist kein Admin. Kein Name einer liefernden Anwendung im Code
  (Guard `veranstaltung_extern::tests::code_nennt_keine_liefernde_anwendung`).
- **Drohnenarten** (LLH-2110): `drohne::ARTEN` (`suchlage`, `hls_adresse`); die Drohnenrouten
  geben `live_kontext` die Art des Adapters aus der Datenbank (`drohne::drohnen_art`), nie eine
  feste. Jede Playlist geht durch `drohne::video::rewrite_playlist` (nur Dateien im selben
  Verzeichnis desselben Ziels, umgeschrieben auf den Dateinamen).
- **Zuschaltung je Einsatz** (LLH-2105, `adapter_einsatz`, `drohne::repo`): welche Drohnenquelle
  in welchem Einsatz zugeschaltet ist. Die Datenbank ist die Quelle der Wahrheit,
  `drohne::Store` (`AppState.drohne`) nur ihr Abbild samt letztem Stand im Arbeitsspeicher; er
  wird beim Start in `main` mit `Store::load` gesetzt, bevor der Lauf beginnt, und von den Routen
  nachgeführt (`set_zugeschaltet`, bei `false` wird der Stand geleert). „Laufend“ heißt
  `einsatz.status = 'aktiv'` (wie `fordere_aktiv`, ohne Nachlauffrist). Ein Adapter hängt an
  höchstens einem laufenden Einsatz (`find_active_holder`); ein abgeschlossener zählt nicht mehr.

## Anhänge

**ETB-Anhänge (LFH-117)** (`docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md`)
- **Jeder modulgebundene Linker auf `anhang` ist EIN Eintrag in `anhang::repo::MODUL_LINKER`**;
  `LinkerStand`, `sweep_verwaiste`, `repo::loeschen`, `chat::repo::anlegen_mit_anhaengen`,
  `etb::repo::pruefe_anhaenge` (`modul_gebunden_sql`) lesen daraus; Chat ist die Ausnahme (n : m).
  Guard `jeder_fremdschluessel_auf_anhang_ist_registriert`. **Abschottungstests laufen als die
  ablegende Person** (`admin`, `common::schaden_anhang`), sonst sind sie ohne Eintrag grün.
- Kreuzsperren: ETB nimmt keine Chat-/modulgebundene Datei (422, `gebunden_meldung()`), Chat keine
  modulgebundene (400). Upload `POST …/etb/attachments` (Dokument-Allowlist, eine Datei je Anfrage),
  Download `GET …/etb/{eintrag_id}/attachments/{aid}`; Binden über `anhang_ids` in derselben
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
  lesbar. Einsicht `GET …/uhs/{uid}/attachments/accesses` nur Einsatzleitung, selbst nicht
  protokolliert. Getrennt von `person_zugriff_audit` (LFH-757).
- **UHS-Plan (LFH-999)** (Spec `uhs-plan`, Herleitung
  `openspec/changes/archive/2026-10-05-lfh-999-uhs-plan-hintergrund/design.md`): der Plan unter
  dem Platz-Layout ist **kein Anhang**, sondern eigene, bereinigte Bytes in `uhs_plan` (einer je
  UHS, `uhs::plan`, `routes::uhs_plan`). Seine Anzeige (`GET …/uhs/{uid}/plan/image`) schreibt
  weder Lese-Audit noch ETB; nur die Übernahme aus einem UHS-Anhang (`…/plan/from-attachment`) ist
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
- **ZIP der Einsatzakte (LLH-1835)** (Spec `einsatzakte`, `GET …/case-file/attachments.zip`,
  `routes/einsatzakte.rs`, `einsatzakte/`): liest die Bytes über `support::anhang_fuer_akte`,
  immer bereinigt; unbereinigbar, am Spiegel noch nicht geholt oder entfernt steht als „nicht
  enthalten“ im `inhalt.csv` statt das ZIP zu kippen. Gate: jedes Modul aus `AKTE_MODULE` lesbar
  (403), ausgeblendet fällt weg; die Liste spiegelt `frontend/src/druck/einsatzakte/quellen.ts`
  (Test `akte_module_wie_im_client`). Protokoll in EINER Transaktion vor dem Bau (`export` der
  Personentabelle, `anhang` je Personen-Anhang, `anhang_zugriff_audit` je UHS-Anhang). Ein neuer
  Linker in `MODUL_LINKER` gehört in `einsatzakte::sammeln` (mit Protokoll, falls seine Route
  eins schreibt). Gebaut wird in `tokio::spawn` (vom Request entkoppelt) in eine Temp-Datei
  neben der DB, ein Bau je Einsatz und höchstens `MAX_BAUTEN` je Server (`BauSperre`, 409/503),
  gestreamt über `routes::backup::chunk_stream`.
- **Kartenhintergrundbilder (LLH-1635)** sind keine Anhänge, laufen beim Download aber durch
  dieselbe Bereinigung (`karte_hintergrundbild::bereinigt`; ETag `"<sha256>.b<n>"`,
  `BEREINIGT_CACHE_CONTROL`). Gespeichert bleibt das Original, einen Original-Abruf gibt es
  nicht. Was sich nicht bereinigen lässt, weist schon der Upload mit 422 ab.
- **Organisationslogo (LLH-1640)** ist kein Beweismittel: `logo_hochladen` speichert nur die
  bereinigten Bytes (`org::logo::bereinigt`, 422 bei Unbereinigbarem), `logo_lesen` bereinigt
  trotzdem noch einmal (Bestand von vor LLH-1640, neuere `BEREINIGUNG_VERSION`). ETag
  `"<sha256>.b<n>"` über `org::logo::etag_wert`; `sha256` an der Anzeige bleibt der Cache-Brecher.

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
  Das Drohnen-Livebild (LLH-2107, hls.js) braucht zusätzlich `media-src 'self' blob:` und
  `worker-src 'self' blob:`; der Spieler hängt die Segmente über MSE als `blob:` ein.
- **Fremde, nicht gespeicherte Bilder** (Drohnenfoto-Vorschau, LLH-2108,
  `GET …/drone/photos/{key}/thumb`) gehen **nicht über `anhang_antwort`**, sondern bereinigt
  (`drohne::foto::clean_thumb` → `anhang::metadaten::bereinigen`, Fehler 422) mit `ANHANG_CSP`,
  `nosniff`, `Content-Disposition: inline` und `Cache-Control: private, max-age=300`; nie die
  Köpfe des Ziels. Das Bündel (5 min, 32 MiB) hält nur bereinigte Bytes. Der Vorschau-Pfad der
  Quelle wird beim Einlesen und vor dem Abruf mit `suchlage::is_thumb_pfad` geprüft.
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
- **Auswahlfelder lesen eine Projektion ohne Freitexte** (`…/persons/selection`,
  `…/damages/selection`), nicht die Vollliste.
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
  (`…/tasks?q=` und `…/tasks/metrics?q=`: Kennung `#n`, Text, Empfänger).

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
- Der Eintrag schlägt nie nach außen durch (wie `audit::schreibe`). Ausnahme „Archiv eingespielt“
  (LLH-1494, LLH-1711): `admin_audit::schreibe_ohne_akteur_tx` (Befehl) bzw. `schreibe_tx`
  (Person über die Verwaltung, mit `peer_ip`) schreibt in der Transaktion, die das Einspielen
  abschließt; ein Fehler bricht es ab, ein Einspielen, das vorher scheitert, hinterlässt nichts.
  Die Log-Zeile kommt nach dem Commit vom Aufrufer. Eine neue Aktion braucht eine
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

## Backend — Instanzkopplung (LLH-1490)

Zwei Instanzen (ELW und Hub) sprechen nur signiert miteinander; Regeln des Verfahrens in
[ADR-0034](../docs/architektur/entscheidungen/ADR-0034-maschinen-weisen-sich-mit-schluesselpaar-aus-ausser-beim-einwurf.md),
Herleitung in
`openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`.

- **Eine Route, die eine andere Instanz ruft, nimmt `instanz::extractor::GekoppelteInstanz`**
  und antwortet über dessen `antwort` (signiert); nie `CurrentUser`, nie ein eigener
  Token-Vergleich. Nur `POST /api/instance/pair` ist öffentlich (IP-Sperre, einheitlich 401).
- **Das Protokoll kennt Richtung, nicht Hub und ELW** (`InstanzKopplungRichtung`): wer einlöst,
  meldet sich; die erreichte Seite baut nie eine Verbindung auf.
- **`instanz::PROTOKOLL` erhöhen** heißt: die vorige Version bleibt im Code, bis die übernächste
  kommt; Melden geht über alle Versionen (`extractor::check_protokoll`) und sein Schema
  (`melden::MeldenAnfrage`, `MeldenAntwort`) wächst nur additiv. Einzige Ausnahme ist der Sprung
  4 → 6 mit den englischen Wegen (LLH-2053, harter Schnitt in der Alpha, ADR-0097): Zwischen 4
  und 6 geht auch Melden nicht; ein unsigniertes 404 beim Melden oder Einlösen heißt „anderer
  Softwarestand“ (`melden::deute_unsigniert`, `routes::instanz`). Ab 1.0.0 bleibt ein umbenannter Weg als Alias erreichbar.
- **Unterschriftsschlüssel** (`auth::unterschrift`) liegen getrennt von `webauthn_credential` und
  haben einen eigenen User-Handle: der Anmeldeweg liest sie nie. Neue Schlüssel nimmt eine
  gekoppelte Instanz nur mit Gegenzeichnung eines bekannten an (`repo::accept_lieferungen`); wer ein
  Admin-Konto deaktiviert oder herabstuft, widerruft dessen Schlüssel im selben Commit, auch den
  letzten (LLH-1605: Vorrang vor dem Schutz „letzter Schlüssel“).
- **Ein Schlüssel zählt nur mit `zustand = 'gueltig'`.** Nachgelieferte warten auf die
  Bestätigung eines Admins (`wartet_auf_bestaetigung`, LLH-1605) und zählen weder als
  Unterschrift noch als Gegenzeichnung; eine neue Prüfung (etwa die Notübernahme) fragt
  `gueltig` ab, nie „nicht widerrufen“.
- **Führung je Einsatz (LLH-1491)**, Spec `instanz-fuehrung`,
  [ADR-0044](../docs/architektur/entscheidungen/ADR-0044-ueber-eine-direktkopplung-gibt-keine-seite-ohne-beweis-und-einsatzleitung-ab.md):
  - **Die Akte entscheidet, der Spiegel folgt (LLH-1641).** Gesperrt ist nur der Spiegel
    (Schutz-Trigger aus `instanz::spiegel::art`); eine eigene Führungssperre gibt es nicht mehr.
    `einsatz.spiegel` setzt bei einem Führungswechsel allein `instanz::spiegel::fuehrung`
    (`richte_aus` aus `fuehrung::repo::save`); ein neuer Schreibweg braucht dafür nichts.
  - **Wer die Zeile in `einsatz_spiegel` entfernt, macht vorher die Einsatznummer frei**
    (`spiegel::nummer::ensure_freie_nummer`, LLH-1703, Spec `einsatznummer`): Mit der Zeile endet
    die Ausnahme von der Eindeutigkeit, und eine hier schon vergebene Nummer ließe den Wechsel
    sonst mit 409 scheitern, im Abgleich in jedem Takt. Heute `fuehrung::werde_fuehrer` und
    `lebensende::umwandeln`. Nach einem Führungswechsel an einem lokalen Einsatz meldet der
    Aufrufer Kopf und Vollabgleich über `instanz::fuehrung::notify_wechsel`, nie `kopf_melden`
    allein: Der Wechsel kann ins ETB geschrieben haben. Herleitung:
    `openspec/changes/archive/2026-11-12-a36p545r-nummer-beim-fuehrungswechsel/design.md`.
  - Übergabe geht nur abgeglichen (`fordere_abgeglichen`), eine Anfrage wartet am Führer
    (`anfrage_von`), bis der Anfragende alles hat; eine Notübernahme nur an einem Einsatz, der
    hier als Spiegel liegt. Abgeschaltet friert der Schalter den Stand ein; einen Spiegel, dessen
    Führung danach nicht mehr gekoppelt ist, holt nur ein Mensch zurück (ADR-0043, LLH-1850).
  - Die Bedienung der Führung zieht `EinsatzFuehrungszugriff`, nie ein Schreib-Gate. Eine
    eingehende Akte, die der meldenden Seite die Führung nimmt, läuft durch
    `austausch::entscheide`; wer daran dreht, hält die Tabelle in design.md D7 der Change
    `v6hj7xl2-fuehrung-epoche` und ihre Ergänzung in design.md D3 der Change
    `faq7l7m4-zwei-elw-unterlegene-seite`
    (`openspec/changes/archive/2026-11-12-faq7l7m4-zwei-elw-unterlegene-seite/design.md`) nach. Ist ein Dritter beteiligt (mehrere ELW an einem
    Hub), hält die meldende Seite offen; ob das ein Konflikt ist, sagt `austausch::ist_konflikt`.
  - **Nach welcher Regel die Führung zu einem Gegenüber wechselt, sagt `instanz::wechselregel`**
    (LLH-1678, Herleitung `openspec/changes/archive/2026-11-13-gwcf2shk-fuehrungswechsel-vor-ort/design.md`):
    `nach_richtung` (Standardkopplung, Tabellen oben), `gleichrangig` (Direktkopplung, beide mit
    Protokoll 4: jede Seite wie die meldende), `gesperrt` (Direktkopplung mit älterer Gegenstelle).
    Über eine Direktkopplung entscheidet `austausch::entscheide_vor_ort` vor allen Zweigen der
    Richtung; die Tabelle steht in design.md D2 der Change. Eine Anfrage vor Ort merkt sich der
    Führer in `anfrage_von` und erfüllt sie nie selbst; `repo::save` löscht `anfrage_von` und
    `anfrage_abgelehnt`, sobald die Epoche wechselt. Die erreichte Seite einer Standardkopplung
    zieht einen Wechsel zwischen zwei Dritten nach, wenn der bisherige Führer ihn bezeugt oder eine
    Notübernahme gegen ihn eine hier gültige Unterschrift trägt (design.md D5).
  - Der Schalter steht in `instanz_identitaet.fuehrung_an` (je Instanz, auch im Testprozess);
    `instanz::fuehrung::is_enabled`, nie ein prozessweiter Merker.
  - **Ein Stand kommt nur aus `fuehrung::repo::next_stand`** und folgt der Uhr
    (`MAX(Zähler + 1, Unix-Sekunden)`), damit der Austausch das Zurückspielen einer Sicherung
    übersteht (LLH-1708). Den Instanzzähler hebt außerdem nur `austausch::repair_stand` (über
    `repo::raise_stand`), wenn eine Quittung über ihm liegt; er stempelt dann jede Kopplung der
    erreichten Seite neu. Die Stände der Kopplung wandern nur vorwärts, mit einer Ausnahme: Die
    meldende Seite setzt `fuehrung_gesendet_bis` auf eine kleinere Quittung zurück
    (`repo::reset_gesendet_bis`). Herleitung:
    `openspec/changes/archive/2026-11-12-xi5ugyt8-fuehrung-stand-nach-restore/design.md`.
- Admin-Spur: vom Gegenüber ausgelöste Einträge über `admin_audit::schreibe_ohne_akteur`
  (`akteur_id` NULL, Name der Gegenstelle).
- **Stammdaten-Verteilung (LLH-1493)**, Spec `stammdaten-verteilung`, Herleitung
  `openspec/changes/archive/2026-11-09-ca8v0psv-stammdaten-verteilung/design.md`:
  - **Eine verteilte Art hat einen Eintrag in `instanz::stammdaten::art::BESCHREIBUNGEN` und ihre
    Trigger** (`<tabelle>_log_i/_u/_d`, `<tabelle>_schutz_u/_d`, Unterlisten auch `_schutz_i`,
    Muster `migrations/0306`). Wer eine dieser Tabellen in einer Migration neu baut, legt die
    Trigger wieder an; Guard `art::tests::trigger_und_spalten_passen_zur_beschreibung`. Kein
    Schreibweg in Rust schreibt ins Änderungslog.
  - **Teil einer Tabelle, mehrspaltiger Abgleich, einmalige Markierung** (LLH-1613, Herleitung
    `openspec/changes/archive/2026-11-09-kjezbk06-stammdaten-kataloge/design.md` D2–D4):
    `bereich` grenzt die Art auf einen Teil der Tabelle ein (Sprechgruppen nur
    `einsatz_id IS NULL`) und gehört dann auch in die Log-Trigger; `natuerlich` nennt alle Spalten
    des natürlichen Schlüssels; `exklusiv` nennt eine je Org einmalige Markierung, die die
    gelieferte Zeile den übrigen nimmt.
  - **Übernommene Zeilen ändert nur die Übernahme** (`stammdaten::uebernehmen`, Merker
    `stammdaten_uebernahme` in ihrer Transaktion); jeder andere Weg bekommt 409 „Wird am Hub
    gepflegt.“ aus dem Trigger. An `benutzer` schützt der Trigger nur Name, Anzeigename, Rollen,
    Aktivität und Org: Passwort nach Einmalpasswort, TOTP-Einrichtung und Anmeldezähler bleiben
    lokal schreibbar.
  - **Kontogeheimnisse nur über `stammdaten::geheimnis`** (age an den Empfänger aus der
    Meldung, nur bei bestätigter Platte, Admins nur mit Anmelde-Passkey, keine Gerätekonten).
    Ob die Passkey-Pflicht gilt, sagt allein `geheimnis::is_passkey_pflichtig` (Login,
    Einmalpasswort, Notfallbefehl `auth::notfall`); die Pflicht am Login regelt [ADR-0016](../docs/architektur/entscheidungen/ADR-0016-admins-einer-verteilenden-instanz-melden-sich-per-passkey-an.md).
  - **Systemrolle `admin` vom Hub nur an einer Instanz mit einer Org** (`uebernehmen`); sonst
    `keiner` mit Hinweis an der Kopplung.
  - **Der Bestand ist, was die Lieferung als Zeile baut** (LLH-1871): Was in
    `stammdaten::bestand::load` fehlt, räumt die meldende Seite ab. Eine neue Sonderregel in
    `liefern::build_lieferung` oder `load_daten` gehört auch dorthin; Guard
    `bestand::tests::bestand_ist_was_als_zeile_geliefert_wird`. Herleitung:
    `openspec/changes/archive/2026-11-13-n2ge2224-reste-nach-restore-abraeumen/design.md`.
  - Nachweis: `tests/instanz_stammdaten.rs`, `tests/instanz_stammdaten_live.rs`.
- **Spiegel und Anträge (LLH-1492)**, Specs `einsatz-spiegel` und `spiegel-antraege`,
  Entscheidung
  [ADR-0018](../docs/architektur/entscheidungen/ADR-0018-ein-einsatz-wird-als-spiegel-in-denselben-tabellen-gehalten.md),
  Herleitung `openspec/changes/archive/2026-11-10-polrv1lt-spiegel-antraege/design.md`:
  - **Eine neue Einsatztabelle** (neu in `einsatz::schwaerzung_registry::TABELLEN`) **bekommt
    einen Eintrag in `instanz::spiegel::art`**: `GESPIEGELT` mit Kategorie oder `AUSGENOMMEN` mit
    Grund. Eine gespiegelte bekommt in ihrer eigenen Migration ihre Log- und Schutz-Trigger
    (`<tabelle>_spiegellog_i/_u/_d`, `<tabelle>_spiegelschutz_i/_u/_d`), erzeugt mit
    `spiegel::art::trigger_sql` (Ausgabe über den Test `art::tests::erzeuge_migration`,
    `--ignored`). Wer eine dieser Tabellen neu baut, legt die Trigger wieder an. Wächter
    `art::tests::jede_einsatztabelle_ist_eingeordnet`, `art::tests::trigger_passen_zur_beschreibung`,
    `art::tests::eine_eltern_tabelle_wird_mitgespiegelt`. Kein Schreibweg in Rust schreibt in
    `einsatz_aenderung`. **Eine gespiegelte Tabelle hat einen Primärschlüssel**: die rowid allein
    darf `VACUUM` neu vergeben, dann zeigt `spiegel_herkunft` auf eine andere Zeile (LLH-1630,
    Wächter `art::tests::jede_gespiegelte_tabelle_hat_einen_primaerschluessel`).
  - **Eine neue Einsatz-ID vergibt `einsatz::repo::naechste_id`** (oberhalb von Demo- und
    Löschsperre, LFH-690), auch die Übernahme eines Spiegels; die laufende Nummer zählt nur
    eigene Einsätze (`spiegel = 0`).
  - **Paket- und Inhaltsgrenzen** (`spiegel::paket`, `spiegel::anhang`): Eine Zeile über
    `paket::ZEILE_MAX` (oder eine erste Zeile, deren Abhängigkeiten das Paket sprengen) geht als
    `zu_gross` ohne Daten, der Stand rückt vor, der Spiegel behält die alte Fassung mit Hinweis.
    Ein Inhalt über `anhang::INHALT_MAX` wird nicht geholt (`anhang::ZU_GROSS`). Trägt die Zeile
    eine Spalte `sha256`, liefert der Führer die Prüfsumme daraus, ohne den Inhalt zu lesen, und
    zieht sie beim ersten Stück nach, wenn sie nicht stimmt.
  - **Ein Verweis ohne Fremdschlüssel** in einer gespiegelten Tabelle (polymorpher Bezug,
    Kennung in Text oder JSON) steht in `spiegel::schema::VERWEISE_OHNE_FK` samt Auflösung; ein
    Fremdschlüssel zeigt auf eine gespiegelte Tabelle, auf Stammdaten, `benutzer` oder
    `organisation`.
    Wächter `schema::tests::jeder_fremdschluessel_ist_eingeordnet` und
    `schema::tests::jede_id_spalte_ist_eingeordnet` (sieht nur `*_id`-Spalten; Kennungen in Text
    und JSON trägt ein, wer sie anlegt).
  - **Ein neuer Verweis auf `sprechgruppe`** (Fremdschlüssel oder Skizzen-Element) steht auch im
    Trigger `sprechgruppe_spiegelkatalog_u` (Migration 0315), damit eine Kopie einer
    Katalog-Sprechgruppe am Spiegel nachzieht (LLH-1629, `spiegel::katalog`). Wächter
    `katalog::tests::der_log_trigger_kennt_jeden_verweis_auf_sprechgruppen`. Einzige Ausnahme
    von „nur die Tabellen-Trigger schreiben ins Log“.
  - **Eine neue ohne Netz vormerkbare Erfassung** (Art in `frontend/src/offline/queue.ts`) steht
    in `spiegel::antrag::BEANTRAGBAR` (Methode, Routenvorlage, Verweise in Pfad und Body,
    `client_id`, Ergebnis) oder in `NICHT_BEANTRAGBAR` mit Grund. Wächter
    `antrag::tests::jede_vormerkbare_art_ist_eingeordnet` und
    `antrag::tests::jede_vorlage_steht_im_router_und_jeder_parameter_ist_abgebildet`.
  - **Am Spiegel sperrt der Schutz-Trigger** (`einsatz_ist_spiegel` → 409, `src/error.rs`); eine
    Route braucht keine eigene Prüfung. Nur die Übernahme setzt den Merker `spiegel_uebernahme`
    in ihrer Transaktion.
  - **Ein Hintergrundlauf, der an Einsätzen schreibt, lässt Spiegel aus**
    (`einsatz::spiegel_filter::nicht_gespiegelt`); sonst bricht eine Sammelanweisung am Trigger
    ganz ab.
  - **Eine Liste von Konten** (Verwaltung, Auswahl, Anmeldung) schließt Stellvertreter fremder
    Konten aus (`instanz::spiegel::OHNE_STELLVERTRETER`).
  - **`AntragAkteur` setzt nur `spiegel::antrag::ausfuehren`**; `CurrentUser` nimmt das Konto
    dann aus der Extension statt aus dem Cookie. Jede beantragbare Art trägt eine `client_id`,
    damit ein wiederholter Antrag nach Abbruch vor der Quittung nicht doppelt wirkt (ADR-0008,
    Wächter `antrag::tests::jede_beantragbare_art_traegt_eine_client_id`).
  - Nachweis: `tests/instanz_spiegel.rs`, `tests/instanz_spiegel_live.rs`.
  - **Lebensende (LLH-1494)**, Spec `aufbewahrung`, Herleitung
    `/mnt/project-files/llh-1494/tkky2noy-archiv-nachbereitung/design.md` (D2–D7): Der Führer
    liefert einen abgeschlossenen Einsatz weiter, solange die Gegenseite einen niedrigeren Stand
    nennt, auch soft-gelöscht oder geschwärzt (`liefern::list_gefuehrt`). `geloescht` meldet
    eine Seite für genannte Stände nur mit demselben Beleg wie für Akten ohne Spiegel (unten);
    eine aus der Sicherung zurückgekehrte Instanz meldet nichts. **Einen Spiegel räumt
    `geloescht` nur ab, wenn er zu dieser Kopplung gehört und der Absender sein Führer ist**
    (`spiegel::fuehrung::is_fuehrer_des_spiegels`: mit Schalter und Akte allein die Akte, sonst
    das Präfix; LLH-1852,
    [ADR-0042](../docs/architektur/entscheidungen/ADR-0042-ein-spiegel-endet-nur-auf-meldung-seines-fuehrers-laut-akte.md),
    Herleitung
    `openspec/changes/archive/2026-11-13-r11nl4cv-geloescht-fremdes-praefix/design.md`).
    `verwahrt` geht nur von der meldenden Seite aus; die erreichte wandelt ihren Spiegel erst
    bei gleichem Stand und ohne fehlenden Anhang (`spiegel::lebensende::verwahrung_annehmen`),
    und erst ihre Quittung `angenommen` merkt den Einsatz der meldenden Seite zum Abräumen vor.
    **Ein Einsatz verlässt eine Instanz nur über `einsatz::abraeumen`** (Merker
    `einsatz_abraeumen` in der beschließenden Transaktion, Löschen nach dem Commit, Phase R holt
    nach) oder die Skelett-Löschung; beide schreiben das Löschprotokoll. Nachweis:
    `tests/instanz_lebensende.rs`.
  - **Akten ohne Spiegel (LLH-1699)**, Spec `instanz-fuehrung`,
    [ADR-0036](../docs/architektur/entscheidungen/ADR-0036-das-ende-eines-einsatzes-meldet-eine-instanz-nur-mit-beleg.md),
    Herleitung
    `openspec/changes/archive/2026-11-12-h7shm5au-loeschsignal-spiegellose-akten/design.md`
    (D1–D5): Wer eine Führungsakte ohne lokalen Einsatz hält, nennt ihre Kennung in
    `SpiegelPaket.akten` (`fuehrung::repo::list_ohne_spiegel`). `geloescht` dafür belegt allein
    `lebensende::geloeschte_akten`: Löschvermerk (`fuehrung_loeschvermerk`) oder, für ältere
    Löschungen, eigenes Präfix im Löschprotokoll, und hier weder Einsatz noch Akte mit der
    Kennung; nie „kenne ich nicht“. **Wo ein Einsatz mit Kennung endet, entsteht in derselben
    Transaktion der Vermerk** (`fuehrung::loeschvermerk::vermerken_einsatz`): Skelett-Löschung,
    Abräumen eines verwahrten Einsatzes, `geloescht` des Führers an einem Spiegel
    (`lebensende::geloescht_uebernehmen`); nicht, wenn die meldende Seite einen Spiegel nach der
    Nachbereitung abräumt. **Eine Akte ohne Einsatz löscht nur
    `fuehrung::repo::delete_ohne_spiegel`** (schreibt den Vermerk: Signal, Widerruf). Wem eine
    Seite die Akte nennt und von wem sie das Signal annimmt, sagt eine Regel für beides:
    `fuehrung::repo::is_gegenueber_zustaendig` (der Führer der Akte; die meldende Seite auch ihr
    einziger Hub, solange der Führer nicht selbst ihr Gegenüber ist). Genannt wird nur, was
    `paket::is_kennung_nennbar` besteht (höchstens `KENNUNG_BYTES_MAX` Byte, druckbares ASCII);
    die Akten gehen vom Paket-Budget ab (`abgleich::budget_fuer_zeilen`). Denselben Beleg nimmt
    `lebensende::geloeschte` für die Stände von Spiegeln (LLH-1852). Nachweis:
    `tests/instanz_fuehrung.rs`, Abschnitte „Akten ohne Spiegel“ und „Spiegel mit fremdem
    Präfix“.
- **Direktkopplung vor Ort (LLH-1497)**, Specs `instanz-kopplung`, `instanz-entdeckung`,
  [ADR-0029](../docs/architektur/entscheidungen/ADR-0029-eine-direktkopplung-beglaubigt-das-tls-zertifikat-per-signierter-aussage.md),
  Herleitung `openspec/changes/archive/2026-11-12-t10a7luh-elw-lan-direktkopplung/design.md`:
  - **Was eine Kopplung trägt, fragt jede Stelle über `InstanzKopplungArt::traegt(Fluss)`**
    (in SQL `k.art = 'standard'`). Eine neue Stelle, die Stammdaten, Geheimnisse oder Verwahrung
    auslöst oder annimmt oder nach einem Widerruf die Führung zurückholt, prüft die Art und steht
    im Wächter `instanz::art_tests::jeder_fluss_hat_seine_pruefstellen`; ein Führungswechsel fragt
    stattdessen `instanz::wechselregel` (LLH-1678), auch dafür zählt der Wächter die Stellen.
  - **Unterschriftsschlüssel fließen über eine Direktkopplung in beide Richtungen** (LLH-1678,
    design.md D6): lokale und übernommene, ohne die der eigenen Zuordnung
    (`unterschrift::Weiter`), die erste Lieferung der meldenden Seite bis
    `unterschrift_grundstock_bis` als Grundstock. Ein ELW liefert dem Hub seine lokalen Schlüssel
    ohne Gegenzeichnung (`GegenzeichnungPflicht::NurBestaetigung`); dort wartet jeder auf einen
    Admin. Ein Widerruf gilt je Credential-ID für jede Zeile der Org.
  - **Über `vor_ort` gehen Nutzdaten nur über `zertifikat::client(pin)`**; ein Zertifikatswechsel
    läuft über `melden::send_signed_bis` (Bestätigung per `POST /api/instance/certificate`). Kein
    eigener Client für eine Direktkopplung.
  - **„Übersetzt über die Herkunft“ heißt `spiegel::abgleich::uebersetzt`** (meldende Seite einer
    Standardkopplung), nicht `richtung == MeldetSich`. Ein neuer Verweis auf Stammdaten in einer
    gespiegelten Zeile oder einem Antrag trägt seine Ursprungskennung (`abbildung::ursprung`,
    `nach_ursprung`).
  - Nachweis: `tests/instanz_vor_ort.rs` (TLS mit rcgen-Zertifikat auf Loopback, Attrappe des
    Suchers statt Multicast).
- **Fähigkeit `rolle_mitarbeit` (LLH-1817)** steht im Melden beider Seiten
  (`melden::MeldenAnfrage`, `MeldenAntwort`) und in `instanz_kopplung.gegenueber_rolle_mitarbeit`
  (Migration 0359). Ein Gegenüber ohne sie bekommt `mitarbeit` als `beobachter`; ein eingehendes
  `beobachter` eines solchen Gegenübers überschreibt ein lokales `mitarbeit` nicht; kippt die
  Fähigkeit von 0 auf 1, gehen die Mitgliedschaften mit `mitarbeit` einmal neu hinaus. Hat ein
  Spiegel `mitarbeit` gegen einen älteren Führer festgehalten, meldet er sie beim selben Wechsel
  einmal nach (`spiegel::nachtrag`, Tabelle `mitarbeit_nachtrag`); der Führer hebt nur unter den
  Bedingungen aus ADR-0088 an.
- Nachweis: `tests/instanz_kopplung.rs` (zwei Instanzen auf Loopback),
  `tests/instanz_mitarbeit_nachtrag.rs` (Rückgabe und Notübernahme an eine ältere Instanz).

## Backend — Erfassungs-Gate (LLH-1817)

Die Einsatzrolle Mitarbeit erfasst, ändert aber nichts. Regeln (MUST/MUST NOT) und Prüfung in
[ADR-0072](../docs/architektur/entscheidungen/ADR-0072-erfassen-ohne-schreibrecht-hat-eigene-gate-typen-an-einer-positivliste.md);
sie stehen nur dort.

- **Ein Handler trägt `EinsatzErfassungszugriff` oder `EinsatzErfassungsfreigabe`
  (`einsatz/kontext.rs`, `fordere_erfassungsrecht` in `einsatz/berechtigung.rs`) nur nach bewusster
  Entscheidung.** Die Positivliste steht im Design-Doc
  `docs/superpowers/specs/2026-11-19-yd9hmb6c-einsatzrolle-mitarbeit-design.md` (D3); ein
  Handler kommt erst dazu, wenn dieses Dokument es nennt. Ein bloßes Lockern am Handler ist keine
  Entscheidung.
- **Weil `darf_schreiben()` für Mitarbeit falsch bleibt**, schließt jeder Weg, der Schreibrecht
  prüft (Benachrichtigungen, Zuweisungen, Auflösung von Funktionen), sie aus; nur das
  Erfassungs-Gate lässt sie ein.
- **Eigen-Prüfungen stehen im Handler, direkt nach dem Gate** (nur eigene Meldung, Typ des
  ETB-Eintrags, nur eigene Anhänge); für Einsatzleitung und Führungspersonal ändern sie nichts.
  Statuscodes (design.md D3): Meldung korrigieren und Anhang löschen an fremdem Objekt 404;
  ETB-Berichtigung eines fremden Eintrags und ein fremder Anhang in `anhang_ids` 403, ebenso
  jede verbotene Handlung am eigenen Objekt (Lagemeldung, ETB-Typ, Meldung in der Lage).
- **Am Spiegel gilt die Positivliste für Anträge** (`instanz/spiegel/antrag.rs`): nur ETB-Eintrag
  und Meldung; die führende Instanz prüft dieselben Regeln neu.

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

## Backend — Einsatz anlegen mit Mitgliedern (LLH-1820)

Entwurf `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`;
`routes::einsatz::anlegen`, `einsatz::repo::anlegen_mit_mitgliedern`, Nachweis
`tests/einsatz_anlegen_mitglieder.rs`.
- **Mitglieder kommen atomar mit dem Einsatz:** `NeuerEinsatz.mitglieder` wird in derselben
  `write_retry!`-Transaktion wie `anlegen_tx` geschrieben. Ist eine Person nicht aufnehmbar, ist
  das 400, und es entsteht nichts. Prüfen und Schreiben laufen je in einer Anweisung über
  `json_each` (Eingabegrenzen), gedeckelt durch `einsatz::MITGLIEDER_MAX`.
- **Die anlegende Person ist immer Einsatzleitung** und steht nicht in der Liste (sonst 400).
- **Dieselbe Menge wie unter „Zugriff“:** aufnehmbar ist, was `einsatz::repo::auswahl_sql` liefert
  (aktiv, eigene Org, ohne Geräte-, Stellvertreter- und Archivkonten). Die Auswahl beim Anlegen
  (`GET /api/incidents/member-selection`, Tür `darf_einsatz_anlegen`) und der Schreibweg teilen sie.
  Eine fremde oder unbekannte Person nennt die Meldung nur mit Kennung.
- **Jede aufgenommene Person bekommt nach dem Commit den Hinweis `einsatz_aufnahme`** wie bei
  `mitglied_setzen`; die anlegende Person nicht.

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

## Backend — ETB live verteilen (LLH-1976)

Herleitung: `docs/superpowers/specs/2026-11-19-ywhuzag7-etb-system-live-verteilen-design.md`;
`src/etb/nachlauf.rs`.
- **Jeder ETB-Eintrag, den eine Route oder ein Hintergrundlauf schreibt, geht nach dem Commit per
  `LiveHub::publiziere(einsatz_id, etb_id)` hinaus**, je ID, außerhalb der `write_retry!`-Closure,
  mit den IDs, die die Closure zurückgibt (Routen: `routes::etb_verteilen`). Ein
  `publiziere_einsatz(…, LiveEvent::Etb)` ohne ID ersetzt das nicht.
- **Der Wächter `etb::nachlauf` prüft das in Debug und Test**: Router-Schicht `waechter`
  (außerhalb von `CatchPanicLayer`) und `purge_scheduler::tick_mit_rueckschrieb`. Eine Lücke ist
  ein Panic. Eine Ausnahme nur über `nachlauf::ohne_verteilung` oder `nachlauf::ausnehmen` mit
  Grundkonstante; heute für Demo-Import (`GRUND_DEMO`), Instanz-Spiegel (`GRUND_SPIEGEL`) und
  Läufe, die einen Einsatz aus dem Betrieb nehmen (`GRUND_BETRIEB_VERLASSEN`: Archivieren,
  Soft-Delete, Schwärzen des ganzen Einsatzes, Vollzug eines Einsatz-Löschersuchens). Eine neue
  Ausnahme ist eine Entscheidung des Menschen.
- **Ein neuer Scheduler-Lauf, der ETB schreibt, kommt unter die Klammer** (`nachlauf::klammer`).
  Was in einem per `tokio::spawn` gestarteten Task geschieht, sieht der Wächter nicht.

## Backend — Präsenz an Einzelangaben (LLH-1946)

Herleitung: `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, ADR-0074;
`src/live/praesenz.rs`, `src/routes/praesenz.rs`.
- **Flüchtiger Zustand geht am Replay-Ring vorbei**: Präsenz lebt nur im Speicher des `LiveHub`
  (Ablauf 45 s) und läuft als eigener Teilstrom ohne `id:` in den Einsatzstrom, nie über
  `publiziere_*`. Ein Verbindungsaufbau bekommt den Stand nur, wenn er etwas zeigt; der Client
  leert seinen Stand bei jedem Öffnen (`live/useEinsatzLiveStream.ts`).
- **Gate je Eintrag über das Bezugsereignis** (`PraesenzObjekt::bezug`), nicht über
  `LiveEvent::Praesenz` (dessen Gate-Menge ist leer). Ein neues Objekt bekommt ein Bezugsereignis,
  das genau so offen ist wie das Objekt selbst, und seine feste Feldliste (`felder`).
- **Nie an Geräte, nie in den Org-Strom.** Die Meldewege tragen das Gate des PATCH daneben und
  stehen in keiner Routenliste einer Funktionsansicht.

## Backend — Benachrichtigungen (LLH-1207)

Spec `benachrichtigungen`, Herleitung `openspec/changes/archive/2026-10-15-kcjecn9e-benachrichtigungskonzept/design.md`
(D1–D4, D6); `src/benachrichtigung/`, `src/routes/benachrichtigung.rs`.
- **Ein Schreibweg oder Scheduler meldet nach dem Commit nur über `benachrichtigung::melden`**
  mit einem `Anlass` (Art, Bezug, Auslöser per `von`, Adressaten per `an`). Wer etwas bekommt,
  entscheidet allein `aufloesung::empfaenger`: dort stehen alle Ausschlüsse (Auslöser,
  Gerätekonten, inaktive Konten, kein Leserecht am Einsatz oder am Modul des Bezugs,
  abgeschaltete Hinweis-Art). Kein Aufrufer filtert selbst, keiner schreibt in die Tabelle.
- **Eine Funktion löst nur über die Mitgliedschaft auf** (i6k6mzed,
  `openspec/changes/archive/2026-11-09-i6k6mzed-stab-herausnehmen/design.md` D2): `Adressat::Funktion` erreicht jedes
  Mitglied, dessen `einsatz_mitgliedschaft.fuehrungsfunktion` sie trägt; für EL zuerst den
  verknüpften Nutzer des Einsatzleiters der Führungsstelle, nur ohne ihn die Mitgliedschaft.
  Dabei zählt nur, wer im Einsatz schreiben darf (`darf_schreiben`, LLH-2008): Mitarbeit,
  Beobachter und Nicht-Mitglieder (auch der Admin, LFH-1118) erreicht die Funktion nicht, ein
  solcher Einsatzleiter gilt als nicht da. Dieselbe Quelle liest die Anzeige
  (`fuehrung::aufloesung`, Regeln in `frontend/src/fuehrung/AGENTS.md`); eine zweite Zuordnung
  „Funktion → Person“ gibt es nicht.
- **Eine Funktion tragen nur Einsatzleitung und Führungspersonal** (LLH-2064, Entwurf
  `docs/superpowers/specs/2026-11-22-u195f4et-funktion-nur-mit-schreibrecht-design.md`): CHECK
  in `einsatz_mitgliedschaft` (Migration 0363), 422 in `mitglied_setzen`, Normalisieren beim
  Übernehmen aus dem Spiegel (`spiegel::uebernehmen::strip_funktion`). Muss eine Funktion weichen
  (Rollenwechsel, älteres Gegenüber), bleibt ihre Angabe als Freitext, nur über
  `Funktionsangabe::as_freitext` (in einem geschwärzten Einsatz nur der Code weg). Anzeige und
  Hinweise nennen dadurch für die Mitgliedschaft dieselben Personen; der Filter aus LLH-2008
  bleibt als zweite Sicherung. Ein neuer Schreibweg der Funktion prüft die Rolle selbst, der
  CHECK fängt den Rest mit 422.
- **Kein Text in der Tabelle:** eine Zeile je Empfänger mit Art, Stufe und Bezug. Titel,
  Detailzeile und Pfad bildet `text::bilden` beim Lesen; die Detailzeile liest nur Retain-Spalten
  (Guard `detail_liest_nur_retain_spalten`). Trägt der Bezug die gemeinte Einheit nicht allein
  (Hinweis zur ablösenden Einheit), hält `Anlass::einheit` ihre ID fest (`benachrichtigung.einheit_id`,
  LLH-1511, ohne FK), bei einem geplanten Verband dazu `Anlass::durch` die auslösende Untereinheit
  (`benachrichtigung.durch_einheit_id`, LLH-1509); ein Neubau der Tabelle für den CHECK nimmt beide
  Spalten mit. Eine neue Art braucht Variante, Titel, Migration
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
- **Zwei Orte** (LLH-2026, ADR-0086): eine Zeile hängt an einem Einsatz oder an einem Adapter
  (`Ort`, `benachrichtigung.adapter_id`, CHECK genau einer). Am Adapter gilt nur
  `Adressat::OrgAdmins` (aktive System-Admins seiner Org); Empfänger, Leserecht (`darf_lesen`) und
  Text stehen nur in `benachrichtigung::adapter`, Erledigen für alle nur über
  `benachrichtigung::erledigen_adapter`. Der Ort reist nie zum Hub. Die Detailzeile liest dort
  Org-Stammdaten (`DETAIL_ADAPTER_SPALTEN`, Guard `detail_adapter_liest_nur_adapterspalten`)
  statt Retain-Spalten der Schwärzung, die nur Einsatzdaten kennt; nie Einstellungen oder
  Geheimnisse. `einsatz_id` ist auf dem Wire Pflichtfeld und darf `null` sein; jeder Leser
  beachtet den Ort.
- Ein Fehler in `melden` lässt die committete Anfrage nicht scheitern (geloggt). Aufräumen
  (quittiert 24 h nach der Quittung, offen 24 h nach dem Entstehen; nachgereicht wird nur 12 h)
  läuft im Erinnerungs-Scheduler; mit dem Einsatz fallen die Zeilen per `ON DELETE CASCADE`.
  Nachweis `tests/benachrichtigung.rs`.
- **Drei Stufen, still ist eine gelesene Zeile** (LLH-1143, Entwurf
  `/mnt/project-files/llh-1022/llh-1143/design.md`, D1–D4): `hinweis` ist die Stufe Eingang.
  Wer eine Art abgeschaltet hat, bekommt in `aufloesung::empfaenger` eine Zeile der Stufe
  `still` (`Aufgeloest::still_ids`), die `repo::anlegen` mit `quittiert_at = erstellt_at`
  schreibt: im Verlauf, nie gezählt, nie nachgereicht, kein Push; `melden` liefert nur die
  Lauten. Die Tabelle ist zugleich Protokoll und Gelesen-Stand je Person; es gibt keine zweite.
- **Vorgabe je Funktion nur in der Auflösung** (LLH-1421, Entwurf
  `/mnt/project-files/llh-1421/design.md`, D1–D4): `aufloesung::empfaenger` stellt einen
  Hinweis auch still, wenn `benachrichtigung_vorgabe` ihn für JEDE Funktion des Empfängers still
  stellt (EL als Einsatzleiter der Führungsstelle ∪ Funktion der Mitgliedschaft, leer = `ohne`);
  lauter gewinnt. Ohne Zeile gilt `BenachrichtigungArt::vorgabe_still()`, einstellbar ist nur
  `vorgabe_einstellbar()`. Lesen und Schreiben nur über `benachrichtigung::vorgabe`.
  Verlauf `GET …/incidents/{id}/notifications` (≤ 200, `ungelesen` = unquittierte Eingänge
  nach der Rechteprüfung), „alle gelesen“ `POST …/notifications/read` nur über
  `benachrichtigung::gelesen_bis`: nie Alarme, EIN Quittier-Ereignis mit `gelesen_bis`, nie eines
  je Zeile.
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
  nie Text. Einzige Zutat ist die Marke `"inhalt": true` an ein Abo mit dieser Wahl
  (`web_push::nutzlast_fuer`, LLH-1369); Absender und Wortlaut holt der Service Worker selbst.
  „Stumm auf diesem Gerät“ (LLH-1482) filtert der Server (`web_push::soll_senden`, Spalte
  `web_push_abo.stumm`), nie der Worker: zu jedem Push muss er eine Meldung zeigen
  (`userVisibleOnly`), sonst ersetzt Chrome sie und Safari kündigt das Abo. Ein Alarm geht immer. Ziele nur aus `PUSH_DIENSTE` (https, Port 443, keine Weiterleitung), sonst wäre das
  Abo ein SSRF-Weg. Das Abo hängt per CASCADE an `session`; ohne `--web-push` ist
  `LiveHub::web_push()` `None` und die Routen antworten 404. Nachweis `tests/web_push.rs`.
- **Über den Hub (LLH-1495,
  [ADR-0027](../docs/architektur/entscheidungen/ADR-0027-hinweise-eines-gefuehrten-einsatzes-reisen-als-anlass-zum-hub.md)):**
  `melden` und `erledigen` merken für einen hier geführten Einsatz einer gekoppelten Org den
  Anlass in `hinweis_ausgang` vor (`instanz::spiegel::hinweis`), der Abgleich trägt ihn, die
  erreichte Seite meldet ihn nach dem Commit selbst. Bietet sie Push an, lässt `ausliefern` den
  eigenen Push an Konten aus, die aus dieser Kopplung stammen (`hinweis::konten_am_hub`); allen
  anderen und bei gescheitertem Vormerken pusht die Instanz selbst, `umadressieren` immer. Ein neuer
  Bezugstyp braucht seine Tabelle in `hinweis::bezug_tabelle` (Wächter
  `jeder_bezugstyp_ist_eingeordnet`), ein neuer Adressat seine Textform dort. Das Aufräumen
  schließt Spiegel ein. Nachweis `tests/instanz_hinweise.rs`.
- **Automatische Fristen stehen am Bezug (LLH-1908,** Entwurf
  `docs/superpowers/specs/2026-11-22-ndd6jaby-faellige-erinnerung-einmal-design.md`): Eine
  Erinnerung mit `quelle = 'auto_frist'` und Bezug `meldung`, `auftrag`, `abloesung` oder
  `abloesung_vorwarnung` zählt und steht dort, wo man sie erledigt — an der Meldung („Bestätigung
  überfällig“), am Auftrag („überfällig“), an der Ablösung — sofern die Person das Modul des Bezugs
  sieht (sichtbar und Zugriff; ein Admin erreicht ein ausgeblendetes Modul, sieht es aber nicht) und
  der Bezug offen ist (Meldung nicht erledigt, Auftrag offen oder in Arbeit; Ablösungen schließen
  ihre Fristen beim Ende selbst). Sie fehlt dann im Zähler „Erinnerungen fällig“ (`erinnerung::repo::faellige_offene`, auch
  Lagemonitor), in Offene Vorgänge → Erinnerungen und doppelt in Nächste Marken; das
  Erinnerungsmodul zeigt sie weiter, als „automatisch“. Den Planungshinweis (`abloesung_planung`)
  und selbst angelegte Erinnerungen mit Bezug zeigt sonst nichts, sie bleiben Erinnerungen. Die Menge
  steht je Seite einmal: `erinnerung::AM_BEZUG_GETRAGEN` und `AM_BEZUG_GETRAGEN` in
  `frontend/src/erinnerung/amBezug.ts`; eine neue Auto-Frist-Art zieht beide nach.

## Backend — iOS-Push (LLH-1981)

Entscheidung [ADR-0090](../docs/architektur/entscheidungen/ADR-0090-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md)
(Relais, Verschlüsselung, Opt-in, Bindung an Konto und Gerät), Design-Doc
`docs/superpowers/specs/2026-11-22-mbbk7iwo-ios-apns-alarme-design.md`; `src/ios_push/`,
`src/routes/ios_push.rs`. Das Relais selbst: `push-relais/AGENTS.md`, Betrieb
`docs/betrieb/push-relais.md`.
- **Versand nur aus `benachrichtigung::ausliefern`, neben Web Push:** dieselben Ereignisse an
  `IosPush::versenden`, Stilles nie, Konten in `UeberHub::ios_push` nie; die auf dem Gerät stumme
  Art filtert `ios_push::soll_senden` je Anmeldung, ein Alarm geht immer. Ohne `--ios-push` ist
  `LiveHub::ios_push()` `None`, und die Routen antworten 404. Ereignisse ohne Einsatz (Störung
  einer Anbindung, LLH-2026) gehen mit (LLH-2077): im Klartext fehlt dann `e`, die App gruppiert
  sie im Thread `<kennung>-org`.
- **Klartext aus derselben Stelle wie `GET /api/notifications/{id}`**
  (`ios_push::inhalt::klartext`): Titel, Detail, Pfad; gäbe die Route 404, gehen Rückfalltitel der
  Stufe („Alarm“ / „Neue Benachrichtigung“) und `/einsaetze/{e}`, ohne Einsatz
  `/admin/einstellungen/anbindungen` (`inhalt::rueckfall_pfad` ↔ `alarm-sw.js`). Absender und Wortlaut nur mit
  „Mit Absender und Wortlaut“ (`inhalt`), nur für die Arten, zu denen der Service Worker sie holt
  (`inhalt::hat_inhalt` ↔ `pushInhalt` in `frontend/public/alarm-sw.js`, beide ziehen zusammen
  mit), und nur, wenn der Empfänger die Meldung über `GET /api/incidents/{e}/reports/{mid}` lesen
  dürfte (dieselbe Prüfung, je Empfänger auf dem Server).
- **Größe:** der Umschlag an das Relais ist höchstens `UMSCHLAG_MAX` (3072 Zeichen; APNs nimmt
  4096 Byte für den ganzen Push, das Relais weist einen größeren Push mit 400 ab). Zu langes kürzt
  `inhalt::kuerzen` in der Folge Wortlaut, Detail, Absender; Titel und Pfad nie.
- **Je Gerät eine eigene Verschlüsselung** (`nutzlast_bauen`, Vertrag mit der Extension im
  gemeinsamen Fall `src-tauri/faelle/push-nutzlast.json`); Kollaps-Kennung `kollaps` aus
  `server_id` und Benachrichtigung. Höchstens 100 Nachrichten je `POST /v1/senden`, nichts wird
  wiederholt; `token_ungueltig` löscht die Anmeldung nur bei unverändertem Token
  (`repo::erloschen`). Der Client kommt aus `ausgehend::client_builder` (`Zweck::IosPush`, 10 s,
  keine Weiterleitung, nur `https`); `senden` wartet `RELAIS_SENDEN_FRIST` (30 s), klar über der
  Gesamtfrist des Relais (20 s, `push-relais/src/senden.rs`). Beide ziehen zusammen mit.
- **Zugang zum Relais** in der Einzeilentabelle `ios_push_relais`, angelegt beim ersten Versand
  unter einer Sperre (kein doppelter Zugang bei parallelen Versänden). `401` vom Relais: einmal
  neu anmelden; `403`: `gesperrt_at` auf jetzt setzen, warnen, nie neu anmelden und
  `SPERRE_GILT_STUNDEN` (24 h) nichts senden; danach versucht der nächste Versand es einmal mit
  demselben Zugang (angenommen: Sperre weg, wieder `403`: erneuert). Solange sie steht, meldet
  `GET /api/ios-push` `relais_gesperrt` (die Oberfläche zeigt statt des Schalters den Hinweis) und
  `GET /api/admin/instance` `ios_push_relais_gesperrt_seit` (Warnung auf „Instanzkopplung“).
- **Eine fremde Kennung übernimmt nur dasselbe Gerät:** gehört sie mit anderem Token einem
  anderen Konto, ersetzt `PUT` sie nur mit demselben Schlüssel, sonst 422 (`repo::anmelden`).
- **Lebensdauer der Anmeldung** (Upsert auf `token`, eine Zeile je Gerät): sie endet
  durch `DELETE /api/ios-push/registration`, Logout (die Anmeldungen der Sitzung, in einer
  Transaktion mit der Sitzung, `session::abmelden`), „Sitzungen beenden“ (eine Sitzung: deren Anmeldungen; alle anderen: alle des Kontos
  außer denen der behaltenen Sitzung, auch die ohne Sitzung, `repo::loeschen_fuer_benutzer_ausser`;
  ein Admin für eine andere Person: alle des Kontos), Deaktivieren (jeder Weg, der `aktiv` auf 0
  setzt, über `session::konto_deaktiviert`) und Löschen des Kontos,
  `POST /api/ios-push/unregister` der
  App und `token_ungueltig`. Der Ablauf einer Sitzung und ein Passwortwechsel lassen sie stehen
  (`session_token_hash` ist `ON DELETE SET NULL`); `GET /api/ios-push` nennt dann
  `an_dieser_sitzung: false`, und der Client bindet sie per `PUT` an die neue Sitzung, damit ein
  Logout sie wieder mitnimmt. Ein neuer Weg, der Konten sperrt oder alle
  Sitzungen beendet, entscheidet über die Anmeldungen mit.
- **Keine Sicherung trägt iOS-Push:** `backup::scrub_sessions` leert mit `session` auch
  `ios_push_anmeldung` und `ios_push_relais` (Token, Geräteschlüssel, Relais-Geheimnis). Eine neue
  Tabelle mit solchen Werten kommt dort dazu.
- **`POST /api/ios-push/unregister` ohne Sitzung:** Nachweis
  `HMAC-SHA256(schluessel, "abmelden:" + kennung)`; die Antwort ist immer 204, auch bei falschem
  Nachweis oder unbekannter Kennung. Gerätekonten erreichen die übrigen Routen nicht (403).
- **Kopplung je Kanal:** `MeldenAntwort.ios_push` und `instanz_kopplung.gegenueber_ios_push`
  neben `web_push`; der ELW lässt den eigenen iOS-Push an Konten vom Hub nur aus, wenn der Hub
  iOS-Push anbietet (`hinweis::Kanal`), sonst pusht er selbst. Nur dann antwortet `PUT` am ELW mit
  422 und `GET` nennt `ueber_hub`. Nachweis `tests/ios_push.rs`, `tests/instanz_hinweise.rs`.

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
- **Chat → Meldung (y3zh5ymv D8):** `routes/chat.rs::heraufstufen` legt bei
  `in_meldungseingang: true` (nur Typ `meldung`/`lage`, sonst 422; Art `sonstige` bzw.
  `lagemeldung`) im selben `write_retry!` wie Eintrag und Rückverweis die Meldung an
  (`chat::repo::heraufstufen_zu_etb` ruft `meldung::repo::anlegen_zu_etb_tx`, kein Auto-ETB, ohne
  `client_id`: eine zweite Heraufstufung sperrt der 409-Guard). Absender ist der Anzeigename der
  Person, die die Nachricht schrieb, Meldeweg `sonstige`, Ereigniszeit und Eingang die Zeit der
  Nachricht. Ohne Freigabe der Meldungen 403 vor jedem Schreiben; fehlt das Feld, wird nur
  protokolliert. Live wie beim ETB über `meldung::live_publikation_sicherstellen`. Nachweis
  `tests/chat_meldungseingang.rs`.
- **Kenntnisnahme über die Meldung:** `POST …/meldungen/{mid}/lage-gesehen` und
  `POST …/situation/seen` mit `meldung_ids` (höchstens `LAGE_GESEHEN_MAX`); beide stehen in
  `PFAD_KEY` auf `lagemeldungen`, nicht auf `meldungen`.
- **Schwärzung:** die Lage-Spalten sind Teil der Regel `meldung` (`lage_text` NullSetzen,
  `lat`/`lon` behalten, Zeiten und Benutzer-FKs behalten).
- **Korrektur (LLH-1066):** `PATCH …/reports/{mid}` (`routes/meldung_korrektur.rs`, Schreiben
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
  Ebenso der erwartete Quellraum (`Buchung::von_br_id`, LLH-1521): ein Wechsel, dessen Kraft
  nicht mehr dort steht, ist 409 ohne Spur; wer aus einem gewählten Raum verlegt, sendet ihn mit.
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
  `build_router_mit`); das Frontend liest nur `GET /api/demo-data` (`admin/useDemoDaten.ts`).
- **Lagen** (LLH-1576): `DemoLage` ist Pfadsegment (`/api/demo-data/{lage}`, `/reimport`) und
  `demo_import.szenario`; je Org und Lage höchstens ein aktiver Kopf (Index in 0290). Eine neue
  Lage = `Szenario` in eigener Datei (`src/demo/szenario_*.rs`) mit eigenen Stammdaten-Kennungen
  (`demo_herkunft` ist je Datensatz eindeutig) und ein Wert in `DemoLage`; GET liefert immer alle
  Lagen.
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
- **Abgerufene Veranstaltungen** (LLH-2097): `veranstaltung_extern` geht 14 Tage nach `ende_at`
  (`veranstaltung_extern::repo::AUFBEWAHRUNG_TAGE`, Phase C des Purge-Laufs) oder mit dem Adapter.
  Was die Quelle planmäßig nicht mehr liefert (Ende mehr als `FENSTER_TAGE` zurück), wird nicht
  `entfernt`; eine Frist, die kürzer ist als das Fenster, holte eine Veranstaltung als neu zurück.
- **Totalsperre bleibt** (`einsatz::berechtigung::darf_lesen`, auch für den System-Admin); das
  Archiv liest nur `/api/retention` (`routes/aufbewahrung.rs`), Guard
  `archiv_namensraum_nur_lesend_und_admin` (`tests/aufbewahrung.rs`) — neue Routen dort
  eintragen, nicht lockern. Frontend: Verwaltung → „Aufbewahrung" (`admin/adminNav.tsx`), Akte
  unter `/admin/aufbewahrung/:einsatzId`.
- Archivzugriff nur für den System-Admin der eigenen Org (`fordere_archivzugriff`: fremd 403,
  unbekannt 404, aktiv 409). `PUT …/retention-period` schneidet gleich (LFH-753): Admin nur
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
  ohne diese 24 h. Ausnahme: einen Personen-Antrag am archivierten Einsatz lassen `faellige` und
  `vollziehen_ergebnis` offen (`IM_ARCHIV`); ihn vollzieht nur der Befehl `archiv loeschersuchen`
  (s. „Archiv am Hub“).
- **Geräte erfahren Schwärzung und Sperre über den Kopf** (LFH-996, Spec
  `lagebild-offline-lesen`): `EinsatzAnzeige.teilschwaerzungen` zählt vollzogene
  Personen-Anträge und geschwärzte Kategorien (`teilschwaerzungen_spalte!` und
  `teilschwaerzungen_joins!` in `einsatz/repo.rs`, in `laden` und `liste_fuer`). Vormerkung (Phase A), Vollzug mit Wirkung und Kategorie-Schwärzung
  rufen nach dem Commit `kopf_melden`; Phase B und D bleiben stumm (der Einsatz ist seit der
  Vormerkung gesperrt). Wer eine neue Teilschwärzung baut, zählt sie dort mit und meldet den
  Kopf. Herleitung: `openspec/changes/archive/2026-10-05-lfh-996-schwaerzung-clients-raeumen/design.md`.
- **Personen-Scrub nur über `PERSONENBEZUEGE`** (`einsatz/schwaerzung_person.rs`): je
  Personenart Bezug und `Mit`/`Ohne(Grund)` je Scrub-Spalte; Strategie kommt aus `TABELLEN`, nie
  eine eigene. Eine neue Tabelle mit FK auf `einsatz_person`, `einsatz_personal` oder
  `infotelefon_anruf` braucht dort einen Eintrag (Guard
  `jeder_personenverweis_ist_als_bezug_deklariert`); ein Datei-Linker an einer Person (Registry
  `ZeileLoeschen`) steht stattdessen in `PERSONENANHAENGE`, der Vollzug löscht seine Dateien
  (LFH-769). Freitexte, die eine Person nur erwähnen, bleiben bis zur Einsatz-Schwärzung.
- **Die Personensuche (`aufbewahrung::suche`) ist die einzige Archiv-Stelle, die Scrub-Spalten
  liest**: nur ganze Wörter bzw. ≥ 6 Ziffern, Antwort pseudonym, `no-store`, Suchtext nie
  geloggt, schreibt nichts (Guard `archiv_namensraum_nur_lesend_und_admin`, benannte
  Nicht-GET-Menge). Einzige Ausnahme ist der Befehl `archiv personen`
  (`einsatz/archiv/personen.rs`, LLH-1712): dieselbe Suche im entschlüsselten Block, Namen nur
  im Terminal, Admin-Spur `archiv_durchsucht` ohne Suchtext; nie eine Route.
- **Geschwärzt heißt physisch weg** (LFH-725, Spec `aufbewahrung`): `db::connect` setzt
  `secure_delete = ON` (nicht `FAST`: das lässt die Overflow-Seiten gelöschter Anhang-BLOBs
  stehen) und `journal_size_limit` (LFH-928), und nach einer Schwärzung oder einem Sweep mit
  Löschungen schreibt der Purge-Lauf den WAL per `db::wal_zurueckschreiben` zurück. Die Haupt-DB
  nur über `db::connect` öffnen. Netz:
  `schwaerzung_hinterlaesst_keine_altbytes` (`einsatz/purge_scheduler/tests.rs`). Herleitung und
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
  fail-closed wie beim Purge-Audit; trug der Einsatz eine Kennung, dazu ihr Löschvermerk
  (`fuehrung_loeschvermerk`, LLH-1699: nur die Kennung, s. „Instanzkopplung“, Akten ohne Spiegel). Erstmaliges Setzen und Verkürzen der Frist ohne
  `skelett_dauer_bestaetigt` → 409. Das Protokoll sperrt ID und Einsatznummer
  (`einsatz::repo::anlegen_tx`). Herleitung:
  `openspec/changes/archive/2026-10-02-lfh-750-skelett-endgueltig-loeschen/design.md`.
- **Nachbereitung und Abräumen** (LLH-1494): der Abschluss setzt `einsatz.nachbereitung_bis`
  aus `org_einstellungen.nachbereitung_tage` (`einsatz/nachbereitung.rs`, ETB-Eintrag).
  Danach räumt Phase R (`einsatz/abraeumen.rs`) Spiegel der meldenden Seite ab und holt jeden
  stehen gebliebenen Merker `einsatz_abraeumen` nach. Das Löschprotokoll trägt `art`:
  `skelett` (Pflichtfelder per CHECK), `verwahrt` (mit Nummer, an die Gegenstelle übergeben) und
  `spiegel` (ohne Nummer, die gehört dem Führer; Übersicht lässt sie aus). Alle Arten sperren
  die ID, nur Zeilen mit Nummer die Nummer.
- **Archiv am Hub** (LLH-1494): Phase N des Purge-Laufs (`einsatz/archiv.rs`, vor Phase A)
  archiviert einen Einsatz am Ende der Nachbereitung, wenn seine Org geprüfte
  `org_archiv_empfaenger` hat und nicht meldende Seite einer Kopplung ist: Kopie in eine eigene
  SQLite-Datei mit demselben Schema (`archiv/bauen.rs`; Tabellen aus `spiegel::art::GESPIEGELT`,
  Stammzeilen aus `STAMM` bereinigt), je Kategorie-Frist ein Block (`plane_bloecke`), jeder
  age-verschlüsselt an alle geprüften Schlüssel; dann `schwaerze_nach_archiv_tx` ohne Karenz.
  Eine neue Stammtabelle mit FK aus einer Einsatztabelle braucht einen Eintrag in `STAMM` (Guard
  `stamm_deckt_alle_verweise_und_spalten`). Abgelaufene Blöcke löscht Phase N mit ETB-Eintrag,
  Phase D wartet auf den letzten. Ein Löschersuchen für den ganzen archivierten Einsatz löscht
  alle Blöcke.
- **Löschersuchen für eine Person im Archiv** (LLH-1712, `archiv/loeschersuchen.rs`, Befehl
  `archiv loeschersuchen`, Spec `aufbewahrung-loeschersuchen`, Herleitung
  `openspec/changes/archive/2026-11-13-xlrgl4du-loeschersuchen-person-im-archiv/design.md`): Der Server hat keinen privaten Archiv-Schlüssel, deshalb nie im
  Purge-Lauf. Je Einsatz alle Blöcke entschlüsseln, migrieren, `scrubbe_person` je Antrag,
  `VACUUM`, an die **heute geprüften** Schlüssel neu verschlüsseln; abgelegt wird in einer
  Transaktion, die Anträge und `sha256` jeder Zeile gegen den Stand des Baus prüft (sonst nichts),
  dann UPDATE je Zeile (Nummer und Frist bleiben), Kopien der alten `sha256` vormerken
  (`kopien_vormerken_tx`, vor dem UPDATE: danach fände sie keiner mehr), Anträge mit ETB
  (`antrag::im_archiv_vollzogen_tx`) und Admin-Spur `archiv_person_geschwaerzt`. Der neue
  `sha256` sperrt alte Downloads über `hier_geloescht`. Zwischendateien eines Befehls tragen
  einen Teil aus `bauen::BEFEHL_TEILE`, sonst räumt sie der laufende Server mitten im Befehl ab.
- **Archiv einspielen** (LLH-1494, `archiv/einspielen.rs`, Befehl `archiv einspielen`): migriert
  die entschlüsselte Datei, schwärzt abgelaufene Kategorien nach und übernimmt den Einsatz über
  die Spiegel-Maschinerie (`liefern`/`uebernehmen`) mit einer Kopplung, die nur in der
  Transaktion lebt. Ergebnis: beendeter Spiegel ohne Kopplung (`einsatz_archiv_eingespielt`),
  Konten als gesperrte Platzhalter (`archiv_konto`, raus aus `OHNE_STELLVERTRETER`, nie Mitglied,
  für keine Admin-Route und keine Kopplung erreichbar). Phase R räumt ihn nach 7 Tagen ab, früher
  bei einer Frist des Blocks; ein Block, der hier nicht mehr im Archiv steht, kommt nicht zurück,
  und ein Löschersuchen nimmt eine eingespielte Kopie mit (`archiv::alle_loeschen_tx`). Den
  Merker setzt auch hier nur `spiegel` (`loeschen_unter_merker`, `anhang::inhalt_einsetzen`).
  Eine neue Stammtabelle in `STAMM` braucht einen Namen in `STAMM_NAME` (Guard
  `stamm_name_deckt_die_stammdaten_des_archivs`).

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Scan in `src/anhang/mod.rs` hinter Feature `clamav` (Default an). Keine `--clamav-addr` → No-op;
clamd erreichbar → Scan (Fund 422); clamd weg → **503 fail-closed** (oder `--clamav-fail-open`).
Wer `src/anhang/mod.rs`/`clamd_scan` anfasst, fährt auch `cargo test --no-default-features`.
`tests/karte_hintergrundbild_scan.rs` prüft 503 gegen `127.0.0.1:1`. `clamd_verbinden` hat zwei
cfg-Varianten (`unix:` nur unter `#[cfg(unix)]`; Windows → `ScannerNichtErreichbar`).
