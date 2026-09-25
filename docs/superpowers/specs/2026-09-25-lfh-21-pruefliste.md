# Prüfliste Einsatztauglichkeit — Fotos und Dateien am Schaden (LFH-21)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Spec liegen in
`openspec/changes/lfh-21-schaden-anhaenge/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/schaeden/:schadenId` (neues Paneel „Fotos und Dateien“ unter dem Datenraster, Dialog „Datei ablegen · Schaden S-nnn“) |
| Stand | Branch `feat/lfh-21-schaden-anhaenge`, Commit `a6446109`; die Prüfliste ist der Commit danach |
| Zielkontext | Fükw (1280–1366 px) und Führungs-Tablet in „Handschuh“ zum Ablegen und Laden; mobil lesend und ablegend (Kamerafoto, HEIC) |
| Nicht enthalten | Bildvorschau/Galerie, EXIF-Bereinigung (LFH-747), Offline-Ablage, Anhangzahl in der Schadensliste — Nicht-Ziele aus design.md |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Paneel** (Liste, Download-Anker, Entfernen, Leer/Laden/Fehler) | `pages/schaeden/SchadenAnhaenge.tsx`, `components/DownloadAnker.tsx` | ja: `e2e/schaden-anhaenge.spec.ts` |
| **2 · Ablegen-Dialog** (`ErfassungsModal` mit `serie`, `DateiFeld`) | `pages/schaeden/SchadenAnhangAblegenModal.tsx`, `components/DateiFeld.tsx` | ja: derselbe Spec |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt im Beleg **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/schaden-anhaenge.spec.ts` „legt ab, lädt herunter …“ | Fokus beim Öffnen auf „Datei wählen“ (nicht auf dem verborgenen Input) → Datei `Müller_Hauswand.jpg` → „Ablegen“ → Zeile steht → Klick löst `download` mit dem Dateinamen aus → ETB zeigt „Schaden S-001: Foto abgelegt“, kein Text mit „Hauswand“ → Entfernen mit Rückfrage → Leerzustand → Liste über die Adresse eines zweiten Einsatzes 404 |
| derselbe Spec, Tab-Reihenfolge | **gemessen:** `Datei wählen → Abbrechen → Speichern und nächste → Ablegen` — **kein zweiter Tab-Stopp** um den Auslöser (der Befund aus LFH-117 an der ETB-Schnellerfassung tritt an `DateiFeld` nicht auf; `dokumente.spec.ts` misst dasselbe für die Dokumentenablage) |
| derselbe Spec, Dichte-Staffel (1280 px) | Download-Anker, Entfernen und „Datei ablegen“ ≥ 30 / 48 / 72 px in kompakt / komfortabel / handschuh (Literale); die Fuge Anker|Entfernen hängt als Anhang am Bericht |
| derselbe Spec, Kontrast (Messkern `kontrast-kern.ts`) | **Tag:** Dateiname (`bedienText`) 7,71 · Größe und „abgelegt von · Zeit“ (`text2`) 12,04 : 1 (Boden 7). **Nacht:** 10,38 · 12,10 : 1 (Boden 5) |
| Gemessener Befund beim Bau | Der aus `DokumentePage` gehobene Anker trug antds Linkfarbe und `colorTextSecondary`; jetzt `bedienText`/`text2` (Regel aus LFH-650), wirkt auch in der Dokumentenablage |
| Vitest | `SchadenAnhaenge.test.tsx` (Laden benannt, Fehler ≠ leer, Leer mit Ausweg, Anker-`href` auf die Schadensroute, zugängliche Namen je Zeile verschieden, ohne Schreibrecht/storniert keine Aktionen, Entfernen erst nach Bestätigung mit rotem OK-Knopf); `SchadenAnhangAblegenModal.test.tsx` (Erfassungs-Norm-Struktur, `accept`, Serie hält offen und leert, 400 lässt die Auswahl stehen mit Grund im Dialog, zu große Datei sendet nicht); `DateiFeld.test.tsx`, `DownloadAnker.test.tsx` (Boden 30/48/72 als Literale, Polsterung zieht mit); `SchaedenDetailPage.test.tsx` (Paneel auch im Bearbeiten-Modus, kein `<form>` im `<form>`) |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 (Rollen) · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 (`dichte.guard.test.ts` grün) · Emoji 0 (Ikonen `UploadOutlined`/`DeleteOutlined` in `aria-hidden`-Hülle) · Rot neben Neutralem mit `Space size="middle"` (`aktionsabstand.guard.test.ts` grün) |

---

## Tabelle 1 — Paneel „Fotos und Dateien“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Anker: handgebautes Bedienziel mit `minHeight: controlHeight` plus Polsterung (`downloadAnkerStil`, Vitest mit Literalen); Entfernen und „Datei ablegen“ sind antd-`Button`. Gemessen ≥ Staffel in allen drei Stufen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px für Anker, Entfernen, „Datei ablegen“ (gemessen); kein punktuelles `size` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Download ist ein `<a download>`, die Rückmeldung gibt der Browser; Entfernen quittiert per Toast, ein Fehler steht als `SpeicherFehler` im Paneel | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Entfernen ist serverseitig ein Soft-Delete, in der Oberfläche aber ohne Rückweg → Rückfrage per `Popconfirm` mit rotem OK-Knopf („Sie verschwindet aus der Liste; der ETB-Nachweis bleibt.“), kein Rückgängig-Toast (LFH-363/343). Vitest: Mutation vor der Bestätigung 0-mal gerufen | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | 7,71 / 12,04 (Tag) · 10,38 / 12,10 (Nacht), gemessen | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Leer-, Lade- und Fehlerzustand in Worten (`PaneelZustand`); das Entfernen trägt seinen Zweck im zugänglichen Namen („Datei dach.jpg von Schaden S-003 entfernen“); Zähler „n Dateien“ als Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau = Bedienung (`bedienText` am Anker), Rot nur am Entfernen-Knopf (Gefahr, bedient nichts Neutrales) mit Abstand `middle` | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen → LFH-397** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Ein Lade-Fehler steht als `role="alert"` im Paneel („Stand unbekannt …“) und bleibt stehen; ein Entfernen-Fehler als `SpeicherFehler` über der Liste, nicht als 3-s-Toast | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen → Folgeticket „Live-Zufluss der Schaden-Anhänge als Sammelbanner“** | Das `schaden`-Ereignis invalidiert die Liste; eine Ablage aus einer anderen Sitzung erscheint oben (neueste zuerst) und schiebt die Zeilen darunter. Das Paneel steht am Seitenende, der Versatz ist eine Zeile, aber die Regel (Sammelbanner statt Einschieben) ist nicht eingelöst | Folgeticket (vorgeschlagen, nicht angelegt) |
| 13 | **Fokus nie verdeckt** | **offen → LFH-373** | Ein Tab-Durchlauf unter der stehenden Kopfzeile der Detailseite ist nicht gemessen — derselbe offene Punkt wie in den Prüflisten LFH-117/632 | LFH-373 |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Liste, keine Tabelle („was ist mit diesem Schaden?“, LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Lese- und Aktionsfläche; die Maske ist Tabelle 2 | — |

**Bilanz:** 9 erfüllt · 3 offen · 3 nicht anwendbar.

## Tabelle 2 — Ablegen-Dialog

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–2 | **Treffläche / Handschuh** | **erfüllt** | Alle Ziele sind antd-`Button` in der Erfassungshülle und erben `controlHeight`; „Datei wählen“ gemessen in der Dokumentenablage (derselbe `DateiFeld`-Baustein, `dokumente.spec.ts` Staffel) [abgeleitet für diesen Dialog] | — |
| 3 | **Rückmeldung** | **erfüllt** | Ladezustand an den Speicher-Knöpfen (`laeuft`), 120-s-Frist; Erfolg per Toast, Ablehnung als `SpeicherFehler` IM Dialog | — |
| 4 | **Zweite Handlung** | **nicht anwendbar** | Ablegen ist korrigierbar (Entfernen mit Nachweis) | — |
| 5 | **Kontrast** | **erfüllt** | Label, „Datei wählen“ und Pflichtmeldung sind derselbe Baustein wie in der Dokumentenablage, dort gemessen (`dokumente.spec.ts` Kontrast Tag/Nacht) [abgeleitet] | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Pflicht- und Größenmeldung als Wortlaut („Bitte eine Datei wählen“, „Datei ist zu groß (25 MiB erlaubt)“ — wortgleich mit dem Server) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Regler** | **offen → LFH-397** | App-weit | LFH-397 |
| 9 | **Blickfeld** | **erfüllt** | Der Ablehnungsgrund steht im Dialog und bleibt bis zum nächsten Versuch (Vitest) | — |
| 10–11 | **Alarm / Warnung** | **nicht anwendbar** | Keine Alarme, kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | [abgeleitet] Der Dialog ändert sich nur nach eigener Handlung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | [abgeleitet] Ein Feld und drei Knöpfe in einem Modal ohne Scrollbereich; `dokumente.spec.ts` misst denselben Aufbau bei 1280 und 390 px | — |
| 14 | **Tabellenseite** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsModal`: Absendeknopf im `<form>`, keine Modal-Fußzeile (Vitest); Anfangsfokus auf „Datei wählen“ (e2e); Tab-Reihenfolge ohne zweiten Stopp (e2e); Serienmodus hält offen und leert (Vitest); Reset auf allen Wegen hinaus trägt die Hülle; `mutateAsync` lässt die Auswahl bei Ablehnung stehen (Vitest); Strg/⌘ + Enter = „Speichern und nächste“ (Hülle) | — |

**Bilanz:** 10 erfüllt · 1 offen · 4 nicht anwendbar.
