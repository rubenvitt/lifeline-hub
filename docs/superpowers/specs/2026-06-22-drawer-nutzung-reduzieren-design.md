# Design: Drawer-Nutzung reduzieren (LFH-19)

**Datum:** 2026-06-22
**Task:** LFH-19 (Epic `86ca33mmk`)
**Status:** in design

## Kontext & Ziel

Antd-`Drawer` (Seitenpanels) werden im Frontend zu breit eingesetzt — teils mit
umfangreichem Inhalt, der in einem schmalen Drawer überladen wirkt. Drawer eignen
sich für kurze, fokussierte Interaktionen (Quick-View, Schnellerfassung), nicht für
große Detail- oder Bearbeitungsansichten.

Erster Schritt ist bereits erfolgt: UHS-Detail wurde vom Drawer auf eine eigene
Vollseite umgestellt (Commit `b6fb537`, PR #1). Dieses Vorgehen wird hier verallgemeinert.

**Akzeptanzkriterien:**
- AK1: Übersicht der bestehenden Drawer-Einsätze inkl. Bewertung liegt durabel vor.
- AK2: Überladene Drawer sind auf passendere UI-Form umgestellt.
- AK3: Klare Leitlinie, wann ein Drawer verwendet wird (und wann nicht).

**Scope dieses Durchlaufs:** AK1 + AK3 vollständig; AK2 exemplarisch für **PersonenPage**
als sauberes Referenzmuster. Die übrigen überladenen Drawer werden anschließend per
Workflow/ultracode nach demselben Muster umgestellt (je eigener Subtask unter dem Epic),
damit jede Umstellung einzeln reviewbar bleibt.

---

## AK1 — Inventur der Drawer-Einsätze

Bewertungsskala für „Umfang": **schlank** (Quick-View / ≤~4 Felder) · **mittel** ·
**überladen** (mehrere Sektionen/Tabs, >~5 Felder, Workflow).

| # | Datei | Zweck | Umfang | Breite | Empfehlung |
|---|-------|-------|--------|--------|------------|
| 1 | `personen/PersonDetailDrawer.tsx` | Read-only Quick-View Person (aus UHS-Grundriss), Link „Vollständig öffnen" | schlank | 460 | **Drawer behalten** — Vorbild-Use-Case |
| 2 | `etb/MitgliederPanel.tsx` | Einsatzmitglieder + Rollen verwalten (Tabelle, Inline-Select) | schlank | 480 | **Drawer behalten** |
| 3 | `pages/uhs/UhsAnlegenDrawer.tsx` | UHS anlegen (Schnellerfassung, 4 Felder) | schlank | 420 | **Drawer behalten** (Schnellerfassung) |
| 4 | `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` | Bereitstellungsraum anlegen (3 Felder) | schlank | 420 | **Drawer behalten** (Schnellerfassung) |
| 5 | `pages/lagekarte/GefahrengebietMatrixDrawer.tsx` | 13×5-Gefahrenmatrix eines Gebiets | mittel (breit) | 560 | **Prüfen** → Vollseite/Modal (Subtask, niedrige Prio) |
| 6 | `pages/uhs/UhsDetailPage.tsx` (Material/Bewegungen-Tabs) | Material- + Bewegungs-Tabs als Drawer auf der UHS-Detailseite | mittel | 640 | **Prüfen** → Tabs direkt auf der Detailseite (Subtask) |
| 7 | `pages/TierePage.tsx` | Tier-Detail + Edit (11 Felder), Status-Aktionen, Abschluss | überladen | 520 | **→ Vollseite** (Subtask) |
| 8 | `pages/SchaedenPage.tsx` | Schaden-Detail + Edit (5 Felder + Geschädigt-Picker), Status-Aktionen | überladen | 520 | **→ Vollseite** (Subtask) |
| 9 | `pages/PersonenPage.tsx` (`?person=`) | Personen-Detail: 2 Tabs (Stammdaten / med. Verlauf), Edit, Status-FSM, Sichtung/Verbleib, Vermisstenabgleich, Audit | **überladen** | 520 | **→ Vollseite — Referenzumstellung dieses Tasks** |

**Bereits umgesetzte Vollseiten-Vorbilder** (kein Drawer): `pages/uhs/UhsDetailPage.tsx`,
`pages/bereitstellungsraum/BrDetailPage.tsx`, `pages/BefehlDetailPage.tsx`,
`pages/LageberichtDetailPage.tsx`.

---

## AK3 — Drawer-Leitlinie

Die UI-Form richtet sich nach Umfang und Interaktionsart des Inhalts:

| Form | Wann |
|------|------|
| **Vollseite / eigene Route** | Umfangreiche Detail-/Bearbeitungsansichten: mehrere Sektionen oder Tabs, >~5 Felder, mehrstufiger Workflow, Deep-Link-würdig. Konvention: `/einsaetze/:einsatzId/<modul>/:id`. |
| **Modal / Dialog** | Kurze, blockierende Aktion: Bestätigung, Auswahl, kleines Formular (≤~3 Felder). |
| **Inline / Expander** | Kontextbezogener Zusatzinhalt, der die Liste/Seite nicht verlässt. |
| **Drawer** | **Nur** schlanker, fokussierter Quick-View (read-only Vorschau) **oder** Schnellerfassung mit ≤~4 Feldern. Kein dauerhaftes Bearbeiten umfangreicher Entitäten, keine mehrteiligen Tabs. |

**Faustregel:** Sobald ein Drawer Tabs bekommt, einen Edit-Modus mit vielen Feldern
trägt oder breiter als ~480 px sein muss, gehört der Inhalt auf eine eigene Route.

Die Kurzfassung dieser Regel wird in `CLAUDE.md` (Frontend-Abschnitt) verankert, damit
sie auch in künftige KI-Arbeit automatisch einfließt.

---

## AK3b — Listenform-Leitlinie (nachgetragen 2026-07-28, LFH-330 · B2)

Die Tabelle oben beantwortet **eine** Frage: welches Gefäß trägt einen **einzelnen** Datensatz
(Vollseite / Modal / Inline / Drawer). Sie sagt nichts darüber, wie eine **Menge** von
Datensätzen dargestellt wird — und genau dort ist das Frontend auseinandergelaufen: 30 Dateien
rendern eine antd-`<Table>`, 10 gehen über `components/Liste.tsx`, ohne Regel wann was
(Befund M33 des UI/UX-Sweeps). Diese Lücke schließt der folgende Abschnitt.

| Listenform | Wann |
|------------|------|
| **Tabelle** (`components/KatalogTabelle.tsx`, bzw. `Datensicht` mit `form="tabelle"`) | Es wird **verglichen**: homogene Datensätze, Blick wandert über eine Spalte statt über eine Zeile, Sortieren/Filtern über mehr als vier Attribute. Kanonisch: die Stammdaten-Verwaltung und das Meldebild der Kräfteübersicht. |
| **Liste / Karte** (`components/Liste.tsx`, bzw. `Datensicht` mit `form="karte"`) | Ein Datensatz wird als **Einheit** erfasst: Titel, Status, Zeit und **eine** Handlung. Kanonisch: die Kommunikationsmodule (Aufträge, Meldungen, Erinnerungen, Nachforderungen, Befehle, Lageberichte). |
| **Kachel** | Nur für Überblicksflächen, die zu einer anderen Fläche führen — nicht für Datenmengen, die man durchsucht. |

**Faustregel:** Ist die Frage „welcher von diesen ist der richtige?" → Tabelle. Ist sie
„was ist mit diesem hier?" → Liste/Karte.

**Auf schmalem Schirm wird eine Tabelle angepasst, nicht in Karten aufgelöst.** Der Regelweg
ist der waagerechte Scrollcontainer mit stehender Kopfzeile und fixierter menschenlesbarer
Kennung, den `KatalogTabelle` unbedingt setzt (Festlegung 2 der Bedien-Leitlinie,
`2026-07-25-bedien-leitlinie-einsatzkontexte.md`). Zusätzlich kann eine Spalte über
`abBreite` erst ab einer Breite erscheinen — „weniger Spalten, aber weiter Tabelle".

**Der Karten-Fallback unter `md` ist die begründungspflichtige Ausnahme**, nicht der
Normalfall. Er gilt für `Datensicht` mit `form="auto"` und ist auf Module beschränkt, in
denen ein Datensatz als Einheit erfasst wird. Die Begründung steht im Dateikopf von
`frontend/src/components/Datensicht.tsx` und in der Prüfliste Einsatztauglichkeit des
Pakets; sie stützt sich auf die gemessene Lage bei 390 px, wo antd bis zu zehn Spalten auf
die verfügbare Breite staucht und die Aktionsspalte nicht mehr treffbar ist. **Keine der 13
Katalogtabellen wird zu Karten** — dort wird verglichen.

Was der Kartenzweig heute **nicht** kann und bewusst nicht können soll: In-Zeile-Bedienung.
Die `Select`-Felder in den Zeilen von Fahrzeugen, Personal und Material haben in einer Karte
keine Entsprechung; unter `md` sind diese Module lesend plus eine Primäraktion. Das ist ein
realer Verlust, kein Versehen — B5 (LFH-333) holt den Statuswechsel ohnehin aus der 24-px-Zelle
in einen Quick-View, und dann passt der Auslöser in den Aktionsslot der Karte.

---

## AK2 — Referenz-Umstellung: PersonenPage-Drawer → Vollseite

### Architektur

Referenzmuster ist `BefehlDetailPage.tsx` (klare `istBearbeiten`-Boolean → Read- vs.
Edit-Renderer, Status-Workflow, Breadcrumb + Header mit Tags/Aktionen).

**Neue Komponente:** `frontend/src/pages/PersonenDetailPage.tsx` (~300–350 Z.),
extrahiert aus der heutigen `drawerInhalt`-Funktion (PersonenPage.tsx:289–534) plus
den zugehörigen Mutations (PersonenPage.tsx:175–229).

**Route** (in `App.tsx`, bei den übrigen Detail-Sub-Routes):
```tsx
<Route path="personen/:personId" element={<PersonenDetailPage />} />
```
Parameter: `einsatzId = Number(useParams().id)`, `personId = Number(useParams().personId)`.

### Layout (zwei Spalten, ohne Tabs)

```
Breadcrumb: Einsätze › <Einsatz> › Personen › <Registrier-Nr / Name>
[Status-Tag] [SK-Tag]                       [Bearbeiten] [Stornieren] [Status-Übergänge]
┌─ STAMMDATEN ──────────────┬─ MEDIZINISCHER VERLAUF ──────────────┐
│ Name, Vorname, Geschlecht │ [Re-Sichten] [Verbleib erfassen]     │
│ Geburtsdatum, Alter       │ chronologische Timeline              │
│ Herkunft, Adresse         │   (Sichtung / Verbleib / Notiz)      │
│ Antreffort, Melder, Kontakt│ Verlaufsnotiz [____________] [+]     │
│ Notiz                     │ Vermisstenabgleich                   │
│ ─ Zuordnungen ─           │                                      │
│ Tiere · Schäden           │                                      │
│ ─ Audit (nur EL) ─        │                                      │
└───────────────────────────┴──────────────────────────────────────┘
```
- **Read-Modus**: Stammdaten als `Descriptions`; **Edit-Modus**: `Form` (vertikal). Umschalten
  über `istBearbeiten`-Boolean wie in BefehlDetailPage / heutiger PersonenPage.
- Aktionen sichtbar je Schreibrecht (`darfSchreiben`, `!storniert`) — bestehende Logik wird
  übernommen, nicht neu erfunden.
- Auf schmalen Viewports stapeln die Spalten (antd `Row`/`Col` responsive).

### Datenfluss

Keine neuen API-Calls. Wiederverwendete Query-Keys:
- `['einsatz', einsatzId]` — Zugriff/Rolle
- `['einsatz-person', einsatzId, personId]` — Detail
- `['einsatz-tiere', einsatzId, 'halter', personId]`, `['einsatz-schaeden', einsatzId, 'geschaedigt', personId]`
- `['einsatz-person-audit', einsatzId, personId]` (nur Einsatzleitung)

Mutations (unverändert übernommen): Status-Wechsel, Edit, Storno, Sichtung, Verbleib,
Verlaufsnotiz, Vermisstenabgleich. Loading → `<Spin>`, Fehler → `<Alert type="error">`.

### Änderungen an Bestandscode

- **`PersonenPage.tsx`** wird List-only: Detail-Drawer (671–688), `drawerInhalt` und die
  Detail-Mutations wandern nach `PersonenDetailPage.tsx`. Zeilen-Klick →
  `navigate(\`/einsaetze/${einsatzId}/personen/${id}\`)`.
- **Rückwärtskompatibilität**: Der alte Deep-Link `?person=<id>` wird in `PersonenPage`
  weiterhin abgefangen und per `navigate(replace)` auf die neue Route umgeleitet.
- **`PersonDetailDrawer.tsx`** (schlanker Quick-View) **bleibt**; „Vollständig öffnen"
  (Zeile 82) zeigt künftig direkt auf `/einsaetze/${einsatzId}/personen/${p.id}` statt
  `…/personen?person=${p.id}`.

### Tests

- **Vitest**:
  - `PersonenDetailPage` rendert Read-Modus (Stammdaten + Timeline), wechselt in Edit-Modus.
  - Aktionen/Buttons sichtbar bzw. ausgeblendet je `darfSchreiben` / Storno-Status.
  - `PersonenPage` rendert ohne Drawer; Zeilen-Klick navigiert zur Detail-Route.
  - `?person=<id>` leitet auf `/personen/:personId` um (Redirect-Verhalten).
  - `PersonDetailDrawer` „Vollständig öffnen" navigiert auf die neue Route.
  - Personen-Detail-Tests brauchen `MemoryRouter` mit gesetztem `:personId`.
- **Playwright-e2e**: Zwei-Spalten-Layout sichtbar + Navigation Liste → Detail → zurück
  (jsdom rechnet kein Layout → Überlappung/Spaltigkeit nur per e2e prüfbar). Backend via
  Debug-Binary auf `.env.local`-Port.

### Verifikations-Hinweise

- Frontend ist via rust-embed ins Binary eingebettet → für manuelle/e2e-Sicht
  `pnpm build` + Backend-Neustart, sonst altes Bundle.
- Volle Vitest-Suite unter Last flaky → Gate mit `--no-file-parallelism`.
- Typecheck (`tsc --noEmit`) als eigenes Gate (Vitest/esbuild prüft keine Typen).

---

## Workflow für den Rest (nach grüner Referenz)

Nach erfolgreicher PersonenPage-Umstellung + Code-Review werden die übrigen
Umstellungs-Kandidaten per Workflow nach demselben Muster bearbeitet — je eigener
Subtask unter Epic `86ca33mmk`, eigener Branch/PR, einzeln reviewbar:

1. **TierePage** → Vollseite `/einsaetze/:id/tiere/:tierId`
2. **SchaedenPage** → Vollseite `/einsaetze/:id/schaeden/:schadenId`
3. **UhsDetailPage Material/Bewegungen** → Tabs direkt auf der Detailseite (bewerten)
4. **GefahrengebietMatrixDrawer** → Vollseite/Modal (bewerten, niedrige Prio)

Schlanke Drawer (#1–4 der Inventur) bleiben unverändert — sie entsprechen der Leitlinie.

---

## Abgrenzung (YAGNI)

- Keine Änderung an der Listen-/Filter-UX der PersonenPage über das Nötige hinaus.
- Keine neuen Backend-Endpunkte.
- Keine Umstellung der schlanken Drawer.
- Kein generischer „DetailPage"-Abstraktions-Layer — die bestehenden Detail-Seiten
  folgen bewusst einem kopierten, lokal verständlichen Muster.
