# Prüfliste Einsatztauglichkeit: Organigramm der Führungsorganisation (LFH-626)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Specs liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/einsatzabschnitte`, Ansicht „Organigramm“ (Umschalter im Seitenkopf, Sichtvorgabe `?ansicht=organigramm`). Die Ansicht „Gliederung“ bleibt unverändert |
| Stand | Branch `claude/vigilant-cannon-6feaqw`, PR gegen `alpha` |
| Zielkontext | Fükw (primär: Lesen, Drucken, Aushang im ELW, Übernahme in den Lagebericht), Führungs-Tablet (Lesen). Mobil: nur Lesen, eine Spalte |
| Nicht enthalten | Die Kommunikationsebene ([LFH-625](https://app.clickup.com/t/123zgec4863)). Die eigene Führungsstelle als Datum ([LFH-849](https://app.clickup.com/t/123zgec5xhy)): Die Wurzel sagt „Leitung nicht erfasst“. Bearbeiten: am Abschnitt und an der Einheit, nicht hier |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Messung vor dem Bau (`e2e/fuehrungsorganisation.spec.ts`, erster Test) | Die Contentbreite beträgt 1050 px bei 1366 × 768 mit offenem Panel. Laufweiten langer Werte stehen in design.md D3 (Nachtrag). Daraus folgt `SPALTE_MIN_PX = 300`, also drei Spalten am Fükw |
| `e2e/fuehrungsorganisation.spec.ts`, Fükw | Acht oberste Abschnitte mit je drei Einheiten: drei Spalten, mehrere Zeilen. Weder Seite noch Organigramm laufen über, und kein Knoten ragt über den Rand. Die Einsatzleitung trägt „Leitung nicht erfasst“ und keine Zahl |
| `e2e/fuehrungsorganisation.spec.ts`, 1024 · 768 · 390 px | Ohne waagerechten Überhang von Seite, Organigramm und Knoten |
| `e2e/fuehrungsorganisation.spec.ts`, Druck bei 680 px (A4) | Der zugeklappte Abschnitt ist nach dem Druckknopf offen (ausgelöstes `beforeprint`). Zwei Spalten, kein Knoten über der Druckwurzel. Werkzeugzeile, Umschalter und Klappziele sind aus, der Druckkopf nennt „Führungsorganisation“ |
| `e2e/fuehrungsorganisation.spec.ts`, Live | Ein per API umgehängter Unterabschnitt steht ohne Neuladen unter dem neuen Abschnitt und nicht mehr unter dem alten |
| `e2e/fuehrungsorganisation.spec.ts`, Übernahme | Genau `POST …/lageberichte`, kein PATCH. Danach ist der Bericht offen |
| `e2e/gate1-ueberlauf.spec.ts` | Die Route `einsatzabschnitte?ansicht=organigramm` ist aufgenommen: bei 1366, 1024, 768 und 390 px ohne Seitenüberlauf, als Admin und als Beobachter (Vorbedingung: keine Übernahme). 25/25 grün |
| `e2e/gate3-trefflaeche.spec.ts` | Neu: „Organigramm“ und „Organigramm (Beobachter)“. Namenslinks, Klappziele, „Alle aufklappen“, Drucken und Übernahme halten 30/48/72 px |
| Mutationsproben | (1) `SPALTE_MIN_PX` auf 600: am Fükw nur eine Spalte je Zeile, das e2e wird rot. (2) `organigrammPrint.css` ohne Ausblenden der Klappziele: Druckpfad rot. (3) Namenslinks ohne `organigrammZielStil`: Gate 3 rot (15 px statt ≥ 30). (4) Stärke über `eigene` statt `inklUnter`: Vitest rot. (5) Ohne Untereinheiten-Platzierung: 2 Vitest rot. (6) Stabsstelle trotz Sperre: 2 rot. (7) „Leitung nicht besetzt“ fehlt: 1 rot. (8) Ohne Wechsel in die Gliederung beim Abschnittslink: 1 rot. (9) Unbrauchbare Sichtvorgabe nicht geräumt: 1 rot. (10) Markdown ohne `md()`: 1 rot. (11) Druckknopf ohne Aufklappen: 1 rot. (12) Übernahme ohne Ladesperre: 2 rot |
| Befund beim Bau | Bei A4 (680 px) ergibt `auto-fill` mit 300 px ohnehin zwei Spalten. Die feste Druckregel sichert nur gegen eine spätere Änderung ab (design.md D6). Die Namenslinks hielten als bloßes `<a>` die Staffel nicht. Behoben über `organigrammZielStil` (design.md D3, Nachtrag) |
| Vitest | `pages/einsatzabschnitte/fuehrungsorganisation.test.ts` (Knotenmodell, Stärke-Gleichheit mit dem Gliederungsbaum, gleiche Platzierung wie der Funkplan, Markdown), `pages/einsatzabschnitte/Organigramm.test.tsx` (Darstellung, Klappen, Stabsstelle, Übernahme, Druck, Trefffläche), `pages/einsatzabschnitte/organigrammPrint.test.ts`, `pages/EinsatzabschnittePage.test.tsx` (Umschalter, Sichtvorgabe, Deeplink, fehlende Einheiten), `routing/deeplinks.test.ts` |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `useRollen`) · `animation`/`blink` 0 · antd-`size=` 0 (das eine `size=` ist die Kantenlänge des Zeichens) · Emoji 0 |

---

## Tabelle: Organigramm

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Namenslinks (`organigrammZielStil`, `minHeight: controlHeight`), Klappziele und Werkzeugknöpfe halten 30/48/72 px. Gemessen in Gate 3, auch als Beobachter | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Gate 3 misst die Stufe Handschuh. Der Einzug je Ebene hängt nicht an der Knopfhöhe | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Die Übernahme zeigt `loading` am Knopf, ein Fehler steht an der Seite (`SpeicherFehler`). Klappen wirkt sofort und lokal | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Nichts wird gelöscht oder überschrieben. Die Übernahme legt einen Entwurf an, der bearbeitbar und löschbar bleibt | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nebentext in `rollen.gedaempft`, „Leitung nicht besetzt“ in `rollen.achtungText` (auf Weiß 9,22 : 1), Namen in `rollen.bedienText`, Rahmen in `linieStark`. Keine eigene Farbe. Im Druck dunkel auf hell (`druck.css`) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „Leitung nicht besetzt“, „kein Rufname“, „Leitung nicht erfasst“ und „Einheiten: nicht geladen“ stehen als Wort. Eine fehlende Stärke steht als „—“, nie als 0. Der Klappzustand steht in `aria-expanded` und als Pfeilrichtung | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Achtung nur für die unbesetzte Leitung (wie der Führungspunkt im Gliederungsbaum), Blau nur für Bedienziele. Die Struktur selbst ist farblos | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** [abgeleitet] | Die einzige Warnung („Einheiten: nicht geladen“) steht über dem Organigramm unter der Werkzeugzeile, im ersten Bild | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung. Die Übernahme navigiert bei Erfolg, statt einen Toast zu zeigen | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Live hinzukommende oder umgehängte Knoten verschieben die Knoten dahinter sofort. Es gibt keinen Sammelbanner wie in `Datensicht` (`zufluss="sammelbanner"`). Das Organigramm ist eine Lese- und Druckansicht, und das einzige Bedienziel je Knoten ist ein Link. Ein Fehlgriff führt deshalb nur auf eine falsche Seite und ändert nichts. Trotzdem offen | [LFH-867](https://app.clickup.com/t/123zgec64ta) |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste in der Ansicht | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Das Organigramm beantwortet „wie ist geführt?“, nicht „welcher von diesen?“. Verglichen wird im Funkplan bzw. im Meldebild | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Schreibgeschützt. Bearbeitet wird in der Gliederung bzw. an der Einheit, die Namen führen dorthin | — |

**Bilanz:** 10 erfüllt · 1 offen ([LFH-867](https://app.clickup.com/t/123zgec64ta)) · 4 nicht anwendbar.
