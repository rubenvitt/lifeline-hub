# Prüfliste Einsatztauglichkeit: Checkliste Arbeitsaufnahme (LFH-551)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder umgebauten Seite. Planung und Spec liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab`, neues drittes Paneel „Arbeitsaufnahme“ unter Lagebesprechung und Besetzung |
| Stand | Branch `claude/serene-clarke-x6i1nb`, PR gegen `alpha` |
| Zielkontext | Fükw (primär: die ersten zehn Minuten am Fahrzeug), Führungs-Tablet (Tipp mit Handschuh). Mobil: abhaken und lesen |
| Nicht enthalten | Konfigurierbare Punkte, Fälligkeiten, Ableitung aus anderen Modulen (Design, Non-Goals) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/stab_checkliste.rs` (13) | Lazy-Anlage, Idempotenz (Zeitpunkt des ersten Hakens bleibt), Haken und Bemerkung lassen sich gegenseitig stehen, 400-Fälle ohne Zeile, sechs Punkte ohne ETB, Meldung je Übergang genau ein Beleg samt Rücknahme, Live `stab`/`etb`, Beobachter 403, fremde Org, 409 am abgeschlossenen Einsatz, Schwärzung nullt die Bemerkung |
| Mutationsproben Rust | (1) Übergangs-Riegel entfernt → rot. (2) Rücknahme unbelegt → rot. (3) Bemerkung bei jedem Aufruf überschrieben → rot. (4) `erledigt_at` bei erneutem Haken überschrieben → rot. Je genau ein Test |
| Vitest | `stab/checkliste.test.ts` (Vorlage gegen den generierten Typ, Zeilenstil 30/48/72 als Literale), `stab/ChecklistePaneel.test.tsx` (9), `api/stab.test.ts` (genau ein Feld auf dem Draht), `api/queryKeys.test.ts`, `pages/StabPage.test.tsx` (Reihenfolge der Paneele, Beobachter) |
| Mutationsproben Vitest | Zähler über Zeilen statt Haken → 2 rot. Box ohne Rechte-Riegel → rot. `minHeight` aus `controlHeightSM` → rot |
| `e2e/stab-checkliste.spec.ts` | Tipp auf den ZEILENTEXT hakt ab (geklickt, nicht `toBeVisible`). Nach dem Neuladen steht der Stand. „Lageskizze“ schreibt nichts ins ETB, die Meldung genau einen Eintrag, die Rücknahme ohne Rückfrage einen zweiten. Der Beleg steht in der ETB-Zeitachse |
| `e2e/gate3-trefflaeche.spec.ts` | „Stab“ und „Stab (Beobachter)“ messen jetzt auch die sieben Zeilen-Labels in 30/48/72 px, der Beobachter mit der Vorbedingung „jede Box gesperrt“. Mutationsprobe ohne `minHeight`: 27,5 px in `kompakt`, beide Tests rot |
| `e2e/gate1-ueberlauf.spec.ts` | Die Route `stab` ist neu aufgenommen, als Admin, Beobachter (Vorbedingung: Haken gesperrt) und Führungskraft, bei 1366, 1024, 768 und 390 px. 12/12 grün. Mutationsprobe (Zeile `nowrap`, 900 px breit): 534 px Überlauf bei 390 px, rot für Admin und Beobachter |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus Tokens) · `animation`/`blink` 0 · `size=` 0 · Emoji 0 |

---

## Tabelle: Arbeitsaufnahme

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Das antd-Label umschließt Box und Text und trägt `minHeight: controlHeight` plus Polster (`checklistenZeileStil`, LFH-365). Gemessen in Gate 3 für 30/48/72 px, auch gesperrt. Die Bemerkung ist ein `Button` und erbt die Steuerhöhe | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Die Box ist ab dem Tipp gesperrt, bis die Antwort da ist. Die Bemerkung zeigt `loading`. Nicht optimistisch: Der Haken zeigt den Serverstand, ein Fehler steht an der Zeile (`data-fehler`, `SpeicherFehler`), nie als Toast | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Jeder Haken ist umkehrbar (LFH-363). Die Meldung an die Leitstelle belegt auch ihre Rücknahme im ETB (E1 = A), es geht also nichts verloren | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Keine eigene Farbe: Text und Quelle in Theme-Farben (`colorText`, `colorTextDescription`), Box aus antd | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Erledigt heißt Häkchen plus „erledigt 1432“ als Wort. Der Zähler „n/7 erledigt“ steht als Text | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe. Die Box nimmt die Bedienfarbe blau | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Die Checkliste ist ein Arbeitsmittel, keine kritische Anzeige. Sie steht bewusst unter den bestehenden Paneelen (Design D6) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung, kein Toast. Die Quittung ist der Haken selbst | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Sieben feste Zeilen, nichts wird eingeschoben. Ein Haken von einem anderen Schirm ändert nur den Zustand der Box und die Zeitangabe in der Quellzeile | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Die Stabseite hat keine angepinnte oder schwebende Leiste | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Die Checkliste wird gelesen und abgehakt, nicht verglichen (`Liste`, LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Maske. Die Bemerkung ist eine Inline-Angabe über `BemerkungZelle` mit sichtbarem Leerzustand | — |

**Bilanz:** 9 erfüllt · 0 offen · 6 nicht anwendbar.
