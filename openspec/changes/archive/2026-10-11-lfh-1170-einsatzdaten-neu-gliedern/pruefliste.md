# Prüfliste Einsatztauglichkeit — Einsatzdaten neu gegliedert, Zugriff in den Einstellungen (LFH-1170)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung
und Specs liegen in dieser Change (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/einsatzdaten` (umgebaut) · `/einsaetze/:id/einstellungen/zugriff` (neue Sektion) · Schnellaktion „Mitglied aufnehmen“ der Sprungpalette |
| Bausteine | `pages/EinsatzdatenPage.tsx`, `components/InlineAngabe.tsx` (neu `isValid`), `anzeige/KoordinatenEingabe.tsx` (`aria-label`, `aria-invalid`), `pages/einstellungen/EinsatzZugriff.tsx`, `pages/MitgliederAbschnitt.tsx` (unverändert bis auf `openAuswahl`) |
| Zielkontext | Fükw (1366–1440 px, kompakt) und Führungs-Tablet in „Handschuh“; mobil (390 px) lesend und zeilenweise bearbeitend |
| Nicht enthalten | Ortssuche und Kartenausschnitt (LFH-1175), Führungsstelle als Ort (LFH-1181), Einsatzleiter als Angabe (LFH-1199), Lagebesprechung als eigene Verwaltung (LFH-1251) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Was aus einem geteilten Baustein und seinen Messungen geschlossen ist, trägt
**[abgeleitet]**.

## Die Nachweise

Gefahren in der Cloud-Sitzung vom 11.10.2026 gegen das frisch gebaute Backend, Chromium 1194
(vorinstalliert; der gepinnte Download ist dort nicht erreichbar), Zeitzone Europe/Berlin.

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/einsatzdaten-inline.spec.ts` | Leitstellen-Nr. ohne Aufklappen nachgetragen, Seitenkopf nennt sie; Koordinatenzeile: unlesbar kein PATCH, Paar gespeichert; Alarmzeit per Enter und geleert abgelehnt — grün |
| `e2e/einsatzdaten-schmal.spec.ts` | 390 px als Admin und Führungspersonal: Paneele untereinander, Etikett über dem Wert, „… eintragen“ und Auslöser „Weitere“ enden bei 390 px — grün |
| `e2e/einstellungen-schmal.spec.ts` | Sektion „Zugriff“ bei 390 px: Rolle und „Entfernen“ ohne Wischen erreichbar, Rückfrage öffnet; Führungspersonal mit gesperrter Rolle und „nur Einsatzleitung“ — grün |
| `e2e/trefflaeche-pruefflaechen.spec.ts` | Einsatzdaten: Zeilen-Auslöser und Nebenwege; Zugriff: Auswahlfelder, „Hinzufügen“, Zeilenaktionen („Entfernen“, „Führungsstelle für … bearbeiten“) — in `kompakt` und `handschuh` gemessen, Beobachter-Zweig ohne „Bezeichnung bearbeiten“ — grün |
| `e2e/command-palette.spec.ts` | „Mitglied aufnehmen“ → Reiter „Zugriff“ markiert, Auswahl fokussiert und aufgeklappt, `neu` aus der Adresse geräumt — grün |
| `e2e/einsatzabschluss.spec.ts`, `rechte-sperren.spec.ts`, `einsatzkopf-live.spec.ts`, `fuehrungsstelle.spec.ts`, `etb-chronologie.spec.ts` (Terminzeile) | grün |
| Vitest | `EinsatzdatenPage.test.tsx` (Kennungen, Paneele, jede Angabe einmal, Raster 1440/1024/390, Bezeichnung und Koordinate als Zeile, Nebenwege je Rolle), `EinsatzZugriff.test.tsx`, `InlineAngabe.test.tsx` (`isValid`, Fokus zurück ins Feld), `KoordinatenEingabe.test.tsx` (`aria-invalid`, Beschreibung), `befehle.test.ts` — grün; volle Suite 12 429 grün, 13 rot in vier unberührten Dateien, auf `origin/alpha` in derselben Umgebung identisch rot (Node 22 statt 26.7) |
| Grep über die geänderten Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 · Emoji 0 |

---

## Tabelle 1 — Seite „Einsatzdaten“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Zeilen-Auslöser („… bearbeiten“/„… eintragen“) und Nebenwege in `trefflaeche-pruefflaechen` gemessen; Wertknöpfe und Aufforderung tragen den Boden aus `controlHeight` (`leerKnopfStil`, `wertKnopfStil`) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px gemessen (dieselbe Spec, Stufe `handschuh`); kein punktuelles `size` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | [abgeleitet, Baustein] `InlineAngabe` zeigt „Speichern“ im Ladezustand bis zur Antwort; Erfolg als „… gespeichert“ | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Einsatzabschluss unverändert: `Popconfirm` mit „Einsatz endgültig abschließen“ (LFH-960, `einsatzabschluss.spec.ts`) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Keine neue Farbe; Paneel, Augenbraue, Zeilen und Nebenwege sind Bestandsbausteine mit gemessenen Rollen. Doku-Bild hell und dunkel aufgenommen | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Pflicht- und Speicherfehler als Text an der Zeile; unlesbare Koordinate als Wortlaut „Ungültige Koordinate im Format …“ mit `aria-invalid` | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau bedient (Stift, „… eintragen“, Nebenwege), Rot nur am Einsatzabschluss | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit seit LFH-397; die Seite bringt keine eigene Fläche mit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Fehler stehen an der Zeile (`data-fehler`), nicht im Toast; Kennungen ohne Aufklappen im Seitenkopf | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Ein Live-Ereignis `einsatz` ändert Werte an Ort und Stelle; eine offene Zeile behält ihren Entwurf (Vitest „Sachverhalt / Meldebild“); das Raster wechselt die Spaltenzahl nur mit der Fensterbreite (`xl`), Paneele stehen `align-items: start` | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Keine stehende Leiste auf der Seite außer dem Rahmenkopf; nach dem Speichern liegt der Fokus auf dem Wertknopf, bei gesperrtem Speichern im Feld (Vitest). `fokus-verdeckung.spec.ts` misst die Seite nicht | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Datenblatt, keine Vergleichstabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Maske mehr: jede Angabe ist eine Zeile (Spec `einsatzdaten-bearbeitung`) | — |

## Tabelle 2 — Sektion „Zugriff“ der Einsatz-Einstellungen

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Auswahlfelder, „Hinzufügen“ und Zeilenaktionen in `trefflaeche-pruefflaechen` gemessen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px gemessen | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | [abgeleitet, Baustein] „Hinzufügen“ im Ladezustand, Führungsstelle-Dialog gesperrt während des Speicherns (unverändert aus den Einsatzdaten) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Entfernen“ über „Mitglied entfernen?“, eigene Herabstufung über „Rolle herabstufen“ (`rechte-sperren.spec.ts`) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Unveränderter Baustein; Doku-Bild hell und dunkel | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „Gesperrt: letzte Einsatzleitung“ und „Nur Ansicht · nur Einsatzleitung“ als Text | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Rot nur an „Entfernen“, Blau bedient | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit (LFH-397) | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Speicherfehler über der Tabelle im Paneel, kein Toast | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | [abgeleitet] Tabelle unverändert aus den Einsatzdaten; neue Mitglieder erscheinen erst nach eigener Aktion | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Die Einstellungsseite ist für `verhalten` in `fokus-verdeckung.spec.ts` gemessen, dieselbe Hülle trägt die Sektion | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | `KatalogTabelle` wie bisher, unter `md` zweispaltig angepasst (LFH-964), am Handy ohne Querlauf gemessen | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Aufnahme ist eine Zeile über der Tabelle, keine Maske | — |
