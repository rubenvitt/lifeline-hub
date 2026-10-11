# Design

## Context

Siehe `proposal.md` (Why). Ist-Stand in `frontend/src/pages/EinsatzdatenPage.tsx`:

- `breite="schmal"`, Kopfleiste als Fugenraster (Stichwort, Alarmzeit, Einsatzort,
  Einsatzleitung; alle bis auf die Leitung als `InlineAngabe`), Paneel „Lagedaten“ (Einsatzart,
  Nächste Lagebesprechung, Koordinate nur lesend, Meldende Stelle, Sachverhalt, Anzahl
  Betroffene), `FuehrungsstellePaneel`, `Collapse` „Technische Angaben“ (Einsatznummer,
  Leitstellen-Nr. als Zeile, „Angelegt am (techn.)“), `MitgliederAbschnitt`, `EinsatzAbschluss`.
- Zweiter Bearbeitungsweg: Knopf „Bearbeiten“ ersetzt die Seite durch ein `Form`
  (`FormWerte`, `geaenderteKopfdaten`, LFH-839). Nur dort sind Bezeichnung und Koordinate
  änderbar.
- Die Einsatz-Einstellungen (`EinsatzEinstellungenPage.tsx`) führen ihre Sektionen aus EINER
  Liste `EINSTELLUNGEN_SEKTIONEN` (`routing/deeplinks.ts`), die Routen stehen in
  `EINSTELLUNGEN_ROUTEN` (`App.tsx`). Die Sektion „Geräte“ zeigt, wie eine Sektion mit
  eigener Rechtegrenze (nur Einsatzleitung) aussieht.
- `MitgliederAbschnitt` ist schon eine eigenständige Komponente mit `darfVerwalten` und
  `darfFuehrungsstelleVerwalten`; sie läuft heute bei 390 px ohne Querlauf (LFH-964).
- `KoordinatenEingabe` darf nur über `KoordinatenFeld` (Form) oder an bewerteten Stellen mit
  eigener `istLatLon`-Prüfung eingebunden werden (`anzeige/koordinatenFeld.guard.test.ts`).

## Goals / Non-Goals

**Goals:**

- Ein Bearbeitungsweg (Zeile) für jede änderbare Kopfangabe, ohne Lücke: was heute nur das
  Formular konnte (Bezeichnung, Koordinate), bekommt eine Zeile.
- Aktenzeichen ohne Aufklappen lesbar; Verwaltung des Zugriffs dort, wo die übrige
  Einsatzverwaltung liegt.
- Gleiche Seitengestalt wie die übrigen Führungsseiten (volle Breite).

**Non-Goals:**

- Ortssuche, Kartenausschnitt, Adresse und Koordinate gemeinsam erfassen (LFH-1175).
- Führungsstelle als Ort mit optionalen Fahrzeugen (LFH-1181), Rufname aus Stammdaten
  (LFH-1187), Meldende Stelle aus Katalog (LFH-1194).
- Einsatzleiter als eigene Angabe (LFH-1199): die Kopfzelle „Einsatzleitung“ bleibt, wie sie ist.
- Termin der Lagebesprechung in eine eigene Verwaltung verlegen (LFH-1251): die Zeile bleibt
  bis dahin, aber im Paneel „Einsatz“.
- Backend, Rechte, Wire-Felder: nichts davon ändert sich.

## Decisions

### D1 Zugriff in die Einsatz-Einstellungen (Option A)

Neue Sektion `zugriff` („Zugriff“), hinten an `EINSTELLUNGEN_SEKTIONEN` gehängt (die erste
Sektion ist das Redirect-Ziel und bleibt „Allgemein“), Route in `EINSTELLUNGEN_ROUTEN`, Komponente
`pages/einstellungen/EinsatzZugriff.tsx`. Sie liest den Einsatz über `useEinstellungenDaten`
(Lade-/Fehlerriegel wie die übrigen Sektionen) und hängt `MitgliederAbschnitt` mit denselben
Rechten ein wie bisher (`darfEinsatzLeiten`, Führungsstelle zusätzlich `istEinsatzLeitung`).
Wer nicht verwalten darf, liest über der Liste einen `RechteHinweis` „Nur die Einsatzleitung
verwaltet den Zugriff“ (eigener Text wie in „Geräte“, weil die Grenze enger ist als
`NUR_LEITUNG_FUEHRUNG_ORG_ADMIN`). Am abgeschlossenen Einsatz trägt schon die Einstellungsseite
`EINSATZ_ABGESCHLOSSEN`; die Sektion zeigt dann keinen zweiten Hinweis.

`MitgliederAbschnitt` wandert nicht und wird nicht umgebaut; nur der Außenabstand oben
(`marginTop`) entfällt in der Sektion, weil die Segmentleiste schon Abstand hält.

Alternativen: **B** eigenes Modul „Mitglieder“ unter Führung — ein weiterer Menüeintrag und eine
Modulfreigabe für eine seltene Tätigkeit. **C** auf den Einsatzdaten belassen, eingeklappt — löst
das Suchproblem nicht und widerspricht der Streichung des Klappbereichs.

### D2 Ein Bearbeitungsweg: das Formular entfällt

`bearbeiten`-State, `Form`, `FormWerte`, `TEXTFELDER`, `geaenderteKopfdaten`, `geoeffnetRef`
und `speichernMutation` fallen weg; mit ihnen die Imports `Form`, `Space`, `KoordinatenFeld`
und die Tests von `geaenderteKopfdaten`. Der Schutz aus LFH-839 (kein stilles Überschreiben)
bleibt erhalten, weil die Zeile ohnehin nur ihr Feld sendet.

Die Bezeichnung wird `TextAngabe` mit neuem `pflicht`-Durchgriff auf `InlineAngabe`
(`pflicht` ist dort vorhanden). `zuPatch` sendet den getrimmten Text. Der Ortspfad liest die
Bezeichnung aus demselben Query-Cache und folgt nach dem Speichern ohne Neuladen.

Alternative: Formular behalten, nur versteckter — zwei Wege bleiben, das ist der Befund.

### D3 Koordinate als Zeile bis LFH-1175 (Übergang K1)

Ohne Formular wäre die Koordinate bis LFH-1175 gar nicht mehr änderbar. Deshalb bekommt sie
jetzt eine Zeile: `InlineAngabe<KoordinatenWert>` mit `KoordinatenEingabe` als Eingabe,
Anzeige weiter über `KoordinatenAnzeige`. `gleich` vergleicht `lat`/`lon` (ungültig ist nie
gleich), `leer` ist `null`. `onSpeichern` prüft mit `istLatLon`: ein ungültiger Wert lehnt mit
einem Fehler ab („Koordinate nicht lesbar“), den `InlineAngabe` an der Zeile zeigt, die Eingabe
bleibt offen; ein gültiger sendet `{ einsatzort_lat, einsatzort_lon }`, ein leerer beide `null`.
`EinsatzdatenPage.tsx` kommt mit diesem Begründungskommentar in `DIREKT` des
Koordinaten-Guards.

LFH-1175 ersetzt die Zeile später durch die Ortssuche; die Spec-Szenarien (Paar in einem PATCH,
leer = beide `null`) bleiben dann gültig.

Alternativen: **K2** Lücke bis LFH-1175 (Koordinate nur lesend) — eine Regression ohne Termin.
**K3** Mini-Formular nur für die Koordinate — wieder ein zweiter Weg.

### D4 Gliederung, Breite, Raster

- `breite="voll"`. Kopfleiste und Einsatzabschluss laufen über die ganze Breite.
- Die vier Paneele stehen in einem Raster: unter `xl` eine Spalte, ab `xl`
  (`useViewport().abBreite('xl')`) zwei Spalten mit `minmax(0, 1fr)`, Fluss zeilenweise. DOM-
  und Lesereihenfolge bleiben Einsatz → Einsatzort → Erstmeldung → Eigene Führungsstelle; am
  Fükw stehen Einsatz | Einsatzort und Erstmeldung | Führungsstelle nebeneinander.
- **Jede Angabe genau einmal.** Alarmzeit und Adresse stehen in der Kopfleiste und nicht noch
  einmal in einem Paneel (Grundsatz der Kopfleiste: „Sie stehen nicht zusätzlich in der Tabelle
  darunter“). Das weicht vom Ticketvorschlag ab, der die Alarmzeit auch im Paneel „Einsatz“
  nannte: zwei Bearbeitungsstellen derselben Angabe wären wieder zwei Wege. Das Paneel
  „Einsatzort“ trägt deshalb bis LFH-1175 nur die Koordinate.
- Paneel „Einsatz“: Bezeichnung (Pflicht-Zeile), Einsatzart, Einsatznummer (lesend, Mono),
  Leitstellen-Nr. (Zeile, Mono), Angelegt (lesend, `ZeitAnzeige dtgVoll`), Nächste
  Lagebesprechung (Zeile, bis LFH-1251). Das Etikett „Angelegt am (techn.)“ wird „Angelegt“.
- Paneel „Erstmeldung“: Meldende Stelle, Sachverhalt / Meldebild, Anzahl Betroffene (initial).
- `FuehrungsstellePaneel` bleibt unverändert.

### D5 Seitenkopf: Kennungen und Nebenwege

- `meta` der `EinsatzSeite` bekommt `[einsatznummer_intern, leitstellen_nr]` ohne Leere,
  verbunden mit „ · “; leer → kein `meta`. Mono kommt aus `seitenMetaStil`.
- „Einsatzbericht drucken“ (mit `ziel`) und „Zugriff verwalten“ (`sprung`, nur bei
  `darfEinsatzLeiten`) gehen in `weitere` („Weitere Aktionen zu den Einsatzdaten“); `aktionen`
  bleibt leer. Das folgt der Nebenweg-Regel (LFH-963): nichts davon muss am Handy ohne Menü
  sichtbar sein. Die Zeile im Kopf misst unter `md` einen Auslöser statt zwei Knöpfen.

### D6 Regeln und Doku

- `frontend/AGENTS.md`, „Inline-Bearbeitung und Status“: der Satz „Einsatzdaten: eine Zeile
  schickt EIN Feld (`patcheEinsatz`), Bezeichnung und Koordinate nur im Vollformular“ wird zu
  „Einsatzdaten haben nur den Zeilenweg (LFH-1170): eine Zeile schickt ihre Angabe
  (`patcheEinsatz`), die Koordinate als Paar; ein Vollformular gibt es nicht“.
- Anwenderdoku nach der Mitänderungsregel (`docs/anwender/AGENTS.md`): `einsatzdaten.md`
  (Gliederung, Seitenkopf, kein „Bearbeiten“, Sprung zum Zugriff), `einsatz-einstellungen.md`
  (Reiter „Zugriff“), `rechte-im-einsatz.md` (Ort des Zugriffs), Bildskripte
  `einsatzdaten.bilder.ts`, `rechte-im-einsatz.bilder.ts`, `einsatz-einstellungen.bilder.ts`
  und die Bilder selbst.
- Purpose der Haupt-Spec `einsatzdaten-bearbeitung` („… viele Angaben auf einmal über das
  Vollformular“) wird beim Archivieren direkt in `openspec/specs/` nachgezogen.

### D7 Schnellaktion „Person aufnehmen“

Mitglieder aufnehmen ist einer der ersten Schritte eines neuen Einsatzes; mit dem Umzug in die
Einstellungen liegt der Weg einen Klick weiter weg. Die Sprungpalette hat dafür das feste
Muster `SCHNELLAKTIONEN` (`command-palette/AGENTS.md`, „Schnellaktionen“):

- Neue Zeile ans Ende: Träger `einsatz-einstellungen`, Parameter `neu`,
  `kennung: 'person-aufnehmen'`, Ziel `einsatzEinstellungenPfad(id, 'zugriff')` + `?neu=1`,
  Label „Person aufnehmen“ (Objekt + Verb), Schlagworte mitglied, zugriff, aufnehmen,
  hinzufügen, rolle.
- **Rechte-Merkmal je Schnellaktion:** Block 4 in `befehle.ts` prüft heute nur
  `darfSchreibenImEinsatz`, das schließt Führungspersonal ein. Neues optionales Feld
  `recht?: 'leitung'`; der Befehlskontext bekommt `darfEinsatzLeiten` (aus
  `einsatz/schreibrecht.ts`), und eine Zeile mit `recht: 'leitung'` erscheint nur damit.
- **Leser in `EinsatzEinstellungenPage.tsx`:** `schnellaktionen.guard.test.ts` ordnet einen
  Leser über den Dateinamen einem Modul zu; nur dieser Name passt zu `einsatz-einstellungen`.
  Das Layout liest `neu` als Literal und reicht ein Einmal-Signal per `Outlet`-Context an
  `EinsatzZugriff`. Der Context trägt nur dieses Flag, keine Daten, deshalb gilt die
  Formular-Falle aus dem Kommentar von `useEinstellungenDaten` hier nicht.
- `MitgliederAbschnitt` bekommt `auswahlOeffnen`: die Personenauswahl erhält Fokus und klappt
  auf; danach räumt die Sektion `neu` per `replace`, ein Neuladen öffnet nicht noch einmal.

Alternativen: eine Kachel „Personen aufnehmen“ auf dem Führungsüberblick — ein weiterer Ort für
dieselbe Handlung, ohne Muster dafür. Die Sektionsdatei nach dem Modul benennen statt das Layout
lesen zu lassen — mehrere Sektionen hießen dann gleich, und der Guard ordnete trotzdem falsch zu.

## Risks / Trade-offs

- [Mehrere Angaben auf einmal ändern geht nicht mehr] → Im Einsatz wird eine Angabe nach der
  anderen nachgetragen; jede Zeile speichert sofort. Die Anlage eines Einsatzes (Dialog) bleibt
  das Werkzeug für viele Angaben auf einmal.
- [Gewohnheit: „Zugriff“ auf den Einsatzdaten gesucht] → Nebenweg „Zugriff verwalten ↗“ im Kopf
  der Einsatzdaten, Kapitel der Hilfe nachgezogen.
- [Koordinatenzeile wird mit LFH-1175 wieder umgebaut] → Bewusst klein gehalten (vorhandene
  Bausteine), die Spec-Szenarien überdauern den Umbau.
- [Breite e2e-Fläche: viele Specs sprechen „Bearbeiten“, „Lagedaten“ oder „Zugriff“ auf den
  Einsatzdaten an] → Sweep per Grep über `frontend/e2e/` als eigene Aufgabe, nicht nur die
  bekannten Dateien.
- [Zwei Spalten ab `xl` drücken die Führungsstelle neben die Erstmeldung, Höhen ungleich] →
  `align-items: start`; Lücken unter dem kürzeren Paneel sind hinnehmbar, die Lesereihenfolge
  bleibt.

## Migration Plan

Reiner Frontend-Umbau ohne Datenänderung. Alte Lesezeichen auf `…/einsatzdaten` funktionieren
weiter; `…/einstellungen/zugriff` ist neu. Rückweg: Revert des Branches.
