# Design

## Context

Befund und Motivation: proposal.md, „Why“. Nachgestellt mit
`tests/instanz_spiegel.rs::nachstellung_neuzuordnung_an_andere_org`, über die echten Routen:

| | vor Widerruf | nach Widerruf | nach Neuzuordnung an Org Y und Abgleich |
|---|---|---|---|
| `einsatz.org_id` | X | X | **Y** |
| `einsatz_spiegel.kopplung_org_id` / `beendet_at` | Zuordnung X / – | Zuordnung X / gesetzt | **Zuordnung Y / NULL** |
| Mitgliedschaften | Erika (Org X) | unverändert | **Erika (Org X) an einem Einsatz der Org Y** |

So kommt es dazu:

- `uebernehmen` sucht den Spiegel über `fremde_kennung`. Seine Kopplung stimmt, denn
  `create_or_renew_kopplung` nimmt beim erneuten Koppeln dieselbe Zeile wieder auf. Dann hängt
  der Zweig „Neu zugeordnet oder neu gekoppelt“ den Spiegel an die liefernde Zuordnung und setzt
  `beendet_at` zurück, ohne Bedingung.
- Der ELW liefert danach ab 0, weil der Widerruf `spiegel_ziel` an beiden Seiten geleert hat.
  Damit kommt auch der Kopf, und `Ziel::Org` bildet die Org des Absenders auf die Org der neuen
  Zuordnung ab.
- Mitgliedschaften von Konten der Org X bleiben stehen. `konto_lokal` findet für sie kein Konto
  der Org Y, also nur einen Stellvertreter, und Stellvertreter werden nie Mitglied. Die alte Zeile
  bleibt deshalb unberührt.

`fuehrung::richte_aus` hängt ebenfalls um, wählt die Zuordnung aber über die Org der Akte
(`kopplung_org_des_fuehrers`: `o.org_id = akte.org_id`). Dort ist nichts zu tun.

## Goals / Non-Goals

**Goals:**

- Ein Spiegel nimmt Lieferungen nur über eine Zuordnung seiner eigenen Org an. Dann ändern sich
  durch eine Lieferung weder seine Org noch seine Mitgliedschaften über die Org-Grenze.
- Kein Stand behauptet einen Abgleich, den es nicht gab: Eine verworfene Lieferung meldet nichts
  als übernommen (D2).

**Non-Goals:**

- Org Y bekommt diesen Einsatz nicht (Weg B, verworfen, s. D4).
- Keine Reparatur eines Hubs, der schon in diesem Zustand ist (abgestimmt am 13.11.2026).
- Keine Anzeige des Grundes in der Oberfläche; er steht nur im Log (D3).

## Decisions

### D1 — Geprüft wird die Org des Einsatzes, bei jeder Lieferung an einen vorhandenen Spiegel

Gibt es den Spiegel schon, vergleicht `uebernehmen` die Org des Einsatzes (`einsatz.org_id`) mit
der Org der liefernden Zuordnung (`Empfaenger::org_id`). Weichen sie ab, wird verworfen, bevor
etwas umgehängt oder geschrieben wird. Der Vergleich steht nach der Prüfung „andere Kopplung“ und
vor dem Zweig „Neu zugeordnet“.

- **Warum `einsatz.org_id`:** An dieser Org hängen Lesezugriff und Mandantentrennung, sie ist der
  Gegenstand des Schutzes. Die Org der bisherigen Zuordnung wäre ein Umweg, und
  `kopplung_org_id` kann NULL sein (`richte_aus`: „Die führende Instanz ist hier nicht
  gekoppelt“).
- **Warum bei jeder Lieferung, nicht nur beim Umhängen:** Für einen gesunden Spiegel ändert das
  nichts, denn der Kopf bildet sich nur ab, wenn die Org passt (`Ziel::Org`, sonst wartet er).
  So gilt eine einfache Regel ohne Sonderfall: „Ein Spiegel hört nur auf Zuordnungen seiner Org.“
- **Erwogen:** nur im Zweig „Neu zugeordnet“ prüfen. Das deckt denselben Fall ab, lässt die
  Invariante aber vom Zustand der Zeile abhängen.

### D2 — Verworfen wird mit Stand 0 (nach dem Review geändert, 13.11.2026)

Das Ergebnis nennt `stand = 0`, ohne `einsatz_id`, wie bei „andere Kopplung“: Über die Zuordnung
der Org Y ist nichts übernommen, und genau das meldet der Stand. Der Stand des Spiegels selbst
(`einsatz_spiegel.stand`) bleibt unberührt. Wird Org X später wieder zugeordnet, beginnt diese
Zuordnung ohnehin bei 0 (`spiegel_ziel` ist leer), und der Spiegel holt alles nach.

Folge in beiden Richtungen: Der Führer liefert den Einsatz bei jedem Abgleich von vorn, bis er
abgeschlossen ist (`list_gefuehrt` nimmt einen abgeschlossenen, ungenannten Einsatz nicht mehr mit).
Das kostet je Abgleich Leitungsbudget, einen Platz von `EINSAETZE_MAX` und eine Logzeile. Der Fall
setzt Widerruf und Neuzuordnung an eine andere Org voraus und kommt kaum vor.

- **Zuerst gewählt, verworfen:** `stand = l.bis`. Der Review vor dem PR zeigte zweierlei:
  - In Pull (der Hub führt, der ELW meldet sich und spiegelt) erreicht der Stand den Absender
    nie. Der ELW verwirft das Ergebnis von `uebernehme_alle`, nennt den beendeten Spiegel nicht in
    `eigene_staende`, und der Hub liefert trotzdem ab 0.
  - In Push setzte er den Stand der neuen Zuordnung am ELW auf „aktuell“, obwohl der Hub nichts
    übernommen hatte. `spiegel::fuehrung::ist_abgeglichen` und `offene_aenderungen` nehmen das
    Maximum über alle Zuordnungen der Kopplung und hätten eine Übergabe als abgeglichen
    durchgelassen.
- **Verworfen:** Pull dicht machen, indem die meldende Seite verworfene Stände merkt und in der
  nächsten Anfrage nennt. Das ist mehr Code im Abgleich, und das falsche „abgeglichen“ bliebe.
  Nebenwirkung: Ein Löschsignal des Führers räumte dann auch den beendeten Spiegel der Org X ab
  (`lebensende::spiegel_der_kopplung`).
- **Verworfen:** `l.bis` lassen und nur auf Push einschränken. Dann bleibt das falsche
  „abgeglichen“.

### D3 — Der Grund steht im Log, nicht am Spiegel

Der Hinweis „Einsatz <Kennung> gehört hier zu einer anderen Organisation; Lieferung verworfen.“
geht in `Ergebnis::hinweise`, und `uebernehme_alle` loggt ihn wie jeden Hinweis
(`tracing::warn`). Weil `einsatz_id` fehlt, wird er nicht am Spiegel gespeichert.

- **Warum nicht am Spiegel:** Den Spiegel liest Org X. Ein Hinweis dort verriete ihr, dass ihr
  früherer Partner jetzt mit einer anderen Org gekoppelt ist. Für Org Y gibt es keinen Einsatz, an
  den er sich hängen ließe.
- Die Seite „Instanzkopplung“ zeigt für den Einsatz keinen eigenen Hinweis. Das bleibt so.

### D4 — Verworfene Wege (abgestimmt am 13.11.2026)

- **B: Neuer Spiegel für Org Y.** Der alte Spiegel gäbe seine `fremde_kennung` ab (UNIQUE), und
  Org Y bekäme einen frischen. Das zieht Einsatznummer (`nummer::ensure_freie_nummer`),
  Führungsakten (nach Kennung), Anhänge und Hinweise mit sich. Deutlich größer für einen Fall,
  der im Betrieb kaum vorkommt.
- **C: Einsatz zieht um, fremde Mitglieder fallen.** Org X verlöre den Lesezugriff, entgegen
  „Spiegel bleiben lesbar“ (Spec `einsatz-spiegel`, D14 aus LLH-1492), und Org Y sähe trotzdem den Stand
  aus der Zeit der Org X.

## Risks / Trade-offs

- [Org Y erwartet den Einsatz und sieht ihn nicht] → So gewollt. Neue Einsätze des ELW kommen bei
  Org Y normal an. Der Grund steht im Log des Hubs.
- [Ein Hub ist schon im falschen Zustand] → Er bleibt so. Dort gilt `einsatz.org_id = Y` und die
  Zuordnung gehört Org Y, die Prüfung lässt die Lieferung also durch. Eine Reparatur ist bewusst
  ausgelassen.
- [Der Führer liefert den verworfenen Einsatz bis zu seinem Abschluss in jedem Abgleich neu] →
  Begrenzt durch Budget und `EINSAETZE_MAX`, so wie heute schon bei „andere Kopplung“. Die
  Mandantentrennung geht vor. Wer es abstellen will, widerruft die Zuordnung der Org Y oder
  schließt den Einsatz ab.

## Migration Plan

Keine Migration und kein Protokollwechsel. Die Änderung wirkt nach dem Update an der empfangenden
Seite. Zurückrollen heißt, den Commit zurückzunehmen.
