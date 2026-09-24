# Design

## Context

Den Anlass beschreibt `proposal.md`, das Verhalten legt `specs/kraefte-verpflegung/spec.md`
fest. Maßgeblich sind diese Befunde aus dem Bestand (Scope-Lauf vom 22.09.2026, nachgemessen
am 24.09.2026):

- **Es gibt keinen Code zu Verpflegung.** „Essensportion“ und „Sonderkost“ kommen weder in
  `src/` noch in `migrations/` vor. Der Entwurf (`neuentwurf.dc.html:787`) führt das Modul
  in `modulKraefte` zwischen Material und Ablösung und zeigt **keinen** Zähler. Mehr als die
  Beispielzeile „Verpflegung 250 EP je Schicht“ (`:800`, `:934`) steht dort nicht.
- **Eine einsatzweite Schicht gibt es nicht.** Die Schicht aus LFH-635 (`einsatz_abloesung`)
  hängt an einer Einheit. Deshalb bekommt Verpflegung eigene Zeitfenster.
- **Die Kopfzahl aus Betreuung ist fertig, wird aber noch nirgends gelesen.**
  `GET …/betreuung/belegung?zeitpunkt=` liefert `BelegungKopfzahl { zeitpunkt_at, summe,
  stellen_ohne_meldung, stellen[] }` (`src/betreuung/mod.rs:345-388`). Die Antwort
  `summe: 0, stellen: []` heißt „nichts gemeldet“. Ein Zeitpunkt in der Zukunft liefert den
  heutigen Stand. Gelesen wird über `EinsatzLesezugriff<Betreuung>`, ohne Modulzugang kommt
  403. Frontend: `ladeBelegungKopfzahl` und `einsatzKeys.betreuungKopfzahl` sind vorhanden.
- **Personalstärke:** `verdichte(personal, [], []).staerke.gesamt`
  (`kraefte/kraeftebild.ts:549`) zählt jede Personalzeile einmal. Die Zahl im Backend
  (`ist_kumuliert`) rechnet anders. Grundlage des Vorschlags ist `verdichte`, wie im Scoping
  festgelegt.
- **Nachforderung:** `nachforderung` hat keinen DB-CHECK auf den Enums. Der Status ist
  `angefordert | zugesagt | unterwegs | eingetroffen | abgelehnt`, `art` ist Freitext.
  `repo::gehoert_zu_einsatz` gibt es schon. Das Backend führt das Modul in
  `DEFERRED_MODULE`, im Frontend ist es als `nachforderungen` fertig. `NachforderungFormular`
  hat keine Vorbelegung, und `NachforderungenPage` liest keine Query-Parameter.
- **Zählerstände am 24.09.2026:**

  | Stelle | Stand |
  |---|---|
  | `MODUL_KEYS` | `[&str; 30]` |
  | `LiveEvent::ALLE` | 30 |
  | `statusFarben` `ALLE_MAPS` | 23 |
  | Migrationen auf `origin/alpha` | bis `0117` |

  Die S4-Zeile in `stab/sachgebiete.ts` ist mit drei Werkzeugen voll.

Als Vorlagen dienen `abloesung` (LFH-635; Extractor-Gates, Live-Ereignis, Codegen,
Schwärzung, Vertragskarte, Sammelbanner) und `betreuung` (LFH-639; append-only-Meldungen
mit weicher Rücknahme, Rücknahme mit roter Rückfrage).

## Goals / Non-Goals

**Goals:**
- Es gibt **eine** Rechenstelle für Deckung und Fehlmenge (Backend). Die zeitabhängige
  Einstufung ist ein zweiter Schritt und läuft nur im Frontend, weil nur die tickende Uhr
  dort sie braucht.
- Jede Schreiboperation läuft in einer `write_retry!`-Transaktion zusammen mit ihrem
  ETB-Eintrag.
- Das Verpflegungsmodul leakt keine Daten anderer Module: weder Nachforderungsangaben noch
  Personenbezug über die Sonderkost.

**Non-Goals:**
- Keine Kopplung an die Schichten aus LFH-635 und keine Serien von Zeitfenstern („jeden Tag
  drei Mahlzeiten“). Jedes Zeitfenster wird einzeln angelegt.
- Kein Bestand und kein Inventar: EP sind Verbrauch. `einsatz_material` bleibt unberührt.
- Kein automatischer Statuswechsel der Nachforderung durch eine Ausgabe. Teillieferungen und
  der Rückweg aus C8 sprechen dagegen.
- Kein Modulzähler, keine Marke im Überblick, kein Hinweis in der AlarmZentrale.
  Unterdeckung ist ein Zustand auf der Seite, kein Alarmereignis.
- Keine Offline-Queue in v1 (Folgeticket LFH-688).
- Keine Bearbeitung einer Ausgabe. Eine Korrektur heißt zurücknehmen und neu erfassen.

## Decisions

### D1 — Datenmodell: zwei Tabellen

```
verpflegung_zeitfenster(
  id, einsatz_id → einsatz CASCADE,
  bezeichnung TEXT NOT NULL,
  von_at TEXT NOT NULL, bis_at TEXT NOT NULL,
  bedarf_kraefte, bedarf_betreute, bedarf_weitere  INTEGER NOT NULL CHECK (>= 0),
  sk_vegetarisch, sk_vegan, sk_ohne_schwein,
  sk_diaet_allergenarm, sk_saeugling_kleinkind     INTEGER NOT NULL DEFAULT 0 CHECK (>= 0),
  CHECK (Σ sk_* <= bedarf_kraefte + bedarf_betreute + bedarf_weitere),
  angelegt_von_id → benutzer, angelegt_at, geaendert_at)
INDEX (einsatz_id, von_at)

verpflegung_ausgabe(
  id, einsatz_id → einsatz CASCADE,                -- redundant, für Scoping und Schwärzung
  zeitfenster_id → verpflegung_zeitfenster CASCADE,
  zeitpunkt_at TEXT NOT NULL, menge INTEGER NOT NULL CHECK (menge > 0),
  ort TEXT, bemerkung TEXT,
  sk_* (5 Spalten wie oben), CHECK (Σ sk_* <= menge),
  nachforderung_id → nachforderung SET NULL,
  zurueckgenommen_at TEXT, zurueckgenommen_von_id → benutzer,
  erfasst_von_id → benutzer, erfasst_at)
INDEX (zeitfenster_id)
```

- **`einsatz_id` steht redundant an der Ausgabe**, wie bei `betreuungsstelle_belegung`
  (Kommentar in `0117_betreuung.sql:11-13`). So entdeckt die Schwärzungs-Registry die Tabelle
  über den CASCADE auf `einsatz`, und Abfragen je Einsatz brauchen keinen Join.
- **Sonderkost als fünf feste Spalten**, nicht als Kindtabelle mit `kostform`-Enum. Grund: Der
  Satz ist fest (Entscheidung aus dem Scoping), die Teilmengenregel wird zu einem einzigen
  DB-CHECK, und die API trägt ein Struct `Sonderkost` mit fünf benannten Feldern. Damit ist die
  Menge der Kostformen im generierten Typ fest und exhaustiv. Eine sechste Kostform ist eine
  additive `ALTER TABLE`. Verworfen wurde eine Kindtabelle `(bezug, kostform, anzahl)`: Sie
  hätte einen polymorphen Bezug (Zeitfenster oder Ausgabe) und eine Aggregation über Zeilen
  gebraucht, nur um fünf Zahlen zu tragen.
- **Die Zeitregel `bis > von` wird im Handler geprüft (422), nicht als DB-CHECK.** Die
  Zeitpunkte sind `TEXT`, und ein Textvergleich stimmt nur bei gleich normalisiertem Format.
  Der Handler parst beide Werte ohnehin.
- **Die Teilmengen-CHECKs bleiben trotzdem in der DB.** Der Handler prüft vorab (422 mit
  eigener Meldung). Der CHECK ist das Netz: Ein vergessener Precheck landet über LFH-245 als
  422, nicht als stille Verletzung.
- **Freitext:** `bezeichnung` (Zeitfenster) bleibt, `ort` und `bemerkung` (Ausgabe) werden
  geschwärzt. Die Bezeichnung ist der Mahlzeitname („Mittag“), die Ausgabe dagegen kann eine
  Adresse oder einen Namen tragen.
- **Migrationsnummer:** vorläufig `0118`. Unmittelbar vor dem Merge wird sie mit
  `scripts/check-migrationen.sh` gegen `origin/alpha` geprüft und bei Bedarf mit
  `--umnummerieren` verschoben (LFH-658).

### D2 — Deckung wird im Backend gerechnet, die Einstufung im Frontend

Das Anzeige-DTO je Zeitfenster trägt:
- `bedarf { kraefte, betreute, weitere, gesamt, sonderkost }`
- `ausgegeben { gesamt, sonderkost }` über alle nicht zurückgenommenen Ausgaben
- `fehlmenge { gesamt, sonderkost }` mit je `max(0, bedarf − ausgegeben)`
- `ausgaben[]`, zurückgenommene mit `zurueckgenommen_at`

Gerechnet wird in Rust aus den geladenen Zeilen (`verpflegung/deckung.rs`, eine reine
Funktion mit Unit-Tests), nicht per SQL-Arithmetik.

Die **Einstufung** (`gedeckt | offen | unterdeckung`) hängt an „hat begonnen?“ und damit an
der Uhr. Sie steht als reine Funktion `deckungEinstufung(zf, jetzt)` in
`frontend/src/verpflegung/deckung.ts` und wird über `useJetzt(30_000)` neu bewertet. Das
Backend liefert **keine** Einstufung. Anders als bei der Ablösung (D5/D8 dort) gibt es hier
keinen Zähler und keine Marke, die eine zweite Rechenstelle bräuchten. Eine Einstufung im
DTO wäre zwischen zwei Abrufen veraltet und eine zweite Wahrheit.

Alle Wire-Zeitpunkte (`von_at`, `bis_at`, `zeitpunkt_at`) sind UTC ohne Zonenkennung. Das
Frontend liest sie ausschließlich über `dayjs.utc(s)`, wie `abloesung/einstufung.ts`, und
schreibt sie aus dem `RangePicker` ebenso als UTC zurück. `dayjs(s)` läse Ortszeit und
verschöbe still um den Zonenversatz. Das betrifft die Einstufung, die Trennung
„vergangen“, den Parameter `zeitpunkt` der Kopfzahl und die Dialogwerte.

Grenzfälle, die die Funktion gegen **absolute** Zeitpunkte testet, nicht als Round-Trip:
- genau `jetzt == von`: begonnen
- Fehlmenge nur in einer Kostform: nicht gedeckt
- Überdeckung: gedeckt

### D3 — Vertragskarte `verpflegungDeckung`

`theme/statusFarben.ts` bekommt die Karte `verpflegungDeckung`:

| Einstufung | Rolle | Wort |
|---|---|---|
| gedeckt | `normal` | „gedeckt“ |
| offen | `neutral` | „offen“ |
| unterdeckung | `alarm` | „Unterdeckung“ |

Der Pin `ALLE_MAPS` steigt von 23 auf 24. Das ist eine Vertragsänderung, die hier begründet
wird. `StatusTag` und `StatusZelle` brauchen eine `StatusDarstellung`, und eine Karte außerhalb
der Datei verbietet `statusVertrag.guard.test.ts`. Präzedenz ist `abloesungEinstufung`
(LFH-635). Verworfen wurde die Alternative aus dem Scoping-Kommentar („Funktion auf
bestehende Rollen“): Sie hätte Wort und Rolle an zwei Stellen gehalten, und der
Abdeckungswächter hätte sie nicht gesehen.

### D4 — API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/einsaetze/{id}/verpflegung` | `{ zeitfenster[] }` nach `von_at`, jedes mit Deckung und Ausgaben |
| POST | `…/verpflegung/zeitfenster` | `{bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, bedarf_weitere?, sonderkost?}` |
| PATCH | `…/verpflegung/zeitfenster/{zid}` | Teiländerung derselben Felder. Geprüft wird gegen den **Effektivzustand** (Bestand + Patch), sonst unterläuft eine Teiländerung die Teilmengenregel (Memory `patch-xor-effektivzustand`). |
| DELETE | `…/verpflegung/zeitfenster/{zid}` | Löschen; 422, solange eine gültige Ausgabe existiert |
| POST | `…/verpflegung/zeitfenster/{zid}/ausgaben` | `{zeitpunkt_at?, menge, ort?, sonderkost?, nachforderung_id?, bemerkung?}` |
| POST | `…/verpflegung/ausgaben/{aid}/zuruecknehmen` | Rücknahme; 422, wenn schon zurückgenommen |

**Statuscodes nach der Konvention:**

| Code | Fälle |
|---|---|
| 400 | leere Bezeichnung, fehlendes Pflichtfeld, negativer Bedarfsteil, negative Kostform, Menge ≤ 0, unlesbarer Zeitpunkt |
| 422 | `bis ≤ von`, Sonderkost übersteigt die Menge, Löschen mit Ausgaben, zweite Rücknahme |
| 404 | fremdes Zeitfenster, fremde Ausgabe, fremde Nachforderung (`nachforderung::repo::gehoert_zu_einsatz`) |

Gates laufen über `EinsatzLesezugriff<Verpflegung>` und `EinsatzSchreibzugriff<Verpflegung>`,
Bodies über `JsonBody`, Sub-IDs über `PfadParam`. `PFAD_KEY` ist
`("/api/einsaetze/{id}/verpflegung", Some("verpflegung"))`.

**Das DTO der Ausgabe trägt von der Nachforderung nur `nachforderung_id`** und nichts
Hineingejointes. Sonst läse jemand mit Zugriff auf Verpflegung, aber ohne Zugriff auf
Nachforderungen, deren Bezeichnung und Status. Den Namen löst die Oberfläche selbst auf, aus
der Nachforderungsliste und nur, wenn das Modul sichtbar ist. Ohne Zugang zeigt sie
„Nachforderung #n“.

**Einsatz aktiv:** wie bei Ablösung und Betreuung nur über den Extractor
(`EinsatzSchreibzugriff` → `fordere_aktiv`), **nicht** über `fordere_aktiv_in_tx`. Diese
Funktion ist privat in `stab/repo.rs`. Sie schließt ein Zeitfenster von wenigen
Millisekunden zwischen Prüfung und Commit beim Einsatzabschluss. Keines der beiden jüngeren
Module nimmt sie, und eine öffentliche Kopie nur für Verpflegung wäre eine dritte Bauform.
Ein späterer Querschnitts-Nachzug kann sie für alle drei heben. Ein abgeschlossener Einsatz
antwortet deshalb wie überall mit **409** (`berechtigung::fordere_aktiv` → `Conflict`).

### D5 — ETB

| Anlass | Weg | Wortlaut (Beispiel) |
|---|---|---|
| Zeitfenster angelegt | `system_audit_tx` | „Verpflegung ‚Mittag' 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte, 70 Betreute), davon 15 Sonderkost.“ |
| Zeitfenster geändert | `system_audit_tx` | „Verpflegung ‚Mittag' 24.09. 12:00–13:30 geändert: Bedarf 270 EP (vorher 250).“ Nennt nur, was sich geändert hat. |
| Zeitfenster gelöscht | `system_audit_tx` | „Verpflegung ‚Mittag' 24.09. 12:00–13:30 gelöscht.“ |
| Ausgabe erfasst oder zurückgenommen | — | kein Eintrag (Entscheidung des Auftraggebers, 24.09.2026) |

- **Uhrzeiten im ETB-Text stehen in der Zeitzone der Organisation.** Der Server rechnet
  sonst in UTC, und eine beweissichernde Unterlage nennte still die falsche Uhrzeit. Die
  Ablösung umgeht das, indem ihre ETB-Texte gar keine Uhrzeit nennen. Für Verpflegung reicht
  das nicht: „Mittag“ gibt es an jedem Einsatztag, und erst Datum und Zeitraum machen den
  Eintrag eindeutig. Die Zone kommt aus `org_einstellungen.zeitzone`, bei fehlendem oder
  ungültigem Wert gilt `einsatz::nummer::ZEITZONE_VORGABE` (Europe/Berlin), derselbe Weg wie
  `jahr_in_zone`. Sie wird vor der Transaktion geladen. Formatiert wird
  `TT.MM. HH:MM–HH:MM`, bei einem Zeitraum über Mitternacht mit beiden Daten. Eine reine
  Funktion `zeitraum_text(von, bis, tz)` trägt Tests beidseits der Sommerzeitgrenze
  (29.03. und 25.10.) gegen absolute Zeitpunkte.
- Der `startwert` wird vor der Transaktion geladen, wie in `abloesung/repo.rs:413`.
- Die Route publiziert nach dem Commit zuerst das ETB-Ereignis, dann `verpflegung`.
- Ein PATCH, der nichts ändert (Wertgleichheit), schreibt weder Eintrag noch Ereignis.

### D6 — Live-Ereignis

- `LiveEvent::Verpflegung` mit Wire-Wert `verpflegung` und Gate `&["verpflegung"]`, gepinnt
  in `gate_mengen_sind_gepinnt`. Damit steigt `ALLE` von 30 auf 31.
- Nutzlast `{einsatz_id}`.
- Frontend: `EINSATZ_KEYS.verpflegung = 'einsatz-verpflegung'` und
  `EINSATZ_STREAM_EVENTS.verpflegung = [EINSATZ_KEYS.verpflegung]`, im **selben Commit** wie
  die Backend-Variante. Sonst bricht `liveEvent.contract.test.ts` den Typcheck.
- Ein Fan-out von `nachforderung` auf die Verpflegung ist nicht nötig, weil das DTO keine
  Nachforderungsdaten trägt. Die aufgelösten Namen hängen an der Nachforderungs-Query und
  werden von deren Ereignis aufgefrischt.

### D7 — Seite

Die Seite läuft auf der Route `/einsaetze/:einsatzId/verpflegung` und ist aus `EinsatzSeite`
gebaut.

**Kopf**
- Titel „Verpflegung“.
- Meta Mono: „n Zeitfenster · m mit Unterdeckung“.
- Primäraktion „Zeitfenster anlegen“.

**Form: Liste, keine Tabelle.** Die Frage lautet „was ist mit diesem Zeitfenster?“, und die
Ordnung ist die Zeit. Dafür steht `Segmentleiste` mit zwei Ansichten: „laufend & anstehend“
(`bis ≥ jetzt`, Vorgabe) und „vergangen“.

**Karte je Zeitfenster** (`verpflegung/ZeitfensterKarte.tsx`)
- Kopfzeile: Bezeichnung und Zeitraum, Zeitraum in Mono.
- Die Deckung als `StatusTag` aus `verpflegungDeckung`.
- Am linken Rand die Farbe der Einstufung. Nach C8 trägt der Rand EINE Farbe, bei
  Unterdeckung `alarm`.
- Kennzahlzeile „Bedarf · ausgegeben · fehlt“ aus den `Kennzahl`-Bausteinen. Die Fehlmenge
  bekommt den Ton der Einstufung, der Text läuft über `alarmText`.
- Aufgliederung des Bedarfs (Kräfte / Betreute / weitere).
- Sonderkost nur mit belegten Kostformen: Kostform · Bedarf · ausgegeben · fehlt.
- Ausgaben als `Zeitachseneintrag`-Zeilen: Zeit · Menge EP · Ort · Nachforderungsverweis.
  Zurückgenommene stehen durchgestrichen mit dem Wort „zurückgenommen“; das Wort ist der
  zweite Kanal.

**Aktionen**
- **Primäraktion je Karte** ist „Ausgabe erfassen“.
- Die übrigen Aktionen sind nach LFH-365 in einem `Dropdown` gebündelt, sobald es nach der
  Rechteprüfung drei oder mehr sind: „Bedarf bearbeiten“, „Nachfordern“ (nur bei Fehlmenge und
  sichtbarem Modul Nachforderungen), „Löschen“ (rot, hinter dem Trenner, Rückfrage mit
  `danger`, nur ohne gültige Ausgabe).
- „Zurücknehmen“ hängt an der einzelnen Ausgabenzeile, mit roter Rückfrage in einem `Modal`
  wie bei Betreuung.

**Dialoge** (`verpflegung/VerpflegungDialoge.tsx`, alle auf `ErfassungsModal`)
- **Zeitfenster anlegen und bearbeiten.**
  - Sichtbar: Bezeichnung, Zeitraum (`RangePicker`, ein Feld), Einsatzkräfte, Betreute.
  - Eingeklappt (`forceRender`): weitere Personen und die fünf Kostformen.
  - Mit vier sichtbaren Feldern liegt der Dialog bewusst eins über dem Modal-Richtwert von etwa
    drei. Die zwei Bedarfsteile tragen je einen Vorschlag mit Herkunft, und eingeklappt wären
    genau diese Vorschläge unsichtbar. Das Feldbudget wird im Test mit der Probe „Aufklappen →
    Zahl steigt“ gepinnt.
- **Ausgabe erfassen.**
  - Sichtbar: Menge, Ort, Zeitpunkt (Vorgabe jetzt).
  - Eingeklappt: Sonderkost, Nachforderung (Select, nur bei sichtbarem Modul), Bemerkung.
- **Nach „Ausgabe erfassen“** zeigt die Seite `zeigeRueckgaengig`, verdrahtet mit der
  Rücknahme. Einen serverseitigen Rückweg gibt es, deshalb fragt der Toast nicht zurück
  (LFH-343).

**Ohne Schreibrecht und bei Neuzugängen**
- Ohne Schreibrecht zeigt die Seite einen `RechteHinweis` und die Primäraktion gesperrt. Die
  Kartenaktionen und die Rücknahme entfallen (C11, zwei Zuschnitte).
- Fremde neue Zeitfenster erscheinen über ein `Sammelbanner` („n neue Zeitfenster“) nach dem
  Muster der Ablösung (LFH-647). Geänderte Mengen an bestehenden Karten fließen direkt ein. Sie
  verschieben die Ordnung nicht, weil die an `von_at` hängt.

### D8 — Bedarfsvorschläge

Die Vorschläge baut ein reiner Hook `useBedarfsvorschlag(einsatzId, vonAt)`.

**Einsatzkräfte**
- Grundlage ist `verdichte(personal, [], []).staerke.gesamt`.
- Die Query läuft nur, wenn das Modul `personal` bedienbar ist.
- Eine leere Liste ergibt keinen Vorschlag.
- Beschriftung: „Vorschlag: Personal im Einsatz, Stand HH:MM“.

**Betreute**
- Grundlage ist `ladeBelegungKopfzahl(einsatzId, vonAt)`.
- Die Query läuft nur, wenn das Modul `betreuung` bedienbar ist.
- `stellen.length === 0` ergibt keinen Vorschlag, mit dem Hinweis „keine Belegung gemeldet“.
- `stellen_ohne_meldung > 0` ergibt „Untergrenze, n Stellen ohne Meldung“.
- Liegt `vonAt` nach jetzt, heißt der Hinweis „Stand jetzt, nicht zum Beginn“.

**„Bedienbar“ heißt sichtbar und nicht per Rolle gesperrt.** Maßgeblich ist die Freigabe-Prüfung
aus `modulRegistry.ts`, die `istModulSichtbar` und `istModulGesperrt` bündelt.
`istModulSichtbar` allein reicht nicht, denn der Server antwortet auch bei einer
Rollensperre mit 403. Kommt trotzdem ein 403, etwa weil sich ein Override während der
Sitzung ändert, gilt die Quelle als leer: keine Fehleranzeige, `retry: false`, kein
Vorschlag. Ein Hook-Test lässt die Quelle 403 liefern. Dieselbe Regel gilt für die
Nachforderungsliste, also für die Namensauflösung an der Ausgabe und für das Select im
Ausgabe-Dialog.

**Wann vorbelegt wird**
- Nur beim **Anlegen**.
- Beim **Bearbeiten** steht der Vorschlag als Hinweis neben dem Feld, ohne zu überschreiben.
- Ändert jemand im Anlege-Dialog den Beginn, zieht der Betreuungsvorschlag nach, solange die
  Person das Feld Betreute nicht angefasst hat (eigener Merker, kein `isFieldTouched`).

### D9 — Nachfordern per Deeplink

- `routing/deeplinks.ts` bekommt `nachforderungenPfad(eid, { vorbelegung? })`. Das erzeugt
  `?neu=1&art=…&bezeichnung=…&anzahl=…&begruendung=…`.
- `parseNachforderungVorbelegung` verwirft unbrauchbare Werte **ganz**, nicht halb. Muster
  ist `parsePlatzierenAuftrag`.
- `NachforderungenPage` liest das beim Mount, öffnet `NachforderungFormular` mit der Prop
  `vorbelegung` und **räumt die Parameter** (apply-then-clean). Ein stehengebliebener Auftrag
  öffnete das Formular sonst bei jedem Neuladen.
- Die Vorbelegung aus der Verpflegung:

  | Feld | Wert |
  |---|---|
  | Art | „Verpflegung“ |
  | Bezeichnung | „Essensportionen ‚Mittag' 12:00–13:30“ |
  | Anzahl | die Fehlmenge |
  | Begründung | „Unterdeckung Verpflegung ‚Mittag': Bedarf 250, ausgegeben 230.“ |

- Keine Personenangaben in der URL: Die Werte sind Mahlzeitname und Zahlen.

### D10 — Registry, Stab, Schwärzung

- **Registry:** `modulRegistry.ts` bekommt `key: 'verpflegung'`, Kategorie `kraefte`,
  zwischen `material` und `abloesung`, Status `fertig`, ohne `zaehlerQuelle`.
  `sprungmarken.test.ts` pinnt die Reihenfolge. Die Icon-Wahl stammt aus `react-icons/tb`
  wie bei den Nachbarn.
- **Backend-Schlüssel:** `MODUL_KEYS` wächst von 30 auf 31, nach `material`. Dazu kommen
  `modul_marker! Verpflegung => "verpflegung"` und `MODUL_GET_PFADE` in
  `tests/modul_override.rs`.
- **Stab:** `stab/sachgebiete.ts` S4 bekommt `['nachforderungen', 'verpflegung',
  'material']`. `e2e/gate3-trefflaeche.spec.ts` zählt Werkzeug-Knöpfe auf der Stabsseite;
  die Zahl bleibt gleich, weil ein Werkzeug gegen eines getauscht wird. Das wird geprüft,
  nicht angenommen.
- **Schwärzung:** `TabellenRegel`s für beide Tabellen. `ort` und `bemerkung` bekommen
  `scrub` → NULL, alle übrigen Spalten `retain`. `nachforderung_id` ist als FK geführt.

## Risks / Trade-offs

- **[Gespeicherter Bedarf veraltet]** → Der Bedarf eines künftigen Zeitfensters bleibt bei
  Kräftezuwachs stehen. Das ist gewollt: Ein live gerechneter Bedarf würde die Unterdeckung
  vergangener Zeitfenster still verschieben. Dispositionen werden hart gelöscht, eine
  Historie gibt es nicht. Gemildert wird das dadurch, dass der Bearbeiten-Dialog den
  aktuellen Vorschlag als Hinweis neben dem gespeicherten Wert zeigt.
- **[Vorschlag Einsatzkräfte ≠ Backend-Stärke]** → `verdichte` zählt jede Personalzeile,
  die Backend-Stärke rechnet anders. Die Beschriftung nennt die Quelle („Personal im
  Einsatz“), und die Zahl ist überschreibbar.
- **[Sonderkost-Unterdeckung ohne Gesamt-Unterdeckung]** → Das Wort „Unterdeckung“ steht
  dann bei einem Zeitfenster, dessen Gesamtzahl gedeckt aussieht. Die Sonderkost-Zeile nennt
  deshalb die fehlende Kostform ausdrücklich („fehlt 3 vegan“), und der Test deckt den Fall ab.
- **[Nachforderung gelöscht]** → Das FK steht auf `SET NULL`, die Ausgabe bleibt ohne Verweis.
  Nachforderungen werden heute ohnehin nicht gelöscht.
- **[Migrationsnummer kollidiert]** → Parallelarbeit ist wahrscheinlich. Die Nummer wird vor
  dem Merge geprüft (D1), und der Required Check „Migrationsnummern“ fängt den Rest.
- **[Modal-Feldbudget 4]** → begründet in D7, gepinnt im Test.

## Migration Plan

Die Migration ist additiv und übernimmt keine Daten. Rollback: Ohne angelegte Zeitfenster
gibt es kein Verhalten. Eine Down-Migration führt das Projekt nicht. Nach dem Deployment ist
das Modul sofort sichtbar (Status `fertig`) und lässt sich je Einsatz über die
Moduleinstellungen ausblenden. Die S4-Zeile im Stab zeigt ab dann Verpflegung statt
Fahrzeuge.

## Open Questions

- Die Icon-Wahl für das Modul (`react-icons/tb`, z. B. `TbToolsKitchen2`) wird beim
  Umsetzen am Bestand der Rail-Ikonen entschieden. Spec, Ansatz und Aufgabenschnitt bleiben
  davon unberührt.
