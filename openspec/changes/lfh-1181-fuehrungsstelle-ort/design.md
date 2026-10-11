# Design

## Context

Anlass: siehe `proposal.md`. Anforderungen: die Deltas unter `specs/`.

Stand im Code (11.10.2026):

- **Datenmodell:**
  - Die Tabelle `einsatz_fuehrungsstelle` (Migration 0145) wird lazy angelegt und hat die Spalten
    `rufname`, `kommunikationsmittel` und `erreichbarkeit`, alle ohne CHECK.
  - Sprechgruppen liegen in `einsatz_fuehrungsstelle_sprechgruppe`, Fahrzeuge in
    `einsatz_fuehrungsstelle_fahrzeug` (0171).
  - Die höchste Migration auf `alpha` ist 0175.
- **Domäne und Route:**
  - `src/einsatz/fuehrungsstelle.rs` enthält `FuehrungsstelleAnzeige`, `FuehrungsstellePatch` und
    `patchen_tx`. `patchen_tx` legt die Zeile per `INSERT OR IGNORE` an und schreibt danach je
    Feld ein UPDATE über eine feste Spaltenliste.
  - `src/routes/einsatz_fuehrungsstelle.rs` hat einen Tri-State-Body
    (`Option<Option<T>>`, `deserialize_optional_field`). Ein leerer Patch schreibt nichts und löst
    kein Ereignis aus.
  - Die Prüfreihenfolge ist: zuerst 400 je Feld, dann 422 für Zusammenhänge, dann `write_retry!`,
    nach dem Commit `kopf_geaendert`.
- **Bausteine:**
  - `support::pruefe_koordinate` (Paar und Bereich, 422) mit dem Muster „Effektivzustand“ aus
    `einsatz_uhs.rs`.
  - `wire_enum!`, `support::parse_enum` (400), Eingabegrenzen `*_MAX` über `optional_max`.
- **Schwärzung:**
  - `einsatz.einsatzort`, `_lat` und `_lon` sind scrub NullSetzen („GPS mit-nullen, sonst verriete
    der Fix die Adresse“).
  - Bei `uhs` und `bereitstellungsraum` ist die Bezeichnung retain `G_OP_LABEL`.
- **Frontend:**
  - Das Paneel `FuehrungsstellePaneel` in `pages/EinsatzdatenPage.tsx` besteht aus
    `InlineAngabe`-Zeilen. Jede Zeile hat ihr eigenes Formular und schickt ein Feld.
  - Die Koordinate des Einsatzorts ist nur im Vollformular bearbeitbar (`KoordinatenFeld` braucht
    ein `Form`).
  - `anzeige/KoordinatenEingabe.tsx` arbeitet mit `value`/`onChange` und zeigt eine Ortsvorschau
    (`useOrtVorschau`).
  - Die Adresssuche (`api/karteOrtSuche.ts`) ist am Modul Lagekarte gegatet und hat nur eine
    UI-Stelle, die Lagekarte.
- **Abnehmer:**
  - Erfasst-Regel und Etikett liegen in `stab/fuehrungsstelle.ts`.
  - Funkplan: Zeile `fs`, `stelleZusatz` ist heute `null`.
  - Fernmeldeskizze: `NetzStelle` der Art `fuehrungsstelle` mit `bezeichnung: 'Einsatzleitung'`.
  - Organigramm: fester Wurzelkasten.
  - Checkliste: `stab/checkliste.ts`, Schlüssel `aufstellort` im Rust-Enum
    `ChecklistenPunkt`. Die Reihenfolge ist Vertrag, der Wortlaut steht nur im Frontend.
  - Lagekarte: Der Einsatzort ist ein eigener Marker-Typ `einsatzort` mit eigener Quelle
    `marker-einsatzort`, das Zeichen ist `anlass`.

## Goals / Non-Goals

**Goals:**
- Die Führungsstelle ist ein Ort mit Ausstattung: Art, Bezeichnung und Standort sind Daten an
  derselben Zeile wie die Funkangaben, mit derselben Teil-Patch-Mechanik.
- Jede Ansicht, die die Führungsstelle nennt, liest Bezeichnung und Standort aus derselben Quelle
  (`einsatzKeys.fuehrungsstelle`) und über dieselbe Erfasst-Regel.

**Non-Goals:**
- Keine Adresssuche (Geocoding) im Paneel. Die bringt der Ortsfeld-Baustein (LFH-1248), und LFH-1254
  bindet ihn auch hier an. Bis dahin werden Adresse und Koordinate getrennt eingegeben.
- Kein Platzieren oder Verschieben der Führungsstelle auf der Lagekarte. Der Marker ist nur
  lesend, bearbeitet wird im Paneel.
- Kein Offline-Lesen: `einsatz-fuehrungsstelle` kommt nicht in `LAGEBILD_OFFLINE`. Ohne Netz fehlt
  der Marker, wie jede andere nicht gespiegelte Quelle.
- Kein Rufname-Vorschlag aus dem Fahrzeug (eigenes Ticket „Rufname der Führungsstelle aus
  Stammdaten vorschlagen“). Der Begriff „Erreichbarkeit“ bleibt vorerst (LFH-1266/LFH-1274).
- Kein Audit und kein ETB-Eintrag beim Ändern, wie bisher (LFH-849 Non-Goal).
- Keine Übernahme in Einsatzbericht, Einsatzliste oder Akte der Aufbewahrung. Das Organigramm
  ist die einzige aufgehobene Grenze aus LFH-849.

## Decisions

### D1 · Art als `NOT NULL DEFAULT 'mobil'` statt nullable

`art TEXT NOT NULL DEFAULT 'mobil' CHECK (art IN ('mobil','ortsfest'))`. Bestehende Zeilen werden
damit `mobil`, ebenso Zeilen, die ein anderes Feld lazy anlegt. Ohne gespeicherte Zeile liefert der
Abruf ebenfalls `mobil`. Die Art zählt **nicht** für „erfasst“: Sie ist eine Eigenschaft, die
immer einen Wert hat, keine Angabe.

Im PATCH ist `art` nullable im Body, aber `null` und `""` ergeben 400 („Art ist Pflicht“). Ein
unbekannter Wert ergibt ebenfalls 400 (`parse_enum`). Auf der Rust-Seite steht ein neues
`wire_enum! FuehrungsstellenArt { Mobil => "mobil", Ortsfest => "ortsfest" }` mit Pin in
`tests/enum_wire_kontrakt.rs`. In `FuehrungsstelleAnzeige` ist `art` immer gesetzt (kein
`skip_serializing_if`).

*Verworfen:* `art` nullable mit „NULL = nicht gewählt“. Das wäre ein dritter Zustand, den keine
Anzeige braucht. Das Ticket sagt „Pflicht, sobald erfasst; Vorgabe mobil“, und ein Default erfüllt
beides ohne Sonderfall.

### D2 · Standort als drei Spalten, Koordinate gegen den Effektivzustand geprüft

Neue Spalten: `standort_adresse TEXT`, `standort_lat REAL`, `standort_lon REAL`, dazu
`bezeichnung TEXT`. Im Body steht je Feld ein eigenes Tri-State (`standort_adresse`,
`standort_lat`, `standort_lon`, `bezeichnung`). Damit bleibt die Regel „eine fehlende Angabe bleibt
unverändert“ wörtlich gültig.

Ist `standort_lat` oder `standort_lon` gesendet, lädt der Handler vorher den gespeicherten Stand,
bildet den Effektivzustand und ruft `pruefe_koordinate` (422: Paar, Bereich). So prüft schon
`einsatz_uhs.rs`. Die Prüfung läuft in derselben Transaktion vor dem Schreiben, daher wird nichts
teilweise gespeichert.

Grenzen: `FUEHRUNGSSTELLE_BEZEICHNUNG_MAX = 200`, `FUEHRUNGSSTELLE_ADRESSE_MAX = 500` (wie
`SCHADEN_ORT_MAX`). Sie stehen in `src/einsatz/fuehrungsstelle.rs`, sind gespiegelt in
`frontend/src/api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs` und ergeben 400.

*Verworfen:* ein verschachteltes Objekt `standort: {adresse, lat, lon}` im Body. Es hätte einen
eigenen Tri-State-Typ gebraucht und das „ein Feld je Angabe“ der Spec gebrochen. Das Paneel schickt
die drei Felder trotzdem gemeinsam, aus der einen Zeile „Standort“.

### D3 · „Wie Einsatzort“ ist eine einmalige Kopie (Entscheidung Ruben, 11.10.2026)

Der Knopf füllt die Eingabe der Zeile „Standort“ mit `einsatzort`, `einsatzort_lat` und
`einsatzort_lon` aus `EinsatzAnzeige`. Gespeichert wird erst mit „Speichern“ der Zeile. Es gibt kein
Flag und keine Verknüpfung.

*Verworfen:* eine Spalte `standort_wie_einsatzort`, mit der der Standort dem Einsatzort folgt. Das
wäre eine zweite Wahrheit, die Schwärzung müsste beides abdecken, und ein korrigierter Einsatzort
verschiebt den ELW in der Wirklichkeit nicht.

### D4 · Standort-Zeile aus vorhandenen Teilen (Entscheidung Ruben, 11.10.2026)

Die Zeile „Standort“ ist eine `InlineAngabe` mit zwei Eingaben: `Input` für die Adresse und
`KoordinatenEingabe` (mit Ortsvorschau) für die Koordinate, dazu der Knopf „wie Einsatzort“, nur
wenn der Einsatz einen Einsatzort trägt. Die Leseansicht zeigt die Adresse und darunter die
Koordinate über `KoordinatenAnzeige` (Mono, `tabular-nums`).

Die Regel „Koordinate nur im Vollformular“ betrifft die Kopfdaten des Einsatzorts. Das
Führungsstellen-Paneel hat kein Vollformular, die Inline-Zeile ist dort die einzige Eingabeform.

*Verworfen:* eine lokale Adresssuche, herausgelöst aus `MarkerSuche.AdressGruppe`. Sie wäre ein
halber Ortsfeld-Baustein, der mit LFH-1248 ein zweites Mal entstünde. Außerdem ist sie am Modul
Lagekarte gegatet.

### D5 · Paneel: Reihenfolge, Segmentleiste, „Führungsfahrzeuge“ eingeklappt bei ortsfest

Reihenfolge der Zeilen: Art · Bezeichnung · Standort · Rufname · Sprechgruppen ·
Kommunikationsmittel · Erreichbarkeit · Führungsfahrzeuge. Ort und Name gehören vor die
Funkangaben, denn wer die Führungsstelle sucht, braucht zuerst den Ort.

- **Art:** `Segmentleiste` (nicht antds `Segmented`, siehe `frontend/AGENTS.md`), Werte „mobil“ und
  „ortsfest“. Sie schickt `{ art }`. Die Vorgabe wird mit dem Baustein aus
  `components/vorgabeText.ts` gekennzeichnet.
- **Führungsfahrzeuge:** Das Etikett heißt „Führungsfahrzeuge“. Bei `ortsfest` stehen die
  Fahrzeuge hinter einem Aufklapper (Boden über den Kontext, kein lokales `styles.header`).
  Eingeklappt nennt er die Anzahl („1 Führungsfahrzeug“) bzw. „—“. Das ist zulässig, weil die Angabe
  keine Pflicht ist („Ein Pflichtfeld gehört nie hinter den Collapse“).

### D6 · Abnehmer lesen die Bezeichnung, nie abgeleitet

- **Erfasst-Regel** (`stab/fuehrungsstelle.ts`): Bezeichnung, Adresse und Koordinate zählen mit,
  die Art nicht. Funkplan, Skizze, Sprechgruppenplan und Kommunikationsplan erben das.
- **Funkplan:** `stelleZusatz = fs.bezeichnung ?? null` in der Zeile `fs`. Das ist dieselbe
  Mechanik, mit der Fahrzeugzeilen ihren Typ zeigen, und sie gilt am Bildschirm, im Druck und im
  Markdown.
- **Fernmeldeskizze:** Die `NetzStelle` der Art `fuehrungsstelle` bekommt das Feld
  `zusatz: string | null`, nur bei Erfassung gesetzt.
  - Die Überschrift bleibt `EINSATZLEITUNG`. Sie ist die Funktion im Netz, und der Spec-Wortlaut
    „Kasten ‚Einsatzleitung‘“ bleibt gültig.
  - Layout (`fernmeldeskizzeLayout.ts`) und Element (`skizze/SkizzenElemente.tsx`) setzen den
    Zusatz als umbrechende Textzeile zwischen Überschrift und Rufname. Die Kastenhöhe wächst nur,
    wenn er gesetzt ist, auf dem Bildschirm, im Auto-Layout und im Druck aus derselben
    Höhenrechnung.
- **Organigramm:** Die Wurzel liest `einsatzKeys.fuehrungsstelle` und zeigt Bezeichnung und
  Rufnamen zwischen „Einsatzleitung“ und „Leitung nicht erfasst“, bei Erfassung und soweit
  gesetzt. Damit fällt das LFH-849-Non-Goal „Keine Übernahme in Organigramm“: Die Führungsstelle
  trägt jetzt einen Namen, die alte Begründung „trägt nur Funkangaben“ trifft nicht mehr zu.
  „Leitung nicht erfasst“ bleibt, denn die Person führt ein eigenes Ticket („Einsatzleiter als
  eigene Angabe“). Der Kommentar D5 in `Organigramm.tsx` wird fortgeschrieben.

*Verworfen:* „Einsatzleitung“ durch die Bezeichnung ersetzen. „ELW 2 Musterstadt“ ist die Stelle,
„Einsatzleitung“ die Funktion. Ohne Bezeichnung müsste auf eine Konstante zurückgefallen werden,
und die Spec-Szenarien der Skizze und des Organigramms würden brechen.

### D7 · Lagekarte: eigener Marker-Typ `fuehrungsstelle`, Zeichen `befehlsstelle`

- `baueMarker` erhält die Führungsstelle als weitere Eingabe und legt bei gesetzter Koordinate den
  Marker `{ schluessel: 'fuehrungsstelle', typ: 'fuehrungsstelle', id: 0, … }` an.
  - Beschriftung: Bezeichnung, sonst „Führungsstelle“.
  - Zeichen `fuehrungsstelleTz() = { grundzeichen: 'befehlsstelle' }`, also das
    DV-102-Grundzeichen Befehlsstelle (BABZ D.1.1 in `@einsatzzeichen`).
- Wie der Einsatzort steht er **nicht** im Cluster. Er teilt die feste Quelle des Einsatzorts, die
  zur Quelle „feste Marker“ wird. Die Quelle `marker-einsatzort` behält dafür ihren Namen, denn
  e2e-Tests und Klickebene hängen daran. Der Filter wird `typ ∈ {einsatzort, fuehrungsstelle}`.
- Ebene: neuer Key `fuehrungsstelle` in `EBENEN` („Führungsstelle“), mit Farbe, Sichtbarkeit und
  Zähler wie beim Einsatzort.
  - Inspector: Art, Adresse, Koordinate, Link „In Einsatzdaten bearbeiten“. Kein Ziehen, kein
    Platzieren.
  - Objektsuche, Startansicht und Deeplink (`markerToUrl`) kennen den Typ, und `clusterDonut`
    schließt ihn aus.
- Klickziel: dieselbe Rolle wie der Einsatzort in `ordneKlickebene` (Guard `klickziel.test.ts`),
  Trefferzone `controlHeight`.
- Die Daten lädt `useLagekarteDaten` über `einsatzKeys.fuehrungsstelle`. Es gibt kein Modul-Gate,
  denn die Führungsstelle ist mit dem Einsatz lesbar.

*Verworfen:* eine eigene Kartenquelle. Das wären zusätzliche Layer, Klickebenen und
Vertagungsschlüssel für genau einen Punkt, ohne Gewinn.

### D8 · Checkliste: Wert und Verweis, kein abgeleiteter Haken

- Nur der Wortlaut in `stab/checkliste.ts` ändert sich zu „Standort der Führungsstelle
  festgelegt“. Schlüssel `aufstellort`, Rust-Enum und Migration bleiben.
- `ChecklistePaneel` liest für diesen einen Punkt die Führungsstelle und zeigt unter der Quelle
  eine Wertzeile: „Bezeichnung · Adresse“, bzw. die Koordinate, wenn keine Adresse da ist.
  - Ohne Standort steht dort „Standort nicht erfasst“. Bei gesperrtem oder gescheitertem Abruf
    steht der Grund (`ZUSTAND_GRUND`).
  - Dazu kommt ein Link zu den Einsatzdaten, über den vorhandenen Deeplink auf das Paneel.
- Das ist Anzeige, keine Ableitung: Der Haken bleibt Handarbeit (Spec „ETB hat schon Einträge“
  gilt sinngemäß weiter), und die Bemerkung bleibt.

### D9 · Schwärzung (Entscheidung Ruben, 11.10.2026)

| Spalte | Klasse |
|---|---|
| `art` | retain `G_ENUM` |
| `bezeichnung` | retain `G_OP_LABEL` (wie `uhs.bezeichnung`) |
| `standort_adresse` | scrub `NullSetzen`, `Z_EINSATZ` |
| `standort_lat`, `standort_lon` | scrub `NullSetzen`, `Z_EINSATZ` (GPS mit-nullen wie beim Einsatzort) |

Die Guards `jede_einsatz_scoped_spalte_ist_klassifiziert` und `keine_toten_registry_eintraege`
erzwingen den Eintrag. Ein Test erweitert `schwaerzung_nullt_nur_die_erreichbarkeit` um den
Standort.

## Risks / Trade-offs

- [Bezeichnung als Freitext kann eine Adresse oder einen Namen tragen und bleibt bei der
  Schwärzung stehen] → Mit `uhs.bezeichnung` und `bereitstellungsraum.bezeichnung` gleich
  behandelt, als operatives Label. Die Doku nennt im Paneel-Kapitel ausdrücklich, dass die Adresse
  ins Feld „Standort“ gehört.
- [Adresse und Koordinate können auseinanderlaufen, weil es keine Suche gibt, die beide
  zusammen setzt] → Die Ortsvorschau der Koordinateneingabe zeigt den Ortsnamen zur Koordinate.
  „Wie Einsatzort“ übernimmt beide zusammen, und LFH-1248/LFH-1254 ersetzen die getrennte
  Eingabe.
- [Der Skizzenkasten wächst um eine Zeile und kann das Auto-Layout verschieben] → Die Höhe kommt
  aus derselben Rechnung wie die Ausstattungszeilen (LFH-1029). Ohne Bezeichnung ändert sich
  nichts, das prüft ein Layout-Test.
- [Zusätzlicher Abruf der Führungsstelle auf Lagekarte, Organigramm und Stabseite] → Er ist klein,
  über denselben Key gecacht, live über das Ereignis `einsatz` und schon auf Einsatzdaten und
  Funkplan im Einsatz.

## Migration Plan

- `migrations/0176_einsatz_fuehrungsstelle_ort.sql`: fünf `ALTER TABLE … ADD COLUMN`. SQLite kann
  `NOT NULL DEFAULT` mit CHECK bei `ADD COLUMN`, und bestehende Zeilen bekommen `mobil`.
- Vor dem Push `scripts/check-migrationen.sh` gegen `origin/alpha`. Hat `alpha` inzwischen eine
  0176, wird mit `--umnummerieren` umgelegt.
- Rückweg: Die Spalten sind additiv. Ein älteres Binary ignoriert sie, die Abnehmer fallen ohne
  Bezeichnung auf das heutige Bild zurück.
