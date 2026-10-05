# Design

## Context

Stand `alpha` 894781c9. Motivation: proposal.md.

- `stammdaten/OrganisationTab.tsx` hat zwei `<Form>`: Name (Knopf „Namen speichern“, eigener
  Merker `nameGeaendert`, Cache aus der Antwort) und DV-102-Organisation (klebende Leiste aus
  `useSpeicherLeiste`, Toast „DV-102-Organisation gespeichert“). Dazwischen das Logo-Paneel ohne
  Formular. `PATCH /api/organisation` nimmt `name` und `tz_organisation` beide optional und
  schreibt sie in einem `UPDATE` (`src/routes/organisation.rs`).
- `useSpeicherLeiste` steht auf acht Seiten: Organisation, Fahrzeug-Detail, Personal-Detail,
  Anzeige, Einsatz-Defaults, Einsatz-Allgemein, -Verhalten, -Aufbewahrung. Nur Einsatz-Defaults
  hat einen Merker (`hatFassung`) und `beforeunload`.
- `entwurf/EntwurfNavigationSchutz.tsx` trägt die einzige `useBlocker`-Rückfrage
  (Bleiben / Verwerfen / Speichern und weiter, Fehler im Dialog, `mask.closable: false`).
- Produktion läuft im Data Router (`createBrowserRouter`, `main.tsx`). Die Tests rendern über
  `test/utils.tsx:renderMitProviders` in einem `MemoryRouter`; `useBlocker` wirft dort
  („useBlocker must be used within a data router“). 274 Testdateien nutzen den Helfer.

## Goals / Non-Goals

**Goals:**
- Ein Baustein für die Rückfrage, den Entwürfe und Formularseiten teilen.
- Ein Merker-Hook für Formularseiten, der Rückfrage und Browser-Warnung speist.
- Organisation mit einem Formular und einem PATCH.

**Non-Goals:**
- Kein „Speichern und weiter“ auf Formularseiten (D3).
- Kein Schutz bei reinem Wechsel von Suchparametern oder Hash, nur bei Pfadwechsel (wie bei den
  Entwürfen).
- Kein e2e-Test; das Ticket nennt ihn optional. Die Spec-Szenarien decken Vitest-Proben ab.
- Kein Umbau von `EinsatzModule` und keine Änderung am Backend.

## Decisions

### D1 Rückfrage als gemeinsamer Baustein `components/VerlassenRueckfrage.tsx`

Die Mechanik aus `EntwurfNavigationSchutz` zieht unverändert in `components/`: `useBlocker` bei
Pfadwechsel, Modal „Ungespeicherte Änderungen“ mit „Verwerfen“ (danger) und „Bleiben“, Nachholen
des Wechsels, sobald der Merker während der offenen Rückfrage fällt. „Speichern und weiter“ und
der Fehler im Dialog erscheinen nur, wenn `speichern` übergeben ist. `EntwurfNavigationSchutz`
wird zur dünnen Hülle darüber, seine Props und Tests bleiben gleich.

Alternative: zweiter, eigener Blocker für Formularseiten. Verworfen, weil zwei Kopien derselben
Rückfrage auseinanderlaufen (Wortlaut, Knopfordnung, `mask`).

### D2 Merker-Hook `components/useFormularVerlassenSchutz.ts`

```ts
const schutz = useFormularVerlassenSchutz({ aktiv: darfBearbeiten });
<Form onValuesChange={schutz.geaendert} …>
// beim Absenden
const fassung = schutz.fassung();
mutate(werte, { onSuccess: () => schutz.gespeichert(fassung) });
<VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
```

- Eigener Zustand, **nicht** `isFieldsTouched`: antd setzt `touched` nach dem Speichern nie zurück.
- Ein Fassungszähler statt eines Booleans: `geaendert()` zählt hoch, `gespeichert(f)` setzt nur
  zurück, wenn seit `fassung()` nichts dazukam. So bleibt eine Eingabe während des Speicherns
  geschützt (Spec „Weitertippen …“), ohne Werte vergleichen zu müssen.
- `ungespeichert = aktiv && zaehler > gesichert`. `aktiv: false` (kein Schreibrecht) schaltet
  Rückfrage und Warnung ab, auch wenn ein programmatisches `setFieldsValue` je ein
  `onValuesChange` auslösen sollte.
- `beforeunload` sitzt im Hook (nur `preventDefault()`, wie heute in `EinsatzDefaults`), solange
  `ungespeichert` gilt. Der Hook ersetzt dort `hatFassung` und den eigenen Effekt.
- Scheitert das Speichern, bleibt der Merker stehen (`gespeichert` läuft nur in `onSuccess`).

Alternative: Merker im Rückfrage-Baustein. Verworfen, weil die Entwürfe ihren Merker schon in
`useEntwurfVerlustschutz` führen.

### D3 Formularseiten bieten nur „Bleiben“ und „Verwerfen“

„Speichern und weiter“ müsste die Formularprüfung, Rückfragen wie die Skelett-Verkürzung in
`EinsatzDefaults` und Fehler im Dialog abbilden. Ein gescheiterter Prüflauf stünde hinter der
Maske. Der Gewinn ist ein Klick. Deshalb ohne; die Entwürfe behalten ihn.

### D4 Organisation: ein Formular, ein PATCH, nur geänderte Felder

- Ein `<Form>` umschließt die Paneele Name, Logo und Taktische Zeichen; die Leiste steht an
  seinem Ende. Das Logo-Paneel hat keine Felder und wirkt weiter sofort. Seine Knöpfe sind
  `htmlType="button"` (antd-Vorgabe) und senden das Formular nicht. Reihenfolge der Paneele
  bleibt.
- Neue Funktion `aendereOrganisation(felder: { name?: string; tz_organisation?: string })` in
  `api/organisation.ts` schickt genau die übergebenen Felder. `setzeOrgName` und
  `setzeOrgDefault` entfallen, wenn kein anderer Aufrufer bleibt.
- Geändert heißt: getrimmter Name ungleich Serverstand, DV-102-Organisation ungleich
  Serverstand. Ohne Änderung kein Aufruf, kein Toast; der Merker fällt zurück.
- Toast: „Name gespeichert“, „DV-102-Organisation gespeichert“ oder „Name und
  DV-102-Organisation gespeichert“.
- Die Antwort ist die volle `OrganisationAnzeige`: erst `setQueryData`, dann
  `schutz.gespeichert(fassung)`, dann invalidieren (Reihenfolge aus dem heutigen
  `nameSpeichern`).
- Der Abgleich Server → Feld läuft für beide Felder nur, solange `ungespeichert` nicht gilt. Das
  ersetzt `nameGeaendert` und erhält sein Verhalten: ein Refetch überschreibt keine angefangene
  Eingabe, nach dem Speichern kommt der Serverstand (auch ein fremd geänderter) wieder ins Feld.
- Ein Aufruf, also ein Fehler: `<SpeicherFehler>` steht direkt über der Leiste im Formular. Der
  Logo-Fehler bleibt am Logo-Paneel.

Alternative: zwei Aufrufe nacheinander. Verworfen: scheitert der zweite, ist die Hälfte
gespeichert und die Meldung müsste das auseinanderhalten. Der Server schreibt beide Felder schon
in einem `UPDATE`.

### D5 Data Router in Tests auf Wunsch

`renderMitProviders` bekommt `datenRouter?: boolean`. Mit `true` rendert der Wrapper
`createMemoryRouter([{ path: '*', element: <Kinder/> }], { initialEntries: [route] })`; die
Kinder kommen über einen Kontext, damit `rerender` ankommt. Ohne die Option bleibt der
`MemoryRouter`. Die Tests der acht Seiten und alle Tests, die eine davon rendern
(`rechteGate.test.tsx`, `EinsatzEinstellungenPage.test.tsx`, ggf. `EinsatzdatenPage.test.tsx`),
schalten die Option ein. Der laute Fehler von `useBlocker` zeigt jede vergessene Stelle.

Alternative: alle 274 Dateien auf den Data Router. Verworfen, weil Navigationszeitpunkte sich
ändern können und der Umbau nichts mit dem Ticket zu tun hat. Alternative: Rückfrage ohne Data
Router still abschalten. Verworfen, weil ein fehlender Schutz dann in keinem Test auffiele.

### D6 Regel

`frontend/AGENTS.md`, Abschnitt „Formularseiten“: „Eine Speichern-Leiste je Seite; sie speichert
jedes Feld der Seite. Formularseiten mit Leiste tragen den Verlassen-Schutz
(`components/useFormularVerlassenSchutz.ts` + `components/VerlassenRueckfrage.tsx`); Seiten, die
jede Zeile sofort speichern (`EinsatzModule`), nicht. Tests solcher Seiten rendern mit
`datenRouter: true`.“ `frontend/src/entwurf/AGENTS.md` verweist für die Rückfrage auf den
Baustein.

## Risks / Trade-offs

- [Eine erzwungene Navigation (Abmeldung, Sitzungsende) läuft in die Rückfrage] → Gleiches
  Verhalten wie heute bei den Entwürfen; „Verwerfen“ führt sie aus. Geht die Abmeldung über
  `window.location`, greift nur die Browser-Warnung. Beim Umsetzen prüfen und im Test belegen,
  dass der Weg nicht hängen bleibt.
- [Speichern löst selbst eine Navigation aus] → Keine der acht Seiten navigiert nach dem
  Speichern; `gespeichert()` läuft vor jeder späteren Navigation.
- [Zurückgetippter Ausgangswert gilt als geändert] → Die Rückfrage erscheint dann unnötig. Auf
  der Organisationsseite fällt der Merker beim Absenden ohne Änderung zurück; sonst hingenommen,
  weil ein Wertevergleich je Seite mehr Fehlerfläche bringt als er spart.
- [Testumbau auf Data Router ändert Zeitverhalten einzelner Tests] → Nur die betroffenen Dateien
  wechseln; ihre Erwartungen bleiben, laufen vorher und nachher grün.
