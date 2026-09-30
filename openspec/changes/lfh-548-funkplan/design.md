# Design

## Context

Anlass und Umfang: siehe `proposal.md`. Anforderungen: `specs/stab-funkplan/spec.md` und
`specs/dokument-uebernahme/spec.md`.

Stand im Code (Scope-Lauf vom 30.09.2026):

- **Alle Daten liegen im Client bereit.** Fünf Listen liefern sie, ohne N+1:
  - `GET …/abschnitte` (`EinsatzabschnittAnzeige`, Modul `einsatzabschnitte`): `kurzbezeichnung`,
    `leiter_name`, `sprechgruppen[]`, `kommunikationsmittel`, `erreichbarkeit`,
    `ueber_abschnitt_id`
  - `GET …/einheiten` (`EinheitAnzeige`, Modul `einheiten`): `funkrufname`, `fuehrer_name`,
    `sprechgruppen[]`, `kommunikationsmittel`, `erreichbarkeit`, `abschnitt_id`,
    `ueber_einheit_id`
  - `GET …/fahrzeuge` (`EinsatzFahrzeugAnzeige`, Modul `fahrzeuge`): `funkrufname`, `opta`,
    `einheit_id`
  - `GET …/personal` (Modul `personal`): `fahrzeug_id`, `staerke_position`
  - `GET …/sprechgruppen`: an kein Modul gebunden, mit `einsatz_lokal`

  Die Sprechgruppen je Abschnitt und Einheit kommen aus den Join-Tabellen von 0073. Die Altfelder
  `sprechgruppe_tmo/_dmo` aus 0047 sind eingefroren.
- **Stab:** `pages/StabPage.tsx` ist eine `Liste` mit sechs festen Sachgebietszeilen (Entscheidung
  16 der Stab-Spec, keine Tabelle). Die Werkzeugzeile kennt nur Registry-Module
  (`stab/werkzeuge.ts`). `stab/luecken.ts` (ST6) gibt es noch nicht.
- **Muster Meldebild** (`pages/KraefteuebersichtPage.tsx`) trägt drei Vorbilder:
  - Baumtabelle über `Datensicht form="tabelle" baum={…}`
  - Rechteweiche `abrufZustand` (403 → `gesperrt`)
  - Druck (`Druckkopf`, `DruckKnopf vorbereiten`, `kraefteuebersichtPrint.css`)

  Dazu kommt „In Lagebericht übernehmen“ als POST + PATCH, laut eigenem Kommentar nicht atomar.
- **Anlegen eines Vorlagendokuments** (`src/routes/vorlagendokument.rs::anlegen`): `AnlegenBody`
  ist nicht generisch und nimmt keine Abschnitte an. `dok_repo::anlegen_tx` schreibt das leere
  Skelett der Vorlage in EINEM `INSERT … RETURNING`. Der Demo-Import nutzt `anlegen_tx`
  ebenfalls.

## Goals / Non-Goals

**Goals:**
- Ein druckbarer Funkplan ohne neue Datenhaltung. Jede Zahl darauf ist aus denselben geladenen
  Listen gerechnet wie die Tabelle.
- Die Übernahme in den Lagebericht gelingt ganz oder gar nicht, im Funkplan und im Meldebild.

**Non-Goals:**
- Kein Feld für die eigene Gegenstelle am Einsatz (Folgeticket, s. Migration Plan).
- Keine Lücken-Kennzahlen in den Stabzeilen (ST6). `stab/luecken.ts` wird nur so geschnitten,
  dass ST6 die Funkfunktionen später übernehmen kann.
- Keine ISSI, keine Fahrzeug-Sprechgruppen. Beides fehlt im Datenmodell bzw. in der Anzeige-DTO.
- Keine Sprungmarke „Funkplan“ und kein Palettenbefehl. Der Einstieg ist die S6-Zeile.

## Decisions

### D1 · Ort: Unterroute `stab/funkplan`, Einstieg in der S6-Zeile

Die Seite liegt unter `/einsaetze/:id/stab/funkplan`, als Geschwisterroute wie `etb/druck`
(`App.tsx`), mit dem Bauer `funkplanPfad(einsatzId)` in `routing/deeplinks.ts`.
`modulAusPfad` liest das zweite Segment. Damit zeigt die Navigation den Stab als aktiv, und
Sperre und Sichtbarkeit erbt die Seite vom Stab-Modul. Den Einstieg bildet ein Verweis „Funkplan“
in der S6-Zeile der Stabseite, im Stil der Werkzeug-Verweise (`stabZeilenzielStil`). Er steht
neben `werkzeugeFuer`, denn die Funktion kennt nur Registry-Module.

Verworfen:
- `?ansicht=funkplan` an Fahrzeuge, Abschnitte oder Meldebild: `?ansicht` wird aus der URL
  entfernt und taugt damit nicht als Lesezeichen (LFH-456). Die Begründung beim FMS-Tableau (ein
  Modul, ein Live-Key) trägt hier nicht, weil der Funkplan aus drei gesperrten Modulen liest.
- Ein Sprechgruppen-Kontext: Eine Seite dafür gibt es im Einsatz nicht.
- Ein eigenes Registry-Modul: Die Stab-Spec (Abschnitt 5) hat ein Cockpit je Sachgebiet
  verworfen.

### D2 · Ableitung im Client, Rechteweiche je Quelle

Die Seite lädt die fünf Listen über ihre bestehenden Query-Keys. Das Meldebild nutzt dieselben
Keys, dadurch teilen sich beide den Cache. Es entsteht kein neuer Key und kein Eintrag in
`EINSATZ_KEYS`. `abrufZustand` wandert aus `KraefteuebersichtPage.tsx` in ein geteiltes Modul
(`api/abrufZustand.ts`), damit es nicht doppelt steht. Beide Seiten importieren es von dort.

Verworfen: der gebündelte Endpunkt `…/stab/funkplan`. Er würde Einheiten- und Fahrzeugdaten an
Rollen ausliefern, denen diese Module gesperrt sind, also eine Rechteentscheidung über
Modulgrenzen hinweg. Außerdem bräuchte er ein eigenes DTO. Nötig wäre er erst, wenn ISSI oder
Fahrzeug-Sprechgruppen in den Plan sollen.

### D3 · Zeilenmodell: eine diskriminierte `FunkplanZeile`, rein abgeleitet

`stab/funkplan.ts` exportiert:
- `baueFunkplan(quellen): FunkplanZeile[]`
- `rendereFunkplanMarkdown(zeilen, stand, luecken): string`

Der Zeilentyp lautet `FunkplanZeile { key; art: 'abschnitt' | 'einheit' | 'fahrzeug' | 'sammel';
…; children?: FunkplanZeile[] }`. `KinderFeld<T>` verlangt, dass Kinder denselben Typ haben.

- Schlüssel tragen ein Präfix: `ab-<id>`, `eh-<id>`, `fz-<id>`, `sammel`.
- Die Baumregeln folgen `baueKraeftebild`:
  - Ein Abschnitt, dessen Oberabschnitt fehlt, rückt an die Wurzel.
  - Eine Untereinheit hängt unter ihrer Einheit.
  - Ein Fahrzeug hängt unter seiner Einheit.
  - Was ohne Heimat bleibt, kommt in den Knoten `sammel` („Ohne Abschnitt / Einheit“), der als
    letzter steht.
- Ist eine Quelle nicht verfügbar, fehlt ihre Ebene. Der Grund steht dann oberhalb der Tabelle.

`baueKraeftebild` selbst wird nicht erweitert. Es trägt Aggregate (Stärke, Mittel), die hier
stören.

### D4 · Spalten und Breiten

Die Spalten entstehen über `spaltenFuer<FunkplanZeile>()`, in dieser Reihenfolge:

| Spalte | Eigenschaften |
|---|---|
| Stelle | `immerSichtbar`, Titel mit `ziel` |
| Rufname/OPTA | Mono |
| Leiter/Führer | fließend, `mindestBreite` |
| TMO | Mono |
| DMO | Mono |
| Kommunikationsmittel | |
| Erreichbarkeit | `abBreite: 'xl'` außer im Druck |

- Alle Spalten außer Leiter/Führer tragen eine Zahlbreite. Nur so gilt die Regel der fließenden
  Spalte (LFH-523): `scroll.x = Σ width + mindestBreite` und `tableLayout="auto"`.
- Die Zahlen setzt die Messung in Task 1: 1366 px mit offenem Modulpanel, Contentbreite gegen
  die Summe der Spalten, Rufname-Spalte gegen den längsten gesäten Funkrufnamen. Die Messwerte
  stehen dann hier im Nachtrag.
- Ohne `sortWert`, Suche, Filter und `onZeileKlick` (Baummodus).
- Die Labels der Kommunikationsmittel kommen aus einem exportierten Helfer
  `kommunikationsmittelLabel` in `FunkErreichbarkeit.tsx`. `KOMMUNIKATIONSMITTEL_LABEL` ist heute
  privat.

**Nachtrag: Messung vor dem Bau (30.09.2026, `e2e/funkplan-breite.spec.ts`).** Gemessen unter
`/einsaetze/:id/stab` bei 1366 × 768 mit offenem Modulpanel, Chromium:

| Größe | Wert |
|---|---|
| Contentbreite (`seiten-inhalt` ohne Polster) | 1050 px |
| Zellpolster links + rechts (`KatalogTabelle`, kompakt) | 22 px |
| Mono 12: Kurzbezeichnung „EA-NORD-2“ | 63 px |
| Mono 12: Einheits-Funkrufname „Florian Musterstadt 1/10“ | 168 px |
| Mono 12: Fahrzeug-Funkrufname „Florian Musterstadt-Nordwest 1/42-1“ | 245 px |
| Mono 12: OPTA „FW MST 1/42-1“ | 91 px |
| Mono 12: Sprechgruppe „412_F_DRK_MST“ | 91 px |
| Grundschrift: Name „Kirchgassner-Wohlfahrt, Maximiliane“ | 244 px |
| Grundschrift: „Digitalfunk“ | 74 px |
| Grundschrift: Erreichbarkeit „+49 171 1234567“ | 114 px |

Daraus die Spaltenbreiten: Stelle 240, Rufname/OPTA 150, TMO 110, DMO 110,
Kommunikationsmittel 110, Erreichbarkeit 140, Leiter/Führer fließend mit `mindestBreite` 160.
Summe 1020 px, 30 px unter der Contentbreite: am Fükw kein waagerechter Bildlauf, auch mit der
Erreichbarkeit (1366 ≥ `xl`). Die Rufname-Spalte (150) fasst die Kurzbezeichnung, die OPTA und
eine Sprechgruppe mit Polster (≤ 113 px). Ein extrem langer Einheits-Funkrufname (168 + 22) bricht
um, statt die Summe zu sprengen. In der Stelle-Spalte bricht der längste Fahrzeug-Funkrufname
samt Einrückung um. Das ist gewollt, denn die Kennung wird gelesen und nicht verglichen.

### D5 · Erreichbarkeit: `abBreite` hängt am Druckmodus

`abBreite` misst die Fensterbreite, nicht `@media print`. Die Spaltenfabrik bekommt deshalb
`druckt = useDruckModus()`. Im Druck entfällt `abBreite`, und die Spalte ist da. Beide Druckwege
laufen über `beforeprint`: der Knopf und Strg+P. Der Nachweis in e2e löst `beforeprint` selbst
aus, wie der Kommentar von `useDruckModus` es verlangt. Die Markdown-Funktion kennt die
Erreichbarkeit gar nicht. Der Test pinnt ihre Abwesenheit.

### D6 · Lücken als reine Filter in `stab/luecken.ts`

`abschnitteOhneSprechgruppe`, `einheitenOhneSprechgruppe`, `einheitenOhneErreichbarkeit` und
`lokaleSprechgruppenOhneZuordnung` liefern je Lücke `{ zustand: AbrufZustand, treffer: T[] }`.
Die Zustandsregel für „ohne Zuordnung“: Ist einer von Abschnitten, Einheiten oder Sprechgruppen
nicht `daten`, gilt der schlechteste Zustand, und es entsteht keine Zahl. Aus `aktiv = 0` folgt
nichts, denn lokale Sprechgruppen kennen die Deaktivierung nicht.

Anzeige:
- Ein `Paneel` „Lücken“ oberhalb der Tabelle. Je Lücke steht eine `PaneelZeile` mit der Zahl als
  `Kennzahl`-Wert in Mono. Bei „—“ steht der Grund daneben.
- Die Treffer erscheinen als Verweise auf Abschnitt bzw. Einheit, höchstens fünf, danach
  „+n weitere“. Lokale Sprechgruppen stehen als Bezeichnung, ohne Verweis.
- Als letzte Zeile folgt der feste Hinweis „Eigene Gegenstelle (Führungsstelle) nicht erfasst“
  mit Ticketverweis im Code-Kommentar.
- Nicht verwendet wird der `Sammelbanner` (gedacht für Live-Zufluss) und nicht das
  `Kennzahlenband` (sechs feste Plätze für die Lage).

### D7 · Deeplink je Zeile über `karte.titel.ziel`

Die Ziele sind:
- Abschnitt: `einsatzabschnittePfad(id, { abschnitt })`
- Einheit: `einheitDetailPfad(id, einheitId)`
- Fahrzeug: `fahrzeugePfad(id, { fahrzeug })`

Im Baummodus klappt `expandRowByClick` die Zeile bei jedem Klick auf. Der Riegel `closest('a')`
sitzt heute nur im Pfad von `onZeileKlick`. Task 5 prüft das per Test. Klappt ein Klick auf den
Verweis den Knoten mit um, bekommt `Datensicht` den Riegel auch im Baumzweig. Das ist eine Stelle
und nützt dem Meldebild mit. Die Sammelzeile trägt kein Ziel.

### D8 · Druck: Neutralisierer der Tabelle nach `druck.css`

Die Seite legt die Wurzel `funkplan-print-root` mit `data-lfh="druckwurzel"` um `EinsatzSeite`.
Darin steht `<Druckkopf dokumentart="Funkplan" sichtbarkeit="druck" zeilen={[Stand, Umfang]}>`.
Den Knopf bildet `<DruckKnopf vorbereiten={alleAufklappen}>`.

Die Neutralisierer der `KatalogTabelle` (Überlauf, Sticky-Holder, fixierte Zellen,
Werkzeugzeile) stehen heute unter `.kraefte-print-root` in `kraefteuebersichtPrint.css`. Sie sind
Mechanik und gehören laut CLAUDE.md nach `druck/druck.css`. Sie ziehen dorthin um, unter
`[data-lfh='druckwurzel']`. Dort gelten sie für jede antd-Tabelle in einer Druckwurzel: heute
Meldebild und Funkplan. ETB-Druck, Lagebericht und Befehl rendern keine antd-Tabelle.
`kraefteuebersichtPrint.css` behält nur seine Eigenheiten. Die Formtests `druck.test.ts` und
`kraefteuebersichtPrint.test.ts` ziehen mit. Die Regression im Meldebild deckt
`e2e/meldebild-tabelle.spec.ts` ab (Druckpfad A4).

**Nachtrag (Befund beim Bau, 30.09.2026).** Der echte Druckweg (`beforeprint`, also ohne
`sticky`) legt die Tabelle in `.ant-table-content`, nicht in `.ant-table-body`. Dort trug sie ihre
Bildschirmbreite `scroll.x` (1020 px) und ragte auf A4 um 340 px über den Rand. Das Meldebild-e2e
hatte das nicht gesehen, weil es nur `emulateMedia` ohne `beforeprint` prüft. Drei zusätzliche
Regeln in `druck.css`, jede per e2e belegt:
- Die Breitenregel gilt für beide Hüllen (`.ant-table-content table` mit `min-width: 0`).
- antds unsichtbare `ant-table-measure-row` wiederholt die Spaltenköpfe fett in Bildschirmgröße
  und setzte damit die Mindestbreiten. Im Druck fällt sie weg (`display: none`).
- Zellen brechen lange Werte um (`overflow-wrap: anywhere`). Ohne diese Regel blieben 67 px
  Überhang, ohne die Messzeilen-Regel 80 px.

Nicht gewirkt haben: das Zurücksetzen der `<col>`-Breiten und schmaleres Zellpolster. Beide sind
nicht übernommen.

Verworfen: die Regeln für den Funkplan zu kopieren. Zwei Kopien laufen auseinander, und die
Kopie widerspräche „Mechanik nur in `druck.css`“.

### D9 · Atomarer Startinhalt: `AnlegenBody<A>`

- `AnlegenBody` wird generisch: `{ vorlage, titel, zeitstand, #[serde(default)] abschnitte:
  Option<Vec<A>> }`.
- Die Schlüsselprüfung aus `aktualisieren` wandert in eine Funktion
  `pruefe_abschnitts_schluessel::<T>(v, &abs)`, die beide Handler rufen. Ein unbekannter oder
  doppelter Schlüssel ergibt 400 (`Validation`, LFH-305/267).
- `anlegen_tx` nimmt `startinhalt: Option<&[A]>` und füllt das Skelett der Vorlage. Die
  Reihenfolge bleibt die der Vorlage, der Text kommt aus dem Startinhalt. Geschrieben wird mit
  demselben einzelnen `INSERT`, damit ist das Anlegen ohne eigene Transaktion atomar.
- Der Demo-Import übergibt `None`.
- `sse::<T>` feuert unverändert einmal.
- Lagebericht- und Befehlsroute ändern nur den Typ: `JsonBody<AnlegenBody<T::Abschnitt>>`.

Request-DTOs sind handgepflegt (LFH-120). `NeuerLagebericht` und `NeuerBefehl` bekommen
`abschnitte?`. Das Meldebild ruft nur noch `legeLageberichtAn(…, { …, abschnitte })`. Den Fehler
zeigt `SpeicherFehler` an der Seite, statt `message.error` („Speicherfehler an die Seite“). Der
Fehler verschwindet beim nächsten Absenden, das räumt react-query beim Übergang nach `pending`
selbst.

Verworfen:
- Ein eigener Endpunkt `…/lageberichte/uebernahme`: ein zweiter Anlegeweg mit eigener
  Rechteprüfung.
- Das Aufräumen des leeren Entwurfs im Client: Scheitert auch der DELETE, bleibt der Entwurf
  trotzdem stehen.

### D10 · Live und Aktualität

Abschnitte, Einheiten, Fahrzeuge und Personal sind live (`EINSATZ_STREAM_EVENTS`).
`einsatzKeys.sprechgruppen` ist es nicht (`NICHT_LIVE_KEYS`). Legt jemand anderes eine lokale
Sprechgruppe an, erscheint sie im Funkplan erst beim nächsten Abruf, also bei Fokus oder beim
Neuladen. Das bleibt so, die Zuordnungen selbst kommen live über Abschnitte und Einheiten. Den
Datenstand zeigt `EinsatzSeite` über `gemeinsamerDatenstand`, wie im Meldebild.

### D11 · Guards und Nachweise

- `datensicht.guard.test.ts`: `/src/pages/FunkplanPage.tsx` kommt in `KONSUMENTEN` und
  `NUR_TABELLE` (Vergleichsfläche, Pin 3 → 4). Nicht in `VOLLMENGE_PFLICHT`, weil die Elternzeilen
  keine Aggregate tragen. Nicht in `katalogTabelle.guard.test.ts`.
- e2e:
  - Messung vor dem Bau (Task 1)
  - Route in `gate1Routen` (1366/1024/768/390, auch als Beobachter)
  - eigene Spec `e2e/funkplan.spec.ts`:
    - Lücken im ersten Bild bei 1366 × 768 mit offenem Panel
    - Fixspalte bei 390 px
    - Druckpfad bei 680 px mit Erreichbarkeit
    - Übernahme in einem Aufruf
- Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` in dieser Change.

### D12 · Nachtrag aus der Review (30.09.2026)

Eine adversarial verifizierte Review hat elf Befunde bestätigt. Alle sind umgesetzt:

- **Pausierte Abfrage ist „lädt“:** `abrufZustand` liest `isPending` statt `isLoading`. In
  TanStack v5 gilt `isLoading = isPending && isFetching`, eine ohne Netz pausierte Abfrage hätte
  sonst „0“ Lücken gemeldet. Das gilt auch für das Meldebild.
- **Stab-Sperre fail-closed:** Ohne ermittelte Freigabe zeigt die Seite ein Skelett, bei einem
  Fehler `SeitenFehler`. Die Overrides darf jede Person mit Lesezugriff lesen, damit sperrt das
  niemanden zu Unrecht aus.
- **Nichts als leerer Bestand:** Der Leertext nennt fehlende Quellen. Der Bericht erhält einen
  Abschnitt „Quellen“ (`fehlendeQuellen`, `strukturVollstaendig` in `stab/funkplan.ts`).
- **Übernahme:** Sie ist gesperrt, solange eine Quelle lädt, und fehlt ohne Freigabe des Moduls
  Lageberichte. Ohne Schreibrecht fehlt sie weiterhin (sekundäre Aktion, keine Primäraktion
  nach M16).
- **Markdown:** Auch die Tilde wird maskiert. Ein Rundlauftest durch `components/Markdown.tsx`
  prüft, dass kein `del`, `em`, `a` oder `code` entsteht.
- **Baum-Riegel:** Der Riegel greift auch für Knöpfe, Felder und Portal-Klicks. Der
  `StatusWahl`-Knopf im Meldebild klappte vorher die Einheit zu. Blattzeile und Aufklappsymbol
  sind jetzt durch Tests abgesichert.
- **Tests:** Rollensperre mit Admin-Gegenprobe. Doppelter Schlüssel beim PATCH.

## Risks / Trade-offs

- [Umzug der Druck-Neutralisierer ändert den Ausdruck des Meldebilds] →
  `e2e/meldebild-tabelle.spec.ts` (A4-Druckpfad) läuft vor und nach dem Umzug. Die Regeln bleiben
  wörtlich gleich, nur der Selektor wird allgemeiner.
- [Neues optionales Feld im `AnlegenBody` für Befehle] → Ohne Feld verhält sich das Anlegen wie
  bisher, der Test pinnt das. Die bestehenden Befehls-Tests laufen unverändert mit.
- [Strg+P aus schmalem Fenster ohne `beforeprint`] → Chromium, Firefox und Safari feuern
  `beforeprint`. `emulateMedia` in Playwright tut es nicht, deshalb löst e2e es selbst aus.
- [Viele Sprechgruppen je Zeile sprengen feste Breiten] → Die Zellen brechen um und kürzen nicht.
  Die Messung in Task 1 sät absichtlich lange Werte.
- [Personal lesbar, aber Fahrzeug ohne Führer-Position] → Die Zelle bleibt „—“ ohne Grund. Das
  ist ehrlich, denn es fehlt tatsächlich eine Angabe.
- [Datenschutz: Erreichbarkeit auf Papier] → Das hat der User entschieden (30.09.2026): Der
  Funkplan hängt im ELW aus. Im Lagebericht, der ins ETB und in die Aufbewahrung geht, steht sie
  nie.

## Migration Plan

- Keine DB-Migration. Das Backend-Feld ist optional und abwärtskompatibel, alte Clients senden
  es nicht.
- Folgeticket (während der Umsetzung über `clickup-task-anlegen`): „Eigene Gegenstelle
  (Führungsstelle) am Einsatz erfassen“ mit Rufname, Sprechgruppen und Erreichbarkeit. Danach
  wird der Hinweis im Funkplan zur Zeile.
- Rollback: den Commit zurücknehmen. Es gibt keine Datenfolgen.
