# 8. Querschnittliche Konzepte

Stand: 23.10.2026 (alpha dcc500f5).

Dieses Kapitel nennt jedes Konzept, das mehrere Bausteine trägt, sagt, wo es im Code sitzt, und
zeigt auf die Stelle, an der seine Regeln stehen. Es wiederholt diese Regeln nicht: maßgeblich
sind die `AGENTS.md`-Dateien (Tabelle in der [Wurzel-`AGENTS.md`](../../AGENTS.md)), die
Fähigkeits-Specs unter `openspec/specs/` und die Archiv-Designs. Bausteinnamen wie in der
[Bausteinsicht](05-bausteinsicht.md).

## 8.1 Organisation als Mandant

Jeder Datensatz mit Fachbezug hängt über `org_id` an einer Organisation; die Organisation ist
die Mandantengrenze (`Benutzer.org_id` in `src/auth/mod.rs`). Der Org-Floor läuft in jedem
einsatzgebundenen Handler im Extractor `EinsatzKontext` (`src/einsatz/kontext.rs`, Prüfung
`berechtigung::fordere_org_zugehoerigkeit`). Dass jede Route unter `/api/einsaetze/{id}/…` ihn
zieht, erzwingt `tests/einsatz_kontext_guard.rs`; die Grenze gegen eine echte zweite Organisation
prüft `tests/cross_org.rs`. Wie ein System-Admin über die Org-Grenze liest und schreibt, regelt
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Admin-Schreibwege am Einsatz“.

## 8.2 Autorisierung: Einsatzrollen und Modulrechte

Im Einsatz gibt es drei Rollen (`EinsatzRolle` in `src/einsatz/mod.rs`: `einsatzleitung`,
`fuehrungspersonal`, `beobachter`); ein gekoppeltes Gerät bekommt seine Rolle aus der
Funktionsansicht, nicht aus einer Mitgliedschaft (`src/einsatz/kontext.rs`). Die Lese-, Schreib-
und Modul-Gates stehen in `src/einsatz/berechtigung.rs`, die gültigen Modul-Keys in
`src/einsatz/modul.rs` (Spiegel der Frontend-`modulRegistry.ts`, Drift-Test in
`tests/modul_override.rs`). Die effektive Modulfreigabe rechnet allein der Server; der Client
zeigt nur an (Spec [`modul-freigabe`](../../openspec/specs/modul-freigabe/spec.md)). Wer Zugriff
verwaltet, regelt Spec [`einsatz-zugriff`](../../openspec/specs/einsatz-zugriff/spec.md).

## 8.3 Fehlervertrag und Statuscodes

Jeder Fehler geht als `AppError` (`src/error.rs`) hinaus und wird einheitlich als JSON
`{ "error": "<Meldung>" }` beantwortet; `JsonBody` in `src/extract.rs` hält diesen Vertrag auch
für Extractor-Ablehnungen. Welcher Fall 400, 409, 413 oder 422 ist, steht verbindlich in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Statuscode-Konvention“. Nachweis des
Vertrags: `tests/fehler_vertrag.rs`.

## 8.4 Eingabegrenzen

Freitexte, Listen und Geometrien von außen haben je eine Höchstgrenze, und jeder Body ist vor dem
Handler begrenzt (`JSON_BODY_MAX` in `src/app.rs`). Die Regeln stehen in
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Eingabegrenzen“, und in Spec
[`eingabegrenzen`](../../openspec/specs/eingabegrenzen/spec.md). Das Frontend spiegelt die
Grenzen in `frontend/src/api/eingabegrenzen.ts`; `tests/eingabegrenzen_spiegel.rs` vergleicht
beide Seiten Name für Name.

## 8.5 API-Kontrakt und Typ-Codegen

Response-Typen entstehen aus dem Rust-Code: `#[derive(ToSchema)]` → `src/api_doc.rs` →
`frontend/src/api/openapi.json` → `openapi-typescript` → `frontend/src/api/types.generated.ts`
(Skript `gen:types` in `frontend/package.json`). Ablauf, Wire-Enums und handgepflegte Reste
regelt [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Typ-Codegen“. Drift fängt
`scripts/check-typ-codegen.sh` (Schritt 3 des Sammel-Gates) mit `tests/openapi_spec_aktuell.rs`;
die Wire-Werte der Enums hält `tests/enum_wire_kontrakt.rs` fest.

## 8.6 Live-Aktualisierung

Änderungen erreichen andere Tabs über Server-Sent Events: ein Strom je Einsatz und ein Org-Strom
(`src/live/mod.rs`, `src/live/org.rs`, Stromgrenzen in `src/live/strom.rs`). Die Ereignisnamen
sind ein Wire-Kontrakt (`LiveEvent` und `OrgLiveEvent`), gegengeprüft vom Frontend in
`frontend/src/api/liveEvent.contract.test.ts` und `frontend/src/api/orgLiveEvent.contract.test.ts`. Ein kurz getrennter Client bekommt Verpasstes aus
einem Ring je Einsatz über `Last-Event-ID` nachgeliefert (`REPLAY_KAPAZITAET`, `REPLAY_KARENZ` in
`src/live/mod.rs`, Nachweis `tests/live_feed.rs`). Wie der Client abgleicht, legt Spec
[`live-abgleich`](../../openspec/specs/live-abgleich/spec.md) fest; Org-Ereignisse regelt
[`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Org-Ereignisse“.

## 8.7 Persistenz

Der Server hält alles in einer SQLite-Datei über sqlx (`src/db.rs`: WAL, Fremdschlüssel,
`secure_delete = ON`, `busy_timeout` 5 s). Nachschlage-Caches (Geocoding, Fachebenen) liegen in
einer eigenen Datei, damit sie nicht um den Schreiber konkurrieren (`src/cache_db.rs`). Das
Schema wächst nur über Migrationen in `migrations/`, eingespielt beim Start
(`sqlx::migrate!` in `src/db.rs`). Wie sie nummeriert werden und dass sie unveränderlich sind,
regelt die [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt „Migrationsvergabe“.

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
das Archiv `/api/aufbewahrung` (`src/aufbewahrung/`). Personendaten werden geschwärzt (`src/einsatz/schwaerzung_*.rs`) und physisch überschrieben (`secure_delete`
in `src/db.rs`, `src/db/physisch.rs`). Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt
„Aufbewahrung“; Specs [`aufbewahrung`](../../openspec/specs/aufbewahrung/spec.md),
[`aufbewahrung-archiv`](../../openspec/specs/aufbewahrung-archiv/spec.md),
[`aufbewahrung-kategorien`](../../openspec/specs/aufbewahrung-kategorien/spec.md) und
[`aufbewahrung-loeschersuchen`](../../openspec/specs/aufbewahrung-loeschersuchen/spec.md). Was das
Gerät danach räumt: [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md),
Abschnitt „Räumen nach einer Schwärzung“.

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
HTTP/1-Köpfe über `HTTP1_MAX_KOPF` weist `src/verbindung.rs` mit 431 ab. Beschreibung für den
Betrieb: [`docs/betrieb/observability.md`](../betrieb/observability.md).

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

## 8.18 Konfiguration über die Umgebung

Jeder Schalter des Servers ist ein Argument der clap-`Config` in `src/config.rs` mit
Umgebungsvariable; kein anderes Modul liest `std::env::var` (`tests/env_config_guard.rs`).
`lifeline-hub --help` zeigt die vollständige Liste; was eine Vertrauensgrenze verschiebt, steht in
[`docs/betrieb/env-registry.md`](../betrieb/env-registry.md).

## 8.19 Benachrichtigungen

Schreibwege und Scheduler melden nach dem Commit über `benachrichtigung::melden`
(`src/benachrichtigung/`); zugestellt wird über die Live-Ströme, mit Schalter `--web-push` auch per
Web Push an geschlossene Tabs (`src/web_push/`) und in der Desktop-Hülle als native Meldung.
Regeln: [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Benachrichtigungen“; Spec
[`benachrichtigungen`](../../openspec/specs/benachrichtigungen/spec.md); Betrieb
[`docs/betrieb/web-push.md`](../betrieb/web-push.md).

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
