# LFH-609 · Prüfliste Einsatztauglichkeit

Angelegt an die Flächen, die LFH-609 geändert hat:

- das **Meldebild** (`pages/KraefteuebersichtPage.tsx`, `kraefte/meldebildRaster.ts`,
  `kraefte/Statusband.tsx`): der Einheitenstatus als Chip, die Spalten „Seit“ und
  „Mittel“, der Handstatus-Auslöser und die Kacheln „Einheiten je Status“;
- das Paneel **„Ausgewählt“ der Lagekarte** (`pages/lagekarte/leistenDaten.ts`) mit Status
  und „Seit“;
- das **Abschnittsraster im Überblick** (`pages/fuehrung/ueberblickDaten.ts`,
  `UeberblickPage.tsx`), das jetzt Einheiten nach Statuskategorie zählt.

Die Kriterien stehen in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7). Die Vorlage für die Seite ist die LFH-338-Prüfliste
(`2026-08-11-lfh-338-pruefliste-einsatztauglichkeit.md`). Deren Verdikte bleiben stehen, wo
dieses Ticket nichts ändert. Hier steht nur, was sich geändert hat.

| # | Kriterium | Verdikt | Begründung |
|---|---|---|---|
| 1 | Treffläche | **erfüllt** | Der einzige neue Bedienweg ist der Handstatus, und er ist `components/StatusWahl.tsx`: ein antd-`Button` mit Menü im Portal, Höhe vom `ConfigProvider`, ohne punktuelles `size`. |
| 2 | Handschuh-Modus | **erfüllt** | Siehe 1. `StatusWahl` erbt die Staffel 30/48/72 und ist seit LFH-339 in den Kräftelisten im Einsatz. Ein neues handgebautes Bedienziel gibt es nicht. |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | Der Handstatus zeigt `laeuft` am Auslöser und sperrt die übrigen Auslöser, solange die Mutation läuft. Ein Fehler meldet sich per Toast („Status nicht gesetzt“). Optimistisch wird bewusst nicht aktualisiert, weil der Status eine Ableitung des Servers ist. |
| 4 | Kritische Aktion mit zweiter Handlung | **nicht anwendbar** | Ein Statuswechsel ist umkehrbar (derselbe Auslöser), und die Umkehr steht mit einem ETB-Eintrag im Protokoll. Nach LFH-378 gibt es deshalb keine Rückfrage. |
| 5 | Kontrast in beiden Modi | **erfüllt, mit dem Vorbehalt aus LFH-338** | Neue Farbträger sind nicht entstanden. Chip (`StatusChip`, getönte Fläche aus `instrument/statusFlaeche.ts`), Kachel (`Kennzahl`) und Handstatus-Etikett (`StatusTag`) sind die geprüften Bausteine des Neuentwurfs. Die Verteilung bei „gemischt“ ist Text in `gedaempft`. |
| 6 | Kein Status allein über Farbe | **erfüllt** | Jeder Status trägt Code **und** Wort („S4 · Am Einsatzort“). „gemischt“ ist ein Wort mit der Verteilung als Text. Ohne gemeinsame Kategorie bleibt der Ton neutral, eine Farbe wird nicht erfunden. Geprüft wird das in `meldebildRaster.test.ts` („gemischt erfindet keinen Status“). |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Der Ton kommt ausschließlich aus der Statuskategorie (`statusKategorie`), wie beim Fahrzeug. Der Einheitenstatus nutzt denselben Katalog. |
| 8 | Helligkeitsregler | **offen → LFH-397** | App-weite Lücke, unverändert. |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** | Die Kacheln stehen wie bisher oben im Meldebild, jetzt mit der Frage des Entwurfs („wie viele Einheiten in S4“). Die Statusspalte steht vor „Seit“ und „Auftrag“, die Spalte „Mittel“ weicht unter `xl` in den Spaltenschalter (mit Zähler). |
| 10 | Alarmbudget | **nicht anwendbar** | Keine Alarme. |
| 11 | Warnverhalten | **erfüllt** | Kein Blinken, keine Animation. |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Ein Statuswechsel am Fahrzeug invalidiert die Einheitenliste. Die Zeilen bleiben dabei an ihrem Platz (Schlüssel `eh-<id>`), nur Chip und „Seit“ ändern sich. Neue Einheiten laufen wie bisher über das Sammelbanner. |
| 13 | Fokus nie verdeckt | **erfüllt** | Das Menü des Handstatus liegt im Portal. Die Zeilenschleuse behandelt `.ant-dropdown` nicht als Verlassen (LFH-339). |
| 14 | Tabellenseite vollständig | **erfüllt** | Zwei neue Spalten laufen durch `Datensicht`: „Seit“ ist immer sichtbar, „Mittel“ hat `abBreite: 'xl'` und zählt damit im Spaltenschalter mit. Die Kennungsspalte bleibt die Einheit. |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung. |

## Bewusst nicht geändert

- Der **Lagebericht-Export** des Meldebilds (`rendereMeldebildMarkdown`) führt den
  Einheitenstatus nicht. Er gliedert nach Abschnitten und Mitteln. Ob der Status dort
  hineingehört, ist eine Frage an den Meldetext und kein Nebenprodukt dieses Tickets.
- Das **FMS-Tableau** ist LFH-642.
