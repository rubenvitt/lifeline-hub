# Prüfliste Einsatztauglichkeit — Stab-Seite als Übersicht der Stabsfunktionen (LLH-1124)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite
(`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7). Planung
und Specs liegen in dieser Change (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/stab` (umgebaut: Raster aus sechs Kacheln statt Liste „Besetzung S1–S6“, Arbeitsaufnahme klappt ein) · `/einsaetze/:id/fernmeldewesen` (Paneel „Lücken“ mit Zahl im Kopf) |
| Bausteine | `pages/StabPage.tsx`, `stab/SachgebietKachel.tsx` (neu), `stab/WerkzeugZelle.tsx` (neu), `stab/werkzeugZahlen.ts`, `stab/werkzeuge.ts`, `stab/useFunkplanLuecken.ts`, `stab/ChecklistePaneel.tsx` (Einklappen), `pages/FunkplanPage.tsx` (Meta) |
| Zielkontext | Stabsraum 1920 px und Fükw (1366–1440 px, kompakt), Führungs-Tablet in „Handschuh“; Handy (390 px) lesend und mit „Besetzung ändern“ |
| Nicht enthalten | Zahlen ohne bestehende Quelle (Nachforderungen, Lagemeldungen: LLH-1078, LLH-1206), `BesetzungModal` unverändert |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Was aus einem geteilten Baustein und seinen Messungen geschlossen ist, trägt
**[abgeleitet]**.

## Die Nachweise

Gefahren in der Cloud-Sitzung vom 13.10.2026 gegen das frisch gebaute Backend (Debug), Chromium
141 (vorinstalliert, Build 1194; der gepinnte Build 1234 ist dort nicht erreichbar), Node 22.

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/gate3-trefflaeche.spec.ts` (Stab, Admin und Beobachter) | 19 Werkzeugzellen, 6 „Besetzung ändern“, 7 Zeilen der Arbeitsaufnahme, „Zur Lagebesprechung“ — in `kompakt`, `komfortabel`, `handschuh` je ≥ 30 / 48 / 72 px — 2/2 grün |
| `e2e/stab-schmal.spec.ts` | 390 px Admin und Beobachter: sechs Kacheln untereinander, je ≥ 90 % der Rasterbreite, kein waagerechter Überlauf, „Besetzung ändern“ innerhalb der Kachel, eine lange Besetzung („Integrierte Leitstelle Musterstadt (rückwärtige Führungsunterstützung)“) bricht in der Kachel um — grün (6/6 der Datei) |
| `e2e/stab-kontrast.spec.ts` | Name jeder Werkzeugzelle hell und dunkel, in Ruhe und unter dem Zeiger ≥ 7 : 1 bzw. ≥ 5 : 1 — 2/2 grün |
| `e2e/stab-checkliste.spec.ts` | Klickweg Arbeitsaufnahme; neu: siebter Haken klappt nicht ein, nach dem Neuladen eingeklappt mit „7/7 erledigt“, „Aufklappen“ zeigt die Punkte — 2/2 grün |
| `e2e/fernmeldeskizze.spec.ts`, `e2e/fernmeldewesen.spec.ts`, `e2e/fuehrungsfunktionen.spec.ts`, `e2e/gate1-ueberlauf.spec.ts`, `e2e/lagebesprechung.spec.ts`, `e2e/einsatzkopf-live.spec.ts` | 78/78 grün (14,1 min) |
| Vitest | `StabPage.test.tsx`, `SachgebietKachel.test.tsx`, `WerkzeugZelle.test.tsx`, `werkzeugZahlen.test.ts`, `werkzeuge.test.ts`, `sachgebiete.test.ts`, `unterseiten.test.ts`, `stabRaster.test.ts`, `useFunkplanLuecken.test.tsx`, `luecken.test.ts`, `ChecklistePaneel.test.tsx`, `FunkplanPage.test.tsx`, `sprungmarken.test.ts` — grün |
| Doku-Bilder | `docs/anwender/bilder/stab/uebersicht.png` hell und dunkel, 1440 × 900, kompakt |

## Tabelle 1 — Stab-Seite

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Werkzeugzellen (`werkzeugZelleStil`, Boden `controlHeight` plus Einzug wie die klickbare Kennzahl) und „Besetzung ändern“ (antd-`Button`) in `gate3-trefflaeche` gemessen; Abstand zwischen zwei Zellen über den Einzug 0 / 4 / 8 px ([abgeleitet, `kennzahlZielStil`, LFH-630]) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px gemessen (dieselbe Spec, Stufe `handschuh`) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Besetzung über den Bestandsdialog `BesetzungModal`; Haken der Arbeitsaufnahme gesperrt während der Anfrage ([abgeleitet, LFH-551]); Zahlen zeigen „····“ im Laden | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite trägt keine kritische Aktion; Besetzung wird im Dialog mit „Übernehmen“ bestätigt | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | Name der Werkzeugzelle gemessen (`stab-kontrast`); Zahl in der Textrolle und Notiz in `gedaempft` wie die Kennzahl ([abgeleitet, Kontrasttabelle `Kennzahl.tsx`]) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Besetzung als Wort im Chip; überfällige Aufträge als Achtung mit Innenkante **und** Notiz „1 überfällig“; gesperrtes Werkzeug mit „(Keine Berechtigung)“ im sichtbaren Text | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau bedient (Werkzeugnamen, Knöpfe), `achtung` nur für überfällige Aufträge, kein Rot | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit seit LFH-397; keine eigene Fläche | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Besetzung und Zahlen stehen je Kachel im ersten Bild bei 1440 × 900 (Doku-Bild `uebersicht.png`); Fehler der Besetzung ersetzt das Raster mit „Wiederholen“, kein Toast | — |
| 10 | **Alarmbudget** | **erfüllt** | Kein `alarm` auf der Seite; überfällige Aufträge sind `achtung` wie im Überblick | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton; Zahlen ändern sich an Ort und Stelle | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Werkzeugzellen stehen in Rasterzeilen gleicher Höhe (`gridAutoRows: 1fr`), Notiz einzeilig mit Auslassung; die Arbeitsaufnahme klappt nie unter der Hand ein (letzter Haken, Spec `stab-checkliste`), nur beim Öffnen oder auf Knopfdruck | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] keine stehende Leiste außer dem Rahmenkopf; der eingeklappte Körper ist `hidden`, sein Inhalt also nicht fokussierbar | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Überblick, keine Tabelle („Kachel nur für Überblick“) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Maske auf der Seite; `BesetzungModal` unverändert | — |

## Tabelle 2 — Funkplan, Kopf des Paneels „Lücken“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–4, 13–15 | Treffläche bis Fokus, Tabelle, Maske | **nicht anwendbar** | Das Meta ist Text im Paneelkopf, kein Bedienziel; die Seite bleibt sonst unverändert | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] `paneelMetaStil` (Bestand) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Zahl mit Wort („6 Lücken“) | — |
| 7–11 | Farbe, Regler, Blickfeld, Alarm, Warnung | **erfüllt** | keine neue Farbe, kein Ton; das Paneel steht im ersten Bild (Spec `stab-funkplan`) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Das Meta steht im Kopf fester Höhe (≥ 38 px), es verschiebt die Zeilen nicht | — |

## Lauf der berührten Specs

Alle Specs, die die Stab-Seite öffnen oder ihre Einstiege nutzen (Grep nach `/stab` in
`frontend/e2e/`), liefen am 13.10.2026 grün: die vier Stab-Specs (12/12) und die sechs übrigen
(78/78). Die volle e2e-Suite fährt die CI des PRs.
