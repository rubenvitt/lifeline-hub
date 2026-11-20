import type { VormerkGrund } from './fehler';

/**
 * Der eine Wortlaut der Rückmeldung „vorgemerkt“ (LLH-1758, `offline/AGENTS.md`, „Vorgemerkt heißt
 * nicht offline“). Ohne Netz bleibt „Offline vorgemerkt: …“. Hat der eigene Server geantwortet,
 * aber nicht gespeichert, heißt es „Server-Fehler – … vorgemerkt, wird erneut gesendet“: Netz ist
 * da, und der Abgleich versucht es von selbst wieder. `trenner` hält Kurzformen wie „· R-…“.
 */
export function vorgemerktText(grund: VormerkGrund, was: string, trenner = ': '): string {
  if (grund === 'serverfehler') {
    return `Server-Fehler – ${was ? `${was} ` : ''}vorgemerkt, wird erneut gesendet`;
  }
  return `Offline vorgemerkt${was ? `${trenner}${was}` : ''}`;
}

/** Anzeigedauer in Sekunden: ein Serverfehler steht länger, sonst gilt die Vorgabe von antd. */
export function vorgemerktDauer(grund: VormerkGrund): number | undefined {
  return grund === 'serverfehler' ? 8 : undefined;
}
