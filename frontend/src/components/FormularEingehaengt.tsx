import { useEffect } from 'react';

/**
 * Meldet seinem Besitzer, ob ein `<Form>` gerade im Baum hängt (LFH-627). Steht als Kind IM
 * Formular: sein Mount-Effekt läuft erst, wenn das `<Form>` gerendert ist und die Instanz an sich
 * gebunden hat.
 *
 * Wozu: Eine Formularinstanz anzufassen (`setFieldsValue`, `resetFields` …), solange kein `<Form>`
 * an ihr hängt, meldet rc-field-form einen Makrotask später als „Instance created by `useForm` is
 * not connected to any Form element". Das trifft zwei Lagen, in denen der Besitzer der Instanz
 * NICHT weiß, ob sein Formular schon steht:
 *  - antds `Modal` hängt seinen Inhalt erst einen Render nach `open` ein — über den echten
 *    Scheduler (Deeplink, Netzantwort) läuft der Öffnen-Effekt des Aufrufers davor;
 *  - eine Seite rendert ihr `<Form>` nur in einem Zweig (bearbeitbarer Entwurf), der Hook mit der
 *    Instanz läuft immer.
 *
 * `onWechsel` muss identitätsstabil sein (ein State-Setter), sonst meldet der Marker bei jedem
 * Render ab und an.
 */
export default function FormularEingehaengt({ onWechsel }: { onWechsel: (da: boolean) => void }) {
  useEffect(() => {
    onWechsel(true);
    return () => onWechsel(false);
  }, [onWechsel]);
  return null;
}
