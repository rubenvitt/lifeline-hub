# Prüfliste Einsatztauglichkeit: Einsatzabschnitt in der Ansicht bearbeiten (LFH-1208)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder umgebauten Seite. Bewertet wird nur, was sich geändert
hat: das Detailpaneel der Gliederung (Bearbeiten an der Zeile, Lagezustand als Segmentleiste,
„Auflösen“) und der Dialog „Abschnitt anlegen“. Baum, Organigramm und Einheitenliste sind unverändert.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/einsatzabschnitte` (Gliederung, umgebaut), `?neu=1` öffnet jetzt den Dialog |
| Stand | Branch `claude/vibrant-newton-h7fzvs` gegen `alpha` |
| Zielkontext | Fükw (primär), Führungs-Tablet mit Handschuh, mobil 390 px (Gliederung über dem Detail) |
| Nicht enthalten | Über-Abschnitt per Ziehen (eigenes Ticket des Sammeltickets), Begriff „Erreichbarkeit“ (Querschnitt e aus LFH-1162), Sammelbanner bei fremder Änderung (design.md, Non-Goals) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/einsatzabschnitte-bearbeitung.spec.ts` | 6/6 grün (Chromium), je in `kompakt` und `handschuh`: Lagezustand per Klick (genau `{ lagezustand }`, ETB-Eintrag „angespannt → kritisch“), Leiter an der Zeile (genau `leiter_id`), Anlegen per Enter (drei Felder, Fokus im Namen, danach gewählt) |
| `e2e/trefflaeche-pruefflaechen.spec.ts` C12 | 2/2 grün: Zeilenknöpfe (≥ 8), vier Stufen des Lagezustands und „Auflösen“ halten in `handschuh` 72 px, in `kompakt` kleiner (Gegenprobe). Beobachter: Anlegen, Zeilenstifte, Stufenwahl und Auflösen fehlen, der Baum hält 72 px |
| Weitere e2e | `farbvertrag-wort`, `fuehrungsorganisation` grün (16 Tests zusammen mit den beiden oben) |
| Vitest | Neu: `AbschnittDetail.test.tsx` (21), `AbschnittAnlegenModal.test.tsx` (7), `kurzbezeichnung.test.ts` (5). Umgeschrieben: `EinsatzabschnittePage.test.tsx` (49). Abwesenheit des Fortschritts: `AbschnittVorschau`, `UeberblickPage`, `ueberblickDaten` |
| Mutationsproben | Riegel der Stufenwahl entfernt, Gleichheitsprüfung entfernt, Kurzbezeichnungsprüfung entfernt, `pending` nicht zurückgesetzt, leer nicht `null`, Wahl während einer Anfrage verworfen, eigene Nachfahren wählbar, gleiche Wahl erneut gesendet, Auflösen ohne Cache-Filter: je ein Test rot |
| Review | Unabhängiges Review: die Wahl während einer laufenden Anfrage ging still verloren (Fokus auf nicht gewählter Stufe), Bezeichner-Sprache, fehlende Tests (Über-Abschnitt, Auflösen), Rollensatz im Kapitel, verlorene Platzhalter. Alles behoben. Der Bildlauf fand die gestreckte Segmentleiste (grauer Fugengrund über die Zeile): behoben, gepinnt |

---

## Tabelle: Detailpaneel und Dialog „Abschnitt anlegen“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Wertknöpfe und „… eintragen“ über `InlineAngabe` (`wertKnopfStil`/`leerKnopfStil`, Boden `controlHeight`), Segmente über `segmentStil`, „Auflösen“ als antd-`Button`. Gemessen in C12 | — |
| 2 | **Handschuh-Modus** | **erfüllt** | C12 misst 72 px in `handschuh` mit Gegenprobe `kompakt`; der Zielabstand der Segmente kommt aus `zielEinzug` (LFH-865). e2e-Abläufe laufen in `handschuh` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Die gewählte Stufe steht sofort (lokaler Wert bis zur Antwort), eine Zeile zeigt „Speichern“ mit Ladeanzeige, der Dialog sperrt Abbrechen, solange er speichert | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Auflösen“ nur nach der Rückfrage „Abschnitt auflösen?“ mit rotem „Abschnitt auflösen“. Ein Lagewechsel ist umkehrbar (ein weiterer Klick) und steht im ETB, deshalb ohne Rückfrage (design.md D4, Risiken) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nur bestehende Bausteine und Rollen (`Segmentleiste`, `InlineAngabe`, `StatusTag`, `ZeilenFehler`); Farbpunkte aus `rollenFarbe`. `farbvertrag-wort.spec.ts` grün | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jede Stufe trägt ihr Wort neben dem Farbpunkt; ohne Schreibrecht steht der Lagezustand als `StatusTag` mit Wort, „nicht beurteilt“ als Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe. Rot steht nur an „Auflösen“ und an Fehlern | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Unverändert app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Lagezustand steht als eigene breite Zeile oben im Detail, unter Name, Kurzbezeichnung, Über-Abschnitt und Leiter | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Kein neuer Alarm; ein Erfolg meldet ein kurzer Toast („Lagezustand gespeichert“), eine Ablehnung steht am Ort | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Eine offene Zeile behält ihren Entwurf, wenn der Abschnitt live wechselt; ein Wechsel des gewählten Abschnitts schließt sie (`key`). Die Segmentleiste behält ihre Breite (nicht gestreckt, gepinnt) | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Kein klebendes Element im Detail; die Fokusrückgabe nach dem Speichern trägt `useFokusRueckgabe` | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Gliederung ist ein Baum, das Detail ein Datenraster | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsModal`: Absende-Knopf im `<form>` (Enter sendet, keine antd-Fußzeile), Fokus im ersten Feld, drei Felder (Feldbudget), Pflichtfeld sichtbar, Grund einer Ablehnung im Dialog, Zurücksetzen auf jedem Weg hinaus (Hülle). Belegt in `AbschnittAnlegenModal.test.tsx` und e2e | — |

**Bilanz:** 14 erfüllt · 0 offen · 1 nicht anwendbar.

## Mobil (390 px)

Unter `md` steht die Gliederung über dem Detail (unverändert, `EinsatzabschnittePage.test.tsx`
„stapelt unter md“). Das Datenraster gibt auf eine Spalte ab (`DATENRASTER_MINDESTBREITE`), die
Segmentleiste bricht um (`flex-wrap`). [abgeleitet]

## Nachtrag (12.10.2026): nach der Zusammenführung mit LFH-1212

„Auflösen“ steht jetzt im Menü „Weitere Aktionen“ neben „Verschieben unter …“, die Rückfrage als
Dialog (Kriterium 4 unverändert erfüllt). C12 misst statt des Knopfs „Auflösen“ den Auslöser
„Weitere Aktionen“ und die Griffe zum Umhängen; der Beobachterzweig belegt, dass beide fehlen.
