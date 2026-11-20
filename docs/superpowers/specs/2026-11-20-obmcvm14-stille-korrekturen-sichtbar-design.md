# Stille Zeit- und Zahlkorrekturen sichtbar machen — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/obmcvm14i5rlxq6a75fvtre1 (LLH-1768, Teil von LLH-1718
„Erfassung: stille Fehlwege schließen“)

## Absicht

Die Erfassung korrigiert Eingaben still, und gespeichert wird dann etwas anderes, als die Person
meinte. Beobachtet (UI/UX-Analyse 12.11.2026):

- Die Erinnerung „Fällig“ ist mit „jetzt“ vorbelegt und damit beim Anlegen schon fällig.
- Die Frist „1700“, um 17:59 getippt, wird zu „131700nov26“ (morgen). „morgen“ steht nur während
  des Tippens am Feld und verschwindet mit Enter.
- Unlesbares („morgen“) verschwindet beim Verlassen. Das Feld zeigt wieder den alten Wert, und
  „Anlegen“ sendet diesen alten Wert.
- Das Alter 250 wird beim Verlassen still zu 120 und so gespeichert (antds `max` an
  `InputNumber`). Dasselbe tun `min` (−5 → 0) und `precision` (2,5 → 3).

Leitsatz: **Nichts wird still korrigiert.** Was das System anders liest als getippt, steht
sichtbar am Feld. Was es nicht lesen kann, bleibt stehen und sperrt das Senden.

## Ziele

1. „gestern“/„morgen“ bleibt am Zeitfeld stehen, solange der geltende Wert dort liegt.
2. Eine unlesbare Zeiteingabe bleibt beim Verlassen im Feld stehen, samt Grund. Ein Formular mit
   einem solchen Feld sendet nicht.
3. Zahlenfelder kappen und runden nie. Grenzen und Ganzzahligkeit sind Prüfregeln mit
   Fehlermeldung. Ein Wächter verbietet `min`, `max` und `precision` an `InputNumber`.
4. Die Erinnerung ist mit „jetzt + 30 min“ vorbelegt, wie die Wiedervorlage.

## Nicht-Ziele

- Keine neue Deutung von Wörtern wie „morgen“ im Zeitparser. „morgen“ bleibt unlesbar, nur fällt
  es nicht mehr still weg.
- Die eigene Sperre im ETB (`etb/Schnellerfassung.tsx`, `onDiscard`, LLH-1866) bleibt, wie sie ist.
- Backend-Grenzen bleiben unverändert. Der Server prüft weiter selbst.

## Anti-Ziele

- Ein Formular sendet nach einer verworfenen Zeiteingabe trotzdem den alten Wert.
- Ein leeres optionales Zeitfeld wird durch die Sperre zu `null` gesendet und löscht so einen Wert.
- Der Grund steht doppelt (rechts im Feld und in der Fehlerzeile) und rauscht.

## Ansätze (Wahl: A)

- **A — Sperre über `Feld` (gewählt).** `components/instrument/Feld.tsx` stellt dem Steuerelement
  darin per React-Kontext eine Meldestelle bereit (`meldeSperre(grund | null)`) und hängt seinen
  `rules` eine Prüfregel an, die bei gemeldetem Grund ablehnt. Das deckt alle Formulare über
  `Feld` (rund 45 mit Zeitfeld) ohne Änderung je Formular ab, auch künftige.
- B — Jedes Formular verdrahtet `onDiscard` selbst, wie das ETB. Verworfen: 45 Stellen, und ein
  neues Formular wäre ungeschützt.
- C — Das Zeitfeld meldet einen Sonderwert als Formularwert. Verworfen: Das bricht Typen und
  Pflichtprüfung (der Sonderwert gilt als „ausgefüllt“, `null` als „leer“).

## Entscheidungen

### 1. „gestern“/„morgen“ bleibt am Feld (`anzeige/ZeitpunktEingabe.tsx`)

- Wird nicht getippt, zeigt das Suffix bei einem Wert am Vortag bzw. Folgetag der Anzeigezone
  „gestern“ bzw. „morgen“ (gedämpft, `monoKlein`, wie die Deutung). Gemessen wird an
  `serverJetzt()`. Das gilt für jedes Zeitfeld, nicht nur für Fristen. Bei `nurTag` gibt es keinen
  Hinweis (ein Tag ist kein umgedeuteter Zeitpunkt).
- Ein Grund geht dem Hinweis vor.
- Die Spec `zeiteingabe` verlangt das bereits („Wechselt der Tag dadurch, MUST das Feld … nennen“).
  Der Baustein holt es nach.

### 2. Unlesbares bleibt stehen und sperrt (`ZeitpunktEingabe`, `Feld`)

- **Verlassen mit unlesbarer Eingabe:** Der Text bleibt im Feld (`text` wird nicht geleert), der
  Grund bleibt sichtbar, und der Formularwert bleibt der geltende (kein `onChange`). `onDiscard`
  meldet den Grund wie bisher.
- **Freigabe:** Die Sperre fällt, sobald die Eingabe lesbar übernommen ist (Enter, Verlassen mit
  lesbarem Text, Wahl im Kalender oder Schnellwahl), Escape den Text verwirft (das Feld zeigt dann
  wieder den geltenden Wert), oder der Wert von außen kommt (wie LLH-1866). Enter bei unlesbarem
  Text sendet weiter nicht.
- **Sperre im Formular:** Das Zeitfeld meldet den Grund zusätzlich an die Meldestelle aus
  `Feld`, falls vorhanden. Die angehängte Regel lehnt dann mit dem Grund ab. So scheitert
  „Erfassen“/„Anlegen“/„Speichern“, antd zeigt den Grund in der Fehlerzeile und rollt zum ersten
  Fehler (bestehendes Verhalten der Hüllen).
- **Kein doppelter Grund:** Zeigt die Fehlerzeile von `Form.Item` den Grund (Status `error`),
  blendet das Feld seinen eigenen Grund im Suffix aus. Lesbar für den Builder über antds
  `Form.Item.useStatus()`.
- **Meldestelle als gemeinsamer Baustein** (Entscheidung nach Gegenlesen, mein Entschluss): Kontext
  und Regel liegen in einem kleinen Baustein, den `Feld` **und** `components/instrument/
  DatenfeldEingabe.tsx` (Datenraster, etwa `verpflegung/ZeitfensterBearbeiten.tsx`,
  `planung/PlanungKopf.tsx`, `pages/uhs/UhsAngaben.tsx`) nutzen. Zeitfelder, die in einem rohen
  `Form.Item` eines Formulars liegen (etwa `betreuung/registrierung/RegistrierMaske.tsx`,
  `pages/EinsatzdatenPage.tsx`), werden auf `Feld` umgestellt bzw. bekommen die Meldestelle. Ein
  Zeitfeld in einem Formular ohne Meldestelle darf nach diesem Branch nicht übrig bleiben; der
  Builder listet die Fundstellen im Plan.
- **Ohne Formular** (Filter, Druckauswahl, ETB): Der Text bleibt stehen, der alte Wert
  gilt weiter, nichts sendet ihn um. Das ETB sperrt weiter selbst.
- **`ZeitraumEingabe`:** Beide Felder melden an dieselbe Meldestelle des umgebenden `Feld`. Die
  Sperre gilt, solange eines der beiden einen Grund meldet.
- **Regel:** Der Abschnitt „Zeiteingabe ist ein Textfeld“ in `frontend/AGENTS.md` bekommt die neue
  Regel. Sie löst die Spec-Anforderung „Unlesbare Eingabe wird nicht übernommen“ ab, soweit sie
  „wieder den geltenden Wert zeigen“ verlangt. `openspec/` bleibt eingefroren und wird nicht
  geändert; die Regel verweist auf dieses Design-Doc.

### 3. Zahlenfelder prüfen statt kappen

- **Helfer** `components/zahlRegel.ts` (Name dem Builder überlassen, Fachbegriff deutsch):
  `zahlRegel({ min?, max?, ganz?, einheit? })` liefert eine antd-Regel mit kurzer Meldung:
  „Höchstens 120 Jahre“, „Mindestens 1“, „Nur ganze Zahlen“. Leere Werte lässt sie durch
  (Pflicht bleibt `required`).
- **Alle Fundstellen** mit `min`, `max` oder `precision` an `InputNumber` (27 einzeilige, dazu
  mehrzeilige) werden umgestellt: Grenzen aus der Komponente in die `rules` des umgebenden `Feld`.
  Die vorhandene Prüfregel am Intervall der Erinnerung (`INTERVALL_MAX_MINUTEN`) folgt demselben
  Helfer.
- **Wächter** `components/zahlfeld.guard.test.ts`: Kein `<InputNumber` in `frontend/src` (ohne
  Tests) trägt `min=`, `max=` oder `precision=`, auch nicht über mehrere Zeilen. Es gibt keine
  Schuldliste: Alle Fundstellen werden im selben Branch umgestellt.
- **Nachkommastellen** (mein Entschluss, folgt „precision mit in die Regel“): `zahlRegel` kennt
  `stellen` („Höchstens 2 Nachkommastellen“). `components/DezimalFeld.tsx` rundet nicht mehr über
  `precision`, sondern zeigt die Stellen über einen Formatierer; „7,123“ bleibt stehen und wird
  abgelehnt. Der Wächter `anzeige/zahl.guard.test.ts` (Dezimalzahlen nur über `DezimalFeld`) bleibt.
- **Bausteine mit eigenen Grenzen** (`components/MengenFeld.tsx`, `components/RadiusEingabe.tsx`,
  `anzeige/StaerkeEingabe.tsx`, das Soll-Feld der Qualifikationen u. a.; mein Entschluss): Jeder
  Baustein exportiert seine Regel (`zahlRegel(...)` mit seinen Grenzen), und jeder Aufrufer hängt sie
  an sein `Feld`. Wo kein `Form.Item` um den Baustein liegt (Listenzeilen), prüft der Baustein
  selbst: Fehlerstatus und Meldung am Feld, kein `onChange` mit einem Wert außerhalb.
- **Altwerte** (Entscheidung des Menschen, 20.11.2026): Ein gespeicherter Wert außerhalb der
  Grenzen sperrt das Speichern nur, wenn das Feld geändert wurde. Die Regel prüft also nur
  berührte Felder (`form.isFieldTouched(name)` bzw. Vergleich mit dem Anfangswert); ein
  unberührter Altwert geht unverändert durch.
- **`InputNumber` außerhalb eines Formulars** (falls der Builder welche mit Grenzen findet): Der
  Wert wird dort im Aufrufer geprüft und abgelehnt, nicht gekappt. Gibt es keinen solchen Fall,
  entfällt der Punkt.
- **Regel** in `frontend/AGENTS.md` (Abschnitt „Erfassung“, neben der Erfassungs-Norm): „Zahlenfelder
  kappen und runden nie; Grenzen sind Prüfregeln (`zahlRegel`), Wächter …“.

### 4. Vorgabe der Erinnerung

`erinnerung/ErinnerungFormular.tsx`: `faellig: serverJetzt().add(30, 'minute')`, Konstante wie in
`etb/WiedervorlageModal.tsx` (`VORGABE_MINUTEN`). Teilen beide dieselbe Zahl, darf sie an einen
gemeinsamen Ort (Builder).

## Tests (TDD)

- `ZeitpunktEingabe.test.tsx`: Wert morgen → Suffix „morgen“, nach Enter weiterhin. Verlassen mit
  „morgen“ → Feld zeigt „morgen“, Grund „nicht lesbar“, kein `onChange`. Escape danach → alter Wert.
- `Feld` mit Zeitfeld in einem Formular: unlesbar verlassen, Absenden → `onFinish` wird nicht
  gerufen, Fehlerzeile zeigt den Grund, Suffix zeigt ihn nicht doppelt; danach lesbar → sendet.
- `ErinnerungFormular`: Vorgabe = Serveruhr + 30 min; „morgen“ getippt, „Anlegen“ → kein
  `onAnlegen`.
- `zahlRegel`: Grenzen, ganz, leer. Alter 250 → Fehler „Höchstens 120 Jahre“, kein Senden.
- Wächter: Mutationsprobe (ein `max=` eingefügt → rot).
- Bestehende Tests, die das alte Verhalten festhalten („Verlassen zeigt wieder den geltenden
  Wert“), werden bewusst umgestellt, nicht gelöscht.

## Dem Builder überlassen

- Namen von Kontext und Helfer (nach LFH-1312: Fachbegriff deutsch, Technik englisch).
- Wie die Meldestelle die Regel nach einer Meldung neu prüft (etwa `validateFields([name])` erst
  beim Absenden oder sofort). Wichtig ist nur: kein doppelter Grund, Senden scheitert.
- Ob der Stepper-Knopf von `InputNumber` ohne `min` unter 0 geht: Die Prüfregel fängt es ab.

## Bilder

Vorher/nachher: die Erinnerung mit Vorgabe +30 min und „morgen“ am Feld, das Feld „Fällig“ mit
stehen gebliebenem „morgen“ und Fehlerzeile nach „Anlegen“, das Alter 250 mit Prüffehler.
