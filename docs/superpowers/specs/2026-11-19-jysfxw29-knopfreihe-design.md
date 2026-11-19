# Knopfreihe: ein Baustein für Kopf-, Paneel- und Dialogaktionen

Zunder: LLH-1973 (`jysfxw296payquntyrijvyog`), Epic LLH-1724 · Route `entwurf` (E1, E2) ·
abgestimmt mit Ruben am 19.11.2026 (Abstand, Umfang, Wächter-Nachfolger).

## Absicht

Zwei Knöpfe nebeneinander sind heute ein `<Space>`, und der Abstand hängt davon ab, ob die
Stelle an `size` gedacht hat. Zwei Wächter (`components/aktionsabstand.guard.test.ts`, rund 330
Zeilen, und `components/aktionenSpace.guard.test.ts`) und zwei Regeln in `frontend/AGENTS.md`
(„Ein `<Space>` in `aktionen` nennt seinen Abstand“, „Rot steht nicht bündig neben Neutralem“)
halten das nachträglich fest, jeder nur für einen Ausschnitt. Wie bei `Stapel` (LLH-1810,
ADR-0065) soll die richtige Form die einfachste sein: ein Baustein `Knopfreihe`, der den Abstand
selbst setzt und keinen falschen zulässt. Danach fallen beide Wächter und beide Regeln weg.

Messung auf `alpha` 13f97e86: 74 waagerechte Knopfreihen (`<Space>` mit mindestens zwei
`<Button>` als unmittelbare Kinder) in 62 Dateien, 28 mit rotem Knopf. Abstände: `size="middle"`
34, `size={token.marginSM}` 11, **ohne `size` 27** (4 / 4 / 8 px), sonst 2. Dazu 9 `<Space>`
direkt in `aktionen={…}`, 6 in `footer={…}` eines Dialogs und der Fuß der Erfassungs-Hülle
(`components/Erfassung.tsx`).

## Ziele

- Baustein `Knopfreihe` in `components/instrument/`, exportiert über `index.ts`, mit Karte im
  Design System und Zeile in der Bausteinwahl von `frontend/AGENTS.md`.
- **Ein Abstand für jede Knopfreihe: Rasterstufe `md`** (kompakt 12, komfortabel 20, handschuh
  24 px; `rasterAbstand(token, 'md')` = `token.padding`). Kein Prop dafür. (Entscheidung Ruben.)
- Umgestellt werden in diesem PR (Entscheidung Ruben, Umfang „Kopf, Füße, Rot-Reihen“):
  1. die Hülle der Kopfaktionen in `components/EinsatzSeite.tsx` (`data-lfh="seitenkopf-aktionen"`)
     und die gleichartige Hülle in `pages/LagekartePage.tsx`;
  2. jedes `<Space>` in `aktionen={…}` (heute 9, Fundstellen über das Muster von
     `aktionenSpace.guard`);
  3. jedes `<Space>` in `footer={…}` eines `Modal`/`Drawer` (heute 6) und der Fuß der
     Erfassungs-Hülle;
  4. die Reihen in allen Dateien der Listen `MIT_NACHBARSCHAFT`, `OHNE_NACHBARSCHAFT` und
     `BEWERTET_OHNE_SCANNER_DECKUNG` von `aktionsabstand.guard`.
- Danach: `aktionsabstand.guard.test.ts` und `aktionenSpace.guard.test.ts` entfernen, die beiden
  Regeln unter „Aktionen“ in `frontend/AGENTS.md` durch eine Zeile zu `Knopfreihe` ersetzen.
- **Nachfolger: ein Ratschen-Wächter** (Entscheidung Ruben) `components/knopfreihe.guard.test.ts`
  mit Schuldliste `components/knopfreihe.schuld.ts`: je Datei die Zahl der waagerechten
  `<Space>`, die mindestens zwei Knöpfe (`<Button>`, `<StatusWahl>`) als unmittelbare Kinder
  tragen. Die Zahl je Datei darf nur sinken, keine neue Datei darf hinzukommen; eine auf 0
  gesunkene Datei verlangt, dass ihr Eintrag gestrichen wird. Ist die Liste leer, gehen Wächter
  und Liste (Abbaubedingung in der ADR).
- Neue ADR (nächste freie Nummer, heute 0070) für die Regel „Knopfreihen über `Knopfreihe`“.
  ADR-0065 bleibt unverändert (akzeptiert, unveränderlich); ihr Satz „Knopfreihen sind noch frei“
  wird durch die neue ADR eingelöst, nicht ersetzt.

## Nicht-Ziele

- Die übrigen Reihen (rund 40, darunter die meisten der 27 ohne Abstand) stellt dieser PR nicht
  um. Sie stehen in der Schuldliste und kommen in eine Folgeaufgabe, sobald LLH-1968 bis
  LLH-1971 gemergt sind; die bauen gerade dieselben Ordner um.
- antds eigene Füße (`Modal` ohne `footer`, `modal.confirm`, `Popconfirm`) bleiben bei der Regel
  in `index.css` (`var(--ant-padding)`, also schon `md`). Kein Eingriff.
- Keine Bündelung von Aktionen (`MenueAusloeser`, `weitere`, „höchstens zwei Knöpfe im Kopf“):
  das bleibt, wie es ist. `Knopfreihe` ordnet nur an, sie entscheidet nicht, was hineinkommt.
- `Space.Compact` (verbundene Knöpfe) und senkrechte `<Space>` sind keine Knopfreihen.

## Anti-Ziele

- Der Baustein ordnet seine Kinder nicht um (kein CSS-`order`, kein Sortieren nach `type`):
  Lese- und Tabfolge bleiben die sichtbare Folge (wie in `EinsatzSeite`, LFH-963).
- Kein `style`-Prop, keine Zahl als Abstand, kein zweiter Abstand. Sonst wäre der Rot-Wächter
  zurück, nur an anderer Stelle.
- Kein Umbruch, der Knöpfe aus dem Dialog hinauslaufen lässt (LFH-953, x = −75 bei 390 px).

## Ansätze

1. **Ein Baustein mit einem festen Abstand `md` (gewählt).** Jede Reihe 12 / 20 / 24 px. Ein
   roter Knopf kann nicht mehr bündig stehen, der Rot-Wächter fällt ersatzlos. Preis: Im
   Seitenkopf rücken die Knöpfe in kompakt von 8 auf 12 px, in komfortabel von 12 auf 20, in
   handschuh von 16 auf 24 px auseinander; in einem vollen Kopf bricht eine Reihe etwas früher um.
2. **Zwei Stufen `sm`/`md` per Prop.** Kopfabstände bleiben, aber „Rot braucht `md`“ bliebe eine
   Regel mit eigenem Wächter. Verworfen, weil gerade dieser Wächter weg soll.
3. **Abstand nach Inhalt** (Kinder auf `danger` prüfen). Ohne Regel, aber blind für Knöpfe in
   eigenen Komponenten (`AuftragHandlungen`, `StatusWahl`). Verworfen als fragil.

Umfang: „alle 74 jetzt“ verworfen wegen Konflikten mit den vier laufenden Umbau-PRs; „nur Kopf
und Füße“ verworfen, weil der Rot-Wächter dann stehen bliebe. Wächter-Nachfolger: „keiner“
verworfen, weil neue `<Space>`-Reihen sonst niemandem auffielen.

## Form des Bausteins

```tsx
<Knopfreihe>                       // Kopf, Paneel, Zeile: linksbündig, Primär vorn
  <Button type="primary">Personal disponieren</Button>
  <Button>Ad-hoc-Person</Button>
</Knopfreihe>

<Knopfreihe fuss>                  // Dialogfuß: rechtsbündig, Primär hinten
  <Button onClick={abbrechen}>Abbrechen</Button>
  <Button type="primary" danger>Abschnitt auflösen</Button>
</Knopfreihe>
```

Props (Vorschlag, Feinform beim Bauen):

- `children` — die Knöpfe in Lesefolge.
- `fuss?: boolean` — Dialogfuß: ab `md` rechtsbündig (`justify-content: flex-end`), **unter `md`
  untereinander in voller Breite**, Primärknopf zuletzt und damit unten am Daumen. Das ist das
  heutige Verhalten der Erfassungs-Hülle (LFH-953), jetzt für jeden Fuß. Die Knöpfe bekommen dazu
  volle Breite über die Hülle (CSS auf die Kinder), nicht über `block` an jedem Knopf. Schmal
  heißt dasselbe wie in der Erfassung (`useIstSchmal` o. ä., beim Bauen nachsehen).
- `aria-label`, `id`, `className`, `data-lfh` (der Kopf braucht `seitenkopf-aktionen` und einen
  `ref` für die Messung in `EinsatzSeite`; also `forwardRef` bzw. `ref` als Prop).
- Immer `flex-wrap: wrap`, `min-width: 0`, `align-items: center`, Abstand `rasterAbstand(token, 'md')`.

**Reihenfolge (Regel, kein Code):** Im Kopf, im Paneel und in der Zeile steht die Primäraktion
vorn, im Fuß hinten (rechts bzw. unten). So steht es heute schon im Bestand (Kopf: Personal,
Einsatzabschnitte, BR-Detail; Fuß: Erfassung, antds Modal). Die Regel kommt in die Zeile zu
`Knopfreihe` in `frontend/AGENTS.md`; ein Wächter dafür entsteht nicht.

**Kopf:** Die Hülle in `EinsatzSeite` wird selbst eine `Knopfreihe` (bzw. setzt deren Abstand),
ein `<Space>` in `aktionen` wird zum Fragment (`<>…</>`), damit die Knöpfe Geschwister in der
Hülle sind und kein zweiter Abstand entsteht. Die Reihenfolge-Weiche für „Weitere“ unter `md`
bleibt im Baum.

**Andere `aktionen`-Slots** (meine Entscheidung): Wo `aktionen` nicht in den Kopf der
`EinsatzSeite` fließt (`AdminPage` mit `data-lfh="adminpage-aktionen"` und `RueckwegKnopf` davor,
die `AntragKarte` in `offline/OfflineRecoveryDrawer.tsx`), ersetzt eine `Knopfreihe` das innere
`<Space>`; die äußere Hülle bleibt unverändert. So halten die Aktionen untereinander `md`, ohne
dass der Kopf jeder Verwaltungsseite sich ändert.

**Einzeiliger Kopf bleibt** (Entscheidung Ruben, 19.11.2026): LLH-1786 hält den Seitenkopf ab
`lg` in der Titelzeile (`BUENDELN_AB_STEUERHOEHE`, `e2e/kraefte-seitenkopf.spec.ts`). Bricht ein
Kopf durch den größeren Abstand um, rückt die Schwelle, ab der Nebenwege hinter „Weitere“
wandern, so weit, dass er wieder einzeilig steht. Erst messen; bricht nichts um, ändert sich
nichts. Die e2e-Specs, die `seitenkopf-aktionen` messen (`kraefte-seitenkopf`,
`trefflaeche-pruefflaechen`, `betroffene-handy`, `gate3-trefflaeche`), laufen gezielt mit.

## Folgen für die Umgebung

- `aktionsabstand.guard` behauptet heute für `auftraege/AuftragTeile.tsx` einen `<Space
  size="middle">` (Blindfleck-Test). Diese Datei wird mit umgestellt; der Test geht mit dem
  Wächter.
- `e2e/dialogfuss-dichte.spec.ts`, `e2e/dokumente.spec.ts` und `e2e/gate3-trefflaeche.spec.ts`
  („Personal (LLH-1273)“) messen Abstände: sie müssen nach der Umstellung weiter grün sein bzw.
  auf den neuen Kopfabstand (`md`) nachgezogen werden. `components/AdminPage.tsx` und
  `PersonenDetailPage.test.tsx` nennen die Wächter; Verweise greppen
  (`aktionsabstand`, `aktionenSpace`, `LLH-1273`, `LFH-363 · B5c`).
- Der Wächter `theme/abstandsraster.guard.test.ts` verbietet Zahl-Literale in `<Space size>`;
  `Knopfreihe` nimmt `rasterAbstand`, also kein Konflikt.
- Design System: Karte `Knopfreihe` wie die von `Stapel` (README + preview aus dem echten
  Baustein, Erzeugung wie bei LLH-1810), danach neu veröffentlichen (`frontend/AGENTS.md`,
  „Größere UI-Entwürfe über das Design System“).
- Kapitel 8 der Architektur nur, wenn die Mitänderungstabelle es verlangt (neuer Baustein in
  bestehendem Verzeichnis: voraussichtlich nicht).

## Dem Bauenden überlassen

- Genaue Prop-Namen über `fuss` hinaus, die Umsetzung von „volle Breite unter `md`“.
- Der Scanner des Ratschen-Wächters: aus `reihenIn` von `aktionsabstand.guard` ableiten
  (ohne die Rot-Bewertung), mit Selbstbeweisen wie dort.
- Ob eine umgestellte Reihe in einer Liste-Datei der Wächter zusätzlich `aktionen` im
  Kartenmodus (`{aktionen}` gespreizt) betrifft: dann die Hülle zur `Knopfreihe` machen.
- Reihen in den umzustellenden Dateien, die nicht zu den vier Gruppen gehören, dürfen mit
  umgestellt werden (dieselbe Datei, kein zusätzlicher Konflikt), müssen aber nicht.

## Prüfung

- Komponententest `Knopfreihe.test.tsx`: Abstand je Dichte aus dem Token, Umbruch, `fuss`
  rechtsbündig bzw. gestapelt unter `md`, Reihenfolge unverändert, kein `style`-Prop (Typ).
- Ratschen-Wächter grün mit Selbstbeweisen; die neue ADR mit `## Prüfung`
  (`verbiete '^  style\??:'` in `Knopfreihe.tsx`, Wächter und Schuldliste vorhanden).
- `./scripts/check-all.sh --geaendert --ohne-e2e`, dazu gezielt die drei e2e-Specs oben.
- Bilder vorher/nachher: Seitenkopf Personal, ein Dialogfuß mit Rot (Einsatzabschnitt
  auflösen), Erfassungsfuß schmal; kompakt und handschuh.
