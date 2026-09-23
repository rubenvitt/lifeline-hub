# Prüfliste Einsatztauglichkeit — Sprungpalette: neuer Tab und Vorschau (LFH-645)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7).
Umgebaut ist keine Seite, sondern die Sprungpalette (Strg/⌘+K). Sie hat zwei neue Wege:
**Strg/⌘+↵** und Strg/⌘+Klick öffnen das Ziel in einem neuen Browser-Tab, **→** zeigt eine
Lese-Vorschau in der Palette. Die Vorschau gibt es vorerst nur für Personen.

| Angabe | Wert |
| --- | --- |
| Fläche | `frontend/src/command-palette/CommandPalette.tsx` (Trefferliste, Vorschau-Region, Fußzeile), `personen/PersonVorschau.tsx` (Inhalt, geteilt mit `PersonDetailDrawer`) |
| Stand | Branch `feat/lfh-645-palette-vorschau-neuer-tab`, Basis `origin/alpha` |
| Zielkontext | Fükw (Tastatur + Maus) primär. Tablet und mobil erreichen die Vorschau noch nicht, dafür gibt es kein Tippziel (LFH-665) |
| Nicht enthalten | Vorschau für andere Datensatzsorten (LFH-664) |

**Verdikte:** erfüllt (mit Beleg) · offen → Zielticket · nicht anwendbar (mit Begründung).
Gerechnetes und aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| e2e `palette-oeffnung.spec.ts` (5 Fälle) | Strg+↵ auf Person: kalt geladener neuer Tab zeigt die Detailseite angemeldet, der alte Tab behält seine URL. Strg/⌘+Klick auf das Modul „Lagekarte“ und der Koordinatensprung landen im neuen Tab auf der Lagekarte. → öffnet die Personenvorschau, Esc geht eine Ebene zurück (Zeile markiert und `toBeInViewport`), ein zweites Esc schließt. „Zurück“ misst in allen drei Stufen mindestens 30/48/72 px |
| Vitest `CommandPalette.oeffnung.test.tsx`, `CommandPaletteProvider.oeffnung.test.tsx` | Szenarien aus `openspec/changes/lfh-645-palette-vorschau-neuer-tab/specs/sprungpalette/spec.md`, jeweils als Paar |
| Guards `befehle.test.ts`, `datensaetze.test.ts`, `koordinatenSprung.test.ts`, `useBefehle.test.tsx` | Jede Zeile mit Ziel reicht `'neuerTab'` bis `navigate` durch, auch an der Verdrahtung im Hook |
| Mutationsproben (zurückgenommen) | `sprungZu` ohne Durchreichen: 4 Guards rot. Esc ohne `preventDefault`: Palette- und Provider-Test rot. → ohne Textende-Prüfung: Cursor-Test rot. Strg+↵ ohne Abfangen: Provider-Test **grün**. Der Riegel ist dort der Dispatcher, das ist in `design.md` korrigiert |

## Kriterien

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** | Einziges neues Bedienziel ist „Zurück“ (antd-`Button`). Gemessen statt angenommen: mindestens 30/48/72 px in kompakt/komfortabel/handschuh (e2e). Die Zeilen tragen weiter `palettenZeilenStil` (`zeilenStil.test.ts`, unverändert). Die →-Marke ist Satz (`aria-hidden`), kein Ziel | — |
| 2 | Handschuh-Modus | **offen** | „Zurück“ erreicht in handschuh gemessen 72 px. Den Weg **in** die Vorschau gibt es auf Touch aber nicht, nur per → | LFH-665 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | Die Vorschau erscheint sofort und zeigt bis zur Antwort einen Ladezustand, im Fehlerfall `SeitenFehler` mit Wiederholen (`PersonVorschau.test.tsx`, „nennt einen Ladefehler, statt leer zu bleiben“). Beim neuen Tab schließt die Palette im selben Tastendruck, der neue Tab meldet sich selbst | — |
| 4 | Kritische Aktion mit zweiter Handlung | **nicht anwendbar** | Beide Wege öffnen oder lesen nur, keiner verändert einen Datensatz | — |
| 5 | Kontrast in beiden Modi | **offen** | Die neuen Fußhinweise nehmen dieselbe Rolle `farben.schwach` wie die bestehenden Hinweise [abgeleitet]. Diese Stufe liegt am Tag unter 7 : 1. Der Vorschauinhalt ist der unveränderte Drawer-Inhalt | LFH-643 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Die Vorschau zeigt Status und Sichtung über `StatusTag`/`SichtungsTag` mit Beschriftung (`PersonVorschau.test.tsx`: „SK: “). Die →-Marke ist ein Zeichen, keine Farbe | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt [abgeleitet]** | Keine neuen Farbliterale. Rot kommt nicht vor, die Bedienfarbe nur am vorhandenen Palettenrahmen und der Ikone der aktiven Zeile | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | App-weite Lücke | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** | Ein Ladefehler der Vorschau steht an ihrer Stelle in der Palette, nicht in einem verschwindenden Toast (`PersonVorschau.test.tsx`) | — |
| 10 | Alarmbudget | **erfüllt [abgeleitet]** | Kein Toast, keine Meldung aus Live-Ereignissen | — |
| 11 | Warnverhalten | **erfüllt [abgeleitet]** | Keine Animation, kein Ton | — |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Die Fußzeile steht statisch, ein je Zeile wechselnder Hinweis hätte ihre Zeilenzahl geändert (`design.md`, Entscheidung 6). Die Vorschau hält den gezeigten Befehl als Objekt, nachrückende Treffer verdrängen ihn nicht. Der Rückweg behält Begriff und Markierung und scrollt die Zeile in den Blick (Vitest und e2e) | — |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Der Fokus bleibt im Suchfeld bzw. auf „Zurück“, beide liegen im Modal ganz oben. Die Vorschau scrollt innerhalb desselben Deckels wie die Liste. Ein Tab-Durchlauf ist nicht gemessen | — |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Keine Tabelle | — |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung | — |

**Bilanz:** 9 erfüllt (davon 4 [abgeleitet]) · 3 offen (LFH-665, LFH-643, LFH-397) · 3 nicht anwendbar.
