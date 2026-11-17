# Design

## Context

Motivation: proposal.md, „Why“. Stand im Code:

- `components/AnlegenDrawer.tsx` ist ein generischer Drawer um `ErfassungsFormular`: bindet das
  Anlegen an die Einsatz-ID (ein laufendes Anlegen des vorigen Einsatzes sperrt nichts, seine
  Ablehnung steht nicht hier), zeigt die Ablehnung im Formular (LFH-1077), lädt Liste und ETB neu
  und meldet den neuen Datensatz über `onAngelegt`. `UhsAnlegenDrawer` (4 Felder) und
  `BrAnlegenDrawer` (3 Felder) liefern nur Felder und POST. Aufrufer: Listen, Leerzustand
  (`components/Direkteinstieg.tsx`, Slot `{ open, onClose, onAngelegt }`) und Switcher.
- `components/Erfassung.tsx` `ErfassungsModal` besitzt schon alle vier Auswege (Knopf, Kreuz,
  Escape, Maske) über denselben Abbruch und sperrt Kreuz und Maske, solange gespeichert wird; das
  `drawerSchliessen` des Drawers hat dieselbe Aufgabe von Hand.
- Die UHS-Liste ruft den Drawer ohne `onAngelegt` und bleibt nach dem Anlegen in der Liste;
  Bereitstellungsraum, Switcher und Leerzustand springen in die neue Ansicht.
- Lagemeldungen (`pages/LagemeldungenPage.tsx`): Kopf-Knopf, Leerzustand und `?neu=1` setzen
  `formOffen`; ein `Paneel` über der Zeitachse trägt `MeldungFormular` (`card={false}`,
  `artVorgabe="lagemeldung"`, `serie={false}`, `onFertig` schließt). Der Kopf-Knopf wechselt
  zu „Formular schließen“.
- Nachforderung, Meldungen und Erinnerungen haben `serie` an und beschreiben „Speichern und
  nächste“ im Kapitel (`nachforderung.md:59`, `meldungen.md:81`, `erinnerungen.md:39`).

## Goals / Non-Goals

**Goals:**

- Ein Baustein für das Anlegen eines einsatzgebundenen Datensatzes im Dialog, der das Verhalten
  des Drawers (Einsatzbindung, Fehlerbild, Neuladen, `onAngelegt`) unverändert mitnimmt.
- Lagemeldungen im Dialog ohne zweites Formular.

**Non-Goals:**

- Bearbeiten von UHS und Bereitstellungsraum (`UhsBearbeitenModal`, `BrBearbeitenModal`): das ist
  LLH-1920 und bleibt hier unberührt.
- Weitere Felder, andere Feldregeln oder ein Serienmodus für UHS, Bereitstellungsraum oder
  Lagemeldungen.
- Die Sammel-Nachforderung der Unterkunft (`betreuung/unterkunft/NachforderungenDialog.tsx`):
  schon ein Dialog, eigener Weg.

## Decisions

### D1 `AnlegenModal` ersetzt `AnlegenDrawer`

`components/AnlegenModal.tsx` übernimmt Props, Mutation und Einsatzbindung des Drawers und rendert
`ErfassungsModal` statt `Drawer` + `ErfassungsFormular`. Das handgebaute `drawerSchliessen` fällt,
weil `ErfassungsModal` Kreuz, Maske und Escape selbst über den Abbruch des Formulars führt; die
Abbruch-Generation (ein Abbruch während des Speicherns verwirft den Sprung) bleibt im
`onAbbrechen`. Slot-Typ `AnlegenModalSlot<T>` mit `open`, `onClose`, `onAngelegt?`, damit
`Direkteinstieg` und die Switcher unverändert passen. `UhsAnlegenDrawer` und `BrAnlegenDrawer`
heißen `UhsAnlegenModal` und `BrAnlegenModal` (Dateinamen folgen den Bezeichnern, AGENTS.md
„Bezeichner-Sprache“).

Verworfen: `ErfassungsModal` direkt in beiden Fachdateien. Die Einsatzbindung und das Fehlerbild
stünden zweimal, und ihr Test (`AnlegenDrawer.test.tsx`, LFH-1077) gälte nur einer Kopie.

### D2 UHS-Notiz unter „Weitere Angaben“

Das Feldbudget eines Dialogs ist ~3 (`frontend/AGENTS.md`, Erfassungs-Norm). Die UHS zeigt
Bezeichnung, Typ und Standort; die Notiz steht in einem `Collapse` „Weitere Angaben“ mit
`forceRender` (Prüfung und Zurücksetzen erreichen sie zugeklappt), dessen Kopf „· Notiz“ nennt,
sobald etwas drinsteht – eingeklappt bleibt nichts verborgen (Vorbild
`nachforderungen/NachforderungFormular.tsx`). Die Norm erlaubt das: die Notiz ist optional und
kann keine Ablehnung auslösen, der Server begrenzt sie nicht (`src/routes/einsatz_uhs.rs`, nur
`trimme`). Der Bereitstellungsraum bleibt bei drei sichtbaren Feldern.

Verworfen: alle vier sichtbar (der Standort trägt schon eine Karte, die Notiz ist anders als die
Empfängerfunktion der Lagemeldung, D4, für niemanden wirksam) und Notiz weglassen (Wissen beim
Anlegen ginge verloren). Der Dialog bleibt bei Liste und Switcher eingehängt; „Weitere Angaben“
klappt beim Schließen zu.

### D3 UHS-Liste springt in die neue UHS

`UnfallhilfsstellenPage` reicht `onAngelegt={(uhs) => navigate(uhsDetailPfad(einsatzId, uhs.id))}`
wie `BereitstellungsraeumePage` (`frontend/AGENTS.md`, „Bearbeiten in der Ansicht“, Punkt 7).

### D4 Lagemeldung im Dialog über `MeldungFormular`

`MeldungFormular` bekommt eine Dialog-Form: Prop `dialog?: { offen: boolean; titel: string;
onAbbrechen: () => void }`. Ist er gesetzt, rendert es dieselben Formular-Props in
`ErfassungsModal` statt in `ErfassungsFormular`; Felder, „Weitere Angaben“ und Vorbelegung bleiben
eine Quelle. `LagemeldungenPage` behält `formOffen` (Kopf-Knopf, Leerzustand, `?neu=1`, Freigabe
der Vorschlags-Abfragen), rendert statt des Paneels den Dialog „Lagemeldung erfassen“; der
Kopf-Knopf heißt immer „Lagemeldung erfassen“ und wechselt nicht mehr zu „Formular schließen“.
`onFertig` schließt wie bisher.

**Nach dem Review (17.11.2026, mit dem Menschen abgestimmt):** Im Dialog stehen Absender,
Empfängerfunktion und Empfänger untereinander; die Rasterstufen von antd richten sich nach dem
Fenster, ab `lg` stünden im 520-px-Dialog drei Spalten zu je ~150 px. Mit Funktionskatalog zeigt der
Dialog vier Felder (Wortlaut, Absender, Empfängerfunktion, Empfänger). Das ist eine begründete
Ausnahme vom Budget ~3: die Empfängerfunktion bestimmt, wer „Neue Meldung“ bekommt, und bleibt
sichtbar; dieselben vier Felder stehen im Paneel der Meldungen (LFH-974), und Material-, Personal-
und Fahrzeugdialog zeigen ebenfalls vier. Verworfen: Dialog breiter (dreispaltig wie im Paneel)
und Empfänger unter „Weitere Angaben“ (verbirgt, wer benachrichtigt wird). Ein Klick auf die Maske
verwirft die Eingabe wie in jedem Erfassungsdialog (Erfassungs-Norm); eine Rückfrage nur hier wäre
ein Sonderweg. Das Formular bleibt bei geschlossenem Dialog eingehängt: „Weitere Angaben“ klappt
beim Schließen zu, und der Dialog gilt nur für den Einsatz, in dem er geöffnet wurde.

Verworfen: ein antd-`Modal` um `MeldungFormular card={false}` (handgebaute Hülle; Kreuz, Maske und
Escape liefen am Zurücksetzen vorbei, `components/Erfassung.tsx`, Kommentar zu `ErfassungsModal`)
und ein eigenes Lagemeldungsformular (Spec `meldungseingang`: kein zweites Formular).

### D5 Nachforderung, Meldungen, Erinnerungen bleiben eingeklappt

Alle drei erfassen in Serie neben ihrer Liste und beschreiben das im Kapitel; das ist die Ausnahme
der Regel. Die Erinnerung aus dem ETB (`etb/WiedervorlageModal.tsx`) ist ein anderer Einstieg mit
anderem Kontext (ein Eintrag, keine Liste) und bleibt Dialog.

### D6 Regeltexte

`frontend/AGENTS.md`, „Ort von ‚Bearbeiten‘ und Form des Anlegens“: die Altstellenliste nennt nur
noch das Bearbeiten im Modal (LLH-1920) und die geprüften Ausnahmen in einem Satz. Die
Leitlinie „Form nach Umfang“ verliert „Schnellerfassung“ als Drawer-Zweck, Punkt 1 von „Bearbeiten
in der Ansicht“ „Modal und Drawer bleiben fürs Anlegen“ wird „Der Erfassungsdialog bleibt fürs
Anlegen“. `frontend/src/etb/AGENTS.md` beschreibt den Dialog statt des Paneels. Der Purpose von
`bedien-muster` nennt das Anlegen mit.

## Risks / Trade-offs

- [Ein Dialog verdeckt die Liste, die der Drawer halb sichtbar ließ] → Beim Anlegen einer UHS
  oder eines Raums wird nichts aus der Liste abgelesen; nach dem Anlegen springt die Seite in die
  neue Ansicht.
- [Die Lagemeldung verdeckt beim Erfassen die Zeitachse] → Es wird eine einzelne Meldung
  geschrieben, nicht in Serie gegen die Zeitachse gelesen; die neue steht nach dem Schließen oben
  mit „Neu“.
- [e2e und Bilder-Specs suchen das Paneel als `region`] → `e2e/lagemeldungen.spec.ts` und
  `e2e/doku-bilder/lagemeldungen.bilder.ts` suchen den Dialog; die Bilder der drei Kapitel werden
  neu erzeugt (Mitänderungsregel, `docs/anwender/AGENTS.md`).
- [Doku-Bilder brauchen ein frisch gebautes Backend] → `cargo build` auf dem Stand des Branches
  vor `pnpm doku:bilder`.
