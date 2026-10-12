# Prüfliste Einsatztauglichkeit: Druckansicht eines Auftrags (LLH-1171)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7; `frontend/AGENTS.md`) verlangt diese Liste an jeder neuen oder umgebauten Seite.
Planung und Specs liegen daneben (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/auftraege/:auftragId/druck` (neu, Druckansicht). Umgebaut: Detail eines Auftrags (`auftraege/AuftragDetail.tsx`, Sprung „Druckansicht“ am Ende) |
| Stand | Branch `claude/practical-turing-3knvbu` gegen `alpha` |
| Zielkontext | Fükw und ortsfeste Stelle (schriftliche Übergabe, Ablage). Führungs-Tablet und Handy: Lesen und PDF |
| Nicht enthalten | Mehrere Aufträge auf einem Blatt, Druck aus der Geräteansicht, Namen der Quittierenden (design.md, Non-Goals). Echter Umbruch in Firefox und Safari: Handprüfung wie bei allen Druckstücken |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/druck-fluss.spec.ts`, Fall „Auftrag“ | Grün in Chromium: Druckwurzel `static` und oben, Kopfleiste und Rail `display: none`, jeder Titel im Titelblock, Endmarke (Vollzugsvermerk) jenseits der ersten Seite, PDF mehrseitig mit Seitenzählung, nach der Endmarke nur die Zählung. Gegenprobe ohne `data-lfh="druckwurzel"` rot. Firefox und WebKit: CI des PRs (`DRUCK_SPECS`) |
| `e2e/auftrag-druck.spec.ts` | Beobachter öffnet aus dem Detail „Druckansicht“ und kehrt zurück; am Handy bleibt das Blatt mit einem Wort ohne Umbruchstelle für Admin und Beobachter bei 390 px. Gegenprobe ohne `overflow-wrap` am `dd` rot |
| Vitest | Neu: `auftraege/AuftragDruckBlatt.test.tsx`, `pages/AuftragDruckPage.test.tsx`, `druckFelder` in `auftraege/auftragsschemaKern.test.ts`. Ergänzt: `queryKeys.test.ts`, `deeplinks.test.ts`, `modulRegistry.test.ts`, `AuftragDetail.test.tsx`, `druck/druck.test.ts` |
| Mutationsproben | (1) `druckFelder` mit eigener Liste, `READ_ORDER` umgestellt → Teilfolgen-Test rot. (2) Key unter `auftraege` statt eigenem Prefix → Schnappschuss-Test rot. (3) Ohne Eintrag in `NICHT_LIVE_KEYS` → Guard rot. (4) Ohne Druckwurzel → e2e-Druckfall rot |
| Review | Unabhängiges Review: kein blockierender Befund. Plan an die Umsetzung angeglichen, Prüfliste, `overflow-wrap` am `dd`, schärfere Seitentests, Bezeichner nach LFH-1312 |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `theme.useToken`) · `animation`/`blink` 0 · `size=` 0 · Emoji 0 · `window.print` 0 |

---

## Tabelle: Druckansicht eines Auftrags (und Sprung im Detail)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Bedienziele der Seite sind antd-`Button` mit Steuerhöhe der Dichte-Staffel („Zurück zu Aufträge/Befehle“, „Neu laden“, `DruckKnopf`). Der Sprung im Detail ist `DetailSprung` mit `minHeight: controlHeight`. Das Blatt hat keine Bedienziele | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Kein punktuelles `size`; die Knöpfe folgen dem Dichte-Token | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | „Auftrag wird geladen …“ als `role="status"`, Drucken bis dahin gesperrt; Fehler, „Auftrag nicht gefunden“ und „Kein Zugriff auf die Aufträge“ stehen an der Seite, der Fehler mit „Erneut laden“ (`AuftragDruckPage.test.tsx`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite ändert nichts; Drucken öffnet den Druckdialog des Browsers | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Werte in `colorText`, Etiketten in `colorTextSecondary` (`druck/ZeilenListe.tsx`, Tokens). Auf Papier gilt „Papier ist hell“ aus `druck.css` | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Phase, Quittung („nicht quittiert“ bzw. Zeitpunkt) und Aufhebung stehen als Wort; das Blatt nutzt keine Statusfarbe | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit und nur `@media screen` | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Druckkopf mit Kennung und Stand steht oben; Sperre und Fehler ersetzen das Blatt, statt unter ihm zu stehen | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Keine Meldung, kein Toast, kein Ton | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Schnappschuss: das Ereignis `auftrag` ändert das offene Blatt nicht, erst „Neu laden“ (Seitentest mit Invalidierung) | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste auf der Seite | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle; das Blatt ist eine Etikett-Wert-Liste. Bei 390 px ragt nichts heraus (e2e, auch mit einem Wort ohne Umbruchstelle) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Es gibt keine Erfassung | — |

**Bilanz:** 12 erfüllt · 0 offen · 3 nicht anwendbar.
