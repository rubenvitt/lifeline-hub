# Proposal

## Why

Der Funkplan räumt `?ansicht=` nach dem Lesen aus der Adresse. Wer in „Sprechgruppen“ filtert,
einem Teilnehmer folgt und Zurück wählt, landet deshalb in der Tabelle. Filter und Sortierung
stehen dann noch in der Adresse, wirken aber erst wieder im Reiter „Sprechgruppen“. Im Feld heißt
das: Wer prüft, wer auf DMO 999 hängt, verliert nach jedem Sprung den Blick, den er sich gerade
gebaut hat.

LFH-625 (D1) und LLH-1180 (D5) haben „`?ansicht=` als bleibender Zustand“ bewusst verworfen und
festgehalten: Fehlt „Zurück“ im Feld, wird das ein eigenes Ticket. Dieses Ticket ist LLH-1432.

Zunder: https://zunder.rubeen.dev/#/aufgabe/yksssyxih620lluwjjwbiwwd (LLH-1432, Unteraufgabe von
LLH-1022)

## What Changes

- Die gewählte Darstellung des Funkplans bleibt als `?ansicht=` in der Adresse: `skizze` oder
  `sprechgruppen`, „Funkplan“ ohne Parameter.
- Ein Reiterwechsel ersetzt den Parameter per `replace`, ohne eigenen Schritt im Verlauf.
- Ein unbrauchbarer Wert und `ansicht=tabelle` werden weiter aus der Adresse entfernt.
- Einstiege aus Sprungmarken, Palette, Stab-Seite, Eigenschaftspaneel, Kommunikationsplan und der
  Altadresse `stab/funkplan?ansicht=…` setzen denselben Parameter und bleiben unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `stab-fernmeldeskizze`: Requirement „Zweite Darstellung des Funkplans“. `?ansicht=` ist Zustand
  der Adresse statt Einmal-Vorgabe. Szenario „Sichtvorgabe aus einem Link“ angepasst, Szenario
  „Reiterwechsel ohne Verlaufsschritt“ neu.
- `stab-funkplan`: Requirement „Darstellung ‚Sprechgruppen‘“. Szenario „Sichtvorgabe aus einem
  Link“ angepasst, Szenario „Zurück aus einem Teilnehmer“ neu.

Nicht betroffen ist `fuehrungsorganisation`, das Organigramm der Einsatzabschnitte. Dort gilt
dieselbe Einmal-Regel für `?ansicht=organigramm` weiter; diese Change ändert die Seite nicht.

## Impact

- Frontend: `pages/FunkplanPage.tsx`, Kommentare in `routing/deeplinks.ts` und
  `fernmeldewesen/FernmeldewesenReiter.tsx`, eine Zeile in `frontend/src/stab/AGENTS.md`.
- e2e: Die Altadresse landet jetzt auf `…/fernmeldewesen?ansicht=skizze`
  (`fernmeldewesen.spec.ts`).
- Kein Backend, keine Migration, kein Typ-Codegen.
