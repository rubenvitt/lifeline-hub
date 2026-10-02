# Prüfliste Einsatztauglichkeit — Fotos und Dateien an der Person (LFH-757)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Sie liegt bei Planung und Spec der Change
`lfh-757-personen-anhaenge` (Ablageort wie LFH-554/625/726).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/personen/:personId` (neuer aufklappbarer Abschnitt „Fotos und Dateien“ zwischen „Zuordnungen“ und „Zugriffs-Audit“, Dialog „Datei ablegen · Person R-nnn“) |
| Stand | Branch `claude/ecstatic-archimedes-elt6t1`, 02.10.2026 |
| Zielkontext | Fükw (1280–1366 px) und Führungs-Tablet in „Handschuh“; ortsfeste Stelle (BHP/UHS) zum Ablegen eines Fotos zur Identifikation oder Übergabe |
| Nicht enthalten | Bildvorschau (LFH-759), Offline-Ablage, Anhänge im Personendruck/CSV — Nicht-Ziele aus design.md |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Abschnitt** (Liste, Download-Anker, Entfernen, Leer/Laden/Fehler) | `pages/personen/PersonAnhaenge.tsx` → `components/anhaenge/ObjektAnhaenge.tsx` (`huelle="abschnitt"`) | ja: `e2e/personen-anhaenge.spec.ts` |
| **2 · Ablegen-Dialog** | `components/anhaenge/AnhangAblegenModal.tsx` — derselbe Baustein wie am Schaden | ja: `e2e/schaden-anhaenge.spec.ts` (geteilter Dialog), Titel hier gemessen |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt im Beleg **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/personen-anhaenge.spec.ts` „Person: aufklappen, ablegen …“ | Beim Öffnen der Person **kein** Abruf der Anhangliste → Aufklappen → Leerzustand → Dialog „Datei ablegen · Person R-001“ → `Erika_Mueller.jpg` → Zeile mit `href` auf die Personenroute → Klick löst `download` mit dem Dateinamen aus → Zugriffs-Audit zeigt „Datei geladen“ → ETB zeigt „Person R-001: Foto abgelegt“, kein Text mit „Mueller“ oder „Erika“ → Entfernen mit Rückfrage → Leerzustand → Liste über die Adresse eines zweiten Einsatzes 404 |
| derselbe Spec, Tab-Folge (1280 px, Admin) | **gemessen:** Kopf „Fotos und Dateien“ (Enter klappt auf, Fokus bleibt am Kopf) → `Datei ablegen` → Anker „arm.jpg, 36 B, Datei von Person R-001 herunterladen“ → „Original (mit Standort) herunterladen: arm.jpg, Person R-001“ → „Datei arm.jpg von Person R-001 entfernen“ |
| derselbe Spec, Dichte-Staffel (1280 px) | **kompakt:** Kopf 36 · Ablegen 30 · Anker 46,6 · Entfernen 30 px. **komfortabel:** 48 · 48 · 51,4 · 48 px. **handschuh:** 72 · 72 · 72 · 72 px (Boden je Stufe 30 / 48 / 72 als Literale) |
| derselbe Spec, Dichte-Staffel als **Beobachter** (LFH-435, `rollen-kern.ts`) | Vorbedingung: im Abschnitt kein Knopf und kein Original-Verweis; Kopf und Anker ≥ 30 / 48 / 72 px |
| `e2e/schaden-anhaenge.spec.ts` (geteilter Block und Dialog) | Dialog-Tabfolge `Datei wählen → Abbrechen → Speichern und nächste → Ablegen` ohne zweiten Stopp; Serien-Fokus zurück auf „Datei wählen“; Kontrast Tag 8,72 / 12,04, Nacht 10,38 / 12,10; Fokus-Verdeckung 60 Stopps, 31 in den Zeilen, 0 verdeckt. Lokal mit dem vorinstallierten Chromium 1194 gemessen; der Download-Dateiname mit Umlaut (`Müller_Hauswand.jpg`) kommt dort als „download“ an — auch mit dem `alpha`-Stand der Schadensdateien, also ein Befund der Browser-Version, kein Befund dieses Changes (die CI fährt den gepinnten Browser) |
| Vitest | `ObjektAnhaenge.test.tsx` (Hülle „abschnitt“: kein Paneel, „Datei ablegen“ vor der Liste, Kennung „Person R-007“ im Namen; ohne Schreibrecht keine Knöpfe), `AnhangAblegenModal.test.tsx` (Erfassungs-Norm, `accept`, Serie, Ablehnung im Dialog, zu große Datei sendet nicht), `SchadenAnhaenge.test.tsx` unverändert grün über den Adapter, `PersonenDetailPage.test.tsx` (Liste erst beim Aufklappen und genau einmal; Beobachter ohne Aktionen; stornierte Person ohne Aktionen; kein `<form>` im `<form>`; Audit „Datei geladen“ statt Rohwert), `zugriffArt.test.ts`, `queryKeys.test.ts` (`person` invalidiert die Anhangliste, nicht das auditierte Detail; nicht offline) |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 (Rollen) · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 (`dichte.guard.test.ts` grün) · Emoji 0 (Ikonen in `aria-hidden`-Hülle) · Rot neben Neutralem mit `Space size="middle"` (`aktionsabstand.guard.test.ts` grün) |

---

## Tabelle 1 — Abschnitt „Fotos und Dateien“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Kopf über `antdKlappkopf`, Anker über `downloadAnkerStil`, Ablegen und Entfernen als antd-`Button`; gemessen ≥ Staffel in allen drei Stufen | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px für Kopf, Ablegen, Anker und Entfernen (gemessen) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Download als `<a download>`, die Rückmeldung gibt der Browser; Entfernen lädt am Knopf der betroffenen Zeile (geteilter Block, Vitest am Schaden-Adapter) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Entfernen per `Popconfirm` mit rotem OK-Knopf, kein Rückgängig-Toast (e2e und Vitest) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | Derselbe Block mit denselben Rollen wie am Schaden, dort gemessen (8,72 / 12,04 Tag, 10,38 / 12,10 Nacht) [abgeleitet für den Abschnitt; die Fläche der `Collapse` ist der Seitengrund] | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Leer, Laden, Fehler in Worten (`PaneelZustand`), „n Dateien“ als Wort, Zweck jedes Knopfs im zugänglichen Namen | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau = Bedienung am Anker, Rot nur am Entfernen mit Abstand `middle` | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen → LFH-397** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Lade- und Entfernen-Fehler als `role="alert"` im Abschnitt, die betroffene Zeile trägt `data-fehler` (geteilter Block, Vitest am Schaden-Adapter) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen → LFH-760** | Das `person`-Ereignis lädt die aufgeklappte Liste neu; eine Ablage aus einer anderen Sitzung erscheint oben und schiebt die Zeilen. Gleicher Befund wie am Schaden, der geteilte Block zieht mit dem Sammelbanner aus LFH-760 nach | LFH-760 |
| 13 | **Fokus nie verdeckt** | **erfüllt** | Nach dem Entfernen fällt der Fokus auf die nächste Zeile bzw. „Datei ablegen“ (geteilter Block, Vitest); Tab-Durchlauf des Blocks unter der Kopfzeile am Schaden gemessen (0 verdeckt) [abgeleitet für den Abschnitt: dieselbe Kopfzeile, der Abschnitt hat keinen eigenen Scrollbereich] | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Liste, keine Tabelle („was ist mit dieser Person?“, LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Lese- und Aktionsfläche; die Maske ist Tabelle 2 | — |

**Bilanz:** 10 erfüllt · 2 offen · 3 nicht anwendbar.

## Tabelle 2 — Ablegen-Dialog

Derselbe Baustein wie am Schaden (`AnhangAblegenModal`); die Verdikte aus
`2026-09-25-lfh-21-pruefliste.md`, Tabelle 2, gelten unverändert (10 erfüllt · 1 offen → LFH-397 ·
4 nicht anwendbar). Hier zusätzlich gemessen: der Titel nennt die Person („Datei ablegen · Person
R-001“, e2e), und die Ablage aus dem Abschnitt invalidiert Anhangliste und ETB (Baustein-Vitest).

## Grenzen (benannt, kein Kriterium)

**Scan-Fund (422):** Ein echter clamd-Fund ist im Testlauf nicht herstellbar (wie an Schäden,
LFH-21 Risks). Die Personenroute ruft dieselbe Prüfkette `anhang::pruefe_vor_persist` wie Schaden
und Dokumentenablage; `anhang::entscheide` ist unit-getestet, die Reihenfolge „Scan vor jeder
Schreiboperation“ belegt der 503-Test in `tests/person_anhang_scan.rs`.

**Lese-Audit:** Jeder Abruf der Datei schreibt eine Zeile ins Zugriffsprotokoll, auch ein 304 aus dem
Browser-Cache und das Original. Was nach dem Download mit der gespeicherten Datei auf dem Gerät
geschieht, sieht kein Audit; der Ausgleich ist die bereinigte Fassung ohne Standort (LFH-747).
Ein `HEAD` auf die Datei-Route schreibt ebenfalls eine Zeile (axums `get` beantwortet ihn), ohne
Bytes zu liefern — Über-Protokollierung, kein Leck.
