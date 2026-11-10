# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Migrationen bekommen die nächste freie Nummer über `origin/alpha`
(`scripts/check-migrationen.sh`, vorher `git fetch origin alpha`). Integrationstests mit zwei
Instanzen kommen nach `tests/instanz_spiegel.rs` (Muster `tests/instanz_stammdaten.rs`, zwei
Instanzen auf Loopback). Nach jeder Änderung an Response-DTOs oder Enums
`scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.

## 1. Beschreibung und Änderungslog (D1, D2, D3)

- [x] 1.1 Messung vorher: ETB-Einfügen (50 Einträge) und Personenerfassung auf einer Demo-DB, Werte in design.md „Nachträge“ notieren
- [x] 1.2 `instanz::spiegel::art`: `TABELLEN` (gespiegelt mit Kategorie, Schlüssel, Scoping, `blob`; ausgenommen mit Grund), Wire-Enums `SpiegelKategorie` und `Freigabestufe` per `wire_enum!` mit Fällen in `tests/enum_wire_kontrakt.rs`. Wächter `jede_einsatztabelle_ist_eingeordnet` (gegen `schwaerzung_registry::TABELLEN`) rot, dann grün
- [x] 1.3 Verweise aus `PRAGMA foreign_key_list` einordnen (Einsatz, Stammdaten, Org) plus `VERWEISE_OHNE_FK` (polymorphe Bezüge, IDs in JSON). Wächter `jede_id_spalte_ist_eingeordnet` über alle `*_id`-Spalten der gespiegelten Tabellen
- [x] 1.4 Generator für Log-Trigger (`_spiegel_log_i/_u/_d`, Elternzeile bei `UeberParent`) und Migration mit `einsatz_aenderung`, `einsatz.kennung`, `einsatz.freigabestufe` und Grundstock. Wächter `trigger_passen_zur_beschreibung` gegen `sqlite_master`. Tests: Anlegen, Ändern, Schwärzen, weiches und hartes Löschen erhöhen den Stand; je Zeile eine Logzeile; Kind per CASCADE ohne Fehler
- [x] 1.5 Messung nachher wie 1.1; Abweichung über 20 % → mit Ruben klären, sonst Wert in die Nachträge
- [x] 1.6 `src/AGENTS.md`, Abschnitt Instanzkopplung: Regel „neue Einsatztabelle = Eintrag in `spiegel::art` + Trigger in ihrer Migration“, Verweis auf die Wächter; `scripts/adr-fuer.sh` für die berührten Pfade geprüft

## 2. Spiegel, Schutz und Fehlerbild (D4, D10)

- [x] 2.1 Migration `einsatz_spiegel`, `spiegel_herkunft`, `spiegel_uebernahme` (Merker), `spiegel_ziel` und Schutz-Trigger aus dem Generator (`_spiegel_schutz_i/_u/_d`). `AppError`: Nachricht `einsatz_ist_spiegel` → 409 „Dieser Einsatz ist ein Spiegel“, Fall in `tests/fehler_vertrag.rs`. Tests: Schreibroute auf Spiegel → 409, auf eigenen Einsatz → 2xx; unter Merker schreibbar
- [x] 2.2 Schreibende Routen am Spiegel enden mit 409 aus dem Schutz-Trigger (Nachtrag D9/D10: keine Sperrschicht für alle Methoden). Test über eine Auswahl Routen je Modul (PATCH, DELETE, POST); die Lesemarke des ETB bleibt am Spiegel schreibbar
- [x] 2.3 Hintergrundläufe durchgehen (Erinnerungen, Ablösung-Vorwarnung, Pegel, Benachrichtigungen, Aufbewahrung, Schwärzungsjobs, weitere per `grep tokio::spawn`): Spiegel auslassen. Test je Lauf mit einem Spiegel-Einsatz ohne 409 im Log

## 3. Liefern und Übernehmen (D5, D6, D7)

- [x] 3.1 `SpiegelPaket` samt Typen, `SPIEGEL_MAX`, Extractor mit Körpergrenze je Route (Melden bleibt 64 KiB), `PROTOKOLL = 2` mit Fenster N/N−1. Tests: größtes zulässiges Paket passt; altes Melden-Schema (Version 1) weiter grün; Paket über Grenze → 413/abgelehnt
- [x] 3.2 Liefern: Einsätze der zugeordneten Orgs (ohne Spiegel, aktiv oder Abschluss noch nicht bestätigt, ohne Demo), Zeilen nach Stand mit Live-Inhalt, gelöschte als `geloescht`, Abhängigkeiten mitliefern (≤ 4 Ebenen), Budget in der Reihenfolge des Pakets, `kennung` beim ersten Liefern setzen. Tests: Reihenfolge, Budget ohne Lücke und ohne Doppel, Meldung vor später geändertem Verweis, Demo-Einsatz bleibt draußen
- [x] 3.3 Übernehmen: Transaktion je Einsatzlieferung unter Merker, zwei Durchgänge, Einsatzverweise über `spiegel_herkunft`, Einsatzkopf und `einsatz_spiegel` beim ersten Mal, Stand nur bis `bis` (vorwärts), unbekannte Spalten ignoriert, fehlende vorgegeben, unbekannte Freigabestufe → Halt mit Hinweis. Tests je Fall, ETB-Volltextsuche findet gespiegelte Einträge
- [x] 3.4 Stammdatenverweise an der meldenden Seite übersetzen (beide Richtungen), ohne Gegenstück `NULL` mit Schnappschuss; Mitgliedschaften von Konten nur einer Seite still aus. Tests: Spontanhelfer, geliehenes Fahrzeug, Mitgliedschaft mit gemeinsamem Konto ergibt dieselbe Rolle am Spiegel
- [x] 3.4a Stellvertreter-Konten (D5, Nachtrag 10.11.2026): `konten` in der Lieferung, Migration `spiegel_konto`, Auflösung `gegen_id` → Herkunft → Stellvertreter, Anzeigename nachziehen; Benutzerverwaltung, Auswahllisten und Anmeldung schließen Stellvertreter aus. Tests: ETB-Verfasser nur am ELW erscheint am Hub mit Namen; Anmeldung mit dem Stellvertreter scheitert; Liste der Benutzerverwaltung ohne Stellvertreter; Umbenennung kommt an
- [x] 3.5 Route `POST /api/instanz/spiegel` (beide Rollen in einem Handler), `spiegel_ziel` für Push, Rücksetzen bei niedrigerem Stand. Integrationstests mit zwei Instanzen: ELW führt → Hub spiegelt; Hub führt → ELW spiegelt; 300 ETB-Einträge ohne Netz, dann Abgleich vollständig und in `lfd_nr`-Reihenfolge; Abbruch nach erstem Teil setzt fort; Hub aus Sicherung zurück → neu ab niedrigerem Stand; Demo-Einsatz aus `demo` Zeile für Zeile gleich (Vergleich über `TABELLEN`)
- [x] 3.6 Live-Ereignis `spiegel` (`{ einsatz_id, kategorien }`) nach dem Commit, eins je Paket; Client lädt die Prefixe der Kategorien neu. Tests Backend (Abonnent sieht ein Ereignis) und Vitest (Zuordnung Kategorie → Query-Prefixe)

## 4. Takt (D12)

- [x] 4.1 `spiegel::start` mit Tick 1 s, `naechster_abgleich_at` je Kopplung, kurzer Takt bei aktiven Einsätzen, offenen Anträgen oder Anforderungen, sonst Takt der Meldung, Rückoff bis 600 s, Wecken per `Notify`; Schalter `--instanz-spiegel-sekunden` / `LIFELINE_INSTANZ_SPIEGEL_SEKUNDEN` (2–600, Vorgabe 5) in `src/config.rs` und `docs/betrieb/`. Tests: ruhige Kopplung im Melde-Takt, aktiver Einsatz im kurzen Takt, Fehler verdoppeln, neuer Antrag weckt
- [x] 4.2 Gegenüber mit Protokoll 1: kein Abgleich, Hinweis „Gegenüber spiegelt noch nicht (Update nötig)“ an beiden Seiten. Integrationstest mit herabgesetzter Version

## 5. Anhänge auf Abruf (D8)

- [x] 5.1 Migration `spiegel_anhang`, `spiegel_anhang_teil`; Liefern ohne BLOB (Größe, Prüfsumme), Spiegel legt leeren Inhalt an. Test: ETB-Abgleich mit 20-MiB-Anhang braucht ein Paket, nicht die Anhangsgröße
- [x] 5.2 Abruf am Spiegel → 409 `ANHANG_WIRD_GEHOLT` (Fall in `tests/fehler_vertrag.rs`), `angefordert_at`, Wecken; Stücke à 256 KiB, Angeforderte vor Vorabladen, Prüfsumme vor Gültigkeit, falsche Prüfsumme → verwerfen und neu, geänderter Anhang → neu. Integrationstests für jeden Fall, auch `karte_hintergrundbild_daten` und `uhs_plan`
- [x] 5.3 Vorschau und Download im Frontend: „wird geholt“, erneuter Versuch nach Live-Ereignis. Vitest

## 6. Anträge (D9, D11)

- [x] 6.1 Migration `spiegel_antrag`, `spiegel_antrag_eingang`; `BEANTRAGBAR` (16 Erfassungen mit Art, Methode, `MatchedPath`, Verweisfeldern) samt Wächter: jede `erfasse…OfflineFaehig`/`save…OfflineCapable`-Art aus `frontend/src/offline/queue.ts` hat einen Eintrag oder eine Ausnahme mit Grund
- [x] 6.2 Antrag am Spiegel: Anmeldung und Schreibrecht wie die Route, `client_id`-Pflicht, Verweise lokal → fremd, 202 `{ antrag }`, gleiche `client_id` → gleicher Antrag, Anhänge am ETB → 400; `GET /api/einsaetze/{id}/antraege`, `DELETE …/antraege/{antrag_id}` (nur abgelehnte, nur eigene). Tests je Fall, Beobachter → 403
- [x] 6.3 `AntragAkteur`-Extension in `CurrentUser`, Router in `OnceLock` am `AppState`, `spiegel::antrag::ausfuehren` per `oneshot`; Ergebnis 2xx/4xx/5xx wie D11, `spiegel_antrag_eingang` für Wiederholungen, „Führung liegt nicht hier“. Tests: Kopf und Cookie täuschen keinen Akteur vor; doppelte Zustellung wirkt einmal; Konto ohne Schreibrolle → abgelehnt
- [x] 6.4 Anträge und Quittungen im Paket (beide Richtungen), Kontoübersetzung an der meldenden Seite, Zustände `zugestellt`/`uebernommen`/`abgelehnt`, Verschwinden erst mit bekannter Ergebniszeile, Räumen abgelehnter nach 30 Tagen. Integrationstests: alle 16 Arten Hub → ELW und ELW → Hub; abgeschlossener Einsatz → abgelehnt mit Grund; Person gelöscht → „Bezug nicht mehr vorhanden“; Konto nur am ELW → „Konto am Führer unbekannt“
- [x] 6.5 `docs/architektur/entscheidungen/`: ADR „Ein Einsatz wird an einer anderen Instanz als Spiegel in denselben Tabellen gehalten“ (Regeln: Trigger-Pflicht, Schutz, Anträge nur `BEANTRAGBAR`, Ausführen über den Router), Prüfung in `scripts/check-architektur.sh` grün

## 7. Oberfläche (D13)

- [x] 7.1 `EinsatzAnzeige.spiegel` im Backend samt Typ-Codegen; `darfImEinsatzSchreiben`/`darfEinsatzLeiten` → `false` am Spiegel, neue Regel `darfBeantragen`; Vitest in `schreibrecht.test.ts`, Guard `schreibrecht.guard.test.ts` grün
- [x] 7.2 Die 16 Erfassungsorte auf `darfBeantragen`; `erfasse…OfflineFaehig` mit Ergebnis `beantragt`; `useVorgemerkteSchreibaktionen` nimmt Anträge derselben Art dazu; ETB zeigt beantragte Einträge wie ausstehende; Anhang-Knopf am Spiegel aus. Vitest je Ort (Spiegel: Erfassen möglich, Bearbeiten gesperrt; Beantragt sichtbar, nicht in Kennzahlen)
- [x] 7.3 `SpiegelBand` im Einsatzrahmen (Gegenstelle, Stand, Zähler, „keine Verbindung seit …“, „Abgleich beendet“) mit Antragsliste („Neu erfassen“, „Verwerfen“); Query-Key `antraege` nach `frontend/AGENTS.md`, in `lagebildOffline.guard.test.ts` ausdrücklich draußen mit Grund. Wortlaut per `design:ux-copy`. Vitest
- [x] 7.4 Seite „Instanzkopplung“: Abschnitt „Einsätze“ je Kopplung, Hinweise (Protokoll 1, Freigabestufe unbekannt, ausgelassene Zeilen); Endpunkt dafür samt Typ-Codegen. Vitest
- [ ] 7.5 e2e-Fall in `frontend/e2e/`: Einsatz per Testhelfer als Spiegel markiert; Band sichtbar, Bearbeiten gesperrt, ETB-Erfassung wird „Beantragt“. Lauf grün
- [x] 7.6 `frontend/src/offline/AGENTS.md`: Abschnitt „Anträge am Spiegel“ (Verhältnis zur Warteschlange, Query-Key draußen, `beantragt`)

## 8. Widerruf (D14)

- [x] 8.1 Widerruf einer Org-Zuordnung (eigene Seite und Mitteilung des Gegenübers): `beendet_at`, Anträge `abgelehnt: Kopplung widerrufen`, `spiegel_ziel` gelöscht, in der Transaktion des Widerrufs (`repo::org_widerrufen`); keine eigene `admin_audit`-Aktion, der Widerruf steht schon in der Admin-Spur (Nachtrag D14). Integrationstest: Widerruf am Hub, Spiegel bleibt lesbar und gesperrt, ELW liefert nichts mehr

## 9. Doku

- [x] 9.1 Architekturdoku Kapitel 5 (Baustein `instanz::spiegel`), 6 (Laufzeitsicht Abgleich und Antrag), 8 (Schutz per Trigger, Ausführen im Namen des Kontos), 11 (Risiken aus diesem Entwurf, Art.-9-Daten am Hub); Konzeptnotiz: offene Frage „schmale Leitung“ beantwortet. `scripts/check-architektur.sh` grün
- [ ] 9.2 Anwenderdoku `instanzkopplung.md` (Spiegel, Band, Anträge, Anhänge „wird geholt“, Widerruf) nach `docs/anwender/AGENTS.md`; Wächter der Anwenderdoku grün

## 10. Abschluss

- [ ] 10.1 Review-Fan-out (Sicherheit mit Schwerpunkt D11, Korrektheit, Konventionen, Tests) und `superpowers:requesting-code-review`; bestätigte Befunde behoben
- [ ] 10.2 Bilder der Änderung (Band am Spiegel, gesperrte Bearbeitung, beantragter ETB-Eintrag, abgelehnter Antrag, Abschnitt „Einsätze“ der Seite „Instanzkopplung“) für PR und Meldung
- [ ] 10.3 `./scripts/check-all.sh` grün (lokal das Bündel `schnell` und die betroffenen Suiten, voll über die CI des PRs)

## Workflow follow-up

- `/opsx:archive` samt Spec-Sync im selben Branch, dann PR gegen `alpha`
- LLH-1492 auf `review`, nach dem Merge `done`
