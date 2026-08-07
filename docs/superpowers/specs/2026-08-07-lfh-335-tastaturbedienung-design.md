# LFH-335 · Tastaturbedienung — Design

## Ziel

LFH-335 macht die Command-Palette sichtbar erreichbar, führt die neuen globalen
Tastaturaktionen in **einem** geschichteten Register zusammen und schließt die
verbliebenen Fokus-, Enter- und Link-Lücken. Bereits gelieferte Verträge aus B2
(`Datensicht`) und B4 (`Erfassung`) werden weiterverwendet, nicht lokal kopiert.

## Bestandsentscheidungen

- `ErfassungsFormular` bleibt Eigentümer von Fokus, normalem Enter-Submit,
  Serienmodus und Reset. Lokale `autoFocus`-Attribute an seinen Aufrufstellen
  würden einen zweiten Fokusmechanismus einführen und werden nicht ergänzt.
- Personen- und Tierzeilen besitzen über `Datensicht.karte.titel.ziel` bereits
  echte Links. Nur Schäden brauchen noch einen Link in der Registriernummer.
- Das frühere `pages/lage-dashboard/klickbar.tsx` wurde mit LFH-352 entfernt.
  Das anwendungsweite Primitive entsteht neu unter `components/` und wird nur
  für nicht-native, tatsächlich selektierbare Zeilen verwendet. Navigation wird
  bevorzugt als echter Router-`Link` umgesetzt.
- Bestehende Spezialinteraktionen (`/` in `KatalogTabelle`, Karten-Escape) werden
  in LFH-335 nicht migriert. Das neue Register ist Eigentümer der im Task
  genannten neuen Zuordnungen und von Cmd/Strg+K.

## 1. Geschichtetes Shortcut-Register

`CommandPaletteProvider` bleibt der einzige globale Dispatcher. Komponenten
registrieren keine weiteren `window.keydown`-Listener, sondern eine Ebene mit:

- einer DOM-Wurzel zur Fokuszuordnung;
- optionalen Callbacks für `speichern`, `verwerfen` und
  `filter-zuruecksetzen`;
- einem stabilen Namen für Tests und Diagnose.

Die tiefste Ebene, die den aktuellen oder zuletzt passenden Fokus enthält,
gewinnt deterministisch. Damit schlägt ein Dialog die Seite darunter und eine
fokussierte Filterleiste ein daneben montiertes Formular. Filterebenen umfassen
nur ihre jeweilige Filter-/Werkzeugleiste, nie Ergebnisbereiche, Tabellenzellen
oder die ETB-Schnellerfassung. Beim Öffnen der Palette bleibt die zuletzt aktive
Ebene erhalten, obwohl der Fokus in das Suchfeld wechselt.

Die Tastenbelegung liegt als Daten in `command-palette/befehle.ts`. Dieselben
Deskriptoren speisen den Dispatcher und sichtbare Palette-Einträge mit `<kbd>`:

- Cmd/Strg+S und Cmd/Strg+Enter → aktives Formular speichern;
- Escape → aktive Bearbeitung verwerfen;
- Cmd/Strg+Backspace → aktive Filterleiste zurücksetzen.

Sicherheitsregeln:

- Bereits `defaultPrevented` behandelte Ereignisse werden nicht erneut
  ausgeführt. Dadurch behält B4 Cmd/Strg+Enter als „Speichern und nächste“.
- Bei geöffneter Palette wirken die Aktionskürzel nicht auf die Ebene darunter;
  nach dem Schließen steht die zuvor aktive Ebene wieder bereit.
- Palette und Erfassungsmodal deaktivieren Ant Designs eigenen Escape-Handler
  (`keyboard={false}`). Escape bleibt dadurch vollständig Eigentum des globalen
  Bubble-Dispatchers, der genau ein sichtbares Overlay beziehungsweise die aktive
  Bearbeitung schließt und lokale `defaultPrevented`-Handler weiterhin respektiert.
- Cmd/Strg+Backspace wird nur abgefangen, wenn die aktive Ebene tatsächlich
  einen Filter-Reset registriert; andernfalls bleibt die native Wortlöschung.
- Tastenwiederholung wird für mutierende Aktionen sowohl im globalen Dispatcher
  als auch in lokalen Serien-/ETB-Handlern ignoriert.

Kontextaktionen erscheinen nur, wenn die aktive Ebene den jeweiligen Callback
anbietet. Ein deaktivierter Scheinbefehl wird nicht gezeigt.

## 2. Sichtbarer Palette-Trigger

Ein gemeinsamer `components/CommandPaletteTrigger.tsx` wird in `AppLayout` und
`EinsatzLayout` eingesetzt. Breit zeigt er Lupe, „Suchen“ und das
plattformgerechte `<kbd>` (`⌘K` oder `Strg+K`). Unter `lg` bleibt eine reine
Lupenschaltfläche mit 48 × 48 px bestehen. Sie nutzt
`useCommandPalette().toggle()` und die vorhandene Header-Vordergrundrolle.

## 3. Enter- und Fokusvertrag

- ETB: Einzeiliger Inhalt wird mit einfachem Enter gesendet. Sobald der Inhalt
  einen Zeilenumbruch enthält, fügt einfaches Enter eine weitere Zeile ein;
  Cmd/Strg+Enter sendet. Der sichtbare und im Placeholder enthaltene Hinweis
  beginnt exakt mit „Enter sendet · Shift+Enter neue Zeile“ und ergänzt die
  Mehrzeiler-Regel.
- Baustein-Platzhalter: echtes Ant-Design-`Form` mit `onFinish`, Submit-Button,
  Reset auf Abbruch und `autoFocus` ausschließlich am ersten dynamischen Feld.
- Person, Schaden, Tiere und UHS-Verbleib bleiben auf `ErfassungsModal`.
- UHS-Anlegen und Bereitstellungsraum-Anlegen wechseln auf
  `ErfassungsFormular`; dadurch fokussieren sie das erste **leere Arbeitsfeld**
  (Bezeichnung) und erhalten denselben Submit-/Reset-/Shortcut-Vertrag.

Das alte Akzeptanzkriterium, lokale `autoFocus`-Vorkommen zu zählen, wird durch
verhaltensbasierte Tests ersetzt. Ein Quelltext-Grep kann die zentral erbrachte
Eigenschaft nicht valide messen.

## 4. Kontextwerte

Antreffort und Schadenort werden im Browser-Tab per `sessionStorage` gespeichert,
nach Einsatz und Maske getrennt und nur nach erfolgreicher Erfassung aktualisiert.
So kann kein Wert zwischen Einsätzen oder fachlich verschiedenen Masken wandern.
Innerhalb einer offenen Serie bleibt B4s sichtbarer Schalter „Werte behalten“
maßgeblich; LFH-335 schaltet ihn nicht heimlich ein. Der Sitzungswert wird beim
Öffnen einer Maske genau einmal eingesetzt, nicht als dauerhaftes
`Form.initialValues`: nach einem Serien-Speichern mit ausgeschaltetem Schalter
bleibt das Feld deshalb leer und wird nicht aus `sessionStorage` erneut befüllt.

„Zeitpunkt jetzt“ ist an den zutreffenden Stellen bereits vorhanden (ETB-Modell,
Einsatzanlage). Die genannten Person-, Tier-, Schaden- und UHS-DTOs besitzen kein
weiteres Zeitfeld.

Die eigene Organisation wird **nicht** als Geschädigter eines Schadens
vorbelegt: Das wäre keine Bedienhilfe, sondern eine fachliche Tatsachenbehauptung.
In den genannten Masken existiert kein neutrales Organisationsfeld, auf das der
Default sicher angewendet werden könnte.

## 5. Native Navigation und klickbare Zeilen

- `routing/deeplinks.ts` erhält `einsaetzePfad()` und `einsatzPfad(id)`.
- Einsatzkarten bekommen einen echten Link als Überschrift; der Kartenklick
  bleibt Mauskomfort. Tab und Enter folgen dem Link, Mittel-/Kontextklick bleiben
  browsernativ. Der Titellink stoppt nur das Bubbling zum Kartenklick, niemals
  die native Link-Defaultaktion.
- Die Schaden-Registriernummer wird über `schadenDetailPfad` verlinkt. Personen
  und Tiere bleiben unverändert auf ihren vorhandenen `Datensicht`-Links.
- `components/Klickbar.tsx` kapselt Enter-/Space-Aktivierung für nicht-native
  Button-Zeilen. `ListenEintrag` nutzt es nur, wenn `onClick` gesetzt und keine
  separate Aktion verschachtelt ist. Die aktuellen Selektionszeilen in Chat,
  Gefahren und Lagekarten-Sidebar werden damit tastaturbedienbar.

## 6. Verifikation

Red-Green-Tests werden pro Vertrag ergänzt. Danach laufen gezielte Vitest-Dateien,
`pnpm lint`, Typprüfung, Browser-Tests bei 390 px und abschließend
`./scripts/check-all.sh`. Die E2E-Palette-Prüfung navigiert wirklich per Enter;
der bisherige Testtitel behauptet dies, klickt derzeit aber mit der Maus. Über
einem offenen Navigations-Drawer werden außerdem sichtbarer Fokus sowie Tab- und
Shift+Tab-Bedienbarkeit nachgewiesen.
