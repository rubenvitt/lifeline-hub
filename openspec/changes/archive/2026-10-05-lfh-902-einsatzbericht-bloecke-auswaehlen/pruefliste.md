# Prüfliste Einsatztauglichkeit: Einsatzbericht mit wählbaren Blöcken (LFH-902)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder umgebauten Seite. Sie ergänzt die Prüfliste aus LFH-726
(`openspec/changes/archive/2026-10-01-lfh-726-einsatzbericht/pruefliste.md`) und bewertet nur, was
sich geändert hat: die Auswahlleiste, die Umfangszeile im Druckkopf und die beiden Anlagen.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/einsatzdaten/bericht` (umgebaut), neu mit `?bloecke=` |
| Stand | Branch `claude/project-thread-q2bzef` gegen `alpha` |
| Zielkontext | Fükw und ortsfeste Stelle (Nachbereitung, Druck). Führungs-Tablet: Auswahl mit Touch und Handschuh |
| Nicht enthalten | Fahrzeuge mit Einsatzzeiten (keine Fahrzeug-Zeitachse, design.md D5). Firefox und Safari automatisch: LFH-729 (Bestand aus LFH-22) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/einsatzbericht-druck.spec.ts` | 3/3 grün (Chromium). Neu ist Fall (3): Bilanz und Lage abgewählt, Personal-Anlage angewählt. Die Blöcke stehen in Druckreihenfolge, Bilanz fehlt ganz. Der Kopf nennt die Auswahl und den Personenbezug. Die gesäte Einsatzkraft steht mit „läuft“ in der Anlage. Ein Neuladen behält die Auswahl. Ein unbekannter Schlüssel erscheint nicht im Kopf. Im Druckbild hat die Auswahlleiste keine Box |
| Vitest | Neu: `druck/einsatzbericht/auswahl.test.ts` (12), `Auswahlleiste.test.ts` (2). Ergänzt: `quellen.test.ts`, `abruf.test.ts`, `verdichtung.test.ts` (15 neu), `pages/EinsatzberichtDruckPage.test.tsx` (8 neu), `deeplinks.test.ts`, `queryKeys.test.ts` |
| Mutationsproben | (1) In `berichtFreigabe` die Auswahl ignoriert, alles ausgewertet → 3 Tests rot. (2) `bemerkung` in die Personal-Anlage aufgenommen → Whitelist-Test rot. (3) Schnappschuss-Key ohne `gcTime: 0` → „frühere Auswahl lädt neu“ rot. (4) Auswahl nur aus der Adresse statt `useBerichtAuswahl` → e2e Fall (3) rot, weil die Abwahl von „Lage“ bei schnellen Klicks verloren ging. Das war der Befund, der zum Hook führte |
| Review | Ein unabhängiges Review fand: alter Schnappschuss beim Zurückwechseln der Auswahl, zu dichte Häkchen, Spec und Code uneins bei offener Periode nach dem Abschluss. Alle drei sind behoben |

---

## Tabelle: Auswahlleiste und Anlagen

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Jedes Häkchen ist samt Beschriftung ein Bedienziel. Die Höhe kommt aus `controlHeight`, die Polsterung aus `paddingSM`/`padding` (`haekchenStil`, `Auswahlleiste.test.ts`: 30/48/72). „Standardumfang“ ist ein antd-`Button` | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Abstand zwischen Häkchen in `komfortabel` 8 px, in `handschuh` 16 px (`zielAbstand`, Literale, Test). Kein punktuelles `size` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Ein Häkchen wirkt sofort (eigener Zustand vor der Adresse, `useBerichtAuswahl`). Danach steht „Einsatzbericht wird geladen …“, Drucken ist bis dahin gesperrt | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Auswahl ändert keine Daten und lässt sich jederzeit umkehren | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | antd-`Checkbox` und `Typography.Text type="secondary"` über die Tokens, keine eigenen Farben | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Häkchen haben Zustand und Beschriftung. Der Umfang steht als Wort im Kopf („Standardumfang“ bzw. „Auswahl: …“), der Personenbezug ebenso | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Unverändert app-weit, nur `@media screen` | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die Auswahlleiste steht über dem Bericht. In der Sackgasse bleibt sie stehen, und der Hinweis verweist auf sie („lassen sich oben abwählen“) | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Keine Meldung, kein Toast, kein Ton | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Leiste steht oberhalb des Berichts und behält ihre Höhe. Ein Umschalten lädt den Bericht darunter neu, die Häkchen bleiben an ihrem Platz | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Die Anlagen sind Vordruck auf Papier wie der ETB-Druck (benannte Ausnahme, `druck/AGENTS.md`), ohne Vergleich am Schirm | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Es gibt keine Erfassung. Die Auswahl ist ein Filter, kein Formular | — |

**Bilanz:** 12 erfüllt · 0 offen · 3 nicht anwendbar.

## Hinweis zum Datenschutz

Die Anlage Personal je Kopf nennt Einsatzkräfte mit Name, Funktion, Einheit und Zeiten. Sie ist
standardmäßig aus, braucht das Leserecht am Modul Personal und vermerkt den Personenbezug im
Kopf. Betroffene bleiben reine Zählung (Spec „Keine personenbezogenen Daten Betroffener“). Weitere
Felder der Kraft (Bemerkung, Trägerorganisation, Stamm-Kennung, Status) gelangen nicht in die
Verdichtung; das belegt der Whitelist-Test.

## Browser

Chromium automatisch (e2e). `einsatzbericht-druck.spec.ts` steht wie seit LFH-726 nicht in
`DRUCK_SPECS`: Die Druckmechanik (`druck.css`) ist unverändert, und die Leiste fällt unter dieselbe
`display: none`-Regel wie jeder Rahmen. Die Handprüfung in Firefox und Safari steht weiter unter
LFH-729 aus.
