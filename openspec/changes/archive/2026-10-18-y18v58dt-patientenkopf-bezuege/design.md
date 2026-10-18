# Design

## Context

`pages/PersonenDetailPage.tsx` (1445 Zeilen) baut die Detailseite heute so:

- Zwei gleichrangige Spalten: Stammdaten links (`stammdatenSpalte`), Medizinisches rechts
  (`medSpalte`). Unter `lg` steht Medizinisches zuerst, beides in einem Baum (`Col` mit `order`).
- Rechts stehen Tags (Patient, SK, Verbleib), ein Notizformular mit Erklärtext in der Überschrift,
  `PersonVerlauf` und der Abgleich.
- Ein eingeklappter Abschnitt „Zuordnungen (Tiere, Schäden, UHS)“ mit drei Dialogen aus
  `personen/ZuweisungsDialoge.tsx`. Er lädt erst beim Aufklappen (Ladehoheit). Am Gerät ist er aus
  (`darf('person-zuordnungen')`).
- Sichten und Verbleib laufen über `SichtungDialog`/`VerbleibErfassung` (`ErfassungsModal`), der
  Status über ein Modal. `aktionenPlan` legt die Primäraktion fest.
- Das Detail ist nicht live, und jeder Detail-GET schreibt ein Lese-Audit. Statusmutationen mischen
  ihre Antwort per `setQueryData` ein.

`PersonDetail` liefert schon `aktuelle_sichtung_at`, `aktuelle_uhs_id`, `aktueller_platz_id`, den
Verbleib-Cache und je Sichtung `bestaetigt_name`. Es fehlen UHS-Bezeichnung, Platzbezeichnung und
„in der UHS seit“; Letzteres steht nur in `person_uhs_belegung`. Bausteine, die es schon gibt:
`ErfassungsFormular` (`components/Erfassung.tsx`, Inline-Hülle mit `speicherung`),
`Schnellerfassungszeile` und `Zeitachseneintrag` (`components/instrument/`), `BemerkungZelle`,
`formatDtg` (`anzeige/format.ts`) und `useMinutenTakt`. Für „vor n min“ gibt es drei lokale Kopien
(`auth/SitzungsListe.tsx`, `geraet/LagemonitorPage.tsx`, `pages/lage-dashboard/lagebild.ts`), aber
keinen geteilten Helfer.

## Goals / Non-Goals

**Goals:**
- Die Patientenfragen stehen oben, ohne Aufklappen und ohne Dialog.
- Sichten, Verbleib und Notiz gehen in der Ansicht.
- Der Aufenthalt steht im Kopf; Tier und Schaden werden eine Bezugsliste.
- Weiterhin ein Detail-GET je Öffnung.

**Non-Goals:**
- Personendaten feldweise bearbeiten (LLH-1103, Welle 2, wartet auf LLH-1101). Das Formular
  hinter „Bearbeiten“ bleibt in dieser Change erhalten und wird nur unter den Kopf umgehängt.
- Verletzungen, Maßnahmen und Körperschema (Welle 2, nach `juo02hfm-medizinischer-umfang`).
  Der Kopf zeigt nur vorhandene Daten (Regel „Keine erfundenen Daten“).
- Die Umstellung der drei lokalen „vor n min“-Kopien. Sie kommt als Folgetask aufs Board.

## Decisions

1. **Aufbau.** Die Seite hat eine Spalte mit Paneelen in fester Folge:
   1. Patientenkopf
   2. Verlauf
   3. Personendaten
   4. Bezüge
   5. Fotos und Dateien
   6. Zugriffsprotokoll

   Ab `xl` darf der Kopf intern zweispaltig sein: links Sichtung und Zustand, rechts Aufenthalt und
   Notiz. Die Ordnung mit `order` entfällt, es bleibt bei **einem** Baum. Das Bearbeiten-Formular
   der Personendaten hängt am Ort des Rasters und nie doppelt.
   - Verworfen: die zwei Spalten mit einem Kopf darüber. Dann stünden die Stammdaten wieder
     gleichrangig neben dem Verlauf.
2. **Patientenkopf als eigener Baustein** `personen/Patientenkopf.tsx` mit
   `{ person, darfSchreiben, geraet, onGeschrieben }`. Er wird später in der Schnellansicht
   (LLH-1137) in der Lesefassung wiederverwendet (`modus="lesen"`).
3. **Sichten im Kopf.**
   - Die Sichtung ist ein Knopf (Fläche in Sichtungsfarbe mit Kürzel, DTG und „vor n min“). Ein
     Tipp klappt darunter ein `ErfassungsFormular` mit `SichtungsWahl`, Kurzbegründung und am Gerät
     „Bestätigt von“ auf.
   - Die Felder werden aus `SichtungDialog` als `SichtungFelder` herausgelöst. Der Dialog bleibt
     für den Grundriss bestehen.
   - Nach Erfolg klappt das Formular zu, und die Person wird invalidiert. Wie heute ergibt das einen
     GET nach einer Schreibhandlung, beim Öffnen keinen zusätzlichen.
4. **Verbleib als Paneel.**
   - „Verbleib erfassen“ klappt ein `ErfassungsFormular` mit den Feldern aus
     `verbleibErfassungKern.ts` auf. Der Dialog `VerbleibErfassung` bleibt für den Grundriss
     (Transport) bestehen.
   - „verstorben“ fragt wie heute nach (LFH-363).
5. **Notiz.**
   - Der Kopf zeigt die letzte Verlaufsnotiz und eine `Schnellerfassungszeile` mit dem Platzhalter
     „Notiz“.
   - Die Überschrift mit Erklärtext entfällt (LFH-1078). Der Hinweis „nicht änderbar, erscheint
     nicht im ETB“ wandert als Beschreibung an die Zeile (`aria-describedby`, Tooltip).
6. **Zustand / Verdacht.** Im Kopf groß über `BemerkungZelle`, mit demselben PATCH wie in der
   Liste. Das Wort „Zustand / Verdacht“ steht überall, wo das Feld erscheint: Erfassung, Liste,
   Detail, Vorschau, Druck. Der Wire-Name `zustand` bleibt (Grenzwerte, Wurzel-`AGENTS.md`).
7. **Aufenthalt vom Server (Option A, LLH-1129).**
   - `PersonDetail` bekommt `aufenthalt: Option<AufenthaltAnzeige>` mit `uhs_id`,
     `uhs_bezeichnung`, `platz_id`, `platz_bezeichnung` und `seit`. `seit` ist `zeitpunkt_at` der
     jüngsten Belegungszeile der Person in dieser UHS mit Art `eintritt` oder `wechsel`. Ohne
     Platz heißt das „Wartebereich“.
   - Die Abfrage ist ein Join über `uhs`, `uhs_platz` und `person_uhs_belegung` in derselben
     Detail-Abfrage, ohne Migration. UHS- und Platznamen sind Lagestruktur und keine Scrub-Werte
     der Person.
   - Nur das Detail-DTO ändert sich, die Liste nicht. Danach Typ-Codegen.
   - Verworfen: Namen aus dem UHS-Cache des Clients. Das bräche „kein zusätzlicher Abruf“, sobald
     der Cache kalt ist.
8. **Verlegen und Austragen im Kopf.** Der bestehende `UhsZuweisenDialog` wird wiederverwendet:
   ein Dialog mit einer Auswahl, Titel „In UHS aufnehmen“ bzw. „Verlegen“. „Austragen“ ist ein
   Knopf mit Rückfrage wie heute. Am Gerät erscheint beides nicht (`darf('person-zuordnungen')`),
   der Aufenthalt bleibt lesbar.
9. **Bezüge (Option A).**
   - `personen/PersonBezuege.tsx` führt die Tier- und Schadenbezüge der Person als eine Liste in
     Einsatzsprache, jede Zeile mit `KennungsLink`.
   - `personen/BezugSuche.tsx` ist ein Dialog mit einem Suchfeld. Er lädt die Listen der Tiere
     (ohne Halter) und der Schäden **erst beim Öffnen**, filtert im Client nach Kennung, Art,
     Name und Ort und zeigt die Treffer gruppiert nach „Tiere“ und „Schäden“.
   - Gespeichert wird über die vorhandenen PATCHs (`aktualisiereTier`, `aktualisiereSchaden`).
     Die XOR-Leerung am Tier (Halter Person oder extern) bleibt erhalten.
   - Fehler stehen an der Zeile (`useZeilenFehler`). Ein neuer Server-Endpunkt entsteht nicht.
   - Verworfen: ein gemeinsamer Such-Endpunkt. Er brächte mehr Code, und die Mengen eines
     Einsatzes sind klein.
10. **„vor n min“** wird ein geteilter Helfer `anzeige/abstand.ts` (`formatVor`). Er wird mit
    `useMinutenTakt` getaktet und zuerst hier genutzt.
11. **Kopfaktionen.** Primäraktion und Menü behalten Statuswechsel und Stornieren. „Sichten“ und
    „Verbleib erfassen“ verlassen das Menü, weil sie im Kopf liegen. „Bearbeiten“ bleibt bis
    LLH-1103 im Menü.

## Risks / Trade-offs

- [Große Datei wird größer] → Kopf, Bezüge und Suche wandern in eigene Bausteine. Die Seite
  verliert dabei Zuordnungsblock, Notizformular und Medizin-Spalte.
- [Der Detail-GET wird teurer] → Der Join kommt hinzu, aber die Detail-Abfrage läuft einmal je
  Öffnung über indizierte Fremdschlüssel. Der Servertest prüft die Felder mit und ohne UHS.
- [Bezüge-Suche lädt zwei Listen] → nur beim Öffnen des Dialogs. Die Ladehoheit bleibt: Der
  Abschnitt lädt erst beim Aufklappen.
- [e2e-Ketten hängen an alten Knopfnamen] → Die Specs `personen-detail`, `betroffene-handy`,
  `geraet-uhs-tablet` und `tiere`/`schaeden` werden im selben Zug nachgezogen.
