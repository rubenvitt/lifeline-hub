# InlineAngabe (geschlossen, leer, offen)

Inline bearbeitbare Angabe mit BELIEBIGER Eingabe (LFH-472) — Text, Textfeld, Zahl, Auswahl,
Datum/Uhrzeit —, optional als Pflichtangabe.

── ABGRENZUNG ZU `BemerkungZelle` ─────────────────────────────────────────────────────

`BemerkungZelle` (LFH-369) trägt optionale Freitexte in Listen und steht auf antds
`Typography.Text editable`, das nur Text kann. Hier braucht es Zeiteingabe, Select und
InputNumber und eine Pflichtangabe, die leer abgelehnt wird. Gemeinsam sind die Anzeige (Wert
als Knopf, `wertKnopfStil`, Platzhalter in `bedienText`) und die Fokusrückgabe
(`useFokusRueckgabe`) — beide aus EINER Quelle, nicht kopiert.

── DIE REGELN AUS LFH-369, HIER WEITER GÜLTIG ─────────────────────────────────────────

- **Der Auslöser nennt die Angabe** („Leitstellen-Nr. bearbeiten"); der Wert ist die
  Beschreibung (`aria-describedby`), kein `aria-label`, das den Inhalt verdeckte.
- **Ohne Schreibrecht keine Aufforderung**: nur der Wert, leer als „—".
- **In einer Liste trägt `kennung` die Zeile in jeden Namen** („Funktion zu Anna bearbeiten“,
  LLH-1067), wie bei `BemerkungZelle`; der sichtbare Text bleibt „Funktion eintragen“.
- **Fokus fällt nicht auf `<body>`**, auch wenn der neue Wert erst eine Runde später kommt.
- Die `keyCode`-Falle von antds `Editable` gilt NICHT: hier sendet das native `<form>` (Enter),
  Escape läuft über `key`.

── WAS BEWUSST FEHLT ──────────────────────────────────────────────────────────────────

**Kein Speichern beim Verlassen (Blur).** Kalender der Zeiteingabe und Select öffnen Portale; ein Klick
darin verlässt die Eingabe, und ein Blur-Speichern schriebe einen halben Zeitpunkt. Gespeichert
wird nur ausdrücklich: Enter, Strg/⌘+Enter im Textfeld, oder „Speichern".

── FELDWEISE BEARBEITUNG IN EINER ANSICHT (LLH-1103) ──────────────────────────────────

Für die Personendaten (Change `f8218h1i-personendaten-feldweise`, design.md D3) kamen vier
optionale Props dazu; ohne sie verhält sich die Angabe wie zuvor.
- `pruefe`: Prüfung ohne Server. Der Grund steht nach dem Absenden als `FeldFehler` unter der
  Eingabe (`aria-invalid`, `aria-describedby`), der Fokus geht ins Feld, gesendet wird nicht;
  danach folgt die Meldung dem Entwurf. Ein unveränderter Wert wird nicht geprüft (Altbestand).
- `gesperrt`: der Grund steht sichtbar am Feld (`frontend/AGENTS.md`, „Texte: zeigen statt
  erklären“: nie nur im Tooltip), der Auslöser ist `disabled`. Eine offene Bearbeitung ohne
  Änderung schließt; ein Entwurf bleibt stehen, damit nichts still verloren geht, sendet aber
  nicht, bis die Sperre fällt.
- `onEntwurf`: meldet nur die Wechsel zwischen „unverändert“ und „geändert“ (auch beim
  Aushängen), für den Merker `components/offeneBearbeitung.tsx`. Ohne `onEntwurf` meldet sich
  die Angabe selbst beim Merker der Seite an (LLH-1468): unter einem `OffeneBearbeitungProvider`
  fragt ein geänderter Entwurf vor dem Verlassen und vor einem Wechsel in der Seite nach, ohne
  Provider bleibt es still. Die Sperre der übrigen Felder übernimmt sie dabei nicht: den Grund
  zeigt die Seite an EINER Stelle, also verdrahtet sie Anmeldung und `gesperrt` selbst
  (`useOffeneBearbeitung`, Vorbild Personendaten).
- `onOeffnen`: jedes Öffnen; der Aufrufer hält dort den Serverstand für den Feld-CAS fest.
- `onSchliessen`: jedes Schließen einer offenen Bearbeitung (gespeichert, abgebrochen, von der
  Sperre geschlossen, ausgehängt). Mit `onOeffnen` hält der Aufrufer ein offenes Feld an seinem
  Ort, auch wenn ein neuer Stand es woanders einordnete (Spec `personendaten-bearbeiten`,
  „Eine offene Bearbeitung zur Zeit“).
- Erfüllt `onSpeichern` mit `OFFEN_LASSEN`, bleibt die Eingabe mit dem Entwurf offen, ohne
  Fehler: etwa wenn eine Rückfrage ohne Entscheidung geschlossen wurde (Escape).

── ANZEIGE MIT EIGENEN BEDIENZIELEN (LLH-1426) ───────────────────────────────────────

Der Wertknopf umschließt die Anzeige. Trägt sie selbst Ziele (`tel:`/`mailto:` der
Verbindungen), stünde ein Link in einem Button: der Klick auf die Nummer öffnete die Bearbeitung
statt zu wählen, und ein Screenreader fände verschachtelte Ziele (axe `nested-interactive`). Mit
`bearbeitenDaneben` ist die Anzeige Inhalt, und daneben steht ein eigener Knopf „Bearbeiten“ —
die Sprache von `BearbeitbaresPaneel` (Knopf mit dem Wort, Name „… bearbeiten“, Fokus kehrt
dorthin zurück). Name und Beschreibung bleiben die des Wertknopfs, die leere Angabe behält ihre
Aufforderung „… eintragen“. Steckt ohne den Modus ein Ziel im Wertknopf, warnt die Entwicklung.

Quelle: `frontend/src/components/InlineAngabe.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einem Klick im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
