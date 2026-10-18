# Design

## Context

Motivation in `proposal.md`. Die ETB-Seite (`pages/EtbPage.tsx`) rollt am **Dokument**, nicht in
einem eigenen Container. Die Erfassung klebt als `fuss` unten, der Seitenkopf und ab `md` der Rahmen
kleben oben. Die Zeitachse (`etb/EtbZeitachse.tsx`) rendert die Serverordnung (neueste zuerst) in
Stundengruppen mit `content-visibility: auto`. Der Live-Zufluss friert über den Fokus ein
(`teileZufluss`/`einfrieren` in `etb/zeitachseModell.ts`). Das Seitenfenster
(`etb/seitenfenster.ts`) trägt die Richtung schon je Seitenparameter. `berichtigt_durch` liegt seit
LFH-689 am Wire, `gesichtet_lfd_nr` am Lesemarken-DTO. Der Zeiteingabe-Baustein (LLH-1070,
`anzeige/ZeitpunktEingabe.tsx`, `anzeige/zeitParser.ts:deuteZeit`, `anzeige/zeitSchnellwahl.ts`)
steht auf `alpha`. Die app-weite Formatregel für taktische Zeit (LLH-1053) steht noch aus.

Entscheidungen des Menschen (17.10.2026, LLH-1017): Option C mit Mitlaufen am Ende. Seite öffnet am
Ende, Lesemarke als Trennlinie. Filterband unten über der Erfassung. Absolute Grenzen; „seit LB“
nach Ereigniszeit mit Nachtrag-Hinweis. Zukunftssperre nur im Client. Berichtigung berichtigen
erlaubt, Chip reicht. Systemeinträge: Option B. „Werte behalten“ behält den Typ, die Typkante ist
ein Zusatzkanal.

## Goals / Non-Goals

**Goals:**
- Eine Leserichtung für ETB und Informationstelefon, ohne Server- oder Cursoränderung.
- Kein Sprung unter dem Cursor bei Nachladen oben, Zufluss unten und Bündeln.
- Gemerktes Rendern (LFH-947) bleibt: ein neuer Eintrag rendert keine fremde Gruppe neu.

**Non-Goals:**
- Kein Backend, keine Migration, kein Typ-Codegen. Kein Zukunftsriegel im Server (LFH-895 D4
  bleibt).
- Die Formatregel taktische Zeit app-weit (LLH-1053): neue Anzeigen dieses Changes nehmen die schon
  vorhandenen taktischen Formatierer (`anzeige/format.ts`). Bestehende `HH:mm`-Stellen bleiben, bis
  LLH-1053 sie umstellt.
- Typ-Mehrfachauswahl, Zeitfenster der Lagemeldungen, berichtigt-Kennzeichnung in Lage-Dashboard,
  Überblick und Lageentwicklung: Folgetickets.
- Design System „Lifeline Hub“ nachziehen (`Filterhinweis`, Umschalt-Variante der
  `Segmentleiste`, leise `Zeitachseneintrag`-Variante): ohne `DesignSync` in der Cloud-Sitzung nicht
  möglich, Nachzug über LLH-1147.

## Decisions

### D1 Spiegeln im Client, Ordnung am Rand der Zeitachse
`EtbZeitachse` bekommt die Zeilen weiter in Serverordnung und kehrt sie **nach** `teileZufluss` und
**vor** `gruppiereNachStunde` um. Die Kehrung steht als reine Funktion im Modell, damit Bilanz,
Druck, `letzteBerichtigungen` und Sprunglogik die Serverordnung behalten. `baueZeilen` stellt
gepufferte Zeilen ans **Ende** (gespiegelt: ausstehend, dann abgelehnt ganz unten über der
Erfassung). Die Alerts „offline vorgemerkt“ und „abgelehnt“ wandern unter die Zeitachse.
*Verworfen:* Umkehr in `EtbPage` (dann sähe jede Ableitung die gespiegelte Ordnung, Bilanz und
Sprung bräuchten eine zweite Lesart). Serverordnung umdrehen (Cursor, Zähler und Infotelefon-API
änderten sich, Migration der Clients ohne Gewinn).

### D2 Bildlauf: Ende halten, Anker bei Nachladen oben, Mitlaufen an der jüngsten id
Ein Hook `components/useFunkprotokollLauf.ts` trägt drei Dinge, alle am Dokument:
1. **Öffnen:** nach der ersten Lieferung ohne `?eintrag=` einmal ans Dokumentende rollen
   (`scrollTo({ top: scrollHeight })`, ohne Glättung).
2. **Am Ende?** Ein passiver `scroll`-Zuhörer hält `amEnde` (Abstand zum Ende ≤ eine Steuerhöhe).
   Die Zeitachse friert ein, wenn **nicht am Ende ODER Fokus darin**, und taut am Ende ohne Fokus
   wieder auf (vorher nur Fokus). Am Ende und ungefroren rollt ein `useLayoutEffect` an der
   **jüngsten gezeigten id** (nicht an der Länge, `frontend/AGENTS.md`) ans Ende. Eigene Einträge
   erscheinen immer (bestehende Regel in `teileZufluss`), und die eigene Erfassung rollt ans Ende
   (Antwort auf eine eigene Handlung, WCAG 3.2.5).
3. **Anker:** vor „Ältere laden“ (und beim Verdrängen der ältesten Seite durch „Neuere laden“)
   merkt der Hook die erste sichtbare Zeile samt `getBoundingClientRect().top` und rollt nach dem
   Commit um die Differenz. Die Zeitachse trägt `overflow-anchor: none`, damit Chromes eigenes
   Scroll-Anchoring nicht doppelt korrigiert; Safari kennt es ohnehin nicht.

**Wo das Ende liegt** (nachgetragen bei der Umsetzung): unter `xl` steht die Bilanz unter der
Zeitachsenspalte, das Dokumentende zeigte also die Bilanz statt Nr. 134 über der Erfassung. Das
Ende ist deshalb die Unterkante der Spalte direkt über der angepinnten Erfassung (Option `ende`
mit `--lfh-etb-fokusabstand`); wer weiter in die Bilanz rollt, gilt als am Ende und wird beim
Mitlaufen nicht zurückgezogen. Die Bilanz steht darunter um die Höhe der Erfassung abgesetzt, sonst
läge ihre Oberkante hinter der Erfassung im Fenster und rutschte bei jedem Mitlaufen (CLS, e2e
`leisten-flaeche` „Laden ohne Sprung“). Das Informationstelefon behält das Dokumentende.

Das Sammelbanner rückt vom oberen an den **unteren** Rand: es klebt über der Erfassung
(`bottom: var(--lfh-etb-fokusabstand)`), Text „N neue Einträge ↓“, „anzeigen“ taut auf und rollt
ans Ende. Das Hochrollen in `erfassenUndZeigen` entfällt. `zumKopf` bleibt für das tiefe Fenster
und rollt danach ans Ende.
*Verworfen:* eigener Bildlauf-Container für die Zeitachse (bricht klebenden Rahmen, Bilanzspalte,
Fokusabstand und alle Messungen der e2e). Nie selbst rollen (gegen die Entscheidung des
Menschen). `column-reverse` (kehrt Tab-Folge und Vorleserfolge um, WCAG 1.3.2).

### D3 Lesemarke als Linie in der Achse
`EtbLesemarkeBanner` wird zu `EtbLesemarke` mit zwei Formen. Ist `gesichtet_lfd_nr` als Eintrag im
gezeigten, ungefilterten Fenster und gibt es neuere, steht eine Trennzeile als eigenes Element
zwischen den Zeilen. Die Zeitachse bekommt dafür `markeNachLfdNr` und rendert die Linie in der
Gruppe nach dieser Zeile; die Gruppen-Memos bleiben, nur die Gruppe mit der Linie rendert neu.
Sonst steht dasselbe als Banner über der Zeitachse mit „Zur Marke springen“ (`?eintrag=` auf den
ersten ungesichteten bzw. die Marke). Der Text nimmt `formatZeitKurz` (taktisch).
*Verworfen:* an der Linie öffnen (gegen die Entscheidung).

### D4 Eine Filterleiste, die Leiste bleibt Zwei-Quellen-Bau
`EtbFilterleiste` behält Volltext (entprellt, eigener Zustand) und meldet nur ihre Schlüssel. Statt
`zusatz` hinten bekommt sie `vorn` (Typ-Segmente und System-Umschaltknopf) und `mitte` (Zeitraum,
Einheit) und ordnet Typ · System | Zeitraum · Einheit · Volltext (`flex: 1`, min. 180 px). Der
Umschaltknopf ist eine Variante der `Segmentleiste` (`umschalten`, ein Element, `aria-pressed`,
ausgeschaltet durchgestrichener Punkt als zweites Zeichen). Ab `md` fällt die Segmentleiste aus dem
Kopf. Unter `md` bleibt sie im Kopf, „Filter (n)“ wie heute. Die Mehrzahl von `lage` heißt
„Lagefeststellungen“ (nur `etbTypMehrzahl`).
Eine Zeile bei 1440×900 trägt die Breite nicht: Rail, offenes Modulpanel (ab `xl`) und
Bilanzspalte lassen rund 800 px, Typ-Segmente und System allein brauchen gut 600. Die Leiste bricht
deshalb in zwei Gruppen um, nie innerhalb der ersten (nachgemessen in der e2e, Ergebnis im PR).
Der Umschaltknopf ist ein eigener Export `SegmentUmschalter` neben der `Segmentleiste`, mit
denselben Klassen und derselben Geometrie.
*Verworfen:* eigener Instrument-Baustein „Umschaltknopf“ (die Segmentleiste trägt schon Punkt,
Einzug und Dichte). Zurücksetzen in der Leiste (das trägt nur das Band, Entscheidung). Eine Zeile
erzwingen (Felder würden unbedienbar schmal oder liefen über).

### D5 Zeitraum: reine Schnellwahl-Funktion, ein Bedienziel mit Aufklapper
`anzeige/zeitfenster.ts` liefert die Schnellwahl als reine Funktion
`zeitfensterWahl(art, jetzt, konv, letzteLb?) → { von, bis? }`, abgerundet auf die Minute, „Heute“
über `tagesgrenzen`. Dazu `zeitraumBeschriftung(von, bis, konv, letzteLb?)`: erkennt „seit LB“ und
„Heute“ durch Vergleich, sonst „seit 1345“ bzw. „101400–101500“ (taktisch). Das Bedienziel
`etb/EtbZeitraumWahl.tsx` ist ein Knopf mit `Popover` (am Handy und im Handschuh als Blatt über die
bestehende `useZeitBlatt`-Weiche). Darin stehen Schnellwahl-Knöpfe in Steuerhöhe und „Eigener
Zeitraum“ mit `ZeitraumEingabe`. Den Stand der letzten Lagebesprechung lädt die Seite über
`fetchLagebesprechungStand`, nur mit Freigabe `lagebesprechung` (LLH-1111).
*Verworfen:* relative Schlüssel in der URL (Entscheidung). Schnellwahl als neue Tabelle in
`zeitSchnellwahl.ts` (die gilt für Feldarten, nicht für Zeitfenster; die Spec `zeiteingabe` bleibt
unberührt).

### D6 Filterband `Filterhinweis` über der Erfassung
Neuer Baustein `components/instrument/Filterhinweis.tsx`: Fläche `achtungFlaeche`, 2-px-Kante
`achtung`, Text `achtungText`, alle aus der Statusrolle, keine eigene Farbe (Spec
`farbrollen-kontrast`, „Hinweisflächen kommen aus den Statusflächen“). Wort „Gefiltert“ vorn,
Merkmale in Mono, rechts Standardknopf „Filter zurücksetzen“, optional Zusatzzeilen (Eintrag
außerhalb, Nachträge). Die Seite hängt ihn in den `fuss` **über** die Erfassung, damit er auf
jeder Breite neben dem Blick steht und mit der Leiste klebt. Er zählt zum Höhenbudget der Leiste
(≤ 50 % der Fensterhöhe). `m` kommt aus `ladeEtbZaehler` ohne Filter (gleiches Präfix und gleiche
Bauart wie `systemZaehlerQuery`, kein Versatz der Sammelfenster). Die Merkmaltexte baut
`etb/filterMerkmale.ts` aus `EtbFilterWerte`; `druckAuswahl.ts` behält seinen Wortlaut.
**Eigener Eintrag außerhalb:** `useEtbErfassung.erfassen` gibt die Serverantwort zurück. Passt der
Eintrag nicht zum Filter (Typ, Einheit, `ohne_system`, Zeitraum, lokal prüfbar; bei Volltext steht
er nicht in der ersten Seite), setzt die Seite den Zusatz. **Nachträge vor LB:** bei
`von = LB-Zeit` fragt die Seite `listeEtb({ after_lfd_nr: lbLfdNr, bis: lbZeit, limit: 100 })` ab
und zählt (über 99: „99+“). Fehlt die laufende Nummer der LB, entfällt der Hinweis.
*Verworfen:* antds `Alert type="warning"` (keine Kante, zu hoch für das Budget). Modulzähler für `m`
(anderes Sammelfenster, kurz unpassende Zahlen).

### D7 Berichtigt aus dem Wire
`EtbZeitachsenZeile` liest `e.berichtigt_durch` (Server) statt `index.berichtigtDurch`. Der
`StatusChip ton="achtung" wort="berichtigt"` und der Link „→ Nr. n“ (jüngste) stehen im `meta`-Slot
der Kopfzeile. Weitere Berichtigungen stehen als Links in der Hinweiszeile. `berichtigungsindex`
behält nur `grundeintrag` (Vorwärtsrichtung). Das Menü bietet „Berichtigen“ an jeder gesendeten
Zeile. Die Berichtigungsleiste nennt die Kette über `grundeintrag`.

### D8 Systemeinträge: leise Variante und Bündel als Modellschritt nach dem Gruppieren
`Zeitachseneintrag` bekommt `leise` (Text `gedaempft`, `textKlein`). `vonAn` lässt die Zeile weg,
wenn beide Seiten `SYSTEM_RUFNAME` sind (Spiegel als Konstante in `etb/systemKennung.ts`). Die reine
Funktion `buendleSystemfolgen(gruppe.zeilen, { aus })` läuft **nach** `gruppiereNachStunde` je
Gruppe und liefert `EtbZeile | { art: 'buendel', schluessel, zeilen }`. Schlüssel des Bündels ist
die id seines **ältesten** Eintrags: die Folge wächst unten, der Schlüssel bleibt. Ein Bündel gilt
nur für schlichte Systemeinträge (kein `berichtigt_durch`, nicht nachgetragen, keine Anhänge,
Dokumente oder Verknüpfung). Unter `typ=system` und `q` ist es aus. Auf ist es, wenn sein
Schlüssel im Zustand `offen` steht oder `highlightId` darin liegt; das wird im Render entschieden,
nicht im Effekt, damit `scrolleZurZeile` die Zeile im selben Commit findet. Die Bündelzeile ist
`memo` mit eigener Gruppe.

### D9 Erfassung: Typwort, Typ behalten, `/zeit`, Zukunftssperre
- Präfix: `etbTyp[typ].label` in `etbTypFarbe(typ).wort` mit 2-px-Kante `kante`. Die Zeile bekommt
  dieselbe Kante als Opt-in `kante` an `Schnellerfassungszeile` (andere Nutzer unberührt). Das Menü
  zeigt Punkte wie die Segmentleiste.
- `nurUebernahme` nimmt `typ` mit, `useEtbEntwuerfe.neuerEntwurf(uebernahme)` startet mit dem
  übernommenen Typ. Ein neuer Reiter über „+“ startet als Meldung, weil er keine Übernahme ist.
- `/zeit`: `erkenneZeitBefehl(text)` in `schnellerfassungModell.ts` nach `erkenneTypBefehl`, Deutung
  nur über `deuteZeit(…, { art: 'ereignis', jetzt: serverJetzt() })`.
- Sperre: `zukunftsVerstoss(metadaten, serverJetzt())` neben `laengenVerstoss`, vor Upload und
  Warteschlange. Grund am Chip, Toleranz 60 s (wie `support::ZUKUNFT_TOLERANZ_SEKUNDEN`).
- Chip zeigt den Tag (`DDHHmm`), wenn die Ereigniszeit nicht heute ist.

### D10 Informationstelefon gleich gebaut
`InfotelefonPage` kehrt die Anrufliste beim Rendern, „Ältere laden“ steht oben, das Sammelbanner
unten über der Erfassung. Ein Deeplink-Anruf außerhalb der Seiten steht vorn (älteste Seite) statt
hinten. Öffnen am Ende, Mitlaufen und Anker nehmen denselben Hook aus D2 (nach
`components/useFunkprotokollLauf.ts` gehoben, beide Seiten nutzen ihn).

## Risks / Trade-offs

- [`content-visibility: auto` schätzt 600 px je Gruppe; das Rollen ans Ende landet vor der echten
  Höhe] → nach dem Rollen ein zweiter Rahmen (`requestAnimationFrame`), solange `amEnde` gilt. Die
  jüngsten zwei Gruppen bekommen `content-visibility: visible`.
- [Safari ohne Scroll-Anchoring rutscht, wenn eine Gruppe beim Sichtbarwerden ihre Höhe ändert] →
  hingenommen; die Anker-Korrektur deckt das Nachladen ab, nicht spätes Auslegen.
- [Mitlaufen ohne eigene Handlung berührt Festlegung 6] → nur am Ende ohne Fokus, also dort, wo
  nichts unter dem Cursor steht; sonst Sammelbanner. Entscheidung des Menschen.
- [Filterband im `fuss` frisst Höhe am Handy] → ein-, höchstens zweizeilig, Messung in
  `leisten-flaeche` (zwei Einträge im Bild auf 390 × 844 mit Filter), Ergebnis im PR.
- [Kontrast der Entscheidungs-Kante nachts ≈ 2,6 : 1] → Kante ist Zusatzkanal, das Typwort trägt
  die Information (Entscheidung). Folgeticket für die Palette.
- [Viele e2e hängen an der alten Leserichtung] → je Gruppe nachziehen. Ohne Server-Stack in der
  Cloud-Sitzung laufen sie in der CI des PRs (Schritt 7 von `check-all.sh`).

## Migration Plan

Reiner Frontend-Wechsel ohne gespeicherten Zustand. Rückweg ist ein Revert. Die URL-Form der Filter
bleibt (`von`/`bis`/`typ`/`einheit_id`/`q`/`ohne_system`), alte Links öffnen weiter.
