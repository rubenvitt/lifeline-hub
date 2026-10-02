# Proposal

## Why

Die Offline-Karten-Verwaltung sagt nicht, ob und wann Karten aktualisiert werden. Der
karten-service baut die Regionen zwar per Cron neu (Vorgabe quartalsweise, `KS_SCHEDULE`). Der
Hub lädt den neuen Stand aber nie selbst: Er zeigt „Update verfügbar“ und wartet auf einen Klick.
Ob gerade gebaut oder geladen wird, wann die Karte zuletzt aktualisiert wurde und wann der nächste
Lauf ansteht, sieht niemand. Eine veraltete Offline-Karte fällt erst auf, wenn sie im Einsatz
fehlt. Entscheidungen des Menschen vom 02.10.2026 (LFH-993):

1. „Jetzt aktualisieren“ baut die Region neu **und** lädt das Ergebnis danach selbst aufs Gerät.
2. Der Hub lädt neuere Katalog-Versionen künftig **automatisch**.

## What Changes

- **Automatische Aktualisierung im Hub.** Ein Hintergrundlauf prüft den Katalog in einem festen
  Abstand (Vorgabe 6 h, abschaltbar). Findet er für eine heruntergeladene Karte einen neueren
  Stand, lädt er ihn ohne Ausfall in dieselbe Zeile (In-Place-Tausch wie „Neu laden“). Es läuft
  immer nur eine automatische Aktualisierung zur selben Zeit.
- **Die Update-Erkennung erkennt auch einen Neubau vom selben Tag.** Bisher zählte nur eine
  andere URL. Die Dateinamen tragen nur das Datum, ein zweiter Bau am selben Tag behält die URL.
  Künftig zählt auch ein abweichender SHA256-Pin.
- **„Jetzt aktualisieren“ je Karte (Admin).** Führt der Katalog schon einen neueren Stand, wird er
  sofort geladen. Sonst baut der karten-service die Region neu, und der Hub lädt das Ergebnis nach
  dem Bau selbst. Ohne karten-service prüft der Knopf nur den Katalog und meldet „aktuell“. Der
  Knopf ersetzt in der Verwaltung „Aktualisieren“ und „Neu laden“.
- **Neuer Status-Endpunkt** `GET /api/karte/offline-karten/aktualisierung`: Automatik an/aus,
  letzte und nächste Prüfung, nächster geplanter Kartenbau, Erreichbarkeit des karten-service,
  je Karte die laufende Phase (Bau wartet, baut, lädt) und der letzte Fehler.
- **karten-service:** neuer Endpunkt `GET /zeitplan` mit dem nächsten Cron-Lauf.
- **Verwaltung:** eine Zeile über der Tabelle zur Automatik und zu den Läufen. Je Karte
  „Stand …“ und „auf dem Gerät seit …“, die laufende Phase und ein fehlgeschlagenes Update.
- **Einstellbar in der Verwaltung** (Entscheidung 02.10.2026): Ein System-Admin schaltet die
  Automatik an oder aus und wählt den Prüfabstand (1 Stunde bis 7 Tage). Die Einstellung wird
  gespeichert und wirkt ohne Neustart. Neuer Endpunkt
  `PUT /api/karte/offline-karten/aktualisierung/einstellung`.
- **Betrieb:** zwei neue Schalter, `LIFELINE_KARTEN_AUTO_AKTUALISIERUNG` (Vorgabe an) und
  `LIFELINE_KARTEN_AUTO_AKTUALISIERUNG_INTERVALL_STUNDEN` (Vorgabe 6). Sie gelten nur, solange in
  der Verwaltung nichts gespeichert ist.

## Capabilities

### New Capabilities

- `offline-karten-aktualisierung`: Wie Offline-Karten automatisch und auf Knopfdruck aktuell
  gehalten werden und was die Verwaltung über laufende, letzte und nächste Aktualisierungen zeigt.

### Modified Capabilities

Keine. `katalogtabelle-spaltenschalter` regelt nur den Spaltenschalter. Die Spalten der
Offline-Karten-Verwaltung bleiben dieselben, neu sind nur Inhalte in „Name“, „Status“ und
„Aktionen“.

## Impact

- **karten-service:** `karten-service/src/scheduler.rs` (die Job-ID bleibt erhalten),
  `karten-service/src/api.rs` (`GET /zeitplan`) und `karten-service/src/main.rs`. Geteilter Typ
  `Zeitplan` in `crates/karten-katalog`. Runbook
  `docs/ops/lfh-204-karten-service-ops-runbook.md`.
- **Hub-Backend:** neues Modul `src/karte/auto_aktualisierung.rs` (Wächter, Zustand, Tick).
  `src/routes/karte.rs`: In-Place-Start als gemeinsame Funktion, `finde_update_eintrag` mit
  SHA-Vergleich, zwei neue Handler. Außerdem `src/app.rs` (Routen), `src/main.rs` (Start des
  Wächters), `src/config.rs` (zwei Schalter), `src/api_doc.rs`, Repo-Funktionen in
  `src/karte/registry/repo.rs`, Typ-Codegen (`frontend/src/api/types.generated.ts` u. a.) und `tests/enum_wire_kontrakt.rs` (neues
  feldloses Enum).
- **Frontend:** `frontend/src/karten/OfflineKartenVerwaltung.tsx` samt Test,
  `frontend/src/api/offlineKarten.ts` und `frontend/src/api/queryKeys.ts` (neuer Bereichs-Key).
- **Migration `0134_karte_auto_aktualisierung.sql`:** eine Tabelle mit höchstens einer Zeile für
  die gespeicherte Einstellung. Der Laufzustand des Wächters liegt weiter nur im Speicher. Nach
  einem Neustart steht „zuletzt geprüft“ bis zum ersten Lauf leer.
- **API:** Das Feld `ersetzt_karte_id` von `POST /offline-karten/download` bleibt, die eigene
  Oberfläche nutzt es nicht mehr. Ob es entfällt, entscheidet ein Folgetask.
- **Last:** Automatische Downloads ziehen mehrere GB. Es läuft immer nur einer zur Zeit, und vor
  jedem wird der Plattenplatz geprüft.
