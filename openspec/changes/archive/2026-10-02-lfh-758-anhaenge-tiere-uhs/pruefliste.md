# Prüfliste Einsatztauglichkeit — Fotos und Dateien an Tier und UHS (LFH-758)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung
und Specs liegen in dieser Change (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/tiere/:tierId` (neues Paneel „Fotos und Dateien“) · `/einsaetze/:id/unfallhilfsstellen/:uhsId` (dritter Reiter „Dateien“ mit demselben Paneel und dem Bereich „Zugriffe“) |
| Bausteine | `components/erfassungsAnhaenge/ErfassungsAnhaenge.tsx`, `ErfassungsAnhangAblegenModal.tsx`, `anhangZufluss.ts` — dieselben trägt seit LFH-758 auch der Schaden (`pages/schaeden/SchadenAnhaenge.tsx` ist eine Hülle) |
| Zielkontext | Fükw (1280–1366 px) und Führungs-Tablet in „Handschuh“; an der UHS die ortsfeste Stelle (BHP) mit vollem Tastaturfluss; mobil lesend und ablegend (Kamerafoto, HEIC) |
| Nicht enthalten | Bildvorschau (LFH-759), Bild als Hintergrund des Platz-Layouts (LFH-999), Anhangzahl in den Listen |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Was aus dem geteilten Baustein und seinen Messungen geschlossen ist, trägt
**[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/tier-anhaenge.spec.ts` Ablauf | Tier per API → Detailseite → „Datei ablegen“, Dialogtitel „Datei ablegen · Tier T-001“ → Datei `Müller_Bello.jpg` → Zeile mit Anker auf die Tier-Route → Download per Klick → ETB „Tier T-001: Foto abgelegt“, kein Text mit „Müller_Bello“ → Entfernen mit Rückfrage → Leerzustand |
| `e2e/uhs-anhaenge.spec.ts` Ablauf | UHS per API → Reiter „Dateien“ → Dialog mit Hinweis „Jeder Abruf einer Datei wird …“ → Ablage → Download per Klick → „Zugriffe“ aufgeklappt zeigt den Abruf „bereinigt“ mit Dateiname → Entfernen → ETB „UHS BHP 50: Foto abgelegt/entfernt“, kein Dateiname |
| beide Specs, Dichte-Staffel (1280 px) | Download-Anker, Entfernen und „Datei ablegen“ ≥ 30 / 48 / 72 px in kompakt / komfortabel / handschuh, an Tier und UHS **gemessen** (Literale; die Fuge Anker|Entfernen hängt als Anhang am Bericht). Lokal in der Cloud-Sitzung grün (Chromium 1194) |
| `e2e/schaden-anhaenge.spec.ts` am selben Baustein | Tabfolge im Dialog **gemessen** am 02.10.2026: `Datei wählen → Abbrechen → Speichern und nächste → Ablegen` (kein zweiter Stopp um den Auslöser); Fokus nach „Speichern und nächste“ wieder auf „Datei wählen“; Kontrast Tag/Nacht und Fokus-Verdeckung grün — alle acht Läufe dieses Specs grün außer dem Download-Dateinamen, den der ältere Browser der Sitzung als „download“ meldet (am unveränderten Bestand ebenso) |
| Vitest | `ErfassungsAnhangAblegenModal.test.tsx` (Erfassungs-Norm, `accept`, Titel mit Besitzer, Hinweis nur wenn gesetzt, Serie, Ablehnung im Dialog, zu große Datei), `anhangZufluss.test.ts` (10), `SchadenAnhaenge.test.tsx` (unverändert grün über die Hülle, samt Zufluss aus LFH-760), `TiereDetailPage.test.tsx` (Paneel, Anker-`href`, kein `<form>` im `<form>`, auch im Bearbeiten-Modus; storniert und Beobachter ohne Aktionen), `UhsAnhaenge.test.tsx` (Anker, Hinweis im Dialog, storniert ohne Aktionen, „Zugriffe“ nur für die Einsatzleitung, Abruf erst beim Aufklappen, leer/Fehler benannt, keine Wiederholung, Sammelbanner bei fremder Ablage), `UhsDetailPage.test.tsx` (dritter Reiter je Rolle) |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 (`dichte.guard.test.ts` grün) · Emoji 0 · Rot neben Neutralem mit `Space size="middle"` (`aktionsabstand.guard.test.ts` grün) |

---

## Tabelle 1 — Paneel „Fotos und Dateien“ an Tier und UHS

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Anker (`DownloadAnker`, Boden über `controlHeight`), Entfernen und „Datei ablegen“ an Tier und UHS in allen drei Stufen gemessen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px an Tier und UHS gemessen; kein punktuelles `size` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | [abgeleitet, Baustein] Ladezustand am Entfernen-Knopf der Zeile bis zur Antwort (Vitest am Schaden über denselben Baustein); Download gibt der Browser zurück | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Entfernen nur über `Popconfirm` mit rotem OK-Knopf, kein Rückgängig-Toast; e2e klickt die Rückfrage an Tier und UHS | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | [abgeleitet] Derselbe Baustein und dieselben Rollen wie am Schaden; dort Tag/Nacht gemessen und grün | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Leer-, Lade- und Fehlerzustand in Worten; Zähler „n Dateien“; Fassung im Protokoll als Wort („bereinigt“, „Original (mit Standort)“) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau am Anker, Rot nur am Entfernen-Knopf mit Abstand `middle` | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | App-weit seit LFH-397 (Regler mit Warnsperre); das Paneel bringt keine eigene Fläche mit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Lade- und Entfernen-Fehler stehen im Paneel (Alert, `data-fehler` an der Zeile), nicht im Toast; ein Fehler des Protokolls steht als Alert im Bereich „Zugriffe“ | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Fremde Ablagen warten hinter dem Sammelbanner (Überlagerung mit Nullhöhe), eigene stehen sofort — Schleuse aus LFH-760 im Baustein; Vitest an UHS und Schaden | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Baustein am Schaden unter der stehenden Kopfzeile gemessen; nach dem Entfernen und nach „anzeigen“ fällt der Fokus nicht auf `<body>` (Vitest) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Die Dateiliste ist eine Liste („was ist mit diesem Tier, dieser UHS?“, LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Maske ist Tabelle 2 | — |

**Bilanz:** 12 erfüllt · 0 offen · 3 nicht anwendbar.

## Tabelle 2 — Ablegen-Dialog (Tier und UHS)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–2 | **Treffläche / Handschuh** | **erfüllt** | [abgeleitet] antd-Knöpfe der Erfassungshülle erben `controlHeight`; „Datei wählen“ in der Dokumentenablage über die Staffel gemessen (derselbe `DateiFeld`) | — |
| 3 | **Rückmeldung** | **erfüllt** | `laeuft` an den Speicher-Knöpfen, 120-s-Frist; Ablehnung als `SpeicherFehler` im Dialog (Vitest) | — |
| 4 | **Zweite Handlung** | **nicht anwendbar** | Ablegen ist korrigierbar (Entfernen mit Nachweis) | — |
| 5 | **Kontrast** | **erfüllt** | [abgeleitet] Der Hinweis an der UHS ist `Typography.Paragraph type="secondary"` (`colorTextDescription` = `gedaempft`, Regel LFH-652); übrige Teile wie am Schaden gemessen | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Pflicht- und Größenmeldung als Wortlaut; der Protokoll-Hinweis als Satz | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Regler** | **erfüllt** | App-weit (LFH-397) | — |
| 9 | **Blickfeld** | **erfüllt** | Ablehnungsgrund bleibt im Dialog bis zum nächsten Versuch (Vitest); der UHS-Hinweis steht über dem Dateifeld, vor der Handlung | — |
| 10–11 | **Alarm / Warnung** | **nicht anwendbar** | Keine Alarme, kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | [abgeleitet] Der Dialog ändert sich nur nach eigener Handlung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Ein Feld, ein Hinweis, drei Knöpfe in einem Modal ohne Scrollbereich | — |
| 14 | **Tabellenseite** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsModal`: Absendeknopf im `<form>`, keine Fußzeile (Vitest); Tabfolge ohne zweiten Stopp und Serien-Fokus auf „Datei wählen“ (e2e am Baustein, 02.10.2026); der Hinweis ist kein Tab-Stopp | — |

**Bilanz:** 11 erfüllt · 0 offen · 4 nicht anwendbar.

## Tabelle 3 — Bereich „Zugriffe“ (UHS, nur Einsatzleitung)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–2 | **Treffläche / Handschuh** | **erfüllt** | [abgeleitet] Klappkopf über `antdKlappkopf(dichte)` am `ConfigProvider` (LFH-653, 30/48/72) | — |
| 3 | **Rückmeldung** | **erfüllt** | Ladezustand der Tabelle bis zur Antwort | — |
| 4 | **Zweite Handlung** | **nicht anwendbar** | Nur Lesen | — |
| 5 | **Kontrast** | **erfüllt** | [abgeleitet] `KatalogTabelle` mit Kopf in `gedaempft` (LFH-652) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Fassung als Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine Farbe | — |
| 8 | **Regler** | **erfüllt** | App-weit (LFH-397) | — |
| 9 | **Blickfeld** | **erfüllt** | Fehler als Alert im Bereich, nicht als leere Tabelle (Vitest) | — |
| 10–11 | **Alarm / Warnung** | **nicht anwendbar** | — | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Das Protokoll ist nicht live (`NICHT_LIVE_KEYS`) und ändert sich nur beim Aufklappen | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Klappbereich im Seitenfluss, keine stehende Fläche darüber außer der Kopfzeile (Schaden-Messung) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Kurzes Protokoll in einem Klappbereich, keine Katalogseite; ohne Spaltenschalter, weil vier feste Spalten in jeder Breite tragen | — |
| 15 | **Erfassungsmaske** | **nicht anwendbar** | Keine Erfassung | — |

**Bilanz:** 9 erfüllt · 0 offen · 6 nicht anwendbar.
