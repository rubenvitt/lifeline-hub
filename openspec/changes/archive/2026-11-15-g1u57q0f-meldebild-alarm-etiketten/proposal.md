# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/g1u57q0fujutw456ieayy6ok (LLH-1741, Teil von LLH-1717
„Was brennt“, Welle 1)

## Why

Im Meldebild sind „Rückm. überfällig“, „1 Ausfall“ und „1 Ausfall Material“ weißer 12-px-Text wie
jeder andere Inhalt. Die Zeilentönung, die sie begleitet, ist nachts rgb(19,15,15) auf rgb(15,18,21)
und damit praktisch unsichtbar. Dagegen ist der Normalzustand „S4 · Am Einsatzort“ ein gelbes
Etikett. Das Normale ist laut, das Kritische leise. Die Einsatzleitung übersieht so genau die
Einheiten, die ausfallen oder schweigen.

## What Changes

- Die Gründe der Tönung (Ausfall der Mittel, Ausfall Material, Rückmeldung überfällig, keine
  Rückmeldung) stehen in der Statusspalte als **Etiketten in der Alarmrolle**. Eine überfällige
  Rückmeldung nennt ihre Dauer: **„Rückm. überfällig seit 47 min“**.
- **Eine überfällige Rückmeldung trägt überall die Alarmrolle** (Entscheidung 15.11.2026), auch die
  Uhrzeit in der Spalte „Rückmeldung“, nicht mehr die Achtungsrolle.
- Die Zeilentönung einer Problemzeile wird im Nachtmodus sichtbar.
- Wortlaut und Dauer der Gründe kommen aus einer Funktion, die der Überblick (LLH-1739, Change
  `kevp40j3-abschnittskarte-rueckmeldung-ausfall`) mitbenutzt.
- **Nicht hier:** FMS S3/S4 neutral statt gelb. Das löst LLH-1778 „Gelb entlasten“ global in
  `theme/statusFarben.ts` (Entscheidung 15.11.2026).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `kraeftebaum`: neue Anforderung, dass die Gründe einer getönten Zeile als Etikett in der
  Alarmrolle mit Dauer stehen und eine überfällige Rückmeldung die Alarmrolle trägt.

## Impact

- Frontend: `kraefte/meldebildRaster.ts` (`toenungsGruende` liefert strukturierte Gründe),
  `meldungen/rueckmeldung.ts` (`RUECKMELDUNG_ROLLE.ueberfaellig` = alarm, Dauer und Etikettwort),
  `pages/KraefteuebersichtPage.tsx` (Statusspalte, Rückmeldungsspalte), `theme/tokens.ts` und
  `theme/rollen.css` (Problemzeile nachts), ggf. `pages/kraefteuebersichtPrint.css`.
- Tests: `meldebildRaster.test.ts`, `rueckmeldung.test.ts`, `KraefteuebersichtPage.test.tsx`,
  Kontrastprüfungen (`kraefte-kontrast.spec.ts`, Farbrollen-Gate).
- Anwenderdoku `docs/anwender/kapitel/meldebild.md` samt Bild.
- Kein Backend.
