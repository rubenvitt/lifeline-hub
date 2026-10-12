# Prüfliste Einsatztauglichkeit: Auftragsformular nach FwDV 100 (LLH-1091)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder umgebauten Seite. Bewertet wird nur, was sich
geändert hat:

- das Formular „Neuer Auftrag“ mit seiner Reihenfolge, den zwei Klappteilen und dem Feld „Weg“,
  in allen Einbettungen: Auftragsliste, ETB, Meldung, Chat
- die Lesefolge an der Auftragskarte
- die Schema-Auswahl im Dialog „Neuer Befehlsentwurf“

Liste, Filter, Quittung und Vollzug sind unverändert.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/auftraege` (Reiter Einzelaufträge und Befehle), dazu die Dialoge aus ETB, Meldung und Chat |
| Stand | Branch `claude/serene-cori-dsyeje` gegen `alpha` |
| Zielkontext | Fükw (primär), Führungs-Tablet mit Handschuh, mobil 390 px (Zeilen stapeln) |
| Nicht enthalten | Auftragsdruck (LLH-1171), Verteiler am Befehl (LLH-1172), Datenraster statt `Descriptions` an der Karte (LLH-1084) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Vitest `AuftragFormular.test.tsx` | 31 grün: vier Felder in Folge, Gegenproben 8 und 10, Fokus im Empfänger (auch nach „Speichern und nächste“), `weg` im Body, Überlängen aller acht Schemafelder, Selbstöffnen samt Gegenprobe, Kopf „Weitere Angaben · Richtung: Extern“ samt Rückweg |
| Vitest `AuftraegePage.test.tsx` | grün: Zeit / Wann über den Klappteil „Ausführung“ im Body der Seite |
| Vitest Kern, Karte, ETB-Dialog, Befehlsliste, Vorlagen, Befehlsdetail | `auftragsschemaKern.test.ts` (4), `AuftragKarte.test.tsx` (4), `AuftragAusEtbModal.test.tsx` (1), `BefehlListe.test.tsx`, `vorlagen.test.ts`, `BefehlDetailPage.test.tsx` (Bestand EA) grün |
| Mutationsproben | Selbstöffnen entfernt, `weg` nicht gesendet, EA-Vorlage aus `VORLAGEN` entfernt, Schwärzungsregel entfernt, Längenprüfung `weg` entfernt: je ein Test rot |
| Rust | `tests/auftrag.rs`, `tests/etb.rs`, `tests/eingabegrenzen_auftrag.rs`, `tests/befehl.rs`, Wächter `jede_einsatz_scoped_spalte_ist_klassifiziert`, Schwärzungstest am Einsatz grün |
| e2e | `chat-layout` (Aufträge auf 390 px mit beiden Klappteilen offen, kein waagerechter Überlauf), `etb-folgeauftraege`, `fuehrungsfunktionen`: 9/9 grün (Chromium) |
| e2e Prüfflächen | `trefflaeche-pruefflaechen`, `auftraege-abgeschlossen`, `gate1-ueberlauf`, `knopf-wortlaut`, `fehlertext-kontrast`: 64/64 grün (Chromium) |

---

## Tabelle: Formular „Neuer Auftrag“, Auftragskarte, Schema-Auswahl

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Nur antd-Bausteine unter dem Dichte-Kontext (`Select`, `Input`, `TextArea`, `ZeitpunktEingabe`). Die Klappköpfe erben den Boden über `antdKlappkopf(dichte)` (LFH-653), kein lokales `size`. `trefflaeche-pruefflaechen` grün | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Wie 1: die Staffel 30/48/72 wirkt über `controlHeight` und den Klappkopf-Kontext. Kein neuer handgebauter Bedienknopf | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Unverändert über die Erfassungshülle („Auftrag erteilen“ lädt, Abbrechen gesperrt). Ein Prüffehler hinter einem geschlossenen Klappteil öffnet ihn jetzt, statt das Senden lautlos zu sperren (Vitest „öffnet einen geschlossenen Klappteil …“) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Der Umbau ändert am Erteilen nichts: es geht wie bisher ohne Rückfrage. Ein erteilter Auftrag lässt sich heute nicht aufheben, das Aufheben und Berichtigen ist LLH-1098 | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Keine neue Farbe und keine neue Rolle, nur bestehende Bausteine. Das Bild `auftrag-erteilen` zeigt hell und dunkel | — |
| 6 | **Kein Status allein über Farbe** | **nicht anwendbar** | Kein Status im umgebauten Teil | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Unverändert app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Empfänger und Auftrag stehen oben, Pflicht und sichtbar. Nichts, was eine Ablehnung auslöst, liegt dauerhaft verdeckt (D4). Eine übernommene Richtung „Extern“ steht auch zugeklappt im Kopf | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Kein neuer Alarm | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Klappteile öffnen nur auf Klick oder bei einem Prüffehler nach dem Absenden, nie durch Live-Daten. Ein offener Klappteil bleibt nach „Speichern und nächste“ offen | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Kein klebendes Element im Formular. Der erste Fokus liegt im Empfänger am oberen Rand der Maske | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle im umgebauten Teil | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsFormular`: Knopf im `<form>`, Fokus im ersten Feld (jetzt Empfänger), Feldbudget vier mit Gegenprobe (8 bzw. 10), Pflichtfelder sichtbar, Grenzen aus `api/eingabegrenzen.ts` mit `zeichenRegel`, Grund einer Ablehnung im Formular. Belegt in `AuftragFormular.test.tsx` | — |

**Bilanz:** 11 erfüllt · 0 offen · 4 nicht anwendbar.

## Mobil (390 px)

Unter `sm` stapeln alle Zweierzeilen (`Col xs={24} sm={12}`), also Priorität und Frist sowie
die Schemafelder. Der Empfänger steht ohnehin in voller Breite. `e2e/chat-layout.spec.ts`
„Aufträge: auf 390 px scrollt der Body nicht waagerecht“ misst mit beiden Klappteilen offen und
ist grün.
