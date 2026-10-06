# Design

## Context

`Zeitachseneintrag` hat drei Spalten: Zeit/Nr., Inhalt (Typwort + Meta, Text, Hinweis) und rechts
eine senkrechte Spalte mit Verfasser (`maxWidth: 15ch`, bricht um), Meldeweg und `aktionen`. Die
Zeilenhöhe hängt an dieser Spalte. Die Dichte steht im antd-Token (`controlHeight` 30/48/72);
das Muster im Projekt ist eine reine, exportierte Funktion über dem Token (`zielEinzug.ts`,
`platzBedienform` im Grundriss), nicht `useDichte()`.

Neun Verwender reichen `aktionen`; nur das ETB reicht ein ⋮-Menü (`MenueAusloeser`), die anderen
Text-Knöpfe („Zurücknehmen“, „Streichen“) oder eine Statuswahl. Der ETB-Filter läuft über
`filter_merkmale` → `EtbZaehlFilter` → `filter_bedingung` (eine Quelle für Liste und Zählungen,
LFH-612); im Client über `EtbFilterWerte`/`filterParameter`, `etbPfad`/`parseEtbFilter`, und der
Filter ist Teil der Query-Keys.

## Goals / Non-Goals

**Goals**
- Einzeiliger Eintrag in kompakt ≤ ~56 px, ≥ 9 Einträge zwischen den Leisten bei 1440×900.
- Systemeinträge aus- und einblendbar, Kopfzahl und Bilanz über denselben Filter.

**Non-Goals**
- Ausschluss beliebiger Typen (Mehrfachauswahl). Nur `system`, das ist der beobachtete Lärm.
- Eine dauerhafte Personenvorgabe für den Schalter (Präferenz-Fach). Die URL reicht für Neuladen
  und Teilen; die Vorgabe bleibt „sichtbar“.
- Andere Dichtestufen umbauen.

## Decisions

### D1 Dichte aus dem Token: `zeitachsenAufbau(token)`

Reine Funktion in `Zeitachseneintrag.tsx`: `controlHeight < 48` → `'zeile'`, sonst `'spalte'`.
- **`zeile` (kompakt):** Verfasser und Weg als Mono-Meta in der Kopfzeile nach Typwort und Meta,
  getrennt durch `·`; der Verfasser `whiteSpace: nowrap`, `overflow: hidden`, `textOverflow:
  ellipsis`, `maxWidth: 24ch`, `title` mit dem Volltext. Die rechte Spalte entfällt, wenn nur
  ein `menue` da ist; `aktionen` (Text-Knöpfe) bleiben rechts, ohne Verfasser darüber.
- **`spalte` (komfortabel, Handschuh):** unverändert, das Menü steht dort, wo heute `aktionen`
  steht.

Verworfen: Steuerung über `useDichte()` — unter einem lokal überschriebenen Theme liefen Höhe und
Aufbau auseinander (Begründung in `zielEinzug.ts`). Verworfen: Umbau nur per Prop je Verwender —
die Dichte ist eine Eigenschaft des Arbeitsplatzes, nicht der Seite.

### D2 Neue Eigenschaft `menue` neben `aktionen`

`menue?: ReactNode` nimmt das ⋮-Menü einer Zeile. In `zeile` steht es am Ende der Kopfzeile
(`marginInlineStart: auto`), in `spalte` in der rechten Spalte wie heute. Das ETB reicht sein
`MenueAusloeser` über `menue`; abgelehnte gepufferte Zeilen („Erneut senden“/„Verwerfen“) bleiben
`aktionen`. Damit ändert sich bei den übrigen Verwendern nur, dass Verfasser und Weg in kompakt in
die Metazeile wandern. Der Knopf behält seine Trefffläche (`controlHeight` 30 in kompakt).

### D3 Server: `ohne_system: Option<bool>`

Wire `ohne_system=true` wie die übrigen Schalter (`nur_offen` an den Erinnerungen); `false` und
fehlend sind gleich. Er läuft nur über `filter_merkmale` in `EtbZaehlFilter.ohne_system` und
`filter_bedingung` (`AND e.typ <> 'system'`); Liste, `zaehler` und `anzahl` erben ihn damit
zusammen. `typ=system` und `ohne_system=true` zusammen → `AppError::UnprocessableEntity` (422):
jedes Feld für sich ist gültig, erst die Kombination nicht (`src/AGENTS.md`,
Statuscode-Konvention). Kein Response-DTO ändert sich, kein Codegen.

### D4 Client: Schalter in der Filterleiste, Zustand in der URL

- `EtbFilterWerte.ohne_system?: true`; `filterParameter` setzt `ohne_system=true`.
  `parseEtbFilter` nimmt nur `true`/`1`, sonst nichts; `etbPfad` und `etbDruckPfad` schreiben ihn.
  Ausschalten schickt `undefined`, damit `filterZusammenfuehren` den Schlüssel entfernt.
- Schalter `Switch` „Systemeinträge zeigen“ im `zusatz`-Platz der Filterleiste (neben der
  Einheitenwahl), kontrolliert aus der URL. Daneben die Zahl: an → „98“ aus der Serverzählung;
  aus → „98 ausgeblendet“ aus einer zweiten Zählung mit demselben Filter ohne Ausschluss. Die
  zweite Abfrage läuft nur, solange der Ausschluss gilt (eigener Query-Key über den Filter).
- Er ist ein Filter: `filterAktiv` wird wahr, Kopf „n Treffer“, Bilanz „Bilanz im Filter“, unter
  `md` zählt er in „Filter (n)“. Die Systemzeile der Bilanz entfällt von selbst (0).
- Ein Typsegment schließt den Ausschluss nicht aus, mit einer Ausnahme: das Segment `system`
  (nur sichtbar bei `typ=system`) und der Schalter heben sich gegenseitig auf; die Seite schickt
  die abgewiesene Kombination nie.
- Druck: `druckAuswahl` nennt „ohne Systemeinträge“.

### D5 Sprung auf einen ausgeblendeten Eintrag

Der Deeplink-Effekt (Seitenfenster aus der vorigen Change) sucht wie bisher. Bleibt das Ziel
ungefunden und gilt `ohne_system`, ersetzt die Seite die URL durch denselben Pfad ohne
`ohne_system`, mit `eintrag`, und meldet „Systemeinträge wieder eingeblendet, um den Eintrag zu
zeigen“. Der zweite Durchlauf findet ihn oder räumt den Parameter wie bisher.

Verworfen: Schalter bei jedem Sprung vorab aufheben — ein Sprung auf eine Meldung soll den
gewählten Ausschluss nicht verlieren.

## Risks / Trade-offs

- **Andere Zeitachsen ändern ihre kompakte Gestalt** → gewollt und klein (Meta wandert in die
  Kopfzeile); jede wird im Vitest gegengeprüft, `gate3-trefflaeche` bleibt grün.
- **Ellipse beim Verfasser** → Volltext im `title`, und die Bilanz/der Druck tragen den Namen
  voll.
- **Zweite Zählung bei aktivem Ausschluss** → ein Abruf mehr je Live-Ereignis, nur solange der
  Schalter aus ist.

## Migration Plan

Keine. API additiv.
