# Sackgassen bei fehlendem Recht nennen den Ansprechpartner — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/zbihthkruxvgv5ih4hhccgz5 (LLH-1819, Welle 2
„Rollen“ unter LLH-1811). Route `entwurf` (E1 Datenschutz-Entscheidung, E2 neue Regel im
403-Umschlag, E3 Backend und Frontend). Abgestimmt am 19.11.2026.

## Absicht

Wer kein Recht hat, landet heute in drei Sackgassen, die nie sagen, **wen** man fragen muss:

1. **Leere Einsatzliste** (`frontend/src/pages/EinsaetzePage.tsx`, `SeitenLeer titel="Keine Einsätze"`).
2. **Direktlink auf einen Einsatz ohne Recht** (`frontend/src/einsatz/EinsatzLayout.tsx`,
   `SeitenSackgasse`): „Einsatz konnte nicht geladen werden · Keine Berechtigung“ mit dem
   Hauptknopf „Erneut abrufen“, der bei einem 403 nie hilft.
3. **Gesperrtes Modul** (`frontend/src/einsatz/ModulGesperrt.tsx`): „Für deine Rolle nicht
   freigegeben“ bzw. „In diesem Einsatz ausgeblendet“.

Ziel: Jede dieser Stellen sagt, wer den Zugriff vergibt, soweit das ohne Datenleck geht, und
bietet keinen Knopf an, der nichts ändert.

**Erhalten bleibt:** „Nur Ansicht · nur Einsatzleitung und Führungspersonal“ auf jeder Seite,
das Schloss an gesperrten Modulen, der Rückweg als Primäraktion in `ModulGesperrt`, der Knopf
„Modulfreigaben öffnen“ für Personen, die Freigaben verwalten.

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziel:** Der 403 einer Einsatzabfrage trägt einen fachlichen Grund; das Frontend wählt daraus
  Text und Knöpfe. Gesperrte Module nennen die Einsatzleitung beim Namen.
- **Nicht-Ziel:** Ein Weg, Zugriff aus der App heraus anzufragen (Anfrage-Knopf, Benachrichtigung).
  Die Verwaltung der Organisation mit Namen nennen.
- **Anti-Ziel:** Ein Name oder ein Zustand des Einsatzes (gelöscht, Frist abgelaufen) erreicht
  eine Person, die heute nichts über den Einsatz erfährt. Jeder Grund außer `kein_mitglied` geht
  nur an Personen, die den Einsatz grundsätzlich sehen dürften.

## Entscheidungen (19.11.2026, mit dem Menschen)

| Frage | Entscheidung |
| --- | --- |
| Name der Einsatzleitung am Direktlink (403) | **Nie.** Text ohne Namen. |
| Welcher Name im gesperrten Modul | **Mitglieder mit Einsatzrolle Einsatzleitung** (aus `GET /api/einsaetze/{id}/mitglieder`) |
| Leere Einsatzliste | **Hinweis ohne Namen**, kein neues Backend-Feld |
| 403 nach Nachlauf- oder Aufbewahrungsfrist | **Eigener Text** über einen Grund im 403-Umschlag |

## Ansätze

- **V1 — nur Frontend-Texte.** Ein Text für jeden 403, „Erneut abrufen“ weg. Billig, aber ein
  früheres Mitglied nach Ablauf der Nachlauffrist liest „Zugriff vergibt die Einsatzleitung“,
  obwohl die Einsatzleitung nichts vergeben kann. Verworfen.
- **V2 — Grund im 403-Umschlag + Namen nur im Modul (gewählt).** Backend sagt *warum*, ohne mehr
  zu verraten als heute; Namen nur dort, wo die Person schon Mitglied ist und
  `…/mitglieder` ohnehin lesen darf. Kein Leck.
- **V3 — wie V2, zusätzlich Name am Direktlink.** Verrät Fremden, wer einen Einsatz leitet.
  Nur mit Datenschutz-Freigabe; am 19.11. abgelehnt.

## Backend

### Grund im 403-Umschlag

Neue Fehlervariante in `src/error.rs`, nach dem Muster von `NichtInListe`/`Veraltet`:

- `AppError::KeinLesezugriff(LeseSperre)` → Status 403, Body
  `{"error": "Keine Berechtigung", "grund": "<wert>"}`. `Display` bleibt „Keine Berechtigung“.
- `LeseSperre` per `wire_enum!` (ADR-0006), samt Eintrag im Enum-Wire-Kontrakt
  (`tests/enum_wire_kontrakt.rs`):
  - `KeinMitglied => "kein_mitglied"` — weder Mitglied noch Fremdeinsatz-Lesezugriff.
  - `NachlaufAbgelaufen => "nachlauf_abgelaufen"` — Mitglied ohne Einsatzleitung, Einsatz
    abgeschlossen, Nachlauffrist vorbei.
  - `NichtMehrLesbar => "nicht_mehr_lesbar"` — Löschvermerk (`geloescht_at`) oder abgelaufene
    Aufbewahrungsfrist (`retention_bis`).
- Jede Stelle, die heute auf `AppError::Forbidden` matcht, um „kein Recht“ zu erkennen, nimmt die
  neue Variante mit (bekannt: `Display`, `status_code`, `EinsatzKontext::darf_zielmodul` in
  `src/einsatz/kontext.rs`; der Builder greppt nach weiteren, etwa `public_api/error.rs` über
  `From<AppError>`).

### Wo der Grund entsteht (`src/einsatz/berechtigung.rs`)

- `darf_lesen` wird zu `lese_sperre(...) -> Option<LeseSperre>` mit denselben Eingaben;
  `darf_lesen` bleibt als `lese_sperre(..).is_none()` stehen, damit die übrigen Aufrufer und
  Tests unverändert bleiben. **Das Ja/Nein ändert sich für keine Eingabe.**
- **Reihenfolge der Gründe** (Anti-Ziel): zuerst `kein_mitglied` (weder Rolle noch
  `darf_fremdeinsatz_lesen`), erst danach `nicht_mehr_lesbar`, dann `nachlauf_abgelaufen`. So
  erfährt ein Fremder nie, dass ein Einsatz gelöscht oder abgelaufen ist. Heute prüft
  `darf_lesen` Löschvermerk und Aufbewahrung zuerst; für das Ergebnis `false` ist das gleich, für
  den Grund nicht.
- `fordere_lesezugriff` liefert `KeinLesezugriff(grund)` statt `Forbidden`.
- `fordere_org_zugehoerigkeit` (Org-Floor im Extractor, ADR-0005) liefert
  `KeinLesezugriff(KeinMitglied)` statt `Forbidden`.
- Alle übrigen 403 (Schreibrecht, Einsatzleitung, Modulfreigabe, Admin) bleiben unverändert
  `Forbidden`.

### Tests (Rust)

- Je Grund ein Test über `lese_sperre`, dazu: Fremder + Löschvermerk → `kein_mitglied`; Fremder +
  abgelaufene Aufbewahrung → `kein_mitglied`.
- Eigenschaft: `darf_lesen` liefert für die bestehende Testmatrix dasselbe wie vorher (bestehende
  Tests bleiben grün; Tests, die `AppError::Forbidden` von `fordere_lesezugriff` erwarten, prüfen
  jetzt die Variante mit Grund).
- Umschlagtest in `src/error.rs` wie `nicht_in_liste_ist_404_mit_grund`: 403 mit `grund`.
- Ein Routentest: `GET /api/einsaetze/{id}` als Nicht-Mitglied → 403, `grund: "kein_mitglied"`.

## Frontend

### Grund lesen (`frontend/src/api/client.ts`)

`ApiError.grund` wird schon gelesen. Neu: Konstanten `GRUND_KEIN_MITGLIED`,
`GRUND_NACHLAUF_ABGELAUFEN`, `GRUND_NICHT_MEHR_LESBAR` (Verweis auf `src/error.rs`) und ein
Helfer `istKeinRecht(e)` = `ApiError` mit Status 403.

### Direktlink (`EinsatzLayout.tsx` → `SeitenSackgasse`)

Bei 403 und 404 **kein „Erneut abrufen“**; der Rückweg „Zur Einsatzliste“ wird die einzige
(primäre) Aktion. Texte:

| Lage | Titel | Hinweis |
| --- | --- | --- |
| 403 `kein_mitglied` oder 403 ohne bekannten Grund | Kein Zugriff auf diesen Einsatz | Zugriff vergibt die Einsatzleitung dieses Einsatzes. |
| 403 `nachlauf_abgelaufen` | Einsatz nicht mehr einsehbar | Die Lesefrist nach Abschluss ist abgelaufen. Einsehen kann ihn nur noch die Einsatzleitung. |
| 403 `nicht_mehr_lesbar` | Einsatz nicht mehr einsehbar | Die Aufbewahrungsfrist ist abgelaufen. |
| 404 | (unverändert, `SeitenNichtGefunden`-Logik bzw. heutiger Text) | ohne „Erneut abrufen“ |
| 5xx, Netz | unverändert, mit „Erneut abrufen“ | |

`SeitenSackgasse` bekommt dafür nichts Neues außer dass der Rückweg primär wird, wenn kein
`onWiederholen` gesetzt ist. Ein 403 ist keine Störung: die Kante in `alarm` entfällt bei
fehlendem Recht (neutral wie `ModulGesperrt`, „eine Sperre ist keine Gefahr“). *Builder-Entscheid,
falls das die Komponente unnötig verbiegt: Kante behalten, Texte und Knopf sind der Kern.*

Die Texte stehen als Konstanten neben der Entscheidung (eine Funktion
`sackgasseBeiFehler(error) → {titel, hinweis, wiederholbar}`), testbar ohne Rendern.

### Gesperrtes Modul (`ModulGesperrt.tsx`)

Unter der Sperrzeile eine zweite Zeile:

- Mitglieder mit `einsatz_rolle` Einsatzleitung vorhanden: „Freigabe erteilt die Einsatzleitung:
  Anna Muster, Ben Beispiel“ (`anzeigename`, Reihenfolge der Liste, alle Namen).
- Keine solche Person oder Liste nicht geladen/fehlerhaft: „Freigabe erteilt die Einsatzleitung.“
  (ohne Namen; kein Lade- oder Fehlerzustand im Paneel, die Zeile ist Zusatz).
- Die Person verwaltet die Freigaben selbst (`freigabenPfad` gesetzt): **keine** Zeile, der
  Knopf „Modulfreigaben öffnen“ genügt.
- Gekoppeltes Gerät: keine Zeile (es ruft `…/mitglieder` nicht ab; Positivliste in
  `src/geraet/mod.rs`).

Daten über den bestehenden Abruf `GET /api/einsaetze/{id}/mitglieder` mit dem Schlüssel aus
`einsatzKeys` (nicht inline, Wächter `queryKeys.guard.test.ts`); `ModulGesperrt` bekommt die
Namen als Prop (`einsatzleitung?: string[]`), der Abruf sitzt im Aufrufer in `EinsatzLayout.tsx`
und läuft nur, wenn ein gesperrtes Modul gezeigt wird.

### Leere Einsatzliste (`EinsaetzePage.tsx`)

`<SeitenLeer titel="Keine Einsätze" hinweis="Zu einem Einsatz nimmt dich dessen Einsatzleitung auf." />`.
Gilt auch für Personen, die anlegen dürfen (die Anlegen-Kachel steht darunter; der Satz bleibt
wahr). Die Lage „Suche/Filter ohne Treffer“ ist ein anderer Zustand und bleibt unberührt.

### Tests (Frontend)

- `sackgasseBeiFehler`: je Grund, 403 ohne Grund, 404, 500, Netzfehler.
- `ModulGesperrt`: mit Namen, ohne Namen, mit `freigabenPfad` (keine Zeile).
- `EinsatzLayout`: 403 zeigt keinen Knopf „Erneut abrufen“ (bestehender Test passt sich an).
- `EinsaetzePage`: leere Liste zeigt den Hinweis.

## Doku und Bilder

- Anwenderdoku: Kapitel, die diese Zustände zeigen oder beschreiben, nach
  `docs/anwender/AGENTS.md` (Mitänderungsregel) mitziehen; der Builder sucht sie per grep nach
  „Keine Berechtigung“, „nicht freigegeben“, „Keine Einsätze“.
- Arc42: prüfen, ob der 403-Umschlag in einem Kapitel steht (`docs/architektur/AGENTS.md`);
  `src/AGENTS.md`, Statuscode-Konvention, um den Grund im 403 ergänzen.
- Bilder der Änderung (alle drei Stellen, vorher/nachher) in PR und Abschlussmeldung.

## Dem Builder überlassen

- Genaue Signatur von `lese_sperre` und Name des Helfers im Frontend.
- Ob die `alarm`-Kante bei fehlendem Recht entfällt (s. oben, Empfehlung: entfällt).
- Formulierung der Texte im Rahmen der Tabelle, sofern Sinn und Länge bleiben.
