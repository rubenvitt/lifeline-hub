/**
 * Ansicht der Fernmeldeskizze (LFH-893 D1): Zoom und Verschieben als reine Rechnung über eine
 * `viewBox`, ohne DOM. Die Fläche (`stab/skizze/SkizzenFlaeche.tsx`) misst nur ihre Größe in
 * Pixeln und hält eine {@link Ansicht}; alles andere steht hier und ist getestet.
 *
 * - **Eingepasst** (`null`): die ganze Skizze steht in der Fläche, über `viewBox` auf die
 *   Ausdehnung des Layouts und `preserveAspectRatio="xMidYMid meet"`. Das ist die Vorgabe beim
 *   Öffnen und immer im Druck (D13) — dafür braucht es keine Messung.
 * - **Gezoomt** ({@link Ansicht}): linke obere Ecke in Skizzeneinheiten und Maßstab in Pixeln je
 *   Einheit. Zoomen hält den Punkt unter Zeiger bzw. Fingermitte fest.
 * - **Grenzen:** höchstens {@link ZOOM_MAX}; nach unten bis {@link ZOOM_MIN} oder bis zum
 *   Einpassen, wenn die Skizze dafür kleiner sein muss (sonst wäre „Einpassen“ unerreichbar).
 *   Die Werte sind vorläufig bis zur Messung (tasks.md 1.1, Nachtrag D4).
 */

export interface Groesse {
  breite: number;
  hoehe: number;
}

export interface Punkt {
  x: number;
  y: number;
}

/** Gezoomte Ansicht: linke obere Ecke (Skizzeneinheiten) und Pixel je Einheit. */
export interface Ansicht {
  x: number;
  y: number;
  skala: number;
}

/** Ein Knopfdruck auf „+“ bzw. „−“. */
export const ZOOM_SCHRITT = 1.25;
export const ZOOM_MAX = 4;
export const ZOOM_MIN = 0.25;
/** Luft um die eingepasste Skizze, in Pixeln. */
export const EINPASS_RAND = 8;

/** Die eingepasste Ansicht als gezoomte: Ausgangspunkt des ersten Zooms. */
export function eingepasst(inhalt: Groesse, flaeche: Groesse): Ansicht {
  const nutzB = Math.max(1, flaeche.breite - 2 * EINPASS_RAND);
  const nutzH = Math.max(1, flaeche.hoehe - 2 * EINPASS_RAND);
  const skala = Math.min(nutzB / Math.max(1, inhalt.breite), nutzH / Math.max(1, inhalt.hoehe));
  // Mittig wie `xMidYMid meet`.
  return {
    skala,
    x: inhalt.breite / 2 - flaeche.breite / 2 / skala,
    y: inhalt.hoehe / 2 - flaeche.hoehe / 2 / skala,
  };
}

/** Kleinster erlaubter Maßstab: {@link ZOOM_MIN} oder das Einpassen, was kleiner ist. */
export function kleinsterMassstab(inhalt: Groesse, flaeche: Groesse): number {
  return Math.min(ZOOM_MIN, eingepasst(inhalt, flaeche).skala);
}

/**
 * Boden der Treffläche je Dichte-Stufe (LFH-1038 D2): kurze Achse und Abstand zweier Ziele in
 * Pixeln. Kompakt und komfortabel halten Kriterium 1 der Prüfliste (24 px, die Wahl ist keine
 * zeitkritische Aktion), Handschuh Kriterium 2 (72 px, 16 px Abstand). Über das Token, nicht
 * `useDichte()`, damit Bedienhöhe und Boden unter einem lokalen Theme nicht auseinanderlaufen.
 */
export interface Trefferboden {
  ziel: number;
  abstand: number;
}

export function trefferboden(token: { controlHeight: number }): Trefferboden {
  return token.controlHeight >= 72 ? { ziel: 72, abstand: 16 } : { ziel: 24, abstand: 0 };
}

/**
 * Ein Zeigerziel der Fläche: Rechteck in Skizzeneinheiten und ein senkrechter Rand in Pixeln, der
 * nicht mitzoomt (eine Schiene ist eine Linie mit einem Band nach Dichte über und unter ihr, in
 * der Waagerechten genau so lang wie die Linie; Stellen haben keinen Rand).
 */
export interface Zeigerziel {
  key: string;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  rand: number;
}

/** Freier Abstand zweier Ziele in Pixeln beim Maßstab `s`. */
function freierAbstand(dx: number, dy: number, rand: number, s: number): number {
  return Math.hypot(dx * s, Math.max(0, dy * s - rand));
}

/**
 * Kleinster Maßstab, bei dem jedes Ziel den Boden der Stufe hält (LFH-1038 D1): die kurze Seite
 * jeder Stelle und, mit Abstand, der freie Raum zwischen zwei Zielen samt ihrer Bänder. Nicht
 * zählen Paare, die sich in Einheiten berühren oder überlappen (übereinander geschobene Stellen),
 * und Paare, die `verbunden` nennt (Stelle und Schiene einer Stichleitung: dazwischen liegt die
 * Stichleitung selbst als Ziel). Gedeckelt auf {@link ZOOM_MAX}; ohne Ziele 0.
 */
export function mindestMassstab(
  ziele: readonly Zeigerziel[],
  boden: Trefferboden,
  verbunden: (a: string, b: string) => boolean = () => false,
): number {
  let s = 0;
  for (const z of ziele) {
    const kurz = Math.min(z.breite, z.hoehe);
    if (z.rand === 0 && kurz > 0) s = Math.max(s, boden.ziel / kurz);
  }
  if (boden.abstand > 0) {
    for (let i = 0; i < ziele.length; i++) {
      for (let j = i + 1; j < ziele.length; j++) {
        const a = ziele[i];
        const b = ziele[j];
        const dx = Math.max(0, a.x - (b.x + b.breite), b.x - (a.x + a.breite));
        const dy = Math.max(0, a.y - (b.y + b.hoehe), b.y - (a.y + a.hoehe));
        if ((dx === 0 && dy === 0) || verbunden(a.key, b.key)) continue;
        const rand = a.rand + b.rand;
        if (freierAbstand(dx, dy, rand, s) >= boden.abstand) continue;
        if (freierAbstand(dx, dy, rand, ZOOM_MAX) < boden.abstand) return ZOOM_MAX;
        // Der Abstand wächst mit dem Maßstab: halbieren zwischen `s` und dem Deckel.
        let lo = s;
        let hi = ZOOM_MAX;
        for (let k = 0; k < 40; k++) {
          const m = (lo + hi) / 2;
          if (freierAbstand(dx, dy, rand, m) >= boden.abstand) hi = m;
          else lo = m;
        }
        s = hi;
      }
    }
  }
  return Math.min(ZOOM_MAX, s);
}

/** Pixel der Fläche → Skizzeneinheiten. */
export function zuSkizze(a: Ansicht, px: Punkt): Punkt {
  return { x: a.x + px.x / a.skala, y: a.y + px.y / a.skala };
}

/** Skizzeneinheiten → Pixel der Fläche. */
export function zuFlaeche(a: Ansicht, p: Punkt): Punkt {
  return { x: (p.x - a.x) * a.skala, y: (p.y - a.y) * a.skala };
}

/**
 * Zoom um `faktor`, der Punkt `um` (Pixel der Fläche) bleibt stehen. Ohne `um` die Mitte der
 * Fläche (Knöpfe). Begrenzt auf [{@link kleinsterMassstab}, {@link ZOOM_MAX}].
 */
export function zoome(
  a: Ansicht,
  faktor: number,
  flaeche: Groesse,
  inhalt: Groesse,
  um: Punkt = { x: flaeche.breite / 2, y: flaeche.hoehe / 2 },
): Ansicht {
  const skala = Math.min(ZOOM_MAX, Math.max(kleinsterMassstab(inhalt, flaeche), a.skala * faktor));
  const fest = zuSkizze(a, um);
  return { skala, x: fest.x - um.x / skala, y: fest.y - um.y / skala };
}

/** Verschiebt die Ansicht um Pixel (Ziehen auf leerer Fläche): der Inhalt folgt dem Zeiger. */
export function verschiebeAnsicht(a: Ansicht, dxPx: number, dyPx: number): Ansicht {
  return { ...a, x: a.x - dxPx / a.skala, y: a.y - dyPx / a.skala };
}

/** Die `viewBox` einer gezoomten Ansicht. */
export function viewBoxAus(a: Ansicht, flaeche: Groesse): string {
  return [a.x, a.y, flaeche.breite / a.skala, flaeche.hoehe / a.skala]
    .map((z) => Math.round(z * 100) / 100)
    .join(' ');
}

/** Faktor eines Mausrad-Schritts mit Strg (`deltaY` < 0 = hinein). */
export function radFaktor(deltaY: number): number {
  if (deltaY === 0) return 1;
  // Ein Rastschritt (~100 px) entspricht einem Knopfdruck; Touchpads liefern kleine Schritte.
  const schritte = Math.max(-3, Math.min(3, -deltaY / 100));
  return ZOOM_SCHRITT ** schritte;
}

/**
 * Zwei-Finger-Zoom: aus Abstand und Mitte beim Aufsetzen und jetzt. Der Skizzenpunkt unter der
 * Anfangsmitte folgt der aktuellen Mitte (Zoomen und Verschieben in einer Geste).
 */
export function zweiFinger(
  start: { ansicht: Ansicht; abstand: number; mitte: Punkt },
  jetzt: { abstand: number; mitte: Punkt },
  flaeche: Groesse,
  inhalt: Groesse,
): Ansicht {
  const faktor = start.abstand > 0 ? jetzt.abstand / start.abstand : 1;
  const skala = Math.min(
    ZOOM_MAX,
    Math.max(kleinsterMassstab(inhalt, flaeche), start.ansicht.skala * faktor),
  );
  const fest = zuSkizze(start.ansicht, start.mitte);
  return { skala, x: fest.x - jetzt.mitte.x / skala, y: fest.y - jetzt.mitte.y / skala };
}

/**
 * Bringt ein Rechteck (Skizzeneinheiten) in den sichtbaren Ausschnitt, ohne den Maßstab zu
 * ändern; ein Element, das schon ganz zu sehen ist, lässt die Ansicht stehen (Spec „Klick im
 * Paneel“: gewählt **und** im sichtbaren Ausschnitt).
 */
export function zeige(
  a: Ansicht,
  flaeche: Groesse,
  r: { x: number; y: number; breite: number; hoehe: number },
): Ansicht {
  const sichtB = flaeche.breite / a.skala;
  const sichtH = flaeche.hoehe / a.skala;
  const rand = EINPASS_RAND / a.skala;
  const achse = (start: number, sicht: number, von: number, laenge: number) => {
    if (laenge + 2 * rand > sicht) return von + laenge / 2 - sicht / 2;
    if (von - rand < start) return von - rand;
    if (von + laenge + rand > start + sicht) return von + laenge + rand - sicht;
    return start;
  };
  return {
    skala: a.skala,
    x: achse(a.x, sichtB, r.x, r.breite),
    y: achse(a.y, sichtH, r.y, r.hoehe),
  };
}
