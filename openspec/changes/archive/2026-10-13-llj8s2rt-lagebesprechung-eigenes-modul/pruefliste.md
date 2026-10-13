# Prüfliste Einsatztauglichkeit — Lagebesprechung als eigenes Modul (LLH-1111)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung
und Specs liegen in dieser Change (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/lagebesprechung` (neu) · `/einsaetze/:id/stab` (umgebaut: Termin-Zeile statt Paneele „Lagebesprechung“ und „Vorbereitung“) · `/einsaetze/:id/einsatzdaten` (Zeile „Nächste Lagebesprechung“ entfällt) · Schnellaktion „Lagebesprechung abschließen“ der Sprungpalette |
| Bausteine | `pages/LagebesprechungPage.tsx`, `lagebesprechung/TerminPaneel.tsx` (neu), `lagebesprechung/LagebesprechungZeile.tsx` (neu), `lagebesprechung/LagebesprechungHistorie.tsx` (Verlauf, ohne Begrenzung), `lagebesprechung/LagebesprechungModal.tsx` (Zähler am Entschluss), `lagebesprechung/VorbereitungPaneel.tsx` (verschoben, unverändert im Aufbau) |
| Zielkontext | Fükw (1366–1440 px, kompakt) und Führungs-Tablet in „Handschuh“; Handy (390 px) lesend und mit Schnellwahl |
| Nicht enthalten | Teilnehmerliste und Folgeauftrag aus dem Entschluss (eigenes Ticket), Neugestaltung der Stab-Seite (LLH-1124) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Was aus einem geteilten Baustein und seinen Messungen geschlossen ist, trägt
**[abgeleitet]**.

## Die Nachweise

Gefahren in der Cloud-Sitzung vom 12.10.2026 gegen das frisch gebaute Backend, Chromium 141
(vorinstalliert, Build 1194; der gepinnte Build 1234 ist dort nicht erreichbar), Zeitzone
Europe/Berlin.

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagebesprechung.spec.ts` (neu) | Ablauf „Termin wählen“ → „+1 h“ → Vorbereitung → Abschluss → Verlauf Nr. 1 → ETB-Sprung; Stab ausgeblendet, Führungspersonal schließt ab; 390 px als Admin und Beobachter ohne Querlauf, Sprung „Zur Lagebesprechung“ — 4/4 grün |
| `e2e/gate3-trefflaeche.spec.ts` (Stab, Lagebesprechung) | Schnellwahl, „Termin wählen“, Kopfaktion, ETB-Sprünge im Verlauf, Übernahme der Vorbereitung, „Zur Lagebesprechung“ — in `kompakt`, `komfortabel` und `handschuh`, Admin und Beobachter — 4/4 grün |
| `e2e/gate1-ueberlauf.spec.ts`, `e2e/stab-schmal.spec.ts`, `e2e/fugenraster-leerzelle.spec.ts` | Fükw und mobil ohne Überlauf; Termin-Band bei 820/1440 px ohne leere Spur — grün |
| `e2e/einsatzkopf-live.spec.ts` | Termin per PUT: Stab-Zeile folgt ohne Neuladen; Abschluss: Überblick-Marke und zweiter Tab der Seite folgen live; PATCH mit Termin 400 — grün |
| `e2e/lagebesprechung-vorbereitung.spec.ts`, `e2e/einsatzbericht-druck.spec.ts`, `e2e/einsatzdaten-schmal.spec.ts` | grün |
| Vitest | `LagebesprechungPage.test.tsx` (30), `LagebesprechungPage.palette.test.tsx`, `TerminPaneel.test.tsx` (12), `LagebesprechungZeile.test.tsx` (5), `LagebesprechungHistorie.test.tsx`, `LagebesprechungModal.test.tsx`, `StabPage.test.tsx`, `EinsatzdatenPage.test.tsx` — grün |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink`/`keyframes` 0 · `size="small"` 0 · Emoji 0 |

---

## Tabelle 1 — Seite „Lagebesprechung“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Schnellwahl, „Termin wählen“, Kopfaktion, ETB-Sprünge und „In Lagebericht übernehmen“ in `gate3-trefflaeche` gemessen; alle Knöpfe sind antd-`Button` ohne `size` und erben `controlHeight` | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px gemessen (dieselbe Spec, Stufe `handschuh`) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Schnellwahl und „kein Termin“ sperren während der Mutation (`mutation.isPending`); das Modal zeigt „Abschließen“ im Ladezustand ([abgeleitet, `ErfassungsModal`]) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Abschluss nur über das Modal mit Pflichtfeld „Entschluss“ und „Abschließen“; „kein Termin“ ist keine kritische Aktion (mit einem Griff zurückzunehmen, design.md D7) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Keine neue Farbe: `Kennzahl`, `Paneel`, `Liste`, `StatusTag` und `SprungKnopf` sind Bestandsbausteine mit gemessenen Rollen; Doku-Bilder hell und dunkel aufgenommen | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Zustand des Termins als Wort („in 25 min“, „jetzt fällig“, „seit 5 min überfällig“, „kein Termin“), `achtung` zusätzlich mit Innenkante der Kennzahl (Vitest `TerminPaneel`) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau bedient (Knöpfe, Sprünge), `achtung` nur für den erreichten Termin, kein Rot | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit seit LFH-397; die Seite bringt keine eigene Fläche mit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Termin mit Zustand oben im ersten Paneel; Fehler des Setzens steht am Paneel („Termin nicht gesetzt“), nicht im Toast | — |
| 10 | **Alarmbudget** | **erfüllt** | Ein fälliger Termin ist `achtung`, nie `alarm` (Spec `lagebesprechung-vorbereitung`, „Ein Ton für den überfälligen Besprechungstermin“, EEMUA 191) | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep); der Zustand wechselt im 30-s-Takt nur den Wortlaut | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Live-Ereignisse ändern Werte an Ort und Stelle; das Kennzahlenband hält seine Notizhöhe ([abgeleitet, `Kennzahlenband`]); neue Besprechungen erscheinen oben im Verlauf, das Paneel steht unter Termin und Vorbereitung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Keine stehende Leiste außer dem Rahmenkopf; das Modal ist der Bestandsbaustein `ErfassungsModal` | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Verlauf wird gelesen, nicht verglichen — `Liste`, keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Abschluss-Maske unverändert aus LFH-543/LFH-46; neu ist nur der Zähler am Entschluss mit Grenze und Wortlaut des Servers (Vitest `LagebesprechungModal`) | — |

## Tabelle 2 — Stab-Seite (Termin-Zeile) und Einsatzdaten

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | „Zur Lagebesprechung“ ist `SprungKnopf` (antd-`Button`), in `gate3-trefflaeche` gemessen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | dieselbe Spec, Stufe `handschuh` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Die Zeile schreibt nichts | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Keine Aktion außer dem Sprung | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Bestandsbausteine (`StatusTag`, `SprungKnopf`) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Zustand als Wort im `StatusTag`; gesperrter Sprung nennt den Grund sichtbar („Keine Berechtigung“) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | wie Tabelle 1 | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die Zeile steht oberhalb der Besetzung | — |
| 10 | **Alarmbudget** | **erfüllt** | wie Tabelle 1, aus derselben Funktion (`lagebesprechungZustand`) | — |
| 11 | **Warnverhalten** | **erfüllt** | wie Tabelle 1 | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Zeile hat eine feste Höhe; der Termin kommt aus dem Einsatzkopf und ändert nur den Wortlaut | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] keine neue stehende Fläche | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Einsatzdaten verlieren nur eine Zeile (Spec `einsatzdaten-bearbeitung`, Vitest belegt die Abwesenheit) | — |
