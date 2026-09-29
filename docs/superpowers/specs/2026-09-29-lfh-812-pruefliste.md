# Prüfliste Einsatztauglichkeit: Lagekarte, Auswahlmenü bei übereinanderliegenden Flächen (LFH-812)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Specs liegen in
`openspec/changes/lfh-812-lagekarte-flaechen-auswahlmenue/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/lagekarte`: Tipp/Klick auf die Kartenfläche, Auswahlmenü am Tipppunkt |
| Stand | Branch `rubeen/LFH-812`, gestapelt auf LFH-764 (`feat/lfh-764-lagekarte-griffe-klickwege`). Die Prüfliste liegt im selben Branch |
| Zielkontext | Fükw (Maus, Tastatur mit Pfeilen, Enter und Esc) und Führungs-Tablet (Finger/Handschuh, 1024 px). Mobil gilt dasselbe Menü |
| Nicht enthalten | Hervorhebung der Fläche auf der Karte beim Durchgehen des Menüs. Punktziele, Trefferzonen und Spider behalten die Rangfolge aus LFH-764 (Non-Goals in design.md) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagekarte-touch.spec.ts`, „Flächen-Auswahlmenü am Führungs-Tablet (LFH-812)“, Touch, 1024 px, Handschuh | Tipp in die Überschneidung von Zone und Abschnitt: Das Menü „Fläche wählen“ zeigt beide Flächen, jeder Eintrag ist ≥ 72 px hoch. Ein Tipp auf den Abschnitt öffnet den Abschnitts-Inspector. Esc schließt ohne Wahl, der Fokus liegt danach auf dem Canvas. Pfeil und Enter wählen den zweiten Eintrag, auch danach liegt der Fokus auf dem Canvas. Eine Kartenbewegung schließt das Menü, und der Fokus fällt nicht auf `body`. Im Messmodus öffnet ein Tipp in dieselbe Überschneidung kein Menü, und Esc beendet das Messen. Zone unter einer DWD-Warnfläche (per `page.route`): Einträge „Absperrbereich: …“ vor „Wetterwarnungen (DWD): Sturmböen“, die Wahl öffnet das Fachebenen-Detail. Ein Tipp in den Ring eines Markers über Zone UND Abschnitt öffnet den Marker-Inspector, kein Menü. Keine `pageerror` |
| Wiederholung | `--repeat-each=8 --workers=2`: 8/8 grün, nach den Review-Fixes `--repeat-each=4`: 4/4. Ein früherer Stand drückte Enter sofort nach dem Pfeil und traf in 2 von 6 Läufen den ersten Eintrag: Die Hervorhebung stand schon auf dem zweiten Eintrag, der DOM-Fokus noch nicht. Der Test wartet deshalb, bis der Fokus der Hervorhebung folgt |
| Mutationsproben | `mehrdeutig`-Zweig aus (die oberste Fläche kehrt zurück): e2e rot bei „Menü sichtbar“, 5 Vitests in `klickziel.test.ts` rot. Fokusrückgabe über `onOpenChange` aus: 1 Vitest rot (Esc). Fokusrückgabe beim Schließen von außen aus: 1 Vitest rot, dazu das e2e bei „Canvas fokussiert“ nach der Kartenbewegung. Die Sperre im exklusiven Modus (`|| !flaechenwahlRef.current`) aus: e2e rot bei „kein Menü beim Messen“. Gemessen am Endstand |
| Review-Befunde (behoben) | (1) Schloss die Karte das Menü ohne antd (Mausrad, Wischen, Beginn eines exklusiven Modus), fiel der Fokus mit dem Eintrag auf `body`, und die Tastatursteuerung der Karte war weg. Jetzt gibt das Menü den Fokus auch dann an die Karte zurück, aber nur, wenn er noch im Menü oder auf `body` steht. Belegt mit 2 Vitests und dem e2e-Schritt nach der Kartenbewegung. (2) Die Sperre im exklusiven Modus war nur an der Prop belegt. Jetzt prüft ein e2e-Schritt im Messmodus sie an der echten Karte |
| Beifund, nicht von LFH-812 | `lagekarte-touch.spec.ts` „Gefahrengebiet per Tipp zeichnen …“ bei 1024 px ist schon auf dem LFH-764-Stand `d6009821` wackelig: 4 von 6 Läufen rot, das linke Kartenüberlagerungs-Band liegt über dem Zeichenpunkt. Auf diesem Branch 1 von 3 rot, gleiches Bild |
| Vitest | `klickziel.test.ts` (Mehrdeutigkeit, Entdoppeln von Füllung und Umriss sowie Kachel-Duplikaten, eigene Flächen vor Fachebenen, Trefferzone und Punktziel schlagen mehrere Flächen), `flaechenwahl.test.ts` (Kennung, Stilböden 30/48/72), `FlaechenwahlMenue.test.tsx` (Reihenfolge, Klick, Enter, Esc, Fokus, `escGehoertOverlay`), `fachebeneTitel.test.ts`, `LagekartePage.test.tsx` („im exklusiven Modus aus“) |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 · Emoji 0 (das Wetterzeichen bleibt, wie bisher, allein im Kopf des Fachebenen-Inspectors) |

---

## Tabelle: Lagekarte, Flächen-Auswahlmenü

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Jeder Eintrag trägt `minHeight: controlHeight` (`flaechenwahlEintragStil`, Böden als Literale im Vitest). Im e2e sind die Einträge im Handschuh-Betrieb ≥ 72 px hoch gemessen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Das e2e läuft in der Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Das Menü öffnet lokal, ohne Anfrage. Die Wahl setzt die Auswahl sofort, wie ein direkter Tipp | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Das Menü wählt nur aus, es ändert nichts | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Das Menü nutzt Farben und Text des antd-`Dropdown` aus dem Theme, dasselbe Bauteil wie `StatusWahl`. Eigene Farben setzt das Menü nicht | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Die Einträge unterscheiden sich über Text (Art und Bezeichnung). Die aktive Zeile ist per Tastaturfokus erkennbar (antd) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit und damit auch auf das Portal-Menü | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Das Menü steht am Tipppunkt, also dort, wo der Blick ist | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung, kein Toast | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Das Menü öffnet nur nach einem eigenen Tipp, nie durch ein Live-Ereignis. Bewegt sich die Karte, schließt es, statt am alten Pixelpunkt stehen zu bleiben (e2e) | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | `autoFocus` legt den Fokus ins Menü, jeder Weg hinaus gibt ihn an den Canvas zurück (e2e, Vitest). Esc bei offenem Menü verwirft keine Zeichnung: `escGehoertOverlay` erkennt das Menü, und im exklusiven Modus öffnet es gar nicht | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Maske | — |

**Bilanz:** 11 erfüllt · 0 offen · 4 nicht anwendbar.
