# Veranstaltungen abrufen: geplante Dienste aus einer Fremdanwendung (LLH-2097)

Zunder: https://zunder.rubeen.dev/#/aufgabe/w36lkuqpgnc88lde5wiw0whb (LLH-2097, unter LLH-1191) ·
Stand: 25.11.2026 · Konzept: [`docs/konzepte/2026-11-10-schnittstellen-ausbau.md`](../../konzepte/2026-11-10-schnittstellen-ausbau.md)
(Leitplanken G4 „neutraler Vertrag, Adapter übersetzen“, G5, G7) · Rahmen: LLH-1632 (ADR-0077) ·
Liefernde Anwendung heute: die IUK-Suite, Modul `veranstaltungen` (IDA-415)

## Absicht

Sanitätsdienste, Betreuungen und Übungen werden Tage bis Wochen im Voraus geplant, heute in einer
anderen Anwendung (der IUK-Suite). Lifeline soll sie kennen, damit daraus später mit einem Klick ein
Einsatz wird, mit Name, Ort und Zeitraum schon ausgefüllt, statt alles abzutippen. Der Einsatzvorschlag
selbst und das Annehmen sind Sache der Alarmübernahme (LLH-1192), die es noch nicht gibt. Dieser
Entwurf sorgt dafür, dass die Veranstaltungen dann schon da sind.

## Abgestimmt am 25.11.2026 (Phase-1-Checkpoint)

- **Pull:** Lifeline holt ab, die liefernde Anwendung bietet nur eine Leseschnittstelle an
  (Kommentar an LLH-2097 vom 24.11.).
- **Schnitt:** jetzt beide Seiten — die Leseschnittstelle in der Suite und der Adapter in Lifeline.
  Sichtbar als Einsatzvorschlag wird es erst mit LLH-1192.
- **Anmeldung:** Kein Token aus der Umgebung. In der Suite legt ein Admin einen **Abruf-Zugang** an
  (Schlüssel einmal angezeigt, nur gehasht gespeichert, widerrufbar). In Lifeline wird der Schlüssel
  im Geheimnisspeicher des Adapters hinterlegt.
- **Rückmeldung** „welcher Einsatz wurde daraus“ an die Suite: erst mit LLH-1192.

## Ziele

1. **Ein neutraler Vertrag „Veranstaltungen-Abruf v1“**, beschrieben in
   `docs/schnittstellen/veranstaltungen-abruf.md` (Lifeline-Repo). Jede Anwendung, die ihn
   anbietet, ist anbindbar; im Lifeline-Code steht kein Name der Suite (G4). HiOrg (LLH-1634) wird
   später eine eigene Adapterart, die die EFS-API in dieselbe Ablage übersetzt.
2. **Suite:** `GET /api/abruf` auf dem Host des Moduls Veranstaltungen, angemeldet mit
   `Authorization: Bearer <Schlüssel>`. Abruf-Zugänge pflegt ein Modul-Admin.
3. **Lifeline:** Adapterart `veranstaltungen_abruf` („Veranstaltungen (Schnittstelle v1)“) im
   Adapter-Rahmen: Feld `basis_url`, Geheimnis `schluessel`, Intervall mindestens 60 s, Vorschlag
   300 s. Die Admin-UI „Anbindungen“ zeigt sie ohne eigene Oberfläche (Rahmen Teil B).
4. **Ablage in Lifeline:** jede Veranstaltung einmal je Adapter, mit ihrem letzten Stand. Ein
   unveränderter Abruf schreibt nichts; eine Änderung oder Absage ist als solche erkennbar.
5. **Kein stiller Fehler (G7):** Schlüssel abgelehnt, Antwort ungültig, unbekannte Fassung erscheinen
   als Zustand des Adapters (Codes aus `adapter::zustand`).

## Nicht-Ziele

- **Keine Vorschlagsliste, kein Annehmen, keine Benachrichtigung** — LLH-1192.
- **Keine Rückmeldung** an die liefernde Anwendung — mit LLH-1192.
- **Kein Personal:** Wer bei der Veranstaltung eingeteilt ist, kommt über die Schichtplanung
  (Austauschblatt, LLH-1556) bzw. den Stammdaten-Eingang (LLH-1633).
- **Kein Schreiben in die Suite.**

## Vertrag „Veranstaltungen-Abruf v1“

`GET <basis_url>/api/abruf` · `Authorization: Bearer <Schlüssel>` · Antwort `200`,
`application/json`, `Cache-Control: no-store`:

```json
{
  "fassung": 1,
  "stand": "2026-11-25T08:00:00Z",
  "veranstaltungen": [
    {
      "id": "V1StGXR8_Z5jdHi6B-myT",
      "name": "Stadtfest",
      "art": "sanitaetsdienst",
      "status": "zugesagt",
      "ort": "Marktplatz",
      "veranstalter": "Stadtmarketing",
      "beginn": "2026-11-28T07:00:00Z",
      "ende": "2026-11-28T21:00:00Z",
      "bemerkung": "",
      "geaendert": "2026-11-24T19:12:00Z"
    }
  ]
}
```

- Fachbegriffe deutsch, wie es `AGENTS.md` („Bezeichner-Sprache“) für den Wire verlangt.
- Zeitpunkte UTC im Format von `zeit::FORMAT`; die Suite rechnet aus ihrer Zone um.
- `art`: `sanitaetsdienst` · `betreuung` · `uebung` · `sonstiges`; unbekannte Werte nimmt Lifeline
  als `sonstiges` (vorwärtsverträglich).
- `status`: `angefragt` · `zugesagt` · `abgesagt`.
- **Fenster:** alle Veranstaltungen, deren Ende höchstens 7 Tage zurückliegt, abgesagte
  eingeschlossen. So sieht Lifeline eine Absage, bevor die Veranstaltung aus der Liste fällt.
- Höchstens 500 Einträge; Antwort damit unter 512 KiB (Deckel in Lifeline).
- `401` mit `{ "error": { "code": "schluessel_ungueltig", … } }` bei fehlendem oder widerrufenem
  Schlüssel; `404` auf jedem anderen Host.
- Eine höhere `fassung` lehnt Lifeline mit dem Zustand „Fassung unbekannt“ ab.

## Suite (Repo `iuk-suite`)

- **Tabelle `abruf_zugang`** in der Datenbank `veranstaltungen` (Vorbild `helfer.lifeline_zugang`):
  `id`, `bezeichnung`, `schluessel_hash` (SHA-256, eindeutig), `angelegt_am`, `angelegt_von`,
  `zuletzt_abgeholt_am`. Audit-Trigger; `zuletzt_abgeholt_am` ist ausgenommen (jede Abholung schriebe
  sonst eine Zeile).
- **Schlüssel:** 32 Zufallsbytes base64url (43 Zeichen), nur der Hash wird gespeichert; Vorbild
  `helfer/_lib/schluessel.ts` (eigene Kopie, wie dort üblich).
- **Route** `src/app/m/veranstaltungen/api/abruf/route.ts`: prüft Host und Schlüssel selbst. Durch
  den Login kommt sie über `ABRUF_OHNE_LOGIN` in `core/routing.ts`, das dafür von einem Eintrag
  zu einer Liste wird (`helfer` + `veranstaltungen`, jeweils genau ein Pfad; `routing.test.ts`
  sichert, dass Nachbarpfade hinter dem Login bleiben).
- **Verwaltung:** in der Liste der Veranstaltungen für Modul-Admins der Knopf **Abruf-Zugänge**;
  ein Flyin listet die Zugänge mit „zuletzt abgeholt“, legt einen an (Schlüssel einmal sichtbar,
  kopierbar) und widerruft. Vorbild `helfer/_ui/LifelineZugaenge.tsx`.
- **Audit-Abdeckung** (`coverage-manifest.json`) für die neuen Actions und die Route; Runbook
  `veranstaltungen-inbetriebnahme.md` um den Abruf ergänzt; Release Note (neue Funktion für Admins).

## Lifeline (Repo `lifeline-hub`)

### Adapterart

Neues Modul `src/veranstaltung_extern/` (Name nach dem Fachbegriff, nicht nach der Anwendung):
`art.rs` (die Art), `vertrag.rs` (Parser des Vertrags v1 mit Grenzen), `repo.rs` (Ablage).
Registriert in `adapter::art::Verzeichnis::produktiv`. Ablauf nach `drohne/art.rs`:

1. `abrufen` (nur Netz): `GET <basis_url>/api/abruf` mit Bearer; Deckel 512 KiB; Parser prüft
   `fassung`, Felder, Längen (Name 120, Ort/Veranstalter 120, Bemerkung 2000, Kennung 64),
   Zeitpunkte, `ende > beginn`. Eine ungültige Zeile verwirft den ganzen Abruf
   (`AntwortUngueltig`) — ein halber Stand wäre schlimmer als der alte.
2. `uebernehmen` (nur Datenbank, eine Transaktion): je Veranstaltung Fingerabdruck (SHA-256 über
   die Felder ohne `geaendert`); gleich → nichts; neu → Zeile anlegen; anders → Zeile ändern,
   `geaendert_at` setzen. Liefert die Zahl der neuen und geänderten Zeilen.
3. Probelauf („Verbindung prüfen“): nur Schritt 1, meldet die Anzahl.

### Ablage `veranstaltung_extern` (Migration)

| Spalte | Bedeutung |
| --- | --- |
| `org_id` | Organisation des Adapters |
| `adapter_id` | der Adapter, der sie liefert |
| `extern_id` | Kennung in der liefernden Anwendung |
| `name`, `art`, `status`, `ort`, `veranstalter`, `bemerkung` | wie geliefert |
| `beginn_at`, `ende_at` | UTC, `zeit::FORMAT` |
| `fingerabdruck` | SHA-256 des Inhalts |
| `erhalten_at`, `geaendert_at` | erste Lieferung, letzte inhaltliche Änderung |

Primärschlüssel `(adapter_id, extern_id)`. Gelöscht, wenn `ende_at` mehr als 14 Tage zurückliegt
(Aufbewahrung in `src/AGENTS.md` nachtragen) oder der Adapter gelöscht wird. Fällt eine
Veranstaltung aus der Lieferung, ohne abgesagt zu sein (in der Suite gelöscht), bekommt sie den
Status `entfernt`, damit LLH-1192 einen offenen Vorschlag zurückziehen kann.

Keine Personendaten: Der Vertrag enthält nur Veranstaltungen. `veranstalter` ist eine Stelle, kein
Mensch; das Feld wird in der Anwenderdoku so beschrieben.

### Abweichung vom Checkpoint: eigene Ablage statt `alarmmeldung`

Am Checkpoint stand „in der Ablage `alarmmeldung` festhalten“. Beim Lesen der Ablage zeigt sich,
dass sie für Veranstaltungen nicht passt:

- `alarmmeldung` löscht nach **7 Tagen ab Empfang** (Art. 9 DSGVO bei Alarmdaten). Eine Veranstaltung
  in drei Wochen fiele heraus und käme beim nächsten Abruf als „neu“ zurück — jede Woche wieder.
- Sie legt **jede Fassung als eigene Zeile** ab und zählt Wiederholungen; ein Abruf alle 5 Minuten
  ohne Änderung würde dort laufend „erneut empfangen“ vermerken.
- Sie ist roh und wird von LLH-1192 gedeutet; eine Veranstaltung ist schon strukturiert.

Empfehlung: die eigene Ablage oben. LLH-1192 liest dann zwei Quellen (Alarmmeldungen und
Veranstaltungen) in eine Vorschlagsliste; das ist ohnehin nötig, weil beide verschieden ablaufen
(Alarm: 12 h offen; Veranstaltung: bis zu ihrem Beginn).

### Doku in Lifeline

- `docs/schnittstellen/veranstaltungen-abruf.md` (Vertrag, Beispiel).
- Anwenderkapitel `docs/anwender/kapitel/anbindungen.md`: Abschnitt „Veranstaltungen abrufen“.
- Architektur: Kapitel 5 (Baustein), 8 (Aufbewahrung) nach `docs/architektur/AGENTS.md`; keine
  neue ADR (der Rahmen ADR-0077 trägt).

## Tests

- **Suite:** Schlüssel anlegen/prüfen/widerrufen; Route 401/200/404 (Host); Fenster (vergangen > 7
  Tage fehlt, abgesagt bleibt); `routing.test.ts` für beide Abruf-Pfade; Audit-Trigger.
- **Lifeline:** Parser (gültig, fehlendes Feld, zu lang, `fassung` 2, `ende <= beginn`);
  Übernahme (neu, unverändert = 0 Schreibvorgänge, geändert, verschwunden → `entfernt`);
  Art gegen einen lokalen Testserver (wie die Tests der Suchlage-Art) inkl. 401 → `Abgelehnt`;
  Aufbewahrung.

## Lieferung

Zwei PRs, in dieser Reihenfolge, jeder für sich lauffähig:

1. `iuk-suite`: Abruf-Zugänge, Route, Verwaltung, Doku.
2. `lifeline-hub` (gegen `alpha`): Vertrag, Adapterart, Ablage, Doku.

## Offene Punkte für die Freigabe

1. Eigene Ablage `veranstaltung_extern` statt `alarmmeldung` (Empfehlung oben).
2. Fenster „Ende höchstens 7 Tage zurück“ und Aufbewahrung 14 Tage nach Ende.
3. Verschwundene Veranstaltung → Status `entfernt` (statt sie zu löschen).
