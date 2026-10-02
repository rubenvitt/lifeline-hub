# LFH-751 · Löschersuchen nach Art. 17 — Prüfliste Einsatztauglichkeit

Angelegt an die umgebaute Archivakte und ihre zwei neuen Dialoge:

- **Paneel „Löschersuchen (Art. 17)“** in der Archivakte `/admin/aufbewahrung/:einsatzId`
  (`aufbewahrung/Loeschersuchen.tsx`, eingebunden in `aufbewahrung/ArchivAktePage.tsx`), dazu die
  Spalte „Löschersuchen“ im Personenregister und das Datenfeld „Schwärzung auf Antrag ab“.
- **Personensuche** (`aufbewahrung/PersonensucheDialog.tsx`).
- **Rückfrage vor dem Antrag** (`aufbewahrung/SchwaerzungsantragDialog.tsx`).
- **Übersicht** `/admin/aufbewahrung`: Zustand `schwaerzung_beantragt` und Spalte „Schwärzung auf
  Antrag ab“.

Die Kriterien stehen in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7). Kontext ist wie bei LFH-23 der **Fükw** und die **ortsfeste Stelle**: die
Verwaltung wird am Schreibtisch bedient. Den Handschirm (390 px) misst `e2e/aufbewahrung.spec.ts`
trotzdem mit.

## Formverdikt (LFH-19 / LFH-330)

- **Antragsliste: Tabelle** (`KatalogTabelle`). Die Frage lautet: „Welcher Antrag ist offen,
  welcher wann fällig?“ Fixierte Kennung ist die pseudonyme Zielkennung (`R-042`, `EK-17` …),
  nie die DB-`id`.
- **Personensuche: Modal mit Treffertabelle.** Die Frage lautet: „Welcher dieser Treffer ist
  es?“ Gesucht wird, nicht erfasst; deshalb kein `ErfassungsModal`.
- **Rückfrage: `ErfassungsModal`** mit zwei Feldern (Aktenzeichen, Kennung), rot (`unumkehrbar`).
  Der Absende-Knopf bleibt gesperrt, bis beide Felder passen.

## Prüfliste

| #   | Kriterium                             | Verdikt             | Begründung |
| --- | ------------------------------------- | ------------------- | ---------- |
| 1   | Treffläche                            | **erfüllt**         | Jedes Bedienziel ist ein antd-`Button` bzw. `Input` und erbt `controlHeight` vom `ConfigProvider`. Es gibt kein punktuelles `size` und kein handgebautes Bedienziel. |
| 2   | Handschuh-Modus                       | **erfüllt**         | Siehe Zeile 1: die Staffel 30/48/72 greift überall. |
| 3   | Rückmeldung vor der Serverantwort     | **erfüllt**         | Während der Mutation zeigen der Absende-Knopf der Rückfrage (`laeuft`), „Suchen“ und „Zurücknehmen“ der Zeile eine Ladeanzeige. Ein Toast quittiert den Erfolg („Löschersuchen erfasst — Vollzug in 24 Stunden“). Optimistisch aktualisiert wird nichts: Stand und Fälligkeit rechnet der Server. |
| 4   | Kritische Aktion mit zweiter Handlung | **erfüllt**         | Der Antrag ist nach 24 Stunden unumkehrbar. Deshalb gibt es eine Rückfrage mit Pflicht-Aktenzeichen und eingetippter Kennung, der Knopf ist rot und gesperrt, bis die Kennung passt (`Loeschersuchen.test.tsx`; per Mutationsprobe belegt). Die Rücknahme ist umkehrbar, weil jederzeit ein neuer Antrag möglich ist, und hat deshalb keine Rückfrage (LFH-363). |
| 5   | Kontrast in beiden Modi               | **erfüllt**         | Neu sind der Zustand `schwaerzung_beantragt` und die Karte `schwaerzungsantragStand`. `e2e/aufbewahrung.spec.ts` misst jetzt alle sieben Zustandsetiketten im Browser, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, den Rand von `achtung` ≥ 3 : 1. Der Stand „offen“ nutzt dieselbe Rolle `achtung` über `StatusTag`. Der app-weite Tertiärtext erfüllt seit LFH-643 den Boden. |
| 6   | Kein Status allein über Farbe         | **erfüllt**         | Jeder Stand trägt sein Wort („offen“, „zurückgenommen“, „vollzogen“, „Schwärzung beantragt“). Eine auf Antrag geschwärzte Person ist im Register mit Text gekennzeichnet („auf Antrag geschwärzt · Zeitpunkt“). |
| 7   | Eine Farbe = eine Bedeutung           | **erfüllt**         | Beide Karten stehen im Vertrag `theme/statusFarben.ts` (`ALLE_MAPS` 31). `achtung` gilt nur dort, wo noch eine Rücknahme möglich ist (wie `vorgemerkt`). Rot tragen nur die Handlungen „Einsatz sofort schwärzen“, „Antrag stellen“ und der Absende-Knopf der Rückfrage. |
| 8   | Helligkeitsregler                     | **erfüllt**         | Das Archiv hat keine eigene Fläche außerhalb der Deckschicht (LFH-397). |
| 9   | Kritische Anzeigen im Blickfeld       | **erfüllt**         | Zustand und „Schwärzung auf Antrag ab“ stehen im ersten Paneel der Akte. Das Paneel „Löschersuchen“ folgt direkt darauf. In der Übersicht steht der Zustand neben der fixierten Nummer. |
| 10  | Alarmbudget                           | **nicht anwendbar** | Es gibt keine Alarme und keine Live-Ereignisse; der Vollzug läuft im Purge-Takt. |
| 11  | Warnverhalten                         | **erfüllt**         | Kein Blinken, keine Animation über antd hinaus. |
| 12  | Kein Sprung unter dem Cursor          | **erfüllt**         | Die Liste ändert sich nur nach eigener Aktion (Invalidierung `globalKeys.aufbewahrung()`). Sie ist nach Antragszeitpunkt sortiert, ein neuer Antrag erscheint oben. |
| 13  | Fokus nie verdeckt                    | **erfüllt**         | Beide Dialoge sind Modals mit eigener Fokusführung. Die Rückfrage setzt den Fokus ins erste Feld, die Suche ins Suchfeld. Die Trefferzahl wird über `aria-live` angesagt. |
| 14  | Tabellenseite vollständig             | **erfüllt**         | Antragsliste und Treffertabelle laufen auf `KatalogTabelle`: stehender Kopf, fixierte menschenlesbare Kennung, Scrollcontainer. Bei 390 px läuft die Seite nicht über, die Aktionen stehen im Paneelkörper statt im schrumpffesten Kopfslot (`e2e/aufbewahrung.spec.ts`, Akte in `vorgemerkt` und mit offenem Antrag). |
| 15  | Erfassungsmaske vollständig           | **erfüllt**         | Die Rückfrage läuft auf `ErfassungsModal`: kein `.ant-modal-footer`, Absende-Knopf im `<form>`, Enter und Kürzel nur bei passender Kennung (`gesperrt`), `mutateAsync`, die Ablehnung erscheint im Dialog und die Felder bleiben stehen. Feldbudget: zwei Felder. |

## Im Browser durchgeklickt

`e2e/aufbewahrung.spec.ts`, Test „Löschersuchen (LFH-751): Person suchen, Antrag stellen,
zurücknehmen“ (Chromium, laufender Stack): Suche nach „ayse yilmaz“ → ein Treffer ohne Namen →
„Antrag stellen für R-001“ → Rückfrage, Knopf gesperrt bis zur passenden Kennung → absenden →
Antrag „offen“ in der Liste, kein Name auf der Seite, System-Eintrag mit Aktenzeichen und `R-001`
im Archiv-ETB → „Zurücknehmen“ → Stand „zurückgenommen“, kein Knopf mehr. Den Vollzug nach 24
Stunden belegt `tests/loeschersuchen.rs` (`personen_antrag_bis_zum_vollzug`) mit verstellter Uhr.

## Bewusst nicht gebaut

- **Live-Aktualisierung offener Clients und Räumen der Offline-Caches nach dem Vollzug:**
  Folgeticket LFH-996.
- **Ein Antrag direkt aus dem Register** („diese Zeile schwärzen“): Wer ein Löschersuchen
  bearbeitet, kennt nur den Namen. Der Weg führt deshalb über die Suche.
