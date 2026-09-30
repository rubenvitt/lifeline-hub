import { PointerSensor, type PointerSensorProps } from '@dnd-kit/core';

/**
 * `PointerSensor`, der nach einem Zug nur den Klick des Zugs selbst schluckt (LFH-519).
 *
 * ── Das Problem ─────────────────────────────────────────────────────────────────
 * dnd-kit hängt beim Zugbeginn einen `click`-Stopper in die Capture-Phase von `document`, damit
 * das Loslassen keinen Klick auf das Element darunter auslöst. Abgenommen wird er erst per
 * `setTimeout(…, 50)` („next event loop"). Unter Last verhungert dieser Timer: Chromium arbeitet
 * Eingaben vor Timern ab. Der NÄCHSTE, echte Klick trifft dann noch auf den Stopper und kommt nie
 * bei Reacts Wurzel an — gemessen am Platzmenü im UHS-Grundriss, das nach einem Drag erst beim
 * zweiten Klick aufging.
 *
 * ── Die Abhilfe ─────────────────────────────────────────────────────────────────
 * Der Klick des Zugs folgt dem `pointerup` unmittelbar, jede neue Geste beginnt mit einem
 * `pointerdown` (Tastatur: `keydown`). Nach dem Ende des Zugs nimmt die nächste neue Geste den
 * Stopper deshalb sofort ab, statt auf den Timer zu warten. Der Timer von dnd-kit bleibt als
 * Rückfall; ein doppeltes Abnehmen ist folgenlos.
 *
 * Scharf wird das erst nach dem Loslassen desselben Zeigers: ein zweiter Finger während des Zugs
 * räumte sonst den Stopper — und dnd-kits Escape-Hörer — mitten im Zug ab.
 *
 * ── Die Kopplung ────────────────────────────────────────────────────────────────
 * Der Stopper hängt an der privaten `documentListeners` von dnd-kit; er ist nur über deren
 * `removeAll()` erreichbar. Benennt dnd-kit das um, fällt der Sensor still auf das alte Verhalten
 * zurück — `zugPointerSensor.test.tsx` wird dann rot. Ist die Gegenprobe dort rot, hat dnd-kit
 * das selbst behoben, und dieser Sensor kann entfallen.
 *
 * Zeiger-Sensoren nur über diese Datei (Guard in `zugPointerSensor.test.tsx`).
 */
export class ZugPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    super(props);
    const start = props.event as PointerEvent;
    const dokument = (start.target as Node | null)?.ownerDocument ?? document;
    const intern = this as unknown as { documentListeners?: { removeAll?: () => void } };

    const aufGeste = () => {
      intern.documentListeners?.removeAll?.();
      dokument.removeEventListener('pointerdown', aufGeste, true);
      dokument.removeEventListener('keydown', aufGeste, true);
    };
    const aufEnde = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
      dokument.removeEventListener('pointerup', aufEnde, true);
      dokument.removeEventListener('pointercancel', aufEnde, true);
      dokument.addEventListener('pointerdown', aufGeste, true);
      dokument.addEventListener('keydown', aufGeste, true);
    };
    dokument.addEventListener('pointerup', aufEnde, true);
    dokument.addEventListener('pointercancel', aufEnde, true);
  }
}
