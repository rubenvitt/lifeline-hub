# Design

## Context

Die Motivation steht in `proposal.md`, „Why“. Stand am 16.11.2026 (34be1aab):

- **README-Erzeugung:** `frontend/scripts/design-system/readme.ts` schneidet die README aus
  `frontend/AGENTS.md`. `README_SECTIONS` trägt die ganzen Abschnitte Gestaltungssprache,
  Farbachsen, Farbe und Zeichen, Tabelle und Dichte, Texte und Begriffe, `README_RULES` einzelne
  Spiegelstriche (Zeitdarstellung). `skip` lässt einzelne Spiegelstriche aus. Fehlt ein Abschnitt,
  bricht der Generator ab.
- **Umfang der README:** 663 Zeilen, davon allein 241 aus „Gestaltungssprache“.
- **Vorschauen:** `previews.tsx` trägt 29 `PREVIEWS` und rendert die echten Bausteine mit dem
  antd-Theme der App. Die Höhe jeder Karte ist in Chromium gemessen (`height`). Der Router, der
  QueryClient und der Client-Render für Bedienzustände existieren schon.
- **Wächter:** `designSystem.guard.test.ts` vergleicht das Erzeugte bytegenau,
  `designSystem.test.ts` prüft die Schneidefunktionen.
- **Quellen für die fehlenden Karten:**
  - `components/SeitenZustand.tsx` (SeitenSkeleton, SeitenLeer, SeitenFehler)
  - `instrument/PaneelZustand.tsx`
  - `components/EinsatzSeite.tsx`
  - `instrument/Formularpaneel.tsx`
  - `components/speicherLeiste`
  - `components/Erfassung.tsx` (`ErfassungsModal`)
  - `components/KatalogTabelle.tsx`
  - `components/SpeicherHinweis.tsx` (RechteHinweis)
  - `instrument/WarnstufenHinweis.tsx`
  - `antdKnopf` in `theme/tokens.ts`
  - `einsatz/IconRail.tsx` und `einsatz/ModulPanel.tsx` (klebend positioniert)

## Goals / Non-Goals

**Goals:**
- Die README taugt als Nachschlagewerk: Die Bausteinwahl steht vorn, danach folgen die Regeln
  ohne Historie.
- Die Grundformen jeder Seite liegen als Karte vor.
- Bausteinwahl und Karten können nicht auseinanderlaufen.

**Non-Goals:**
- Regeln in `frontend/AGENTS.md` umschreiben. Dort ändert sich nur der neue Abschnitt; die
  Ticketverweise bleiben dort stehen.
- Karten für die Bausteine aus LLH-1810 (Text, Stapel, Meta, Feld). Die bringt LLH-1810 selbst
  mit; sein `Feld` löst dann die Karte „Eingabefeld“ ab.
- Die Zeilen zu Umschalten und Bearbeiten (Change `gyidpati-…`).

## Decisions

**D1: Die Bausteinwahl ist eine Regel in `frontend/AGENTS.md`, die README übernimmt sie zuerst.**
Ein neuer Abschnitt `## Frontend — Bausteinwahl (wann nehme ich was)` steht direkt hinter der
Gestaltungssprache. Er besteht aus einer Tabelle mit den Spalten Bedarf, Baustein (Import) und
Karte. Die Gruppen sind Darstellen, Rahmen, Rückmeldung, Eingabe und, nachgetragen von gyidpati,
Umschalten und Bearbeiten. `README_SECTIONS` setzt den Abschnitt an die erste Stelle. Ein Satz je
Zeile genügt; wo eine Regel ausführlicher an anderer Stelle steht, verweist die Zeile auf den
Abschnitt und wiederholt ihn nicht.

Verworfene Alternativen:
- **V2, ein Wann-Satz aus dem JSDoc je Baustein:** JSDoc sagt, was ein Baustein ist, nicht wann
  er statt eines ähnlichen passt.
- **V3, die README nur als Kartenindex:** Ein `/design`-Agent verlöre die Regeln ohne eigene
  Karte, etwa Farbachsen und Dichte.

**D2: Verweise filtert der Generator, die Quelle bleibt unverändert.** Eine reine Funktion
`ohneVerweise(text)` in `readme.ts` arbeitet in zwei Schritten:
- **(a) Reine Verweisklammern** fallen ganz weg. Sie enthalten nur Ticketnummern (`LFH-n`,
  `LLH-n`), `Spec \`x\``, Pfade unter `docs/`, `openspec/` und `.claude/`, Entscheidungskürzel
  (`D8`, `Punkt 1–7`) und Datumsangaben.
- **(b) Gemischte Klammern** verlieren nur ihre Verweisglieder samt Trennzeichen (`, ` und `; `).
  Bleibt die Klammer danach leer, fällt sie ganz weg.

Danach prüft der Generator, dass keine Ticketnummer übrig ist. Findet er eine, bricht er mit der
Fundstelle ab. Dann wird entweder der Filter geschärft oder in `frontend/AGENTS.md` die
Formulierung so gestellt, dass der Verweis in einer Klammer steht. Unit-Tests am Text decken die
Fälle aus `frontend/AGENTS.md` ab (Abschnittskopf mit Klammer, Verweis mitten im Satz, mehrere
Glieder, Datum).

Verworfen wurde, die Ticketnummern in `frontend/AGENTS.md` zu streichen. Sie sind dort die
Prüfspur, und `AGENTS.md` (Wurzel) verlangt Verweise mit Datei und Abschnitt.

**D3: Was in der README bleibt.** Es bleiben die Abschnitte, die eine Gestaltung entscheiden:
- Bausteinwahl
- Gestaltungssprache, ohne Spiegelstriche ohne Gestaltungsbezug
- Farbachsen
- Farbe und Zeichen
- Dichte und Bedienziele
- Texte
- Begriffe
- Zeitdarstellung

`skip` in der Gestaltungssprache wächst um die Spiegelstriche, die Abläufe im Repo,
Datenherkunft oder Modulstruktur beschreiben. Das Kriterium dafür: Würde ein Entwurf ohne den
Strich anders aussehen? Wenn nein, fällt er weg. Die Liste steht als Kommentar an `skip`. Wer in
Zukunft einen Strich hinzufügt, entscheidet dort.

Kartenbezogene Regeln aus Abschnitten, die die README nicht trägt, etwa zum Seitenkopf oder zur
Tabelle, kommen per `ruleHead`/`moreDoc` an die README der jeweiligen Karte.

Ziel ist eine README unter 350 Zeilen. Das ist ein Richtwert, kein Wächter.

**D4: Neue Karten.**

| Karte | Inhalt | Quelle (`source`) |
|---|---|---|
| `Knopf` | Primär, sekundär, Text, Gefahr, gesperrt, mit Symbol | `theme/tokens.ts` (Anker `antdKnopf`) |
| `Eingabefeld` | Input, Select, Datum mit Beschriftung darüber, Pflicht, Fehlerzeile (`FeldFehler`) | `instrument/FeldFehler.tsx` + `ruleHead` |
| `Dialog` | `ErfassungsModal` geöffnet, inline gerendert (`getContainer={false}`), mit Fuß | `components/Erfassung.tsx` |
| `Zustaende` | SeitenSkeleton, SeitenLeer, SeitenFehler, PaneelZustand (laden, leer, fehler) | `components/SeitenZustand.tsx`, `moreDoc` PaneelZustand |
| `Hinweis` | Statusflächen-Alert (normal, achtung, alarm), RechteHinweis, WarnstufenHinweis | `components/SpeicherHinweis.tsx` |
| `Seitenkopf` | `EinsatzSeite` mit Titel, Meta, Aktionen, Ortspfad (MemoryRouter) | `components/EinsatzSeite.tsx` |
| `Formularlayout` | `Formularpaneel` mit zwei Feldgruppen und Speicherleiste | `instrument/Formularpaneel.tsx` |
| `Tabelle` (erweitert) | `KatalogTabelle` mit Suche, Spaltenschalter, 5 Zeilen, ⋮-Menü | `components/KatalogTabelle.tsx` |
| `Navigation` (bedingt) | `IconRail` und `ModulPanel` mit festem Rahmen in der Karte | `einsatz/IconRail.tsx` |

- **Gruppen:** Nach den Gruppen der Bausteinwahl.
- **Höhen:** Bei 720 px Breite in Chromium gemessen, wie beim Bestand.
- **Bedingung für „Navigation“:** Kommt die Vorschau ohne Klebe- und Rahmenkontext nicht aus,
  sodass die App-Hülle nachgebaut werden müsste, wird die Karte zur Folgeaufgabe. Die
  Bausteinwahl nennt dann keine Karte für die Navigation.
- **Kein Drawer:** Wo die Bausteinwahl den Navigations-Drawer erwähnt, verweist sie auf die
  Karte „Navigation“, falls es sie gibt, sonst auf keine.

**D5: Abdeckungswächter.** Er steht in `designSystem.test.ts`, denn er ist kein Bytevergleich,
sondern eine Regel. Er liest den Abschnitt Bausteinwahl aus `frontend/AGENTS.md`, sammelt die
Kartennamen aus der Spalte Karte (Codeschrift, `components/<Name>/`) und vergleicht sie mit
`PREVIEWS.map(p => p.name)`, in beide Richtungen. Das Deckblatt `Cover` ist ausgenommen.

Verworfen wurde, die Bausteinwahl aus `PREVIEWS` zu erzeugen. Dann stünde die Regel im Code des
Generators statt in `frontend/AGENTS.md`, und gyidpati hätte keinen Ort für seine Tabelle.

## Risks / Trade-offs

- **[Der Verweisfilter verstümmelt einen Satz]** → Abbruch bei Resten (D2), Unit-Tests an echten
  Sätzen und Durchsicht der erzeugten README im Diff.
- **[Die neuen Karten machen das erzeugte Paket um rund 1,7 MB größer]** → Die Grenzen des
  Artifacts liegen weit darüber. Jede Karte trägt nur den nötigen Zustand.
- **[`ErfassungsModal` oder `EinsatzSeite` brauchen Kontext (Query, Rechte, Einsatz)]** → Die
  vorhandenen Helfer der Vorschauen (`stillerQueryClient`, MemoryRouter) und Vorgabe-Props.
  Braucht ein Baustein eine Netzanfrage, bekommt er Daten über `setQueryData`, nie über einen
  Nachbau.
- **[Die Abschnitte von gyidpati und dieser Change berühren dieselbe Tabelle]** → Beide liegen im
  selben Branch, gyidpati kommt danach und hängt nur Zeilen an.
- **[Das Abstandsraster (m113c8ln) ändert alle Vorschauen]** → Diese Change setzt im Branch nach
  m113c8ln auf. Erzeugt und gemessen wird erst, wenn das Raster steht.

## Migration Plan

Keine Daten, nur erzeugte Dateien. Nach dem Merge wird das Design System neu veröffentlicht, wie
`frontend/AGENTS.md`, „Größere UI-Entwürfe“, es vorschreibt: nur die geänderten Dateien unter
`project/`, `design-system.json` zuletzt. Ohne claude.ai-Anmeldung kommt ein Kommentar an die
Aufgabe.
