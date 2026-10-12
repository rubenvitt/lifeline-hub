# Design

## Context

Wie es heute gebaut ist:

- **Aufträge** stehen auf `pages/AuftraegePage.tsx` im Muster „Liste + Detailpaneel“ (Change
  `oxgob5gk-auftraege-befehle-angleichen`). Das Detail `auftraege/AuftragDetail.tsx` setzt sich
  aus den Teilen in `auftraege/AuftragTeile.tsx` zusammen und trägt die Handlungen (Quittieren,
  Bearbeitung beginnen, Vollzug melden, Abnehmen, Berichtigen, Aufheben). Die Seite hat **keine
  Druckwurzel**.
- **Befehle** zeigen dasselbe Muster. Gedruckt wird aber nicht im Detailpaneel, sondern auf der
  Vollseite `pages/BefehlDetailPage.tsx`. Die Druckwurzel umfasst dort die ganze Seite, der Kopf
  steht nur auf Papier (`sichtbarkeit="druck"`).
- **Druckansichten** (`pages/EtbDruckPage.tsx`, `druck/ListenDruckSeite.tsx`,
  `pages/EinsatzberichtDruckPage.tsx`) sind eigene Routen. Ihr Kopf ist am Bildschirm sichtbar,
  „Drucken“ ist gesperrt, bis der Stand da ist, und der Abruf läuft über einen nicht-live Key
  (`NICHT_LIVE_KEYS`, Schnappschuss-Grundsatz).
- **Feldfolge**: `auftraege/auftragsschemaKern.ts` hält `READ_ORDER` und `READ_LABEL` (LLH-1091).
  `AuftragTeile.tsx` baut daraus `SCHEMA_FELDER` (READ_ORDER + „Erteilt am“) und
  `gefuellteFelder`.
- **Einzelabruf**: `ladeAuftrag(einsatzId, auftragId)` gegen
  `GET /api/einsaetze/:id/auftraege/:auftragId` gibt es (LFH-1071). Der Key
  `einsatzKeys.auftragEinzeln` liegt unter dem live geführten Prefix `auftraege`.
- **Etikett-Wert-Listen im Druck**: `druck/einsatzbericht/Bloecke.tsx` hat mit `ZeilenListe` eine
  Liste aus `dt`/`dd`, die ihre Titel mit der ersten Zeile in einen Titelblock stellt (LFH-1098).
  Firefox setzt `break-after: avoid` nicht um (`druck/AGENTS.md`, LFH-1008). Die Liste ist dort
  privat.

## Goals / Non-Goals

**Goals:**

- Ein Auftrag lässt sich aus seinem Detail heraus drucken, mit gemeinsamem Druckkopf, in der
  FwDV-100-Folge der Karte, samt Quittung und Bearbeitung mit Zeitpunkten.
- Auftrag und Befehl folgen demselben Muster: Das Detailpaneel führt auf eine eigene Seite, die
  druckt.
- Die Feldfolge steht einmal, für Karte und Blatt.

**Non-Goals:**

- Mehrere Aufträge auf einem Blatt (Auftragsliste drucken). Bei Bedarf eigenes Ticket.
- Druck aus der Geräteansicht (`geraet/GeraetAuftraegePage.tsx`) und aus der Palette.
- Namen im Verlauf. Der Server kennt für Quittung, Vollzug und Abnahme nur Kennungen (Non-Goal
  von `oxgob5gk`). Nur die Aufhebung trägt einen Namen (`aufgehoben_von_name`).
- Änderungen an Formular, Karte oder Detail über den Sprung hinaus. Das Detail bleibt, wie es ist.
- Backend, Migrationen, Response-DTOs.

## Decisions

### D1 Druckweg: eigene Druckansicht statt Druckwurzel im Detailpaneel

Neue Route `/einsaetze/:id/auftraege/:auftragId/druck` mit eigener Seite
`pages/AuftragDruckPage.tsx`. Das Detail trägt einen Sprung „Druckansicht“
(`DetailSprung` aus `components/ListeDetail.tsx`, wie der Sprung zum ETB-Eintrag).

Gründe:

- Das Detailpaneel ist Bedienort: Handlungen, Rückfragen, Fehlerzeilen, optimistischer
  Quittungs-Cache. Ein Druck daraus bräuchte eine `*Print.css`, die all das ausblendet, und
  druckte einen Stand, der sich während des Druckdialogs live ändern kann.
- Am Handy liegt das Detail über der Liste, und die Druckwurzel müsste eine Liste mit
  Fensterausschnitt (`useFensterAusschnitt`) umgehen.
- Eine eigene Seite ist für den Befehl schon das Muster (Vollseite). Für den Auftrag gibt es keine
  Vollseite zum Schreiben, also ist die Druckansicht die Seite, auf die das Detail führt. Das ist
  das gemeinsame Muster, das LLH-1084 verlangt.
- Die Seite ist ein Deeplink-Ziel (Papier aus einem zweiten Tab, Lesezeichen) und mit Playwright
  direkt ansteuerbar.

Verworfen:

- **Druckwurzel um das Detailpaneel auf `AuftraegePage`.** Gründe oben, dazu: Strg+P auf der
  Liste druckte ohne gewählten Auftrag ein leeres Blatt.
- **Unsichtbares Druckfragment, das ein Knopf im Detail füllt und druckt.** Das Blatt wäre am
  Bildschirm nie zu sehen. Es bräuchte eine zweite Mechanik neben `druck.css` und widerspräche
  der Regel „eine Druckwurzel je Seite“, weil die Seite dann zwei Zustände drucken könnte.

### D2 Schnappschuss mit eigenem nicht-live Key

`einsatzKeys.auftragDruck(einsatzId, auftragId)` mit eigenem Prefix `einsatz-auftrag-druck` in
`NICHT_LIVE_KEYS`. Begründung wie `etbDruck`: Ein Druckbeleg ist ein Schnappschuss, und eine
Quittung an einem anderen Gerät darf ihn nicht still ändern. Unter dem Prefix `auftraege` zöge
ihn das Ereignis `auftrag` per Präfix mit. Optionen: `refetchOnMount: 'always'`, sonst die
Vorgaben. Den Personendruck-Riegel (`networkMode: 'always'`, `gcTime: 0`) braucht es nicht, ein
Auftrag hat kein Zugriffsprotokoll. „Neu laden“ ist die ausdrückliche Handlung. Der Kopf nennt
den Stand als Zeitpunkt des Abrufs (`dataUpdatedAt`).

### D3 Seite nach dem Vorbild `ListenDruckSeite`

Zustände: Einsatz lädt bzw. fehlt (`SeitenSkeleton`, `SeitenFehler`), Auftrag lädt (Status-Text,
Drucken gesperrt), 404 → „Auftrag nicht gefunden“, 403 → „Kein Zugriff auf Aufträge“, anderer
Fehler → Alert mit „Erneut laden“, Erfolg → genau eine Druckwurzel mit Druckkopf
(`sichtbarkeit="immer"`, `ebene={2}`) und Blatt. Aktionen im Seitenkopf: „Zurück zu
Aufträge/Befehle“ als Link mit Knopfgestalt auf `auftraegePfad(einsatzId, { auftrag: id })`,
„Neu laden“, `DruckKnopf typ="primary"`. Ungültige ID → `Navigate` auf `auftraegePfad`.

`ListenDruckSeite` selbst passt nicht: Sie zählt Datensätze („Umfang“), nennt eine „Auswahl“ und
zeigt den Leerfall. Gemeinsam ist nur der Rahmen aus `EinsatzSeite`, Druckkopf und DruckKnopf.
Den nutzt die neue Seite direkt, ohne den Listenrahmen zu verbiegen.

Druckkopf: `dokumentart="Auftrag"`, `titel` = Kennung `#n`, wenn vorhanden. `zeilen`: „Stand“
(taktische DTG des Abrufs). Die Phase steht im Blatt, nicht im Kopf.

Modulsperre: Die Route liegt unter `auftraege/`. `modulAusPfad` ordnet sie dem Modul
„Aufträge/Befehle“ zu wie die Befehls-Vollseite (bei der Umsetzung prüfen, im Test belegen).

### D4 Feldfolge einmal im Schemakern

In `auftragsschemaKern.ts` kommt `druckFelder(a, fmt)` dazu. Es liefert `{ etikett, wert }[]` in
der Folge Empfänger · Auftrag · Priorität · Frist · READ_ORDER (mit READ_LABEL) · Richtung ·
Erteilt am und lässt leere Angaben weg. `fmt` bringt `formatZeit` der Anzeigekonventionen und die
Etiketten der Priorität (`PRIO_META`) mit, damit der Kern ohne React bleibt.

- Empfänger: alle `snap_anzeige` samt Besetzung (`mitBesetzung`), mit Komma getrennt. Kein Feld
  je Empfänger, die stehen im Teil „Quittung“.
- Richtung: „Intern“ bzw. „Extern“ und dahinter, soweit gesetzt, Kategorie und Bezeichnung der
  externen Stelle. Die Kategorie-Etiketten kommen von dort, wo das Formular sie herholt (bei der
  Umsetzung finden, nicht kopieren).
- Erteilt am: `formatZeit(erteilt_at)`.

`SCHEMA_FELDER` in `AuftragTeile.tsx` bleibt. Die Karte zeigt Empfänger, Text, Priorität und Frist
schon an anderer Stelle. Der Test pinnt, dass die Folge des Blatts die Lesefolge der Karte als
zusammenhängende Teilfolge enthält. So kann keine der beiden Folgen allein umgestellt werden.

### D5 Blatt aus einer gemeinsamen Etikett-Wert-Liste

`ZeilenListe` (samt `Titel`, `TitelZeile`, `ZeilenEintraege`) wandert aus
`druck/einsatzbericht/Bloecke.tsx` in ein gemeinsames Modul `druck/ZeilenListe.tsx`. `Bloecke`
importiert von dort. Das ist ein reiner Umzug, die Tests von `Bloecke` bleiben unverändert grün.

`auftraege/AuftragDruckBlatt.tsx` stellt drei Listen mit `h3`-Titel: „Auftrag“ (`druckFelder`),
„Quittung“ (je Empfänger: Etikett = Anzeige mit Besetzung, Wert = Zeitpunkt oder „nicht
quittiert“) und „Bearbeitung“ (Phase, „In Bearbeitung seit“, „Vollzogen am“, „Vollzugsvermerk“,
„Abgenommen am“, „Aufgehoben am“, „Aufgehoben von“, „Grund“, leere weg). Der Titel steht jeweils
mit der ersten Zeile im Titelblock (Firefox). Freitext bricht um (`pre-wrap`). Eine einzelne
überlange Zeile darf brechen, denn nur der Titelblock ist geschützt.

Die Bearbeitungs-Etiketten haben Zwillinge in `AuftragVollzug`/`AuftragAufhebung` („Vollzogen
am:“). Die Wörter bleiben gleich. Sie wandern nicht in einen Kern, weil die Karte sie als Satz mit
Doppelpunkt setzt.

### D6 Gate und Doku

- `e2e/druck-fluss.spec.ts` (schon in `DRUCK_SPECS`, also Chromium, Firefox, WebKit): Der neue
  Fall „Auftrag druckt im normalen Fluss über mehrere Seiten“ legt per API einen Auftrag mit acht
  langen Schemafeldern an, die mit der Endmarke enden, und ruft `pruefeDruckImFluss`.
- `druck/AGENTS.md` bekommt einen Abschnitt „Auftragsdruck“ (Route, Key, Einstieg, Feldfolge im
  Kern).
- Die Anwenderkapitel beschreiben den Ablauf und nennen die neuen Quellen. Bilder entstehen nur
  über die Bilder-Spec. Ob ein neues Bild nötig ist, entscheidet die Umsetzung nach
  `docs/anwender/AGENTS.md`. Läuft der Bildlauf in der Umgebung nicht, entsteht kein Bild, und der
  Ablauf steht ohne Bild.

## Risks / Trade-offs

- **Zwei Wege zum selben Auftrag** (Detail, Druckansicht) → Die Druckansicht ist rein lesend und
  trägt keine Handlung. Der Rückweg führt mit `?auftrag=` auf den gewählten Auftrag.
- **Umzug von `ZeilenListe` berührt den Einsatzbericht** → reiner Umzug ohne Änderung im Markup.
  Belegt durch `Bloecke.test.tsx` und `einsatzbericht-deckel-druck.spec.ts`.
- **Feldfolge an zwei Orten** (Karte, Blatt) → Ein Kern und ein Test, der die Teilfolge pinnt.
- **Firefox-Umbruch** zeigt nur das echte Blatt → Titelblock wie im Einsatzbericht. Die
  Handprüfung bleibt wie bei den übrigen Druckstücken.
