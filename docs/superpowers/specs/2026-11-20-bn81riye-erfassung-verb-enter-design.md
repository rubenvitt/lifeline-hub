# Zwei Erfassungsmuster, ein Sendeverb, ein Enter-Vertrag, eine Pflichtfehler-Form

Zunder: https://zunder.rubeen.dev/#/aufgabe/bn81riye7chdw1gjh5665ga1 (LLH-1766, Teil von LLH-1718
„Erfassung: stille Fehlwege schließen“, Thema 4 der UI/UX-Analyse LLH-1714).

Stand: 20.11.2026. Der Weg wurde am Phase-1-Checkpoint am selben Tag abgestimmt (alle vier
Empfehlungen angenommen).

## Absicht

Wer im Einsatz etwas festhält, soll an jeder Stelle dieselben Griffe vorfinden: dieselbe Form,
dasselbe Wort auf dem Sendeknopf, dieselbe Bedeutung von Enter, dieselbe Fehlermeldung bei einem
fehlenden Pflichtfeld. Die Analyse vom 12.11.2026 fand vier Erfassungsformen, drei Enter-Verträge,
mehr als zwanzig Sendeverben (allein „Speichern“ 25-mal, auch beim Anlegen) und sieben Formen von
Pflichtfehlern, darunter das Sie aus dem antd-Standardtext („Bitte geben Sie … an“). Jede
Abweichung kostet unter Stress einen Moment des Suchens oder einen Fehltipp.

## Ziele

1. **Zwei Muster** sind festgeschrieben, Zeile und Dialog, mit klarer Zuordnung jeder heutigen
   Erfassung.
2. **Ein Sendeverb** mit genau zwei Regeln und einer festen Liste von Fachhandlungen; alle
   Erfassungen tragen es.
3. **Ein Enter-Vertrag** nach Feldart, in einem Helfer, den neue Stellen benutzen.
4. **Eine Pflichtfehler-Form „‹Feld› fehlt“**, global und an jeder Regel, ohne Sie.
5. Die Regel steht einmal in `frontend/AGENTS.md` (Erfassungs-Norm, Bausteinwahl) und im Design
   System (Karte „Dialog“), Wächter halten Verb und Pflichtfehler.

## Nicht-Ziele

- **Kein Umbau von Oberflächen.** Kein Aufklappformular wird Dialog oder Zeile, keine Seite wird
  Dialog (die Entscheidung LLH-1921 vom 17.11.2026 bleibt).
- **Keine Verhaltensfixes der Geschwister**, die parallel laufen: LLH-1753 (Vorschlagsfeld Enter/Tab),
  LLH-1755 (Dialog schützt Eingaben), LLH-1756 (Enter im leeren ETB-Feld, Tastenhinweis nach
  Modus), LLH-1759 (zum Fehler rollen, Absender vorbelegen), LLH-1762 (Breite „/person“), LLH-1763
  (Handy-Dialogfuß), LLH-1764 (Rufname im ETB). Diese Aufgabe fasst den Code der ETB-Leiste
  (`etb/Schnellerfassung.tsx`) nicht an.
- Keine handgebauten Erfassungsdialoge umstellen (Auftrag erteilen als `<Modal>` um ein
  `ErfassungsFormular`; `Modal okText` bei Ansicht speichern, Abgleich vorschlagen, Vollzug melden,
  Betreuung-Nachforderungen). Das wird eine eigene Aufgabe.
- Keine Texte des Servers (Fehlermeldungen der API).
- Bearbeiten-Knöpfe bleiben „Speichern“ (Paneel, Ansicht, Bearbeiten-Dialoge).

## Anti-Ziele

- Ein Verb, das eine Fachhandlung verschleiert: „Erfassen“ auf „Auftrag erteilen“ oder
  „Entlassen“ wäre schlechter als heute, weil der Knopf dann die Folge nicht mehr nennt.
- Ein Enter, das auf Touch in einem mehrzeiligen Feld sendet (Fehltipp landet im unveränderlichen
  ETB bzw. im Chat).
- Ein Wächter, der rot geboren wird und abgeschaltet werden muss. Er wird erst scharf, wenn der
  Bestand umgestellt ist (Gate-Regel, `AGENTS.md`).

## Randbedingungen

- Prosa, UI-Texte und Kommentare deutsch; neue Bezeichner nach LFH-1312 (Fachwort deutsch, Technik
  englisch).
- Das Design System ist aus dem Code erzeugt; geänderte Regelabschnitte und Karten heißen
  `mise exec -- pnpm -C frontend design-system` und das Erzeugte in den PR. Nach dem Merge
  veröffentlicht der abschließende Agent neu (`frontend/AGENTS.md`, „Größere UI-Entwürfe über das
  Design System“).
- Mitänderungsregel der Anwenderdoku (`docs/anwender/AGENTS.md`): Kapitel, die die geänderten
  Knopftexte nennen oder abbilden, ändern sich im selben PR; ihre Bilder werden neu erzeugt.
- OpenSpec ist eingefroren: `openspec/specs/bedien-muster` wird nicht geändert; die neue Regel
  steht in `frontend/AGENTS.md` und schreibt die Spec dort fort (Verweis darauf).
- Es laufen sieben Geschwister in denselben Dateien. Änderungen hier bleiben mechanisch und klein je
  Stelle (Textliterale, eine Regelzeile), damit Konflikte beim Mergen trivial bleiben.

## Ansätze

**Muster.** Erwogen: (a) Aufklappformular als aufgeklappte Zeile verstehen, nichts umbauen;
(b) Meldung, Nachforderung, Erinnerung zu Seriendialogen; (c) zu echten einzeiligen Zeilen.
**Gewählt (a)**: (b) hebt eine drei Tage alte Entscheidung auf, (c) ist der größte Umbau und
kollidiert mit LLH-1759. (a) liefert die Einheitlichkeit über den Vertrag, nicht über Pixel.

**Verb.** Erwogen: (a) „Erfassen“ für Erfassungen im Einsatz, „Anlegen“ für Struktur und
Verwaltung, Fachhandlungen behalten ihr Verb; (b) nur „Erfassen“, auch „Einsatz erfassen“;
(c) immer Verb + Objekt. **Gewählt (a)**: (b) klingt bei Struktur falsch („Benutzer erfassen“),
(c) kostet in der Zeile Breite (LLH-1762) und wiederholt im Dialog den Titel.

**Enter.** Erwogen: (a) nach Feldart; (b) auf Touch nie; (c) überall immer. **Gewählt (a)**:
(b) bremst die Serienerfassung in einzeiligen Feldern, (c) hebt LFH-955 D1 auf (Fehltipp auf
Touch im ETB).

**Pflichtfehler.** Erwogen: (a) „‹Feld› fehlt“ überall mit Wächter; (b) dieselbe Form nur in
Erfassungen; (c) „‹Feld› ist Pflicht“. **Gewählt (a)**: kurz, ohne Anrede, im ETB schon üblich;
nur der ganze Bestand trägt einen Wächter.

## Die Regeln (wie entschieden)

### R1 Zwei Muster

| Muster | Wann | Bausteine | Nach dem Senden |
| --- | --- | --- | --- |
| **Zeile** | Serienerfassung neben einer Liste oder Zeitachse | `Schnellerfassungszeile`, `SchnellAnlegen`; **aufgeklappt** als `ErfassungsFormular` in einem Klappteil über der Liste (Meldungen, Nachforderungen, Erinnerungen, Zusage) | bleibt offen, leert, Fokus ins erste Feld |
| **Dialog** | jede andere Erfassung | `ErfassungsModal`, `AnlegenModal` | schließt; mit `serie` „Speichern und nächste“ |

Die eigene Seite bleibt die bestehende Ausnahme (Ablauf oder mehr als ~5 Pflichtfelder: Aufnahme,
Einheit aus Vorlage, Verpflegungstag aus Vorlage); sie folgt dem Vertrag des Dialogs.
Inline-Formulare in Detailpaneelen (Patientenkopf, Sichtung, Eintreffen buchen) sind Bearbeiten
bzw. Aktionen an einem Datensatz, keine Erfassungen im Sinn dieser Regel; für ihr Verb gilt R2
trotzdem, wo sie einen neuen Datensatz anlegen (Notiz, Maßnahme, Verbleib).

### R2 Ein Sendeverb

1. **„Erfassen“** steht auf dem Sendeknopf jeder Erfassung eines Einsatz-Datensatzes, in Zeile
   und Dialog, **ohne Objekt** (der Dialogtitel, die Zeile oder ihr Klappkopf nennen es). Die
   Zusätze des ETB bleiben Formen desselben Verbs („Erfassen als HHMM“, „Berichtigung erfassen“).
2. **„Anlegen“** steht beim Neuanlegen von Struktur und Verwaltung: Einsatz, Abschnitt, UHS,
   Bereitstellungsraum, Kanal, Benutzer, Stammdaten und Kataloge, Planung, Schichtplan,
   Einstellungen. Ein Dialog, der zum Anlegen und Bearbeiten dient, heißt beim Anlegen „Anlegen“,
   beim Bearbeiten „Speichern“. Zusätze, die die Folge nennen, bleiben („Anlegen und Code zeigen“).
3. **Fachhandlungen** behalten ihr Verb, weil der Knopf ihre Folge nennt. Die Liste ist
   abschließend, Erweiterung nur mit Eintrag in die Liste (Wächter): Auftrag erteilen, Entlassen,
   Disponieren, Registrieren, Zuordnen, Melden, Einheit bilden/Bilden, Ablegen, Heraufstufen,
   Senden (Chat), Koppeln, Eintragen, Einrichten, Ausgeben, Sichern, Nachtragen, Entwurf anlegen,
   Schichten erzeugen, Übernehmen, Eintreffen buchen, Vorschlagen, Vollzug melden, Weiter.

Zuordnung der heutigen Abweichungen (die Liste, die die Umsetzung abarbeitet):

| Stelle | heute | künftig |
| --- | --- | --- |
| Meldungen (Klappteil) | Meldung erfassen | Erfassen |
| Lagemeldung (Dialog) | Lagemeldung erfassen | Erfassen |
| Nachforderung (Klappteil) | Nachforderung absetzen | Erfassen |
| Erinnerung (Klappteil), ETB-Wiedervorlage | Anlegen | Erfassen |
| Schaden (Dialog) | Anlegen | Erfassen |
| Programmpunkt (Ablauf) | Anlegen | Erfassen |
| „/person“ | Person erfassen | Erfassen |
| Patient: Notiz | Notiz anlegen | Erfassen |
| Patient: Verbleib, Maßnahme | Verbleib erfassen, Maßnahme erfassen | Erfassen |
| Zusage | Zusage erfassen | Erfassen |
| Gerät: Meldung | Meldung senden | Erfassen |
| Stammdaten-Dialoge Fahrzeug, Personal, Material, Einsatz-Vorlage, Sprechgruppe, Externe Stelle, ETB-Baustein, Online-Quelle | Speichern (auch beim Anlegen) | Anlegen / Speichern nach Modus |
| Fernmelde „Verbindung hinzufügen“ | Speichern | Anlegen |
| Katalog-Schnellanlage | Status/Qualifikation/Typ anlegen | Anlegen |
| Stichworte | Hinzufügen | Anlegen |
| Planung, Posten, Helfer, Block | Planung/Posten/Helfer/Block anlegen | Anlegen |

### R3 Ein Enter-Vertrag (nach Feldart)

| Feld | Enter | Umschalt+Enter | Strg/⌘+Enter |
| --- | --- | --- | --- |
| einzeilig, jede Zeigerart | sendet (Tastaturknopf `enterKeyHint="send"`) | — | sendet |
| mehrzeilig im Dialog | bricht um | bricht um | sendet; mit `serie` „Speichern und nächste“ |
| mehrzeilig in der Zeile, feiner Zeiger | sendet | bricht um | sendet |
| mehrzeilig in der Zeile, grober Zeiger | bricht um (`enterKeyHint="enter"`) | bricht um | sendet |

**Was „Zeile“ in dieser Tabelle heißt:** die einfeldrigen Zeilen mit eigenem Tastenhandler (ETB,
Chat, „/person“, `SchnellAnlegen`, Infotelefon). Ein aufgeklapptes `ErfassungsFormular` gehört nach
R1 zum Muster Zeile (bleibt offen, Serie), seine Felder folgen aber den Feldzeilen des Dialogs:
ein mehrzeiliges Feld dort bricht mit Enter um wie heute. *Eigene Festlegung beim Schreiben*: so
ändert sich am Verhalten der Klappteile nichts, und die Hülle `components/Erfassung.tsx`, die die
Geschwister ebenfalls ändern, braucht keine Unterscheidung „in Zeile“.

Strg/⌘+Enter im Dialog ohne `serie` erfüllt den Vertrag schon: die globale Tastaturaktion
`speichern` (`command-palette/befehle.ts`, `tastaturAktionFuerEreignis`) löst `form.submit()` der
Hülle aus. Mit `serie` fängt `aufTaste` die Taste vorher ab und ruft „Speichern und nächste“.

`enterKeyHint="send"` ist Pflicht an den einzeiligen Feldern der Zeilen (heute nur „/person“;
`SchnellAnlegen` und Infotelefon ziehen nach). In Dialogfeldern bleibt der Tastaturknopf des
Systems (*eigene Festlegung*: dort folgt nach einem Feld oft das nächste).

Immer: Enter bei offener Vorschlagsliste wählt nur aus und sendet nie (`StammdatenFeld`, LLH-1144);
eine Zeile bleibt nach dem Senden offen. Der Vertrag steht am Knopf (Tastenkappe, `aria-keyshortcuts`,
LFH-1078), nie im Text.

Die ETB-Leiste behält ihre Verschärfung (nach einem Umbruch sendet nur noch Strg/⌘+Enter, weil
Einträge lang werden); sie steht in `etb/AGENTS.md` und ist mit diesem Vertrag verträglich. Die
Umstellung der Leiste auf den Helfer überlässt diese Aufgabe LLH-1756, das dieselben Zeilen ändert.

**Mechanik:** ein Helfer `components/enterVertrag.ts` mit einer reinen Funktion
`isSendeTaste(e, { mehrzeilig, istBeruehrung, inZeile })` und den Konstanten für
`aria-keyshortcuts`/`enterKeyHint`. Umgestellt wird nur, was abweicht: **Chat**
(`chat/NachrichtEingabe.tsx`) bricht auf grobem Zeiger um statt zu senden. Alle anderen Stellen
erfüllen den Vertrag schon (geprüft in der Erhebung: „/person“, `SchnellAnlegen`, Infotelefon und
die Hülle senden einzeilig; die Hülle bricht in `TextArea` um). Je Stelle gibt es einen Test, der
den Vertrag festhält, wo noch keiner steht.

### R4 Pflichtfehler „‹Feld› fehlt“

- **Eine Form:** „Absender fehlt“, „Ort fehlt“, „Sichtungskategorie fehlt“; Feldname wie das
  Label, ohne Artikel, ohne „Bitte“, ohne Anrede.
- **Helfer** `components/pflichtRegel.ts`: `pflicht('Absender')` liefert
  `{ required: true, message: 'Absender fehlt' }` (bei Bedarf mit `whitespace: true`, wo heute
  gesetzt). Jede Pflichtregel im Frontend nimmt ihn.
- **Jede Pflichtregel nimmt `pflicht()` mit ausdrücklichem Namen**, auch die heute nackten
  `{ required: true }` (rund 30). Grund: antd setzt `${label}` nur bei einem Text-Label, sonst den
  technischen Feldnamen (`FormItem/index.js`, `variables.label = String(name)`); bei JSX-Labels
  (`FeldLabel`) stünde sonst „inhalt fehlt“. Der Name ist das kurze Hauptwort des sichtbaren Labels,
  ohne Zusätze wie „(optional)“ oder Hinweise (*eigene Festlegung*).
- **Global** im `ConfigProvider` (`theme/ThemeModeProvider.tsx`): `form.validateMessages.required =
  '${label} fehlt'`, damit eine vergessene Regel ohne Text nie mehr das Sie zeigt.
- **Wächter** `pflichtRegel.guard.test.ts`: in Quelldateien unter `frontend/src` (ohne Tests) keine
  Pflichtregel mit eigener `message` außer über `pflicht()`, und keine der alten Formen („ist
  erforderlich“, „ist Pflicht“, „darf nicht leer sein“, „Bitte … angeben/eingeben/wählen/eintragen“)
  in einer `message`, und kein `required: true` außerhalb von `pflicht()`. Scharf erst, wenn der Bestand umgestellt ist (im selben PR).
- Prüffehler, die keine Pflicht sind (Format, Länge, Bereich), bleiben, wie sie sind.

### R5 Ort der Regel

- `frontend/AGENTS.md`, „Erfassungs-Norm“: R1–R4 als ein neuer erster Block „Zwei Muster, ein
  Verb, ein Enter-Vertrag, ein Pflichtfehler (LLH-1766)“; die bestehenden Punkte zu Enter
  verweisen darauf statt sich zu wiederholen. „Bausteinwahl“: die Zeilen „Anlegen“ und
  „Serienerfassung neben einer Liste“ nennen die beiden Muster. „Ort von Bearbeiten und Form des
  Anlegens“ verweist auf R1.
- `frontend/src/etb/AGENTS.md`: ein Satz, dass die Enter-Regel der Leiste die Zeile mehrzeilig aus
  R3 verschärft.
- Design System: Karte „Dialog“ (`frontend/scripts/design-system/previews.tsx`) trägt R2/R3 in
  ihren Regeln; danach neu erzeugen.
- Die Prop `erfassenText` der Hülle behält ihren Namen (Wire-nahe Grenze nicht berührt, aber
  Umbenennung wäre reine Zeremonie); ihr Vorgabewert bleibt „Erfassen“, `AnlegenModal` bleibt
  „Anlegen“.

### R6 Wächter für das Verb

`erfassungsVerb.guard.test.ts` liest alle Literale an `erfassenText=` und `knopfText=` (auch in
einfachen Bedingungsausdrücken aus zwei Literalen) und erlaubt nur „Erfassen“, „Anlegen“,
„Speichern“ (nur als Bearbeiten-Zweig einer Bedingung oder in einem Bearbeiten-Dialog) und die
Fachhandlungen aus R2.3 samt Formen mit Zusatz. Ein neues Verb heißt: Eintrag in die Liste, mit
Begründung im Kommentar. Knopftexte als Kind eines `<Button>` sieht der Wächter nicht (*eigene
Festlegung*): sonst träfe er die handgebauten Dialoge, die hier ausdrücklich draußen bleiben, und
wäre rot geboren. Die wenigen Erfassungen mit eigenem Knopf (Gerät-Meldung, Patient Notiz,
„/person“, ETB, Infotelefon, Chat) hält je ein Komponententest auf dem Text fest.

## Was beim Bauen zu entscheiden bleibt

- Die genaue Grenze „Erfassung eines Einsatz-Datensatzes“ gegen „Struktur“ bei Grenzfällen, die die
  Tabelle nicht nennt: im Zweifel „Erfassen“, wenn der Datensatz zum Einsatzgeschehen gehört und
  im Einsatzabschluss zählt; „Anlegen“, wenn er Rahmen für andere Datensätze ist.
- Wie der Verb-Wächter „Speichern im Bearbeiten-Zweig“ erkennt (Allowlist der Dateien oder Form
  des Ausdrucks).
- Ob `pflicht()` ein zweites Argument für `whitespace` braucht oder eine eigene Funktion.
- Reihenfolge der Commits (Helfer und Wächter vor dem Bestand, Wächter zuletzt scharf).
- Welche Kapitel der Anwenderdoku und welche Bilder neu erzeugt werden (Grep nach den alten
  Knopftexten unter `docs/anwender/` und in den Bilder-Specs).
- Tests und e2e, die alte Knopftexte oder Pflichtfehler prüfen, ziehen mit (Erhebung: viele Dateien;
  „Meldung erfassen“ 4 Tests und 5 e2e, „Nachforderung absetzen“ 2 und 1, „Notiz anlegen“ 3 und 3,
  „Meldung senden“ 3 und 10, „ist Pflicht“ 27 und 4).
