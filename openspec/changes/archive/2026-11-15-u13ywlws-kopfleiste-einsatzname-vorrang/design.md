# Design

## Context

Die Kopfleiste des Einsatzes (`einsatz/EinsatzLayout.tsx`, Bausteine in `components/Kopfleiste.tsx`)
ist eine Flexzeile mit Umbruch: links die Namensgruppe (Markenzelle, Wortmarke, Statuspunkt,
Einsatznummer, ggf. Führungs-Chip, Name im `EinsatzSwitcher`), ab `lg` die Suchzelle, rechts die
Gruppe aus Eingänge, Alarmzentrale, SYNC, Uhr und Benutzermenü. Der Umbruch hängt an den Basen
(`KOPF_NAME_FLEX` `3 1 340px`, `KOPF_SUCHE_FLEX` `1 1 136px`); die Namenszelle trägt
`contain: inline-size`, damit ihr Boden nur die Trefffläche zählt (LFH-1126). Damit hat der Name
keine Eigenbreite: er bekommt nur, was die Wachstumsquote 3 : 1 aus dem Rest gibt.

Die Wörter in der rechten Gruppe hängen an Breiten und Dichte: ab `xl` alle Wörter, in `handschuh`
auch darunter, Start-Wörter („Ton wird geprüft“, „VERBINDE“) halten über `WortPlatz` die Breite
ihres längsten Wortlauts (LLH-1158, LLH-1232), damit der Kopf an der Umbruchkante beim Start nicht
springt. Diese Halter kosten den Platz dauerhaft. Abgestimmt (proposal.md): Ruhezustände nur als
Symbol, Wortmarke im Einsatz erst ab `xxl`, Funktions-Etikett bleibt, Name 16 px.

Gegenwind: LLH-1725 (`wc3kzd54-uebungsmarke-rahmen`) setzt eine Übungsmarke vor den Namen und
berührt dieselben Dateien.

## Goals / Non-Goals

**Goals:**
- Der Name hat in der Namensgruppe seine volle Breite, bevor die Suche mehr als ihre Lupe bekommt.
- Die Breite der rechten Gruppe hängt nur noch an Störungen, nicht an Breite, Dichte oder Start.
- Eine Regel statt Breitenweichen: Wort genau bei Störung.

**Non-Goals:**
- Handy-Kopf einzeilig und fixiert (LLH-1728), fester Rahmen (LLH-1727).
- Benutzermenü, Uhr, Knopf „Eingänge“ und die Bündelung der Alarmzentrale bleiben, wie sie sind.
- Ebene-1-Kopf (`AppLayout`): nur das Tastenkürzel ändert sich mit (gemeinsamer Auslöser).

## Decisions

### D1 Wort genau bei Störung, ohne Breitenweiche

`AlarmZentrale` (breite Bauform): Benachrichtigung zeigt ihr Wort nur bei `blockiert`, der Ton
nur bei `stumm` oder `blockiert`. Gebündelte Bauform: das Wort nur, wenn der gezeigte Zustand
auffällig ist (bisher am Handy immer). `SyncAnzeige`: Wort nur für `getrennt`, `offline`,
`ausstehend`, `abgelehnt`; `verbunden` und `verbinde` stehen als Symbol, `verbinde` in `achtung`.
Unter `md` (`kompakt`) bleibt es beim reinen Symbol, dort trägt die Betriebszeile die Störung.

Damit entfallen `ruheOhneWort`, `haeltStartPlatz`, `tonHaeltPlatz`, `TON_WORT_LAENGSTES` als
Platzhalter, `startWoerter` im Layout und der Baustein `WortPlatz` samt `Kopfleiste.css`.

**Nachentscheid 15.11.2026 (beim Umsetzen gemessen):** Ein Startwort bleibt: Vor der ersten
Bediengeste sperrt der Browser den Ton, und nach `ALARM_TON_FRIST_MS` erscheint ohne Zutun „Ton
blockiert“. Ohne Platz sprang der Kopf in `handschuh` bei 1340/1360 px 2 s nach dem Laden von 72
auf 144 px (`kopfhoehe-tonpruefung`). Gewählt: am Glockenknopf bleibt die Breite von „Ton
blockiert“ frei, in beiden Bauformen, auch leer im Ruhezustand (`AlarmZentrale.css`). Verworfen:
vor der ersten Geste nur die durchgestrichene Glocke ohne Wort (ein unberührter Schirm nennte die
Störung nur als Zeichen) und den Sprung per Spec-Ausnahme hinnehmen. Preis: 70–95 px Leerraum am
Glockenknopf; in `handschuh` bei 1366 px wird der Kopf zweizeilig. Die
Spec `einsatztauglichkeit-layout` („Der App-Rahmen springt beim Laden nicht“) bleibt erfüllt;
ihre e2e-Messung an der Umbruchkante (`kopfzeile-start-cls.spec.ts`) läuft weiter.

*Alternative:* Wörter erst ab `xxl` zeigen. Verworfen: wieder eine Breitenweiche, und das Wort
„Ton bereit“ sagt nichts, was das Symbol nicht sagt.

*Preis:* Der Aufbau beim Start (`idle`) und „SYNC“ unterscheiden sich als Symbol nur in der Farbe
(gelb/grün), „Ton wird geprüft“ und „Ton bereit“ gar nicht. Beides ist keine Störung und dauert
Sekunden; Tooltip und Name nennen den Zustand, und die Tonprüfung endet spätestens nach
`ALARM_TON_FRIST_MS` in „Ton blockiert“. Den Wiederaufbau mitten in der Sitzung (`connecting`,
erst nach der Schonfrist, bei Netzfehlern endlos) trennt der Review vom Start: er heißt
„wiederaufbau“, trägt „VERBINDE“ als Wort und steht vor „WARTET“; beim Start steht „WARTET“ vor
dem wortlosen Aufbau.

### D2 Name vor Suche: Raster statt Wachstumsquote

Ab `lg` liegen Namensgruppe und Suchzelle in einem Behälter, der als ein Flex-Element am Umbruch
teilnimmt (Boden `min-content`). Seine Basis ist in `kompakt` die Summe der alten Basen (476 px) und
wächst mit der Steuerhöhe um deren Vierfaches über 30 px (`komfortabel` 548, `handschuh` 644).
Grund, beim Umsetzen gemessen: in `handschuh` ist die rechte Gruppe allein ≈ 580 px breit (fünf
72-px-Ziele mit Abständen, Uhr, Benutzer), bei 1180 px blieben dem Namen einzeilig 181 px. Mit der
größeren Basis bricht die rechte Gruppe dort um, und der Name steht ganz; zweizeilig war der Kopf
in `handschuh` bei dieser Breite vorher auch. Die Basis hängt bewusst nicht am geladenen Namen:
sonst bekäme der Kopf nach dem Laden eine Zeile mehr (Spec `einsatztauglichkeit-layout`). Innen ein Raster mit
zwei Spalten: `minmax(min-content, max-content)` für die Namensgruppe, `minmax(<Lupe>, 1fr)` für
die Suche. Das Raster gibt intrinsischen Spalten ihren `max-content`, bevor `fr` den Rest bekommt;
reicht es nicht, bleibt der Suche ihr Minimum, und der Name kürzt. In Chromium gegengeprüft (700 /
500 / 300 px: Name 448 / 448 / 252, Suche 252 / 52 / 48).

Dafür braucht die Namensgruppe einen echten `max-content` (ganzer Name) bei kleinem `min-content`
(fester Teil plus Trefffläche). `contain: inline-size` kann das nicht, es nimmt beides. Der
Namenstext bricht deshalb für die Messung überall (`overflow-wrap: anywhere`, `min-content` = ein
Zeichen; `white-space: normal` gegen das von antds Knopf geerbte `nowrap`, sonst lief der Kopf bei
1024 px auf 1103 px über) und zeigt sichtbar eine Zeile mit „…“ (`-webkit-line-clamp: 1`). Die Trefffläche als
Boden hält `minWidth: controlHeight` am Wechsler wie bisher. Trägt das in Chromium oder Firefox
nicht, misst die Namenszelle ihren Text einmal per `ResizeObserver` und setzt
`contain-intrinsic-inline-size` (Rückfallweg, nur bei rotem Test).

Die Suche: Mindestbreite = Trefffläche der Lupe plus Kopf-Polsterung. Die Zelle ist ein
Größen-Container (`container-type: inline-size`, Name `kopfsuche`); unter 140 px Inhalt fallen
Hinweistext und Kürzel weg (Container-Abfrage in `CommandPaletteTrigger.css`, kein JS). Die
Obergrenze 520 px bleibt.

Unter `lg` ändert sich nichts: dort gibt es keine Suchzelle, `KOPF_NAME_FLEX_SCHMAL` gilt weiter.

*Alternative:* Quoten verschieben (`12 1 …` gegen `1 8 …`). Verworfen: eine Quote verteilt immer
anteilig, sie kann „erst der Name“ nicht ausdrücken, und jeder Name hat eine andere Länge.

### D3 Name 16 px

Der Wechsler setzt den Namen in 16 px, Gewicht 500 (bisher 13). Einsatznummer (12 px Mono) und
Nebenzeilen im Menü bleiben. Die Zeilenhöhe bleibt innerhalb von `controlHeight` (30 px in
`kompakt`).

### D4 Wortmarke ab `xxl`

`EinsatzLayout` zeigt `Wortmarke` und ihren Trennstrich nur bei `abBreite('xxl')` (1600 px).
`AppLayout` bleibt. Zur Einsatzliste führt der Eintrag „Alle Einsätze …“ im Wechsler.

### D5 Kürzel nur bei feinem Zeiger

`CommandPaletteTrigger` zeigt die `Tastenkuerzel`-Marke nur, wenn `useViewport().istBeruehrung`
falsch ist. `aria-keyshortcuts` bleibt: das Kürzel wirkt mit angesteckter Tastatur. Dasselbe
Signal nutzt die Sprungpalette für ihre Tastenhinweise (Spec `sprungpalette`).

### D6 Plakette über dem Symbol

`EingaengeZahl` setzt die Plakette mittig über das Symbol (waagerecht zentriert, Unterkante knapp
über der Oberkante des Symbols, 18 px nach oben), statt links bei 55 % anzusetzen und nach rechts
in den Text zu laufen. Das Wort steht 1 px höher als das 12-px-Symbol; bei 15 px überlappten sich
Plakette und Wort am Handy noch um 2 px. Sie nimmt weiter
keine Breite. Auch „99+“ endet vor dem Abstand zwischen Symbol und Wort.

### D7 Regel

`frontend/AGENTS.md`, Abschnitt „Rahmen“: ein Spiegelstrich „Kopfleiste“ mit Rangfolge (Name vor
Suche vor Daueranzeigen), „Wort genau bei Störung“ und Verweis auf die Spec `kopfleiste`. Die
Kommentare an `SyncAnzeige`, `AlarmZentrale` und `BenutzerMenu` (Verweis auf `WortPlatz`) werden
nachgezogen.

## Risks / Trade-offs

- [Weitere Startwörter aus verzögerten Lesungen] → Review vor dem PR: „WARTET n“/„PRÜFEN“ (die
  Offline-Warteschlange wird nach dem ersten Bild gelesen) und auf Android „Benachrichtigung
  blockiert“ (der Service Worker bestätigt die Berechtigung nach dem Mount) können an der Kante
  springen. Beides ist älter als diese Change. Entscheid 15.11.2026: Spec eng auf Tonprüfung und
  Verbindungsaufbau, Folgeaufgabe LLH-1910 (Zustand vor dem ersten Bild kennen).

- [Raster und Umbruch greifen ineinander] → e2e-Spec misst Namensbreite und Zeilenzahl bei 1280
  `kompakt`, 1180 `handschuh`, 1024 `komfortabel`; `gate1-ueberlauf` bleibt grün.
- [`-webkit-line-clamp` mit Bruch an beliebiger Stelle] → Sichtbar ist eine Zeile mit „…“ wie
  bisher; der Bruch mitten im Wort betrifft nur die gekürzte Fassung. Rückfallweg in D2.
- [LLH-1725 ändert dieselben Zeilen] → Wer zuerst gemergt ist, gilt; der zweite mergt `alpha` und
  setzt die Übungsmarke in die Namensgruppe des Rasters (fester Teil).
- [e2e-Specs erwarten Wörter und `WortPlatz`] → `kopfhoehe-tonpruefung`, `kopfzeile-start-cls`,
  `kopfzeile-schmal`, `gate3-trefflaeche`, `alarmton-freischalten` und die Vitest-Fälle werden auf
  „Symbol im Ruhezustand“ umgestellt, nicht abgeschaltet.

## Migration Plan

Keine Daten, keine Speicherwerte. Rückweg ist der Revert des PRs.
