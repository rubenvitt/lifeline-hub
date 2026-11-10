# Design

## Context

Ausgangspunkt sind die Kopplung aus LLH-1490 (ADR-0014,
`openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`) und die
Stammdaten-Verteilung aus LLH-1493
(`openspec/changes/archive/2026-11-09-ca8v0psv-stammdaten-verteilung/design.md`). Die Motivation
steht in proposal.md. Den Lösungsweg hat Ruben am 09.11.2026 abgestimmt; er steht im
Zunder-Kommentar an LLH-1492.

Aufnahme vom 09.11.2026:

- **Tabellen:** Ein Einsatz verteilt sich auf rund 119 Tabellen. 95 tragen `einsatz_id`,
  24 hängen über einen Fremdschlüssel daran. Genau diese Menge kennt die Schwärzungs-Registry
  (`src/einsatz/schwaerzung_registry.rs`, `TABELLEN` mit `Scoping::Direkt | UeberParent`).
- **IDs:** Alle IDs sind INTEGER. Eine Kennung über Instanzen hinweg gibt es nicht.
- **Kein Log je Einsatz:** Die Live-Verteilung (`src/live/`) ist SSE im Prozessspeicher. Sie
  trägt nur IDs und taugt nicht zum Nachholen.
- **Fremdschlüssel:** Verweise auf Stammdaten sind meist `NO ACTION`. Daneben gibt es
  Schnappschüsse (`snap_*`).
- **ETB:** `etb_eintrag` wird nur angehängt (`lfd_nr` lückenlos je Einsatz). Die Volltextsuche
  pflegen Trigger (`etb_eintrag_fts_*`).
- **Anhänge** sind BLOBs in SQLite: `anhang.daten` bis 25 MiB, dazu
  `karte_hintergrundbild_daten` und `uhs_plan`.
- **Offline vormerkbar sind 18 Erfassungen.** 15 Tabellen tragen `client_id` mit einem
  eindeutigen Teilindex. Ein Duplikat beantwortet der Server mit 201 und der vorhandenen Zeile
  (`src/routes/etb.rs:76-117`).
- **Kopplung:**
  - Melden geht alle 60 s (`--instanz-melden-sekunden`), Anfrage höchstens 64 KiB
    (`extractor::BODY_MAX`), Antwort höchstens 1 MiB (`melden::ANTWORT_MAX`).
  - Die Route nimmt `GekoppelteInstanz` und antwortet signiert; `PROTOKOLL = 1`.
  - Stammdaten werden auf der meldenden Seite über `stammdaten_herkunft` abgebildet.
- **Gerätesitzungen** prüfen ihre Routen schon über eine Liste aus Methode und `MatchedPath`
  (`geraet::darf_route`). Diese Form nimmt der Antragsweg.

## Goals / Non-Goals

**Goals:**

- **Ein Verfahren für alle Einsatztabellen.** Eine neue Tabelle braucht nur ihre Trigger und
  einen Eintrag in der Beschreibung; ein Wächter erzwingt beides.
- **Schutz und Log sitzen in der Datenbank.** Kein Schreibweg kann am Spiegel vorbeischreiben
  oder das Log vergessen.
- **Der Spiegel ist für Lesewege nicht von einem eigenen Einsatz zu unterscheiden.** Seiten,
  Druck, Suche, Offline-Lesen und Rechte laufen unverändert.
- **Übergabe in LLH-1491 kopiert nichts.** Sie schaltet nur, wer führt.

**Non-Goals:**

- Führer, Epoche, Übergabe, Notübernahme (LLH-1491). Die Schnittstelle steht unter D4.
- Sparsamere Freigabestufen, geschwärzte Ansicht (LLH-1496), Archiv und Lebensende (LLH-1494).
- Anträge auf Stammdaten (lokale Ergänzung an den Hub).
- Anhänge in Anträgen (D9).
- Spiegel zwischen zwei ELW (LLH-1497). Das Protokoll unterscheidet trotzdem nur Richtung, nicht
  Hub und ELW.

## Decisions

### D1 Änderungslog je Einsatz per Trigger

Das Log ist die Tabelle `einsatz_aenderung` mit diesen Spalten:

- `stand` (INTEGER PRIMARY KEY AUTOINCREMENT, global steigend);
- `einsatz_id`;
- `art`, der Tabellenname;
- `schluessel`, die `id` als Text bzw. bei Tabellen ohne `id` die Primärschlüsselspalten mit `|`
  verbunden.

`UNIQUE(art, schluessel)` sorgt dafür, dass jede Zeile höchstens einmal im Log steht; ein Index
auf `(einsatz_id, stand)` dient dem Liefern. Wie in LLH-1493 D1 löscht der Trigger den alten
Eintrag und legt einen neuen an. Das Log bleibt so etwa so groß wie der Bestand. Ob eine Zeile
gelöscht ist, entscheidet das Liefern, indem es nachsieht.

- **Trigger:** `<tabelle>_spiegel_log_i/_u/_d` an jeder Tabelle der Beschreibung (D3).
  - Bei `Scoping::UeberParent` holt der Trigger die `einsatz_id` über die Elternzeile.
  - Fehlt sie, weil die Elternzeile schon per CASCADE weg ist, schreibt er nichts. Der Spiegel
    löscht die Kinder dann mit der Elternzeile.
- **Die Trigger werden erzeugt, nicht getippt.** Ein Generator in
  `src/instanz/spiegel/art.rs` baut das SQL aus der Beschreibung, die Migration enthält seine
  Ausgabe. Der Wächter `art::tests::trigger_passen_zur_beschreibung` vergleicht die Trigger in
  `sqlite_master` mit dem Generator. Eine neue Tabelle braucht deshalb ihre Trigger in ihrer
  eigenen Migration; die Regel kommt nach `src/AGENTS.md`.
- **Grundstock:** Die Migration trägt jede bestehende Zeile einmal als geändert ein (Muster
  0306).

*Verworfen:*

- **Ein Operationslog mit Inhalt.** Es hält jede Zwischenfassung, wird mit dem Einsatz immer
  länger, und eine Schwärzung müsste auch das Log schwärzen. Das verdichtete Log schickt nach
  einer Pause nur den aktuellen Stand und schwärzt sich von selbst.
- **SSE als Quelle.** Die Ereignisse leben im Prozessspeicher und tragen nur IDs.

### D2 Kennung und Freigabestufe am Einsatz

- **`einsatz.kennung`** (TEXT, eindeutig, NULL erlaubt) heißt `<instanzkennung>/<id>`. Der Führer
  setzt sie beim ersten Liefern, der Spiegel übernimmt sie unverändert. Sie bleibt über eine
  Übergabe (LLH-1491) gleich.
- **`einsatz.freigabestufe`** (TEXT NOT NULL DEFAULT `alles`, CHECK auf `alles`) ist ein
  Wire-Enum `Freigabestufe`. Dazu kommt das Wire-Enum `SpiegelKategorie` mit `fuehrung`, `etb`,
  `lage`, `kraefte`, `personen`, `betreuung`, `kommunikation` und `anhaenge`. Beide bekommen
  Fälle in `tests/enum_wire_kontrakt.rs`.
- **Unbekannte Stufe:** Eine spiegelnde Seite übernimmt einen Einsatz mit unbekannter Stufe
  nicht weiter, denn sie kann nicht wissen, was fehlt. Die Kopplung trägt dann einen Hinweis.

### D3 Beschreibung je Tabelle

`instanz::spiegel::art::TABELLEN` ist die einzige Liste. Sie hat zwei Teile:

- **Gespiegelt:** je Tabelle `tabelle`, `kategorie`, `schluessel` (`Id` oder `Pk(&[spalten])`),
  das Scoping aus der Schwärzungs-Registry und `blob`, die Spalte, deren Inhalt auf Abruf kommt
  (D8).
- **Ausgenommen**, je mit Grund:
  - Zugriffsprotokolle (`person_zugriff_audit`, `anhang_zugriff_audit`): Jede Instanz
    protokolliert ihre eigenen Zugriffe.
  - `etb_lesemarke`: Lesestand einer Person an dieser Instanz.
  - `geraet_kopplung*`, `lagemonitor_freigabe`: Geräte hängen an einer Instanz.
  - `demo_import`, `aufbewahrung_loeschprotokoll`: lokal.

Wächter `art::tests::jede_einsatztabelle_ist_eingeordnet`: Jede Tabelle der Schwärzungs-Registry
steht in genau einem der beiden Teile, und keine steht dort, die die Registry nicht kennt.

**Verweise** liest der Server beim Start aus `PRAGMA foreign_key_list` und ordnet sie ein:

- auf eine gespiegelte Tabelle → Einsatzverweis (D5);
- auf eine Art aus `stammdaten::art::BESCHREIBUNGEN` oder auf `benutzer` → Stammdatenverweis;
- auf `org` → Org-Verweis;
- sonst bricht der Wächter.

Spalten auf `_id` ohne Fremdschlüssel, etwa polymorphe Bezüge `objekt_typ`/`objekt_id` (in der
Registry als `G_POLY` geführt), stehen ausdrücklich in `VERWEISE_OHNE_FK`, samt Auflösung. Der
Wächter `art::tests::jede_id_spalte_ist_eingeordnet` findet jede `*_id`-Spalte, die weder einen
Fremdschlüssel hat noch dort steht. Für IDs in JSON-Spalten gilt dieselbe Liste.

### D4 Spiegel in denselben Tabellen, Schnittstelle zu LLH-1491

- **`einsatz_spiegel`** hat die Spalten `einsatz_id` (PK, FK CASCADE), `kopplung_org_id`,
  `fremde_kennung` (UNIQUE), `stand`, `freigabestufe`, `letzter_abgleich_at`, `hinweis` und
  `beendet_at`.
  - Eine Zeile heißt: Dieser Einsatz ist ein Spiegel.
  - Keine Zeile heißt: Diese Instanz führt ihn.
- **`spiegel_herkunft`** hat die Spalten `einsatz_id` (FK CASCADE), `art`, `fremder_schluessel`
  und `lokaler_schluessel`. Eindeutig sind `(einsatz_id, art, fremder_schluessel)` und
  `(art, lokaler_schluessel)`.
- **Schnittstelle zu LLH-1491** (als Kommentar an LLH-1491 hinterlegt): Eine Übergabe legt die
  Zeile in `einsatz_spiegel` an oder entfernt sie und führt die Epoche. Daten werden dabei nicht
  kopiert. Die Herkunft bleibt stehen, damit der neue Führer weiter dieselben Zeilen meint.

*Verworfen:*

- **Eine eigene SQLite-Datei je Spiegel mit den IDs des Führers.** Jede Leseroute müsste dann
  die Datenbank wählen. Das sind Hunderte Stellen und der Bau aus ADR-0002.
- **Eigene Spiegeltabellen.** Das hieße zweites Schema, zweite Lesewege.
- **Dieselben IDs wie beim Führer.** Sie kollidieren mit eigenen Einsätzen.

### D5 Abbildung der IDs: Einsatzverweise am Spiegel, Stammdaten an der meldenden Seite

- **Einsatzverweise** übersetzt die spiegelnde Seite über `spiegel_herkunft`. Nur sie kennt
  beide Seiten.
- **Stammdatenverweise und Konten** übersetzt immer die meldende Seite. Nur sie hält
  `stammdaten_herkunft`.
  - Führt sie, übersetzt sie beim Senden lokal → fremd.
  - Spiegelt sie, übersetzt sie beim Übernehmen fremd → lokal.
  - Ein Verweis ohne Gegenstück (Spontanhelfer, geliehenes Fahrzeug) wird `NULL`, und der
    Schnappschuss bleibt. Konten bekommen stattdessen einen Stellvertreter (unten).
- **Org:** Die Org des Einsatzes kommt als `fremde_org_kennung` der Zuordnung
  (`instanz_kopplung_org`).
- **Konten** (Nachtrag 10.11.2026, Entscheidung Ruben): Rund 60 Spalten der gespiegelten
  Tabellen verweisen `NOT NULL` auf `benutzer`, und das ETB zeigt den Verfasser per JOIN auf
  `benutzer.anzeigename`. Ein Konto ohne Gegenstück wird deshalb nicht leer, sondern zeigt auf
  einen **Stellvertreter**:
  - Jede Lieferung trägt `konten: [{ id, anzeigename, gegen_id }]` für jedes Konto, auf das ihre
    Zeilen verweisen. `id` ist die eigene Kennung des Senders. `gegen_id` kennt nur die meldende
    Seite, wenn sie führt (Herkunft lokal → fremd).
  - Der Empfänger löst so auf: `gegen_id`, sonst `stammdaten_herkunft` (Konto, fremd → lokal),
    sonst der Stellvertreter aus `spiegel_konto(kopplung_id, fremde_id, benutzer_id)`.
  - Ein Stellvertreter ist eine Zeile in `benutzer` mit `aktiv = 0`, Platzhalter-Hash
    `PASSWORT_HASH_KEIN_LOKALES`, Systemrolle `keiner`, der Org der Zuordnung, Benutzername
    `spiegel:<kopplung_id>:<fremde_id>` und Anzeigename vom Gegenüber. Bei jeder Lieferung wird
    der Anzeigename nachgezogen.
  - Die Benutzerverwaltung, Auswahllisten und die Anmeldung schließen Konten mit einer Zeile in
    `spiegel_konto` aus.
  - Mitgliedschaften (`einsatz_mitgliedschaft`) werden für Stellvertreter ausgelassen.
  - Eine Spalte `NOT NULL` auf andere Stammdaten gibt es unter den gespiegelten Tabellen nicht
    (Analyse vom 10.11.2026). Diese Verweise bleiben bei fehlendem Gegenstück `NULL`.
  - *Verworfen:* ein Sammelkonto je Kopplung (das ETB zeigte den Namen der Gegenstelle statt
    der Person); Zeilen auslassen (der Spiegel wäre auch im ETB unvollständig).

### D6 Eigene Route, ein Paket in beide Richtungen

`POST /api/instanz/spiegel` nimmt `GekoppelteInstanz` und antwortet signiert, wie Melden.

- **Grenzen:** Anfrage und Antwort dürfen je höchstens `SPIEGEL_MAX` = 2 MiB groß sein. Der
  Extractor bekommt dafür eine Körpergrenze je Route; Melden bleibt bei 64 KiB.
- **Protokoll:** `PROTOKOLL` steigt auf 2. Gespiegelt wird nur, wenn beide Seiten mindestens 2
  sprechen; ein Gegenüber mit Version 1 bekommt den Hinweis aus der Spec. Melden bleibt mit
  Version 1 verträglich, die Felder wachsen weiter nur additiv.
- **Anfrage und Antwort haben dieselbe Form:**

  ```text
  SpiegelPaket {
    quittungen:  [AntragQuittung]            // Ergebnis zugestellter Anträge
    antraege:    [Antrag]                    // an Einsätze, die das Gegenüber führt
    staende:     [{ kennung, stand }]        // was ich vom Gegenüber gespiegelt habe
    lieferungen: [EinsatzLieferung]          // Einsätze, die ich führe
    abrufe:      [AnhangAbruf]               // Anhänge, deren Inhalt ich brauche
    anhang_teile:[AnhangTeil]                // Stücke angeforderter Anhänge
  }
  EinsatzLieferung { kennung, org, freigabestufe, seit, bis, zeilen: [Zeile] }
  Zeile { art, schluessel, stand, kategorie, geloescht, daten }
  ```

  Das Budget füllt das Paket in dieser Reihenfolge. Damit stehen Anträge und Quittungen auch
  über Satellit vorn.
- **Welche Einsätze geliefert werden:** die eigenen der zugeordneten Orgs (ohne
  `einsatz_spiegel`), solange sie aktiv sind. Ein abgeschlossener Einsatz wird noch geliefert,
  bis das Gegenüber den Stand des Abschlusses bestätigt hat.
- **Demo-Einsätze werden nicht gespiegelt.** Sie sind Übungsdaten einer Instanz und überfüllten
  sonst die Liste am Hub.
- **Der Stand liegt immer bei der spiegelnden Seite:**
  - **Pull** (die erreichte Seite führt): Die meldende Seite schickt `staende`, die erreichte
    liefert ab dort.
  - **Push** (die meldende Seite führt): Die erreichte Seite nennt ihre `staende` in der Antwort.
    Die meldende Seite speichert sie in `spiegel_ziel(kopplung_org_id, einsatz_id, stand)` und
    liefert beim nächsten Mal ab dort.
  - Ein niedrigerer Stand als gespeichert, etwa nach einer Wiederherstellung, setzt zurück.
  - Ein erster Abgleich beginnt bei 0.
- **Liefern** heißt: Zeilen nach `stand` mit Live-Inhalt (`json_object` über die beschriebenen
  Spalten), `bis` = höchster vollständig gelieferter Stand. Wie in LLH-1493 D2 kommen Zeilen mit
  höherem Stand vorher mit, auf die eine gelieferte Zeile verweist, über das Budget hinaus und
  höchstens vier Ebenen tief.

*Verworfen:*

- **Die Lieferung in Melden einbauen.** Die 64-KiB-Grenze der Anfrage trägt keinen Push, und
  Melden soll klein und versionsfest bleiben.
- **Eine Route je Richtung.** Die erreichte Seite kann nicht rufen. Eine Antwort-Route bräuchte
  ohnehin dieselbe Form.

### D7 Übernehmen am Spiegel

- **Ablauf:** Eine Transaktion je Einsatzlieferung, der Merker `spiegel_uebernahme` (einzeilig)
  steht am Anfang und wird vor dem Commit gelöscht (Muster LLH-1493 D4).
- **Zwei Durchgänge:**
  - erst Zeilen ohne Verweise anlegen bzw. ändern, die `spiegel_herkunft` setzen;
  - dann Verweise setzen.
- **Ein Einsatzverweis, der trotz Mitliefern unbekannt bleibt**, ist ein Fehler der Lieferung.
  Dann wird die ganze Einsatzlieferung verworfen und der Stand bleibt.
- **Löschen** löscht lokal, Kinder mit.
- **Danach** rückt der Stand bis `bis` vor (Vergleichen und Setzen, nur vorwärts). Ein
  Live-Ereignis `spiegel` (`{ einsatz_id, kategorien }`) geht nach dem Commit an den Einsatz. Der
  Client lädt die Abfragen dieser Kategorien neu, einmal je Paket, nicht je Zeile.
- **Einsatzkopf:** Die erste Lieferung legt die `einsatz`-Zeile mit der Org der Zuordnung und der
  `einsatz_spiegel`-Zeile an.
- **Unbekannte Spalten** einer neueren Gegenseite werden ignoriert. Fehlende Spalten nehmen
  ihren Vorgabewert. Fehlt ein `NOT NULL` ohne Vorgabe, wird die Zeile ausgelassen, und die
  Kopplung trägt „Update nötig“.

### D8 Anhänge auf Abruf

- **Liefern:** Die Spalte aus `blob` liefert nur `groesse` und `sha256`. Der Spiegel legt die
  Zeile mit leerem Inhalt an und führt sie in `spiegel_anhang(einsatz_id, art,
  lokaler_schluessel, sha256, groesse, empfangen, angefordert_at, fertig_at)`.
- **Öffnen:** Ein Abruf eines Anhangs ohne Inhalt antwortet am Spiegel 409 mit Code
  `ANHANG_WIRD_GEHOLT`, setzt `angefordert_at` und weckt den Takt. Die Vorschau zeigt „wird
  geholt“.
- **Stücke:** Ein Stück ist 256 KiB groß und wird über `substr` aus dem BLOB gelesen.
- **Reihenfolge:** Erst die angeforderten Anhänge (nach `angefordert_at`), dann im Leerlauf die
  übrigen. Leerlauf heißt: Die vorige Lieferung hat das Budget nicht ausgeschöpft.
- **Abschluss:** Die Stücke sammelt `spiegel_anhang_teil`. Erst bei vollständiger Länge und
  passender Prüfsumme wird der Inhalt unter dem Merker geschrieben. Bei falscher Prüfsumme wird
  verworfen und neu angefordert.
- **Ändert der Führer den Anhang** (neue Prüfsumme), beginnt alles neu.

### D9 Anträge am Spiegel

- **Schicht vor den Einsatzrouten.** Eine Schicht vor `/api/einsaetze/{id}/…` sieht nach, ob der
  Einsatz ein Spiegel ist:
  - Eine schreibende Methode auf eine Route außerhalb von `BEANTRAGBAR` endet mit 409 „Dieser
    Einsatz ist ein Spiegel von <Gegenstelle>“. Der Trigger (D10) ist nur das Netz darunter.
  - Eine Route in `BEANTRAGBAR` wird zum Antrag. `BEANTRAGBAR` ist eine Liste aus Art, Methode
    und `MatchedPath` mit den 16 Erfassungen an Einsatzdaten, je mit den Pfadparametern und Body-Feldern, die auf
    Einsatzzeilen zeigen.
- **Ein Antrag entsteht so:**
  1. Anmelden über `CurrentUser`, Schreibrecht über die gespiegelte Mitgliedschaft prüfen
     (dieselben Extractor-Regeln wie die Route).
  2. Body als JSON lesen, mit der Grenze der Route.
  3. `client_id` verlangen, wo die Art eine trägt.
  4. Einsatzverweise in Pfad und Body lokal → fremd übersetzen. Eine Zeile ohne Herkunft ergibt
     400 „Bezug noch nicht beim Führer“.
  5. Ablegen in `spiegel_antrag`: `id`, `einsatz_id`, `art`, `methode`, `pfad_vorlage`,
     `pfad_parameter` (JSON, fremde IDs), `daten` (JSON), `benutzer_id` (lokal), `client_id`,
     `erfasst_at` (Serveruhr), `zustand` (`ausstehend`, `zugestellt`, `uebernommen` oder
     `abgelehnt`), `grund`, `ergebnis_schluessel`, `geaendert_at`.
- **Antwort:** 202 mit `{ antrag: { id, zustand } }`. Dieselbe `client_id` ergibt denselben
  Antrag.
- **Anhänge** am ETB-Eintrag eines Spiegels sind gesperrt (400). Die Oberfläche bietet sie dort
  nicht an.
- **Lesen:** `GET /api/einsaetze/{id}/antraege` liefert offene und abgelehnte Anträge der
  Person. `DELETE …/antraege/{antrag_id}` verwirft einen abgelehnten Antrag.
- **Zustände:**
  - Ein zugestellter Antrag wird `uebernommen`, sobald die Quittung kommt.
  - Er verschwindet aus der Liste, sobald `spiegel_herkunft` den `ergebnis_schluessel` kennt.
  - Abgelehnte Anträge werden nach 30 Tagen geräumt.

*Verworfen:* **Jede Schreibroute als allgemeiner HTTP-Antrag.** Ein PATCH überschriebe Werte, die
niemand gesehen hat; das verbietet ADR-0008 aus demselben Grund für die Warteschlange. IDs in
beliebigen Bodies ließen sich nicht verlässlich übersetzen.

### D10 Schreibschutz per Trigger

An jeder gespiegelten Tabelle stehen `BEFORE INSERT/UPDATE/DELETE`-Trigger
`<tabelle>_spiegel_schutz_i/_u/_d`, vom Generator aus D1 erzeugt. Sie greifen, wenn der Einsatz
der Zeile in `einsatz_spiegel` steht und `spiegel_uebernahme` leer ist, und brechen dann mit
`RAISE(ABORT, 'einsatz_ist_spiegel')` ab. `AppError` bildet das zentral auf 409 ab (Fall in
`tests/fehler_vertrag.rs`). Wie in LLH-1493 sieht kein anderer Schreibweg den Merker, weil SQLite
nur einen Schreiber hat.

**Hintergrundläufe** müssen Spiegel auslassen, sonst endeten sie im 409. Das betrifft Erinnerungen,
Vorwarnung der Ablösung, Pegel, Benachrichtigungen, Aufbewahrung und Schwärzung. Eine Aufgabe
geht sie durch, jeder Lauf filtert über `einsatz_spiegel`. Ein Test schreibt mit jedem Lauf gegen
einen Spiegel.

### D11 Ausführen beim Führer im Namen des Kontos

Der Führer führt einen Antrag über **den eigenen Router** aus:

1. Er baut eine `http::Request` aus Methode, Pfadvorlage (mit seinen IDs) und Body.
2. Er hängt die Extension `AntragAkteur { benutzer_id, antrag }` an.
3. Er ruft `oneshot`.

`CurrentUser` nimmt den Benutzer aus dieser Extension statt aus dem Cookie. Eine Extension kann
kein Client setzen; ein Test zeigt, dass Kopf und Cookie sie nicht vortäuschen.

So gelten dieselben Extractor-Regeln wie bei einem eigenen Aufruf: Rechte, Modul, Freeze,
`client_id`-Replay, Live-Ereignisse und Audit. Das ist das Muster der Offline-Warteschlange, nur
serverseitig. Den Router legt `main` nach dem Bau in eine `OnceLock` im `AppState`.

- **Konto:** Die meldende Seite übersetzt es (D5). Bleibt es unbekannt, ist das Ergebnis
  „abgelehnt: Konto am Führer unbekannt“.
- **Ergebnis:**
  - 2xx → `uebernommen` mit `ergebnis_schluessel` aus der Antwort (`id`);
  - 4xx → `abgelehnt` mit dem Text der Fehlerantwort;
  - 5xx → kein Ergebnis, die Gegenseite stellt erneut zu.
- **Idempotenz:** `spiegel_antrag_eingang(kopplung_id, fremde_antrag_id, ergebnis)` merkt sich
  jedes Ergebnis. Eine zweite Zustellung bekommt dieselbe Quittung, ohne erneut auszuführen. Die
  `client_id` der Route schützt zusätzlich.
- **Ist der Einsatz beim Empfänger selbst ein Spiegel**, etwa nach einer Übergabe in LLH-1491,
  lautet das Ergebnis „abgelehnt: Führung liegt nicht hier“.

*Verworfen:* **Je Art ein direkter Aufruf der Fachfunktionen.** Das sind 16 Wege, die die Prüfungen
der Routen nachbauen und mit ihnen auseinanderlaufen.

### D12 Takt

- **Eigener Hintergrundlauf** `spiegel::start`, Tick 1 s. Je Kopplung gilt `naechster_abgleich_at`.
- **Kurzer Takt** gilt, solange ein gelieferter oder gespiegelter Einsatz aktiv ist, Anträge
  ausstehen oder Anhänge angefordert sind: `--instanz-spiegel-sekunden` /
  `LIFELINE_INSTANZ_SPIEGEL_SEKUNDEN`, Vorgabe 5, Bereich 2–600. Sonst gilt der Takt der Meldung.
- **Fehler** verdoppeln den Abstand bis 600 s, wie bei der Meldung.
- **Ein neuer Antrag oder eine Anforderung** an der meldenden Seite weckt den Lauf sofort
  (`Notify`).
- **Nur die meldende Seite** läuft so. Die erreichte antwortet nur.

### D13 Oberfläche

- **Einsatzkopf:** `EinsatzAnzeige.spiegel: { gegenstelle, letzter_abgleich_at, beendet,
  antraege_ausstehend, antraege_abgelehnt } | null`, dazu Typ-Codegen.
- **Schreibrecht:**
  - `darfImEinsatzSchreiben` und `darfEinsatzLeiten` in `einsatz/schreibrecht.ts` liefern für
    einen Spiegel `false`. Damit wird jede Seite still lesend, ohne die rund 200 Aufrufstellen
    anzufassen.
  - Die neue Regel `darfBeantragen` (aktiv und Schreibrolle) gilt nur an den 16 Erfassungsorten.
- **Antworten:** Die `erfasse…OfflineFaehig`-Funktionen kennen das Ergebnis `beantragt`.
  `useVorgemerkteSchreibaktionen` nimmt die ausstehenden Anträge derselben Art dazu. Damit zeigen
  die Orte, die heute „Vorgemerkt“ zeigen, auch „Beantragt“, mit demselben Platz und Abstand.
  `etb/` zeigt beantragte Einträge wie ausstehende.
- **Hinweisband:** `SpiegelBand` steht im Einsatzrahmen und hat eine Antragsliste zum Aufklappen
  (abgelehnte mit Grund, „Neu erfassen“ legt die Daten in die Erfassung, „Verwerfen“).
- **Query-Key `antraege`:** Er bleibt bewusst draußen aus `LAGEBILD_OFFLINE`, mit Grund im
  Wächter. Ohne Verbindung zur eigenen Instanz trägt die Warteschlange.
- **Vorschau:** „wird geholt“ bei `ANHANG_WIRD_GEHOLT`, mit erneutem Versuch nach dem nächsten
  Live-Ereignis.
- **Seite „Instanzkopplung“:** neuer Abschnitt „Einsätze“ je Kopplung (gelieferte und
  gespiegelte, Stand, letzter Abgleich, Hinweise).
- **Wortlaut** mit `design:ux-copy`. Keine größere UI im Sinne von `frontend/AGENTS.md`: ein Band
  und ein Abschnitt in bestehenden Seiten.

### D14 Widerruf

- **An der Seite, die widerruft,** endet beim Widerruf einer Org-Zuordnung der Abgleich ihrer
  Einsätze:
  - `einsatz_spiegel.beendet_at` wird gesetzt;
  - ausstehende und zugestellte Anträge werden `abgelehnt: Kopplung widerrufen`;
  - `spiegel_ziel` wird gelöscht.
- **An der anderen Seite** geschieht dasselbe mit der Widerrufsmitteilung der Meldung.
- **Der Spiegel bleibt** lesbar und geschützt. Sein Lebensende regelt LLH-1494.
- **Admin-Spur:** Neue `admin_audit`-Aktionen gibt es nur für „Spiegel beendet“; das Liefern
  selbst ist kein Admin-Vorgang.

## Nachträge aus der Umsetzung

- **10.11.2026, Messung D1** (Aufgaben 1.1 und 1.5): Auf einer Kopie des Schemas mit den
  Pragmas der Instanz (WAL, `synchronous = FULL`, `secure_delete = ON`), je Erfassung ein Commit,
  Median aus fünf Läufen: 50 ETB-Einträge 9,5 ms vorher, 8,9 ms nachher; 50 Personen 10,2 ms
  vorher, 11,4 ms nachher. Der Unterschied liegt im Rauschen des fsync. Ohne fsync
  (`synchronous = NORMAL`) kostet ein Trigger rund 18 µs je Zeile.
- **10.11.2026, D9/D10:** Die Schicht vor den Einsatzrouten fängt nur die beantragbaren
  Erfassungen ab. Jede andere Schreibanfrage läuft bis zum Handler, und der Schutz-Trigger
  antwortet mit 409. Eine Sperre aller schreibenden Methoden in der Schicht hätte auch Wege
  getroffen, die am Spiegel nur lokale, nicht gespiegelte Tabellen schreiben (Lesemarke des ETB,
  Zugriffsprotokolle). Der Text der 409 nennt deshalb nicht die Gegenstelle; die steht im
  Hinweisband.

- **10.11.2026, Einsatznummern (D4):** Nummern sind je Org eindeutig (`idx_einsatz_nummer`,
  `idx_einsatz_nummer_lfd`), ELW und Hub vergeben sie aber unabhängig. Ein Spiegel trägt die
  Nummer des Führers und ist von der Eindeutigkeit ausgenommen: Spalte `einsatz.spiegel` (folgt per
  Trigger der Zeile in `einsatz_spiegel`, wird nie geliefert), beide Indizes mit
  `WHERE spiegel = 0`. Abgestimmte Nummernkreise über Instanzen sind eine eigene Frage.
- **10.11.2026, Verweise ohne Fremdschlüssel (D3):** Aufnahme in `spiegel::schema::VERWEISE_OHNE_FK`:
  polymorphe Bezüge (Erinnerung, Benachrichtigung, Chat, Kommunikationsstatus und -zustellung,
  Bereitstellungsraum, Verbindungen der Fernmeldeskizze), Kennungen in Text
  (`fernmeldeskizze_lage.element`, `ab-<id>` usw.), Qualifikationen in JSON (`quali_soll`,
  `qualifikationen`) und im eingefrorenen Lagestand nur `bilder[].id`, weil der Client das Bild
  live nachlädt. Alle übrigen IDs im Lagestand bleiben, wie sie sind: Er ist ein Dokument.

- **10.11.2026, Live nach der Übernahme (D7):** Statt eines neuen Ereignisses `spiegel` mit
  Kategorien meldet der Spiegel je Paket und Einsatz das bestehende `lagged`. Der Client gleicht
  dann alle Abfragen des Einsatzes ab. Ein eigenes Ereignis bräuchte je Kategorie eine eigene
  Modul-Schranke (F01); `lagged` gehört keinem Modul und verrät nichts. Ein neuer Spiegel meldet
  dazu die Einsatzliste der Org.
- **10.11.2026, Lücke am Spiegel (D6):** Nennt der Spiegel einen niedrigeren Stand als `seit`
  einer Lieferung (Wiederherstellung), übernimmt er nichts und nennt seinen Stand; die
  Gegenseite liefert ab dort neu.

- **10.11.2026, Benachrichtigungen (D3, D9), Entscheidung Ruben:** `benachrichtigung` wird nicht
  gespiegelt. Sie ist Zustellstand je Instanz (Empfänger, Lesestand, Live-Zustellung) wie die
  Lesemarke; „Eingänge gelesen“ und das Quittieren schreiben lokal und sind keine Anträge.
  `BEANTRAGBAR` hat damit 16 Einträge. Hinweise zu Ereignissen eines ELW am Hub bringt LLH-1495.

- **10.11.2026, Router für die Anträge (D11):** Der Router liegt nicht im `AppState`, sondern als
  Extension `RouterPlatz` an jeder Anfrage; `build_router_mit` setzt ihn, sobald er steht. Die
  Route des Abgleichs liest ihn daraus, der Takt bekommt ihn beim Start. Mehrere Instanzen in
  einem Prozess (Tests) behalten so je ihren eigenen Router. Die Kennung eines Antrags kehrt nie
  wieder (`AUTOINCREMENT`): Der Führer erkennt eine zweite Zustellung an ihr, und ein
  aufgeräumter Antrag darf keinen neuen verdecken (gefunden im Integrationstest).

## Risks / Trade-offs

- **[Rund 700 Trigger, Schreiblast]** Jede Schreibanfrage schreibt eine Logzeile mehr.
  → Messen: ETB-Einfügen und eine Personenerfassung vor und nach der Migration, Ziel aus
  Kapitel 10 (50 ETB-Ereignisse in 200 ms) bleibt. Messwert kommt in die Nachträge.
- **[Eine ID-Spalte ohne Fremdschlüssel wird übersehen]** Dann zeigt der Spiegel auf eine falsche
  Zeile. → Wächter über alle `*_id`-Spalten und JSON-Spalten (D3). Integrationstest mit einem
  Einsatz aus `demo` gegen den Spiegel, Zeile für Zeile verglichen.
- **[Ausführen im Namen eines Kontos]** Ein Fehler hier hieße Schreiben ohne Anmeldung.
  → Die Extension entsteht nur in `spiegel::antrag::ausfuehren`. Ein Test zeigt, dass HTTP sie
  nicht setzt. Gegenlesen im Review-Fan-out mit der Dimension Sicherheit.
- **[Art.-9-Daten am Hub im Klartext]** Folge von Entscheidung 5, nicht neu. → Risiko in Kapitel
  11 nachführen. Härtung des Hubs bleibt offene Frage der Konzeptnotiz.
- **[Große Lieferung hält die Schreibsperre]** → Budget je Paket, eine Transaktion je
  Einsatzlieferung, Stücke für Anhänge.
- **[Hintergrundläufe am Spiegel]** → D10, Test je Lauf.
- **[Schemaabstand N/N−1]** → D7 (unbekannte Spalten ignorieren, fehlende vorgeben, sonst
  Hinweis).
- **[Spiegel-Ereignis lädt zu viel neu]** → ein Ereignis je Paket mit Kategorien. Der Client
  lädt nur die betroffenen Prefixe.

## Migration Plan

- **Migrationen** werden angehängt, mit Nummern über `origin/alpha`
  (`scripts/check-migrationen.sh`):
  1. Log, Kennung, Stufe;
  2. Trigger, generiert;
  3. Spiegel-, Herkunft-, Merker-, Ziel- und Antragstabellen und Anhang-Abruf;
  4. `admin_audit`-Aktionen.
- **Rückweg:** Die Trigger schaden ohne Kopplung nicht. Ein Zurücksetzen der Software lässt
  Spiegel als gewöhnliche Einsätze stehen.
- **Ältere Gegenseite:** Protokoll 1 spiegelt nicht und bekommt einen Hinweis. Sobald beide
  Seiten auf 2 sind, beginnt der erste Abgleich bei Stand 0.
