# Prüfliste Einsatztauglichkeit: Fernmeldeskizze (LFH-625)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Specs liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab/funkplan`, Darstellung „Skizze“ (Umschalter „Tabelle \| Skizze“ im Seitenkopf, Sichtvorgabe `?ansicht=skizze`). Die Darstellung „Tabelle“ bleibt bis auf die neue Lückenzeile unverändert |
| Stand | Branch `claude/funny-galileo-wt2xzx`, PR gegen `alpha` |
| Zielkontext | Fükw (primär: Lesen, Drucken, Aushang im ELW, Lücken finden), Führungs-Tablet (Lesen). Mobil: nur Lesen, eine Spalte |
| Nicht enthalten | Die eigene Führungsstelle als Datum ([LFH-849](https://app.clickup.com/t/123zgec5xhy)): Die Wurzel sagt „Gegenstelle nicht erfasst“, die Kanten der ersten Ebene urteilen nicht. Fahrzeuge als Knoten (Tabelle). Richtung einer Sprechgruppe (design.md, Non-Goals). Bearbeiten: am Abschnitt und an der Einheit |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Messung vor dem Bau (`e2e/funkplan.spec.ts`, „Skizze am Fükw“) | MESSWERTE |
| `e2e/funkplan.spec.ts`, Skizze am Fükw | Acht Abschnitte mit je drei Einheiten: mehrere Spalten in mehreren Zeilen, weder Seite noch Skizze noch Knoten laufen über. Kante `⇄ TMO … · DMO 505` und „keine gemeinsame Sprechgruppe“ stehen am Knoten, die Wurzel nennt „Gegenstelle nicht erfasst“. Lücken-Paneel samt neuer Zeile im ersten Bild, Zahl 1 mit Verweis auf die Einheit |
| `e2e/funkplan.spec.ts`, Skizze bei 1024 · 768 · 390 px | Ohne waagerechten Überhang von Seite, Skizze und Knoten |
| `e2e/funkplan.spec.ts`, Skizze im Druck bei 680 px (A4) | Der zugeklappte Abschnitt ist nach dem Druckknopf offen (ausgelöstes `beforeprint`). Zwei Spalten, kein Knoten über der Druckwurzel. Werkzeugzeile, Umschalter und Klappziele sind aus, der Druckkopf nennt „Fernmeldeskizze“ |
| `e2e/funkplan.spec.ts`, Skizze live | Eine per API zugeordnete Sprechgruppe macht ohne Neuladen aus „keine gemeinsame Sprechgruppe“ die Kante `⇄ DMO 505` |
| `e2e/funkplan.spec.ts`, Tabelle (Bestand) | Unverändert grün: Messwerte, Lücken im ersten Bild, 390 px, Druckpfad, Übernahme, Zeilenlink |
| `e2e/fuehrungsorganisation.spec.ts` (nach dem Umbau auf das Gerüst) | 8/8 grün: das Organigramm verhält sich unverändert |
| `e2e/gate1-ueberlauf.spec.ts` | GATE1 |
| `e2e/gate3-trefflaeche.spec.ts` | GATE3 |
| Mutationsproben | (1) `verbindungsurteil` vergleicht Bezeichnungen statt `id`: 1 Vitest rot. (2) „ohne Urteil“ bei leerer Seite entfällt: 4 rot. (3) Druckkopf immer „Funkplan“: 1 rot. (4) Druckknopf klappt die Skizze nicht auf: 1 rot. (5) „Alle zuklappen“ der Skizze klappt auch die Tabelle: 1 rot. (6) Skizze aus `[]` bei gesperrten Abschnitten: allein überlebt sie, weil `SkizzenBereich` den Zustand der Abschnitte ein zweites Mal prüft (gleichwertige Mutation); fallen beide Sicherungen, 1 rot. (7) Kante ohne Wort, nur Farbe: 1 rot. (8) Sichtvorgabe nicht geräumt: 2 rot |
| Befund beim Bau | Der Dateiname `stab/Fernmeldeskizze.tsx` neben `stab/fernmeldeskizze.ts` löste auf macOS falsch auf → `FernmeldeskizzeBild.tsx`. Die Druckregeln des Gerüsts hängen an `.haengender-baum`, nicht an der Druckwurzel (design.md, Nachträge) |
| Vitest | `components/organigramm/HaengenderBaum.test.tsx`, `haengenderBaumPrint.test.ts`, `stab/luecken.test.ts` (Urteil, Lücke), `stab/fernmeldeskizze.test.ts` (Struktur wie das Organigramm, Funkangaben wie die Tabelle, Zahl der Lücke = Zahl der Kanten „keine“), `stab/FernmeldeskizzeBild.test.tsx`, `stab/funkplan.test.tsx` (Bericht), `pages/FunkplanPage.test.tsx` (Umschalter, Sichtvorgabe, Druckkopf, Klappmengen, Übernahme, Quellen, Lückenzeile), `routing/deeplinks.test.ts`. Volle Suite: VITEST |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `useRollen`) · `animation`/`blink` 0 · antd-`size=` 0 (das eine `size=` ist die Kantenlänge des Zeichens) · Emoji 0 (`⇄` ist ein Pfeilzeichen, kein Piktogramm) |

---

## Tabelle: Fernmeldeskizze

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Namenslinks (`baumZielStil`, `minHeight: controlHeight`), Klappziele, Umschalter und Werkzeugknöpfe halten 30/48/72 px. Gemessen in Gate 3, auch als Beobachter | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Gate 3 misst die Stufe Handschuh. Der Einzug je Ebene hängt nicht an der Knopfhöhe (Gerüst) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Die Übernahme zeigt `loading` am Knopf, ein Fehler steht an der Seite (`SpeicherFehler`). Umschalten und Klappen wirken sofort und lokal | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Nichts wird gelöscht oder überschrieben. Die Übernahme legt einen Entwurf an | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nebentext und Kante in `rollen.gedaempft`, Sprechgruppen in `rollen.text`, „keine Sprechgruppe“ und „keine gemeinsame Sprechgruppe“ in `rollen.achtungText`, Namen in `rollen.bedienText`, Rahmen in `linieStark`. Keine eigene Farbe. Im Druck dunkel auf hell (`druck.css`) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „keine gemeinsame Sprechgruppe“ steht als Wort mit Warnzeichen (verborgen für Hilfstechnik), „keine Sprechgruppe“, „kein Rufname“, „Gegenstelle nicht erfasst“, „Einheiten: nicht geladen“ als Wort. Mutationsprobe (7) belegt das Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Achtung nur für fehlende Funkangaben (Knoten) und den fehlenden gemeinsamen Kanal (Kante), Blau nur für Bedienziele. Die Struktur selbst ist farblos | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Das Lücken-Paneel mit der neuen Zeile steht im ersten Bild bei 1366 × 768 mit offenem Panel (e2e). Die Kante steht am betroffenen Knoten | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung. Die Übernahme navigiert bei Erfolg | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Wie beim Organigramm (gleiches Gerüst): live hinzukommende Knoten verschieben die dahinter sofort. Einziges Bedienziel je Knoten ist ein Link, ein Fehlgriff ändert nichts. Das Zielticket gilt für das Gerüst und damit für beide Nutzer | [LFH-867](https://app.clickup.com/t/123zgec64ta) |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste in der Darstellung | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Die Skizze beantwortet „wer erreicht wen?“, nicht „welcher von diesen?“. Der Vergleich steht in der Tabelle derselben Seite | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Schreibgeschützt. Bearbeitet wird am Abschnitt bzw. an der Einheit, Namen und Lückenverweise führen dorthin | — |

**Bilanz:** 10 erfüllt · 1 offen ([LFH-867](https://app.clickup.com/t/123zgec64ta)) · 4 nicht anwendbar.
