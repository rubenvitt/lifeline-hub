# Prüfliste Einsatztauglichkeit: Einsatzbericht (LFH-726)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung und Specs liegen
daneben (`proposal.md`, `design.md`, `specs/`). Die Liste liegt in der Change, weil
`docs/superpowers/` eingefrorenes Archiv ist.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/einsatzdaten/bericht` (neu, Druckansicht). Umgebaut: Seitenkopf der Einsatzdaten (`/einsatzdaten`, sekundärer Link „Einsatzbericht drucken“), Sprungpalette (Eintrag „Einsatzbericht drucken“) |
| Stand | Branch `claude/inspiring-cerf-wdc4v4` gegen `alpha` |
| Zielkontext | Fükw und ortsfeste Stelle (Nachbereitung, Druck). Führungs-Tablet und mobil: Lesen; gedruckt wird dort selten |
| Nicht enthalten | Blöcke an- und abwählen, Personal je Kopf: [Einsatzbericht: Blöcke beim Drucken an- und abwählen](https://app.clickup.com/t/123zgec6850). Firefox und Safari automatisch: LFH-729 (Bestand aus LFH-22) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/einsatzbericht-druck.spec.ts` | 2/2 grün. (1) Als Admin: Einstieg über die Einsatzdaten, sieben Blöcke in Reihenfolge, „nicht genutzt“ für die ausgeblendete Betreuung, SK II = 1, Name und Vorname der gesäten Person nicht auf dem Blatt, Vorläufig-Vermerk im Kopf; bei 390 px ragt nichts aus der Wurzel; Druckbild mit ausgelöstem `beforeprint`: Wurzel `static` und oben, Kopfleiste, Rail und Seitenkopf `display: none`, `thead` als `table-header-group`, nichts ragt rechts heraus. (2) Als Beobachter: alle zehn Module des Berichts im Einsatz ausgeblendet → druckbar, ohne „kein Zugriff“; Rollensperre auf Personen → Sackgasse, kein Druckknopf, keine Druckwurzel |
| `e2e/etb-druck.spec.ts`, `druck-fluss.spec.ts`, `einsatzdaten-inline.spec.ts` | 15/15 grün nach dem Umbau des Seitenkopfs der Einsatzdaten |
| Vitest | Neu: `druck/einsatzbericht/quellen.test.ts` (9), `abruf.test.ts` (8), `verdichtung.test.ts` (23), `pages/EinsatzberichtDruckPage.test.tsx` (10). Ergänzt: `queryKeys.test.ts`, `deeplinks.test.ts`, `modulRegistry.test.ts`, `befehle.test.ts`, `EinsatzdatenPage.test.tsx` |
| Mutationsproben | (1) Sichtbarkeitsprüfung in `berichtFreigabe` entfernt → 2 Tests rot. (2) Registriernummer in die Personen-Bilanz → Personenbezugstest rot. (3) Druckkopf aus dem Live-Einsatz statt aus dem Schnappschuss → Schnappschuss-Test rot. (4) Betreuung auf den Modul-Key `tiere` → e2e-Beobachterfall rot (403 statt Vermerk). (5) Titelspalte ohne Umbruch → 390-px-Messung rot (der Befund, der zur Regel `NUR_ZAHL_ODER_ZEIT` führte) |
| Review | Ein unabhängiges Review fand: Aufbewahrungsfrist nur scheinbar behandelt (der Server sperrt schon den Einsatzkopf), fehlender Schnappschuss-Test, Kopf aus dem Live-Stand, e2e nur als Admin. Alle behoben in `23240f2` |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `theme.useToken`) · `animation`/`blink` 0 · `size=` 0 · Emoji 0 · `window.print` 0 |

---

## Tabelle: Druckansicht Einsatzbericht (und Einstieg auf den Einsatzdaten)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Alle Bedienziele sind antd-`Button` mit Steuerhöhe der Dichte-Staffel („Zurück zu den Einsatzdaten“, „Neu laden“, `DruckKnopf`, „Einsatzbericht drucken“ auf den Einsatzdaten). Der Blattinhalt hat keine Bedienziele | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Kein punktuelles `size` (`dichte.guard.test.ts` grün); die Knöpfe folgen dem Dichte-Token | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | „Einsatzbericht wird geladen …“ als `role="status"`, Drucken bis dahin gesperrt; ein Fehler steht an der Seite mit Modulnamen und „Erneut laden“ (`EinsatzberichtDruckPage.test.tsx`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite ändert nichts; Drucken öffnet den Druckdialog des Browsers, der selbst eine Bestätigung ist | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Text in `colorText`, Etiketten in `colorTextSecondary` (Rollen über die Tokens, LFH-652). Auf Papier gilt „Papier ist hell“ aus `druck.css` | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jeder Zustand steht als Wort: „Vorläufig – Einsatz läuft“, „In diesem Einsatz nicht genutzt“, „keine Einträge“, „keine Zeitachse erfasst“, „berichtigt durch Nr. m“. Das Blatt nutzt keine Statusfarbe | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit und nur `@media screen`, also nicht auf dem Ausdruck | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Vorläufig-Vermerk steht im Druckkopf ganz oben auf Bildschirm und Blatt; eine Sperre oder ein Fehler ersetzt den Bericht, statt unter ihm zu stehen | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Keine Meldung, kein Toast, kein Ton | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Schnappschuss: Live-Ereignisse ändern den geöffneten Bericht nicht, erst „Neu laden“ (Seitentest mit Invalidierung) | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste auf der Seite | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Die Tabellen (Lagebesprechungen, Verzeichnis der Lageberichte, Entscheidungen) sind Vordruck auf Papier wie der ETB-Druck (benannte Ausnahme in `etb/EtbDruckTabelle.tsx`): kein Vergleich am Schirm, keine Sortierung, kein Filter. Bei 390 px ragt nichts heraus (e2e) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Es gibt keine Erfassung | — |

**Bilanz:** 12 erfüllt · 0 offen · 3 nicht anwendbar.

## Hinweis zum Datenschutz

Der Bericht trägt Betroffene und Schäden nur als Zählung (Spec „Keine personenbezogenen Daten
Betroffener“, Test und e2e). Freitext — Lageberichte, ETB-Entscheidungen, Sachverhalt — steht, wie
ihn die Führung geschrieben hat. Enthält er Namen, stehen sie auch im Bericht; das gilt ebenso für
den Lagebericht- und den ETB-Druck (design.md, Risiken).

## Browser

Chromium automatisch (e2e). Firefox und Safari: Handprüfung der Druckvorschau steht wie für alle
Druckstücke aus LFH-22 unter LFH-729 aus; die Druckmechanik (`druck.css`) ist unverändert.
