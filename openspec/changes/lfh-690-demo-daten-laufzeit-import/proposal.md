# Proposal

## Why

Eine Demo-Instanz soll eine realistisch befüllte Lage zeigen, ohne dafür ein eigenes Image
oder den Dev-Seed zu brauchen. Der Dev-Seed (`src/dev/seed.rs`, Feature `dev-seeds`) taugt
dafür nicht: Er legt feste Konten mit dem Passwort `dev` an, setzt das Admin-Passwort
zurück, sucht die Organisation mandantenblind (`ORDER BY id LIMIT 1`, LFH-232) und läuft
nur beim Start. Der Auftraggeber will deshalb dasselbe Binary für alle Instanzen: Eine
Umgebungsvariable schaltet den Import frei, und ein System-Admin spielt die Daten **im
laufenden Betrieb** ein, entfernt sie wieder oder importiert sie neu (LFH-690).

## What Changes

- **Freischaltung** über `--demo-daten` / `LIFELINE_DEMO_DATEN`, Vorgabe **aus**. Ohne
  Freischaltung sind die Demo-Routen **nicht registriert** und antworten wie jeder
  unbekannte `/api/`-Pfad mit 404, egal mit welcher Methode und ob angemeldet oder nicht.
  Beim Start mit Freischaltung steht eine laute Warnung im Log.
- **Vier Endpunkte**, nur für den System-Admin (sonst 403, anonym 401):
  `GET /api/demo-daten` (Status samt letztem Bericht), `POST /api/demo-daten` (Import),
  `POST /api/demo-daten/neu` (Entfernen und Import in einer Transaktion) und
  `DELETE /api/demo-daten` (Entfernen). Ziel ist immer die Organisation des angemeldeten
  Admins. Je Organisation gibt es höchstens einen aktiven Import, ein zweiter Import
  antwortet mit 409.
- **Herkunftsmarke:** neue Tabellen `demo_import` (Kopf je Import, bleibt nach dem Entfernen
  als Historie stehen) und `demo_herkunft` (welche Stammdatenzeile der Import neu angelegt
  hat). Der Demo-Einsatz hängt am Kopf. Alles, was in ihm liegt, fällt über die vorhandene
  `ON DELETE CASCADE`-Kette mit.
- **Stammdaten mit Konfliktregel:** Fahrzeuge werden über den Funkrufnamen abgeglichen,
  Personal über eine feste Demo-Personalnummer, Material über die Bestandsnummer, jeweils
  nur gegen Datensätze `in_dienst`. Ein Treffer wird **mitbenutzt**, weder überschrieben
  noch markiert. Kataloge (FMS-Status, Einheitstypen, Qualifikationen …) werden nur
  mitbenutzt, nie angelegt. Fehlt ein benötigter Eintrag, antwortet der Import mit 422 und
  nennt ihn. Der Bericht zählt je Art „angelegt“ und „mitbenutzt“.
- **Demo-Einsatz „ÜBUNG – Starkregen Musterstadt“** (Einsatzart `uebung`, fiktiver Ort,
  erkennbar fiktive Namen). Enthalten sind Einsatzabschnitte Betreuung, Sanitätsdienst und
  Logistik mit Lagezustand, Einheiten mit FMS-Status und gemischten Rückmeldungen, eine UHS
  mit gesichteten Betroffenen (SK I–IV nach BBK), ein Bereitstellungsraum, eine
  Betreuungsstelle mit Belegung, ein Evakuierungsbezirk (belegt den Lageplatz „Evakuiert“),
  Gefahrengebiete mit Warnstufe, Meldungen, Aufträge, ein freigegebener Befehl und
  Lagebericht, Erinnerungen und eine ETB-Zeitachse mit gemischten Typen. Alle Zeiten liegen
  relativ zum Importzeitpunkt. Die ETB-Einträge des Demo-Einsatzes tragen als Eingangszeit
  ihre Ereigniszeit, deshalb fehlt dort das ⧖ „nachgetragen“. Der importierende Admin wird
  Einsatzleitung, weitere Mitglieder gibt es nicht. **Kein Pegel:** Eine echte
  PEGELONLINE-Station passt nicht zum fiktiven Ort.
- **Alarmbudget:** Vergangene Fälligkeiten gelten beim Import als ausgelöst oder erledigt.
  Der Import erzeugt keine eskalierbare Sofortmeldung. Höchstens eine Erinnerung liegt in
  der Zukunft.
- **Entfernen:** ein neuer, harter Löschweg, gebunden an die Marke. Er löscht nur den
  Einsatz, auf den `demo_import` der eigenen Organisation zeigt, und nur Stammdatenzeilen
  aus `demo_herkunft`. Eine Demo-Stammdatenzeile, auf die inzwischen etwas anderes zeigt,
  bleibt stehen und verliert ihre Marke. Der Bericht nennt sie.
- **Keine Wiederverwendung der Einsatz-ID:** Die Import-Historie hält die vergebene ID fest.
  Die Einsatzanlage vergibt neue IDs oberhalb aller vergebenen und aller gesperrten IDs.
  So landet eine Offline-Schreibaktion oder ein offener Tab des entfernten Demo-Einsatzes
  nie in einem echten Einsatz.
- **Oberfläche:** eine Verwaltungssektion „Demo-Daten“ nur für den System-Admin, mit
  Status, Aktionen und Bericht. Entfernen und Neu importieren verlangen eine
  `danger`-Rückfrage. Dazu ein Hinweis in der Einsatzliste für den System-Admin, solange
  nichts importiert ist.
- **Prüfliste Einsatztauglichkeit** für die neue Sektion.

Nicht Teil dieses Changes sind: eine sichtbare Demo-Marke an Stammdaten in den Katalogen
und Auswahllisten, ein org-weites Live-Ereignis für die Einsatzliste, ein Eintrag in der
Sprungpalette, der Pegel und Chat-Nachrichten. Die Gründe stehen in `design.md`.

## Capabilities

### New Capabilities

- `demo-daten`: Freischaltung und Rechte des Demo-Imports, Herkunftsmarke, Stammdaten mit
  Konfliktregel und Bericht, Inhalt und Zeitachse des Demo-Einsatzes, Entfernen und
  Neu-Import, Sperre der Einsatz-ID sowie die Verwaltungssektion und der Hinweis in der
  Einsatzliste.

### Modified Capabilities

(keine: `lagekarte-fachebenen` ist nicht berührt)

## Impact

- **Datenbank:** neue Migration `0123_demo_daten.sql` mit zwei Tabellen. Die Nummer wird
  direkt vor dem PR mit `scripts/check-migrationen.sh` gegen `origin/alpha` bestätigt.
  Bestandstabellen bleiben unverändert.
- **Backend:** neues Modul `src/demo/` (Szenario, Import, Entfernen) und
  `src/routes/demo_daten.rs`. `src/config.rs` bekommt den Schalter, `src/app.rs` die
  Router-Option `build_router_mit`, `src/main.rs` die Übergabe und die Warnung beim Start.
  `src/einsatz/repo.rs` bekommt `anlegen_tx` mit der ID-Sperre. In den Fach-Repos, die der
  Import nutzt, werden die fehlenden `_tx`-Varianten herausgelöst (mechanischer Split,
  Verhalten der Pool-Varianten unverändert): Einsatzabschnitt, Einheit, Meldung,
  Befehl/Lagebericht (Anlage und Freigabe), UHS, Bereitstellungsraum, Erinnerung und die
  Stammdaten-Anlage für Fahrzeug, Personal und Material. Außerdem ändern sich
  `src/einsatz/schwaerzung_registry.rs` und `src/api_doc.rs`.
- **API:** neue Endpunkte unter `/api/demo-daten`, nur mit Freischaltung. Bestehende
  Endpunkte bleiben unverändert.
- **Frontend:** `admin/` (Sonderfall-Sektion neben `adminBenutzer`), neue Seite, API-Client,
  `GLOBAL_KEYS.demoDaten`, Hinweis in `pages/EinsaetzePage.tsx`, MSW-Default-Handler
  (404 = aus) und generierte Typen.
- **Tests und Guards:** neues `tests/demo_daten.rs`, dazu `tests/fehler_vertrag.rs`
  (404-Vertrag), `schwaerzung_registry`-Guards, `globalKeys.test.ts` (Zählung 23 → 24),
  `adminNav.test.tsx` und `tests/org_scope_guard.rs`.
