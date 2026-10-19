# Design

## Context

Motivation steht in `proposal.md`, „Why“. Der heutige Stand (gemessen am 19.10.2026):

- **Verbleib** ist ein Verlauf (`person_verbleib`, angehängt, jüngste Erfassungszeit gewinnt;
  `src/person/verbleib_repo.rs`). Der Handler (`src/routes/einsatz_person.rs`, `verbleib`)
  schreibt Ereignis, Cache an `einsatz_person` (`aktueller_verbleib`, `aktuelle_verbleib_art`,
  `aktuelles_verbleib_ziel`, `aktueller_verbleib_status`), Auto-Austritt aus der UHS und ETB in
  einer Transaktion. Ohne Netz merkt der Schreibweg `personen/personEintragSpeichern.ts` vor.
- **`transportmittel`** ist Freitext ohne Bezug zu einem Fahrzeug. `status` kennt `angemeldet`
  und `abtransportiert`; die Oberfläche setzt nur `abtransportiert`.
- **Kein Standardweg blendet aus.** `GET …/personen` lässt nur Stornierte weg. Liste, Raster,
  Kartenansicht, Sichtungszeile, Seitenleiste, Lage-Dashboard, Lagekarte und Lagemonitor zeigen
  bzw. zählen entlassene Personen mit. Die UHS-Spalte „Auf Transport gebracht“ liest die
  Kurzform (`aktueller_verbleib.startsWith('Transport')`, `pages/uhs/uhsLage.ts`).
- **Fahrzeuge im Einsatz** liefert `GET …/fahrzeuge` nur mit Lesezugriff auf das Modul
  Fahrzeuge; die UHS-Geräte haben ihn nicht (`src/geraet/mod.rs`, `lese_module`).
- **Zwei Verbleib-Masken:** `VerbleibErfassung`/`useVerbleibFelder` (Liste, Kopf) und eine
  eigene im Grundriss (`ErfassungsModal<VerbleibWerte>`), die Betreuungsstelle und „Bestätigt
  von“ nicht kennt.
- Das **Sichtungsraster** ist `Datensicht` mit Gruppenachse (`PersonenPage.tsx`, Ansicht
  `raster`).

## Goals / Non-Goals

**Goals:**

- Ein Rechenweg für „abgeschlossen“: der Server leitet `versorgung` ab, jeder Client liest nur
  dieses Feld.
- Eigentransport ist ohne Fahrzeug aus dem Einsatz nicht speicherbar; die Übergabe ist ein
  Verlaufsereignis wie jedes andere, offline vormerkbar.
- Eine Verbleib-Maske für alle Ansatzstellen.

**Non-Goals:**

- Kein FMS-Automatismus (Status 8 oder 1 setzt keine Übergabe; Entscheidung 19.10.2026).
- Kein Vorschlag aus früheren Einsätzen (Entscheidung 19.10.2026: nur Einsatz und Stamm).
- Keine Änderung an Druck, CSV, Einsatzbericht und Zugriffsprotokoll: sie sind Nachweis und
  zählen weiter alle Personen.
- Der Personen-`status` (`erfasst`, `betroffen`, `verstorben`, `abgemeldet`) bleibt unberührt;
  `versorgung` ist eine zweite, abgeleitete Achse.
- Die Gerätefunktionsansichten (`GeraetPatientenPage`, `GeraetBetroffenePage`) behalten ihre
  Gruppen („In der UHS“ / „Ausgetreten“, Stelle); sie trennen schon nach Aufenthalt.

## Decisions

### D1 · Wer fährt: zwei Spalten am Verbleib-Ereignis

`person_verbleib` bekommt `transport_durch` (`fremd` | `eigen`, nur bei `art = 'transport'`)
und `einsatz_fahrzeug_id` (Verweis auf `einsatz_fahrzeug`, Pflicht bei `eigen`, sonst leer).
`status` bekommt den Wert `uebergeben`. Weil SQLite einen Spalten-CHECK nur per Rebuild ändert,
baut **eine** neue Migration (nächste freie Nummer über `origin/alpha`, heute 0222) die Tabelle
nach dem Muster von `0112_person_verbleib_notunterkunft.sql` neu, samt aller seither
hinzugekommenen Spalten (0121, 0165, 0217), Indizes und `sqlite_sequence`.

`einsatz_person` bekommt die Cache-Spalten `aktueller_transport_durch` und
`aktuelles_einsatz_fahrzeug_id`, gepflegt in derselben Anweisung wie die übrigen
Verbleib-Caches (`erfassen_tx`), mit Backfill aus dem jüngsten Ereignis.

Bestand: Transport-Ereignisse ohne `transport_durch` lesen sich als `fremd`. Das ist das
bisherige Verhalten (Transport = abgeschlossen), es ändert keine laufende Lage.

*Alternativen:* eigene Tabelle `person_uebergabe` — zweiter Verlauf neben dem Verbleib, zwei
„jüngste Stände“, die sich widersprechen können. Neue Verbleib-Art `eigentransport` — der
Transport hieße je nach Fahrer anders, jede Zählung nach Art bräche auseinander.

### D2 · Übergabe ist ein Verbleib-Ereignis mit `status = 'uebergeben'`

„Übergabe quittieren“ schreibt über die bestehende Route `POST …/verbleib` ein neues Ereignis
mit `art = 'transport'`, `transport_durch = 'eigen'`, demselben Fahrzeug, `status =
'uebergeben'`, dem Ziel (vorbelegt, änderbar) und der Erfassungszeit (Vorgabe jetzt,
nachtragbar über `zeitpunkt_at`). Dadurch gelten Verlauf, „jüngster Stand gewinnt“, Nachtrag,
Offline-Vormerken (`client_id`) und ETB ohne neuen Schreibweg. Der Client baut den Body in
**einem** Helfer (`uebergabeBody` in `verbleibErfassungKern.ts`).

Prüfungen im Handler, nach den bestehenden: `transport_durch` nur bei `transport` (422);
`eigen` ohne `einsatz_fahrzeug_id` (422); `einsatz_fahrzeug_id` ohne `eigen` (422); das
Fahrzeug muss zu diesem Einsatz gehören (404) und zur Erfassungszeit disponiert gewesen sein
(`disponiert_at ≤ zeitpunkt_at` und `beendet_at` leer oder danach, sonst 422) — so geht eine
vorgemerkte Übergabe auch nach der Entlassung des Fahrzeugs durch; `status = 'uebergeben'` nur
mit `eigen` (422). Stornierte Disposition gilt als nie disponiert.

Der Server übernimmt den Funkrufnamen als Momentaufnahme in `transportmittel`, damit Kurzform,
Verlauf und Schwärzung unverändert auf einem Text arbeiten.

ETB-Sachverhalt: `eigen` ohne Übergabe „im Eigentransport“, Übergabe „übergeben“; fremd bleibt
„abtransportiert“. Kein Ziel, kein Fahrzeug im ETB-Text (Scrub, wie heute).

Kurzform (`VerbleibArt::kurzform` bekommt Durch und Status): fremd „Transport → Ziel“, eigen
„Eigentransport 1/83-1 → Ziel“, übergeben „übergeben → Ziel“.

### D3 · `versorgung` leitet der Server ab

`PersonAnzeige` bekommt `versorgung: offen | unterwegs | abgeschlossen` (Wire-Enum, Typ-Codegen),
berechnet in Rust aus den Caches (`person::versorgung_von`, gesetzt von `PersonAnzeige::mit_versorgung`
nach jedem Lesen im Repo), nie gespeichert:

| aktueller Verbleib | versorgung |
| --- | --- |
| keiner, `vor_ort` | `offen` |
| `transport`, Status `angemeldet` | `offen` |
| `transport`, `eigen`, nicht `uebergeben` | `unterwegs` |
| `transport`, `fremd` oder leer, oder `uebergeben` | `abgeschlossen` |
| `entlassung`, `notunterkunft`, `verstorben` | `abgeschlossen` |

`vor_ort` bleibt offen: „verbleibt vor Ort“ beendet heute den UHS-Aufenthalt nicht, die Person
ist weiter bei uns (Annahme, nicht abgefragt). `angemeldet` bleibt offen, weil der Transport
noch nicht losgefahren ist. Eine Person im Status `vermisst` ist immer `offen`.

Der Lagemonitor (Rust, `src/routes/lagemonitor.rs`) und die TS-Verdichtung zählen nach
derselben Ableitung; die Tabelle gehört deshalb ins gemeinsame Fixture beider Sprachen (Spec
`lage-verdichtung`, „Gemeinsames Fixture für Regeln beider Sprachen“).

*Alternative:* Ableitung im Client — dann rechnete der Lagemonitor in Rust eine zweite.

### D4 · Vorschläge über eine schmale Route am Modul Personen

`GET /api/einsaetze/{id}/personen/transportmittel` (Lesezugriff Personen, also auch am
UHS-Gerät) liefert:

- `im_einsatz`: aktive Fahrzeug-Dispositionen (`einsatz_fahrzeug_id`, `funkrufname`,
  `fahrzeugtyp`), sortiert nach Funkrufname, locale `de`;
- `bisher`: eindeutige `transportmittel` aus Verbleib-Ereignissen dieses Einsatzes mit `fremd`
  oder ohne Durch-Angabe, nach Häufigkeit im Einsatz, dann alphabetisch;
- `stamm`: die Funkrufnamen des Fahrzeugstamms der Organisation, die nicht gerade im Einsatz
  disponiert sind, alphabetisch.

Dubletten über die Gruppen hinweg (ohne Groß-/Kleinschreibung) nennt nur die erste Gruppe.
Keine Kennzeichen, Besatzung oder Positionen: die Route weitet den Fahrzeugzugriff nicht aus.
Geschwärzte Ereignisse liefern nichts (ihr `transportmittel` ist leer). Query-Key
`einsatzKeys.personenTransportmittel`, live am `person`- und `fahrzeug`-Ereignis, im
Offline-Lagebild mitgeführt, damit die Maske ohne Netz Vorschläge zeigt.

*Alternative:* `GET …/fahrzeuge` und `GET /api/fahrzeuge` vom Client — die UHS-Geräte haben
dafür keinen Zugriff, und der Stamm liefert mehr, als die Maske braucht.

### D5 · Ein Feld „Rettungsmittel“ statt Schalter plus Feld

Die Maske hält ihr Budget (≤ 3 sichtbar: Art, Rettungsmittel, Ziel). „Rettungsmittel“ ist ein
`AutoComplete` mit drei Gruppen: „Im Einsatz“ (Wahl heißt Eigentransport), „Bisher verwendet“
und „Fahrzeugstamm“ (Wahl oder freier Text heißt fremd). Ein verstecktes Formularfeld trägt die
`einsatz_fahrzeug_id`; es wird bei Wahl aus „Im Einsatz“ gesetzt und bei jeder Texteingabe
geleert. Eine **Marke** am Feld sagt den Ausgang, kein Erklärtext: „Eigentransport“ (Rolle
`achtung`) oder „fremdes Rettungsmittel“ (neutral). Die Pflicht greift nur, wenn die Art
Transport ist: leer ist nicht speicherbar („Rettungsmittel angeben“).

Der Grundriss gibt seine eigene Maske auf und nimmt `useVerbleibFelder` (eine Maske je Vorgang,
`frontend/src/personen/AGENTS.md`, „Ein Schreibweg für die medizinischen Einträge“); die
Vorbelegung „Art Transport“ geht als `initialValues` mit.

*Alternative:* Segmentschalter „fremd | eigen“ plus Feld — vier sichtbare Felder, ein Schritt mehr
für den häufigen Fall.

### D6 · „Übergabe quittieren“ als Paneel bzw. kleiner Dialog

Wo ein Patient `unterwegs` ist, steht „Übergabe quittieren“: im Patientenkopf als eigenes
Paneel (Regel „immer nur ein Paneel offen“), in der UHS-Spalte „Unterwegs“ und im Zeilenmenü der
Betroffenenliste als `ErfassungsModal` mit zwei Feldern (Uhrzeit als `Zeiteingabe`-Textfeld,
Vorgabe jetzt; Ziel vorbelegt). Fahrzeug und Art stehen im Titel, nicht als Feld.

### D7 · „Abgeschlossene zeigen“ als Teil der Sicht

`PersonenSicht` (`personen/personenFilter.ts`) bekommt `abgeschlossen: boolean`, Vorgabe
`false`, in der Adresse als `?abgeschlossen=1`. `filterPersonen` lässt Abgeschlossene weg,
solange der Schalter aus ist; Zeilen, Board und Kartenansicht folgen dem automatisch. Der
Schalter steht in der Statusleiste als beschriftetes Kästchen mit Zahl („Abgeschlossene zeigen
(12)“). Sichtungszeile und Sichtungsbild der Seitenleiste zählen nur Nicht-Abgeschlossene, die
Verbleib-Zählung behält die Posten der Abgeschlossenen und trennt „Unterwegs“ vom Transport.
Die Sprungmarke „Patienten“ öffnet das Board ohne
Abgeschlossene.

Lagekarten-Ebene (`personen/personenKarte.ts`, `personenMarker`) und Lagemonitor lassen
Abgeschlossene immer weg. Das Lage-Dashboard zählt „Patienten“ ohne Abgeschlossene und trägt
„n abgeschlossen“ als Notiz; die Zeile „Transportiert / offen“ wird „Unterwegs / offen /
abgeschlossen“ (`personenBilanz.ts`, `transportBilanz` → `versorgungsBilanz`). Sprungpalette,
Detailseite, Druck und CSV bleiben vollständig.

*Alternative:* serverseitiger Filter `?aktiv=1` — die Liste ist ohnehin vollständig im Client
(Offline-Lagebild, Live-Abgleich); ein zweiter Abruf verdoppelte den Cache.

### D8 · UHS-Grundriss: Zeile in zwei Zeilen, Spalte „Unterwegs“

Die Zeile in „Noch nicht aufgenommen“ und „Wartebereich“ wird zweizeilig: oben die
Personenmarke über die volle Breite (Sichtung, Kennung, Name), unten links die Nebenangabe
(Wartezeit im Wartebereich, „erfasst vor n min“ unter „Noch nicht aufgenommen“), unten rechts
„Verbleib“ als Textknopf (`type="text"`, Steuerhöhe der Stufe, Wort sichtbar wie in LFH-970
U73). Damit steht der Name nicht mehr neben einem Wortknopf in 240 px. Hülle und Bedienziel
bleiben `markenZielStil`; Ziehen und „Person öffnen“ bleiben auf der Marke.

Die rechte Spalte heißt „Unterwegs“ und zeigt die aus dieser UHS ausgetretenen Personen mit
`versorgung = unterwegs` (Funkrufname, Ziel, Priorität, Knopf „Übergabe quittieren“). Der
Abwurf auf die Spalte öffnet weiter die Verbleib-Maske mit Art Transport. `transportiertAus`
wird `unterwegsAus` und liest `versorgung` statt der Kurzform; `uhsLage` zählt damit
„unterwegs“.

### D9 · Sichtungsboard als eigener Baustein

`personen/Sichtungsboard.tsx` ersetzt im Zweig `raster` die `Datensicht`. Spalten in der festen
Folge `SICHTUNGSBILD_REIHE`, **alle immer sichtbar** (eine leere Spalte schmal mit „0“): eine
stehende Folge springt bei Live-Updates nicht. Spaltenkopf: Sichtungsfarbe als Fläche nach
`sichtungsfarben` plus Wort und Zahl (zweiter Kanal). Karte: Kennung (Mono) und PAT-Nummer,
Name, „gesichtet vor n min“ (`useMinutenTakt`), Aufenthalt (UHS, Verbleib-Kurzform wie
„Eigentransport 1/83-1 → KH“, sonst Fundort), `PrioritaetMarke`, Marke „kontaminiert“. Innerhalb der Spalte die älteste
Sichtung oben (wie bisher). Die Karte ist ein Link zur Detailseite; das Umsichten geht über die
Sichtungsmarke der Karte (`ZeilenSichtung`-Popover, gleicher Schreibweg). Die Folge hält die
Zuflussschleuse wie in `PersonenSpalte` (`useZuflussSchleuse`). Ab `lg` stehen die Spalten
nebeneinander mit eigenem Bildlauf je Spalte; darunter stapeln sie sich, je Spalte einklappbar
(leere eingeklappt).

Das Board ist ein Überblick nach einer Achse, kein Umschalten derselben Liste zwischen Tabelle
und Karten. Die Regel „Kein Nutzerschalter Tabelle ↔ Karte“ (`frontend/AGENTS.md`) bekommt
diesen Satz als Abgrenzung.

## Risks / Trade-offs

- [Rebuild von `person_verbleib` auf großen Datenbanken] → die Tabelle ist klein (ein Ereignis
  je Verbleib); das Muster von 0112 ist erprobt und von `db::tests` abgesichert. Ein neuer Test
  prüft Zeilen, Sequenz, Indizes und den neuen CHECK.
- [Patient „hängt“ unterwegs, weil niemand quittiert] → die Spalte „Unterwegs“ zeigt die Dauer
  seit Abfahrt; ab 60 min trägt die Zeile die Marke „Übergabe offen“ (Rolle `achtung`). Kein
  Zwang, kein Toast.
- [Fahrzeug wird entlassen, während der Patient unterwegs ist] → der Patient bleibt unterwegs;
  die Übergabe geht über die Prüfung „zur Erfassungszeit disponiert“ durch.
- [Funkrufname als Momentaufnahme veraltet] → gewollt: der Verlauf zeigt, womit gefahren wurde.
- [Zählwechsel im Lage-Dashboard während einer laufenden Lage] → „Patienten“ sinkt um die
  Abgeschlossenen; die Notiz „n abgeschlossen“ nennt sie, damit niemand einen Datenverlust
  vermutet. Die Anwenderdoku nennt den Wechsel.

## Migration Plan

1. Migration 0222 (bzw. nächste freie Nummer, `scripts/check-migrationen.sh`) baut
   `person_verbleib` neu und ergänzt die Caches samt Backfill. Bestand ohne Durch-Angabe liest
   sich als fremd, also unverändert abgeschlossen.
2. Server und Client gehen zusammen aus (ein Release). Ein alter Client ohne die neuen Felder
   erfasst Transporte als fremd, wie bisher.
3. Rückweg: kein Down-Migrationspfad (Projektstandard). Ein älterer Server liest Ereignisse mit
   `status = 'uebergeben'` nicht (Decode von `VerbleibStatus`); ein Rückschritt über die
   Migration hinweg ist deshalb nicht vorgesehen.
