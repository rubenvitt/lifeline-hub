# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/v6hj7xl282xfgrzeti0idmtc (LLH-1491)

## Why

Ein ELW und ein Hub sind seit LLH-1490 gekoppelt, aber jede Instanz schreibt ihre Einsätze für
sich. Bevor Einsatzdaten zwischen ihnen fließen (LLH-1492), muss feststehen, **wer** einen
Einsatz gerade schreibt: genau ein Führer je Einsatz. Die Führung wandert, regulär oder als
Notübernahme. Ein kompromittierter Hub darf sie dabei nie fälschen (Konzept
`docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`, Entscheidungen 2, 4 und 9).

## What Changes

- **Führungsakte je Einsatz** einer gekoppelten Org: instanzübergreifende Einsatzkennung,
  Epoche als Paar (Zähler, Instanzkennung), führende Instanz, Verlauf. Beide Seiten tauschen ihre
  Akten in der Meldung aus. Das Schema wächst nur additiv, `PROTOKOLL` bleibt 1.
- **Schreibsperre an der Instanz, die nicht führt:** Jeder Schreibweg am Einsatz antwortet mit
  409 „Führung liegt bei …“, die Oberfläche zeigt „Nur Ansicht“ mit diesem Grund.
- **Reguläre Übergabe:** Ein ELW gibt die Führung nur ab, wenn seine Einsatzleitung es auslöst.
  Der Hub gibt sie an einen gekoppelten ELW derselben Org ab, sobald dieser sie anfragt.
- **Notübernahme gegen die meldende Seite (ELW)** nur mit der Passkey-Unterschrift eines
  Org-Admins über den Hash der Erklärung oder mit einem Einmal-Code. Den Code erzeugt der ELW bei
  Bedarf, er geht per Funk oder Telefon. Der ELW prüft die Unterschrift gegen gültige Schlüssel
  seiner Org.
  - Gültig: Hinweis „Führung übernommen: von wem, wann, warum“ mit „Übernahme bestätigen“ und
    „Widersprechen“; bis dahin schreibt der ELW weiter.
  - Ungültig: verwerfen, Alarm „Gegenüber meldet ungültige Übernahme“, Eintrag in der Admin-Spur.
- **Widersprechen** heißt Rückübernahme: Der ELW führt mit der nächsten Epoche weiter.
- **Notübernahme gegen die erreichte Seite (Hub):** Ein Mensch an der übernehmenden Seite
  bestätigt; der Hub nimmt eine höhere Epoche ohne Rückfrage an und zeigt den Wechsel.
- **Gleichstand** zweier Notübernahmen: Das größere Paar (Zähler, Instanzkennung) gewinnt. Die
  unterlegene Seite durchläuft denselben Ablauf wie bei jeder Übernahme.
- **Bruchstelle:** Wer die Führung verliert, hält fest, ab wann seine Schreibvorgänge nicht mehr
  zählen. LLH-1492 macht daraus Anträge, diese Change noch nicht.
- **Schalter `LIFELINE_FUEHRUNG`**, Vorgabe aus. Ohne Inhaltsspiegel (LLH-1492) führte eine
  Übergabe zu einer leeren Hülle, darum bleibt die Führung bis dahin abgeschaltet.

## Capabilities

### New Capabilities

- `instanz-fuehrung`: Führung je Einsatz zwischen gekoppelten Instanzen. Sie umfasst Epoche,
  Übergabe, Notübernahme mit Admin-Unterschrift oder Code, Bestätigung und Widerspruch an der
  meldenden Seite sowie die Schreibsperre an der Instanz, die nicht führt.

### Modified Capabilities

Keine. Die Prüfung der Unterschrift über eine vorgegebene Erklärung steht schon in
`org-admin-unterschrift` und wird unverändert benutzt.

## Impact

- **Datenbank:** neue Migration (nächste freie Nummer über `origin/alpha`). Neue Tabellen
  `einsatz_fuehrung` und `einsatz_fuehrung_verlauf`, Spalte `einsatz.fuehrung_bei`. `admin_audit`
  und `benachrichtigung` werden mit neuen Werten im CHECK neu gebaut.
- **Backend:** neues Modul `src/instanz/fuehrung/` mit Akte, Erklärung, Prüfung, Code und
  Austausch in der Meldung. Dazu `src/instanz/melden.rs` (additive Felder),
  `src/einsatz/kontext.rs` (neuer Gate `EinsatzFuehrungszugriff`, Führung in `fordere_aktiv`),
  `src/einsatz/repo.rs` (`fordere_aktiv_in_tx`), `src/auth/unterschrift/zeremonie.rs` (dritte
  Zeremonie), `src/benachrichtigung/`, `src/config.rs`, `src/routes/`.
- **API:** neue Routen unter `/api/einsaetze/{id}/fuehrung/…` und
  `/api/admin/instanz/fuehrung/…`, ein Feld `fuehrung` an der Einsatzanzeige, generierte Typen.
- **Frontend:** `einsatz/schreibrecht.ts` (Führung als weitere Achse), `components/nurAnsicht.ts`,
  `einsatz/EinsatzLayout.tsx` (Chip und Hinweisband), `pages/EinsatzdatenPage.tsx` (Paneel
  „Führung“), `instanz/InstanzkopplungSeite.tsx` (Einsätze beim Gegenüber), `api/instanz.ts`
  (allgemeine Unterschriftszeremonie).
- **Doku:** Anwenderkapitel `instanzkopplung.md`; Architektur Kapitel 6, 8, 9 und 11; neue ADR
  zur Führung je Einsatz.
- **Folgen für LLH-1492:** Sie liest die Bruchstelle, setzt den Schalter auf „an“ (oder entfernt
  ihn) und schreibt Führungswechsel ins ETB.
