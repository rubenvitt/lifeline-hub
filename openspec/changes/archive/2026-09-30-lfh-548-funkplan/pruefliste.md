# Prüfliste Einsatztauglichkeit: Funkplan S6 (LFH-548)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Specs liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab/funkplan` (neu). Dazu der Einstieg „Funkplan“ in der S6-Zeile von `/einsaetze/:id/stab` und die Übernahme im Meldebild (`/einsaetze/:id/kraefteuebersicht`, jetzt ein Aufruf) |
| Stand | Branch `claude/brave-ride-ti7xc2`, PR gegen `alpha` |
| Zielkontext | Fükw (primär: Lesen, Drucken, Aushang im ELW), Führungs-Tablet (Lesen). Mobil: nur Lesen, Tabelle mit fixierter Kennung |
| Nicht enthalten | Die eigene Gegenstelle (Führungsstelle/ELW) als Zeile: kein Feld am Einsatz, [LFH-849](https://app.clickup.com/t/123zgec5xhy). Bearbeiten: am Abschnitt und an der Einheit, nicht hier |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Messung vor dem Bau (`e2e/funkplan-breite.spec.ts`, aufgegangen in `e2e/funkplan.spec.ts`) | Die Contentbreite beträgt 1050 px bei 1366 × 768 mit offenem Panel, das Zellpolster 22 px. Laufweiten langer Werte stehen in design.md D4. Daraus folgen die Spaltenbreiten, Σ 1020 px |
| `e2e/funkplan.spec.ts`, Fükw | Am Fükw kein waagerechter Überhang der Tabelle, auch mit der Erreichbarkeit. Die Lücken stehen im ersten Bild (`toBeInViewport`) und nennen ihre Zahlen und Treffer, dazu der Hinweis „nicht erfasst“ |
| `e2e/funkplan.spec.ts`, 390 px | Tabelle, keine Karten. Genau eine fixierte Kopfzelle „Stelle“ mit `position: sticky` |
| `e2e/funkplan.spec.ts`, Druck bei 680 px (A4) | Ein zugeklappter Knoten ist nach dem Druckknopf offen. Die Erreichbarkeit steht im Druck, obwohl das Fenster unter `xl` liegt. Kein Überhang, die letzte Spalte liegt in der Druckwurzel, die Werkzeugzeile ist ausgeblendet |
| `e2e/funkplan.spec.ts`, Übernahme | Genau `POST …/lageberichte`, kein PATCH. Danach ist der Bericht offen und enthält keine Erreichbarkeit |
| `e2e/funkplan.spec.ts`, Zeilenlink | Die Kennung einer Einheit führt auf `/einheiten/:id` |
| `e2e/gate1-ueberlauf.spec.ts` | Die Route `stab/funkplan` ist aufgenommen: bei 1366, 1024, 768 und 390 px ohne Seitenüberlauf, als Admin und als Beobachter (Vorbedingung: keine Übernahme). 25/25 grün |
| `e2e/gate3-trefflaeche.spec.ts` | Neu: „Funkplan“ und „Funkplan (Beobachter)“. Titel-Links der Tabelle, Lücken-Verweise, Übernahme und Drucken halten 30/48/72 px. Die Stab-Tests zählen jetzt 15 Werkzeug-Links (mit „Funkplan“) |
| `e2e/meldebild-tabelle.spec.ts`, `druck-fluss.spec.ts`, `etb-druck.spec.ts`, `kraefte-schmal.spec.ts` | Nach dem Umzug der Druck-Neutralisierer nach `druck.css` grün |
| Mutationsproben | (1) Die Erreichbarkeit trägt `abBreite: 'xl'` auch im Druck: Das e2e zum Druckpfad wird rot. (2) `druck.css` ohne Umbruchregel für Zellen: 67 px Überhang, rot. Ohne die Messzeilen-Regel: 80 px, rot. (3) Backend: Startinhalt ignoriert → 2 Rust-Tests rot. Schlüsselprüfung beim Anlegen entfernt → 2 rot. (4) `form="auto"` statt `"tabelle"` → `datensicht.guard.test.ts` rot |
| Befund beim Bau | Der echte Druckweg (`beforeprint`, ohne `sticky`) ließ jede Baumtabelle mit Zahlbreiten über A4 hinausragen. Behoben in `druck.css` (design.md D8, Nachtrag). Das Meldebild-e2e prüft nur `emulateMedia` und hatte es deshalb nicht gesehen |
| Vitest | `stab/funkplan.test.ts`, `stab/luecken.test.ts`, `components/kommunikationsmittel.test.ts`, `api/abrufZustand.test.ts`, `pages/FunkplanPage.test.tsx` (13), `pages/StabPage.test.tsx` (Einstieg), `components/Datensicht.test.tsx` (Anker-Riegel im Baum), `druck/druck.test.ts`, `pages/funkplanPrint.test.ts`, `pages/KraefteuebersichtPage.test.tsx` (ein Aufruf, Fehler an der Seite) |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `useRollen`) · `animation`/`blink` 0 · `size=` 0 · Emoji 0 |

---

## Tabelle: Funkplan

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Titel-Links (`minHeight: controlHeight` im Primitiv), Lücken-Verweise (`stabZeilenzielStil`) und Knöpfe halten 30/48/72 px, gemessen in Gate 3, auch als Beobachter | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Die Übernahme zeigt `loading` am Knopf, ein Fehler steht an der Seite (`SpeicherFehler`). Die Tabelle selbst ändert nichts | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Nichts wird gelöscht oder überschrieben. Die Übernahme legt einen Entwurf an, der bearbeitbar und löschbar bleibt | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Sekundärtext in `rollen.gedaempft` (Tag 7,05 : 1, Nacht darüber), Mono aus `monoStil`, sonst Theme-Farben der Tabelle. Keine eigene Farbe | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Lücken als Zahl plus Wort. Fehlende Quelle als „—“ plus Grund („nicht freigegeben“, „nicht geladen“) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe. Gedämpft heißt nur „leer/Nebentext“ | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die Lücken stehen im ersten Bild am Fükw mit offenem Panel (e2e `toBeInViewport`) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung. Die Übernahme navigiert bei Erfolg, statt einen Toast zu zeigen | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | `Datensicht` mit Vorgabe `zufluss="sammelbanner"`: Neue Wurzelzeilen erscheinen als Banner, solange der Fokus in der Sicht liegt. Unterzeilen wachsen im offenen Knoten wie im Meldebild | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste auf der Seite. Die stehende Kopfzeile hält Freiraum (`setzeKopfFreiraum` im Primitiv) | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | Tabelle, weil verglichen wird (`NUR_TABELLE`). Stehende Kopfzeile, fixierte menschenlesbare Kennung „Stelle“ (nie eine DB-`id`), Spaltenschalter mit Zähler (Erreichbarkeit unter `xl`). Auf 390 px angepasst, nicht in Karten aufgelöst (e2e) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Schreibgeschützt. Die Zuordnung geschieht am Abschnitt bzw. an der Einheit (`SprechgruppenPicker`), die Zeilen führen dorthin | — |

**Bilanz:** 11 erfüllt · 0 offen · 4 nicht anwendbar.
