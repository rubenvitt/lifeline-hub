# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/etb-schnellerfassung-tastatur/spec.md`,
`specs/einsatztauglichkeit-layout/spec.md`.

So steht es heute (alpha, 05.10.2026):

- `etb/Schnellerfassung.tsx`, `onKeyDown`: `istSendeTaste` = Enter ohne Shift/Alt und (Strg/⌘
  oder einzeiliger, nicht leerer Text). Keine Weiche nach Zeigerart, kein `enterKeyHint`.
  `useViewport()` liefert `istBeruehrung` (`(pointer: coarse)`, primärer Zeiger, mit
  `change`-Zuhörer), die Erfassung liest bisher nur `istSchmal`.
- Hinweiszeile: unter `md` `ENTER_HINWEIS_KURZ` („Enter sendet · Shift+Enter neue Zeile“), ab
  `md` Typbefehle, `@ Einheit`, `/zeit` und `ENTER_HINWEIS`. Platzhalter: unter `md`
  `PLATZHALTER_KURZ` mit „/ für Befehle“.
- `components/instrument/Schnellerfassungszeile.tsx`: die Feldzelle ist ein Flex-Container
  (`flex: 1 1 auto`). Ihr Kind wird nur in der gestapelten Form über
  `.lfh-schnellerfassung__feld--gestapelt > * { flex: 1 1 auto }` (`theme/sprache.css`) gestreckt.
  Die Wurzel `div.markdown-editor` hat keine Breite, das Feld misst rund 160 px. Die
  Personenzeile gibt ein antd-`Input` hinein (füllt), das Infotelefon ein `Flex` mit `width: 100%`.
- `pages/EtbPage.tsx`, Seitenkopf `aktionen`: Druckknopf, `Segmentleiste` (Typfilter),
  `Popconfirm` „Einsatz abschließen“ (nur mit Leitungsrecht). Darunter `EtbFilterleiste` mit
  Volltext, Zeitraum und dem Einheiten-`Select` als `zusatz`, unter `md` gestapelt.
- `etb/entwuerfe/EtbEntwurfsTabs.tsx`: Reiterband `Tabs type="editable-card"` über der
  Schnellerfassung. Die Schnellerfassung fokussiert ihr Feld beim Mount.

## Goals / Non-Goals

**Goals:**
- Auf Touch legt Return keinen Eintrag an; ein Mehrzeiler lässt sich tippen und über „Erfassen“
  senden. Mit feinem Zeiger ändert sich nichts.
- Ab `md` füllt das Textfeld die Zeile zwischen Präfix und „Vorschau“.
- Kein sichtbarer Text nennt auf Touch eine Tastenkombination, kein Platzhalter „Befehle“.
- Auf 390 × 844 sind beim Öffnen mindestens zwei Einträge ganz sichtbar, auch ohne
  Abschließen-Recht; die Leiste bleibt unter der halben Fensterhöhe.

**Non-Goals:**
- Die Infotelefon-Erfassung. Sie wird gemessen und das Ergebnis in `tasks.md` notiert; ein
  Umbau dort hängt am Stab-Kopf und wird eigens geschnitten.
- Der Typ-Chip „/meldung“ (gelehrte Slash-Syntax, im Audit als Gestaltung eingestuft).
- Erfassungsformulare über `components/Erfassung.tsx`: dort sendet Enter über das native
  `<form>`, eine `TextArea` behält den Umbruch schon.
- Eine Erkennung der Hardware-Tastatur. Es gibt kein verlässliches Signal; ein Tablet mit
  angesteckter Tastatur meldet weiter `coarse` und sendet über Strg/⌘+Enter.

## Decisions

### D1 — Return sendet bei grobem Zeiger nicht (entschieden 05.10.2026)

Mit `istBeruehrung` gilt: Enter (auch Shift+Enter) fügt einen Zeilenumbruch ein, wie es die
`TextArea` ohne Eingriff tut. Strg/⌘+Enter sendet weiter. Das Textfeld trägt
`enterKeyHint="enter"`, die Bildschirmtastatur zeigt damit „Return“, nicht „Senden“. Ohne
`istBeruehrung` bleibt `istSendeTaste` unverändert.

- **Verworfen: Enter sendet überall, nur `enterKeyHint="send"`.** Die Taste hieße dann ehrlich
  „Senden“, aber ein Mehrzeiler bliebe auf Touch unmöglich, und das Bruchstück im
  unveränderlichen ETB entstünde weiter.
- **Verworfen: Weiche nach Breite (`istSchmal`).** Das Führungs-Tablet ist breit und hat oft
  keine Tastatur; genau dort kam der Befund her.
- **Preis:** Am Führungs-Tablet mit angesteckter Tastatur sendet Enter nicht mehr, nur noch
  Strg/⌘+Enter oder der Knopf. Der Hinweis sagt das.

### D2 — Feldbreite über ein Opt-in an der Hülle

`Schnellerfassungszeile` bekommt `feldFuellt?: boolean`. Gesetzt, trägt die Feldzelle zusätzlich
die Klasse `lfh-schnellerfassung__feld--fuellt`, und `sprache.css` streckt ihr direktes Kind
(`flex: 1 1 auto; min-width: 0`). Die gestapelte Regel bleibt, der Kommentar in `sprache.css`
nennt beide. Das ETB setzt `feldFuellt` immer.

- **Verworfen: die Regel pauschal in die ungestapelte Hülle.** Eine Zelle mit mehreren Feldern
  nebeneinander (Infotelefon) bekäme dann gestreckte Kinder; der Audit warnt davor.
- **Verworfen: `style` an der Editor-Wurzel im Aufrufer.** `MarkdownEditor` reicht kein `style`
  an seine Wurzel, und die Breite ist eine Eigenschaft der Zelle, nicht des Editors.

### D3 — Hinweis und Platzhalter

- Hinweis, Zeigerart grob: „Return neue Zeile · „Erfassen“ sendet“ (Konstante
  `ENTER_HINWEIS_BERUEHRUNG`), auf jeder Breite. Ab `md` stehen Typbefehle, `@ Einheit` und
  `/zeit` davor wie bisher.
- Hinweis, Zeigerart fein: unverändert (`ENTER_HINWEIS` ab `md`, `ENTER_HINWEIS_KURZ` darunter).
- Kurzplatzhalter: „Inhalt … ( / für Typ & Felder · @ für Einheit )“. Er ist fünf Zeichen
  länger; die Höhe der Leiste misst `e2e/leisten-flaeche.spec.ts` (Deckel 50 %) weiter.

### D4 — Handschirm: zuerst die Zeitachse (entschieden 05.10.2026: alles einklappen)

Nur unter `md` (`istSchmal`), ab `md` bleibt der Kopf wie er ist.

1. **Kopfaktionen:** Druckansicht und „Einsatz abschließen“ wandern in ein Menü „Weitere“ über
   `components/MenueAusloeser.tsx` (Einträge nur Text, Abschließen als Gefahr hinter dem
   Trenner). Die Rückfrage zum Abschließen wird ein kontrolliertes `<Modal>` mit
   `okButtonProps={{ danger: true }}` (die Regel zu `MenueAusloeser` verlangt die Rückfrage beim
   Aufrufer, kein `Popconfirm` im Menü). Ohne Leitungsrecht trägt das Menü nur die Druckansicht.
2. **Typfilter:** `Segmentleiste` einzeilig mit waagerechtem Bildlauf (`flexWrap: nowrap`,
   `overflowX: auto`), wie die Feldzeile der Erfassung (LFH-373).
3. **Filter:** Ein Knopf „Filter“ zeigt die Zahl gesetzter Filter aus Volltext, Zeitraum und
   Einheit („Filter (2)“) und klappt die `EtbFilterleiste` inline auf (`aria-expanded`). Ein
   Filter, der von außen kommt (Deeplink, „ETB ↗“, Zurück), klappt sie auf, damit ein Treffer
   nie ohne sichtbaren Grund dasteht. Zuklappen darf man sie trotzdem, die Zahl am Knopf nennt
   den Grund; das Leeren eines Filters klappt nichts zu (Review 05.10.2026: die Leiste
   verschwand sonst unter dem Finger, und der Knopf war bei aktivem Filter wirkungslos). Der
   Typfilter zählt nicht, er steht sichtbar daneben.
4. **Erfassungsleiste eingeklappt:** Die Schnellerfassung bekommt `eingeklappt?: boolean`.
   Eingeklappt entfallen Hinweiszeile, Feldzeile (Chips, „Feld“, „Anhang“) und die
   Rufname-Abfrage; Präfix, Feld, „Vorschau“ und „Erfassen“ bleiben. `EtbEntwurfsTabs`
   blendet das Reiterband aus, solange genau ein Entwurf besteht. Eingeklappt ist die Leiste,
   wenn `istSchmal`, kein Fokus in ihr liegt (`focusin`/`focusout` an der Wurzel der Leiste in
   `EtbPage`) und der aktive Entwurf leer ist (Text, Felder, Dateien; keine Berichtigung). Der
   Fokus beim Mount entfällt unter `md` und wartet auf die bekannte Breite (der erste Render
   gilt als breit, der Wechsel in die gestapelte Form montierte das Feld neu); `?neu=1` zählt als
   Fokus in der Leiste, fokussiert weiter und klappt damit auf. Einklappen schließt einen offenen
   Feld-Editor und das Menü.
   Senden lässt den Fokus im Feld (`fokusInsFeld`), die Leiste bleibt also offen.

- **Verworfen: die Leiste unter `md` ganz als Knopf „Eintrag erfassen“.** Ein Extra-Tipp vor
  jeder Meldung widerspricht dem Funkprotokoll-Gedanken.
- **Verworfen: den Kopf unter `md` nur kürzen (Typfilter weg).** Reicht rechnerisch nicht: der
  erste Eintrag steht heute 132 px hinter der Oberkante der Leiste.

### D5 — Nachweis

- Vitest, `etb/Schnellerfassung.test.tsx`: `matchMedia('(pointer: coarse)')` auf wahr; Enter
  sendet nicht und fügt einen Umbruch ein; Strg+Enter sendet; `enterKeyHint`; Hinweis und
  Platzhalter je Zeigerart; eingeklappt ohne Feldzeile und Hinweiszeile.
- Vitest, `Schnellerfassungszeile.test.tsx`: Klasse nur mit `feldFuellt`.
- e2e, `leisten-flaeche.spec.ts`: Textarea ≥ 60 % der Zeile auf 820, 1180, 1440; auf 390 × 844
  mindestens zwei Einträge ganz über der Oberkante der Leiste, als Admin und als Rolle ohne
  Abschließen-Recht (`e2e/rollen-kern.ts`). Mutationsprobe: ohne `feldFuellt` bzw. ohne das
  Einklappen wird der Fall rot.
- Vorhandene Gates mitlaufen lassen: `leisten-flaeche`, `fokus-verdeckung`,
  `etb-entwurf-tabs`, `etb-chronologie`, `gate3-trefflaeche` (ETB-Ziele).

## Risks / Trade-offs

- [Gewohnheit am Tablet mit Tastatur] → Hinweiszeile nennt den Weg; Strg/⌘+Enter bleibt.
- [Eingeklappte Leiste versteckt gesetzte Felder] → eingeklappt nur bei leerem Entwurf; sobald
  Inhalt da ist, steht alles.
- [Zweiter Entwurf unsichtbar] → mit mehr als einem Entwurf bleibt das Reiterband stehen.
- [Fokuswechsel ins Menü der Leiste klappt sie zu] → Slash-Menü und Chip-Editor liegen in der
  Leiste; Portale (Typ-Dropdown) werden über `relatedTarget` und eine kurze Verzögerung
  abgefangen, Test mit `focusout` und `relatedTarget`.
