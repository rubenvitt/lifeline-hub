# Design

## Context

Warum die Change nötig ist, steht in `proposal.md`. Wie es heute gebaut ist:

- `pages/AuftraegePage.tsx` hält zwei antd-`Tabs`; der Reiter steht als `?reiter=befehle` in der
  Adresse. Laden und Fehler zeigt die Seite mit `Spin` und `Alert`.
- **Einzelaufträge** (`auftraege/AuftraegeListe.tsx`, 593 Zeilen): Die offenen Aufträge kommen
  ungeblättert, die abgeschlossenen seitenweise (LFH-1071). Die Zahlen liefert `…/kennzahlen`.
  - Die Karte `AuftragKarte` (`memo`, auf `KommKarte`) trägt alles: Chips, Text, Empfänger,
    Quittieren, „Bearbeitung beginnen“, „Vollzug melden“, „Abnehmen“, das Schema im Klappteil.
  - Quittieren ist optimistisch mit gezieltem Rückrollen.
  - Der Deeplink `?auftrag=` folgt „anwenden, dann räumen“ (`routing/useQueryParamSelektion.ts`).
    Liegt der Auftrag nicht unter den offenen, holt die Seite ihn einzeln und heftet ihn an.
  - Ab 50 abgeschlossenen Aufträgen rendert die Liste nur ihren Ausschnitt
    (`useFensterAusschnitt`, Anker = markierter Auftrag).
- **Einsatzbefehle** (`auftraege/BefehlListe.tsx`): `Datensicht form="karte"` mit Suche,
  gruppiert nach Entwurf und Freigegeben, ohne Handlungen. Der Titel führt auf die Vollseite
  `pages/BefehlDetailPage.tsx`. Dort stehen Editor, Freigeben, Fortschreiben, Druck und Anlagen.
- **Weitere Nutzer der Kartenteile**: `geraet/GeraetAuftraegePage.tsx` (Funktionsansicht eines
  gekoppelten Geräts) nutzt `AuftragListe` mit allen Handlungen. `command-palette/Vorschau.tsx`
  nutzt `AuftragVorschau`.
- **Zweispalter** gibt es zweimal als Einzelbau: `EinsatzabschnittePage` ab `md`, Liste 360 px,
  und `GefahrenPage` ab `lg`, Liste 240 px. Einen gemeinsamen Baustein gibt es nicht.
- **Daten**:
  - Ein Auftrag kennt Zeitpunkte und Kennungen, aber keine Namen der handelnden Personen.
  - Ein Befehl kennt Fassung, Zeitstand, Ersteller und Freigabe. Seine Abschnitte kommen nur aus
    dem Einzelabruf (`ladeBefehl`, Key `einsatzKeys.befehl`, live über das Ereignis `befehl`).
- **Live**: Das Ereignis `auftrag` invalidiert den Prefix `auftraege` über den Sammler, ohne
  gezielte Zeilenziele. Ein zusätzlicher Suchbegriff im Key braucht dort also nichts.

## Goals / Non-Goals

**Goals:**

- Ein Baustein für „Liste + Detailpaneel“, den später auch andere Module nehmen können
  (Einsatzabschnitte, Gefahren, Lageberichte); umgestellt werden hier nur die zwei Reiter.
- Visuelle Gleichheit über gemeinsame Teile, nicht über Kopien.
- Keine Verhaltensänderung an der Geräteansicht und an der Palette-Vorschau.

**Non-Goals:**

- Verteiler und Quittung für Befehle (LLH-1173).
- Die Entwurfsseite selbst (LLH-1074).
- „Aufheben/Berichtigen“ eines Auftrags (LLH-1098) und die Neuordnung des Schemas (LLH-1091).
  Beide fließen später in das Detail ein.
- Namen im Verlauf eines Auftrags: Der Verlauf zeigt Zeitpunkte. Namen bräuchten ein neues
  Response-Feld samt Codegen und kommen nur mit eigenem Ticket.
- Einsatzabschnitte und Gefahren auf den neuen Baustein umstellen.

## Gestalt

### Fükw ab `lg` (Skizze 1366 × 768, Nacht)

```
┌ Aufträge/Befehle ─────────────────────────────────────────────── [Weitere] ┐
│ [Einzelaufträge] [Einsatzbefehle]                                          │
│ AUFTRÄGE  4 offen · 12 abgeschlossen · Stand 10:42           [+ Auftrag erteilen]
│ [Offen 4|Abgeschlossen 12] [Alle|Intern|Extern] [Suche…      ] [Empfänger ▾] │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ ÜBERFÄLLIG (1)                │ AUFTRAG #4                    erteilt 101326okt26
│▌10:13 │ SOFORT  OFFEN  Überf.│ SOFORT · OFFEN · Überfällig · Frist 10:45    │
│▌ #4   │ Wasserversorgung von │                                              │
│       │ Hydrant H12 zur ...  │ Wasserversorgung von Hydrant H12 zur Einsatz-│
│       │ 2. Zug · 0/2 quitt.  │ stelle aufbauen, B-Leitung über Kreuzung …   │
│ HEUTE FÄLLIG (2)              │                                              │
│ 10:20 │ DRINGEND IN BEARB.   │ [Bearbeitung beginnen] [Vollzug melden]      │
│  #5   │ Absperrung Nordseite │                                              │
│       │ Polizei · 1/1 quitt. │ EMPFÄNGER  0/2 quittiert                     │
│ …                             │ 2. Zug                       [Quittieren]    │
│                               │ S4 Versorgung (Meier)        [Quittieren]    │
│                               │                                              │
│                               │ SCHEMA                                       │
│                               │ Absicht/Ziel   Löschwasser für Abschnitt 2   │
│                               │ Mittel         2× B-Schlauch, Verteiler      │
│                               │                                              │
│                               │ VERLAUF                                      │
│                               │ 10:13  erteilt                               │
│                               │ 10:15  quittiert · 2. Zug                    │
│                               │ ↗ ETB-Eintrag 17                             │
└──────────────────────────────┴─────────────────────────────────────────────┘
  Liste: minmax(340px, 2fr)        Detail: minmax(0, 3fr), sticky oben
```

Der Reiter „Einsatzbefehle“ hat dieselben Zonen. Die Karte zeigt links Zeitstand und `v2`, rechts
Status, Schema, Titel und „Ersteller · freigegeben 10:40 von Huber“. Das Detail zeigt Kopf,
Handlungen („Entwurf bearbeiten“ und „Freigeben“ bzw. „Fortschreiben“), Angaben (Schema,
Zeitstand, Ersteller, Freigabe), die Abschnitte als Lesefassung und „↗ Vollansicht“.

### Handschirm 390 px

```
┌ Aufträge/Befehle ──────── [⋯] ┐
│ [Einzelaufträge][Einsatzbef.] │
│ AUFTRÄGE 4 offen · 12 abg.    │
│ [+ Auftrag erteilen]          │
│ [Offen 4|Abgeschl. 12]        │
│ [Suche…              ]        │
│ [Alle|Int|Ext] [Empfänger ▾]  │
│▌10:13 SOFORT OFFEN Überfällig │  ← gewählt, aufgeklappt
│▌#4  Wasserversorgung von H12… │
│ ┌ Detail (wie oben, gestapelt)┐│
│ │ [Bearbeitung beginnen]      ││
│ │ [Vollzug melden]            ││
│ │ Empfänger … [Quittieren]    ││
│ └─────────────────────────────┘│
│ 10:20 DRINGEND IN BEARBEITUNG │
│ #5  Absperrung Nordseite      │
└───────────────────────────────┘
```

## Decisions

### D1 Muster „Liste + Detailpaneel“ (Option A aus dem Ticket)

Das Detail steht neben der Liste bzw. klappt unter der Karte auf. Die Vollseite bleibt nur für das
Schreiben eines Befehls.

- **Verworfen B**, eine Vollseite je Auftrag: Jeder Quittier-Klick kostete einen Seitenwechsel, im
  Einsatz zu langsam.
- **Verworfen C**, Befehl inline lesen und schreiben: Der Editor mit geteilter Vorschau passt in
  kein Klappteil.

A verträgt sich mit LFH-19. Das Detail ist Inline-Inhalt, kein Drawer, und ein Dokument wird
weiter auf einer eigenen Route geschrieben.

### D2 Baustein `components/ListeDetail.tsx`

`ListeDetail<T>` trägt Anordnung, Auswahl, Zustände, Deeplink-Sprung, Zufluss, Ausschnitt und
Gruppen. Fachlich weiß er nichts.

- **Eingaben** (Skizze):
  - Daten: `eintraege`, `schluessel(t)`, optional `gruppen` (Schlüssel, Etikett, Reihenfolge)
  - Darstellung: `karte(t, { gewaehlt, hervorgehoben })`, `detail(t, { entfallen })`
  - Auswahl: `gewaehlt`, `onWahl`, `hervorgehoben`
  - Zustand: `ladend`, `fehler`, `standVeraltet`, `leer`
  - Rahmen: `filterleiste`, `fuss` (etwa „Ältere laden“), `fenster`
- **Anordnung**:
  - Ab `lg` ein CSS-Grid `minmax(340px, 2fr) minmax(0, 3fr)`. Das Detail ist ein `Paneel` mit
    `position: sticky; top: <Rand>`, damit es beim Scrollen der Liste stehen bleibt.
  - Unter `lg` folgt das Detail im DOM direkt der gewählten Karte.
  - Die Breite fragt `useViewport().abBreite('lg')` ab (Spec `viewport-abfrage`).
  - `lg` statt `md` wie bei den Einsatzabschnitten: Eine Auftragskarte braucht für Auftragstext
    und Chips mehr Breite als ein Baumknoten. Bei 768–991 px blieben für das Detail weniger als
    420 px.
- **Auswahlziel**: Der Titel der Karte (Auftragstext bzw. Befehlstitel) ist ein `<button>` über
  die ganze Kartenbreite.
  - Er trägt ab `lg` `aria-current="true"`, darunter `aria-expanded` und `aria-controls` auf das
    Detail. Sein Name nennt die Kennung („Auftrag #4: …“).
  - Ein Klick auf freie Kartenfläche wählt ebenfalls. Links in der Karte bedienen sich allein,
    nach dem Riegel `closest('a')` wie in der `Datensicht`.
  - Die Trefffläche hat mindestens `controlHeight`.
- **Vorauswahl** ab `lg`: das erste Objekt der gezeigten Folge, ohne Fokusverschiebung. Unter `lg`
  ist nichts vorgewählt, sonst stünde auf dem Handschirm ein Detail vor der Liste.
- **Entfällt das gewählte Objekt** (Spec `liste-detail`, „Gewähltes Objekt entfällt“): Der
  Baustein merkt sich das zuletzt gesehene Objekt und zeigt es mit `entfallen: true` weiter. Den
  Hinweis setzt der Aufrufer im Detail („Nicht mehr in dieser Ansicht“). Die Wahl wird erst durch
  eine andere Wahl oder den Wechsel der Ansicht gelöst.
- **Verworfen**:
  - Die Darstellung als Variante der `Datensicht`: Deren Kartenplan kennt höchstens drei
    Sekundärslots und keine Detailspalte. Der Eigenbau stünde in `KARTEN_EIGENBAU`, und die
    Detailspalte wäre ein zweiter Fremdkörper.
  - Einen Zweispalter je Seite weiter von Hand bauen: Das ist der Ist-Zustand, der Ruben stört.

### D3 Karte ohne Handlung, alle Handlungen im Detail

Die Listenkarte trägt keine ändernde Handlung, nur das Auswahlziel und Kennungs-Links (Spec
`liste-detail`, „Wahl per Zeiger und Tastatur“).

- **Grund**: Ein Knopf in einer Karte, die selbst wählt, ist ein verschachteltes Bedienziel.
  Außerdem verschöbe der Zufluss die Knöpfe unter dem Zeiger.
- **Kosten**: Quittieren braucht am Fükw einen Klick mehr (Karte wählen, dann quittieren). Die
  Vorauswahl ab `lg` holt das für den obersten, meist dringendsten Auftrag zurück.
- **Im Detail** stehen die Handlungen direkt unter dem Text, vor Empfängern und Schema. So
  erreicht man sie auf dem Handschirm ohne Scrollen.
- **Rückfragen und Rückwege** bleiben wie heute:
  - Quittieren mit `Popconfirm` „Empfang quittieren“.
  - „Bearbeitung beginnen“ mit Rückgängig-Toast. Die Rücknahme geht nur aus `in_arbeit`; ihr Grund
    steht im Seitenhinweis.
  - „Vollzug melden“ im `VollzugMeldenModal`.
  - „Abnehmen“ mit Rückfrage.
- **Fehlerorte**: Der Grund einer abgelehnten Handlung steht im Detail über den Handlungen. Der
  einer Quittung steht an der Empfängerzeile (`useZeilenFehler` je Auftrag bleibt).

### D4 `AuftragKarte` in Teile zerlegen, nicht kopieren

`auftraege/AuftragKarte.tsx` wird zu Teilen:

| Teil | Inhalt |
| --- | --- |
| `AuftragKopf` | Priorität, Phase, Extern, ETB-Sprung, Überfällig, Frist |
| `AuftragEmpfaenger` | Quittungsstand, quittierte Chips, Zeile „Quittung offen:“ mit Knöpfen |
| `AuftragSchema` | gefüllte Schemafelder als `Datenraster` |
| `AuftragHandlungen` | die Knöpfe je Phase |
| `AuftragZeit` | Zeitspalte „erteilt“ und `#n` für `KommKarte` |

Daraus werden drei Zusammenstellungen:

- **`AuftragKarte`** (Geräteansicht, Palette) setzt die Teile wie bisher zusammen: Schema im
  Klappteil, Handlungen in der Karte. Ihre Tests bleiben unverändert grün.
- **`AuftragListenKarte`** (neu, `memo`): `KommKarte` mit `AuftragZeit`, `AuftragKopf` ohne
  ETB-Sprung, dem Auftragstext auf drei Zeilen (`-webkit-line-clamp`, voller Text im zugänglichen
  Namen) und einer Zeile Empfänger mit Quittungsstand.
- **`AuftragDetail`** (neu): Kopf, ganzer Text, `AuftragHandlungen`, `AuftragEmpfaenger`,
  `AuftragSchema` offen, Vollzugsvermerk und Verlauf.

Der **Verlauf** ist eine Liste aus Zeit (Mono, `ZeitAnzeige` im Format `uhrzeit`, Tooltip-frei)
und Ereigniswort. Grundlage sind `erteilt_at`, `quittiert_at` je Empfänger, `in_arbeit_at`,
`vollzogen_at` und `abgenommen_at`, aufsteigend sortiert.

**Verworfen**: die Geräteansicht mit umstellen. Sie ist eine Funktionsansicht mit eigener Hülle
und Stellenbindung (`frontend/src/geraet/AGENTS.md`), dort ist die Karte mit Handlungen richtig.

### D5 Befehl: Lesefassung teilen, Handlungen im Detail

- **`BefehlLesefassung`** (neu, `auftraege/`): die Abschnitte als `Markdown variante="dokument"`
  mit „—“ für leere. Sie wird aus dem freigegebenen Zweig von `BefehlDetailPage` herausgelöst und
  dort wie im Detail benutzt, ohne Kopie. Die Druckklassen (`befehl-druck`) bleiben an der
  Vollseite.
- **`BefehlDetail`** lädt `ladeBefehl` (Key `einsatzKeys.befehl`) erst für den gewählten Befehl.
  Bis dahin zeigt es die Kopfdaten aus der Liste und für die Abschnitte ein Skelett.
- **„Freigeben“** im Detail nutzt den `FreigabeDialog` und `gibBefehlFrei` direkt. Einen
  Speicherschritt gibt es nicht, weil das Detail keinen Editor trägt. `/freigeben` prüft den
  gespeicherten Stand; ein leerer Entwurf wird abgelehnt, der Grund steht im Dialog.
- **„Fortschreiben“** springt nach Erfolg auf die Vollseite des neuen Entwurfs, wie heute auf der
  Vollseite.
- **„Entwurf bearbeiten“** ist ein Link-Knopf auf `befehlDetailPfad`, primär im Entwurf.
- **Drucken** bleibt ein Nebenweg der Vollseite. Das Detail trägt „↗ Vollansicht“ als Sprungzeile
  (LFH-616). Eine zweite Druckwurzel im Detail hätte zwei Druckwege mit eigenen Regeln
  (`frontend/src/druck/AGENTS.md`) bedeutet.
- **Status-Segmente** „Entwürfe“ und „Freigegeben“ ersetzen die Gruppen. Vorgabe ist „Entwürfe“,
  wenn es beim ersten Datenstand einen gibt, sonst „Freigegeben“. Danach schaltet nur die Person
  um. Der Bereichskopf zählt den Bestand, die Segmente das Gefundene.

### D6 Auswahl in der Adresse: „anwenden, dann räumen“ bleibt

Die Wahl ist Zustand der Seite, nicht der Adresse. `?auftrag=` und neu `?befehl=` wählen,
markieren und werden geräumt, genau wie alle anderen Listenseiten (`useQueryParamSelektion`).

- **Verworfen**: die Wahl stehend in der Adresse. Neu laden und Zurück würden dann eine alte
  Markierung wieder anwenden; genau das schließt der Hook aus. Ein Wechsel der Karte erzeugte
  außerdem einen History-Eintrag je Klick oder bräuchte `replace`.
- **`auftraegePfad`** bekommt `befehl`, das den Reiter `befehle` setzt.
- **Ortspfad der Vollseite**: „Aufträge/Befehle“ führt auf
  `auftraegePfad(einsatzId, { reiter: 'befehle', befehl: id })`.
- Die übrigen Verweise auf `befehlDetailPfad` (ETB-Badge, Funkplan nach dem Anlegen, Fortschreiben)
  bleiben auf der Vollseite.

### D7 Auswahlfläche an `KommKarte`

`KommKarte` bekommt `gewaehlt`. `kartenGrund` ordnet die Flächen so: alarm vor hervorgehoben
(`bedienFlaeche`) vor gewählt (`auswahlFlaeche`) vor `paneel`. Die Linie oben und unten bleibt
allein der Hervorhebung (Spec `deeplink-hervorhebung`, „Markierung bleibt von der Auswahl
unterscheidbar“).

Die `auswahlFlaeche` ist die globale Rolle für gewählte Knoten (LFH-984). Der Textboden darauf
ist dort schon nachgewiesen.

### D8 Zufluss: Zustandsmaschine aus der `Datensicht` herauslösen

Die Liste hält Menge und Folge, solange Fokus oder ein Maus- bzw. Stiftzeiger in ihr ist (Spec
`liste-detail`, „Zufluss hält die Folge“).

- **Was herausgelöst wird**: die Logik der `Datensicht` (offen bzw. gefroren, Fokus- und
  Zeigerbedingung, Ausnahme für Portal-Menüs, „erst die Bewegung zählt“, Wortlaut des
  Sammelbanners). Sie kommt nach `components/useZuflussSchleuse.ts`, und `Datensicht` wie
  `ListeDetail` nutzen sie.
- Die Folgelogik einer flachen Liste ist `baumSchleuse` mit Knoten ohne Kinder. Es entsteht keine
  zweite Logik (Regel „Zufluss der Datensicht“, LFH-1020).
- **Unterschied zur `Datensicht`**: Das gewählte Objekt bleibt im Detail stehen, auch wenn es
  entfällt (D2). Die Liste lässt es fallen wie die `Datensicht`.
- **Verworfen**:
  - Gar kein Zufluss: Die Befehlsliste verlöre ihn, denn sie hat ihn heute über die `Datensicht`.
    Das Ticket nennt den Sammelbanner als Zustand.
  - Eine eigene Kopie im Baustein: Das wäre die zweite Logik, die die Regel verbietet.

### D9 Server-Suche `q` für Aufträge

- **Route**: `ListeParams` und `KennzahlenParams` in `src/routes/auftrag.rs` bekommen
  `q: Option<String>`. Der Begriff wird getrimmt; leer zählt als nichts, mehr als 200 Zeichen ergibt
  422 über `routes::support::hoechstens`, wie bei der Schadenliste.
- **Repo**: `AuftragFilter` bekommt `suche`. `filter_bedingung` hängt an:

  ```sql
  AND (printf('#%d', a.lfd_nr) LIKE ? ESCAPE '\'
    OR a.auftrag_text LIKE ? ESCAPE '\'
    OR EXISTS (SELECT 1 FROM auftrag_empfaenger se
               WHERE se.auftrag_id = a.id AND se.snap_anzeige LIKE ? ESCAPE '\'))
  ```

  Damit wirkt die Suche in Liste, Seite und Kennzahlen über dasselbe Fragment (`src/AGENTS.md`).
- **`like_muster`** zieht aus `src/schaden/repo.rs` an einen gemeinsamen Ort und wird dort wie
  hier genutzt, statt kopiert zu werden.
- **Kennungssuche**: „#12“ trifft auch #120. Das ist eine Enthält-Suche wie bei „S-007“ in der
  Schadenliste.
- **Frontend**: Die Suche ist entprellt (300 ms, Muster der Filterleisten). Der Begriff wird
  Teil von `auftraegePhase` und `auftragKennzahlen` als fünftes bzw. viertes Key-Element, leer als
  `''`.
  - Neue Key-Form heißt: Charakterisierungstests mit Literalen anpassen.
  - Das Live-Ereignis `auftrag` invalidiert weiter den ganzen Prefix.
- **Verworfen**: Suche nur im Geladenen. Ruben hat sich am 12.10.2026 dagegen entschieden; das
  widerspräche außerdem LFH-1075.

### D10 „Auftrag erteilen“ als Dialog

Neu ist `auftraege/AuftragErteilenDialog.tsx`: ein `Modal` mit `AuftragFormular card={false}
serie`. Er übernimmt die Sperre der drei bestehenden Fassungen (`meldungen/AuftragErteilenModal`):
kein Ausweg, solange die Mutation läuft, `destroyOnHidden`, und Öffnen bzw. Schließen räumen den
Grund.

`ErfassungsModal` geht hier nicht, obwohl das Ticket es nennt. `AuftragFormular` bringt sein
eigenes `ErfassungsFormular` mit, ein `ErfassungsModal` darum ergäbe zwei Formulare. Die
Erfassungs-Norm (Enter sendet, Fokus im ersten Feld, Serie, Reset auf jedem Weg hinaus) trägt das
innere `ErfassungsFormular`. Der Remount über `destroyOnHidden` deckt Kreuz, Escape und Maske ab.

Die drei bestehenden Modal-Fassungen bleiben, wie sie sind.

### D11 Seitenzustände

`AuftraegePage`:

- Laden: `SeitenSkeleton`.
- Fehler: `SeitenFehler` mit Ursache und „Erneut versuchen“ (`refetch`).

`ListeDetail` zeigt je Reiter:

- Skelett bei der ersten Lieferung.
- `SeitenFehler` ohne Bestand.
- `SeitenStandVeraltet` bei Bestand, Vorbild Einsatzabschnitte.
- `SeitenLeer` mit der Erfassen-Aktion bei Schreibrecht.

### D12 Regeln

- **`frontend/AGENTS.md`, „UI-Form-Leitlinie“**: Unter „Form nach Umfang“ kommt eine Zeile
  **Liste + Detailpaneel** (`components/ListeDetail.tsx`, Spec `liste-detail`):
  - Wann: Objekte werden je Stück gelesen und kurz behandelt (quittieren, freigeben), und man
    wechselt oft zwischen ihnen.
  - Form: Karte ohne Handlung, Detail ab `lg` rechts, darunter aufgeklappt, kein Drawer.
  - Das Schreiben eines Dokuments bleibt Vollseite.
  - Vorbild sind die Aufträge/Befehle; Einsatzabschnitte und Gefahren sind ältere Einzelbauten.
- **`frontend/AGENTS.md`, „Deeplink-Muster“**: `?befehl=` wählt in der Liste, die Item-Route des
  Befehls bleibt.
- **`src/AGENTS.md`**: Die Suchregel der geblätterten Listen nennt die Auftragsliste und den
  gemeinsamen Ort von `like_muster`.

## Risks / Trade-offs

- [Die `Datensicht` könnte beim Herauslösen der Zufluss-Logik brechen; sie hat viele Abnehmer] →
  Erst herauslösen, ohne Verhaltensänderung, mit unveränderten Tests der `Datensicht`
  (`Datensicht.test.tsx` samt Zufluss-Fällen). Erst danach nutzt `ListeDetail` den Hook.
- [Die Leistung der offenen Liste bei vielen Live-Ereignissen leidet (LFH-949)] →
  `AuftragListenKarte` bleibt `memo`, Handler bleiben stabil über das Ref-Bündel, und das Detail
  rendert nur ein Objekt. Der Render-Zähler-Test aus `AuftraegePage.grosseListen.test.tsx` wird auf
  die Listenkarte übertragen.
- [Das aufgeklappte Detail unter `lg` könnte sich mit dem Fensterausschnitt ab 50 Karten stören] →
  Das Detail hängt am gewählten Eintrag; `useFensterAusschnitt` misst Höhen und ankert auf die
  Wahl. Ein eigener Test deckt einen gewählten Eintrag tief im Ausschnitt ab.
- [Ein Klick mehr zum Quittieren] → Vorauswahl ab `lg` (D3). Auf dem Handschirm ist es ohnehin ein
  Aufklappen, wie heute das Schema.
- [Viele e2e-Specs und die Dokubilder hängen an Rollen und Namen der alten Karte] → Die Aufgaben
  gehen die Specs einzeln durch. Die Bilder entstehen neu aus `auftraege-befehle.bilder.ts`.
- [„Freigeben“ im Detail, während jemand auf der Vollseite schreibt] → Wie heute bei zwei
  Schreibenden: Der Server friert den gespeicherten Stand ein, der Autosave der Vollseite scheitert
  danach mit Grund. Das ist kein neuer Fall.

## Migration Plan

Keine Migration, keine Datenänderung. Der neue Parameter `q` ist optional, ältere Clients senden
ihn nicht. Rückbau: den PR zurücknehmen.

## Open Questions

- Ob die Vorgabe „Entwürfe“ im Reiter Einsatzbefehle im Betrieb trägt oder „Freigegeben“ besser
  passt, zeigt erst die Nutzung. Das ist eine Konstante, keine Spec-Frage.
