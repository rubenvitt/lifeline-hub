# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.

## 1. Datenmodell und Registry-Eintrag

- [x] 1.1 Migration mit der nächsten freien Nummer über `origin/alpha` (D1): Tabelle `schwaerzung_antrag` mit CHECKs (Zielart, `ziel_id` genau bei `einsatz` NULL, höchstens einer von zurückgenommen/vollzogen) und dem Ausdrucks-Unique-Index für offene Anträge. Beleg: `scripts/check-migrationen.sh` grün, `db::tests::migrationsnummern_sind_eindeutig` grün, ein Repo-Test zeigt, dass ein zweiter offener Antrag für dasselbe Ziel an der Datenbank scheitert und ein Einsatz-Antrag neben einem Personen-Antrag geht.
- [x] 1.2 `schwaerzung_antrag` in `TABELLEN` klassifizieren (alle Spalten `Retain` mit Begründung, `ziel_id` als `G_POLY`). Beleg: die bestehenden Registry-Guards sind grün und werden ohne den Eintrag rot (Mutationsprobe).
- [x] 1.3 `ANTRAG_KARENZ_STUNDEN` und `antrag_faellig_at` in `src/einsatz/retention.rs` mit Grenztests (23:59 offen, 24:00 fällig). Beleg: Unit-Tests in `retention::tests`.

## 2. Personenbezüge in der Registry

- [x] 2.1 `PersonenArt`, `PersonenBezug` und `PERSONENBEZUEGE` mit den Markierungen aus D5 anlegen. Beleg: kompiliert, Guards aus 2.2 grün.
- [x] 2.2 Guards 1–3 aus D5 über `pragma_foreign_key_list` und Selbsttest 4 mit Sonden-Tabelle. Beleg: Guards grün; Mutationsproben (Bezug `einsatz_tier.halter_person_id` entfernen, eine Scrub-Spalte unmarkiert lassen, eine Retain-Spalte als `Mit` markieren) machen je einen Guard rot.
- [x] 2.3 `scrubbe_person(conn, einsatz_id, art, id)` aus `PERSONENBEZUEGE` mit Strategien aus `TABELLEN`, eingegrenzt auf Bezug, Einsatz-Scoping und Zeilenfilter. Beleg: Repo-Tests je Personenart mit einer Nachbarzeile derselben Art im selben Einsatz und einer Zeile mit derselben id-Spalte in einem anderen Einsatz; nur die Zielzeilen ändern sich; Retain-Spalten bleiben; `PRAGMA foreign_key_check` leer.

## 3. Antrag, Rücknahme und Vollzug im Repo

- [x] 3.1 Repo-Funktion `antrag_stellen` (`write_retry!`): Zustandsprüfung des Einsatzes (aktiv 409, geschwärzt 409), Zielprüfung (anderer Einsatz 404, Stammkraft 422, Bestätigung 422, offener oder vollzogener Antrag 409), Insert und System-ETB-Eintrag des Admins (D10). Beleg: Repo-Tests je Ablehnungsfall ohne Schreibvorgang (ETB-Zähler unverändert) und ein Erfolgsfall mit Audit-Text ohne Namen.
- [x] 3.2 Repo-Funktion `antrag_zuruecknehmen` mit bewachtem UPDATE (D2) und ETB-Eintrag. Beleg: Tests für 3 h (Erfolg), 25 h, zurückgenommen und vollzogen (je 409, nichts geändert), fremder Einsatz (404).
- [x] 3.3 `schwaerze_einsatz` in Kern und zwei Hüllen teilen (D4); Antragshülle setzt Vormerkung und `geschwaerzt_at`, markiert alle offenen Anträge des Einsatzes als vollzogen. Beleg: die bestehenden Tests in `purge_scheduler::tests` bleiben unverändert grün; neuer Test „Einsatz mit Frist in 5 Jahren auf Antrag geschwärzt“ zeigt denselben Scrub wie die fristbasierte Schwärzung.
- [x] 3.4 Vollzug eines Personen-Antrags (`scrubbe_person` + Kennzeichen + ETB-Eintrag mit Akteur aus dem Antrag, Fallback Akteurskette) in einer Transaktion; Antrag an inzwischen geschwärztem Einsatz ohne Scrub als vollzogen. Beleg: Repo-Tests inklusive Rollback bei erzwungenem Fehler im Audit.

## 4. Purge-Lauf

- [x] 4.1 Neue Phase für fällige Anträge zwischen A und B in `tick_mit_rueckschrieb`; Vollzug zählt für den WAL-Rückschrieb. Beleg: Scheduler-Tests „23 h nichts, 24 h vollzogen, zweiter Lauf ändert nichts“, „Rücknahme verhindert Vollzug“, „Antrag während der 30-Tage-Karenz“ und eine Variante von `schwaerzung_hinterlaesst_keine_altbytes` für einen Personen-Vollzug (Klartext der Person weder in DB noch WAL, Klartext der Nachbarperson weiter vorhanden).

## 5. Zustand und Übersicht

- [x] 5.1 `AufbewahrungZustand::SchwaerzungBeantragt` und neuer Parameter in `retention::zustand` (D8); Übersicht und Akte lesen die Fälligkeit des offenen Einsatz-Antrags. Beleg: Unit-Test der Rangfolge, `tests/enum_wire_kontrakt.rs` erweitert, Szenarien „Offener Einsatz-Antrag“ und „Zurückgenommener Antrag“ der Übersicht in `tests/aufbewahrung.rs`.

## 6. Personensuche

- [x] 6.1 Normalisierung und Abgleich (ganze Wörter, Ziffern ≥ 6) als reine Funktion mit Unit-Tests (Umlaute, Reihenfolge der Wörter, kein Teilwort-Treffer, Rufnummer mit Leerzeichen). Beleg: Unit-Tests.
- [x] 6.2 Repo-Funktion `personensuche` (nur lesend) über alle vier Personenarten mit Kennungen aus D6 und Antragsstand. Beleg: Repo-Test „Erika Mustermann“ liefert `R-001`, die Antwort-Serialisierung enthält weder „Erika“ noch „Mustermann“; geschwärzte Person wird nicht gefunden.

## 7. Routen, Guard und Codegen

- [x] 7.1 Vier Routen aus D7 mit `AdminUser`, `fordere_archivzugriff`, `JsonBody`/`PfadParam`; Request-DTOs, Response-DTOs mit `ToSchema`, `no-store` an der Suche. Beleg: Integrationstests in `tests/loeschersuchen.rs` für jedes Szenario von `aufbewahrung-loeschersuchen` mit Statuscode (201, 400, 403, 404, 409, 422) und für „Personensuche durch die Einsatzleitung“ (403).
- [x] 7.2 Guard `archiv_namensraum_nur_lesend_und_admin` auf acht Routen und die benannte Nicht-GET-Menge umstellen, plus Prüfung „Personensuche schreibt nicht“. Beleg: Guard grün; Selbsttests (zusätzliche Nicht-GET-Route, `write_retry!` in der Suche) machen ihn rot.
- [x] 7.3 `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` sowie `types.generated.ts` mitcommitten. Beleg: Skript grün.
- [x] 7.4 Ende-zu-Ende in `tests/loeschersuchen.rs` (`personen_antrag_bis_zum_vollzug`): Personen-Antrag über die Route, Uhr +24 h, Purge, dann ETB-Spur (zwei Einträge mit Aktenzeichen und `R-042`, ohne Namen) und Szenario „Name im ETB-Wortlaut bleibt“. Beleg: Test grün; `AUSNAHMEN_SYSTEM_ETB` unverändert.

## 8. Frontend

- [x] 8.1 API-Funktionen und Query-Keys in `frontend/src/api/aufbewahrung.ts` und `queryKeys.ts`; Farbe und Wort für `schwaerzung_beantragt` in `theme/statusFarben.ts`. Beleg: vitest für die Zustandsabbildung, `tsc --noEmit`.
- [x] 8.2 `SchwaerzungsantragDialog` (Rückfrage nach D9; Absenden erst bei Aktenzeichen und passender Kennung). Beleg: vitest „Kennung `R-04` für `R-042` → Absenden gesperrt“, „Hinweis auf Freitexte nur beim Personen-Antrag“.
- [x] 8.3 `PersonensucheDialog` (Suchfeld ≥ 3 Zeichen, Treffertabelle pseudonym, Antrag je Treffer). Beleg: vitest mit gemockter Antwort.
- [x] 8.4 Paneel „Löschersuchen (Art. 17)“ in `ArchivAktePage.tsx` mit Antragsliste, „Zurücknehmen“ nur bei offenem Antrag innerhalb von 24 h, Aktionen nur an nicht geschwärzten Einsätzen, Etikett „auf Antrag geschwärzt“ im Register. Beleg: vitest für die Szenarien „Offener Antrag“ und „Geschwärzter Einsatz“.

## 9. Regeln und Abschluss

- [x] 9.1 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“: Antrag, Personenbezüge (`PERSONENBEZUEGE`, Guard), neue Archivrouten und Herleitung auf das spätere Archiv dieser Change. Beleg: `prettier`/Längenregel der Wurzel-`AGENTS.md` unberührt, Verweise per grep geprüft.
- [x] 9.2 Folgeticket über `clickup-task-anlegen`: Live-Invalidierung und Offline-Caches nach einem Personen-Vollzug. Beleg: Task-Link im PR-Text.
  - Angelegt: LFH-996 „Schwärzung: offene Clients und Offline-Lagebild nach dem Vollzug räumen“.
- [x] 9.0 Prüfliste Einsatztauglichkeit (15 Kriterien) an Akte, Suche und Rückfrage (Review LFH-751, `frontend/AGENTS.md`). Beleg: `pruefliste.md` in dieser Change; `e2e/aufbewahrung.spec.ts` misst sieben Zustandsetiketten und 390 px ohne Überlauf.
- [x] 9.3 `./scripts/check-all.sh` lokal (soweit die Umgebung es trägt) und in der CI des PRs grün. Beleg: Lauf im PR.
  - Lokal (02.10.2026, Cloud-Sitzung, `PW_PROJEKTE=chromium`, ohne Debug-Info wegen des Speicherkontingents): Schritte 1–3, 5, 6, 8–13 grün; Vitest 644 Dateien / 8893 Tests grün; Rust-Workspace 120 Testläufe ohne Fehler.
  - Rot nur aus der Umgebung: die Desktop-Hülle (`src-tauri`) baut ohne GTK-Systembibliotheken nicht (`gdk-sys`), und zehn e2e-Fälle (`fokus-verdeckung`, `etb-anhang` u. a.) scheitern an der vorinstallierten, älteren Chromium-Fassung — dieselben zehn Fälle scheitern mit dem Frontend-Stand von `origin/alpha` identisch. Alle Aufbewahrungs-Specs grün.
  - Beleg für das ganze Gate: die CI des PRs.
- [x] 9.4 Prüfung im laufenden Stack (`cargo run --features dev-seeds`, Vite): Personensuche, Antrag, Rücknahme, Antrag mit vorgestellter Uhr bzw. per Test-Tick vollzogen, Akte danach. Beleg: Befund in dieser Datei.
  - Laufender Stack über Playwright (Chromium, `e2e/aufbewahrung.spec.ts`, „Löschersuchen (LFH-751) …“): Suche „ayse yilmaz“ → ein Treffer ohne Namen → Rückfrage, Absenden gesperrt bis zur Kennung → Antrag „offen“, kein Name auf der Seite, System-Eintrag mit Aktenzeichen und `R-001` im Archiv-ETB → Rücknahme → „zurückgenommen“. Screenshots von Rückfrage und Akte gesichtet.
  - Vollzug mit verstellter Uhr: `tests/loeschersuchen.rs` (`personen_antrag_bis_zum_vollzug`) über Route und Purge-Lauf; die Uhr des laufenden Servers lässt sich nicht vorstellen.
- [x] 9.5 `requesting-code-review` und bestätigte Findings abarbeiten. Beleg: Findings und Umgang im PR.
  - Zwei Reviewer (Backend/Sicherheit, Frontend/Konventionen), Findings am Code verifiziert. Kein Blocker.
  - Behoben (Backend): Suche ohne Melderkontakt und ohne auf Antrag Geschwärzte (Platzhalter-Treffer), Einsatz-Vollzug nennt die Einsatznummer im Audit und meldet die Einsatzliste live, die fristbasierte Schwärzung schließt offene Anträge.
  - Behoben (Frontend): Aktionen im Paneelkörper statt im schrumpffesten Kopf (390 px), zurücknehmende Person und Fälligkeit sichtbar, Neuladen nach abgelehnter Rücknahme, Suchtext mit `gcTime: 0`, `aria-live` an der Trefferzahl, Prüfliste Einsatztauglichkeit (9.0), Tests für Query-Key, Refetch, 409, Übersicht, Akte.
  - Bewusst offen: verwaiste Namens-Schnappschüsse entfernter Dispositionen findet die Suche nicht (Hinweis im Dialog, design.md), Live-Räumung offener Clients und Offline-Caches → LFH-996.
  - Mutationsproben: Einsatzgrenze im Personen-Scrub, WAL-Rückschrieb nach Vollzug, Invalidierung nach Rücknahme — je ein Test wird rot.
