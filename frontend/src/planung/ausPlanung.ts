import type { Planung } from '../api/types';
import { planungZeilen, schichtplanBloecke } from './planungZeilen';
import { ausEinsatzPlan } from '../abloesung/schichtplan/ausgabe/ausEinsatzPlan';
import type { AusgabePlan } from '../abloesung/schichtplan/ausgabe/ausgabePlan';

/**
 * Eine Planung ohne Einsatz als Ausgabeplan (LLH-1593, Teil C von LLH-1557, design D8). Die
 * Planung kommt über die Bausteine des Einsatz-Schichtplans herein, wie Raster und Handy-Liste
 * (`planung/planungZeilen.ts`): Posten in der Reihenfolge der Planung, die Pause zuletzt, Blöcke
 * als `SchichtplanBlock`. Eine Planung zeigt Namen immer, denn wer sie lesen darf, darf auch das
 * Personal sehen.
 */
export function ausPlanung(planung: Planung): AusgabePlan {
  return ausEinsatzPlan(
    { bloecke: schichtplanBloecke(planung), helfer: planung.helfer },
    planungZeilen(planung.posten),
  );
}
