# Dialog: ErfassungsModal (Felder und Fuß, Serienmodus)

Dieselbe Hülle als Dialog. `footer={null}`, weil die Knöpfe **im** Formular liegen;
`destroyOnHidden`, damit ein geschlossener Dialog keine Felder im Baum stehen lässt.

**`onCancel` wird umschlossen, nicht durchgereicht.** Von den vier Auswegen (Abbrechen,
Schließkreuz, Escape, Maske) läuft nur der erste durch das Formular, und `destroyOnHidden`
fängt die übrigen **nicht** auf: der Speicher von rc-field-form überlebt das Abhängen
(`preserve` per Vorgabe an) und gewinnt beim nächsten Öffnen gegen `initialValues`. Ein
Anlegen-Dialog trüge sonst die Werte des zuletzt bearbeiteten Datensatzes und legte ihn als
Dublette an.

Deshalb besitzen alle vier Wege denselben zentralen Abbruch: Knopf und Escape gehen direkt
durch `ErfassungsFormular.abbrechen`, Kreuz und Maske über `ErfassungsFormularSteuerung`.
Während die Mutation läuft, sind Kreuz und Maske zusätzlich sichtbar gesperrt.

Regeln dazu:

- **Zwei Muster.** **Zeile**: Serienerfassung neben einer Liste oder Zeitachse, bleibt nach dem
  Senden offen, leert, Fokus ins erste Feld (`Schnellerfassungszeile`, `SchnellAnlegen`; aufgeklappt
  als `ErfassungsFormular` im Klappteil über der Liste: Meldungen, Nachforderungen, Erinnerungen,
  Zusage). **Dialog**: jede andere Erfassung (`ErfassungsModal`, `AnlegenModal`), schließt nach
  dem Senden, mit `serie` „Speichern und nächste“. Die eigene Seite bleibt die Ausnahme ab Ablauf
  oder > ~5 Pflichtfeldern und folgt dem Vertrag des Dialogs. Die Felder eines aufgeklappten
  Formulars folgen den Feldzeilen des Dialogs.

- **Ein Sendeverb.** „Erfassen“ (ohne Objekt; Titel, Zeile oder Klappkopf nennen es) auf jeder
  Erfassung eines Einsatz-Datensatzes; die ETB-Formen „Erfassen als HHMM“ und „Berichtigung
  erfassen“ sind dasselbe Verb. „Anlegen“ beim Neuanlegen von Struktur und Verwaltung (Einsatz,
  Abschnitt, UHS, Bereitstellungsraum, Kanal, Benutzer, Stammdaten, Kataloge, Planung,
  Schichtplan, Einstellungen); ein Dialog für Anlegen und Bearbeiten heißt nach Modus „Anlegen“
  bzw. „Speichern“. Fachhandlungen behalten ihr Verb, weil der Knopf ihre Folge nennt (Auftrag
  erteilen, Entlassen, Disponieren, Registrieren, Senden im Chat …). Im Grenzfall „Erfassen“, wenn
  der Datensatz zum Einsatzgeschehen gehört, „Anlegen“, wenn er Rahmen für andere ist. Wächter
  `components/erfassungsVerb.guard.test.ts` (Liste der erlaubten Verben; ein neues braucht dort
  einen Eintrag mit Grund).

- **Ein Enter-Vertrag nach Feldart** (`components/enterVertrag.ts`): einzeilig sendet Enter auf
  jeder Zeigerart (`enterKeyHint="send"` an den Feldern der Zeilen); mehrzeilig im Dialog bricht
  Enter um; mehrzeilig in der Zeile sendet Enter nur mit feinem Zeiger, mit grobem bricht es um;
  Strg/⌘+Enter sendet überall (ohne `serie` über die Tastaturaktion `speichern`, mit `serie`
  „Speichern und nächste“), Umschalt+Enter nie. Enter bei offener Vorschlagsliste wählt nur aus.
  Die ETB-Leiste verschärft die Zeile (`frontend/src/etb/AGENTS.md`).

- **Ein Pflichtfehler „‹Feld› fehlt“**: jede Pflichtregel über `pflicht('‹Feld›')` aus
  `components/pflichtRegel.ts` (Hauptwort des Labels, ohne Artikel, „Bitte“ und Anrede; Hinweis
  als `zusatz`: „Anzahl fehlt — 0, wenn niemand“). Der `ConfigProvider` setzt denselben Text als
  Rückfall (`validateMessages.required`); antd nimmt dafür nur ein Text-Label, deshalb immer der
  ausdrückliche Name. Wächter `components/pflichtRegel.guard.test.ts`.

Quelle: `frontend/src/components/Erfassung.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
