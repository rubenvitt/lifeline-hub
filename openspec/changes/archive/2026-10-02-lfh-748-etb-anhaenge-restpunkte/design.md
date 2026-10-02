# Design

## Context

Motivation: proposal.md. Ausgangslage im Code:

- `src/etb/repo.rs:pruefe_anhaenge` liest je ID `(gebunden, hochgeladen_von)`. Ein freier
  fremder Anhang wird zu `None` (400 `ANHANG_UNBEKANNT`), ein gebundener landet unabhängig vom
  Hochladenden bei 422 `gebunden_meldung()`. IDs sind fortlaufend. Wer Schreibrecht im ETB hat,
  liest daher aus 400/422 ab, welche IDs im Einsatz an Chat, Dokumentenablage, ETB oder Schaden
  hängen. Das gilt auch für Module, die für diese Person gesperrt sind.
- `useEtbEntwuerfe.entwurfAktualisieren` entfernt einen Entwurf aus dem Speicher, sobald seine
  Werte leer sind und er keine geprüfte Vorbelegung trägt. `entwurfFesthalten` sichert einen
  Entwurf beim Wählen von Dateien, aber das nächste leere Aktualisieren macht das rückgängig.
  `useEtbEntwuerfe` lädt nach einer Berichtigung neu (die Reiter hängen ab und wieder an), der
  entfernte Entwurf fehlt dann, und seine Dateien in `useEntwurfsDateien` hängen an keiner id mehr.
- Der Sendezustand je Entwurf (`versandJe`: `sendet`, `fortschritt`, `hinweis`) liegt in
  `EtbEntwurfsTabs`. Die Dateien liegen schon eine Ebene höher in `EtbPage`
  (`useEntwurfsDateien`), weil `EtbPage` bei einer Berichtigung statt der Reiter eine eigene
  Schnellerfassung rendert.
- `Schnellerfassung` reicht `gesperrt={sendet}` nur an Chips in der Ansicht. Ein Chip im
  Editor-Modus (`editing`) und der Editor für ein neues Feld (`…-edit-new`) bekommen nichts.
  `MetaChip` wertet `gesperrt` im Editor-Zweig nicht aus. `commitFeld` steigt beim Senden
  zwar früh aus, aber still: man tippt, und nichts passiert.

## Goals / Non-Goals

**Goals:**
- Das Erfassen verrät nichts über Anhänge anderer Personen.
- Dateien und Upload-Hinweis eines Entwurfs überleben jeden Remount der Reiter, den die Seite
  selbst auslöst (Tabwechsel, Berichtigung).
- Während des Sendens ist die ganze Erfassung gesperrt, ohne Ausnahme.

**Non-Goals:**
- Der Chat prüft beim Verknüpfen den Hochladenden weiterhin nicht (D12 von LFH-117, Chat-Code).
  Das wird ein eigener Task.
- Was nach erfolgreichem Senden mit dem Wert eines offenen Editors geschieht, bleibt Bestand:
  Der Editor schließt, sein ungespeicherter Wert geht nicht mit.
- Dateien über einen Reload retten (Nicht-Ziel seit LFH-117, D9).

## Decisions

**D1: Nur eigene Uploads sind bindbar; fremd heißt immer „unbekannt“ (400).**
`pruefe_anhaenge` bildet jeden Anhang mit `hochgeladen_von != erfasser_id` auf `None` ab, gleich
ob er gebunden ist. Ein eigener gebundener Anhang bleibt 422 „bereits gebunden (…)“.
- Warum 400 und nicht 422 für fremde: Für die anfragende Person *ist* die ID unbekannt. Sie kann
  sie über keinen eigenen Weg bekommen haben, denn die Oberfläche nennt nur eigene Uploads, und
  das Heraufstufen aus dem Chat bindet Kopien (`anhaenge_kopieren_tx`, LFH-700). Das passt zur
  Statuscode-Konvention (`src/AGENTS.md`, LFH-267): Die Referenz selbst ist ungültig (Feld, 400).
  „Schon gebunden“ ist ein Zustand (422) und hat nur für die eigene Datei einen Sinn.
- Die Offline-Queue sendet nur unter dem Benutzer, unter dem sie entstand. Ein Replay prüft keine
  Anhänge (Schritt 1 vor `pruefe_anhaenge`). Beide bleiben unberührt.
- **Verworfen B: 422 beibehalten und als bewusst dokumentieren.** Billig, aber die Auskunft über
  modulgesperrte Bindungen bleibt, und die Regel „fremd = unbekannt“ hätte eine Ausnahme, die
  niemand braucht.
- **Verworfen C: Jeder gebundene Anhang 400, auch der eigene.** Verbirgt nichts zusätzlich (die
  eigene Datei kennt man) und nimmt der eigenen Person die richtige Meldung. Das widerspräche
  LFH-267 (Zustand = 422), und `gebundener_anhang_ist_422` hält genau dieses Paar fest.

**D2: `entwurfAktualisieren` bekommt die Option `festhalten`.**
`entwurfAktualisieren(id, werte, { festhalten })`: Sind die Werte leer und `festhalten` ist wahr,
wird der geleerte Entwurf gespeichert statt entfernt. `EtbEntwurfsTabs` setzt `festhalten`, wenn
`dateien.je[id]` nicht leer ist. Die Persistenz bleibt so an einer Stelle im Hook, in genau
einem Schreibauftrag, nach dem seiteneffektfreien Updater (LFH-216).
- **Verworfen: im Aufrufer nach dem Aktualisieren `entwurfFesthalten` rufen.** Der Hook liest
  den Bestand aus `entwuerfeRef`, der den neuen (leeren) Stand erst nach dem Commit kennt.
  Festgehalten würde der *alte* Text, ein gelöschter Wortlaut käme nach dem Remount zurück. Zwei
  Schreibaufträge in Folge widersprächen außerdem der Vorlauf-Regel des Entwurfsspeichers.
- **Verworfen: Dateien selbst in den Hook ziehen.** Der Hook kennte dann `File`-Objekte, die
  der Speicher nie aufnehmen darf (D9 von LFH-117). Die Trennung „Werte im Hook, Dateien in der
  Seite“ bleibt.
- Werden die Dateien eines leeren Entwurfs entfernt, bleibt er bis zum nächsten leeren
  Aktualisieren gespeichert, wie schon nach `entwurfFesthalten`. Nach einem Reload steht dann
  ein leerer Reiter da. Das nehmen wir hin (s. Risiken).

**D3: Der Sendezustand je Entwurf wandert nach `EtbPage`, genau wie die Dateien.**
Ein Hook `useEntwurfsVersand` neben `useEntwurfsDateien` führt `je: Record<string, Versand>`,
`aendern(id, aenderung)` (mit dem bisherigen Wegfall im Ruhezustand) und `umhaengen(alt, neu)`.
`EtbPage` hält ihn und reicht ihn als Prop `versand` an `EtbEntwurfsTabs`. Fehlt das Prop,
führt der Container ihn selbst (Fallback wie bei `dateien`, damit bestehende Tests und andere
Aufrufer unverändert laufen). Die Weiterleitung umgezogener ids (`umgezogen`, 409) bleibt im
Container, weil sie zur Closure des laufenden Versands gehört. Bei einem Wechsel schreibt sie
über `umhaengen` in den gehobenen Zustand.
- `onSendetChange` bleibt. Es wird weiter aus dem Zustand abgeleitet, den der Container sieht.
  „Berichtigen“ ist während des Sendens ohnehin gesperrt, ein laufender Versand überlebt also
  keinen Wechsel in die Berichtigung, nur sein Ergebnis (der Hinweis) muss es.
- **Verworfen: den Hinweis in den Entwurfsspeicher schreiben.** Er ist Sitzungs- und kein
  Entwurfszustand und überlebte sonst einen Reload ohne die Dateien, auf die er sich bezieht.

**D4: `MetaChip` sperrt auch im Editor-Modus.**
`Schnellerfassung` reicht `gesperrt={sendet}` an jeden `MetaChip`, auch an den Editor für ein
neues Feld. `MetaChip` setzt im Editor-Zweig `disabled` an `Input`, `AutoComplete`, `Select` und
`ZeitpunktEingabe`, und Enter oder Escape lösen dann nichts aus. Der Editor bleibt sichtbar
offen. Nach einem Fehler wird er wieder bedienbar, und der getippte Wert steht noch da.
- **Verworfen: den Editor beim Absenden schließen.** Das verwürfe einen getippten, nicht
  übernommenen Wert, auch dann, wenn das Senden scheitert und man weitermachen will.
- **Verworfen: den offenen Wert beim Absenden übernehmen.** Das änderte, was gesendet wird,
  ohne dass es sichtbar übernommen wurde. Der Task verlangt nur die Sperre.

## Risks / Trade-offs

- [Ein fremder Client nennt fremde gebundene IDs und wertete 422 aus] → Kein bekannter
  Aufrufer. Die eigene Oberfläche nennt nur eigene Uploads. Das Verhalten steht im Spec-Delta.
- [Leere Entwürfe ohne Dateien bleiben nach D2 gespeichert, wenn die Dateien danach entfernt
  werden] → Ein leerer Reiter nach einem Reload ist harmlos und lässt sich schließen. Der
  nächste leere Aktualisierungslauf räumt ihn ohnehin weg.
- [Die Antd-Editoren reichen `disabled` unterschiedlich durch, etwa `ZeitpunktEingabe` als
  eigene Komponente] → Der Vitest prüft je Editorart, dass das native Feld `disabled` trägt.
  Andernfalls bekommt `ZeitpunktEingabe` die Eigenschaft durchgereicht.
