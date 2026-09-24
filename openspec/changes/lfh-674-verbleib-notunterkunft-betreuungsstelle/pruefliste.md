# Prüfliste Einsatztauglichkeit — Verbleib „Notunterkunft“ → Betreuungsstelle (LFH-674)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7). Planung und Spec liegen daneben in diesem Change.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Flächen | **1 · Verbleib-Dialog** (`personen/VerbleibErfassung.tsx`, geöffnet auf `/einsaetze/:id/personen/:personId` über „Verbleib erfassen“) · **2 · Zelle „belegt“** der Tabelle Betreuungsstellen (`betreuung/StellenBlock.tsx` auf `/einsaetze/:id/betreuung`) |
| Zielkontext | Fükw (Tastatur + Maus) und Führungs-Tablet. Der Dialog ist ein Modal mit höchstens drei sichtbaren Feldern |
| Nicht enthalten | Namensliste an der Stelle, Personen-Marker auf der Karte, Verweis bei anderen Verbleib-Arten (Non-Goals in `design.md`) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `personen/VerbleibErfassung.test.tsx` (10 Tests) | Hülle ohne `.ant-modal-footer`, Knopf im `<form>`; Transport: genau 3 Felder, nach „Weitere Angaben“ mehr; Stellenwahl belegt „Ziel“ vor, eigener Text bleibt, unveränderte Vorbelegung wird beim Wechsel ersetzt; Artwechsel schickt keinen Verweis; ohne Modul Betreuung weder Abruf noch Auswahl; 403 ist keine Fehlermeldung; Ablehnung steht im Dialog, Felder bleiben |
| `personen/verbleibErfassungKern.test.ts` | Felder je Art, Optionen (storniert fehlt, „· geschlossen“ wählbar), Vorbelegungsregel, Body |
| `pages/BetreuungPage.test.tsx` „davon namentlich“ (3 Tests) | Text in der Zelle, ohne Meldung ohne „davon“; Kopfsumme und „frei“ unverändert; ohne `namentlich` in der Antwort nirgends Text |
| `tests/verbleib_betreuungsstelle.rs` (9 Tests) | Prüfkette 422 → 403 → 404 → 409, geschlossen 201; kein Stellenname in Kurzform und ETB; Zahl nur mit Personenrecht; Kopfzahl und Belegung unverändert; Lagestand ohne Zahl |
| Browser-Durchstich | siehe unten |

## Tabelle — Verbleib-Dialog und Stellenzelle

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Nur antd-Steuerelemente über `components/Select`, `Input`, `Collapse` und die Knöpfe der Erfassungs-Hülle; kein handgebautes Bedienziel. Die Zahl in der Stellenzelle ist Text, kein Ziel | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Alle Ziele erben `controlHeight` vom `ConfigProvider`; kein punktuelles `size` in den neuen Dateien (Grep) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `laeuft` setzt den Erfassen-Knopf auf Ladeanzeige, bis der POST zurück ist; die Stellenauswahl zeigt „Stellen werden geladen …“ | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Ein Verbleib ist ein append-only Ereignis und wird durch das nächste abgelöst; weder Storno noch Löschen | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Neuer Text nur in Bestandsbausteinen: Formular-Labels, `Typography.Text type="secondary"` wie das vorhandene „keine Meldung“ in derselben Zelle, `SpeicherFehler` (Alert). Keine neue Farbe | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „· geschlossen“ steht als Wort im Optionslabel; „davon namentlich n“ ist Text | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe, keine Rolle neu belegt | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die namentliche Zahl steht in derselben Zelle wie die Belegung, direkt hinter ihr; ein Ablehnungsgrund steht im Dialog, nicht im Toast | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme. Das Live-Ereignis `person` invalidiert zusätzlich nur die Betreuungsübersicht | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Die Zahl ändert sich live innerhalb der Zelle, die Tabellenzeile wandert nicht (Sortierung liest weiter nur `belegung.belegt`). Im Dialog erscheint das Stellenfeld erst nach der Artwahl, also als Folge der eigenen Handlung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Modal der Erfassungs-Hülle ohne stehende Fußleiste; Fokus bleibt im Dialog | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | Die Stellentabelle bleibt `Datensicht form="tabelle"` mit fixierter Bezeichnung und Spaltenschalter (LFH-639); die Zahl ist Zelleninhalt, keine neue Spalte | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** mit einer Einschränkung | Labels über dem Feld, Enter sendet über den Knopf im `<form>` (Struktur geprüft, weil `art` ein `Select` ist), Vorbelegung sichtbar und überschreibbar (Ziel). Kein Serienmodus: ein Verbleib gehört zu genau einer Person, die Maske öffnet aus deren Detailseite | — |

**Bilanz:** 12 erfüllt · 1 offen · 2 nicht anwendbar.

## Browser-Durchstich

_wird nach dem Lauf eingetragen_
