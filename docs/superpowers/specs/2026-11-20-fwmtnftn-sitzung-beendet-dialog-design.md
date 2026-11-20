# Sitzung beendet: Anmeldung als Dialog über der Seite (LLH-1770)

Zunder: https://zunder.rubeen.dev/#/aufgabe/fwmtnftn383bl5h9orxxr4tt
Elternaufgabe: LLH-1718 (Erfassung: stille Fehlwege schließen), Thema 4 der UI/UX-Analyse vom
12.11.2026.

## Absicht

Endet die Sitzung, während jemand ein Formular ausfüllt (Meldung, Auftrag, Vermisstenmeldung …),
steht er heute nach etwa 30 s ohne Erklärung auf der Anmeldeseite. Nach der Anmeldung ist das
Formular zu und die Eingabe weg. Im Einsatz heißt das: eine halb erfasste Meldung muss neu
getippt werden, und niemand weiß, warum. Ziel: **nichts geht still verloren** — die Anmeldung
sagt, was passiert ist, und wer sich wieder anmeldet, steht genau dort, wo er war, mit allem,
was er getippt hat.

## Wie es heute läuft

- Eine 401 auf irgendeine Anfrage ruft `meldeSitzungAbgelaufen()` (`auth/sitzungsEvent.ts`,
  einmal bis zur nächsten gültigen Sitzung). Die Prüfung im `AuthProvider` (`pruefe`, 401 auf
  `/me`) tut dasselbe.
- `useSitzungsWache` (`auth/useSitzungsWache.ts`, in `SitzungsLayout`) ruft darauf
  `abmeldenLokal('sitzungsende')` und navigiert nach `/login` mit `state.von` (gekoppeltes Gerät:
  „Kopplung beendet“, LFH-892).
- `abmeldenLokal` setzt den Benutzer auf `null` → `RequireAuth` baut die ganze Seite ab (jeder
  Formularzustand im Speicher ist weg), räumt Lagebild in Speicher **und** Platte
  (`lagebildLoeschen`, LFH-723) und die Gerätedaten (`geraetRaeumen('sitzungsende')`, LFH-767;
  ETB-Entwürfe bleiben bei diesem Anlass).
- Die Offline-Schreibschlange behält bei 401 ihre Einträge und sendet nach der Neuanmeldung
  (daher ging der ETB-Eintrag „von selbst hinaus“).
- Der Client kann nicht unterscheiden, **warum** die 401 kam: Sitzung nach `sitzung_tagen`
  abgelaufen, von einem Admin oder in „Sitzungen“ beendet (LFH-1092), Passwort geändert, Konto
  deaktiviert.

## Ziele

1. Eine 401 im laufenden Betrieb (Person, nicht gekoppeltes Gerät) baut die Seite **nicht** ab.
   Darüber legt sich eine Anmeldung als Dialog; die Seite dahinter ist vollständig verdeckt.
2. Der Dialog nennt den Grund: Kopf **„Sitzung beendet“**, darunter „Melde dich erneut an.
   Deine Eingaben auf dieser Seite bleiben erhalten.“
3. Meldet sich **dieselbe Person** wieder an, schließt der Dialog, die Daten der Seite laden neu,
   offene Formulare und Dialoge stehen unverändert da (Werte, Fokus darf neu gesetzt werden).
4. Meldet sich eine **andere Person** an, lädt die Seite neu (Regel LFH-387: ein Benutzerwechsel
   wird nie im laufenden Baum gelöst). Die Eingaben der ersten Person gehen dabei verloren — das
   ist gewollt, sie gehören ihr.
5. Die Anmeldeseite selbst nennt den Grund ebenfalls, wenn man über das Sitzungsende auf ihr
   landet (Frist abgelaufen, „Abmelden“ im Dialog).

## Nicht-Ziele

- Formularinhalte über ein Neuladen oder einen Tabwechsel hinweg sichern (Entwürfe je Maske in
  `sessionStorage`). Bewusst verworfen, s. „Ansätze“.
- Unterscheiden, ob die Sitzung abgelaufen oder beendet wurde (bräuchte einen Grund vom Server;
  der Wortlaut „Sitzung beendet“ stimmt für alle Fälle).
- Gekoppelte Geräte: bleiben bei „Kopplung beendet“ (LFH-892), keine Personenanmeldung.
- Das Verhalten beim **freiwilligen** Abmelden (auch in einem anderen Tab angekündigt,
  `abmeldenAngekuendigt`) und bei einer 401 schon beim Start ändert sich nicht.

## Anti-Ziele

- Einsatzdaten sichtbar hinter einem halbtransparenten Schleier, während keine gültige Sitzung
  besteht. Die Abdeckung ist undurchsichtig.
- Ein Gerät, dessen Sitzung ein Admin beendet hat, hält das Lagebild weiter auf der Platte vor.
- Ein offener Dialog, der Daten unbegrenzt im Speicher hält.

## Ansätze

1. **Dialog über der montierten, verdeckten Seite** — gewählt (Abstimmung 20.11.2026). Der
   Baum bleibt stehen, also bleibt jeder Formularzustand ohne Zutun der Masken erhalten, auch in
   offenen antd-Dialogen. Kosten: ein neuer Zwischenzustand im `AuthProvider` und eine Änderung
   der Ausgangsregel; Daten liegen bis zur Entscheidung im Speicher (begrenzt durch die Frist).
2. **Anmeldeseite bleibt, Masken sichern Entwürfe** in `sessionStorage` und stellen sie nach der
   Rückkehr über `state.von` wieder her. Verworfen: jede Maske einzeln (rund ein Dutzend, fünf
   Erfassungsmuster laut LLH-1766), mehr Personendaten auf dem Gerät, und offene Dialoge
   müssten zusätzlich ihren Öffnungszustand wiederherstellen.
3. **Nur den Grund nennen.** Verworfen: erfüllt „offenes Formular bleibt“ nicht.

## Entschiedenes

### Neuer Zustand „Sitzung unterbrochen“ im `AuthProvider`

- `AuthWert` bekommt `unterbrechung: { bisher: MeAntwort; seit: number } | null` und eine
  Funktion, die sie auslöst (Name dem Builder überlassen, etwa `unterbrechen()`).
- Während der Unterbrechung **bleibt `benutzer` gesetzt** (sonst baute `RequireAuth` ab), und
  damit auch der erwartete Benutzer der Schreibanfragen (`setzeErwartetenBenutzer`). Schreiben
  scheitert ohnehin mit 401; die Offline-Schlange behält ihre Einträge wie heute.
- **Sofort geräumt** wird beim Eintritt: das Lagebild **auf der Platte** (nicht der Query-Cache
  im Speicher) und die Gerätedaten wie bei `geraetRaeumen('sitzungsende')` (ETB-Entwürfe
  bleiben). Das Mitschreiben des Lagebilds auf die Platte ruht, solange die Unterbrechung steht.
- **Frist 15 Minuten** ab Eintritt: läuft sie ab, folgt der volle bisherige Ausgang —
  `abmeldenLokal('sitzungsende')` und Umleitung nach `/login` mit `von` und Grund. Formulare
  gehen dann verloren (bewusst, Abstimmung 20.11.2026).
- Gilt nur für eine Person. Bei einem gekoppelten Gerät, ohne angezeigten Benutzer, nach
  angekündigtem freiwilligem Abmelden und bei einer 401 beim Start bleibt der heutige Weg.

### Auslöser

- `useSitzungsWache`: statt `abmeldenLokal('sitzungsende')` + Navigation löst sie die
  Unterbrechung aus (Gerät: unverändert „Kopplung beendet“).
- `pruefe` im `AuthProvider` bei 401 auf `/me`: ist `abmeldenAngekuendigt` gesetzt, wie heute
  (`abmeldenLokal('abmelden')` und Meldung); sonst Unterbrechung statt `abmeldenLokal`.
- Die Melde-Sperre in `sitzungsEvent.ts` bleibt: weitere 401 während der Unterbrechung tun nichts.

### Auflösung

| Ereignis | Wirkung |
|---|---|
| Anmeldung im Dialog, **gleiche** Benutzer-id | Unterbrechung `null`, `sitzungsMeldungZuruecksetzen`, Kanalmeldung `angemeldet`, Lagebild-Vorhaltung wieder an, alle Abfragen invalidieren. Kein Neuladen, kein Abbau. |
| Anmeldung im Dialog, **andere** Benutzer-id | Seite neu laden (`seiteNeuLaden` auf die aktuelle Adresse); der Start übernimmt dann die neue Person. Nicht im laufenden Baum übernehmen. |
| In einem anderen Tab angemeldet (`pruefe` sieht `/me` ok) | Gleiche Person: auflösen wie oben (ein Tab heilt alle). Andere Person: `BenutzerKonfliktDialog` wie heute. |
| In einem anderen Tab freiwillig abgemeldet | voller Ausgang `abmeldenLokal('abmelden')`, Umleitung `/login`. |
| „Abmelden“ im Dialog | voller Ausgang `abmeldenLokal('sitzungsende')` (kein Server-Logout, es gibt keine Sitzung), Umleitung `/login` mit `von` und Grund. |
| Frist abgelaufen | wie „Abmelden“ im Dialog. |
| Neuladen während der Unterbrechung | Start sieht 401 → heutiger Weg (Anmeldeseite); Eingaben weg. |

Der Offline-Abgleich ruht während der Unterbrechung (wie im Konflikt, `abgleichFuer`) und läuft
nach der Auflösung mit derselben Person wieder an; die vorgemerkten Einträge gehen dann hinaus.

### Der Dialog

- Eigene Komponente unter `auth/` neben `BenutzerKonfliktDialog`, eingehängt in `SitzungsLayout`.
  Nicht schließbar (kein Kreuz, kein Escape, kein Maskenklick), Fokus gefangen.
- **Undurchsichtige Abdeckung** in der Flächenfarbe der Gestaltungssprache, über allem, auch
  über offenen antd-Dialogen, Schubladen und Popovern der Seite (z-index über deren Stapel).
- Inhalt: Kopf „Sitzung beendet“, Satz „Melde dich erneut an. Deine Eingaben auf dieser Seite
  bleiben erhalten.“, Benutzername mit dem bisherigen vorbelegt (änderbar), Passwort,
  „Anmelden“. Zweitfaktor-Stufe im Dialog. Passkey, wenn er auf der Anmeldeseite angeboten würde.
  Restlaufzeit der Frist sichtbar („Ohne Anmeldung wird diese Seite in 14 min geschlossen“ o. ä.).
- **SSO** (OIDC) steht im Dialog mit Hinweis „Verlässt die Seite, Eingaben auf dieser Seite
  gehen verloren“; der Redirect kehrt auf die aktuelle Adresse zurück.
- „Abmelden“ als Nebenaktion.
- **Einmalpasswort-Zwang** (LFH-1121) nach der Anmeldung: kommt bei derselben Person praktisch
  nur vor, wenn ein Admin ihr ein Einmalpasswort vergeben hat; dann ist „Neues Passwort
  festlegen“ auch im Dialog nötig, weil es sonst keine Sitzung gibt.
- Die Anmeldelogik wird **nicht verdoppelt**: die Stufen der `LoginPage` (Passwort, Zweitfaktor,
  Passkey, Passwort festlegen, Fehlerauswertung, Doppel-Absende-Riegel) werden in eine gemeinsame
  Komponente gezogen, die Seite und Dialog nutzen; sie meldet „angemeldet“ an den Aufrufer,
  statt selbst zu navigieren.

### Anmeldeseite

- Landet man über das Sitzungsende auf `/login` (Frist, „Abmelden“ im Dialog), steht oben ein
  Hinweis „Sitzung beendet – bitte erneut anmelden“ (Grund über `location.state`, kein Speicher).

### Regeln, die sich ändern

- `frontend/src/auth/AGENTS.md`: Abschnitt zur Sitzungswache — 401 im Betrieb unterbricht statt
  abzumelden; Auflösung nach der Tabelle oben; Frist 15 min.
- `frontend/src/offline/AGENTS.md`: „Gelöscht wird Speicher und Platte bei … 401“ und „Ein Weg
  hinaus“ — bei einer 401 im Betrieb geht die Platte sofort, der Speicher spätestens mit der Frist.
- Neue Regel in `auth/AGENTS.md`: die Abdeckung der Unterbrechung ist undurchsichtig.

## Dem Builder überlassen

- Namen von Zustand, Funktionen und Komponenten (Bezeichner-Sprache LLH-1312).
- Wie Abfragen während der Unterbrechung ruhen (z. B. nicht neu abrufen lassen) — Hauptsache,
  die Seite hagelt keine 401-Schleife und zeigt nach der Auflösung frische Daten.
- Wie der Lagebild-Persister pausiert (ohne den Query-Cache zu leeren).
- Schnitt der gemeinsamen Anmeldekomponente aus `pages/LoginPage.tsx`.
- Umsetzung der Frist (Timer im Provider; ein verdeckter Tab zählt mit).

## Nachweis

- Unit-Tests im `AuthProvider`/`useSitzungsWache`: 401 → Unterbrechung, Benutzer bleibt, Platte
  geräumt, Speicher nicht; gleiche Person → aufgelöst ohne Neuladen; andere Person → Neuladen;
  Frist → voller Ausgang; angekündigtes Abmelden → alter Weg; Gerät → alter Weg.
- e2e: Formular „Meldung erfassen“ ausfüllen, Sitzung serverseitig beenden, 401 auslösen,
  Dialog erscheint, gleiche Person meldet sich an, Formular steht mit dem Text da und lässt sich
  senden. Bestehende Specs `sitzung-mehrere-tabs`, `sitzung-beenden`, `lagebild-offline` an den
  neuen Weg anpassen.
