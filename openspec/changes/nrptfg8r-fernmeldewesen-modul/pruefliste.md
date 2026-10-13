# Prüfliste Einsatztauglichkeit — Modul Fernmeldewesen (LLH-1180)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung
und Specs liegen in dieser Change (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/fernmeldewesen` (Reiter Funkplan, Fernmeldeskizze, Sprechgruppen; umgebaut: Reiter statt Segmentleiste „Darstellung“) · `/einsaetze/:id/fernmeldewesen/kommunikationsplan` (umgezogen) · `/einsaetze/:id/stab` (S6-Verweise mit Sperre) · Altadressen `…/stab/funkplan`, `…/stab/kommunikationsplan` (Umleitung) |
| Bausteine | `fernmeldewesen/FernmeldewesenReiter.tsx` (neu), `pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx` (Kopf, Reiter, Stab-Weiche), `pages/StabPage.tsx` (S6-Zeile), `einsatz/AltpfadWeiterleitung.tsx` (neu), Modulmenü und Palette (Marken) |
| Zielkontext | Fükw (1366–1440 px, kompakt) und Führungs-Tablet in „Handschuh“; Handy (390 px) lesend |
| Nicht enthalten | Inhalte von Funkplan, Skizze, Sprechgruppen und Kommunikationsplan (unverändert, eigene Prüflisten LFH-548, LFH-893, LFH-848) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Was aus einem geteilten Baustein und seinen Messungen geschlossen ist, trägt
**[abgeleitet]**.

## Die Nachweise

NACHWEISE

---

## Tabelle 1 — Modul Fernmeldewesen (Reiter, Kopf, Weiche)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Die vier Reiter in `gate3-trefflaeche` (Funkplan-Bereich) je Dichtestufe gemessen; antd `Tabs` erreichen die Steuerhöhe über `kopfzeilenMasse` (LFH-724) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | dieselbe Spec, Stufe `handschuh` (72 px Kopfzeile, `tokens.test.ts`) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Reiter wechseln ohne Serveraufruf; die Schreibwege der Seiten sind unverändert | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Keine neue Aktion; Entfernen im Kommunikationsplan und in der Skizze unverändert | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Keine neue Farbe: antd `Tabs` mit den Rollen des Themes wie in den Aufträgen, „—“ im Ton des Nebentexts | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Gewählter Reiter mit `aria-selected` und Unterstrich; die fehlende Besetzung als „—“ mit Grund im `title` und für Vorleser („Stab nicht freigegeben“, Vitest `KommunikationsplanPage`) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau bedient (Reiter, Sprünge), kein neuer Ton | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit seit LFH-397; keine eigene Fläche | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | h1 „Fernmeldewesen“ und Reiter oben, Lücken-Paneel unverändert oberhalb der Darstellung; eine Sperre zeigt der Rahmen statt der Seite (`ModulGesperrt`) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Kein Alarmzustand | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep über die neuen Quellen) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Reiterleiste hat eine feste Höhe; Live-Ereignisse (`fernmeldewesen`) ändern Inhalte an Ort und Stelle wie bisher | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] keine neue stehende Fläche | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | [abgeleitet] Funkplan- und Kommunikationsplan-Tabellen unverändert (LFH-548, LFH-848); neu ist nur die Besetzungszelle „—“ mit Grund | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine neue Maske | — |

## Tabelle 2 — Stab-Seite (S6-Verweise), Modulmenü und Palette

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | [abgeleitet] S6-Verweise behalten `stabZeilenzielStil`; der gesperrte Verweis ist `GesperrterSprung` (antd-`Button`); Marken sind Modulzeilen-Bausteine (LFH-620) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | [abgeleitet] dieselben Bausteine | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Verweise schreiben nichts | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Keine Aktion außer dem Sprung | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Bestandsbausteine | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Gesperrter Verweis nennt den Grund sichtbar („Funkplan (Keine Berechtigung)“, Vitest `StabPage`); gesperrte Marke mit Schloss | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | wie Tabelle 1 | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die S6-Zeile steht wie bisher in der Besetzung | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Kein Alarmzustand | — |
| 11 | **Warnverhalten** | **erfüllt** | wie Tabelle 1 | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Freigaben kommen vor dem Rendern der Zeile; eine spätere Änderung tauscht Link gegen gesperrten Knopf am selben Platz | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] keine neue stehende Fläche | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | keine Maske | — |
