# Design

## Context

Siehe `proposal.md` (Why). Stand am 17.10.2026 (Bestandsaufnahme im Scope-Scan):

- **Ein Baustein, 35 Aufrufe in 29 Dateien.** `ZeitpunktEingabe` (34×) und `ZeitraumEingabe`
  (1×, Verpflegung) in `anzeige/ZeitpunktEingabe.tsx`, beide über antds `DatePicker` bzw.
  `RangePicker`. Die Wandlung Zeitpunkt ↔ Wanduhr der Anzeigezone (`anzeige/zeitEingabe.ts`,
  LFH-692), „Jetzt“ nach Serveruhr (`offline/serveruhr.ts:serverJetzt`, LFH-895) und das Blatt
  am unteren Rand (`useZeitBlatt`, `ZeitpunktEingabe.css`, LFH-953/LFH-1076) sind erprobt und
  bleiben.
- **Vier Formate** am Aufruf (`YYYY-MM-DD HH:mm`, `DD.MM.YYYY HH:mm`, mit Sekunden bzw. antds
  Vorgabe ohne `format`, nur Datum in `verpflegung/TagAusVorlage.tsx`), keins taktisch. Gelesen wird nur das
  `format` des Aufrufers.
- **Verträge, an denen andere hängen:**
  - `components/InlineAngabe.tsx` (Einsatzdaten „Alarmzeit“, Skizze „Gültig ab“/„gez. DTG“)
    reicht `{id, aria-label, autoFocus}` und `onOpenChange` hinein, speichert über das native
    `<form onSubmit>` (Enter), liest Escape in der Capture-Phase (erst Popup zu, dann verwerfen).
  - `etb/MetaChip.tsx` übernimmt nur über `onOk`, fokussiert per `ref`, Escape bricht ab.
  - Erfassungs-Norm (`frontend/AGENTS.md`): Enter sendet nativ ab, das erste Feld bekommt den
    Fokus.
- **Kein dayjs-Locale `de`:** antd fragt den Wochenbeginn bei dayjs ab, ohne geladene Sprache
  gilt Englisch (Sonntag). `customParseFormat` kommt nur indirekt über rc-picker.
- **Formatkern:** `anzeige/format.ts:taktischeDtgVoll` schreibt `161430JUL2026` (Monate groß,
  `MÄR`, Jahr vierstellig). Die Umstellung aller Anzeigen auf E1 ist LLH-1053.
- **Kein Zugriff auf Claude Design** in der Cloud-Sitzung: gebaut wird nach der
  Gestaltungssprache (`frontend/AGENTS.md`), das Design System wird nachgezogen.

## Goals / Non-Goals

**Goals:**

- Ein diktierter oder abgeschriebener Zeitpunkt ist mit wenigen Tasten und Enter eingetragen,
  ohne Maus, in allen 35 Feldern zugleich.
- Ein Kern deutet Eingaben (`anzeige/zeitParser.ts`), rein und ohne React, damit die
  ETB-Kurzeingabe `/zeit` (LLH-1088) ihn später nutzt.
- Die bestehenden Anforderungen von `zeiteingabe` (Anzeigezone, unverändertes Speichern,
  Zonenhinweis, Jetzt nach Serveruhr) gelten unverändert.

**Non-Goals:**

- Die übrigen Anzeigen (Listen, Druck, Zeitachsen) auf E1/E2 umstellen und die Gerätewahl der
  Darstellung (E3): LLH-1053 und Folgeticket.
- Die Zeitfenster-Schnellwahl der Lagemeldungen (`lagemeldungen/zeitachse.ts`) ist ein
  Listenfilter, kein Feld; sie bleibt.
- ETB-Zeitraum-Schnellwahl (LLH-1080) und `/zeit`-Kurzeingabe (LLH-1088) nutzen den Kern
  später, bauen ihn hier nicht mit.
- Sekunden: taktische Zeit kennt keine; ein neu eingegebener Zeitpunkt hat Sekunde 0 (außer
  „jetzt“/relativ). Ein unveränderter Wert behält seine Sekunden, weil er nicht neu gesendet wird.

## Decisions

### D1 Textfeld zuerst, antds Picker fällt weg

Das Feld ist ein antd-`Input` in Mono (`tabular-nums`), Steuerhöhe der Dichtestufe, mit einem
Kalender-Knopf als Suffix. Der `DatePicker` verschwindet ganz aus dem Baustein.

*Alternativen:* (a) antds Picker behalten und nur `format` als Liste, `needConfirm={false}`,
`minuteStep` setzen — die Scrollspalten, das Panel über dem Prüfhinweis und das Blatt für jeden
Fingertipp blieben, und `1430`/`101430okt26` kann antd nicht deuten. (b) Eigener Parser
hinter antds `inputRender` — rc-picker validiert den Text selbst und setzt ihn bei Fokuswechsel
zurück; der Kampf gegen die interne Zustandsmaschine wäre teurer als ein eigenes Feld.

### D2 Ein reiner Parser mit Feldart und Bezug

`anzeige/zeitParser.ts`: `deuteZeit(text, { zone, jetzt, art, bezug, keineZukunftstage })`
liefert `{ ok: true, zeitpunkt, hinweis?: 'gestern' | 'morgen' }` oder
`{ ok: false, grund }`. Schreibweisen und Richtungsregeln stehen in der Spec
(„Taktische und gebräuchliche Schreibweisen“, „Relative Eingabe“, „Richtung nach Feldart“).

- Der Wandel Wanduhr → Zeitpunkt läuft über `anzeige/uhrzeit.ts:uhrzeitAmTag` (doppelte Stunde:
  die erste, Lücke: nach vorn), damit es genau eine DST-Regel gibt.
- `jetzt` wird hineingereicht (im Baustein `serverJetzt()`), damit Tests ohne Uhr laufen.
- `bezug` ist der Tag, an dem eine bloße Uhrzeit liegt (Zeitraum-Ende: Tag des Beginns, D7);
  ohne Bezug gilt heute.
- `art`: `'ereignis' | 'frist'`; ohne Angabe heute bzw. laufender Monat. `keineZukunftstage`
  ohne `art` gilt als `ereignis`.
- Ziffernblöcke sind eindeutig nach Länge: 3–4 Ziffern Uhrzeit, 6 Ziffern Tag+Uhrzeit. Fünf
  Ziffern sind unlesbar (kein Raten zwischen `HHMMx` und `THHMM`).
- Gründe sind kurze Wörter für das Feld: „Uhrzeit gibt es nicht“, „Tag gibt es nicht“, „Monat
  unbekannt“, „liegt in der Zukunft“, „nicht lesbar“.

### D3 Übernahme: Enter, Verlassen, Escape

- **Enter** mit lesbarer Eingabe: `onChange` synchron (rc-field-form hält den Wert, bevor das
  native Submit greift), dann `onOk`; der Tastendruck läuft weiter, das Formular sendet wie
  bisher. Mit unlesbarer Eingabe: `preventDefault`, Grund bleibt stehen.
- **Verlassen** mit lesbarer Eingabe übernimmt (Klick auf „Speichern“ ohne Enter). Mit
  unlesbarer Eingabe zeigt das Feld wieder den geltenden Wert und den Grund („nicht
  übernommen: Uhrzeit gibt es nicht“). *Abgewogen:* Text stehen lassen, Wert unverändert — dann
  zeigte das Feld etwas anderes, als gesendet wird. `null` melden — ein optionales Feld verlöre
  still seinen Wert. Zurück auf den geltenden Wert mit Grund ist das einzige, bei dem Feld und
  Formular übereinstimmen.
- **Escape** mit geänderter Eingabe stellt den geltenden Wert her und stoppt die Weitergabe nur
  dann, wenn der Kalender offen ist (dessen Schließen meldet `onOpenChange(false)` wie bisher,
  `InlineAngabe` unterscheidet so weiter zwischen „Popup zu“ und „verwerfen“).
- **Leeren** und Enter/Verlassen meldet `null`; mit `allowClear={false}` gilt Leeren als unlesbar
  („Angabe fehlt“).
- `onChange` feuert nur, wenn sich der Zeitpunkt ändert (Gleichheit am Instant), so bleibt
  „Unverändertes Speichern verschiebt nichts“ erfüllt.

### D4 Anzeige im Feld nach E1, Deutung als Suffix

Ohne Fokus und nach Übernahme zeigt das Feld `161430okt26`. Mit Fokus wird der Text markiert,
Tippen ersetzt ihn. Weicht der Text vom geltenden Wert ab, steht rechts im Feld die Deutung
(`= 171430okt26`, `gestern 2350`) bzw. der Grund, gedämpft, `aria-live="polite"` und über
`aria-describedby` am Feld. Der Grund ist Text, nicht nur Farbe („kein Rot ohne Wort“); `status`
`error` erst, wenn ein Wort dasteht.

Die Schreibweise E1 kommt aus einer neuen Funktion in `anzeige/format.ts` (Monatstabelle klein,
ohne Umlaut, Jahr zweistellig), mit Fundstelle DV 810.3 im Kommentar. LLH-1053 macht sie zur
Vorgabe aller Anzeigen und entfernt dann die alte Tabelle; bis dahin stehen beide nebeneinander.

*Alternative:* Deutung als Zeile unter dem Feld — verschiebt Formulare bei jedem Tastendruck und
kollidiert mit dem Prüfhinweis von `Form.Item`.

### D5 Kalender als Nebenweg: Monatsblatt + Uhrzeitfeld + Schnellwahl

`anzeige/ZeitKalender.tsx`: antds `Calendar` (`fullscreen={false}`, eigener Kopf ‹ Monat Jahr ›)
für den Tag, darunter ein Uhrzeitfeld (`HHMM`, `inputMode="numeric"`, vorbelegt), die
Schnellwahl der Feldart (D6) und „Übernehmen“. Ein Tag-Klick wählt nur, Enter im Uhrzeitfeld
oder „Übernehmen“ übernimmt und schließt. Der Kalender öffnet mit Tag und Uhrzeit des geltenden
Werts, ohne Wert mit heute und der aktuellen Minute. Am Feld als Popover, sonst als Blatt nach
`zeitPanelAmFeldAb` (Weiche und CSS-Regeln bleiben, die Selektoren wechseln auf den neuen
Container). Tage nach heute sind bei `keineZukunftstage` gesperrt (`istZukunftstag`).

Wochenbeginn Montag: `import 'dayjs/locale/de'` in `main.tsx` (registriert die Sprache, ändert
die globale dayjs-Sprache nicht; antd liest sie über `de_DE`). Ein Test prüft „Mo“ in der ersten
Spalte.

*Alternative:* antds `DatePicker`-Panel mit `showTime={{ format: 'HH:mm', minuteStep: 5 }}` als
Nebenweg — wieder Scrollspalten, und der Picker brächte seine eigene Texteingabe mit, die mit
dem Feld konkurriert.

### D6 Eine Schnellwahl-Tabelle

`anzeige/zeitSchnellwahl.ts` mit `SCHNELLWAHL = { ereignis: [jetzt, −5, −15], frist: [+15, +30,
+60, +120] }` und `schnellwahlZeit(bezug, minuten)`. Beschriftungen bleiben „+1 h“ usw.
(hängen an Tests). Der Kalender zeigt die Reihe der Feldart; ein Prop `schnellwahl` am Feld zeigt
sie zusätzlich als Knopfreihe unter dem Feld (Vorgabe aus, damit Formulare nicht wachsen;
an für den ETB-Chip). Wiedervorlage und Lagebesprechung behalten ihre Knöpfe mit eigenem Bezug
(Besprechungszeitpunkt, `src/routes/lagebesprechung.rs` lehnt `naechste_at ≤ abgehalten_at` ab)
und importieren die Tabelle von hier; `components/terminSchnellwahl.ts` und sein Test ziehen um.

Knöpfe als `Button` in der Steuerhöhe (Gate 3 Trefffläche), nicht `Segmentleiste` — die ist ein
Umschalter (`radiogroup`), die Schnellwahl löst einmalig aus.

### D7 Zeitraum aus zwei Feldern

`ZeitraumEingabe` besteht aus zwei `ZeitpunktEingabe` („Beginn“, „Ende“; ab `md` nebeneinander,
darunter untereinander). Das Ende bekommt `bezug` = Tag des Beginns und den Beginn als
Untergrenze (Folgetag-Regel der Spec). Der Wert bleibt das Tupel `[von, bis]`, Form-Anbindung
unverändert.

### D8 Props-Vertrag ohne antd-Durchreiche

Statt `Omit<DatePickerProps, …>` ein eigenes Interface: `value`, `defaultValue`, `onChange`,
`onOk`, `art`, `keineZukunftstage`, `schnellwahl`, `nurTag`, `disabled`, `placeholder`,
`allowClear`, `id`, `aria-label`, `autoFocus`, `style`, `onKeyDown`, `onBlur`, `open`,
`onOpenChange`, `ref` (auf das `<input>`, `focus({ preventScroll })` wie heute). `format`,
`showTime`, `needConfirm`, `presets` gibt es nicht mehr; die Typprüfung findet jeden Rest.
`nurTag` ersetzt `showTime={false}` (`verpflegung/TagAusVorlage.tsx`): Anzeige `TT.MM.JJJJ`,
Eingabe `TT.MM.[JJ[JJ]]`, ISO, Kalender ohne Uhrzeitfeld.

### D9 Wächter

`anzeige/zeitEingabe.guard.test.ts`: kein `DatePicker`/`TimePicker` aus `antd` irgendwo in
`src/` (auch nicht in `anzeige/`), `Calendar` aus `antd` nur in `anzeige/`, `.local()` weiter
nur in `anzeige/`. Kein `format=` an `ZeitpunktEingabe`/`ZeitraumEingabe` (Quelltext-Regex als
zweites Netz zur Typprüfung). `components/dichte.guard.test.ts` führt `Calendar` statt der
Picker in `INTERAKTIV`.

### D10 Tests ziehen über einen Helfer um

`test/zeitEingabe.ts` mit `tippeZeit(feld, text)` (leeren, tippen, Enter) und
`zeitFeld(name)`; die 24 Vitest-Dateien nutzen ihn statt Format-Strings, „OK“ und
`.ant-picker`-Selektoren. Erwartungen auf den Feldtext lauten auf die DTG. Die 6 e2e-Specs
stellen auf `fill('1430')` + Enter bzw. den neuen Kalender um; `dialoge-handy.spec.ts` und
`gate3-trefflaeche.spec.ts` messen Blatt und Knöpfe neu.

## Risks / Trade-offs

- [Breiter Diff über 29 Dateien und 30 Testdateien in einer Change] → Die Aufrufer ändern sich
  nur mechanisch (Props streichen, `art` setzen); die Umstellung läuft in Gruppen nach Modul,
  jede Gruppe grün, bevor die nächste beginnt.
- [`1430` meint in seltenen Fällen nicht heute] → Deutung steht vor der Übernahme am Feld,
  „gestern“/„morgen“ ausdrücklich; Ereignis/Frist decken die häufigen Fälle.
- [Gewohnheit: bisher Kalender zuerst] → Kalender-Knopf bleibt im Feld sichtbar; Platzhalter
  zeigt den wirksamen Wert („jetzt“), keine Erklärzeile (LFH-1078).
- [Zwei DTG-Schreibweisen bis LLH-1053] → Feld zeigt E1, Listen und Druck noch die alte; das
  Folgeticket ist auf dem Board und hängt an derselben Entscheidung.
- [antds `Calendar` braucht `customParseFormat` nicht, rc-picker fiel als indirekter Lader
  weg] → Der Parser nutzt keine dayjs-Formate zum Lesen; drei Tests laden das Plugin selbst und
  brauchen es danach nicht mehr.
- [e2e ist in der Cloud-Sitzung nur eingeschränkt lauffähig] → Vitest und Typprüfung sind das
  Netz vor dem Push; e2e läuft in der CI (`check-all.sh` Schritt 7).

## Migration Plan

Reiner Frontend-Umbau, kein Wire-, Daten- oder Speicherwechsel. Rücknahme durch Revert des
Merge-Commits.

## Open Questions

- Fundstelle der DTG-Schreibweise in der DV 810.3: wird beim Bau geprüft und im Kommentar
  genannt. Weicht die Vorschrift von E1 ab, bleibt E1 (Rubens Entscheidung) und die Abweichung
  geht als Kommentar an LLH-1045.
