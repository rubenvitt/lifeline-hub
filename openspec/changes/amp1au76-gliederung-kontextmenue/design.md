## Context

Motivation und Schnitt: `proposal.md`. Bestand:

- `entwurf/DokumentEntwurf.tsx` rendert Gliederung (`DokumentGliederung`, `memo`) und je Abschnitt
  einen `AbschnittBlock` (`memo`). Das Render-Zähler-Gate in `DokumentEntwurf.test.tsx` verlangt
  identitätsstabile Props: Die Seite rendert bei Kopffeldern und Speicherstand neu, kein
  Abschnitt darf mitlaufen. Tippen kippt nur über die Leer-Kette (`Form.useWatch` mit Selektor).
- Kontextmenü-Baustein aus LLH-1596: `components/useKontextMenue.ts` (ein Hook je Fläche,
  `ausloeser(schluessel)` liefert Handler, Fabrik stabil) und `components/KontextMenue.tsx`
  (Menü am Fensterpunkt, Fokusrückgabe). Das ⋮ ist `components/MenueAusloeser.tsx`, beide
  formen ihre Einträge über `menueEintraege` (Gefahr rot hinter einem Trenner).
- Beide Seiten hängen ihre Nebenwirkungen an `onValuesChange` des `<Form>`: der Befehl
  `schutz.markiereGeaendert`, der Lagebericht zusätzlich `verwerfeStandGeleerter`. `onValuesChange`
  feuert nur bei einer Änderung über das Feld (`onChange` des Steuerelements), nicht bei
  `form.setFieldValue`.

## Goals / Non-Goals

**Goals:**
- Eine Quelle der Einträge für ⋮ und Kontextmenü, prüfbar ohne Render.
- „Abschnitt leeren“ wirkt genau wie Löschen von Hand, für beide Seiten und künftige
  Nebenwirkungen, ohne dass eine Seite einen zweiten Weg verdrahtet.
- Render-Zähler-Gate und Tippmessung bleiben grün.

**Non-Goals:**
- Umordnen, Einrücken, Entfernen von Abschnitten; Übernahme im Menü; Menü in der Lesefassung
  freigegebener Dokumente.

## Decisions

### D1 Einträge als reine Funktion im Kern

`dokumentEntwurfKern.ts` bekommt `abschnittEintraege({ leer, kopierbar, ansicht })` und
`gliederungEintraege(...)`, die `springen` voranstellt. `MenueAusloeser` im Kopf und
`KontextMenue` an Gliederung und Kopf lesen nur daraus. „In der Lesefassung zeigen“ entfällt,
wenn die Lesefassung schon gewählt ist; die Blöcke sind dann verborgen, betroffen ist nur die
Gliederung. Schlüssel als Union `'springen' | 'kopieren' | 'lesefassung' | 'leeren'`.

*Alternative:* Einträge je Ort in der Komponente. Verworfen, weil zwei Listen auseinanderlaufen
(Regel „eine Quelle“, `frontend/AGENTS.md`).

### D2 Leeren über das `onChange` des Feldes, nicht über `setFieldValue`

Das Kind des `Form.Item` wird eine dünne Hülle `AbschnittFeld` um `MarkdownEditor`. Sie reicht
`value`, `onChange` und den Ref (React 19: `ref` als Prop; `MarkdownEditor` ist `forwardRef`) durch
und meldet ihr aktuelles `onChange` in eine Ref-Tabelle des Bausteins (`schluessel → leeren`).
„Abschnitt leeren“ ruft nach der Rückfrage `onChange('')`. Dann läuft derselbe Weg wie beim Tippen:
`onValuesChange` der Seite feuert, der Verlustschutz merkt die Änderung, der Lagebericht verwirft
den Stand der Übernahme, und die Leer-Kette kippt.

`form.getFieldInstance(schluessel)` (Sprung, `Einstiegsfokus`) muss weiter den Editor liefern;
der Ref wird deshalb durchgereicht und mit einem Test belegt.

*Alternative:* neues Pflicht-Prop `onGeaendert(geaendert)` an `DokumentEntwurf`, das jede Seite mit
ihrem `onValuesChange`-Handler belegt. Verworfen: Es dupliziert den Pfad, und eine künftige
Nebenwirkung in `onValuesChange` fehlte beim Leeren still. *Alternative:* der interne
`dispatch` von rc-field-form. Verworfen, weil es keine öffentliche API ist.

### D3 Ein Kontextmenü-Hook für die ganze Schreibfläche

Ein `useKontextMenue<{ ort: 'gliederung' | 'kopf'; schluessel: string }>` in `DokumentEntwurf`,
die stabile Fabrik geht als Prop an `DokumentGliederung` und `AbschnittBlock`. Der Zustand des
offenen Menüs (`ort`, `schluessel`, Anker) und ein einziges `KontextMenue` liegen im Baustein,
außerhalb der `memo`-Kinder. Die Einträge werden beim Rendern des offenen Menüs aus D1 gebildet,
mit dem aktuellen `ansicht` und der Leer-Kette. Ein offenes Menü ändert so keine Props der
Abschnitte.

Die Wahl führt `fuehreAus(key, schluessel)` aus, ein `useCallback` mit Abhängigkeiten aus Refs
(`ansicht` über Ref), damit auch das ⋮ in den Blöcken eine stabile Funktion bekommt.

Handler am Abschnittskopf hängen an der Hülle `data-lfh="abschnitt-kopf"`; das Textfeld liegt
außerhalb. Rechtsklick im Feld trifft den Hook also nie, und `browsermenueBleibt` deckt
Eingabefelder zusätzlich ab.

### D4 Lesefassung zeigen: Ansicht wechseln, dann rollen und fokussieren

`zeigeInLesefassung(schluessel)` setzt `ansicht = 'lesen'` und merkt das Ziel. Ein Effekt nach dem
Render (die Lesefassung hängt erst dann) rollt den Abschnitt der Lesefassung an den Anfang
(`leseAnker`) und fokussiert ihn (`tabIndex={-1}` an der `section` von `AbschnittsText`; der
Fokusrahmen des Browsers bleibt, damit Tastaturnutzer sehen, wo sie stehen). Grund: Der Auslöser (⋮ oder Kopf) ist danach verborgen, und die
Fokusrückgabe des Menüs ginge ins Leere.

Reihenfolge mit der Fokusrückgabe: Das Menü gibt beim Schließen den Fokus an den Auslöser zurück.
Der Effekt läuft danach und setzt den Fokus auf die Lesefassung. Ein Test prüft, dass der Fokus
am Ende dort steht, für ⋮ und Kontextmenü.

### D5 Rückfrage per `<Modal>` im Baustein

Ein `Modal` im Baustein, außerhalb der Abschnitts-`map` (Regel in `frontend/AGENTS.md`, kein
`Popconfirm`, weil Menüetiketten Text sind): Titel „Abschnitt „<Name>“ leeren?“, Text „Der Text
dieses Abschnitts wird entfernt. Der Entwurf speichert danach von selbst.“, `okText` „Abschnitt
leeren“, `okButtonProps.danger`. Aus ⋮ und Kontextmenü dieselbe Rückfrage.

### D6 Kopieren wie `KopierbarerText`

`navigator.clipboard.writeText` mit Meldung „Text von „<Name>“ kopiert“ bzw. „Kopieren
fehlgeschlagen“ (`App.useApp().message`). `kopierbar` = Zwischenablage vorhanden; ohne sie
steht der Eintrag gesperrt (Secure Context, wie `KopierbarerText`). Der Text kommt aus
`form.getFieldValue`, also auch ungespeichert, roh als Markdown.

### D7 Zugängliche Namen

⋮: „Aktionen zu Abschnitt <Name>“; Kontextmenü am Kopf derselbe Name, an der Gliederung
„Aktionen zu Abschnitt <Name> in der Gliederung“. Die Spec `datensatz-aktionsmenue` verlangt die
Kennung des Datensatzes im Namen.

### D8 Enter im Kontextmenü löst nur den Eintrag aus (Befund aus dem Review)

Die Schale `components/PunktankerMenue.tsx` gibt den Fokus beim Schließen synchron an den
Auslöser zurück, noch im `keydown` des Enter, mit dem ein Eintrag gewählt wurde. Der Browser
aktivierte danach das Element mit dem Fokus: In der Gliederung sprang der Knopf zusätzlich zum
Abschnitt, am Kopf öffnete das ⋮ von selbst. Die Gliederung ist der erste Auslöser mit eigener
Klickaktion, an der Datensicht wäre es der Titel-Link gewesen. Behoben in der Schale: Solange
das Menü offen ist, nimmt ein Capture-Hörer am `window` einem Enter oder Leerzeichen aus dem Menü
die Standardaktion. Das gilt für alle Nutzer der Schale (Datensicht, Lagekarte, Skizze).
`menu.onKeyDown` reicht nicht, weil rc-menu ihn bei Enter im senkrechten Menü nicht aufruft.
Beleg: `e2e/dokument-entwurf-kontextmenue.spec.ts`, „Enter im Kontextmenü …“.

## Risks / Trade-offs

- [Hülle um den Editor bricht `getFieldInstance` oder Autosize] → Test: Sprung fokussiert weiter
  das Feld, `Einstiegsfokus`-Tests bleiben grün, Tippmessung `e2e/lagebericht-tippen.spec.ts`.
- [Neue Props an `memo`-Kindern heben die Sperre auf] → nur stabile Fabrik und `useCallback`
  aus Refs; Render-Zähler-Gate mit offenem und geschlossenem Menü erweitern.
- [Langer Druck in der waagerecht rollenden Gliederung (schmal) stört das Wischen] →
  Bewegungsschwelle des Bausteins (8 px) gilt; e2e am schmalen Schirm prüft das Rollen nicht neu,
  der Baustein hat es in LLH-1596 belegt.
- [Leeren ist nicht rückgängig zu machen] → Rückfrage mit benanntem roten Knopf; Autosave wie
  beim Tippen.
- [Der Befehl verliert beim Leeren nichts zusätzlich] → Er hat keinen Stand der Übernahme; der
  Test der Seite prüft nur den Verlustschutz.
