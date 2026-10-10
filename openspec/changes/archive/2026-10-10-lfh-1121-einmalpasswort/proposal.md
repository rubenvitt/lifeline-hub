# Proposal

## Why

Die Anmeldeseite verspricht „Passwort vergessen? Die Administration deiner Organisation setzt es
zurück.“ Die Benutzerverwaltung kann aber kein Passwort setzen: Eine Route dafür gibt es nicht,
und `PatchBenutzer` nimmt bewusst nur Anzeigename, Rollen und `aktiv` an. Wer sein Passwort
vergisst, kommt also nicht wieder hinein, es sei denn, das Konto wird neu angelegt (LFH-1121,
gefunden beim Schreiben der Anwenderdoku in LFH-1096).

Am 10.10.2026 hat der Mensch Weg A2 gewählt: Die Administration vergibt ein **Einmalpasswort**,
und wer sich damit anmeldet, muss sofort ein eigenes Passwort festlegen. Dabei gilt:

- Der Server erzeugt das Einmalpasswort.
- Der Zwang greift nur bei der Anmeldung mit Passwort.
- Auch das Passwort, das bei „Benutzer anlegen“ vergeben wird, gilt als Einmalpasswort.

## What Changes

- **Neue Admin-Aktion „Einmalpasswort vergeben“**
  - Neue Route `POST /api/benutzer/{id}/einmalpasswort`.
  - Der Server erzeugt ein gut lesbares Zufallspasswort, setzt es als neues Passwort und markiert
    das Konto mit dem Änderungszwang.
  - Alle Sitzungen der Person enden, auch die offenen Tabs (`live.melde_sitzung_ende`).
  - Der Server antwortet das Einmalpasswort genau einmal (`no-store`).
  - Die Admin-Spur bekommt die neue Aktion `einmalpasswort_vergeben`.
  - Abgewiesen werden ein fremdes Konto (404), ein Gerätekonto (404), das eigene Konto (422), ein
    SSO-only-Konto (422) und ein abgeschalteter Passwort-Provider (403).
- **Änderungszwang bei der Anmeldung mit Passwort**
  - Das Konto bekommt eine neue Spalte `passwort_wechsel_pflicht`.
  - Ein Passwort-Login auf ein so markiertes Konto liefert **keine Sitzung**. Er antwortet stattdessen
    `{"passwort_wechsel_erforderlich": true}` und setzt ein kurzlebiges HttpOnly-Cookie. Das ist
    dasselbe Muster wie beim TOTP-Zwischenschritt.
  - Bei aktivem TOTP lautet die Reihenfolge Passwort → TOTP → Wechsel.
  - Erst der neue Endpunkt `POST /api/auth/passwort/festlegen` legt das neue Passwort fest. Dabei
    gelten 8–128 Zeichen, und es muss sich vom Einmalpasswort unterscheiden. Der Endpunkt hebt den
    Zwang auf und legt die Sitzung an.
  - Passkey, SSO und App-Code bleiben unberührt.
- **Benutzer anlegen:** Ein neues Konto startet mit `passwort_wechsel_pflicht = 1`. Den Bootstrap-Admin,
  Dev-Seeds und Demo-Daten betrifft das nicht.
- **Self-Service-Wechsel:** `POST /api/auth/passwort` hebt einen offenen Zwang ebenfalls auf. Das
  betrifft eine Person, die sich per Passkey angemeldet hat und ihr Passwort im Profil ändert.
- **Frontend**
  - Die Anmeldeseite bekommt den Schritt „Neues Passwort festlegen“ mit den Feldern „Neues Passwort“
    und „Wiederholen“. Er folgt demselben Muster wie der TOTP-Schritt.
  - Im Bearbeiten-Dialog der Benutzerverwaltung kommt die Aktion „Einmalpasswort vergeben“ dazu: erst
    eine Rückfrage, dann wird das Passwort einmal angezeigt, mit Kopierknopf.
  - Das Zugangsprotokoll beschriftet die neue Aktion.
  - Der Hinweis auf der Anmeldeseite bleibt, denn jetzt stimmt er.
- **Anwenderdoku:** Die Kapitel `anmelden-abmelden`, `benutzer` und `zugangsprotokoll` werden
  nachgezogen, die Bilder dazu per Skript neu erzeugt.

## Capabilities

### New Capabilities

- `konto-einmalpasswort`: Die Administration vergibt ein Einmalpasswort, das Konto steht dann unter
  Änderungszwang. Die Fähigkeit legt fest, wie der Passwort-Login ein solches Konto in den Schritt
  „Neues Passwort festlegen“ statt in eine Sitzung führt und wann der Zwang endet.

### Modified Capabilities

(keine) Die Anforderungen von `passwort-anmeldung` und `konto-passwortwechsel` gelten unverändert
weiter. Was neu hinzukommt (der Zwischenschritt beim Login und das Aufheben des Zwangs beim
Self-Service-Wechsel), gehört zur neuen Fähigkeit.

## Impact

- **Backend**
  - `src/routes/benutzer.rs`: neue Route, und `anlegen` setzt den Zwang.
  - `src/routes/auth.rs`: `login`, `totp_finish`/`totp_pruefen`, `passwort_aendern` und der neue
    Endpunkt `passwort_festlegen`.
  - Ein neuer Pending-Speicher nach dem Muster von `auth/totp/state.rs`.
  - `src/auth/admin_audit.rs`.
  - Die Routen kommen in `src/app.rs` dazu.
- **Migrationen:** zwei neue, nämlich Spalte `benutzer.passwort_wechsel_pflicht` und CHECK von
  `admin_audit.aktion` (Neuaufbau nach dem Muster von 0170). Nummern über der höchsten auf `alpha`.
- **API und Codegen**
  - `AdminAktion` bekommt einen neuen Wert, und das Antwort-DTO `Einmalpasswort` kommt neu dazu.
    `scripts/check-typ-codegen.sh` läuft, `openapi.json` und `types.generated.ts` werden
    mitcommittet.
  - Die Login-Antwort bekommt eine weitere handgepflegte Variante.
  - **Verhaltensänderung:** Ein frisch angelegtes Konto bekommt beim ersten Passwort-Login keine
    Sitzung mehr, sondern den Zwischenschritt.
- **Tests**
  - Rust: `tests/common/mod.rs` (`benutzer_anlegen`, 274 Aufrufer) erledigt den Erstwechsel selbst.
    Rund 35 Stellen, die direkt `POST /api/benutzer` rufen und sich danach anmelden, werden geprüft.
  - e2e: Rund 12 Specs und Bildskripte legen Konten per API an und melden sich an. Sie bekommen
    einen gemeinsamen Helfer.
- **Frontend:** `pages/LoginPage.tsx`, `auth/AuthContext.tsx`, `api/auth.ts`,
  `pages/BenutzerPage.tsx` und `zugangsprotokoll/zugangsprotokollText.ts`. Dazu kommen die
  Passwortfelder als gemeinsamer Baustein mit `auth/PasswortAendernDialog.tsx`.
- **Doku:** drei Kapitel unter `docs/anwender/kapitel/`, Bildskripte unter `frontend/e2e/doku-bilder/`.
- **Nicht betroffen:** Desktop-Hülle (der Wechsel geschieht im Systembrowser vor `/app-anmeldung`),
  Offline-Lagebild (vor dem Wechsel entsteht keine Sitzung und kein Schnappschuss) und
  Gerätekonten.
