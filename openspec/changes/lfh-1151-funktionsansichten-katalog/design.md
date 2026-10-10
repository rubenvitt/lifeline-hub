# Design

## Context

Siehe `proposal.md`, „Why“. Die Spec ist in zwei Schichten gewachsen: LFH-892 schrieb eine
gemeinsame Scope-Matrix für drei Ansichten, LFH-1042 und LFH-1044 hängten je eine eigene
Anforderung mit eigener Tabelle an („Ansicht Bereitstellungsraum“, „Ansicht Verpflegung“).
LFH-1041 (Betreuungsstelle) und LFH-1043 (Einsatzabschnitt) haben die Spec nicht angefasst.
Die Wahrheit über die Rechte steht im Server: Routenliste je Ansicht (`src/geraet/mod.rs`),
Stellenfilter (`src/geraet/stelle.rs`, `src/geraet/abschnitt.rs`), Nachweise in
`tests/geraet_kopplung.rs`.

## Goals / Non-Goals

**Goals:**

- Jede Aussage der nachgetragenen Anforderungen hat einen Code- und einen Testbeleg.
- Die Spec liest sich nach dem Sync ohne Widerspruch: Katalog, Matrix und Einzelanforderungen
  sagen dasselbe.

**Non-Goals:**

- Keine Verhaltensänderung. Fällt beim Belegen eine Lücke im Code auf, wird sie ein
  ClickUp-Task (`clickup-task-anlegen`), die Spec beschreibt den Ist-Stand.
- Kein Umbau der bestehenden Tabellen für UHS, Lagemonitor, Bereitstellungsraum und
  Verpflegung über das Nötige hinaus.

## Decisions

**D1 — Je Ansicht eine eigene Anforderung, die alte Matrix bleibt für LFH-892.**
Betreuungsstelle und Einsatzabschnitt bekommen je eine Anforderung „Ansicht …“ mit eigener
Tabelle, wie Bereitstellungsraum und Verpflegung. Verworfen: die gemeinsame Matrix auf sieben
Spalten verbreitern. Sie hätte viele „—“-Zellen, wäre am Bildschirm kaum lesbar und mischte
Module, die nur eine Ansicht kennt. Verworfen ebenso: alle sieben in Einzelanforderungen
zerlegen; das schriebe gültigen Text um, ohne dass etwas falsch war.

**D2 — Der Katalog nennt die Bindung je Ansicht, nicht die Rechte.**
Die Anforderung „Katalog der Funktionsansichten“ zählt die sieben Werte auf und sagt je Ansicht,
an welche Stellenart sie gebunden ist (UHS, Betreuungsstelle, Bereitstellungsraum,
Einsatzabschnitt, keine). Die Rechte stehen in Matrix bzw. Einzelanforderung. Das Szenario
„Unbekannte Ansicht“ nimmt einen Wert, den es nicht gibt.

**D3 — Statuscodes so, wie der Server sie heute gibt.**
Die neuen Szenarien übernehmen die Codes aus den Tests (404 für Fremdes, 403 für Verbotenes),
auch wo sie von der älteren Matrix abweichen sollten. Die Spec rät nicht.

## Risks / Trade-offs

- [Ein nachgetragener Satz beschreibt Wunsch statt Ist] → je Szenario den Test nennen, der ihn
  belegt (`tasks.md`), und vor dem Archiv gegen den Code gegenlesen.
- [Die Matrix-Einleitung wird missverstanden, als gälte sie für alle Ansichten] → der
  geänderte Einleitungssatz grenzt sie ausdrücklich auf die drei LFH-892-Ansichten ein.
