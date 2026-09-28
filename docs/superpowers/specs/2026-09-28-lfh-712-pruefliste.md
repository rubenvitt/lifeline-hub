# Prüfliste Einsatztauglichkeit — Lagekarte: Zeichnen korrigierbar und Eigenposition (LFH-712)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Specs liegen in
`openspec/changes/lfh-712-lagekarte-zeichnen-korrigierbar/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/lagekarte`: Zeichnen-Steuerung (Zone, Abschnitt) im Kartenfuß, Knopfblock oben rechts |
| Stand | Branch `feat/lfh-712-lagekarte-zeichnen-korrigierbar` nach den Review-Fixes; die Prüfliste steht im selben Commit |
| Zielkontext | Fükw (Zeichnen mit Maus und Tastatur, Esc), Führungs-Tablet (Zurück-Knopf mit Finger/Handschuh, Eigenposition), mobil nur lesend mit Eigenposition |
| Nicht enthalten | Redo, Strg/⌘+Z, Undo nach dem Abschluss, Undo beim Messen; Eigenposition auf der Betroffenen-Karte; Folgen der Karte (Non-Goals in design.md) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagekarte-zeichnen-korrigierbar.spec.ts` „Zeichnen: Punkt zurück …" | 3 Punkte → „Letzten Punkt zurück" → „2 Punkte", „Abschließen" gesperrt; neuer dritter Punkt, speichern: der POST trägt eine Fläche mit **drei** Ecken (4 Ringpunkte). Esc mit Fokus auf dem Zurück-Knopf → „0 Punkte", Quittung, Steuerung offen; Esc mit Fokus auf der Karte → wieder genau eine Stufe; zweites Esc → Steuerung weg. Keine `pageerror` |
| derselbe Spec „Eigenposition …" | Playwright-Standort + Freigabe: Knopf gedrückt, Quelle `eigenposition` auf der Karte, Kartenmitte auf dem Standort; nach Grundlagenwechsel (`setStyle`) wieder da; keine Anfrage und kein `localStorage`-Eintrag trägt die Koordinaten |
| Mutationsproben | e2e: `undoRedo.modeLevel` entfernt → „2 Punkte" rot (3 bleiben). Vitest: je Konstruktor-Option (Undo, `cancel: null`) ein Test rot; Esc-Zuhörer ausgeschaltet → 3 Seitentests rot; Eingabefeld-Riegel entfernt → 1 rot. **Gemessen und im Design nachgetragen:** `cancel: 'Escape'` zurück → e2e bleibt grün, weil der `keydown`-Zuhörer der Seite vor terra-draws `keyup` verwirft; die Option ist Besitzregel, nicht Voraussetzung |
| Review-Befunde (behoben) | (1) Esc bei offenem antd-Menü/-Dialog verwarf die Figur — antd schließt per eigenem `window`-keydown ohne `preventDefault`; jetzt Riegel `escGehoertOverlay`, auch für das Messen, Seitentest „Esc bei offenem Menü …" (vor dem Fix rot). (2) Die Sperre der Eigenposition war nur für Vorlesende sichtbar — Inline-Stil schlug die CSS-Regel. Beim Nachziehen von `alpha` mit LFH-715 zusammengeführt: EIN Sperrmechanismus am `Kartenknopf` (`sperrGrund`; Farbe/Zeiger aus `.lfh-kartenknopf[aria-disabled]`, gesperrt ohne Inline-Farbe), dazu aus LFH-712 der Grund als Popover beim Antippen und `aria-describedby` — gilt damit auch für den Leisten-Umschalter. (3) Der Punktzähler zählte DOM-Klicks an terra-draw vorbei (Mikro-Ziehen am Tablet → „1 Punkt" ohne Figur); jetzt aus terra-draws `history`, e2e an der echten Karte grün. Dazu: gehaltene Esc-Taste (`repeat`), Esc während des Abschnitt-Speicherns |
| `e2e/fokus-verdeckung.spec.ts`, `gate3-trefflaeche.spec.ts`, `gate1-ueberlauf.spec.ts`, `lagekarte-smoke.spec.ts` mit dem sechsten Kartenknopf | 60/60 grün mit zwei Workern. Ein erster Lauf mit voller Parallelität bei Lastmittel 65 hatte seitenübergreifende Zeitüberschreitungen, auch auf nicht berührten Seiten; einzeln und wiederholt grün |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale nur `#000`/`#fff` als Kontur der Eigenposition (Präzedenz Personen-Marker, LFH-650, im Dateikopf begründet) · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 |

---

## Tabelle — Lagekarte

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | „Letzten Punkt zurück" ist ein antd-`Button` und erbt `controlHeight`. Der Eigenpositions-Knopf ist ein `Kartenknopf` mit `kartenKnopfKante` (≥ `controlHeight`), gemessen von `gate3-trefflaeche.spec.ts` „Lagekarte (LFH-373): … Kartenknöpfe" (grün mit dem neuen Knopf) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (Grep, `dichte.guard.test.ts` grün); die Knopfreihe der Steuerung bricht um (`Space wrap`) statt das 320-px-Band zu sprengen; `fokus-verdeckung.spec.ts` bei 390 px im Handschuh-Betrieb grün | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Punktzähler und Freigabe folgen jedem Klick sofort (lokaler Zustand, kein Request); Verwerfen quittiert „Zeichnung verworfen"; der Eigenpositions-Knopf ist sofort gedrückt, Fehler melden sich per Toast und schalten aus | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Zurücknehmen und Verwerfen löschen nur ungespeicherte Punkte, nichts auf dem Server. Esc ist zweistufig: der Modus endet erst beim zweiten Esc ohne Figur. Gespeichertes verwirft Esc nie (Serie wirkt wie „Fertig") | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Neuer Text in Bestandsbausteinen (`Typography.Text`, Popover, `message`). Der Punkt trägt Weiß plus Schwarz als Kontur, die gegen jeden Grund hält (≥ 4,58 : 1, Herleitung LFH-650). Der Kreis ist Deko mit 12 % Deckung plus Rand in `bedien` | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Eigenposition: `aria-pressed` plus Innenkante und Farbe (drei Kanäle, Bestand „Messen"); gesperrt: `aria-disabled`, Zeiger `not-allowed`, blasse Farbe und Grund als Text beim Antippen; Zeichenstand als Zahl „n Punkte" | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Eigenposition in `bedien`: eine aktive Beziehung des Geräts, kein Zustand; Rot kommt nicht vor | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Esc-Vertrag steht in der Steuerung selbst (eine Stelle), der Sperrgrund der Eigenposition am Knopf | — |
| 10 | **Alarmbudget** | **erfüllt** | Die Quittung erscheint nur nach einer eigenen Esc-Taste, nie nach einem Live-Ereignis (Regel „handlungsfähiger Toast ist keine Alarmmeldung") | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Karte fliegt nur beim ersten Standort nach dem Einschalten an, danach folgt sie nicht (`useEigenposition.test.ts`, Seitentest „erster Standort fliegt an, ein weiterer verschiebt die Karte nicht"). Offen und benannt: kommt der erste Standort spät (bis 15 s), fliegt die Karte trotzdem an, mit festem Zoom | LFH-766 |
| 13 | **Fokus nie verdeckt** | **erfüllt** | `fokus-verdeckung.spec.ts` grün mit dem sechsten Knopf (Fuß endet vor der Knopfspalte, LFH-373) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Zeichnen ist Kartenklick, keine Maske | — |

**Bilanz:** 12 erfüllt (Nr. 12 mit benanntem Nachzug LFH-766) · 1 offen · 2 nicht anwendbar.
