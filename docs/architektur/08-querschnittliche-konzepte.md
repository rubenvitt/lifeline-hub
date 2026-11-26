# 8. Querschnittliche Konzepte

Stand: 26.11.2026 (Koordinaten über den Hub nur für gekoppelte Kennungen, LLH-2119; Fax und PDF des Ausgangs, LLH-2095; Matrix als zweiter Kanal des Ausgangskorbs, LLH-2094; Nachrichten an Menschen über den Ausgangskorb, LLH-2093; Ortung von Fahrzeugen, LLH-2091; Ablage und Löschung abgerufener Veranstaltungen, LLH-2097; iOS-Push über das Push-Relais, LLH-1981; Schlüsselwechsel des Geheimnisspeichers, LLH-2025; Android-Hülle im Hüllen-Vertrag, LLH-1989; Geheimnisse und Abrufe der Adapter, LLH-2017; Hüllen-Vertrag der App-Hüllen, LLH-1978; Fehlergrenze und Client-Fehlerbericht, LLH-1822).

Dieses Kapitel nennt jedes Konzept, das mehrere Bausteine trägt, sagt, wo es im Code sitzt, und
zeigt auf die Stelle, an der seine Regeln stehen. Es wiederholt diese Regeln nicht: maßgeblich
sind die `AGENTS.md`-Dateien (Tabelle in der [Wurzel-`AGENTS.md`](../../AGENTS.md)), die
Fähigkeits-Specs unter `openspec/specs/` (eingefroren, ADR-0069), die Design-Docs unter
`docs/superpowers/specs/` und die Archiv-Designs. Bausteinnamen wie in der
[Bausteinsicht](05-bausteinsicht.md).

## 8.1 Organisation als Mandant

Jeder Datensatz mit Fachbezug hängt über `org_id` an einer Organisation; die Organisation ist
die Mandantengrenze (`Benutzer.org_id` in `src/auth/mod.rs`). Der Org-Floor läuft in jedem
einsatzgebundenen Handler im Extractor `EinsatzKontext` (`src/einsatz/kontext.rs`, Prüfung
`berechtigung::fordere_org_zugehoerigkeit`). Dass jede Route unter `/api/incidents/{id}/…` ihn
zieht, erzwingt `tests/einsatz_kontext_guard.rs`; die Grenze gegen eine echte zweite Organisation
prüft `tests/cross_org.rs`. Wie ein System-Admin über die Org-Grenze liest und schreibt, regelt
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Admin-Schreibwege am Einsatz“.

## 8.2 Autorisierung: Einsatzrollen und Modulrechte

Im Einsatz gibt es vier Rollen (`EinsatzRolle` in `src/einsatz/mod.rs`: `einsatzleitung`,
`fuehrungspersonal`, `mitarbeit`, `beobachter`); ein gekoppeltes Gerät bekommt seine Rolle aus der
Funktionsansicht, nicht aus einer Mitgliedschaft (`src/einsatz/kontext.rs`). Die Lese-, Schreib-
und Modul-Gates stehen in `src/einsatz/berechtigung.rs`, die gültigen Modul-Keys in
`src/einsatz/modul.rs` (Spiegel der Frontend-`modulRegistry.ts`, Drift-Test in
`tests/modul_override.rs`). Die effektive Modulfreigabe rechnet allein der Server; der Client
zeigt nur an (Spec [`modul-freigabe`](../../openspec/specs/modul-freigabe/spec.md)). Wer Zugriff
verwaltet, regelt Spec [`einsatz-zugriff`](../../openspec/specs/einsatz-zugriff/spec.md).
Mitarbeit erfasst ohne Schreibrecht: `EinsatzErfassungszugriff` und `EinsatzErfassungsfreigabe`
(`src/einsatz/kontext.rs`) stehen nur an einer Positivliste, Regeln in
[ADR-0072](entscheidungen/ADR-0072-erfassen-ohne-schreibrecht-hat-eigene-gate-typen-an-einer-positivliste.md)
und [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Erfassungs-Gate (LLH-1817)“.
Ein Spiegel, der `mitarbeit` gegen einen älteren Führer festgehalten hat, trägt sie nach dessen
Aufrüsten einmal nach
([ADR-0088](entscheidungen/ADR-0088-ein-spiegel-traegt-festgehaltene-mitarbeit-einmal-beim-fuehrer-nach.md)).

## 8.3 Fehlervertrag und Statuscodes

Jeder Fehler geht als `AppError` (`src/error.rs`) hinaus und wird einheitlich als JSON
`{ "error": "<Meldung>" }` beantwortet; `JsonBody` in `src/extract.rs` hält diesen Vertrag auch
für Extractor-Ablehnungen. Welcher Fall 400, 409, 413 oder 422 ist, steht verbindlich in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Statuscode-Konvention“. Nachweis des
Vertrags: `tests/fehler_vertrag.rs`.

Unter `/api/v1/` (öffentliche API, [ADR-0096](entscheidungen/ADR-0096-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1-zusage-ab-1-0.md))
trägt jeder Fehler zusätzlich einen stabilen englischen `code`. Vertrag ist dort der Code, nicht
der Text. v1-Handler setzen ihn über `ApiError`; alles andere unter `/api/v1/` bekommt ihn von
den Schichten `public_api::error_code_layer` (an den Routen, innerhalb der Kompression) und
`public_api::contract_layer` (außen, mit `no-store`), auch Extractor-Ablehnungen, 404, 405, 413, Panik und
Lastabwurf (Spec [`oeffentliche-api-vertrag`](../../openspec/specs/oeffentliche-api-vertrag/spec.md)).

## 8.4 Eingabegrenzen

Freitexte, Listen und Geometrien von außen haben je eine Höchstgrenze, und jeder Body ist vor dem
Handler begrenzt (`JSON_BODY_MAX` in `src/app.rs`). Die Regeln stehen in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Eingabegrenzen“, und in Spec
[`eingabegrenzen`](../../openspec/specs/eingabegrenzen/spec.md). Das Frontend spiegelt die
Grenzen in `frontend/src/api/eingabegrenzen.ts`; `tests/eingabegrenzen_spiegel.rs` vergleicht
beide Seiten Name für Name.

## 8.5 API-Kontrakt und Typ-Codegen

Response-Typen entstehen aus dem Rust-Code: `#[derive(ToSchema)]` → `src/api_doc.rs` →
`frontend/src/api/openapi.json` → `frontend/scripts/gen-types.mjs` → `frontend/src/api/types.generated.ts`
(Skript `gen:types` in `frontend/package.json`; eigener Generator ohne Abhängigkeiten und ohne
TS-Compiler-API, [ADR-0106](entscheidungen/ADR-0106-frontend-typen-kommen-aus-einem-eigenen-generator-ohne-ts-compiler-api.md)). Ablauf, Wire-Enums und handgepflegte Reste
regelt [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Typ-Codegen“. Drift fängt
`scripts/check-typ-codegen.sh` (Schritt 3 des Sammel-Gates) mit `tests/openapi_spec_aktuell.rs`;
die Wire-Werte der Enums hält `tests/enum_wire_kontrakt.rs` fest.

Dieses Dokument hat keine Pfade und keine Zusage. Einen Pfad-Vertrag hat nur die öffentliche API
unter `/api/v1/`: eigenes Dokument (`src/public_api`, ausgeliefert unter
`GET /api/v1/openapi.json`, versioniert als `docs/api/public-v1.json`) mit eigenen Schemas und
Stabilitätszusage. Router und Dokument entstehen dort zusammen; den Drift fängt
`tests/public_api_spec_aktuell.rs` im selben Gate.

## 8.6 Live-Aktualisierung

Änderungen erreichen andere Tabs über Server-Sent Events: ein Strom je Einsatz und ein Org-Strom
(`src/live/mod.rs`, `src/live/org.rs`, Stromgrenzen in `src/live/strom.rs`). Die Ereignisnamen
sind ein Wire-Kontrakt (`LiveEvent` und `OrgLiveEvent`), gegengeprüft vom Frontend in
`frontend/src/api/liveEvent.contract.test.ts` und `frontend/src/api/orgLiveEvent.contract.test.ts`. Ein kurz getrennter Client bekommt Verpasstes aus
einem Ring je Einsatz über `Last-Event-ID` nachgeliefert (`REPLAY_KAPAZITAET`, `REPLAY_KARENZ` in
`src/live/mod.rs`, Nachweis `tests/live_feed.rs`). Wie der Client abgleicht, legt Spec
[`live-abgleich`](../../openspec/specs/live-abgleich/spec.md) fest; Org-Ereignisse regelt
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Org-Ereignisse“.

Fremdsysteme hängen nicht an diesen Strömen. Für sie gibt es eine Outbox (`maschine_ereignis`),
die Trigger in der Transaktion der Änderung füllen, je freigegebenem Zugang, und den Abruf
`GET /api/v1/events` mit Cursor und Long-Poll (`src/public_api/events.rs`). Die Ereignisse tragen
nur Art, Zeit und Einsatz-ID. Regeln:
[ADR-0038](entscheidungen/ADR-0038-ausgangsereignisse-fuer-fremdsysteme-entstehen-per-trigger-und-je-zugang.md),
Spec [`ereignis-abruf`](../../openspec/specs/ereignis-abruf/spec.md) und
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Ausgangsereignisse für Fremdsysteme“; Ablauf
in der [Laufzeitsicht](06-laufzeitsicht.md), 6.6f.

## 8.7 Persistenz

Der Server hält alles in einer SQLite-Datei über sqlx (`src/db.rs`: WAL, Fremdschlüssel,
`secure_delete = ON`, `busy_timeout` 5 s). Nachschlage-Caches (Geocoding, Fachebenen) liegen in
einer eigenen Datei, damit sie nicht um den Schreiber konkurrieren (`src/cache_db.rs`). Das
Schema wächst nur über Migrationen in `migrations/`, eingespielt beim Start
(`sqlx::migrate!` in `src/db.rs`). Wie sie nummeriert werden und dass sie unveränderlich sind,
regelt die [`migrations/AGENTS.md`](../../migrations/AGENTS.md), Abschnitt „Migrationsvergabe“.

Zwei Regeln sitzen als SQLite-Trigger in der Datenbank statt im Code, damit kein Schreibweg sie
umgeht (LLH-1493, `migrations/0306_stammdaten_verteilung.sql`): Jede Änderung an einer
verteilten Stammdatentabelle schreibt ihren Stand ins Änderungslog `stammdaten_aenderung`, und
an einer Instanz, die Stammdaten aus einer Kopplung übernimmt, bricht jeder Schreibversuch auf
eine übernommene Zeile mit `stammdaten_vom_hub` ab (409 „Wird am Hub gepflegt.“, `src/error.rs`).
Nur die Übernahme selbst setzt den Merker `stammdaten_uebernahme` für ihre Transaktion.
Wer eine solche Tabelle neu baut, legt ihre Trigger wieder an; ein Test vergleicht sie mit
`src/instanz/stammdaten/art.rs` ([`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt
„Instanzkopplung“).

Ebenso sitzen Änderungslog und Schreibschutz gespiegelter Einsätze in Triggern (LLH-1492,
`migrations/0314_einsatz_spiegel.sql`,
[ADR-0018](entscheidungen/ADR-0018-ein-einsatz-wird-als-spiegel-in-denselben-tabellen-gehalten.md)):
An jeder Einsatztabelle aus `instanz::spiegel::art::GESPIEGELT` schreiben
`<tabelle>_spiegellog_i/_u/_d` den Stand der Zeile nach `einsatz_aenderung`, und
`<tabelle>_spiegelschutz_i/_u/_d` brechen an einem Spiegel mit `einsatz_ist_spiegel` ab (409
„Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die führende Instanz.“,
`src/error.rs`), außer unter dem Merker `spiegel_uebernahme`. Routen und Repos prüfen deshalb
nicht selbst, ob ein Einsatz ein Spiegel ist; Hintergrundläufe lassen Spiegel über
`einsatz::spiegel_filter::nicht_gespiegelt` aus. Die Trigger erzeugt `spiegel::art::trigger_sql`,
und Tests vergleichen sie mit dem Schema ([`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt
„Instanzkopplung“, „Spiegel und Anträge“).

## 8.8 Nebenläufigkeit und Transaktionen

Schreibende Transaktionen holen den Schreib-Lock am Beginn (`BEGIN IMMEDIATE`) und wiederholen
sich bei `SQLITE_BUSY` über das Makro `write_retry!` (`src/tx.rs`, `MAX_VERSUCHE`); danach endet
der Aufruf mit 503. Der Body darf nur Datenbankarbeit tun; Live-Ereignisse und Benachrichtigungen
folgen nach dem Commit (Modul-Doku in `src/tx.rs`). Gegen gleichzeitige Bearbeitung derselben
Zeile prüfen die Repos einen Vergleichswert (Zeilen-CAS `basis_geaendert_at`, Feld-CAS
`erwartet`) und antworten mit 409; die Regeln samt Client-Spiegel stehen in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Statuscode-Konvention“. Offline erfasste
Einträge tragen eine `client_id`, die den Replay idempotent macht (`tests/etb.rs`,
`erfassung_mit_client_id_ist_idempotent`).

## 8.9 Zeit und Zeitzonen

Datenbank und Wire kennen ein Zeitformat: UTC ohne Zonenkennung, sekundengenau
(`zeit::FORMAT` in `src/zeit.rs`). Eine Wanduhrzeit ohne Datum (etwa der Beginn einer Mahlzeit)
ist ein eigener Typ `Uhrzeit` (`src/uhrzeit.rs`). Gezeigt wird in der Anzeigezone: Einsatz vor
Organisation vor Gerätezeit (`frontend/src/anzeige/AnzeigeKonventionenContext.tsx`, Wandlung in
`frontend/src/anzeige/zeitEingabe.ts`). Die Schreibweise (taktische DTG oder Datum und Uhrzeit)
legt Spec [`zeitdarstellung`](../../openspec/specs/zeitdarstellung/spec.md) fest, die Eingabe
Spec [`zeiteingabe`](../../openspec/specs/zeiteingabe/spec.md); dass Zeiten nur im Formatkern
`frontend/src/anzeige/` formatiert werden, prüft `anzeige/zeitDarstellung.guard.test.ts`. Texte,
die der Server fertig schreibt (ETB-Einträge, Detailzeile eines Hinweises), nennen Zeiten in Zone
und Darstellung des Einsatzes, sonst der Organisation, sonst Europe/Berlin und taktisch; beides
lädt nur `zeitstil_laden` in `src/zeitdarstellung.rs`.

## 8.10 Offline-Fähigkeit

Das Frontend ist eine PWA (`vite-plugin-pwa`, Aktivierung neuer Versionen nur per Prompt,
`frontend/src/runtimeKonfiguration.guard.test.ts`). Ein ausgewählter Teil des Lagebilds bleibt
ohne Netz lesbar und liegt in einer eigenen IndexedDB (`frontend/src/offline/lagebildSpeicher.ts`);
was dazugehört, steht in der Registry `LAGEBILD_OFFLINE` in `frontend/src/api/queryKeys.ts`.
Schreibaktionen ohne Netz werden vorgemerkt und später gesendet (`frontend/src/offline/queue.ts`).
Regeln: [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md); Anforderungen:
Spec [`lagebild-offline-lesen`](../../openspec/specs/lagebild-offline-lesen/spec.md) und
[`geraetedaten-raeumung`](../../openspec/specs/geraetedaten-raeumung/spec.md).

## 8.11 Browserspeicher

`localStorage` wird nur über `frontend/src/lib/sichererSpeicher` angesprochen, damit ein
gesperrter oder voller Speicher die App nicht ausfallen lässt; jeden anderen Zugriff macht
`lib/sichererSpeicher.guard.test.ts` rot. Regeln: [`frontend/AGENTS.md`](../../frontend/AGENTS.md),
Abschnitt „Browserspeicher“; Anforderungen: Spec
[`browserspeicher`](../../openspec/specs/browserspeicher/spec.md). Jeder Speicherort des Geräts
steht in `GERAETESPEICHER` ([`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md)).

## 8.12 Client-Datenhaltung und Navigation

Serverdaten hält das Frontend in TanStack Query (`@tanstack/react-query` in
`frontend/package.json`); jeder Abfrageschlüssel stammt aus der Registry in
`frontend/src/api/queryKeys.ts`. Regeln dazu und zum Deeplink-Muster (Route oder Query-Parameter)
stehen in [`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitte „Query-Key-Registry“ und
„Deeplink-Muster“. Geschrieben wird nur über `apiSend`/`apiUpload` in
`frontend/src/api/client.ts`, die den erwarteten Benutzer mitsenden (Abschnitt „Sitzung über
mehrere Tabs“ ebenda, Regeln in [`frontend/src/auth/AGENTS.md`](../../frontend/src/auth/AGENTS.md)).

## 8.13 Anhänge und Virenscan

Dateien eines Einsatzes liegen in der Tabelle `anhang`; jeder modulgebundene Verweis darauf
(Dokumentenablage, ETB, Schäden, Tiere, UHS, Personen, Lageberichte, Befehle) ist in
`anhang::repo::MODUL_LINKER` eingetragen (`src/anhang/repo.rs`), der Chat verknüpft frei.
Kartenhintergründe und UHS-Pläne haben eigene Tabellen (`migrations/0075_karte_hintergrundbild.sql`,
`migrations/0152_uhs_plan.sql`). Uploads scannt ClamAV (Feature `clamav`, Vorgabe an): ohne `--clamav-addr` kein
Scan, mit Fund 422, ohne erreichbaren Scanner 503 (fail-closed). Regeln:
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitte „Anhänge“ und „ClamAV-Upload-Scan“; Nachweise
in den `tests/*_scan.rs`.

## 8.14 Aufbewahrung, Löschung und Schwärzung

Ein abgeschlossener Einsatz bleibt eine Schonfrist lang für alle Mitglieder lesbar
(`NACHLAUF_STUNDEN` in `src/einsatz/berechtigung.rs`); nach Ablauf seiner Aufbewahrungsfrist ist
er für jeden gesperrt, auch für den System-Admin (`einsatz::berechtigung::darf_lesen`). Fällige
Einsätze schwärzt der Purge-Lauf (`src/einsatz/purge_scheduler.rs`); danach liest sie nur noch
das Archiv `/api/retention` (`src/aufbewahrung/`). Personendaten werden geschwärzt (`src/einsatz/schwaerzung_*.rs`) und physisch überschrieben (`secure_delete`
in `src/db.rs`, `src/db/physisch.rs`). Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt
„Aufbewahrung“; Specs [`aufbewahrung`](../../openspec/specs/aufbewahrung/spec.md),
[`aufbewahrung-archiv`](../../openspec/specs/aufbewahrung-archiv/spec.md),
[`aufbewahrung-kategorien`](../../openspec/specs/aufbewahrung-kategorien/spec.md) und
[`aufbewahrung-loeschersuchen`](../../openspec/specs/aufbewahrung-loeschersuchen/spec.md). Was das
Gerät danach räumt: [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md),
Abschnitt „Räumen nach einer Schwärzung“.

Daten ohne Einsatz löscht derselbe Lauf nach eigener Frist (Phase C), darunter die abgerufenen
Veranstaltungen 14 Tage nach ihrem Ende (`veranstaltung_extern::repo::purge`,
`AUFBEWAHRUNG_TAGE` in `src/veranstaltung_extern/repo.rs`).

## 8.15 Audit und Zugangsprotokoll

Anmeldungen schreiben in `auth_audit` (`src/auth/audit.rs`), zugangsändernde Admin-Aktionen in
`admin_audit` (`src/auth/admin_audit.rs`); gelesen werden beide nur über
`routes::zugangsprotokoll` (Spec [`zugangsprotokoll`](../../openspec/specs/zugangsprotokoll/spec.md)).
Zugriffe auf Personendaten protokolliert `src/person/audit_repo.rs`; die Einsicht für die
Einsatzleitung regelt Spec
[`personen-zugriffsprotokoll`](../../openspec/specs/personen-zugriffsprotokoll/spec.md). Regeln
zur Admin-Spur: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Admin-Spur“.

## 8.16 Logging und Observability

Der Server loggt über `tracing`; jeder Request läuft in einem Span mit Methode, Pfad und
Request-ID (`x-request-id`). Gegen Log-Flut fasst `src/log_drossel.rs` Ereignisse, die ein Fremder je Anfrage auslösen kann,
zu Sammelzeilen zusammen, und
HTTP/1-Köpfe über `HTTP1_MAX_KOPF` weist `src/verbindung.rs` mit 431 ab. Abstürze im Browser
kommen als gedrosselte Warnzeile an (Abschnitt 8.30).
Beschreibung für den Betrieb: [`docs/betrieb/observability.md`](../betrieb/observability.md).

## 8.17 Anmeldung, Sitzung und Transportsicherheit

Anmeldewege sind Passwort, Passkey (WebAuthn), OIDC und ein zweiter Faktor per TOTP
(`src/auth/provider/`, `src/auth/webauthn/`, `src/auth/oidc/`, `src/auth/totp/`); welche Wege
aktiv sind, entscheidet `src/auth/provider/registry.rs`. Die Sitzung ist ein Cookie
(`src/auth/session.rs`), Fehlversuche begrenzt `src/auth/rate_limit.rs` je Quelle. HTTPS kann der
Server selbst terminieren (`src/tls/mod.rs`, Zertifikat aus eigener Datei, Cache, mkcert oder
selbst signiert). Jede Antwort trägt `X-Content-Type-Options: nosniff`
([`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Schutzköpfe“). Betrieb:
[`docs/betrieb-tls.md`](../betrieb-tls.md), [`docs/betrieb-oidc.md`](../betrieb-oidc.md),
[`docs/betrieb-webauthn.md`](../betrieb-webauthn.md), [`docs/betrieb-mfa.md`](../betrieb-mfa.md).

Maschinen (gekoppelte Instanzen und Fremdsysteme) melden sich nicht mit einer
Sitzung an, sondern weisen jede Anfrage mit einem eigenen Ed25519-Schlüssel aus: kompaktes JWS
mit Wiederholschutz in der DB, Antwort ebenso signiert, Einstieg per Einmal-Code eines Org-Admins
([ADR-0034](entscheidungen/ADR-0034-maschinen-weisen-sich-mit-schluesselpaar-aus-ausser-beim-einwurf.md),
`src/instanz/`, [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Instanzkopplung“). Fremdsysteme
nutzen dasselbe Verfahren mit eigenem Profil (`lifeline-machine+jwt`, Kopf
`Authorization: Machine`), eigenen Tabellen und festen Scopes je Zugang, nur unter `/api/v1/`
([ADR-0096](entscheidungen/ADR-0096-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1-zusage-ab-1-0.md),
`src/public_api/machine.rs`, Spec [`maschinenzugang`](../../openspec/specs/maschinenzugang/spec.md)).
Ihre Fehlversuche zählt ein eigener Zähler je Quelle, nie die Anmeldesperre.
Einzige Ausnahme vom Schlüsselpaar ist der Einwurf für Absender, die nicht signieren können: ein
Schlüssel im Pfad, nur unter `/api/v1/intake/`, nur schreibend, nur über TLS und nie im Protokoll
([ADR-0023](entscheidungen/ADR-0023-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md),
`src/public_api/einwurf/`, Spec [`einwurf-zugang`](../../openspec/specs/einwurf-zugang/spec.md)).
Erklärungen eines Org-Admins, die eine andere Instanz prüfen soll, unterschreibt er mit einem
eigenen Passkey, der nie zur Anmeldung taugt (`src/auth/unterschrift/`). Einen nachgelieferten neuen
Schlüssel nimmt die übernehmende Instanz erst nach der Bestätigung eines Admins dort an, der die
letzten vier Zeichen des Fingerabdrucks beim Inhaber erfragt (LLH-1605).

Eine Direktkopplung zweier Instanzen vor Ort (LLH-1497) vertraut nicht dem Betriebssystem, sondern
einer signierten Aussage der Gegenstelle über ihr TLS-Zertifikat und pinnt es
([ADR-0029](entscheidungen/ADR-0029-eine-direktkopplung-beglaubigt-das-tls-zertifikat-per-signierter-aussage.md),
`src/instanz/zertifikat.rs`). Konten und Stammdaten erkennen zwei Instanzen derselben Quelle an
ihrer Ursprungskennung `<instanzkennung>/<schlüssel>` (`src/instanz/stammdaten/herkunft.rs`,
Spec `stammdaten-verteilung`); sie erweitert das Vertrauen in eine gekoppelte Instanz nicht.

Gekoppelte ELW bekommen Konten samt Passwort-Hash und TOTP-Geheimnis, damit die Anmeldung ohne
Netz geht (LLH-1493). Die Geheimnisse gehen mit age Ende-zu-Ende an den Schlüssel des ELW und nur,
wenn sein Betreiber die Datenträgerverschlüsselung bestätigt hat. Ein Admin mit Passkey meldet
sich an einer Instanz, die die Geheimnisse seiner Org verteilt, nicht mehr per Passwort an
([ADR-0016](entscheidungen/ADR-0016-admins-einer-verteilenden-instanz-melden-sich-per-passkey-an.md)).
„ELW verloren“ macht die dorthin verteilten Passwörter und zweiten Faktoren ungültig.

Einen Antrag von einem Spiegel führt die führende Instanz im Namen des Kontos aus, das ihn
gestellt hat (LLH-1492, Spec `spiegel-antraege`): Sie baut eine Anfrage an ihren eigenen Router
und hängt die Extension `AntragAkteur` an; `CurrentUser` nimmt das Konto dann aus ihr statt aus
dem Cookie (`src/auth/session.rs`). So gelten Rechte, Modul, Freeze, `client_id`-Replay, Live und
Audit wie bei einem eigenen Aufruf. Die Extension legt nur `instanz::spiegel::antrag::ausfuehren`
an; HTTP kann sie nicht setzen (`tests/instanz_spiegel.rs`,
`ein_verschwundener_bezug_beim_fuehrer_lehnt_ab_und_ohne_anmeldung_gibt_es_keinen_akteur`). Das
Konto bildet die meldende Seite über die Stammdaten-Herkunft ab; ein Konto ohne Gegenstück zeigt
am Spiegel auf einen Stellvertreter, der sich nie anmelden kann
([ADR-0018](entscheidungen/ADR-0018-ein-einsatz-wird-als-spiegel-in-denselben-tabellen-gehalten.md)).

Je Einsatz einer gekoppelten Org führt genau eine Instanz (LLH-1491, Schalter
`LIFELINE_FUEHRUNG`,
[ADR-0044](entscheidungen/ADR-0044-ueber-eine-direktkopplung-gibt-keine-seite-ohne-beweis-und-einsatzleitung-ab.md)). Jede andere
hält den Einsatz als Spiegel (LLH-1641): die Akte entscheidet, `einsatz.spiegel` folgt ihr, und
nur der Schutz-Trigger des Spiegels sperrt, am Server wie in `schreibrecht.ts`. Am Spiegel wird
beantragt. Eine Notübernahme gegen die Instanz, die sich meldet, trägt die
Unterschrift eines Org-Admins oder einen Code, den sie selbst erzeugt hat, und gilt dort erst
nach der Bestätigung eines Menschen (Ablauf 6.6c).

Über eine Direktkopplung wechselt die Führung gleichrangig (LLH-1678, `instanz::wechselregel`): Jede
Seite verhält sich gegenüber der anderen wie die Instanz, die sich meldet, gleich wer den Code
eingelöst hat. Eine Notübernahme braucht dort immer einen Beweis, und eine Anfrage entscheidet die
Einsatzleitung der führenden Seite. Dafür kennen beide Seiten die Unterschriftsschlüssel der
anderen; ein ELW liefert seine dem Hub, wo sie auf die Bestätigung eines Admins warten. Der Hub
zieht einen Wechsel zwischen zwei ELW nach, wenn der bisherige Führer ihn bezeugt oder eine
Unterschrift ihn belegt, die am Hub gilt (Spec `instanz-fuehrung`).

## 8.18 Konfiguration über die Umgebung

Jeder Schalter des Servers ist ein Argument der clap-`Config` in `src/config.rs` mit
Umgebungsvariable; kein anderes Modul liest `std::env::var` (`tests/env_config_guard.rs`).
`lifeline-hub --help` zeigt die vollständige Liste; was eine Vertrauensgrenze verschiebt, steht in
[`docs/betrieb/env-registry.md`](../betrieb/env-registry.md).

## 8.19 Benachrichtigungen

Schreibwege und Scheduler melden nach dem Commit über `benachrichtigung::melden`
(`src/benachrichtigung/`); zugestellt wird über die Live-Ströme, mit Schalter `--web-push` auch per
Web Push an geschlossene Tabs (`src/web_push/`), mit Schalter `--ios-push` über das Push-Relais und
APNs an die iOS-App bei geschlossener App (`src/ios_push/`, `push-relais/`, Inhalt Ende-zu-Ende
verschlüsselt, [ADR-0090](entscheidungen/ADR-0090-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md)),
und in Desktop-, iOS- und Android-Hülle als native Meldung, in iOS- und Android-Hülle nur bei
laufender App (8.31).
Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitte „Benachrichtigungen“ und „iOS-Push“;
Spec [`benachrichtigungen`](../../openspec/specs/benachrichtigungen/spec.md); Betrieb
[`docs/betrieb/web-push.md`](../betrieb/web-push.md), [`docs/betrieb/push-relais.md`](../betrieb/push-relais.md).

## 8.20 Datensicherung

Sicherungen sind Vollkopien der Datenbank, mit gesetzten Empfängern per `age` verschlüsselt
(`src/backup/verschluesselung.rs`), geplant über `src/backup/scheduler.rs` und eingespielt über
`src/backup/restore.rs`. Betrieb: [`docs/betrieb/backup-restore.md`](../betrieb/backup-restore.md).

## 8.21 Gestaltungssprache und Design System

Die Oberfläche folgt der Gestaltungssprache „Instrumententafel“ (dunkel, Radius 0, Bedienfarbe
blau); maßgeblich sind [`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitt
„Gestaltungssprache“, und [`docs/design/2026-09-21-neuentwurf/`](../design/2026-09-21-neuentwurf/).
Die Werte stehen in `frontend/src/theme/` (`tokens.ts`, `statusFarben.ts`, `rollen.css`). Das
Design System unter [`docs/design/design-system/`](../design/design-system/) ist aus dem Code
erzeugt (Generator `frontend/scripts/design-system/`); `frontend/src/designSystem.guard.test.ts`
macht Drift rot.

## 8.22 Bedien-Leitlinie und Einsatztauglichkeit

Gebaut wird für vier Einsatzkontexte (Fükw, Führungs-Tablet, ortsfeste Stelle, mobil), und jede
neue oder umgebaute Seite durchläuft die Prüfliste Einsatztauglichkeit. Regeln:
[`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitte „Bedien-Leitlinie“ und
„UI-Form-Leitlinie“; Herleitung
[`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`](../superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md)
und [`docs/leitlinien/bedien-leitlinie-herleitungen.md`](../leitlinien/bedien-leitlinie-herleitungen.md).
Mindestmaße der Bedienziele je Dichtestufe legt Spec
[`einsatztauglichkeit-layout`](../../openspec/specs/einsatztauglichkeit-layout/spec.md) fest.
Erfassungsformulare und Entwürfe folgen der Erfassungs-Norm (Abschnitt „Erfassungs-Norm“ ebenda,
[`frontend/src/entwurf/AGENTS.md`](../../frontend/src/entwurf/AGENTS.md)).

## 8.23 Kontrast und Barrierefreiheit

Text hält im Tagbetrieb mindestens 7 : 1 und im Nachtbetrieb mindestens 5 : 1 gegen seinen Grund
(Specs [`textstufen-kontrast`](../../openspec/specs/textstufen-kontrast/spec.md),
[`farbrollen-kontrast`](../../openspec/specs/farbrollen-kontrast/spec.md),
[`textkontrast-rollen`](../../openspec/specs/textkontrast-rollen/spec.md)). Gemessen wird in den
`*Kontrast.test.ts` unter `frontend/src/theme/`. Helligkeit und Dichte sind am Gerät wählbar
(`theme/helligkeit.ts`, `theme/dichte.ts`; Specs
[`bedien-helligkeit`](../../openspec/specs/bedien-helligkeit/spec.md) und
[`bedien-dichte`](../../openspec/specs/bedien-dichte/spec.md)).

## 8.24 Wortlaut und Sprache der Oberfläche

Die Oberfläche ist nur deutsch: `lang="de"` in `frontend/index.html`, antd mit `de_DE`
(`frontend/src/theme/ThemeModeProvider.tsx`), dayjs mit `de` (`frontend/src/anzeige/dayjsSprache.ts`);
eine Übersetzungsschicht gibt es nicht. Texte zeigen statt zu erklären, und Begriffe gelten
modulübergreifend gleich ([`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitte „Texte:
zeigen statt erklären“ und „Begriffe“; Specs
[`bedien-begriffe`](../../openspec/specs/bedien-begriffe/spec.md),
[`bedien-wortlaut`](../../openspec/specs/bedien-wortlaut/spec.md),
[`modul-benennung`](../../openspec/specs/modul-benennung/spec.md)).

## 8.25 Druck

Gedruckt wird über den Browser, nie auf dem Server; eine Seite hat eine Druckwurzel.
Regeln: [`frontend/src/druck/AGENTS.md`](../../frontend/src/druck/AGENTS.md); Spec
[`druck-dokumente`](../../openspec/specs/druck-dokumente/spec.md). Die Firefox- und WebKit-Läufe
der e2e-Suite fahren nur die Druck-Specs (Kopf von `scripts/check-all.sh`).

## 8.26 Bezeichner-Sprache

Fachbegriffe heißen im Code deutsch, Technik englisch; Wire-Felder, Tabellen und Routen bleiben,
wie sie sind. Regel: [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt „Bezeichner-Sprache“; Spec
[`bezeichner-sprache`](../../openspec/specs/bezeichner-sprache/spec.md). Dateinamen, die sich nur
in der Groß-/Kleinschreibung unterscheiden, verbietet Schritt 14 des Sammel-Gates (Spec
[`dateinamen-schreibweise`](../../openspec/specs/dateinamen-schreibweise/spec.md)).

## 8.27 Tests und Qualitäts-Gates

`scripts/check-all.sh` ist die eine Durchsetzungsinstanz vor dem Merge; die CI ruft es
unverändert. Es fährt 16 Schritte in vier Bündeln (`schnell`, `rust`, `frontend`, `e2e`) mit
fester Zeitzone `Europe/Berlin`. Regeln: [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt
„Qualitäts-Gates“, und [`scripts/AGENTS.md`](../../scripts/AGENTS.md); e2e:
[`frontend/e2e/AGENTS.md`](../../frontend/e2e/AGENTS.md). Viele Regeln dieses Kapitels sichert ein
Wächter-Test, der den Code nach einem Muster durchsucht (Dateien `*.guard.test.ts` im Frontend,
`tests/*_guard.rs` im Backend). Die Architekturdoku und die Prüfblöcke der ADRs prüft
`scripts/check-architektur.sh` (Schritt 16, Bündel `schnell`).

## 8.28 Demo-Daten und Dev-Seeds

Eine Instanz kann mit `--demo-daten` eine Übungslage zur Laufzeit einspielen und wieder entfernen
(`src/demo/`, Spec [`demo-daten`](../../openspec/specs/demo-daten/spec.md), Regeln in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Demo-Daten zur Laufzeit“). Getrennt davon
existieren Dev-Seed und Dev-Anmeldung nur mit dem Cargo-Feature `dev-seeds` (`src/dev/`); dass
sie bauen, prüft Schritt 15 des Sammel-Gates (Spec
[`dev-seed-gate`](../../openspec/specs/dev-seed-gate/spec.md)), dass sie ohne Feature fehlen,
`tests/dev_absent.rs`.

## 8.29 Anwenderhilfe in der App

Die Anwenderdokumentation liegt als Kapitel unter [`docs/anwender/`](../anwender/) und erscheint
in der App unter „Hilfe“ (`frontend/src/hilfe/`, Wächter `hilfe/anwenderdoku.guard.test.ts`).
Erklärender Text gehört dorthin statt in die Oberfläche. Regeln:
[`docs/anwender/AGENTS.md`](../anwender/AGENTS.md).

## 8.30 Fehlergrenze und Client-Fehlerbericht

Wirft eine Seite im Browser beim Zeichnen, soll nur die Seite weichen, nicht ihr Rahmen, und der
Betreiber soll es im Log sehen, ohne dass Daten des Einsatzes dorthin gelangen (Spec
`seiten-zustaende`, Herleitung in der Change `a12ms7g9-seitenzustaende`, D1 bis D3). Die Grenze ist
`frontend/src/components/Fehlergrenze.tsx`, eingehängt als `errorElement` einer pfadlosen Route
unter jedem Rahmen und an der obersten Route (`frontend/src/App.tsx`, Regel und Wächter in
`frontend/AGENTS.md`, Rahmen); der Router zeichnet sie im `<Outlet/>` des Rahmens und räumt sie beim
nächsten Ortswechsel ab. Der Bericht geht über `meldeClientFehler` in
`frontend/src/api/clientFehler.ts`: einmal je Fehlerobjekt, mit Routenmuster statt Pfad
(`gemerktesRoutenMuster` in `frontend/src/rueckmeldung/adresse.ts`), App-Version, Meldung und Stack
gekürzt, gesendet per `apiSendKeepalive` aus `frontend/src/api/client.ts` ohne Wiederholen und ohne
Warteschlange; ein Fehler beim Senden wird verschluckt. Der Server (`src/routes/client_fehler.rs`,
`POST /api/client-errors`) nimmt nur mit Sitzung an, auch von einer Gerätesitzung
(`geraet::ALLE_GERAETE`), begrenzt Body (`CLIENT_FEHLER_BODY_MAX` in `src/app.rs`) und Felder
(`*_MAX`, Abschnitt 8.4), speichert nichts und schreibt höchstens eine Warnzeile je Minute über
`log_drossel::Sammelzeile` (Abschnitt 8.16), ohne Benutzer und Organisation.

## 8.31 Hüllen-Vertrag

Desktop-Hülle (`src-tauri`), iOS-Hülle (`ios`) und Android-Hülle (`android`) laden die
Weboberfläche des Servers und tragen keine Anwendungslogik
([ADR-0068](entscheidungen/ADR-0068-die-ios-huelle-ist-eine-eigene-swift-app-ohne-anwendungslogik-die-die-serveroberflaeche-laedt.md),
[ADR-0084](entscheidungen/ADR-0084-die-android-huelle-ist-eine-eigene-kotlin-app-ohne-anwendungslogik-und-kommt-als-apk-die-sich-selbst-aktualisiert.md)).
Was Server und Hülle einander zusagen, steht in der Spec `huellen-vertrag`; drei Teile:

- **Server → Hülle:** `GET /api/shell` liefert anonym und ohne Datenbank `version` und
  `shell_contract` (`load_shell`, `ShellInfo` und `SHELL_CONTRACT` in `src/routes/shell.rs`,
  Typ-Codegen wie 8.5). Die Zahl steigt nur bei einem Bruch zwischen Hülle und Server, neue Felder
  kommen nur hinzu. Die iOS-Hülle lädt einen Server nur, wenn sie seinen Vertrag kennt
  (`bekannteVertraege` in `ios/LifelineKern/Sources/LifelineKern/LifelineKern.swift`,
  `Vertragspruefung` in `Vertrag.swift` daneben), bei Start, Wechsel und Rückkehr in den
  Vordergrund; ein Server ohne Endpunkt gilt als zu alt. Die Android-Hülle prüft genauso
  (`bekannteVertraege` in `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/LifelineKern.kt`,
  `Vertragspruefung` in `Vertrag.kt`). Die Desktop-Hülle prüft genauso vor jedem
  Laden, das sie selbst anstößt (`BEKANNTE_VERTRAEGE` und `evaluate` in `src-tauri/src/vertrag.rs`,
  LLH-1982, [ADR-0083](entscheidungen/ADR-0083-die-desktop-huelle-prueft-den-huellen-vertrag-und-holt-sonst-nichts-vom-server.md)).
- **Hülle → Seite, die Kennung:** `window.__LIFELINE_HUELLE__` meldet die Fähigkeiten der Hülle
  (`passkey`, `anmeldungImBrowser`, `benachrichtigungZeigen`, `setAppBadge`, `platform` und
  `version`, bei iOS und Android dazu `haptics`, bei iOS außerdem `push`; Android ohne `setAppBadge`). Gelesen wird sie nur in `frontend/src/huelle/faehigkeiten.ts`;
  das Frontend unterscheidet die Hüllen nur darüber. Gesetzt wird sie von den Init-Skripten der
  Desktop-Hülle (`src-tauri/src/*.js`), von `ios/App/Huelle/huelle.js` und von
  `android/app/src/main/assets/huelle.js`; Vitest führt sie aus (`frontend/src/test/huelle.ts`).
- **Seite → Hülle, die Brücke:** in der iOS-Hülle der Message-Handler `lifeline`, Wire-Format im
  Kopf von `ios/App/Huelle/huelle.js`. Er nimmt Aufrufe nur aus dem Hauptframe und von der Origin
  des aktiven Servers an (`Bruecke.accepts` in `ios/LifelineKern/Sources/LifelineKern/Bruecke.swift`);
  jeder Server hat einen eigenen Datenspeicher. In der Android-Hülle ist es das Objekt `lifeline`
  aus `addWebMessageListener` mit derselben Annahmeregel (`Bruecke.accepts` in
  `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Bruecke.kt`, Wire-Format im Kopf von
  `android/app/src/main/assets/huelle.js`); jeder Server hat dort ein eigenes WebView-Profil. Die
  Anmeldung im Systembrowser (`POST /api/auth/app-code[/redeem]`) nutzen alle Hüllen gleich.

Adressprüfung, Deeplink, Linkregeln und Vertragsprüfung stehen in Rust (`src-tauri/src/adresse.rs`,
`deeplink.rs`, `links.rs`, `vertrag.rs`), im Swift-Kern und im Kotlin-Kern; zusammengehalten werden
sie von den gemeinsamen Fällen unter `src-tauri/faelle/`, die alle drei Suiten prüfen. Regeln:
[`ios/AGENTS.md`](../../ios/AGENTS.md), [`android/AGENTS.md`](../../android/AGENTS.md),
[`src-tauri/AGENTS.md`](../../src-tauri/AGENTS.md), „Gemeinsame Fälle“; Betrieb:
[`ios-app.md`](../betrieb/ios-app.md), [`android-app.md`](../betrieb/android-app.md),
[`desktop-app.md`](../betrieb/desktop-app.md).

## 8.32 Geheimnisse und Abrufe der Adapter

Was Lifeline Hub selbst bei einem Fremdsystem abruft (Divera, HiOrg, Postfach …), ist ein Adapter
einer Art im Rahmen `src/adapter/` ([ADR-0077](entscheidungen/ADR-0077-geheimnisse-der-adapter-liegen-nur-verschluesselt-und-adapter-rufen-nur-ueber-den-rahmen-ab.md),
Design-Doc [`2026-11-21-r19tuh60-adapter-rahmen-design.md`](../superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md)).

- **Geheimnisse:** nur als age-Chiffrat an den Schlüssel aus `LIFELINE_GEHEIMNIS_SCHLUESSEL` (oder
  `…_DATEI`), mit dessen Fingerabdruck je Zeile; die API setzt und ersetzt, liest aber nie. Für
  einen Schlüsselwechsel liest der Speicher zusätzlich mit dem alten (`…_ALT`), und der Start
  schlüsselt alle Chiffrate auf den neuen um (LLH-2025). Ohne Schlüssel läuft der
  Server, und Adapter mit Geheimnissen halten mit `geheimnisspeicher_gesperrt` an. Das übrige
  Schlüsselmaterial der Instanz liegt weiter im Klartext der Datenbank (R19, R22).
- **Abruf:** ein Hintergrundlauf neben dem der Webhooks, zwei Phasen je Abruf (Netz ohne
  Datenbank, dann Übernahme in einer Transaktion), Zielschutz und Client wie bei den Webhooks.
- **Zustand:** in der Zeile des Adapters (letzter Erfolg, letzter Fehler als Code, nächster
  Abruf, Grund des Anhaltens) und in den letzten 50 Versuchen; ein vorübergehender Fehler wartet
  höchstens 15 min, ein Fehler, den ein Mensch beheben muss, hält an. Kein stiller Fehler (G7 des
  Konzepts [`2026-11-10-schnittstellen-ausbau.md`](../konzepte/2026-11-10-schnittstellen-ausbau.md)).
- **Gekoppelter ELW:** Eingehendes kommt am Hub an; meldet sich eine Org bei einem Hub, läuft hier
  kein Adapter, und die Verwaltung ist gesperrt.
- **Ablage einer Art:** eine Art, die nicht flüchtig ist, schreibt in eine eigene Tabelle, idempotent
  in der Übernahme. Vorbild `src/veranstaltung_extern/` (LLH-2097): je Adapter eine Zeile je
  Veranstaltung, Fingerabdruck statt Versionen, ein unveränderter Abruf schreibt nichts; der
  Vertrag ist neutral ([`docs/schnittstellen/veranstaltungen-abruf.md`](../schnittstellen/veranstaltungen-abruf.md)).

Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Adapter“.

## 8.33 Ortung von Fahrzeugen

Positionen von Einsatzfahrzeugen sind personenbezogen. Die Ortung aus dem Einwurf (`src/ortung/`,
LLH-2091,
[ADR-0103](entscheidungen/ADR-0103-ortung-uebernimmt-positionen-nur-fuer-gekoppelte-fahrzeuge-laufender-einsaetze.md),
Design-Doc [`2026-11-24-fjftaovq-fahrzeugortung-design.md`](../superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md))
begrenzt sie auf das, was der Einsatz braucht, und teilt Schalter und Schreibstelle mit der
Helfer-App (ADR-0101, Spec
[`2026-11-24-vakwvkpg-helfer-app-design.md`](../superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md),
„Ortung der Organisation und Positionsbaustein“):

- **Nur mit Freigabe der Organisation:** der Org-Schalter „Ortung im Einsatz“
  (`org_einstellungen.ortung_im_einsatz`, Verwaltung → Einsatz-Vorgaben) ist vorgabemäßig aus; wer
  ihn einschaltet, bestätigt Einwilligung bzw. Betriebs- oder Dienstvereinbarung, der Server hält
  Person und Zeitpunkt fest. Ohne ihn antwortet Koppeln 422 und die Übernahme schreibt nichts.
  Risiko: R56.
- **Nur gekoppelt und nur im Einsatz:** ohne bewusste Kopplung einer Kennung an ein Fahrzeug ändert
  ein Einwurf keinen Einsatz; die Kopplung endet mit Trennen, Entlassen, Stornieren, Ablehnen der
  Einheit und Abschluss (Ablauf 6.6e1).
- **Eine Schreibstelle:** die Übernahme schreibt über `ortung::schreibe_position` mit Quelle
  `einwurf`; Vorrang hat der jüngere Zeitpunkt, die Handwege schreiben `manuell` mit Serverzeit.
- **Kein Verlauf:** je Kennung eine Position in der Ablage (24 h), je Fahrzeug eine am Einsatzfahrzeug;
  Schema-Test `keine_tabelle_haelt_einen_positionsverlauf` in `tests/ortung.rs`. Der Abschluss
  löscht die Einwurf-Positionen des Einsatzes, manuell und von der Helfer-App gesetzte bleiben
  (`src/ortung/kopplung.rs`, `beende_im_einsatz_tx`).
- **Kein Koordinatenweg über die Kopplung:** die Kandidatenliste und die Abfrage der
  Kopplung tragen keine Koordinaten und kein Protokoll Kennung, Schlüssel oder Koordinaten (Prüfung
  in ADR-0103); `EinsatzFahrzeugAnzeige` nennt nur `ortung_gekoppelt`, `position_quelle` und
  `position_aktualisiert_at`.
- **Anzeige:** Quelle und Alter zeigt die Lagekarte wie für die Helfer-App („Ortung · vor 3 min“,
  ab 5 min blass und „veraltet“, `positionsAlter.ts`); ein Lagestand misst gegen seinen Stand.
- **Über den Hub (LLH-2119, [ADR-0109](entscheidungen/ADR-0109-hub-liefert-positionen-nur-fuer-kennungen-die-das-fuehrende-elw-gekoppelt-hat.md)):** Koordinaten verlassen den Hub nur im Spiegelabgleich, nur für
  Kennungen, die das führende ELW gekoppelt hat und in der Anfrage nennt, nur für eine abgebildete
  Org, einen gültigen Zugang mit `positionen:write` und bei eingeschaltetem Schalter
  (`src/ortung/fern.rs`). Die Kandidatenliste trägt keine Koordinaten, der Hub hält keinen Zustand
  dazu, und kein Protokoll trägt Kennung, Schlüssel oder Koordinaten. Gibt ein Einsatz die
  Führung ab, enden seine Kopplungen still (`beende_bei_fuehrungsabgabe_tx`, Ablauf 6.6e2). Design-Doc
  [`2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`](../superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md).
- **Anwender:** DSFA-Vorlage und Einrichtung im Kapitel [Anbindungen](../anwender/kapitel/anbindungen.md).

## 8.34 Nachrichten an Menschen: Ausgangskorb

Was ein Mensch an eine Externe Stelle sendet (E-Mail, LLH-2093; Fax, LLH-2095; Matrix-Raum,
LLH-2094), geht nur über die Tabelle `ausgang` und den Lauf `src/ausgang/` ([ADR-0104](entscheidungen/ADR-0104-nachrichten-an-menschen-gehen-nur-ueber-den-ausgangskorb.md),
[ADR-0107](entscheidungen/ADR-0107-matrix-ist-ein-kanal-des-ausgangskorbs-verschluesselt-mit-einem-speicher-je-anbindung.md), Design-Docs
[`2026-11-24-w1ymakq6-ausgang-email-design.md`](../superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md) und
[`2026-11-25-ntaizave-ausgang-matrix-design.md`](../superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md)).

- **Getrennt von Webhooks und Abruf:** ein Webhook meldet einem Fremdsystem, ein Adapter ruft ab;
  der Ausgangskorb stellt eine bewusst abgesandte Nachricht zu. Die Anbindung ist die Adapter-Art
  `smtp` (Einstellungen und Passwort im Rahmen von 8.32); entschlüsselt wird das Passwort nur in
  `adapter::lauf::zugang_fuer_versand`.
- **Schnappschuss und Beleg:** Betreff, Text, Stelle und Adresse stehen beim Absenden in der
  Zeile; jedes Ergebnis steht im ETB, Ergebnis und Eintrag in einer Transaktion. Der Mailserver
  bestätigt mit 250 oder gar nicht: ein Abbruch nach DATA ist `ungewiss` und wird nie selbst
  wiederholt.
- **Kanalneutral:** je Kanal ein Zusteller hinter einem Trait, Wiederholung und ETB nur im Lauf.
  Matrix geht Ende-zu-Ende-verschlüsselt (matrix-sdk), nie als Klartext in einen verschlüsselten
  Raum; feste Transaktions-IDs und gemerkte Teile (`ausgang_teil`) machen eine Wiederholung
  unschädlich, darum ist ein Matrix-Abbruch nicht `ungewiss`. Der Schlüsselspeicher je Anbindung
  liegt unter `matrix/` neben der Datenbank und nie in einer Sicherung (Kapitel 7).
- **Ein Kanal, eine Art:** Fax ist die Adapter-Art `sipgate_fax` mit Token als Geheimnis; das Fax
  ist ein PDF, das nur hier am Server entsteht
  ([ADR-0110](entscheidungen/ADR-0110-ein-pdf-entsteht-am-server-nur-fuer-den-ausgang.md)) und
  auch der Mail anhängt. Ein Fax gilt erst als `zugestellt`, wenn sipgate es auf Nachfrage
  bestätigt; das ETB folgt dem Endstand.
- **Spiegel und Schwärzung:** `ausgang` ist vom Spiegel ausgenommen (`src/instanz/spiegel/art.rs`),
  am Spiegel wird nicht angelegt und nicht zugestellt; die Tabelle steht in der Schwärzung.

Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Ausgang an Menschen“.
