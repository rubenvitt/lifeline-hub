# Design

## Context

Motivation: `proposal.md`, „Why“. Ist-Zustand am Code (Scope vom 16.11.2026):

- `PATCH /api/einsaetze/{id}/einheiten/{eid}` (`routes/einsatz_einheit.rs::update`) ruft
  `einheit::repo::patche` (ein UPDATE der Spaltenfelder) und danach getrennt `setze_fuehrer`,
  `sprechgruppe::repo::setze_einheit_sprechgruppen` und `verbindungen::ersetzen`, jeweils auf dem
  Pool. Kein Vergleich, keine gemeinsame Transaktion. `einsatz_einheit` hat kein `geaendert_at`.
- `PATCH /api/einsaetze/{id}` (`routes/einsatz.rs::aktualisieren`) ruft `einsatz::repo::patche_kopf`
  (ein UPDATE). Kein Vergleich, `einsatz` hat kein `geaendert_at`.
- `PATCH /api/einsaetze/{id}/fuehrungsstelle` läuft über `einsatz::fuehrungsstelle::patch_tx` in
  einer Transaktion, ohne Vergleich; der Einsatzleiter-Wechsel schreibt dort den Übergabe-Eintrag.
- Den Feld-CAS gibt es schon: `person::repo::aktualisiere` mit `ExpectedValue` und je Spalte
  `AND <spalte> IS ?` (Text-Altwert `null` trifft auch Leerraum), Handler-Prüfung
  `pruefe_erwartet` (Koordinate als Paar, Altwert nur mit Änderung desselben Felds).
  Frontend: `Personendaten.tsx` hält den Wert beim Öffnen über `InlineAngabe.onOeffnen` fest und
  zeigt bei 409 den Dialog; `BearbeitbaresPaneel` nutzt Zeilen-CAS (`useEditSitzung`).
- Keine Ansicht zeigt „zuletzt geändert“; Präsenz-Infrastruktur gibt es nicht.

## Goals / Non-Goals

**Goals:**

- Einheit, Einsatzkopf und eigene Führungsstelle schreiben eine Einzelangabe nur, wenn ihr Altwert
  noch stimmt; alle Altwerte einer Anfrage und das Schreiben sind eine atomare Einheit.
- Ein Konflikt-Baustein im Frontend, den Einzelangaben und Personendaten teilen.
- Vermerk je Feld, im selben Schreibvorgang gesetzt, mit dem Datensatz geliefert.

**Non-Goals:**

- Die übrigen Schreibwege ohne Basisstand (Liste unter „Folgeaufgaben“).
- ETB-Einträge für Feldänderungen; Präsenzanzeige; Sperren.
- Zeilen-CAS für `einsatz` oder `einsatz_einheit`.

## Decisions

### D1 Feld-CAS mit `erwartet`, Baustein aus `person::repo` gelöst

Die drei Routen nehmen ein optionales `erwartet` mit denselben Feldnamen wie der Patch an,
dreiwertig (fehlt = kein Vergleich, `null` = leer erwartet). `ExpectedValue` und das Bauen des
SQL-Suffixes wandern in ein gemeinsames Modul (`src/feld_cas.rs`); `person::repo::aktualisiere`
nutzt es danach unverändert im Verhalten (eigener `refactor`-Commit, bestehende Tests als Netz).
Ein Konflikt ist `AppError::Conflict` mit „Das Feld wurde zwischenzeitlich geändert. Bitte neu
laden.“; 404 bleibt 404. Die Handler-Prüfung (Paar-Regel, Altwert nur mit Änderung) wird ebenfalls
gemeinsam: je Route eine Liste `(feld, im_erwartet, im_patch)` statt einer kopierten Funktion.

*Alternativen:* Zeilen-CAS über neues `geaendert_at` (verworfen: Status, Position, Sprechgruppen
einer Einheit ändern die Zeile ständig, das gäbe falsche 409, und es widerspricht der Entscheidung
der Personendaten); If-Match/ETag als Middleware (braucht ebenfalls einen Zeilenstand, weicht von
der Body-Konvention und dem 409-Vertrag ab); nur im Frontend vorher laden (nicht atomar).

### D2 Listen und Führer im selben Vorgang

Spaltenfelder bekommen das Suffix am UPDATE. Felder außerhalb der Zeile vergleicht der Server in
derselben Transaktion vor dem Schreiben:

- **Verbindungen** (Einheit, Führungsstelle): Altwert ist die Liste; verglichen wird die
  normalisierte Form, die `verbindungen::pruefe_liste` ohnehin bildet, gegen die gespeicherte
  Liste in Reihenfolge.
- **Führungsfahrzeuge**: Menge der Dispositions-IDs, ohne Reihenfolge.
- **Einheitsführer**: `fuehrer_id` ist eine Spalte; `setze_fuehrer` bekommt eine `_tx`-Form mit
  Suffix.
- **Einsatzleiter**: Altwert ist `{art, personal_id | name}` des aktuellen Leiters (ohne `seit`),
  `null` = keiner.
- **Soll-Stärke**: drei Spalten, gemeinsam erwartet; **Qualifikationssoll**: gespeicherte Form
  (Text) nach `quali_soll::form_tri`.

Der Einheit-Handler fasst `patche`, Führerwechsel und Verbindungen dafür in **eine**
Schreibtransaktion (`BEGIN IMMEDIATE`), die Sprechgruppen bleiben danach eigene Schritte wie bisher
(LLH-1692). Der Kopf ist schon ein UPDATE, die Führungsstelle schon eine Transaktion. ETB-Einträge
und Live-Ereignisse entstehen erst nach dem Commit, also nie bei 409.

### D3 Vermerk-Tabelle `einsatz_feld_vermerk`

```
einsatz_feld_vermerk(
  id            INTEGER PRIMARY KEY,
  einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
  objekt_art    TEXT    NOT NULL CHECK (objekt_art IN ('einsatz','einheit','fuehrungsstelle')),
  einheit_id    INTEGER REFERENCES einsatz_einheit(id) ON DELETE CASCADE,  -- nur bei 'einheit'
  feld          TEXT    NOT NULL,   -- Wire-Feldname; Soll-Stärke als 'soll', Koordinaten als
                                    -- 'einsatzort_koordinate' bzw. 'standort_koordinate'
  geaendert_at  TEXT    NOT NULL,
  geaendert_von INTEGER REFERENCES benutzer(id),
  CHECK ((objekt_art = 'einheit') = (einheit_id IS NOT NULL))
)
UNIQUE INDEX (einsatz_id, objekt_art, IFNULL(einheit_id, 0), feld)
```

Eine echte, optionale `einheit_id` mit Fremdschlüssel statt einer polymorphen `objekt_id`: der
Spiegel kennt Fremdschlüssel auf gespiegelte Tabellen ohne Sonderliste, und das Auflösen einer
Einheit räumt ihre Vermerke mit ab. Geschrieben wird als „UPDATE, sonst INSERT“ in der
Schreibtransaktion, nur für Felder, deren gespeicherter Wert sich wirklich ändert (Vergleich gegen
den in der Transaktion gelesenen Vorher-Stand). Die Feldnamen kommen aus einer festen Liste je
Route, nie aus der Anfrage.

Pflichten einer neuen Einsatztabelle (`src/AGENTS.md`, „Instanzkopplung“ und „Aufbewahrung“):
Eintrag in `einsatz::schwaerzung_registry::TABELLEN` (Scoping `EinsatzId`; `geaendert_von` als
Benutzer-FK wie an den übrigen Einsatztabellen, `feld` als Enum-artiger Strukturwert),
`instanz::spiegel::art` als `GESPIEGELT` mit Kategorie `Fuehrung` (wie Einsatz und Führungsstelle)
samt Triggern aus `trigger_sql` in derselben Migration, Archivspalten klassifiziert, Migration mit
Nummer größer als jede auf `origin/alpha` (heute 0352).

*Alternativen:* Stempel je Datensatz (`kopf_geaendert_at/von`) — billiger, sagt aber nicht welche
Angabe, und Einsatzdaten hat drei Paneele (vom Menschen verworfen); Ableitung aus dem ETB —
brüchig, verlangt ETB-Einträge (verworfen). `AUSGENOMMEN` im Spiegel — spart Trigger, aber ein
Spiegel zeigte dann keine Vermerke; gespiegelt passt zur Spec.

### D4 Lieferung im DTO

`EinsatzAnzeige`, `EinheitAnzeige` und `FuehrungsstelleAnzeige` bekommen
`vermerke: Record<string, { at: string; von: string | null }>` (`von` = Anzeigename, aufgelöst
per Join; fehlt der Benutzer, `null`). Für Einheitslisten lädt eine Abfrage alle Vermerke
`objekt_art = 'einheit'` des Einsatzes und verteilt sie in Rust, kein N+1. Die bestehenden
Live-Ereignisse (`einheit`, `kopf_geaendert`, Führungsstelle) tragen den Vermerk damit ohne neues
Ereignis. Typ-Codegen und beide generierten Dateien im selben Commit.

*Alternative:* eigene Route `GET …/feld-vermerke` mit eigenem Key — braucht Gate (ADR-0005),
Live-Ziel und Guard-Eintrag; der Mehrwert gegenüber dem DTO fehlt.

### D5 Frontend: Wert beim Öffnen und Hinweis in `InlineAngabe`

`InlineAngabe` friert beim Öffnen `wert` ein und reicht ihn als zweites Argument an
`onSpeichern(entwurf, { beimOeffnen })`. Weicht der Live-`wert` vom eingefrorenen ab, zeigt das
offene Feld den Hinweis „Inzwischen geändert[ von X, HH:MM]: <Anzeige>“ (Prop `vermerk` liefert Wer
und Wann). Der Entwurf bleibt. `BemerkungZelle` und `VerbindungenFeld` folgen demselben Vertrag,
soweit die drei Ansichten sie nutzen. Aufrufer ohne Interesse ignorieren das zweite Argument.

### D6 Ein Konflikt-Hook

`useFeldKonflikt` (neu, `components/`) kapselt den Ablauf aus `Personendaten.tsx`: speichern mit
Altwert → bei 409 Datensatz frisch laden → ist der Feldwert unverändert, Fehler an die Angabe →
sonst Dialog „Zwischenzeitlich geändert“ mit aktuellem Wert und Vermerk → „Meine Änderung
übernehmen“ speichert ohne Altwert, „Verwerfen und neu laden“ schließt, Escape gibt `OFFEN_LASSEN`.
Personendaten, EinheitKopf, EinheitFunk, EinsatzdatenPage und EinsatzleiterAngabe nutzen ihn.
Der Wortlaut entspricht dem Paneel (`formularseiten`).

### D7 Anzeige des Vermerks

An der Zeile als leise Nebenzeile/Tooltip „Geändert von X, HH:MM“ (Datum dazu, wenn nicht heute),
im Paneelkopf über den vorhandenen `meta`-Slot „Zuletzt geändert von X, HH:MM“ für die jüngste
Angabe des Paneels. Gestaltung nach `frontend/AGENTS.md` (Gestaltungssprache); keine Farbe, kein
Symbol, das nach Warnung aussieht.

### D8 Öffentliche API v1, Spiegel-Anträge, Warteschlange

`erwartet` bleibt optional. Ohne `erwartet` schreiben alle Wege wie bisher (alte Tabs,
Schreib-Warteschlange LFH-705, öffentliche API, Spiegel-Anträge). Der Vermerk entsteht auf jedem
Weg, der den Wert ändert (auch ohne `erwartet`), mit dem ausführenden Benutzer.

Dazu zählen die Wege, die eine Angabe nebenbei ändern (Review-Entscheidung 17.11.2026): das
Entlassen einer Person (Führer, Einsatzleiter) oder eines Fahrzeugs der Führungsstelle, das
Auflösen einer Einheit (Über-Einheit ihrer Kinder), der Abruf aus dem Bereitstellungsraum mit
Ziel-Abschnitt (nur bei Wechsel) und das Zuordnen oder Freigeben einer Person mit endender oder
zurückgesetzter Führung. Sie setzen den Vermerk in ihrer Schreibtransaktion. Ohne Benutzer (Tests,
Pool-Wrapper) bleibt er aus.

## Risks / Trade-offs

- [Einheit-Handler wird transaktional, Sprechgruppen bleiben außerhalb] → Sprechgruppen haben
  eigene idempotente Einzelwege; der Vertrag aus LLH-1692 bleibt für sie unverändert. Tests für
  Führer + Bemerkung in einer Anfrage mit 409 sichern „nichts geschrieben“.
- [Gleitkomma-Vergleich der Koordinate] → Altwert ist der vom Server gelieferte Wert unverändert
  zurück; `IS` auf REAL vergleicht exakt. Die Oberfläche rundet den Altwert nie.
- [Listenvergleich zu streng (Reihenfolge)] → Reihenfolge der Verbindungen ist fachlich
  sichtbar, also Teil des Werts; die Fahrzeugmenge ohne Reihenfolge.
- [DTO wird größer] → wenige Felder je Objekt; eine Abfrage je Liste.
- [Neue Tabelle mit Spiegel-Pflichten] → Wächter `jede_einsatztabelle_ist_eingeordnet`,
  `trigger_passen_zur_beschreibung`, `jede_gespiegelte_tabelle_hat_einen_primaerschluessel`
  schlagen an, wenn etwas fehlt.

## Migration Plan

Eine neue Migration (Nummer > höchste auf `origin/alpha`, vor dem Push mit
`scripts/check-migrationen.sh` prüfen). Bestandsdaten haben keine Vermerke; das ist der Zustand
„seit dem Anlegen nicht geändert“. Rückweg: die Spalte `erwartet` wird ignoriert, wenn ein
älterer Server läuft (unbekanntes Feld) — ein Downgrade verliert nur Prüfung und Vermerk.

## Folgeaufgaben (nicht in dieser Change)

1. LLH-1945: Übrige Schreibwege ohne Basisstand auf denselben Baustein: Einsatzabschnitt (Name,
   Kurzbezeichnung, Leiter, Verbindungen, Zuordnung per Ziehen), Dispositionen Personal,
   Fahrzeug, Material (Bemerkung, Einsatzfunktion, Position, Ort), Einsatzkraft-Seite,
   Betreuungsstelle, Programmpunkt, Gefahrengebiet-Name, Person PAT/Kontamination/Zustand,
   taktisches Zeichen (Positionsroute), Einsatzort per Ziehen auf der Lagekarte, Rufnamen aus der
   Fernmeldeskizze.
2. LLH-1946: Präsenzanzeige „wird gerade bearbeitet von …“ (zurückgestellt am 17.11.2026).
