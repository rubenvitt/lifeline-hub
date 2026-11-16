# Design

## Context

- `components/instrument/BearbeitbaresPaneel` ist der einzige Baustein für „Bearbeiten in der
  Ansicht“ (LLH-1139). Im Modus `paneel` liest er `datensatz.geaendert_at` als CAS-Basis
  (`useEditSitzung`), friert die Formularwerte beim Öffnen ein und ruft
  `onSpeichern(patch, basis)`. `basis === undefined` heißt „Meine Änderung übernehmen“ nach einem
  409. Im Kopf trägt er nur „Bearbeiten“ (`Paneel` `aktion`).
- **UHS:** Die Detailseite ist eine Fensterseite. Kopf, darunter die Bereichsleiste
  (`routing/deeplinks.ts` `UhsBereich`, `?bereich=`), darunter füllt der gewählte Bereich die
  Fläche bis zur Fensterhöhe. Die Stammdaten stehen nur als Kopf-Meta (Typ · Standort · Stärke)
  und Beschreibungszeile (Soll · Quali · Notiz). „Bearbeiten“ steht im Kopf und öffnet
  `UhsBearbeitenModal`. Der UHS-PATCH kennt `basis_geaendert_at` schon (LFH-241,
  `uhs_repo::aktualisiere`, `AND geaendert_at = ?` im UPDATE). Der Client sendet es aber nicht,
  `UhsPatch` hat das Feld nicht.
- **BR:** Die Detailseite hat den Abschnitt „Raumdaten“ (`SektionHeader` mit „Auf Karte verorten“
  und „Bearbeiten“, darunter `Datenraster` mit Standort und Notiz). „Bearbeiten“ öffnet
  `BrBearbeitenModal`. Der BR-PATCH (`routes/einsatz_bereitstellungsraum.rs` `update` →
  `br_repo::update_tx`) hat keinen Basisstand.
- `geaendert_at` ändern an UHS und BR nur der Stammdaten-PATCH und der Statuswechsel. Belegung,
  Eintreffen und Abruf schreiben andere Tabellen, lösen also keinen falschen 409 aus.

## Goals / Non-Goals

**Goals:**

- Beide Stammdaten-Bearbeitungen laufen über `BearbeitbaresPaneel` im Modus `paneel`, mit CAS.
- Die Patch-Abbildung bleibt wie bisher: nur Geändertes, leer = `null`, die Koordinate als Paar.

**Non-Goals:**

- Anlegen (`UhsAnlegenDrawer`, `BrAnlegenDrawer`): LLH-1921.
- Den Typ der UHS ändern (auch das Modal bot das nicht an). Ebenso den Abschnitt, den bisher
  weder Anlegen noch Bearbeiten anbot.
- Den Kopf der UHS umbauen. Meta und Beschreibungszeile bleiben die Zusammenfassung.

## Decisions

**D1 — UHS: eigener Bereich „Angaben“ statt Kopf-Bearbeitung oder festem Paneel.**
(Abgestimmt am 16.11.2026.) Ein neuer `UhsBereich` `angaben` mit dem Paneel „Angaben“ (Modus
`paneel`) steht als letzter Reiter, nach „Dateien“. „Bearbeiten“ steht damit im Paneelkopf, wie es
die Regel „Ort von ‚Bearbeiten‘“ verlangt. Der Seitenkopf trägt danach nur noch Statushandlungen
und das ⋮.
Verworfen wurden zwei Wege. *Modus `ansicht` aus dem Kopf*: Er verdrängt während der Bearbeitung
den gewählten Bereich (meist den Grundriss), und die Regel sieht `ansicht` nur für fachlich
zusammen geprüfte Felder vor. *Festes Paneel über der Bereichsleiste*: Es kostet auf jedem
Bildschirm Höhe der Arbeitsfläche, und Spec `uhs-grundriss` verlangt alle Bereiche ohne Bildlauf
bei 1280 × 800.
Am Gerät gibt es den Bereich nicht: `bereichListe` führt dort nur `belegung`, und ein Gerät hat
kein `uhs-verwalten`. Der Bereich rollt in seiner Fläche wie Kräfte und Bewegungen.

**D2 — Felder und Darstellung der UHS.** Bezeichnung, Standort (`EinsatzOrtsfeld`, `exclude`
`uhs:<id>`), Soll-Anzahl (`InputNumber` bis `UHS_SOLL_ANZAHL_MAX`), Qualifikationssoll
(`QualiSollFeld`, breit) und Notiz (TextArea, breit). Lesewerte: Text oder „—“, Qualifikationssoll
über `qualiSollText`. Die Prüfregeln kommen aus dem Modal. Bearbeitbar ist die Stelle wie bisher
nur mit `uhs-verwalten`, mit Schreibrecht im Einsatz und solange sie weder aufgelöst noch storniert
ist. Ohne diese Bedingungen erscheint kein „Bearbeiten“ und kein Grund (`grund` bleibt leer), wie
heute im Kopf.

**D3 — Patch-Abbildung wird Werte-gegen-Werte.** `uhsPatchAus(basis: Uhs, werte)` und
`brPatchAus(basis: Bereitstellungsraum, werte)` vergleichen heute mit dem Datensatz. Die
`patch`-Prop des Bausteins vergleicht dagegen zwei Formularstände (`vorher`, `nachher`). Beide
Funktionen werden auf `(vorher: W, nachher: W)` umgestellt und ziehen mit der Formularabbildung
(`werteAus(uhs)`) in eine reine Datei je Modul (`pages/uhs/uhsAngaben.ts`,
`pages/bereitstellungsraum/brRaumdaten.ts`). Die vorhandenen Tests der Patch-Funktionen ziehen mit
um. Die Koordinate vergleicht `ortFelder(vorher.standort)` mit `ortFelder(nachher.standort)`. Weil
`vorher` aus `ortsfeldAusGespeichert` desselben Stands stammt, bleibt das Ergebnis dem bisherigen
gleich.

**D4 — Basisstand im Client.** `UhsPatch` und `BrPatch` bekommen `basis_geaendert_at?: string`.
`onSpeichern(patch, basis)` sendet `{ ...patch, basis_geaendert_at: basis }`; bei `basis ===
undefined` fehlt der Schlüssel (JSON lässt `undefined` weg). Die Lagekarte und „Auf Karte verorten“
senden weiter ohne Basis.

**D5 — Backend BR: Basisstand im WHERE, Muster UHS.** `PatchBody.basis_geaendert_at:
Option<String>`, weitergereicht an `update_tx`. Die Prüfung steht im UPDATE (`AND geaendert_at =
?`), nicht als Vergleich vor dem UPDATE. So ist sie atomar, auch wenn `update_tx` künftig ohne
umschließende Transaktion liefe. Ändert das UPDATE mit Basis keine Zeile, obwohl `laden_tx` den Raum
fand, antwortet der Server mit `AppError::Conflict` (409), Text wie bei der UHS. Storniert (409),
fremd (404) und das Koordinatenpaar (422) bleiben davor.
Verworfen: *Vergleich in Rust nach `laden_tx`*. Er ist innerhalb der Schreibtransaktion
gleichwertig, weicht aber vom UHS-Muster ab, und das Muster ist die Vorlage der Regel.
`PatchBody` ist ein Request-DTO und nicht `ToSchema`; Typ-Codegen und die öffentliche API sind
nicht betroffen.

**D6 — Zusatzhandlungen im Paneelkopf.** `BearbeitbaresPaneel` bekommt `zusatz?: ReactNode`. Im
Lesezustand steht er im Kopf vor „Bearbeiten“ (`Space`/`Flex` mit `token.marginXS`). Im
Bearbeiten-Zustand fehlt er, denn eine zweite Handlung neben einer offenen Bearbeitung
widerspräche „eine offene Bearbeitung“. Ohne `zusatz` bleibt der Kopf wie heute. Der BR übergibt
`AufKarteVerorten` nur, wenn der Raum bearbeitbar ist (wie heute).
Verworfen: *„Auf Karte verorten“ ins ⋮ des Seitenkopfs*. Das wäre ein Ortswechsel für die
Bedienung ohne Not.

**D7 — BR-Paneel „Raumdaten“.** Es ersetzt `SektionHeader` und `Datenraster` an derselben Stelle,
mit `spalten={3}` und den Feldern Bezeichnung, Standort, Notiz (Notiz breit). Die Regeln
(`zeichenRegel`, `ortZeichenRegel`, `zeichenGrenze`) kommen aus dem Modal. Bezeichnung steht damit
auch im Lesezustand im Paneel, doppelt zum Titel. Das nehmen wir hin, damit Lese- und
Bearbeitungszustand dieselben Zellen zeigen (Bausteinvertrag). `onNeuLaden` ist
`detailQuery.refetch`. Nach dem Speichern werden die bisherigen Query-Keys invalidiert (`br`,
`brDetail`, `geraete`; UHS: `uhs`, `uhsDetail`, `lagemonitor`), und die Erfolgsmeldung bleibt
(`message.success`).

**D8 — Seitenmerker.** Weder UHS- noch BR-Seite hat einen `OffeneBearbeitungProvider`. Der
Baustein legt dann seinen eigenen an, und der Verlassen-Schutz gilt. Weitere Bearbeitungen derselben
Seite (Grundriss-Bearbeiten-Modus, Belegungszeilen) laufen nicht über den Merker. Daran ändert diese
Change nichts.

## Risks / Trade-offs

- [`geaendert_at` hat Sekundengenauigkeit] → Zwei Speicherungen in derselben Sekunde erkennt die
  Prüfung nicht. Das gilt heute schon für die UHS und alle CAS-Wege, kein neues Risiko.
- [Ein Statuswechsel während der offenen Bearbeitung löst einen 409 aus] → gewollt: Der
  Datensatz hat sich geändert, und die Rückfrage bietet „Meine Änderung übernehmen“.
- [Ein Reiter mehr in der UHS-Bereichsleiste] → Die Leiste bricht bei 390 px schon heute um
  (`Segmentleiste`). Der e2e-Wächter `uhs-hoehe.spec.ts` und das Szenario „Material ohne Bildlauf“
  bleiben der Maßstab und laufen mit.
- [Der Bildlauf des BR-Kapitels braucht ein gebautes Backend] → Das Bild `bearbeiten.png` wird im
  Bildlauf neu aufgenommen (offenes Paneel). Geht das in der Sitzung nicht, bleibt der Text
  angepasst und das Bild ein Nachzug mit Aufgabe.

## Migration Plan

Keine Datenmigration. Der neue PATCH-Schlüssel ist optional, ältere Clients schreiben wie bisher.
Rückbau: Revert des PR.
