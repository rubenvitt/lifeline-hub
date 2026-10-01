# Design

## Context

Motivation: siehe proposal.md. Hier nur der Bestand, der den Weg bestimmt (gegengeprüft am
01.10.2026 auf `origin/alpha` 49fed31):

- **Die drei Listen sind nicht seitenweise.** `GET …/personen` (`routes/einsatz_person.rs:liste`,
  nur `?status=`, `ORDER BY registrier_nr`), `GET …/tiere` (`einsatz_tier.rs:liste`, `status`,
  `spezies`, `halter_person_id`, `ORDER BY registrier_nr DESC`) und `GET …/schaeden`
  (`einsatz_schaden.rs:liste`, `status`, `typ`, `ausmass`, `geschaedigt_person_id`,
  `inkl_storniert`, `DESC`) liefern jeweils alles Nicht-Stornierte als `Vec`. Die
  Cursor-Schleife des ETB-Drucks (`etb/druckAbruf.ts`) wird hier nicht gebraucht.
- **Gates.** Liste, Detail und Export laufen alle über `EinsatzLesezugriff<Personen|Tiere|Schaeden>`
  (Org-Boden, `fordere_lesezugriff` samt Aufbewahrungsfrist, Modul-Gate,
  `einsatz/kontext.rs:130-145`). Der Export hat keine strengere Rolle als die Liste.
- **Zugriffsprotokoll.** `person_zugriff_audit` (`migrations/0021`) mit
  `CHECK (art IN ('detail','export'))`. Geschrieben wird beim Detail-GET (`detail`, mit
  `person_id`) und beim CSV-Export (`export`, `person_id NULL`), über
  `person/audit_repo.rs:anlegen`. Die Liste ist bewusst unprotokolliert („SSE-Refetch-Lärm“,
  `docs/superpowers/specs/2026-05-27-erfassung-personen-fundament-design.md`). Gelesen werden
  Protokollzeilen nur je Person (`liste_je_person`). Zeilen ohne `person_id` zeigt heute kein
  Endpunkt. Die Tabelle hat keine eingehenden Fremdschlüssel. Die Schwärzung behält alle
  Spalten (`schwaerzung_registry.rs:311-323`, `G_AUDIT`).
- **Seitenfilter stehen im Komponentenzustand, nicht in der Adresse.**
  - Personen: `PersonenSicht.filter` (`alle|erfasst|vermisst|betroffen|verstorben`) und
    `nurLuecken`, angewandt über `personen/personenFilter.ts:filterPersonen`.
  - Tiere: `TiereSicht` (`aktiv|vermisst|abgeschlossen|alle`, Vorgabe `aktiv`) und `spezies`,
    über `pages/tiere/tierHelfer.ts:filterTiere`.
  - Schäden: Sicht (`offen|uebergeben|abgeschlossen|alle`, Vorgabe `offen`), über
    `pages/schaeden/schadenHelfer.tsx:filterSchaeden`.
  - Freitextsuche und Spaltenfilter (Schäden: Typ, Ausmaß, Verortet) leben im
    `Datensicht`-Primitiv.
- **Die Druckbausteine aus LFH-22 sind fertig.** Sie stehen in `druck/AGENTS.md`:
  `Druckkopf` (`zeilen`, `sichtbarkeit`, `ebene`), `DruckKnopf` mit `gesperrt`, `useDrucken`,
  `druck.css` und das ETB-Seitenmuster `pages/EtbDruckPage.tsx` (403 → „kein Zugriff“, Fehler
  mit „Erneut laden“, Query nicht live, `refetchOnMount: 'always'`).

## Goals / Non-Goals

**Goals:**

- Drei Druckansichten aus einem gemeinsamen Seitenrahmen. Jede Ansicht bekommt nur eine
  eigene Tabelle und eine eigene Auswahl-Beschreibung.
- Ein Personendruck ohne Protokolleintrag ist ausgeschlossen: Der Server schreibt den Eintrag,
  bevor er Daten liefert.
- Eine Abbildung Filter → Menge: Die Druckseite filtert mit denselben reinen Funktionen wie
  die Liste.

**Non-Goals:**

- Freitextsuche und Spaltenfilter der `Datensicht` gehen nicht in den Druck ein. Der Kopf nennt
  genau die übernommene Auswahl, damit das Papier ehrlich bleibt.
- Kein Druck einzelner Datensätze (Personenakte, Schadensblatt). Das wäre ein eigener Task
  (`docs/superpowers/specs/2026-05-27-erfassung-sichtung-medizinischer-verlauf-design.md:318`).
- Kein CSV-Knopf im Frontend und keine Änderung an den CSV-Exporten.
- Keine Einsicht in listenweite Protokollzeilen (`export`, `druck`). Diese Lücke besteht heute
  schon für `export`. Sie ist als Folge-Task LFH-916 erfasst und wird hier nicht geschlossen.
- Kein Protokoll beim Tier- und Schadensdruck. Tiere führen keine besondere Kategorie, und das
  Tier-CSV ist ebenfalls unprotokolliert. Personenbezüge in Schäden (Geschädigte) erscheinen
  dort nur als Registriernummer oder als Name aus dem Personal- bzw. Organisationsbestand.

## Decisions

### D1 — Eigener Endpunkt `GET …/personen/druck` mit Protokollart `druck`

Der Handler `einsatz_person::druck` nutzt dasselbe Gate wie die Liste
(`EinsatzLesezugriff<Personen>`). Er schreibt zuerst
`audit_repo::anlegen(pool, einsatz_id, None, benutzer.id, "druck")` und lädt danach
`repo::liste(pool, einsatz_id, None)`. Er antwortet mit `Vec<PersonAnzeige>`, also mit genau
dem DTO der Liste. Scheitert der Eintrag, endet der Aufruf mit 500 und ohne Daten. Ein Fehler
beim Laden danach hinterlässt einen Eintrag ohne Auslieferung. Das ist die sichere Richtung,
denn das Protokoll nennt dann einen Abruf zu viel, nie einen zu wenig.

Der Endpunkt nimmt **keinen** Statusfilter. Gefiltert wird im Client mit `filterPersonen`,
denn der Schalter „nur offene Felder“ (`hatLuecke`) ist reine Client-Logik. Eine zweite
Filterkopie auf dem Server liefe sonst auseinander. Das Protokoll hält fest, dass die
Personenliste des Einsatzes zum Druck abgerufen wurde; die Auswahl hält es nicht fest.

Die Statische Route `…/personen/druck` steht neben `…/personen/export`. axum zieht statische
Segmente vor `{pid}` vor, wie beim Export. Ein Eintrag in `zulassung.rs` entfällt: Der Abruf
kostet so viel wie die Liste, die dort ebenfalls nicht steht. Der CSV-Export steht dort wegen
des Aufbaus im Speicher.

*Verworfen (Entscheidung PO, 01.10.2026):*
- *Art `export` wiederverwenden.* Das hätte die Migration gespart. Druck und CSV wären im
  Protokoll aber nicht mehr zu unterscheiden gewesen.
- *Client-Druck ohne Protokoll.* Papier mit Name und Sichtung hätte das System dann ohne Spur
  verlassen, anders als beim CSV.
- *Protokoll-Ping `POST …/personen/druck-protokoll` beim Klick auf „Drucken“.* Der Eintrag
  läge dann näher am Druckmoment, aber die Daten kämen weiter über die unprotokollierte Liste.
  Ein Client, der den Ping auslässt, druckte ohne Spur. Auch der gewählte Weg weiß nicht, ob
  wirklich Papier entsteht. Er weiß aber sicher, wer die Druckfassung erhalten hat.

### D2 — Migration 0132: CHECK-Rebuild einer Blatt-Tabelle

`migrations/0132_person_zugriff_audit_druck.sql` folgt Zeile für Zeile dem Blatt-Rebuild aus
0112 (`person_verbleib`, LFH-613), dem nächsten Vorbild im Projekt:

1. `-- no-transaction` am Dateianfang, wie 0112.
2. `CREATE TABLE person_zugriff_audit_neu` mit gleichen Spalten, Fremdschlüsseln und
   Spaltenkommentaren und `CHECK (art IN ('detail','export','druck'))`. Die Kommentare bleiben
   wortgleich, weil SQLite sie in der gespeicherten DDL mitführt.
3. `INSERT … SELECT` mit allen Spalten, die ids bleiben erhalten.
4. `sqlite_sequence` der Alt-Tabelle übernehmen, `DROP TABLE`, `RENAME`.
5. `idx_person_audit_einsatz` neu anlegen.

Die Tabelle hat keine eingehenden Fremdschlüssel (`grep` über `migrations/` bestätigt das).
`PRAGMA foreign_keys = OFF` braucht es deshalb nicht. Abgesichert ist das wie bei 0112 durch
zwei Tests in `src/db.rs`. Sie laufen auf einer befüllten 0021-DB mit `include_str!`. Geprüft
wird, dass Zeilen samt ids, Sequenz und Schema erhalten bleiben, dass die DDL sich nur im CHECK
unterscheidet und dass `foreign_key_check` leer ist. Die Nummer wird vor dem Merge mit
`scripts/check-migrationen.sh` gegen `origin/alpha` geprüft.

`ZugriffArt` bekommt `Druck`. Doc-Kommentar und Schema-Anker nennen die neue CHECK-Quelle 0132.
`tests/enum_wire_kontrakt.rs` und der Codegen (`scripts/check-typ-codegen.sh`) ziehen nach.
Die Spalte „Art“ der Protokolleinsicht je Person bleibt, wie sie ist: Druckzeilen haben keine
`person_id` und erscheinen dort nicht.

### D3 — Gemeinsamer Seitenrahmen `druck/ListenDruckSeite.tsx`

Die drei Seiten teilen Aufbau und Zustände. Das sind `EinsatzSeite` mit Titel
„<Modul> – Druckansicht“, die Aktionen „Zurück zu <Modul>“, „Neu laden“ und `DruckKnopf`
(primär, gesperrt bis geladen), außerdem 403 → „Kein Zugriff“ ohne Knöpfe, ein Fehler mit
„Erneut laden“, das Laden mit `role="status"` und die eine Druckwurzel mit
`Druckkopf sichtbarkeit="immer" ebene={2}`. Der Rahmen bekommt `dokumentart`, `zurueckPfad`,
den Query-Zustand, die Kopfzeilen (Auswahl, Umfang, Stand), einen optionalen Hinweis am
Bildschirm (Personen: „Das Öffnen dieser Druckansicht wird im Zugriffsprotokoll vermerkt.“)
und die Tabelle als `children`. Die Leermeldung „Keine Einträge in dieser Auswahl“ setzt der
Rahmen.

`EtbDruckPage` wird **nicht** auf den Rahmen umgestellt, weil der Gewinn gering und das Risiko
eine Regression ohne Anlass wäre. Ein Kommentar im Rahmen verweist auf das Vorbild.

*Verworfen:* drei eigenständige Seiten nach dem Muster von `EtbDruckPage`. Das wären dreimal
dieselben Zustände und dreimal dieselben Tests für 403, Fehler und Sperre.

### D4 — Daten und Query-Keys

| Seite | Abruf | Key (neuer Präfix, `NICHT_LIVE_KEYS`) | Filter |
|---|---|---|---|
| Personen | `ladePersonenDruck(einsatzId)` → `GET …/personen/druck` | `einsatzKeys.personenDruck(einsatzId)` | `filterPersonen` im Client |
| Tiere | `listeTiere(einsatzId, {})` | `einsatzKeys.tiereDruck(einsatzId)` | `filterTiere` im Client |
| Schäden | `listeSchaeden(einsatzId, {})` | `einsatzKeys.schaedenDruck(einsatzId)` | `filterSchaeden` im Client |

Alle drei laufen mit `staleTime: Infinity`, ohne Refetch bei Fokus oder Reconnect und mit
`refetchOnMount: 'always'` (Begründung wie beim ETB-Druck: Schnappschuss, nicht der Cache des
letzten Besuchs). Personen zusätzlich mit `retry: false`, denn jeder Versuch ist ein
Protokolleintrag (Vorbild `PersonenDetailPage`, Detail-Query). Der Filter gehört nicht in den
Key: Er wählt nur aus der geladenen Menge aus, und ein Filterwechsel darf keinen zweiten
protokollierten Abruf auslösen. Die Keys bleiben außerhalb von `LAGEBILD_OFFLINE`, wie der
ETB-Druck. Für Tiere und Schäden wird bewusst ein eigener Präfix genommen und nicht
`einsatzKeys.tiere`/`schaeden`, denn diese sind live, und ein SSE-Ereignis schöbe sonst neue
Zeilen in die offene Druckansicht.

Personen-Verbleib braucht die UHS-Namen (`verbleibText(p, uhsName)`). Sie gehören zum selben
Schnappschuss: Der Abruf der Druckseite lädt `listeUhs` neben dem Druck-Abruf. Ein Fehler dort
(Modul gesperrt) ergibt eine leere Liste, dann steht „UHS“ ohne Namen, und gedruckt werden kann
trotzdem. Den live gehaltenen UHS-Key nutzt die Seite nicht, sonst änderte eine Umbenennung die
offene Ansicht.

Die Seiten reichen die Felder der Abfrage einzeln an den Rahmen weiter (`ListenDruckAbfrage`),
nicht das Ergebnisobjekt. `useQuery` beobachtet nur die Felder, die beim Rendern gelesen
werden. Der Rahmen liest den Fehler erst, wenn der Einsatz geladen ist. Ein früher Fehler
blieb deshalb unsichtbar auf „wird geladen“ stehen, und ein Seitentest hat das aufgedeckt.

### D5 — Adresse und Auswahl in Worten

Die Pfadbauer stehen in `routing/deeplinks.ts`, gebaut über `einsatzModulPfad` und `mitQuery`.
Die Parser verwerfen unbekannte Enum-Werte ganz, über erschöpfende `Record<…, true>`-Tabellen:

- `personenDruckPfad(einsatzId, { filter, nurLuecken })` → `?filter=<status>&luecken=1`.
  `alle` und `false` entfallen. Parser: `parsePersonenDruckAuswahl`.
- `tiereDruckPfad(einsatzId, { sicht, spezies })` → `?sicht=…&spezies=…`. `alle` entfällt.
  Parser: `parseTiereDruckAuswahl`. Ein fehlender Wert heißt `alle`, **nicht** die Vorgabe
  `aktiv` der Liste. Die Liste übergibt ihre Sicht immer ausdrücklich.
- `schaedenDruckPfad(einsatzId, { sicht })` → `?sicht=…`. Parser:
  `parseSchaedenDruckAuswahl`. Ein fehlender Wert heißt `alle`.

Die reinen Funktionen `personenDruckAuswahl`, `tiereDruckAuswahl` und `schaedenDruckAuswahl`
liefern die Kopfzeile „Auswahl“ aus den Labels der Listen (`FILTER_OPTIONEN`, `TIER_STATUS`,
`SPEZIES_META`, die Sichten der Schadensliste). Beispiele sind „Status: Vermisst · nur offene
Felder“, „Sicht: Vermisst · Spezies: Hund“ und, ohne Filter, „alle Personen“, „alle Tiere“
bzw. „alle Schäden“. Die Labels der Schäden-Sichten wandern dafür aus `SchaedenPage.tsx` nach
`schadenHelfer.tsx`, damit Liste und Kopf dieselbe Quelle haben. „Umfang“ nennt die Anzahl,
„Stand“ den Ladezeitpunkt in der Org-Zeitzone (`useAnzeigeKonventionen`, wie beim ETB).

Die Routen `personen/druck`, `tiere/druck` und `schaeden/druck` stehen in `App.tsx` neben
`etb/druck`. React Router zieht statische Segmente vor `:personId` usw. vor.

### D6 — Tabellen

Jede Modultabelle (`personen/PersonenDruckTabelle.tsx`, `pages/tiere/TiereDruckTabelle.tsx`,
`pages/schaeden/SchaedenDruckTabelle.tsx`) legt nur ihre Spalten fest und ordnet aufsteigend
nach `registrier_nr`. Gerendert wird über `druck/DruckTabelle.tsx`, ein schlichtes `<table>`
mit `thead` nach dem Vorbild `EtbDruckTabelle`. Es ist weder `KatalogTabelle` noch
`Datensicht`, weil die Druckansicht kein Bedienort ist. Es gibt keine Sortierung und keine
Links. Kopfwiederholung und „Zeile nicht über den Rand“ trägt `druck.css`. Die Zellen sind
reiner Text, Labels und Nummern kommen aus den Helfern der Listen.

- **Personen:** Nr. · Name · Geschl./Alter (`geschlechtAlter`) · Sichtung (Wort aus
  `SK_META`, ohne Farbe; sonst „ohne Sichtung“) · Status · Fundort (mit Koordinate) · Verbleib
  (`verbleibText`) · erfasst (Org-Zeit).
- **Tiere:** Nr. · Status · Spezies · Rufname · Rasse · Halter (R-Nummer, ggf. „(storniert)“,
  sonst Kontakt, sonst „unbekannt“) · Antreffort · erfasst.
- **Schäden:** Nr. · Typ · Ausmaß · Ort · Status (bei Übergabe „übergeben an …“) · Geschädigt
  (`geschaedigtText`, ohne Deeplink) · erfasst. Die Spalte „Verortet“ entfällt, weil sie eine
  Frage vor der Karte beantwortet.

### D7 — Einstieg auf den Listen

`PersonenPage`, `TierePage` und `SchaedenPage` bekommen im Kopf-Slot `aktionen` den
sekundären Link-Knopf `druck/DruckAnsichtKnopf.tsx` („Drucken / als PDF“) auf den jeweiligen
Druckpfad mit dem aktiven Seitenfilter. Er funktioniert wie der ETB-Knopf: `href` und `navigate`, Strg/⌘-Klick öffnet
einen Tab. Er schickt nichts ab, deshalb steht er im Kopf. „Genau eine Primäraktion“ bleibt
erfüllt. Er erscheint unabhängig vom Schreibrecht, denn Drucken ist Lesen.

### D8 — Regel an einer Stelle

`frontend/src/druck/AGENTS.md` bekommt einen Block „Modul-Listen-Druck (LFH-727)“: der Rahmen,
die drei Seiten, „Personendruck lädt nur über `GET …/personen/druck` (Protokollart `druck`,
`retry: false`), nie über die Liste oder ihren Cache“ und Druck-Keys außerhalb des
Offline-Lagebilds. `src/AGENTS.md` bekommt keinen Eintrag, weil die Regel dort steht, wo ihr
Client-Anteil liegt (Muster der Wurzel-`AGENTS.md`).

## Risks / Trade-offs

- [Das Protokoll weiß nicht, ob tatsächlich gedruckt wurde] → Bewusst so gewählt (D1): Es
  hält fest, wer die Druckfassung erhalten hat. Die Druckansicht sagt das am Bildschirm.
- [Mehrfachzeilen durch erneutes Öffnen] → Jede Öffnung und jedes „Neu laden“ ist ein echter
  Abruf und wird ehrlich gezählt. `retry: false` verhindert Zeilen aus automatischen
  Wiederholungen. React StrictMode ruft im Entwicklungsbetrieb Effekte doppelt auf, die
  Abfrage von TanStack Query aber nur einmal je Mount. Der Test der Seite zählt die Aufrufe.
- [Druckzeilen sind nirgends einsehbar] → Gleiche Lage wie heute bei `export`. Die Zeilen
  bleiben erhalten (Schwärzung: `retain`) und sind für eine Auskunft per Datenbank greifbar.
  Eine Einsicht folgt als eigener Task (s. Non-Goals).
- [Druck zeigt mehr als der Bildschirm, wenn dort gesucht wurde] → Der Kopf nennt die Auswahl
  in Worten, Suche und Spaltenfilter gehören nicht dazu. Das steht im Non-Goal und in der
  Spec.
- [CHECK-Rebuild verliert Zeilen] → Der Rebuild kopiert alle Spalten. Ein Migrationstest legt
  vor 0132 Zeilen beider Arten an und prüft sie danach, samt `sqlite_sequence`.
- [Große Lage (≥ 2 000 Personen)] → Es ist ein Abruf wie die Liste. Die Dauer der
  Druckvorschau liegt beim Browser.

## Migration Plan

Die Migration ist additiv in der Wirkung: Eine Art kommt dazu, die Daten bleiben. Vor dem
Merge `git fetch` und `scripts/check-migrationen.sh`, bei Bedarf `--umnummerieren`. Rückweg:
Ein älteres Binary kennt `druck` nicht, liest die Tabelle aber weiter (`art` ist `String`), und
Druckzeilen erscheinen in keinem Lesepfad. Die Frontend-Seiten haben keinen Datenanteil.
