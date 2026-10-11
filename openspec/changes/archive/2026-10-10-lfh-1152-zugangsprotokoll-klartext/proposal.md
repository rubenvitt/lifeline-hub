# Proposal

## Why

Das Zugangsprotokoll der Verwaltung (`/admin/zugangsprotokoll`, LFH-1097) soll einem Admin
beantworten, wer sich wann auf welchem Weg angemeldet und was die Verwaltung an Konten geändert
hat. Beim Kapitel „Zugangsprotokoll“ der Anwenderdoku (LFH-1127) fiel auf, dass es an vier
Stellen interne Kennungen, Rohwerte oder schlicht Falsches zeigt (LFH-1152). Ein Protokoll, das
„geraetecode“, „org_rolle: keine → fuehrungskraft“ oder eine UTC-Zeit zeigt, liest nur, wer den
Code kennt. Und eine Abmeldung, die „Passwort“ angibt, obwohl die Sitzung per Passkey entstand,
ist eine falsche Aussage in einer Spur, die als Nachweis gedacht ist.

## What Changes

- **Anmeldeweg im Klartext, vollständig.** Jeder Wert, den der Server als Anmeldeweg in die
  Anmeldespur schreibt, bekommt einen Klartext: neu „Zweiter Faktor“ (`totp`), „Gerätecode“
  (`geraetecode`) und „Mac-App“ (`systembrowser`). Die Werte werden ein geschlossenes Enum
  (Typ-Codegen), sodass ein künftiger neuer Anmeldeweg den Typecheck im Frontend bricht, statt
  roh in der Liste zu erscheinen.
- **Die Sitzung merkt sich ihren Anmeldeweg.** Eine neue Sitzung trägt den Anmeldeweg, mit dem
  sie entstand. Abmeldung und „Sitzung beendet“ schreiben diesen Weg statt fest „Passwort“.
  Kennt eine Sitzung ihn nicht (vor dem Update angelegt), steht „—“.
- **Detail ohne Rohwerte.** Die Zugangsänderungen „Konto angelegt“, „Rolle geändert“ und
  „Sitzung beendet“ führen ihr Detail strukturiert. Das Frontend zeigt Rollen mit den Namen aus
  dem Benutzer-Dialog („System-Rolle: Benutzer → Admin“) und den Anmeldezeitpunkt einer beendeten
  Sitzung in Zone und Format der Organisation (taktische DTG wie die Spalte „Zeitpunkt“).
  Einträge von vor dem Update bleiben unverändert stehen.
- **Kontofilter mit Teiltreffern.** Das Kontofeld trifft jeden Namen, der den getippten Text
  enthält (Groß- und Kleinschreibung egal). Beim Tippen zeigt die Liste damit die passenden
  Einträge statt „Keine Anmeldungen“.

## Capabilities

### New Capabilities

- `zugangsprotokoll`: Was das Zugangsprotokoll der Verwaltung zeigt und wie es filtert —
  Anmeldespur und Admin-Spur in Klartext, Anmeldeweg der Sitzung, Detail der
  Zugangsänderungen, Kontofilter.

### Modified Capabilities

(keine — die Anmelde-Capabilities `passwort-anmeldung` und `anmeldung-systembrowser` behalten
ihre Anforderungen; was die Spur bei Abmeldung und beendeter Sitzung schreibt, regelt die neue
Capability.)

## Impact

- **Backend:** Migration (neue Spalte `session.anmeldeweg`), `auth::session` (Anlegen, Logout-
  Nachschlag, Beenden), `routes::auth` (sechs Anmeldewege reichen ihren Weg durch, Logout),
  `geraet` (Gerätesitzung), `routes::sitzung` (Audit beim Beenden), `routes::benutzer`
  (Detail bei Anlage und Rollenwechsel), `auth::admin_audit` (strukturiertes Detail lesen und
  schreiben, Kontofilter), `auth::audit` (Anmeldeweg-Enum als Schema-Anker, Kontofilter),
  `auth::spur`.
- **API:** `GET /api/zugangsprotokoll/anmeldungen` — `provider` wird ein Enum (gleiche Werte,
  plus `unbekannt`). `GET /api/zugangsprotokoll/zugangsaenderungen` — neues optionales Feld
  `angaben` neben `detail`. Beide additiv; Typ-Codegen nachziehen (`scripts/check-typ-codegen.sh`).
- **Frontend:** `zugangsprotokoll/zugangsprotokollText.ts`, `ZugangsprotokollPage.tsx`;
  Rollen-Bezeichnungen aus `pages/BenutzerPage.tsx` an eine gemeinsame Stelle.
- **Doku:** Kapitel „Zugangsprotokoll“ der Anwenderdoku (LFH-1127) prüfen; die Mitänderungsregel
  in `docs/anwender/AGENTS.md` entscheidet, ob Text und Bilder nachziehen.
- Keine neue Abhängigkeit.
