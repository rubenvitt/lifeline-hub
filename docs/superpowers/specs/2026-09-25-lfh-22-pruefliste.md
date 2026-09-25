# LFH-22 / LFH-71 · Druck — Prüfliste Einsatztauglichkeit

Angelegt an die neue **ETB-Druckansicht** (`/einsaetze/:id/etb/druck`, `pages/EtbDruckPage.tsx`,
`etb/EtbDruckTabelle.tsx`) und an die umgebauten Druckansichten **Lagebericht**
(`pages/LageberichtDetailPage.tsx`), **Befehl** (`pages/BefehlDetailPage.tsx`) und **Meldebild**
(`pages/KraefteuebersichtPage.tsx`). Grundlage: Change `openspec/changes/lfh-22-druck-export/`
(design.md D1–D10), Kriterien aus `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7).

Die drei Bestandsseiten behalten ihre Bildschirm-Verdikte (LFH-338, LFH-340, LFH-348, LFH-350).
Hier steht nur, was der Druck an ihnen ändert, und die neue ETB-Druckansicht vollständig.

## Formverdikt (LFH-19 / LFH-330)

**ETB-Druckansicht: Tabelle, als benannte Ausnahme.** Zwei Regeln gelten dort ausdrücklich
nicht: „das ETB ist auf allen Breiten eine Zeitachse" (Neuentwurf S4) und „Tabelle nur, wenn
verglichen wird". Die Druckansicht ist kein Bedienort, sondern die Papierform des
Einsatztagebuchs (Vordruck mit Nr., Zeit, Typ, Von/An, Inhalt, Erfasser). Deshalb ein
schlichtes `<table>` ohne Sortierung, Filter, Spaltenschalter und Zeilenaktion — weder
`KatalogTabelle` noch `Datensicht` (die Guards `katalogTabelle.guard`, `datensicht.guard`,
`statusVertrag.guard` laufen unverändert grün). Ordnung aufsteigend nach `lfd_nr`: auf Papier
beweist die lückenlose Nummernfolge die Vollständigkeit.

## Browser-Verdikt (Aufgabe 5.1)

Firefox und Safari prüft **vor dem Merge ein Mensch** nach der Anleitung unten; die
automatische Prüfung beider Browser (Playwright-Projekte, dazu Logo und Seitenzählung im PDF)
ist **LFH-729**. Eine Zelle „offen → Handprüfung …" ist kein Verdikt „erfüllt": sie wird mit
dem Beleg der Handprüfung umgeschrieben.

| Druckstück | Chromium | Firefox | Safari |
| --- | --- | --- | --- |
| Lagebericht lesend (> 2 Seiten) | **erfüllt** (`e2e/druck-fluss.spec.ts`: Wurzel im Fluss, Rahmen weg, Endmarke jenseits Seite 1, PDF mehrseitig) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Lagebericht Entwurf, Vorgabe ohne Vorschau (> 2 Seiten) | **erfüllt** (`druck-fluss.spec.ts`, Standardzustand ohne Haken: Endmarke des letzten, zugeklappten Abschnitts als dargestellter Markdown-Absatz jenseits Seite 1, kein sichtbares Textfeld, offene `message` weg) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Lagebericht Entwurf, „Vorschau neben dem Text" | **erfüllt** (`druck-fluss.spec.ts`, Split-Fall) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Befehl lesend und Entwurf (> 1 Seite) | **erfüllt** (`druck-fluss.spec.ts`, beide Zweige) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Meldebild (> 1 Seite, Kopf je Seite) | **erfüllt** für Neutralisierer/Breite bei 680 px (`e2e/meldebild-tabelle.spec.ts`) und für die Voraussetzung der Kopfwiederholung: im Druck EINE Tabelle mit `thead` als `table-header-group`, über den Knopf (Stand im Moment von `window.print` festgehalten) und über Strg+P, Seitenkopf `display: none`, nach `afterprint` wieder stehende Kopfzeile | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| ETB-Druck (mehrseitig, 500+ Einträge) | **erfüllt** für Fluss/Rahmen/`thead` (`e2e/etb-druck.spec.ts`) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Abschnittstitel nicht allein am Seitenende (Entwurf) | **erfüllt** für die Kaskade: `break-after: avoid` greift am Akkordeonkopf bzw. Feldetikett (`druck-fluss.spec.ts`, `getComputedStyle`). Den Umbruch selbst zeigt nur das Blatt: **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Logo im Druckkopf | **offen → LFH-729** (kein e2e mit Logo; Handprüfung vor dem Merge) | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** | **offen → Handprüfung durch den Menschen vor dem Merge, automatisiert in LFH-729** |
| Seitenzählung „Seite n von m" | **offen → LFH-729** (Randfeld nicht automatisch lesbar, PDF-Text ist komprimiert; Handprüfung vor dem Merge) | nicht anwendbar (D3: kein Randfeld in Firefox) | nicht anwendbar (D3: kein Randfeld in Safari) |
| Titel und Zeitstand im Entwurfsdruck | **offen → LFH-731** (stehen noch als Eingabefelder auf dem Blatt; der Druckkopf nennt den Titel bereits) | **offen → LFH-731** | **offen → LFH-731** |

### Anleitung für die Handprüfung

Vorbereitung (einmal):

1. App starten, als Admin anmelden. Unter **Verwaltung › Organisation** einen Namen setzen
   (z. B. „DRK KV Musterstadt") und ein PNG-Logo (unter 1 MiB) hochladen.
2. Einen Einsatz anlegen. Im Modul **Lageberichte** einen Bericht mit Vorlage
   „Lagebericht" anlegen und jeden Abschnitt mit mehreren Absätzen füllen, sodass der Text
   über **mehr als zwei Seiten** reicht; in den letzten Abschnitt ein erkennbares Wort
   („ENDE-LAGEBERICHT") schreiben. Einen zweiten Bericht so füllen und **freigeben**.
   Tipp: der Seeding-Teil von `frontend/e2e/druck-fluss.spec.ts` (`lageberichtSaeen`,
   `befehlSaeen`) zeigt, welche API-Aufrufe genügen.
3. Unter **Aufträge › Befehle** einen Befehl „Befehl LAD" mit langem Text anlegen und
   freigeben.
4. Im **Meldebild** so viele Kräfte, dass die Tabelle mit „Mit Mitteln" über eine Seite geht
   (z. B. 40 Ad-hoc-Kräfte, Seeding wie `e2e/meldebild-tabelle.spec.ts`, `seedeKraefte`).
5. Im **ETB** mehrere hundert Einträge (Seeding wie `e2e/etb-druck.spec.ts`), darunter ein
   Nachtrag (Ereigniszeit zwei Stunden zurück) und eine Berichtigung.

Je Browser (Firefox, Safari; Chromium als Vergleich) und je Druckstück: „Drucken / als PDF"
wählen, in der Druckvorschau prüfen und als PDF speichern:

- [ ] **Vollständig:** Das letzte Wort des letzten Abschnitts bzw. die letzte Tabellenzeile
      steht im Ausdruck. Keine Seite ist abgeschnitten, keine Leerseite am Ende.
- [ ] **Kein Rahmen:** Kopfleiste, Kategorieleiste, Modulpanel, Seitenkopf mit Knöpfen,
      Umschalter „Vorschau neben dem Text", offene Meldungen erscheinen nicht; der Text beginnt
      oben auf Seite 1 und nutzt die volle Breite.
- [ ] **Druckkopf auf Seite 1:** Organisationsname und Logo, Dokumentart mit Titel, Einsatz
      mit Einsatznummer, Stand bzw. Auswahl, „Erstellt von", „Gedruckt" mit Uhrzeit der
      Organisation.
- [ ] **Umbruch:** Ein Abschnittstitel steht nicht allein am Seitenende; Absätze und
      Tabellenzeilen sind nicht zerrissen; der Tabellenkopf (Meldebild, ETB) wiederholt sich
      auf jeder Folgeseite.
- [ ] **Papier hell:** Im Nachtbetrieb gedruckt steht schwarzer Text auf weißem Grund.
- [ ] **Entwurf:** Jeder der acht Abschnitte steht genau einmal da, auch die zugeklappten —
      als formatierter Text, **in der Vorgabe** (Haken „Vorschau neben dem Text" aus) ebenso
      wie mit Haken; kein Eingabefeld mit abgeschnittenem Rohtext.
- [ ] **ETB:** Nummern lückenlos aufsteigend, Nachtrag mit „nachgetragen um", Berichtigung
      mit „berichtigt Nr." und Grundeintrag mit „berichtigt durch Nr.". Gefiltert (z. B. Typ
      Meldung): Auswahl im Kopf, „berichtigt durch" am Grundeintrag trotz fehlender
      Berichtigungszeile.
- [ ] **Seitenzählung:** in Chromium „Seite n von m" unten rechts; in Firefox/Safari leer
      (erwartet) — dort ggf. die Kopf-/Fußzeile des Browsers einschalten.

Belege (PDF oder Bildschirmfoto je Browser und Druckstück) gehören hier unter die Tabelle.

## Prüfliste — ETB-Druckansicht

| #   | Kriterium                             | Verdikt                             | Begründung |
| --- | ------------------------------------- | ----------------------------------- | ---------- |
| 1   | Treffläche                            | **erfüllt**                         | Alle Bedienziele sind antd-`Button` (auch „Zurück zum ETB" als `Button href`), Höhe vom `ConfigProvider`, kein punktuelles `size`. Die Tabelle hat keine Bedienziele. |
| 2   | Handschuh-Modus                       | **erfüllt**                         | Siehe 1: die Knöpfe erben die Staffel 30/48/72. |
| 3   | Rückmeldung vor der Serverantwort     | **erfüllt, mit benanntem Rest**     | Der Vollabruf nennt seinen Fortschritt („n Einträge geladen …", `role="status"`), „Drucken" steht bis zum vollständigen Stand gesperrt da. Rest: Ist die Organisation beim Klick noch nicht geladen, öffnet der Dialog erst danach, ohne eigenes Wartezeichen am Knopf — ein `loading` benennte ihn um (LFH-495). Im Betrieb ist die Organisation beim Seitenaufbau längst geladen. |
| 4   | Kritische Aktion mit zweiter Handlung | **nicht anwendbar**                 | Drucken und Neu laden ändern nichts. |
| 5   | Kontrast in beiden Modi               | **Papier erfüllt; Bildschirm offen → LFH-730** | Papier: `druck/druck.css` setzt Text schwarz und Grund transparent mit `!important` in der Wurzel, `body` weiß. Bildschirm-Vorschau: nur Tokenfarben (`colorTextSecondary`, `colorBorder*`), aber für diese Fläche nicht eigens mit `e2e/kontrast-kern.ts` gemessen. |
| 6   | Kein Status allein über Farbe         | **erfüllt**                         | Der ETB-Typ steht als Wort, ohne Farbe; Nachtrag und Berichtigung als Text. |
| 7   | Eine Farbe = eine Bedeutung           | **erfüllt**                         | Keine Farbträger in der Tabelle. |
| 8   | Helligkeitsregler                     | **offen → LFH-397**                 | App-weite Lücke, unverändert. |
| 9   | Kritische Anzeigen im Blickfeld       | **erfüllt**                         | Der Druckkopf steht über der Tabelle und nennt Auswahl, Umfang und Stand mit höchster Nummer — am Bildschirm wie auf Seite 1. |
| 10  | Alarmbudget                           | **nicht anwendbar**                 | Keine Alarme. |
| 11  | Warnverhalten                         | **erfüllt**                         | Kein Blinken, keine Animation. |
| 12  | Kein Sprung unter dem Cursor          | **erfüllt**                         | Schnappschuss: `einsatzKeys.etbDruck` ist nicht live (`NICHT_LIVE_KEYS`), kein Nachladen bei Fokus oder Reconnect. Neue Einträge kommen nur über „Neu laden". Beim Öffnen wird frisch geladen (`refetchOnMount: 'always'`, `EtbDruckPage.test.tsx`), nicht der Stand des letzten Besuchs aus dem Cache gezeigt. |
| 13  | Fokus nie verdeckt                    | **erfüllt**                         | Keine schwebende Fläche. |
| 14  | Tabellenseite vollständig             | **nicht anwendbar (benannte Ausnahme)** | Keine Vergleichsfläche, sondern Papierform (siehe Formverdikt): keine fixierte Kopfzeile am Bildschirm, kein Spaltenschalter. Auf Papier wiederholt sich der Kopf je Seite (`thead` als `table-header-group`, e2e geprüft). |
| 15  | Erfassungsmaske vollständig           | **nicht anwendbar**                 | Keine Erfassung. |

## Prüfliste — Druck von Lagebericht, Befehl, Meldebild (was LFH-71/LFH-22 ändert)

| #   | Kriterium                             | Verdikt             | Begründung |
| --- | ------------------------------------- | ------------------- | ---------- |
| 1   | Treffläche                            | **erfüllt**         | „Drucken / als PDF" ist `DruckKnopf` (antd-`Button`); im Fehlerfall daneben „Erneut laden", ebenfalls `Button`. |
| 2   | Handschuh-Modus                       | **erfüllt**         | Siehe 1. |
| 3   | Rückmeldung vor der Serverantwort     | **erfüllt, mit Rest aus der ETB-Tabelle (Zeile 3)** | Unverändert gegenüber dem Bestand, bis auf das Warten auf Organisation und Logo. Der Druckzeitpunkt im Kopf ist der des Drucks, auch über den Knopf ohne Logo (`useDrucken.test.tsx`). |
| 4   | Kritische Aktion mit zweiter Handlung | **nicht anwendbar** | Drucken ändert nichts. |
| 5   | Kontrast in beiden Modi               | **erfüllt**         | Papier: gemeinsame Papierfarben in `druck.css` (vorher je Seite dupliziert, jetzt eine Stelle). Bildschirm unverändert; der Druckkopf ist dort verborgen. |
| 6   | Kein Status allein über Farbe         | **erfüllt**         | Stand im Druckkopf als Wort („Freigegeben · Version 2"). |
| 7   | Eine Farbe = eine Bedeutung           | **erfüllt**         | Keine neuen Farbträger. |
| 8   | Helligkeitsregler                     | **offen → LFH-397** | App-weit. |
| 9   | Kritische Anzeigen im Blickfeld       | **erfüllt**         | Der Druckkopf macht jedes Blatt zuordenbar (Organisation, Dokument, Einsatz, Stand, Ersteller, Druckzeit). |
| 10  | Alarmbudget                           | **nicht anwendbar** | — |
| 11  | Warnverhalten                         | **erfüllt**         | — |
| 12  | Kein Sprung unter dem Cursor          | **erfüllt**         | Der Druckkopf ist am Schirm `display: none` und `aria-hidden`, er verschiebt nichts. |
| 13  | Fokus nie verdeckt                    | **erfüllt**         | Unverändert. |
| 14  | Tabellenseite vollständig             | **erfüllt (Meldebild)** | Am Bildschirm unverändert (stehende Kopfzeile, LFH-330). Auf Papier legt `KatalogTabelle` zwischen `beforeprint` und `afterprint` Kopf und Körper in EINE Tabelle, damit die gemeinsame `thead`-Regel greift (`KatalogTabelle.test.tsx`, `e2e/meldebild-tabelle.spec.ts`). |
| 15  | Erfassungsmaske vollständig           | **nicht anwendbar** | — |

## Nebenbefund Verwaltung › Organisation

Name und Logo (design.md D9): Name im eigenen `<form>` (Enter sendet), Logo mit Vorschau,
Hochladen/Ersetzen und „Logo entfernen" mit Rückfrage und rotem Bestätigungsknopf
(unumkehrbar, LFH-363), ohne Admin-Recht gesperrt mit `RechteHinweis`. Jeder Speicherfehler
steht an seinem Paneel (Name, Logo, Taktische Zeichen), der Grund eines gescheiterten
Entfernens im Dialog (LFH-535, `reset()` beim Öffnen); das Namensfeld folgt nach dem
Speichern wieder dem Serverstand (eigener Merker statt `isFieldTouched`, LFH-342 · C7).
Belegt in `stammdaten/OrganisationTab.test.tsx` samt Mutationsproben.

## Bewusst nicht gebaut

- Server-PDF, automatische Ablage, Audit von Druckvorgängen (proposal.md, Nicht-Ziele).
- Seitenzählung mit Organisationsname im Randfeld (D3: Escape-Fläche ohne Gewinn).
- Firefox/WebKit als Playwright-Projekte (Ruleset und CI-Laufzeit) → LFH-729.
