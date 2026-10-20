# Proposal

## Why

Standalone Claude Design (claude.ai/design) schließt am 14.12.2026. Damit enden voraussichtlich
auch `DesignSync` und `/design-sync`, über die das Design System „Lifeline Hub“ bisher gepflegt
wurde. Gepflegt wurde es von Hand: Ändert ein PR Rollen, Schriftskala, Dichten, Bausteine oder
Textregeln, sagt der Agent nur, dass nachgezogen werden muss (`frontend/AGENTS.md`, „Größere
UI-Entwürfe über Claude Design“). Das driftet zwangsläufig, und in Cloud-Sitzungen kam niemand an
das System heran. Der Nachfolger in Claude ist der Artifact-Typ „Design System“; `/design` und
`/slides` nutzen ihn als Gestaltungsgrundlage (LLH-1333, Entscheidung Ruben 19.10.2026: Option A).

## What Changes

- **Generator im Repo:** erzeugt den Inhalt eines Design-System-Artifacts aus dem Code —
  `tokens.json` aus `theme/tokens.ts` (Farbrollen Nacht und Tag, Status-, Sichtungs- und
  Zusatzpaletten, Schriftskala, Abstände je Dichte, Radius), die Schriftdateien, eine README aus
  den Gestaltungsregeln in `frontend/AGENTS.md`, statische Vorschauen zentraler Bausteine
  (serverseitig gerendert aus den echten Komponenten) und das Deckblatt.
- **Erzeugtes liegt versioniert im Repo** unter `docs/design/design-system/`; ein Wächter-Test im
  Frontend erzeugt neu und vergleicht, sodass Drift im Gate `check-all.sh` rot wird.
- **Veröffentlichung** als Artifact vom Typ „Design System“ auf eine feste URL, die im Repo steht.
  Neu veröffentlicht wird, wenn ein gemergter PR das Erzeugte ändert.
- **Regel umgestellt:** Größere UI-Entwürfe entstehen mit `/design` bzw. dem Artifact-Typ „Design“
  auf Grundlage dieses Design Systems, auch in Cloud-Sitzungen. `DesignSync`, `/design-login` und
  „sagt, dass nachgezogen werden muss“ entfallen. Skill `dev-zunder-orchestrieren` zieht mit.

## Capabilities

### New Capabilities
- `design-system-artifact`: Das Design System wird aus dem Code erzeugt, im Repo aktuell gehalten
  und als Artifact veröffentlicht.

### Modified Capabilities
<!-- keine: die übrigen Gestaltungs-Specs (Farbrollen, Dichte, Kontrast) bleiben Quelle -->

## Impact

- **Neu:** `frontend/scripts/design-system/` (Generator), `frontend/src/designSystem.guard.test.ts`
  (oder ähnlich), `docs/design/design-system/` (erzeugt), npm-Skript `design-system`.
- **Geändert:** `frontend/AGENTS.md` (Abschnitt Claude Design), `.claude/skills/dev-zunder-orchestrieren/SKILL.md`,
  `scripts/AGENTS.md` falls der Wächter dort beschrieben werden muss.
- Kein Backend, keine Migration, keine Laufzeitänderung der App.
