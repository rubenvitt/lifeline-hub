# Design

## Context

Den Anlass beschreibt `proposal.md`, das Verhalten legt
`specs/betreuung-evakuierung/spec.md` fest. Maßgeblich sind die Befunde aus dem Scope-Lauf
vom 23.09.2026 und die Entscheidungen des Auftraggebers (Kommentar an LFH-639 vom selben
Tag):

- **Es gibt kein Betreuungskonzept im Bestand.** `PersonStatus` hat kein `evakuiert` (CHECK
  in `0020`, `einsatz_person` ist keine Blatttabelle). `person_verbleib.art` kennt seit
  LFH-613 (`0112`) den Wert `notunterkunft`, aber nur mit Freitext-`ziel`. Der Einsatzkopf
  steht in `NICHT_LIVE_KEYS`, und ein PATCH darauf schreibt keinen ETB-Eintrag.
- **Die UHS ist sanitätsdienstlich und personenbezogen** (`uhs_platz`, `person_uhs_belegung`
  je Person). LFH-613 hat entschieden, dass die Notunterkunft den UHS-Aufenthalt *beendet*.
  Eine Betreuungsstelle ist deshalb keine UHS.
- **Fachsprache** (IMK-Rahmenempfehlung Evakuierungsplanung, BW-Fassung 2023, Kap. 6;
  DRK-Glossar Betreuungsdienst 2024): Evakuierungsbezirk mit Bevölkerungszahl und
  Sammelstelle. Die Einrichtungsstufen sind Anlaufstelle, Betreuungsstelle,
  Betreuungsplatz (BTP 500) und Notunterkunft. Die Kapazität ist eine Personenzahl. Gezählt
  wird dort, wo Menschen durch eine Tür kommen. Wie viele insgesamt evakuiert sind, bleibt
  Meldung oder Schätzung. Die Registrierung Einzelner ist ein eigener Strang
  (Personenauskunft) und gehört nicht hierher.
- **Referenz ist das Fachmodul Ablösung** (LFH-635, `src/abloesung/`, `src/routes/abloesung.rs`),
  zusammen mit den Berührpunkten von LFH-632 (Dokumente). Aktueller Bestand: `MODUL_KEYS`
  steht bei 28, `LiveEvent::ALLE` bei 29, `ALLE_MAPS` bei 20, höchste Migration ist `0116`.

## Goals / Non-Goals

**Goals:**
- Stand, Plangröße und Belegung sind **Mengen mit Zeitbezug**. Jede Änderung liegt als
  Zeile vor und ist im ETB nachgewiesen.
- Eine Quelle (`GET …/betreuung`) trägt Modulseite, Modulzähler und die künftige
  Dashboard-Kennzahl. Die Kopfzahl für die Verpflegung hat einen eigenen, schmalen
  Lese-Endpunkt.
- Keine Änderung an Bestandstabellen, keine Rebuild-Migration.

**Non-Goals:**
- **Keine Dashboard-Zelle.** Platz und Einbau übernehmen LFH-640 und LFH-607. LFH-639 stellt
  nur die Lückenvermerke richtig („Quelle seit LFH-639, Platz LFH-640, Einbau LFH-607“).
- **Keine Lagekarte:** keine Koordinaten an Stellen, kein Bezirk als Fläche, kein
  `?platzieren=`. Die Tabellen sind so geschnitten, dass `lat`/`lon` bzw. `lage_zone_id`
  später per `ADD COLUMN` dazukommen.
- **Keine Personenverknüpfung:** kein FK `person_verbleib.betreuungsstelle_id`. Einzeln
  erfasste Betroffene und Evakuierte sind laut Auftraggeber getrennte Mengen und werden
  nie gegeneinander verrechnet.
- **Keine Offline-Erfassung** und damit auch keine `client_id`-Spalte. Eine Spalte ohne
  Queue wäre ein Vertrag, den kein Test prüfen kann. Der Nachzug fügt sie per
  `ADD COLUMN` mit partiellem UNIQUE hinzu.
- Keine Verlaufsansicht der Meldereihen, keine Zuordnung Bezirk → aufnehmende Stelle, keine
  Verbleibenden als eigene Menge, kein Alarm „Stelle voll“, keine Schnellaktion in der
  Kommandopalette.
- Keine aus Faustwerten errechneten Zahlen (Transportbedarf, Aufnahmeschlüssel), kein Feld
  „Selbstunterbringer“ (kein Normbegriff, im Einsatz unbekannt).

## Decisions

### D1 — Datenmodell: vier Tabellen, zwei Objekte mit je einer Meldereihe

```
evakuierungsbezirk(
  id, einsatz_id → einsatz CASCADE,
  abschnitt_id → einsatzabschnitt SET NULL,
  bezeichnung TEXT NOT NULL,
  plan_personen INTEGER NOT NULL CHECK (plan_personen >= 1),
  plan_erhebung TEXT NOT NULL CHECK IN ('gezaehlt','geschaetzt'),
  raeumung TEXT NOT NULL DEFAULT 'angeordnet' CHECK IN ('angeordnet','laeuft','geraeumt','aufgehoben'),
  sammelstelle TEXT, notiz TEXT,
  stand_id → evakuierung_stand SET NULL,          -- Cache: aktuelle Meldung
  storniert_at, storniert_von_id,
  angelegt_at, angelegt_von_id, geaendert_at)
UNIQUE INDEX (einsatz_id, bezeichnung) WHERE storniert_at IS NULL

evakuierung_stand(                                  -- append-only
  id, bezirk_id → evakuierungsbezirk CASCADE,
  einsatz_id → einsatz CASCADE,                     -- für Registry-Entdeckung und Scope
  evakuiert INTEGER NOT NULL CHECK (evakuiert >= 0),
  erhebung TEXT NOT NULL CHECK IN ('gezaehlt','geschaetzt'),
  zeitpunkt_at TEXT NOT NULL,
  erfasst_at, erfasst_von_id,
  etb_eintrag_id → etb_eintrag,
  zurueckgenommen_at, zurueckgenommen_von_id)
INDEX (bezirk_id, zeitpunkt_at)

betreuungsstelle(
  id, einsatz_id, abschnitt_id, bezeichnung, art CHECK IN ('anlaufstelle','betreuungsstelle','betreuungsplatz','notunterkunft'),
  kapazitaet_personen INTEGER CHECK (kapazitaet_personen IS NULL OR kapazitaet_personen >= 1),
  status TEXT NOT NULL DEFAULT 'vorbereitet' CHECK IN ('vorbereitet','in_betrieb','geschlossen'),
  standort TEXT, notiz TEXT,
  belegung_id → betreuungsstelle_belegung SET NULL, -- Cache
  storniert_at, storniert_von_id, angelegt_at, angelegt_von_id, geaendert_at)
UNIQUE INDEX (einsatz_id, bezeichnung) WHERE storniert_at IS NULL

betreuungsstelle_belegung(                          -- append-only, Rumpf wie evakuierung_stand
  id, stelle_id, einsatz_id, belegt INTEGER NOT NULL CHECK (belegt >= 0),
  zeitpunkt_at, erfasst_at, erfasst_von_id, etb_eintrag_id, zurueckgenommen_at, zurueckgenommen_von_id)
```

- **Der Cache ist ein Zeiger (`stand_id`/`belegung_id`), keine kopierte Zahl.** Die
  Listenabfrage joint die Zeile. So gibt es genau eine Zahl je Meldung, und eine Rücknahme
  muss nur den Zeiger neu setzen. Der Zeiger wird ausschließlich in `repo` geschrieben, in
  derselben Transaktion wie die Meldung bzw. Rücknahme. Neu bestimmt wird er immer über
  dieselbe Abfrage („nicht zurückgenommen, `ORDER BY zeitpunkt_at DESC, id DESC LIMIT 1`“).
  Diese Abfrage ist die einzige Stelle, die „aktuell“ definiert.
- **`einsatz_id` an den Meldetabellen** ist redundant zu `bezirk_id → einsatz_id`, weil die
  Schwärzungs-Registry einsatzbezogene Tabellen über `einsatz_id` + CASCADE entdeckt
  (`entdeckte_tabellen_gleich_registry_tabellen`). Die Kopfzahl-Abfrage filtert direkt
  darüber.
- **Verworfen:** eine Zählerspalte mit Delta-Updates. Im Repo gibt es kein Muster für
  atomare Inkremente, ein ETB-Satz „+212“ ist ohne Rechnen nicht prüfbar, und eine spätere
  Offline-Queue zählte bei einem Replay doppelt. Ebenfalls verworfen: die Plangröße als
  Spalte an `einsatz` oder `einsatzabschnitt`. Den losen Zähler hat der Auftraggeber
  abgelehnt, der Einsatzkopf ist NICHT_LIVE, und der Entwurf hat zwei Bezirke im selben
  Abschnitt.

### D2 — „Aktuell“ heißt jüngster Zeitpunkt, nicht jüngste Erfassung

Eine nachgetragene Meldung („Nr. 405 … nachgetragen um 13:31“ im Entwurf) darf den Stand
nicht zurückdrehen. Der aktuelle Stand ist deshalb die nicht zurückgenommene Meldung mit dem
größten `zeitpunkt_at`, bei Gleichstand die größere `id`. Die Nachtragung landet trotzdem
im ETB, mit `ereigniszeit = zeitpunkt_at`. Ein Zeitpunkt in der Zukunft (mehr als 60 s
Toleranz für Uhrenversatz) ist **400**, weil das Feld für sich unbrauchbar ist. Geparst
wird mit demselben `zeit()`-Helfer wie in `routes/abloesung.rs`.

**Der Draht trägt UTC ohne Zonenkennung** (`YYYY-MM-DD HH:mm:ss`). Das Frontend schreibt
über `alsBackendZeit` und liest über dessen Umkehr aus `etb/filterZeit.ts`, nie über
`dayjs(s)`. Sonst ergibt eine als UTC gelesene Ortszeit entweder ein 400 für „jetzt“
(Sommer: zwei Stunden in der Zukunft) oder eine stille Verschiebung der Stand-Zeit um den
Zonenversatz. Beide Richtungen sind in `filterZeit.test.ts` beidseits der
Sommerzeitgrenzen belegt. Die Dialoge bekommen einen eigenen Test, der den gesendeten
Wire-Wert gegen den absoluten Zeitpunkt prüft.

### D3 — Nebenläufigkeit ohne CAS, deshalb nur eine 409-Quelle

Zwei Personen, die gleichzeitig eine absolute Zahl melden, verlieren nichts: Jede Meldung
ist eine eigene Zeile und ein eigener ETB-Eintrag, „aktuell“ entscheidet der Zeitpunkt
(D2). Ein Read-Modify-Write gibt es nicht, weil niemand aus dem angezeigten Wert rechnet.
Das Modul führt deshalb **kein** `basis_geaendert_at` ein. Serialisiert wird über
`write_retry!` (BEGIN IMMEDIATE). Auch PATCH an Bezirk und Stelle bleibt ohne CAS: beide
Schreibvorgänge stehen im ETB, der zweite gewinnt. Das entspricht der Ablösung.

Damit hat **409 in diesem Modul genau eine Quelle: den Lebenszyklus**. Dazu zählen
Aktionen an einem stornierten Bezirk oder einer stornierten Stelle (Präzedenz
`uhs/repo.rs`: „UHS ist bereits storniert“ → 409) und die doppelte Bezeichnung über das
UNIQUE-Sicherheitsnetz. Einen Überschreiben-Dialog gibt es nicht, eine Schleife wie in
LFH-299/300 kann also nicht entstehen. **422** steht für einen umkehrbaren Zustand, der die
Aktion verbietet: eine Stelle mit Belegung > 0 schließen, eine geschlossene Stelle
belegen oder an ihr eine Belegung zurücknehmen (sonst entstünde „geschlossen und belegt“), eine bereits zurückgenommene Meldung erneut zurücknehmen (Präzedenz
`abloesung/repo.rs`: Rücknahme ohne Vollzug → 422). „Geschlossen“ ist nach D4 umkehrbar
und damit kein Lebensende. **400** gilt für das Feld allein: Anzahl < 0, Plangröße < 1,
Kapazität < 1, leere Bezeichnung, unbekannter Enum-Wert, Zeitpunkt unlesbar oder in der
Zukunft. Diese Einordnung steht mit Verweis auf `src/error.rs` und CLAUDE.md
(„Statuscode-Konvention“) im Handler-Kommentar.

**Verworfen:** CAS über `basis_stand_id` (so noch in der Scope-Synthese). Der Konflikt
schützt nichts, was D2 nicht schon ordnet. Er hätte aber eine zweite 409-Quelle auf
dieselbe Route gelegt, genau die Lage, vor der CLAUDE.md warnt.

### D4 — Schließen verlangt Belegung 0, statt sie zu erfinden

Eine geschlossene Stelle darf in der Kopfzahl nach ihrem Schließzeitpunkt nicht mehr
mitzählen. Ein automatisch geschriebenes „0“ wäre eine Zahl, die niemand gemeldet hat.
Deshalb gilt: `geschlossen` nur bei aktueller Belegung 0 oder ohne jede Meldung, sonst
**422**. Die Oberfläche bietet beim Schließen einer belegten Stelle im selben Dialog die
Leermeldung an (erst Belegung 0, dann schließen). Das sind zwei Aufrufe, aber zwei
ehrliche Tatsachen. Ein wieder geöffneter Status (`geschlossen → in_betrieb`) ist erlaubt,
weil der Zustand umkehrbar ist und der Rückweg existiert. Eine Rückfrage braucht er
deshalb nicht.

### D5 — ETB-Kopplung Muster B

Alles in **einem** `write_retry!` über `etb::repo::anlegen_tx` bzw. `etb::system_audit_tx`.
Den `startwert` lädt der Handler vor der Transaktion. Nach dem Commit laufen
`live.publiziere(einsatz_id, etb_id)` und `publiziere_event(LiveEvent::Betreuung, {einsatz_id,
bezirk_id | stelle_id})`.

| Vorgang | ETB-Typ | Text (Muster) |
|---|---|---|
| Bezirk anlegen | `entscheidung` | „Evakuierung Bezirk ‚X' angeordnet, Plangröße 640 (geschätzt).“ |
| Plangröße/Erhebung ändern | `entscheidung` | „Plangröße Bezirk ‚X' auf 820 (gezählt) gesetzt, vorher 640 (geschätzt).“ |
| Räumung → angeordnet/aufgehoben | `entscheidung` | „Evakuierung Bezirk ‚X' aufgehoben.“ |
| Räumung → läuft/geräumt | `meldung` | „Bezirk ‚X' geräumt.“ |
| Standmeldung | `meldung` | „Bezirk ‚X': 480 evakuiert (gezählt), vorher 212, Plan 640.“ |
| Belegungsmeldung | `meldung` | „Betreuungsstelle ‚Y': 89 untergebracht, vorher 60, Kapazität 150.“ |
| Stelle anlegen/ändern/Status/Storno, Bezirk Storno/Stammdaten | `system` | „Betreuungsstelle ‚Y' (Notunterkunft) angelegt.“ |
| Rücknahme einer Meldung | `berichtigung` + `berichtigt_eintrag_id` | „Meldung zurückgenommen, Stand Bezirk ‚X' wieder 212.“ |

- **Leerlauf-Riegel:** Ein PATCH ohne tatsächliche Änderung schreibt nichts. Das ist dieselbe
  Bauform wie in `abloesung/repo.rs`. Eine Standmeldung mit derselben Zahl wie der Vorwert
  ist dagegen **keine** Leermeldung: Sie bestätigt den Stand zu einem neuen Zeitpunkt und
  wird geschrieben.
- **ETB-Texte tragen nur Bezeichnung und Zahlen**, nie Sammelstelle, Standort oder Notiz:
  `etb_eintrag.inhalt` bleibt beim Schwärzen erhalten, der Scrub am Quellobjekt liefe sonst
  ins Leere. Die Bezeichnung steht trotzdem darin. Das ist die Präzedenz von Abschnitt und
  UHS, und die Bezeichnung ist der operative Name. Das Risiko steht unter „Risks“.
- Die Meldezeile speichert `etb_eintrag_id` (einseitiger Bezug wie `etb_vollzug_id` der
  Ablösung). Eine Rückverweis-Spalte am ETB entsteht nicht (LFH-635 D6).

### D6 — Routen und Gates

Alle Routen hängen an `EinsatzLesezugriff<Betreuung>` bzw. `EinsatzSchreibzugriff<Betreuung>`.
Sub-IDs kommen über `PfadParam`, Bodies über `JsonBody`.

```
GET    /api/einsaetze/{id}/betreuung                         → { bezirke[], stellen[] } mit aktuellem Stand/Belegung
POST   /api/einsaetze/{id}/betreuung/bezirke
PATCH  /api/einsaetze/{id}/betreuung/bezirke/{bid}
POST   /api/einsaetze/{id}/betreuung/bezirke/{bid}/stornieren
POST   /api/einsaetze/{id}/betreuung/bezirke/{bid}/staende
POST   /api/einsaetze/{id}/betreuung/staende/{sid}/zuruecknehmen
POST   /api/einsaetze/{id}/betreuung/stellen
PATCH  /api/einsaetze/{id}/betreuung/stellen/{sid}
POST   /api/einsaetze/{id}/betreuung/stellen/{sid}/stornieren
POST   /api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen
POST   /api/einsaetze/{id}/betreuung/belegungen/{mid}/zuruecknehmen
GET    /api/einsaetze/{id}/betreuung/belegung?zeitpunkt=     → Kopfzahl „in Betreuung“ (LFH-634)
```

- **Kein modulloser Kennzahl-Endpunkt** wie beim Pegel. Die Kennzahl leitet sich aus dem
  gegateten GET ab. Eine leere Gate-Menge ist Kontroll-Events vorbehalten, und ein Leser ohne
  Modul bekäme keinen Refresh.
- Die Anzeige-DTOs (`EvakuierungsbezirkAnzeige`, `BetreuungsstelleAnzeige`,
  `BetreuungUebersicht`, `BelegungKopfzahl`) tragen die aktuelle Meldung als verschachteltes
  optionales Objekt (`stand?: { evakuiert, erhebung, zeitpunkt_at, id }`). Optional nach der
  Norm aus LFH-265 (`skip_serializing_if`), damit „keine Meldung“ auf dem Draht fehlt statt
  `0` oder `null`. Ebenso `kapazitaet_personen?`.
- Fremde Organisation: Der Org-Floor der Gate-Extraktoren weist mit 403 ab, ein unbekannter
  Einsatz ist 404. Beide geben nichts preis, der Test akzeptiert beide (Bestand
  `tests/stab.rs`).
- Wird ein Abschnitt umbenannt oder gelöscht, trifft das den per Join gelesenen
  Abschnittsnamen. `EINSATZ_STREAM_EVENTS.abschnitt` invalidiert deshalb zusätzlich
  `EINSATZ_KEYS.betreuung` (ohne Guard, so auch bei der Ablösung).

### D7 — Seite: eine Route, zwei Blöcke, keine Detailroute

`/einsaetze/:id/betreuung` als `EinsatzSeite`:

- **Kopf:** genau eine Primäraktion, „Evakuierungsbezirk anlegen“ (öffnet ein Modal). Der
  Block „Betreuungsstellen“ trägt seinen Anlegen-Knopf in seiner eigenen Blockzeile,
  sekundär. Das hält „genau eine Primäraktion im Kopf“ (LFH-340).
- **Block „Evakuierung“:** `Datensicht form="karte"` im Plan-Modus, weil gelesen wird („was
  ist mit diesem Bezirk?“). Titel = Bezeichnung, Status = Räumungszustand (`StatusTag`),
  Sekundärfelder: „N · von M geplant“ (mit „≈“ bei geschätzt, „keine Meldung“ statt 0),
  Stand-Zeit, Abschnitt. Primäraktion: „Stand melden“. Weitere Aktionen (Plangröße
  fortschreiben, Räumung setzen, Stornieren) gebündelt im Dropdown, ab drei Aktionen nach
  LFH-365, mit der Zeilenkennung im zugänglichen Namen.
- **Block „Betreuungsstellen“:** `Datensicht form="tabelle"`, weil verglichen wird („welche
  hat noch Platz?“). Fixierte Kennung = Bezeichnung. Spalten: Art, Status, Kapazität,
  belegt, frei (nur bei gesetzter Kapazität), Stand-Zeit, Abschnitt. Zeilenaktion „Belegung
  melden“, weitere Aktionen gebündelt.
- **Erfassung:** alle Dialoge über `ErfassungsModal`. „Stand melden“ hat Anzahl und
  Erhebung sichtbar, Zeitpunkt eingeklappt (Vorgabe jetzt). Bei „Bezirk anlegen“ sind
  Bezeichnung, Plangröße und Erhebung sichtbar, Abschnitt, Sammelstelle und Notiz
  eingeklappt. Bei „Stelle anlegen“ sind Bezeichnung, Art und Kapazität sichtbar, der Rest
  eingeklappt. Das liegt im Budget ≤ 3. `onErfassen` nimmt `mutateAsync`.
- **Rückgängig-Toast** nach Stand- und Belegungsmeldung über
  `kommunikation/rueckgaengig.tsx` (fester Schlüssel). Der serverseitige Rückweg existiert
  (D3), deshalb gibt es vor dem Melden keine Rückfrage. Das Stornieren ist unumkehrbar und
  bekommt ein `Modal` mit `danger`-Knopf (Bauform aus LFH-365).
- **Deeplinks** als Query-Param `?bezirk=<id>` / `?stelle=<id>` (LFH-25: keine Detailroute),
  Builder `betreuungPfad` in `routing/deeplinks.ts`.
- **Rechte:** Ohne Schreibrecht erscheint `RechteHinweis`, die Primäraktion bleibt gesperrt
  stehen. Die Zeilenaktionen entfallen (LFH-346, zwei Zuschnitte).
- **Live:** Neue oder fremd geänderte Bezirke und Stellen erscheinen über den
  Query-Refetch. Fremd angelegte Bezirke oder Stellen werden in v1 ohne Sammelbanner
  eingeschoben. Die Prüfliste führt Kriterium 12 deshalb nach dem Präzedenzfall der
  Ablösung (LFH-647) als **offen → Nachzug-Ticket**, nicht als erfüllt. Geänderte Zahlen an
  bestehenden Zeilen verschieben kein Layout.

### D8 — Statusfarben: zwei neue Verträge, keine Farbe für die Art

`theme/statusFarben.ts` bekommt `raeumungszustand` und `betreuungsstelleStatus`
(`ALLE_MAPS` 20 → 22):

| Karte | Wert | Rolle | Begründung |
|---|---|---|---|
| Räumung | angeordnet | `achtung` | Handlungsbedarf, Räumung noch nicht begonnen |
| Räumung | läuft | `achtung` | Handlungsbedarf, Räumung nicht abgeschlossen (Label unterscheidet) |
| Räumung | geräumt | `normal` | Sollzustand erreicht |
| Räumung | aufgehoben | `neutral` | beendet |
| Stelle | vorbereitet | `neutral` | Präzedenz `uhsStatus.geplant` |
| Stelle | in Betrieb | `normal` | Präzedenz `uhsStatus.aktiv`, `brStatus.aktiv` |
| Stelle | geschlossen | `neutral` | umkehrbar, kein Alarm (anders als `uhsStatus.aufgeloest`) |

`bedien` wird **nicht** vergeben: Nach A2 trägt die Rolle eine aktive Beziehung
(Übergabe, Reservierung, Verortung), keinen Zustand der Entität selbst.

Das Label ist Pflichtfeld und damit der zweite Kanal. Die **Auslastung** einer Stelle ist
eine berechnete Einstufung: ab 90 % der Kapazität `achtung` („fast voll“), genau 100 %
`alarm` („voll“), darüber `alarm` („überbelegt“). Das Wort ist Pflicht. Ohne Kapazität, ohne
Meldung und unter 90 % gibt es keine Einstufung (`null`), weil für diesen Bereich kein Wort
festgelegt ist und eine Farbe ohne Wort den zweiten Kanal bräche. Verglichen wird ganzzahlig
(`belegt · 10 ≥ kapazität · 9`). `auslastung()` ist eine Funktion und kein exportiertes
Objekt, weil der Abdeckungstest die Vertragskarten aus den Objekt-Exporten ableitet. Die Art
(Anlaufstelle usw.) ist eine Kategorie, kein Zustand, und bekommt keine Farbe.

### D9 — Kennzahl als reine Funktion, nicht als Zelle

`frontend/src/betreuung/evakuierungKennzahl.ts` nach dem Vorbild von
`pegel/pegelKennzahl.ts`. Die Funktion nimmt die Bezirke aus der Übersicht und gibt `null`
(keine geplante Evakuierung) oder `{ evakuiert, geplant, bezirke, ohneMeldung, geschaetzt }`
zurück. `evakuiert` ist `number | null`: `null`, wenn kein aktiver Bezirk eine Meldung hat,
denn „nichts gemeldet“ ist nicht „niemand evakuiert“. `bezirke` ist die Zahl der aktiven
Bezirke. „Aktiv“ (nicht storniert, nicht `aufgehoben`) steht genau einmal, in
`istAktiverBezirk`; Kennzahl und Modulzähler lesen beide von dort.
Die Abgrenzung „Fehler ist nicht null“ trägt der Aufrufer über den Query-Zustand. Die
Funktion bekommt nur Daten. Getestet werden alle Szenarien der Kennzahl-Anforderung, dazu
das Paar „kein Bezirk → null“ / „Abruffehler → Zustand fehler“ auf Hook-Ebene
(`useEvakuierungKennzahl`), damit LFH-607 den Hook nur noch einsetzen muss. Der Hook liefert
vier Zustände: `aus` (Modul ausgeblendet oder gesperrt, kein Abruf), `laden`, `fehler` (hat
Vorrang vor Altdaten im Cache) und `daten` mit `kennzahl` oder `null`. Er lädt nur hinter
`darfZaehlerLaden('betreuung', …)`, sonst antwortet das Backend mit 403, und er teilt den
Query-Key `einsatzKeys.betreuung` mit Seite und Modulzähler.

### D10 — Registrierung und Guards

Die vollständige Liste steht in `tasks.md`. Diese Stellen sind **ohne** Guard und werden
leicht übersehen:

- (a) die zusätzliche Invalidierung am Ereignis `abschnitt` (D6),
- (b) das Konsumenten-Gating über `darfZaehlerLaden`,
- (c) der ETB-Eintrag je Meldung, gesichert nur über Tests,
- (d) e2e-Route in `gate1-ueberlauf.spec.ts`,
- (e) Fixture-Namen ohne „Betreuung“, weil die Palette Module und Einsätze gemeinsam
  durchsucht und „Betreuung“ schon eine Materialkategorie ist.

## Risks / Trade-offs

- [Die Bezeichnung trägt eine Adresse („Uferstraße 12–40“) und steht im ETB, das beim
  Schwärzen erhalten bleibt] → Das ist dieselbe Lage wie bei Abschnitt und UHS. Am
  Quellobjekt wird die Bezeichnung durch einen Platzhalter ersetzt. Der Hilfetext im
  Anlegen-Dialog empfiehlt Straßenzug oder Bezirksnummer, keine Hausbewohner. Eine
  ETB-seitige Schwärzung ist eine querschnittliche Frage und nicht Teil dieses Moduls.
- [Kollision mit LFH-634 an `MODUL_KEYS`, `LiveEvent::ALLE`, `ALLE_MAPS`, den
  Reihenfolge-Pins und der Migrationsnummer] → Wer als Zweiter mergt, rebased und zieht
  nach. Die Migrationsnummer wird unmittelbar vor dem Commit gegen `origin/alpha` gemessen.
- [Ohne Verlaufsansicht lässt sich eine ältere Fehlmeldung in der Oberfläche nicht gezielt
  zurücknehmen] → Weil die Meldungen absolut sind, korrigiert die nächste Meldung den Stand.
  Die Rücknahme per Toast deckt den Tippfehler direkt nach dem Melden ab. Die Route nimmt
  jede Meldung, eine Verlaufsansicht kann sie später nutzen.
- [Die Kennzahl summiert Stände mit verschiedenen Zeitpunkten] → Die jüngste Stand-Zeit
  steht auf jeder Bezirkskarte. Die Kennzahl weist Bezirke ohne Meldung aus. Eine
  Mindestaktualität erzwingt LFH-639 nicht. Das bleibt eine Frage an LFH-640.
- [Geschlossene Stelle mit Belegung 0 zählt in der Kopfzahl vor ihrem Schließen mit ihrer
  damaligen Belegung] → Das ist gewollt. Die Kopfzahl zu t ist der damals gemeldete Stand.

## Migration Plan

Eine additive Migration `0117_betreuung.sql` (Nummer unmittelbar vor dem Commit gegen
`origin/alpha` prüfen). Keine Änderung an Bestandstabellen, kein `-- no-transaction`. Ein
Rollback ist ein Revert des Commits auf einer frischen DB. Auf einer bestehenden DB bleiben
die leeren Tabellen folgenlos stehen, weil eine angewendete Migration nicht editiert wird.
