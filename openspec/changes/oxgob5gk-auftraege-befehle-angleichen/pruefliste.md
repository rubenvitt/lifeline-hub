# Prüfliste Einsatztauglichkeit: Aufträge und Befehle im Muster „Liste + Detailpaneel“ (LLH-1084)

Gate 7 der Bedien-Leitlinie (`frontend/AGENTS.md`, „Prüfliste Einsatztauglichkeit“) verlangt diese
Liste an jeder umgebauten Seite. Bewertet wird, was sich geändert hat: beide Reiter der Seite
„Aufträge/Befehle“ (Liste, Detailpaneel, Filterleiste, Dialog „Auftrag erteilen“) und der Ortspfad
der Befehl-Vollseite. Die Vollseite selbst (Editor, Druck, Anlagen) ist unverändert.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/auftraege` (beide Reiter, umgebaut), `?auftrag=`, neu `?befehl=` |
| Stand | Branch `claude/nifty-cerf-rn55n9` gegen `alpha` |
| Zielkontext | Fükw (primär, Detail rechts), Führungs-Tablet mit Handschuh, mobil 390 px (Detail unter der Karte) |
| Nicht enthalten | Verteiler und Quittung für Befehle (LLH-1173), Entwurfsseite (LLH-1074), Aufheben (LLH-1098), Namen im Verlauf (design.md, Non-Goals) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/auftraege-befehle-liste-detail.spec.ts` | 5/5 grün (Chromium): Auftrag erteilen im Dialog → wählen → quittieren → Vollzug melden (Detail bleibt mit „Nicht mehr in dieser Ansicht“) → abnehmen, Befehl entwerfen → Vollseite → Ortspfad zurück (gewählt, markiert) → im Detail freigeben, je bei 1366 × 768 und 390 px ohne waagerechtes Scrollen; Detail klebt ab `lg` beim Scrollen |
| `e2e/auftraege-abgeschlossen.spec.ts` | 2/2 grün (Admin, Beobachter): Blättern, Server-Suche findet den ältesten von 105 ohne Blättern („Abgeschlossen (1)“), Deeplink heftet an, markiert, wählt |
| `e2e/befehl-navigation.spec.ts` | 4/4 grün: Rückweg aus der Vollseite wählt den Befehl wieder (Admin, Beobachter), Verlassen-Schutz unverändert |
| Weitere e2e | siehe Abschnitt „e2e nachgezogen“ unten |
| Vitest | Neu: `ListeDetail.test.tsx` (22), `useZuflussSchleuse.test.tsx` (7), `AuftragListenKarte` (6), `AuftragDetail` (7), `AuftragErteilenDialog` (5), `BefehlListenKarte` (4), `BefehlDetail` (7), `BefehlLesefassung` (1), `AuftraegePage.reiter` (3), `api/auftraege` (2). Umgeschrieben: `AuftraegePage*.test.tsx` (57), `BefehlListe.test.tsx` (21). Datensicht-Tests (188) unverändert grün |
| Backend | `auftrag::repo` Suchtests (2), Route `auftrag_blaettern` (8) |
| Mutationsproben | Zufluss: Touch-Prüfung und Portal-Ausnahme entfernt → 2 rot. ListeDetail: Vorauswahl, Link-Riegel, Entfallen, Zuklappen entfernt → je rot. Suche: `lfd_nr IS NOT NULL` entfernt → rot. Auswahl-Cache fehlte → Render-Zähler (LFH-949) rot, mit Cache grün |
| Bildlauf | `pnpm doku:bilder --grep auftraege-befehle` 4/4, Bilder hell und dunkel gesichtet |

---

## Tabelle: Liste, Detailpaneel, Filterleiste, Dialog

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Auswahlziel mit `minHeight: controlHeight` (`AuswahlZiel`), Handlungen als antd-`Button`, Sprünge (`DetailSprung`) mit Steuerhöhe, Segmente über `Segmentleiste`. Gemessen in `trefflaeche-pruefflaechen` (Aufträge/Befehle) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Handschuh-Szenario (390 px, Auswahlziel und Detailknöpfe ≥ 72 px, Gegenprobe `kompakt`) in `trefflaeche-pruefflaechen` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Quittieren optimistisch (Karte zählt sofort, Knopf lädt), „Bearbeitung beginnen“ mit Rückgängig-Toast, Dialoge sperren ihre Auswege während des Sendens | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Quittieren, Abnehmen und Freigeben nur nach Rückfrage; „Bearbeitung beginnen“ umkehrbar (Rückgängig) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | Nur Rollen: gewählt `auswahlFlaeche` (LFH-984, Textboden dort nachgewiesen), angesprungen wie bisher; `deeplink-hervorhebung-kontrast` misst Auftrag, Befehl und „gewählt, nicht angesprungen“ | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Gewählt: `aria-current`/`aria-expanded`; Überfällig mit Wort; Phasen und Status als Wort; Quittiertes mit ✓ | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe; die Linie oben/unten bleibt allein der Deeplink-Markierung, die Auswahl hat ihre eigene Fläche | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Unverändert app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Überfällige Aufträge in der ersten Gruppe „Überfällig“, ab `lg` der oberste vorgewählt; das Detail klebt beim Scrollen (e2e) | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Kein neuer Alarm, kein neuer Ton | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Zufluss-Schleuse der `Datensicht` (herausgelöst, `useZuflussSchleuse`): Fokus oder Mauszeiger halten Folge, Sammelbanner nennt Neues; die Handlungen stehen im Detail, nicht in wandernden Karten; ein entfallendes gewähltes Objekt bleibt im Detail stehen | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Das klebende Detail liegt neben der Liste, nicht über ihr; unter `lg` klebt nichts | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Listen aus Karten (Frage „was ist mit diesem?“, LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | „Auftrag erteilen“: `ErfassungsFormular` des `AuftragFormular` im Dialog (Enter sendet, Fokus im ersten Feld, Serie, Grund im Dialog, Reset auf jedem Weg hinaus über `destroyOnHidden`); „Befehl entwerfen“ unverändert `ErfassungsModal`. Belegt in `AuftragErteilenDialog.test.tsx` und `AuftraegePage.test.tsx` | — |

**Bilanz:** 14 erfüllt · 0 offen · 1 nicht anwendbar.

## Mobil (390 px)

Unter `lg` klappt das Detail direkt unter der gewählten Karte auf, nichts ist vorgewählt, die
erneute Wahl klappt zu (`ListeDetail.test.tsx`, e2e bei 390 px ohne waagerechtes Scrollen). Die
Filterleiste bricht um (`flex-wrap`), das Suchfeld nimmt höchstens die volle Breite.

## e2e nachgezogen

Die Specs, die die Seite berühren, sind auf die neue Bedienung gezogen (Karte wählen, im Detail
handeln, Dialog statt Paneel); Ergebnisse im PR.
