# Prüfliste Einsatztauglichkeit: Anmeldung der Mac-App im Browser (LFH-818)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung, Specs und Messung liegen in
`openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Seiten | `/app-anmeldung` (neu, im Systembrowser), `/login` in der macOS-Hülle (umgebaut: „Im Browser anmelden“), `/profil` in der macOS-Hülle (Hinweistext) |
| Stand | Branch `claude/lfh-818-after-pr-240-1385e4` auf `origin/alpha` nach PR 240 |
| Zielkontext | Fükw und ortsfeste Stelle am Mac (Tastatur und Maus). Die Bestätigung läuft im Standardbrowser des Macs. Tablet und mobil betrifft das nicht, dort gibt es keine Mac-Hülle |
| Nicht enthalten | Das Anmeldeblatt selbst (`ASWebAuthenticationSession`) gehört macOS und dem Browser. Die Anmeldung im Browser (`/login` ohne Hülle) ändert sich nicht |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Vitest `AppAnmeldungPage.test.tsx` (6) | Ohne Sitzung zur Anmeldung, mit Rückweg samt `challenge`. Die Seite nennt die Person, der Code wird erst nach dem Klick angefordert. Rücksprung auf `lifeline://anmeldung?code=…`, der Code steht nie im DOM. Ein Fehler erscheint an der Seite, der Knopf bleibt danach bedienbar. Kaputte `challenge`: Hinweis, keine Anfrage. „Mit anderem Konto“: abmelden, dann Anmeldung mit Rückweg |
| Vitest `LoginPage.test.tsx`, Block LFH-818 (8) | Gegenprobe im Browser: kein Knopf. In der Hülle: Knopf neben dem Passwort, kein Passkey-Knopf, der Knopf ist nur gesperrt, solange der Start läuft. Bei nur-Passkey ersetzt der Knopf den Hinweis aus LFH-817. Ergebnisse `angemeldet`, `abgelehnt`, `fehler`, `abgebrochen`. Eine Ablehnung durch die Hülle erscheint an der Seite. Rückweg mit Query nach dem Passwort-Login. Mutationsprobe: der Knopf ohne Hüllenbedingung macht die Gegenprobe rot |
| Vitest `ProfilPage.test.tsx` | Hinweis „… über ‚Im Browser anmelden‘ an“ nur mit Hüllen-Weg, sonst der Satz aus LFH-817. Die Einrichtung fehlt weiterhin |
| Kontrast `.login-hinweis` (`--lfh-gedaempft` auf `--lfh-paneel`) [abgeleitet] | Tag 7,71 : 1 (`#474e57` auf `#f4f5f7`), Nacht 7,59 : 1 (`#9aa2ab` auf `#0a0c0e`) |
| Grep über die neuen und geänderten Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink` neu 0 · `size="small"` 0 · Emoji 0 |

---

## Tabelle 1: `/app-anmeldung` (neu)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Zwei Knöpfe `size="large"` in voller Breite; antd leitet `controlHeightLG` aus der Dichte ab (≥ 37,5 px kompakt) [abgeleitet], 16 px Abstand (`Space size="middle"`) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Die Höhen folgen dem Dichte-Token am `ConfigProvider` (Handschuh ≥ 72 px) [abgeleitet]. Kein punktuelles `size="small"` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Der Knopf lädt sofort (`loading`). Danach folgt der Satz „Du kannst dieses Fenster schließen“ | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Die Anmeldung der App ist die zweite Handlung: Der Anstoß kam aus der App, die Seite bestätigt mit Namen („In der Mac-App anmelden als …“), erst der Klick stellt den Code aus | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | Login-Karte mit Rollenfarben wie `/login`. Neue Texte laufen über antd `Typography` (Rollen) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Fehler und Warnsatz („Bestätige nur, wenn …“) als `Alert` mit Text und Ikone | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Primärknopf blau (Bedienung), Warnsatz in der Achtung-Farbe, Fehler rot nur für den Fehler | — |
| 8 | **Helligkeits-/Kontrastregler** | **nicht anwendbar** | Die Seite läuft im Systembrowser, der Regler der App (LFH-397) greift dort wie auf `/login` | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Name und Knöpfe mittig in der Karte, oberes Drittel | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Die Seite erzeugt keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken. Der Fehler bleibt stehen bis zum nächsten Versuch | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Keine Live-Daten. Der Fehlerhinweis erscheint über den Knöpfen erst nach dem Klick, also als Folge der eigenen Handlung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | Keine fixierten Köpfe oder Leisten. Die Karte scrollt intern (`login-karte`) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung, nur eine Bestätigung | — |

## Tabelle 2: `/login` in der macOS-Hülle (umgebaut)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | „Im Browser anmelden“ ist `size="large"`, `block`, wie die übrigen Anmeldeknöpfe [abgeleitet] | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Höhe aus dem Dichte-Token [abgeleitet], kein punktuelles `size="small"` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Der Knopf lädt, solange die Hülle startet. Danach öffnet macOS das Anmeldeblatt. Das Ergebnis meldet die Seite als Hinweis oder durch den Wechsel zum Ziel | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Anmelden ist nicht kritisch im Sinn der Liste (weder Storno noch Löschen noch Alarmierung) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | `.login-hinweis` 7,71 : 1 Tag, 7,59 : 1 Nacht [abgeleitet] | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Ergebnisse als `Alert` mit Text; der Abbruch als sachlicher Hinweis (`info`), nicht als Fehler | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Neuer Knopf umrandet (sekundär), keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | Unverändert, der Regler der App gilt (LFH-397) | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Fehlerhinweis oben in der Karte wie bisher | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Der Knopf steht fest unter Formular und SSO. Der Hinweis erscheint nur als Folge der eigenen Handlung | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | Unverändert, keine fixierten Elemente | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Anmeldung, keine Erfassungsmaske | — |

## Tabelle 3: `/profil` in der macOS-Hülle (Hinweistext)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **nicht anwendbar** | Nur ein Satz, kein neues Bedienziel | — |
| 2 | **Handschuh-Modus** | **nicht anwendbar** | Kein neues Bedienziel | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Keine Handlung | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Keine Handlung | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | `Typography.Paragraph type="secondary"` wie bisher (LFH-817) | — |
| 6 | **Kein Status allein über Farbe** | **nicht anwendbar** | Kein Status | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** | Unverändert | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Kein kritischer Inhalt | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **nicht anwendbar** | Keine Warnung | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Der Text hängt nur an der Hüllen-Kennung, die vor dem ersten Skript feststeht, und springt also nicht nach | — |
| 13 | **Fokus nie verdeckt** | **nicht anwendbar** | Kein Fokusziel | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung | — |
