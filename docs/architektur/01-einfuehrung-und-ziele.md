# 1. Einführung und Ziele

Stand: 23.10.2026 (alpha dcc500f5).

Lifeline Hub ist eine Anwendung zur Führungsunterstützung in Einsatzlagen des
Bevölkerungsschutzes. Sie bündelt Einsatztagebuch, Lagekarte, Kräfteübersicht, Betroffenen- und
Schadenserfassung, Meldungen und Aufträge und arbeitet weiter, wenn das Netz ausfällt
([`README.md`](../../README.md), Abschnitt „Warum überhaupt“). Das Projekt ist in früher Alpha:
Schnittstellen, Datenmodell und Bedienung ändern sich, Migrationspfade zwischen Ständen sind
nicht zugesichert (ebenda). Die Version steht einmal in `[workspace.package]` von
[`Cargo.toml`](../../Cargo.toml) (zum Stand `1.0.0-alpha.150`).

## 1.1 Aufgabenstellung

Die fachlichen Bereiche folgen der Gliederung der Anwenderdokumentation
([`docs/anwender/README.md`](../anwender/README.md)); jede Zeile nennt die Module, die sie tragen
(Backend unter `src/`, Frontend unter `frontend/src/`, Einzelheiten in
[Kapitel 5](05-bausteinsicht.md)).

| Bereich | Was das System leistet | Tragende Module (Auswahl) |
| --- | --- | --- |
| Führungsmittel | Einsatztagebuch (ETB), das sich nicht ändern, nur berichtigen lässt; Meldungseingang mit Kenntnisnahme; Aufträge und Befehle mit Quittung; Erinnerungen; Nachforderungen; Druck und Export | `src/etb`, `src/meldung`, `src/auftrag`, `src/befehl`, `src/erinnerung`, `src/nachforderung`; `frontend/src/etb`, `frontend/src/druck` |
| Lage | Überblick mit Kennzahlen und nächsten Fristen, Lagebild, Lagekarte mit taktischen Zeichen und Fachebenen, Gefahren, Wetter und Pegel, Lagemeldungen und Lageberichte | `src/karte`, `src/gefahr`, `src/wetter`, `src/pegel`, `src/lagebericht`; `frontend/src/pages/lagekarte`, `frontend/src/pages/lage-dashboard` |
| Kräfte | Meldebild und Kräfte-Zeitachse mit Stärke F/UF/M//Ges, Einheiten, Personal, Fahrzeuge, Material, Bereitstellungsräume, Ablösung, Verpflegung | `src/einheit`, `src/personal`, `src/fahrzeug`, `src/material`, `src/bereitstellungsraum`, `src/abloesung`, `src/verpflegung`; `frontend/src/kraefte` |
| Stab | Einsatzdaten und Führungsstelle, Einsatzabschnitte, Stab in den Sachgebieten S1 bis S6 mit Checkliste, Fernmeldewesen (Funkplan, Fernmeldeskizze, Kommunikationsplan), Presse und Infotelefon, Dokumente, Lagebesprechung | `src/stab`, `src/kommunikation`, `src/presse`, `src/infotelefon`, `src/dokument`, `src/lagebesprechung`; `frontend/src/stab`, `frontend/src/fernmeldewesen` |
| Betroffene | Betroffene mit Sichtungskategorie, Unfallhilfsstellen, Evakuierung, Betreuung, Tiere, Schäden | `src/person`, `src/uhs`, `src/betreuung`, `src/tier`, `src/schaden`; `frontend/src/personen`, `frontend/src/betreuung` |
| Verwaltung | Einsatzeinstellungen und Modulfreigaben, Einsatzabschluss mit Bericht, Stammdaten, Benutzer, Karten, Aufbewahrung, Demo-Daten, Zugangsprotokoll | `src/org`, `src/auth`, `src/aufbewahrung`, `src/demo`; `frontend/src/admin`, `frontend/src/aufbewahrung` |
| Gekoppelte Geräte | Tablets, Laptops und Lagemonitore arbeiten ohne Personenkonto für genau eine Stelle eines Einsatzes | `src/geraet`; `frontend/src/geraet` |

Der Überblick eines Einsatzes rechnet nur aus Daten, die in den Modulen schon erfasst sind
([`docs/anwender/kapitel/ueberblick.md`](../anwender/kapitel/ueberblick.md)). Fehlt ein Wert
oder ist ein Modul nicht freigegeben, steht „—“, nie 0 ([`README.md`](../../README.md);
Abschnitt „Rechte und gesperrte Module“ im Überblick-Kapitel).

## 1.2 Qualitätsziele

Die fünf wichtigsten Qualitätsziele, nach Gewicht geordnet. Dieselben fünf Merkmale tragen den
Qualitätsbaum und die Szenarien in [Kapitel 10](10-qualitaetsanforderungen.md); die Ansätze dazu
stehen in [Kapitel 4](04-loesungsstrategie.md).

| Nr. | Qualitätsziel | Bedeutung für Lifeline Hub | Beleg |
| --- | --- | --- | --- |
| Q1 | **Einsatztauglichkeit** | Bedienbar unter Druck: Trefflächen, Dichte, Kontrast und Farbrollen folgen einer ausformulierten Bedien-Leitlinie mit den Kontexten Fükw, Führungs-Tablet, ortsfeste Stelle und mobil, Dichtestufen bis `handschuh` und Farbe als Signal. Die Oberfläche folgt der Führungslogik (Stärke F/UF/M//Ges, Sichtungskategorien, Sachgebiete S1 bis S6). | [`README.md`](../../README.md); Bedien-Leitlinie in [`frontend/AGENTS.md`](../../frontend/AGENTS.md); Specs [`einsatztauglichkeit-layout`](../../openspec/specs/einsatztauglichkeit-layout/spec.md), [`bedien-dichte`](../../openspec/specs/bedien-dichte/spec.md), [`farbrollen-kontrast`](../../openspec/specs/farbrollen-kontrast/spec.md) |
| Q2 | **Verfügbarkeit ohne Netz und Aktualität** | Der Server läuft vor Ort als eine ausführbare Datei mit eingebetteter Oberfläche, SQLite und OpenSSL und braucht im lokalen Netz kein Internet; Kartenkacheln, Schriften und Zeichen bringt er mit. Reißt die Verbindung eines Geräts ab, bleibt die Lage mit dem letzten Stand lesbar, neue Einträge gehen später von selbst hinaus. Mit Verbindung halten Live-Ereignisse das Lagebild aktuell. Ein Ausfall einer Fremdquelle oder des Identitätsanbieters legt die Arbeit nicht lahm. | [`README.md`](../../README.md), Abschnitte „Warum überhaupt“ und „Starten“; [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md); Specs [`lagebild-offline-lesen`](../../openspec/specs/lagebild-offline-lesen/spec.md), [`live-abgleich`](../../openspec/specs/live-abgleich/spec.md); [`docs/fachebenen-quellen.md`](../fachebenen-quellen.md); Kopf von `src/auth/oidc/mod.rs` |
| Q3 | **Datenschutz und Sicherheit** | Rechte hängen an der Rolle im einzelnen Einsatz. Nach der Aufbewahrungsfrist schwärzt der Server Personendaten, das ETB bleibt als pseudonymes Skelett. Zugriffe auf Personendaten und Anmeldungen sind protokolliert. Gekoppelte Geräte arbeiten ohne persönliches Konto, der Lagemonitor zeigt keine personenbezogenen Daten. Ist ein ClamAV-Scanner angebunden (`--clamav-addr`), prüft er jeden Upload; ist er nicht erreichbar, weist der Server ab (abschaltbar mit `--clamav-fail-open`). | Specs [`aufbewahrung`](../../openspec/specs/aufbewahrung/spec.md), [`einsatz-zugriff`](../../openspec/specs/einsatz-zugriff/spec.md), [`personen-zugriffsprotokoll`](../../openspec/specs/personen-zugriffsprotokoll/spec.md), [`zugangsprotokoll`](../../openspec/specs/zugangsprotokoll/spec.md), [`geraete-kopplung`](../../openspec/specs/geraete-kopplung/spec.md), [`lagemonitor`](../../openspec/specs/lagemonitor/spec.md); [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitte „Backend — Aufbewahrung“ und „Backend — ClamAV-Upload-Scan“ |
| Q4 | **Datenintegrität bei Nebenläufigkeit** | Viele Geräte schreiben gleichzeitig in denselben Einsatz, auch nachträglich aus der Offline-Warteschlange. Schreibtransaktionen nehmen die Schreibsperre am Beginn und wiederholen bei Belegung; konkurrierende Änderungen enden in 409 statt im stillen Überschreiben; ein wiederholt gesendeter ETB-Eintrag entsteht über einen Unique-Index auf `(einsatz_id, client_id)` nur einmal. Ein ETB-Eintrag wird nie geändert, sondern durch eine Berichtigung korrigiert. | Kopf von `src/tx.rs`; `anlegen_idempotent` in `src/etb/repo.rs`, `migrations/0088_etb_client_id.sql`; [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Backend — Statuscode-Konvention“; [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md); Spec [`etb-berichtigung`](../../openspec/specs/etb-berichtigung/spec.md) |
| Q5 | **Wartbarkeit** | Das System wird auch von Coding-Agenten weiterentwickelt, für die die `AGENTS.md`-Dateien verbindlich sind. Ein Sammel-Gate prüft vor jedem Merge, der Vertrag zwischen Server und Client wird aus dem Backend erzeugt, Fähigkeiten stehen als Specs, Entscheidungen als ADRs mit maschineller Prüfung. | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitte „Qualitäts-Gates“ und „Planung und Ausführung“; `src/AGENTS.md`, Abschnitt „Backend↔Frontend — Typ-Codegen“; [`AGENTS.md`](AGENTS.md) dieses Verzeichnisses |

## 1.3 Stakeholder

| Rolle | Erwartung an das System | Wo im Code oder in der Doku |
| --- | --- | --- |
| Einsatzleitung | Führt einen Einsatz, verwaltet seinen Zugriff, koppelt Geräte, schreibt in allen freigegebenen Modulen | `EinsatzRolle::Einsatzleitung` in `src/einsatz/mod.rs`; [`rechte-im-einsatz.md`](../anwender/kapitel/rechte-im-einsatz.md) |
| Führungspersonal und Stab | Schreibt in den Modulen, arbeitet in den Sachgebieten S1 bis S6 | `EinsatzRolle::Fuehrungspersonal`; [`frontend/src/stab/AGENTS.md`](../../frontend/src/stab/AGENTS.md) |
| Beobachter | Liest einen Einsatz mit, ohne zu schreiben | `EinsatzRolle::Beobachter` |
| Führungskräfte der Organisation | Lesen Einsätze der Organisation ohne eigene Einsatzrolle mit | `OrgRolle::Fuehrungskraft` in `src/auth/mod.rs` |
| Einsatzkräfte an gekoppelten Geräten | Bedienen an UHS, Betreuungsstelle, Bereitstellungsraum oder Abschnitt eine schmale, touchtaugliche Oberfläche ohne eigenes Konto; der Lagemonitor zeigt das Lagebild ohne Bedienung | Specs [`feldgeraet-bedienung`](../../openspec/specs/feldgeraet-bedienung/spec.md), [`lagemonitor`](../../openspec/specs/lagemonitor/spec.md); [`frontend/src/geraet/AGENTS.md`](../../frontend/src/geraet/AGENTS.md) |
| Administration | Verwaltet Benutzer, Organisation, Stammdaten, Karten, Aufbewahrung und Zugangsprotokoll | `SystemRolle::Admin` in `src/auth/mod.rs`; [`verwaltung.md`](../anwender/kapitel/verwaltung.md) |
| Betroffene Personen | Ihre Daten werden nur so lange und so weit verarbeitet, wie die Aufbewahrungsregeln es erlauben; Datenschutz-Auskünfte sind ohne Datenbankzugriff möglich | Specs [`aufbewahrung`](../../openspec/specs/aufbewahrung/spec.md), [`aufbewahrung-loeschersuchen`](../../openspec/specs/aufbewahrung-loeschersuchen/spec.md), [`personen-zugriffsprotokoll`](../../openspec/specs/personen-zugriffsprotokoll/spec.md) |
| Betreiber einer Instanz | Startet Container oder Binary, setzt TLS, Anmeldeverfahren, Offline-Karten und Sicherung auf | [`docs/betrieb/packaging.md`](../betrieb/packaging.md), [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md) |
| Anbieter externer Daten | Erwarten die Einhaltung ihrer Lizenzauflagen, etwa Pflicht-Attribution | [`docs/fachebenen-quellen.md`](../fachebenen-quellen.md) |
| Entwicklung (Maintainer und Coding-Agenten) | Ändern das System nach den Regeln in den `AGENTS.md`, planen über OpenSpec, prüfen mit einem Gate; Aufgaben in Zunder | [`AGENTS.md`](../../AGENTS.md); [`scripts/AGENTS.md`](../../scripts/AGENTS.md); [Kapitel 2](02-randbedingungen.md) |
