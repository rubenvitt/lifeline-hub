# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/gwcf2shk8trgugyk871op4lc (LLH-1678). Folgt auf LLH-1497,
Change `t10a7luh-elw-lan-direktkopplung`.

## Why

Über eine Direktkopplung vor Ort (ELW ↔ ELW im LAN) fließen heute nur Akten, Spiegel und Anträge.
Fällt der führende ELW aus, kann der andere ELW im LAN die Führung nicht übernehmen, und ein Wechsel
zwischen zwei ELW, den es auf anderem Weg gab, bleibt am Hub stehen. Die Lösung ist am 13.11.2026 mit
Ruben abgestimmt.

## What Changes

- **Führungswechsel über die Direktkopplung, gleichrangig:** Übergabe, Abgabecode, Anfrage und
  Notübernahme sind zur Gegenstelle einer Direktkopplung in beide Richtungen möglich, unabhängig
  davon, wer den Code eingelöst hat. Beide Seiten folgen derselben Regel. Die Richtung der Kopplung
  spielt dafür keine Rolle.
- **Keine Seite gibt still ab:**
  - Eine Notübernahme vor Ort braucht immer einen Beweis, entweder die Unterschrift eines
    Org-Admins oder den Abgabecode der Gegenstelle.
  - Die übernehmende Seite führt sofort. Die abgebende Seite hält die Übernahme offen, bis ihre
    Einsatzleitung bestätigt oder widerspricht.
  - Ohne gültigen Beweis verwirft die abgebende Seite die Übernahme und führt weiter.
- **Antwort auf die eigene Übernahme:** Widerspricht die abgebende Seite einer Übernahme oder
  verwirft sie, nimmt die übernehmende Seite das an. Voraussetzung ist, dass die Antwort genau ihre
  Übernahme beantwortet. Sie meldet das mit Alarm an die Einsatzleitung und einem Eintrag in der
  Admin-Spur. Ein Hin und Her gibt es nicht.
- **Anfrage vor Ort mit Menschen:**
  - Eine Anfrage über die Direktkopplung wird nicht mehr von selbst erfüllt.
  - Die führende Seite zeigt „<Name> bittet um die Führung“ mit „Übergeben“ und „Ablehnen“ und
    benachrichtigt ihre Einsatzleitung.
  - Eine Ablehnung geht mit der Akte zurück, und der Anfragende sieht „Anfrage abgelehnt“.
  - Zwischen Hub und ELW bleibt die Anfrage automatisch.
- **Der Hub zieht nach.** Er nimmt einen Führungswechsel zwischen zwei ELW an, wenn eine der
  beiden Bedingungen gilt:
  - Der bisherige Führer bezeugt die Abgabe an die dritte Instanz.
  - Die Akte trägt eine Notübernahme gegen den bisherigen Führer, deren Unterschrift gegen die
    Schlüssel des Hubs gilt.

  Ein Code-Beweis genügt dem Hub nicht, den kann er nicht prüfen.
- **Unterschriftsschlüssel über die Direktkopplung:**
  - Beide Seiten liefern einander die gültigen Unterschriftsschlüssel der Org: die lokal
    registrierten und die, die sie von einem Gegenüber (dem Hub) kennen.
  - Ein Widerruf gilt an einer Instanz für jede Zeile mit derselben Credential-ID.
- **Protokoll 4:** Ein Wechsel vor Ort ist nur möglich, wenn beide Seiten Protokoll 4 sprechen.
  Sonst bleibt die heutige Sperre, mit dem Hinweis „<Name> braucht ein Update für den
  Führungswechsel vor Ort“.
  - **BREAKING für Protokoll 2:** Nach N/N−1 kommt eine Instanz mit Protokoll 2 mit einer
    Gegenseite mit Protokoll 4 nur noch zu Melden und Status.
- **Unverändert:**
  - Die Regeln zwischen Hub und ELW.
  - Die Verwahrung bleibt vor Ort gesperrt.
  - Der Widerruf einer Direktkopplung holt die Führung nicht zurück.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `instanz-fuehrung`:
  - Die Sperre „Über eine Direktkopplung wechselt die Führung nicht“ und „Eine Direktkopplung nimmt
    keinen Führungswechsel zwischen ihren Seiten an“ wird durch die gleichrangige Regel ersetzt.
  - Neu sind die Anfrage vor Ort mit Bestätigung und Ablehnung, die Antwort auf die eigene
    Übernahme und das Nachziehen am Hub.
- `org-admin-unterschrift`: Unterschriftsschlüssel fließen über eine Direktkopplung in beide
  Richtungen, auch die vom Gegenüber übernommenen. Ein Widerruf gilt je Credential-ID.
- `instanz-kopplung`: Protokoll 4 ist die Voraussetzung für den Führungswechsel vor Ort.
- `benachrichtigungen`: Neue Art „Führung angefragt“ an die Einsatzleitung der führenden Seite.

## Impact

- **Backend, Führung:** `src/instanz/fuehrung/`
  - `austausch.rs`: Annahmeregel vor Ort, Nachziehen am Hub, Anfrage und Ablehnung.
  - `dienst.rs`: Freigabe der Bedienung vor Ort, neue Route „Anfrage ablehnen“.
  - `repo.rs`: Spalte `anfrage_abgelehnt`.
- **Backend, Kopplung:**
  - `src/instanz/mod.rs`: `PROTOKOLL = 4`, Regel je Gegenüber statt `traegt(Fluss::Fuehrungswechsel)`
    allein, Wächter.
  - `src/instanz/melden.rs`: Schlüssel auch in der Meldung.
  - `src/auth/unterschrift/repo.rs`: Weitergabe und Widerruf je Credential-ID.
  - `src/benachrichtigung/`: neue Art.
  - `src/routes/fuehrung.rs`
- **Migrationen:**
  - `einsatz_fuehrung.anfrage_abgelehnt`
  - `unterschrift_schluessel.weiter_stand`
  - Neubau von `benachrichtigung` für den CHECK.
- **Wire, nur additiv:**
  - `AkteMeldung.anfrage_abgelehnt`
  - `UnterschriftSchluesselLieferung.aufnahme_org`
  - Schlüssel und Quittung in `MeldenAnfrage`/`MeldenAntwort` für Direktkopplungen.
  - `FuehrungGegenueber.wechsel` samt Grund
  - `FuehrungAnzeige.anfrage_eingang` und `anfrage_abgelehnt`
  - Typ-Codegen
- **Frontend:**
  - `frontend/src/instanz/FuehrungPaneel.tsx`, `fuehrungText.ts`: Regel des Servers statt eigener
    Ableitung aus `art` und `richtung`.
  - Block „bittet um die Führung“.
  - Notübernahme vor Ort mit Beweis.
  - `api/fuehrung.ts`, `instanzText.ts`
- **Doku und Regeln:**
  - `docs/anwender/kapitel/instanzkopplung.md`
  - neue ADR (gleichrangige Regel vor Ort, Nachziehen am Hub)
  - `docs/architektur` (Kapitel 8)
  - `src/AGENTS.md`, Abschnitt Direktkopplung
- **Tests:** `tests/instanz_vor_ort.rs` (zwei ELW und ein Hub auf Loopback), Unit-Tests der reinen
  Annahmeregel, `tests/instanz_fuehrung.rs`.
