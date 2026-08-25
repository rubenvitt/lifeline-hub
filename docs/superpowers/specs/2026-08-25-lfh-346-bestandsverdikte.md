# LFH-346 · C11 — Bestandsverdikte gegen die 15 Befunde

**Gemessen am 25.08.2026** gegen `11e8a358` (Merge LFH-345 · C10). Jede Zeile trägt ein
Verdikt und den Befehl bzw. die Fundstelle, aus der es stammt — **nicht** die Zahl aus dem
Ticket. Das Ticket wurde am 24.06.2026 geschrieben; Band B (LFH-329…332) und C10 (LFH-345)
haben seither Teile davon eingelöst, ohne den Ticket-Text nachzuziehen.

> Dieselbe Form wie bei C4/C5/C7: ein Teil des Tickets ist Bestand. Die Verdikte hier
> **korrigieren die Akzeptanzkriterien**; wer sie wörtlich ausführt, baut nach, was
> `KatalogTabelle`/`Datensicht`/`Erfassung` bereits tragen.

## Übersicht

| Befund | Ticket-Behauptung | Gemessen | Verdikt |
| --- | --- | --- | --- |
| **H34** | 0 × `isError` in 11 Katalog-Tabellen | 1 × je Tab in 11 Tabs + `BenutzerPage` + beide Karten-Verwaltungen, jeweils als `SeitenFehler`-Weiche vor der Tabelle | **erfüllt** (LFH-331 · B3) |
| **H35** | Löschen ohne Rückfrage, `loading` ungescopt | `Popconfirm` mit `okButtonProps={{ danger: true }}` steht (`StichworteTab.tsx:85-96`); `loading={loeschenMutation.isPending}` (Z. 93) sperrt **alle** Zeilen | **halb offen** — nur das Scoping |
| **H36** | Fahrzeug 11 Felder im Modal | `FahrzeugFormModal` 11 · `PersonalFormModal` 8 · `OnlineQuelleFormModal` 7 · `EtbBausteinFormModal` 6 · `MaterialFormModal` 6 `Form.Item` | **offen** |
| **M42** | kein `autoFocus`, Enter speichert nicht | 4 von 13 Masken auf dem `Erfassung`-Primitiv (Personal, Qualifikationen, Personal-Status, Status-Katalog, Einheitstypen); der Rest ist rohes `<Modal onOk={() => form.submit()}>` | **überwiegend offen** |
| **M43** | 9 von 9 Modalen schließen nach dem Speichern | Ein-/Zweifeld-Kataloge tragen `SchnellAnlegen`; `serie` für Fahrzeug/Personal/Material fehlt | **halb offen** |
| **M44** | 13 von 13 ohne Suche, Sortierung, Pagination | `suche={{…}}` an **13 von 13** Aufrufstellen; `sorter` auf jeder Leitspalte, `filters` auf 10 Status-/Kategoriespalten; `BLAETTER_SCHWELLE = 50` im Primitiv | **erfüllt** (LFH-330 · B2) |
| **M45** | vier Ausprägungen, `OrganisationTab` ohne Gate | 10 Tabs mit identischem `istAdmin`-Gate, das die Aktionsspalte **und** die Primäraktion **versteckt**; `OrganisationTab.tsx` ohne jedes Gate | **offen** |
| **M46** | `aktionen`-Slot von 3 von 13 genutzt | `adminNav.tsx:42` wickelt die 11 Stammdaten-Tabs selbst in `<AdminPage titel={label}>` — die Tabs **können** den Slot gar nicht erreichen | **offen (strukturell)** |
| **M47** | 32 × `size="small"` | 2 Treffer, beide **nicht interaktiv**: `<Spin size="small">` und `<Progress size="small">` | **erfüllt** (LFH-362/363 · B5) |
| **M48** | 25 Modulzeilen flach, feste `width: 180` | `ModulEinstellungsListe` (C10 · H16) trägt CSS-Grid `minmax(0,1fr) auto auto`, gestapelt unter `md`; Kategorie-Gruppierung, Filterfeld und der Text „immer sichtbar" fehlen | **halb offen** |
| **M49** | zwei Speichersemantiken ohne Trennung, kein Dirty-Guard | C10 hat die Bereiche sichtbar getrennt (`SektionHeader` + eigener `SpeicherFehler` bei der Liste); der Formular-Speichern-Knopf steht im **Kopf-Slot**, nicht im Fuß, und ein Verlassen-Guard fehlt | **halb offen** |
| **M50** | Statuswechsel ohne Ladezustand | `loading` ist zeilen-gescopt (`variables?.id === f.id`); `disabled` ist **global** (`const gesperrt = mutation.isPending`) und lähmt alle Zeilen — `FahrzeugeTab.tsx:91`, `MaterialTab.tsx:80`, `PersonalTab.tsx:94` | **halb offen** — nur `disabled` |
| **N13** | 0 × `ellipsis` | `grep -rn ellipsis frontend/src/stammdaten/ frontend/src/karten/` = 0 | **offen** |
| **N19** | 6/7 Spalten ohne Scroll-Gate, Zeilenaktionen in ein Überlauf-Menü | `KatalogTabelle` setzt `scroll` selbst und **entfernt es aus den Props** (`Omit<TableProps, 'scroll' \| 'sticky'>`); Zeilenaktionen: Offline max. **2** je Zustand (die drei Knöpfe liegen in einander ausschließenden Zweigen), Online **2** | **Scroll erfüllt · Bündelung nicht anwendbar** |
| **N20** | Sieben-Feld-Formular im Modal | `OnlineQuelleFormModal` 7 `Form.Item` | **offen** |

## Korrigierte Akzeptanzkriterien

Die folgenden Ticket-ACs sind **gegenstandslos** und werden gestrichen, weil sie heute schon
erfüllt sind — sie stehen zur Nachvollziehbarkeit hier statt in der Ticket-Beschreibung:

1. „`<Table` außerhalb des Primitivs = 0" — ist 0.
2. „`size=\"small\"` = 0 auf interaktiven Elementen (heute 32)" — ist 0.
3. „Suche und Sortierung in allen Katalog-Tabellen wirksam" — ist an 13 von 13 gesetzt.
4. „`pagination` schaltet ab ~50 Zeilen zu" — `BLAETTER_SCHWELLE = 50`.
5. „beiden Kartentabellen `scroll={{ x: 'max-content' }}` geben" — das Primitiv verbietet
   dem Aufrufer, `scroll` überhaupt zu setzen.

Zwei ACs sind **falsch adressiert** und werden umformuliert:

- „die URLs stammen aus `frontend/src/routing/deeplinks.ts`" — Admin-Pfade liegen seit
  LFH-284 in `frontend/src/admin/adminNav.tsx` (`adminSektionPfad`, `adminBenutzerPfad`,
  `ersteSektionPfad`). `deeplinks.ts` trägt **Einsatz**-Pfade. Die neuen Detailrouten
  gehören zu den Admin-Buildern, sonst gäbe es zwei Quellen für dieselbe Adressfamilie.
- „jedes Modal speichert per Enter (Vitest)" — eine Maske, deren Felder überwiegend
  `Select` sind, kann das **bibliotheksbedingt nicht** belegen: `@rc-component/select`
  ruft in `BaseSelect/index.js:246` bei jedem Enter `preventDefault()`. Geprüft wird die
  **Struktur, aus der die Zusicherung folgt** — kein `.ant-modal-footer` und
  `knopf.closest('form') !== null` (Muster `components/Erfassung.test.tsx`).

## Was daraus wirklich zu tun ist

Neun Arbeitspunkte, gruppiert nach der Datei-Menge, die sie anfassen — die Gruppierung ist
zugleich der Schnitt für die parallele Umsetzung (disjunkte Dateimengen).

| # | Punkt | Befunde | Dateien |
| --- | --- | --- | --- |
| A1 | Zeilen-Scoping des `disabled` bei Statuswechsel + Löschen | H35, M50 | `FahrzeugeTab`, `MaterialTab`, `PersonalTab`, `StichworteTab`, `BenutzerPage` |
| A2 | Rechte-Darstellung vereinheitlichen (`RechteHinweis`, Primäraktion gesperrt statt weg), `OrganisationTab` bekommt sein Gate | M45 | 11 Stammdaten-Tabs, 2 Karten-Sektionen |
| A3 | Primäraktion in den Kopf-Slot — verlangt eine Entscheidung an `adminNav.tsx` | M46 | `adminNav.tsx` + 11 Tabs |
| A4 | Freitext-Spalten begrenzen (`ellipsis: { showTitle: true }` + `width`) | N13 | `EtbBausteineTab`, `SprechgruppenTab`, beide Karten-Verwaltungen |
| ~~A5~~ | **entfällt** — Bündelung ab 3 Aktionen, gemessen sind es 2 | N19 | — |
| A6 | Masken auf das `Erfassung`-Primitiv heben | M42, M43 | 6 Form-Modale + 2 in `BenutzerPage` |
| A7 | Fahrzeug/Personal auf Detailrouten, Modal auf Schnellerfassung ≤ 4 Felder | H36 (11 / 8) | neue Seiten + `adminNav`, `FahrzeugFormModal`, `PersonalFormModal` |
| A8 | Drei Masken auf ihre Pflichtfelder + „Erweitert"-Collapse | N20, H36 (7 / 6 / 6) | `OnlineQuelleFormModal`, `EtbBausteinFormModal`, `MaterialFormModal` |
| A9 | Einsatz-Defaults: Kategorie-Gruppierung + Filter, Speicherleiste in den Fuß, Verlassen-Guard | M48, M49 | `ModulEinstellungsListe`, `EinsatzDefaults`, `EinsatzModule` |

**Zur Feldschwelle:** H36 spricht von „6 von 9 Modalen über der Schwelle". Gemessen sind es
**fünf**: Fahrzeug 11 · Personal 8 · Online-Quelle 7 · ETB-Baustein 6 · Material 6.
`SprechgruppeFormModal` trägt 3 und war nie darüber. Zwei davon brauchen eine Route (A7), drei
löst ein Collapse (A8) — die Trennlinie ist nicht die Feldzahl allein, sondern ob der
Feldbestand eine eigene Adresse verdient: ein Fahrzeug wird verlinkt und nachgeschlagen, eine
Kartenquelle wird einmal eingerichtet.
