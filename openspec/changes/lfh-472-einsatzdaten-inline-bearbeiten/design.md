# Design

## Context

- `pages/EinsatzdatenPage.tsx` kennt zwei Zustände, Leseansicht und Vollformular
  (`bearbeiten`). Die Leseansicht besteht aus der Kopfleiste (`KopfAngabe` × 4), dem Paneel
  „Lagedaten" (`Angaben`, 6 Zeilen) und den eingeklappten „Technischen Angaben" (3 Zeilen).
- `PATCH /api/einsaetze/{id}` ist seit LFH-306 ein Tri-State-Teil-PATCH
  (`routes/einsatz.rs:KopfdatenPatch`): Feld fehlt = unverändert, `null`/`""` = leeren, leere
  Pflichtangabe = 400. Das Frontend schickt über `KopfdatenUpdate` trotzdem immer alle Felder.
- Der Einsatzkopf ist nicht live (`NICHT_LIVE_KEYS`), und der Einsatz hat keine CAS-Basis
  (`basis_geaendert_at`).
- `components/BemerkungZelle.tsx` (LFH-369/650) ist das Muster für Inline-Bearbeitung, aber
  nur für optionalen Freitext und auf `Typography.Text editable` gebaut. Es trägt die
  Fokusrückgabe (Merker, der den Zweigwechsel überlebt) und den Wertgleichheits-Riegel.

## Goals / Non-Goals

**Goals:**
- Ein Primitiv, das jede Eingabeart trägt (Text, Textfeld, Zahl, Auswahl, Datum/Uhrzeit) und
  eine Pflichtangabe ablehnt, ohne zu senden.
- Dieselbe Zeitwandlung wie im Vollformular, keine zweite.

**Non-Goals:**
- Koordinate und Bezeichnung inline (s. D1).
- Das Vollformular auf Differenz-PATCH umstellen. Es sendet weiter alle Felder und kann damit
  eine gleichzeitige Zeilenänderung überschreiben; das ist der heutige Zustand und wird als
  Nachzug erfasst (D4).
- Live-Aktualisierung des Einsatzkopfes.
- `BemerkungZelle` in Listen ersetzen.

## Decisions

### D1 — Welche Angaben inline

Neun Angaben inline (Liste in der Spec). Nicht inline:

- **Bezeichnung:** steht als `h1` im Seitentitel. Eine Schaltfläche im Titel verwischt
  „Titel" und „Bedienziel", und der Kopf-Slot trägt nach CLAUDE.md, was öffnet. Sie ändert
  sich im Einsatz selten. Das Vollformular reicht.
- **Koordinate:** `KoordinatenEingabe` hat einen eigenen Systemwähler, eine Ort-Zeile mit
  Peilung und Kartenbezug. Inline wird das zur zweiten Seite in der Zeile. Die Lagekarte hat
  ohnehin den Verortungsweg.
- **Einsatzleitung** (Mitglieder, eigener Abschnitt), **Einsatznummer** (unveränderlich,
  LFH-617), **Angelegt am** (Systemwert).

Die Alarmzeit ist also die einzige Pflichtangabe inline, die sich leeren lässt (DatePicker
mit `allowClear`). Die Einsatzart ist Pflicht, aber ein `Select` ohne `allowClear` kann nicht
leer werden.

### D2 — Neues Primitiv `InlineAngabe` statt `BemerkungZelle` erweitern

`BemerkungZelle` steht auf `Typography.Text editable`, das nur Text kann. DatePicker, Select
und InputNumber passen nicht hinein. Ein zweiter Modus in `BemerkungZelle` gäbe ihr zwei
Mechaniken. Deshalb ein eigenes Bauteil `components/InlineAngabe.tsx`:

- **Anzeige:** mit Schreibrecht ein `Button type="text"` mit `wertKnopfStil` und
  Stift-Ikone, zugänglicher Name „<Etikett> bearbeiten", Wert als `aria-describedby`
  (Muster LFH-650). Leer: `Button type="link"` „<Etikett> eintragen" in `rollen.bedienText`.
  Ohne Schreibrecht nur der Anzeigewert bzw. „—".
- **Bearbeitung:** ein eigenes `<form>` mit der Eingabe (Render-Prop
  `eingabe({ id, value, onChange })`), „Speichern" (`htmlType="submit"`) und „Abbrechen".
  Enter sendet nativ; im `Input.TextArea` bleibt Enter der Zeilenumbruch und Strg/⌘+Enter
  sendet. Escape bricht ab (über `key`, nicht `keyCode`, weil hier kein antd-`Editable` im
  Spiel ist). Fokus beim Öffnen in die Eingabe. **Kein Speichern beim Verlassen (Blur):**
  DatePicker und Select öffnen Portale, deren Klick die Eingabe verlässt, und ein Blur-Speichern
  schriebe halbe Zeitpunkte.
- **Wert-Vertrag:** Das Bauteil arbeitet mit einem Entwurfswert vom Typ `T` und bekommt
  `leer(T)`, `gleich(a, b)` und `onSpeichern(T) => Promise<void>`. Die Umwandlung ins
  Wireformat liegt beim Aufrufer.
- **Pflicht:** `pflicht` + `leer(entwurf)` → kein `onSpeichern`, zurück in die Anzeige mit
  dem bisherigen Wert, Hinweis an der Zeile (`data-fehler`, „<Etikett> ist eine Pflichtangabe
  — der bisherige Wert bleibt."). Der Hinweis geht beim nächsten Öffnen.
- **Gleichheit:** `gleich(entwurf, bisher)` → kein `onSpeichern`, zurück in die Anzeige.
- **Fehler:** `onSpeichern` lehnt ab → Eingabe bleibt offen mit dem Entwurf, Fehler als
  `SpeicherFehler` in der Zeile (CLAUDE.md „Speicherfehler an die Seite").

Die antd-Falle „`Editable` wertet legacy `keyCode`" aus LFH-369 betrifft das neue Bauteil
nicht, weil es kein `Editable` nutzt; die Tests zu `BemerkungZelle` bleiben dabei.

### D3 — Fokusrückgabe als gemeinsamer Hook

Die zweite gemessene Falle aus LFH-369 (Fokus fällt auf `<body>`, wenn der neue Wert erst
eine Runde später eintrifft) gilt genauso. Die Logik aus `BemerkungZelle` wird als
`components/useFokusRueckgabe.ts` herausgelöst (Merker über den Zweigwechsel,
`useLayoutEffect` ohne Deps, Eingriff nur bei verwaistem Fokus) und von beiden Bauteilen
genutzt. Die bestehenden `BemerkungZelle`-Tests belegen, dass sich deren Verhalten nicht
ändert. Alternative „kopieren" verworfen: CLAUDE.md „Dieselbe Eingabe nicht zweimal bauen".

### D4 — Nebenläufigkeit: Einzelfeld-PATCH, letzte Speicherung gewinnt je Feld

Eine Zeile sendet `{ <feld>: <wert> }` über einen neuen Typ `KopfdatenPatch =
Partial<KopfdatenUpdate>` und `patcheEinsatz(id, patch)` in `api/einsaetze.ts`. Damit stößt
eine Zeile keine anderen Felder an. Gleichzeitige Änderungen **derselben** Zeile: die letzte
gewinnt, wie heute. Eine CAS-Basis am Einsatz (Muster `schaden`/`tier`) wäre ein
Backend-Umbau mit Migration für einen seltenen Fall und würde den Überschreiben-Dialog in
jede Zeile tragen, deshalb nicht.

Nach dem Erfolg: Antwort per `setQueryData` in `einsatzKeys.einsatz(id)` (die Zeile zeigt den
neuen Wert sofort, Fokusrückgabe trifft den frischen Knopf), dann Invalidierung von
`einsatzKeys.einsatz(id)` und `globalKeys.einsaetze()` wie im Vollformular. Erfolgsmeldung
`message.success('<Etikett> gespeichert')`, wie das Vollformular.

Nachzug (eigenes Ticket): Vollformular sendet nur geänderte Felder.

### D5 — Zeitwandlung

Alarmzeit und Nächste Lagebesprechung öffnen mit `wireZuPicker(wire)` und senden
`pickerZuWire(d)`. Der Gleichheits-Vergleich läuft über `valueOf()` des Dayjs, nicht über
die formatierte Zeichenkette. Tests prüfen den gesendeten Wirestring gegen den absoluten
Zeitpunkt beidseits beider Umstellungen 2026 (Muster `etb/filterZeit.test.ts`); die Suite
läuft in `check-all.sh` unter `TZ=Europe/Berlin`, dort sind sie scharf.

### D6 — Einbau in die Seite

`KopfAngabe` und `Angaben` bekommen statt eines fertigen `wert` ein `ReactNode`, das bei
bearbeitbaren Angaben eine `InlineAngabe` ist. Die Kopfleiste bleibt ein Fugenraster; die
Eingabe darf die Zelle in der Höhe wachsen lassen. „Leitstellen-Nr." bleibt in den
eingeklappten technischen Angaben. Der Knopf „Bearbeiten" im Seitenkopf bleibt die eine
Primäraktion.

## Risks / Trade-offs

- [Vollformular überschreibt gleichzeitige Zeilenänderung] → heutiger Zustand, Nachzug-Ticket
  für Differenz-PATCH.
- [Stand anderer Personen erscheint erst nach Neuabruf, weil der Einsatzkopf nicht live ist]
  → heutiger Zustand; nach jeder Zeilenspeicherung wird neu geladen.
- [Eingabe in einer Kopfzelle von ~220 px ist eng, DatePicker mit Uhrzeit braucht Breite]
  → Eingabe in der Zelle mit `width: 100%`, das Popup ist ein Portal; Handprobe im Fükw- und
  Mobilformat.
- [Mehrere Zeilen gleichzeitig offen] → erlaubt; jede Zeile hat ihren eigenen Entwurf und
  ihre eigene Anfrage, nichts geht verloren.
