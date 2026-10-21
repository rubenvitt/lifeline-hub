import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Button, Tooltip, Typography } from 'antd';
import { Augenbraue, useRollen, zielEinzug } from '../../components/instrument';
import type { FreiesZeichenUpdate } from '../../api/types';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import { KACHEL_BILD, ZeichenAufPlatte, kachelFarben, kachelStil } from './FreiesZeichenPicker';
import { abonniereZuletztVerwendet, leseZuletztVerwendet } from './zuletztVerwendet';
import { leseEntwurf, zeichenName } from './zeichenWahl';
import {
  WERKZEUGMENUE_KENNUNG,
  werkzeugZeilen,
  type WerkzeugEntwurf,
  type WerkzeugForm,
} from './werkzeugZeilen';
import { ZONE_TYPEN } from './zonenStil';

/** Breite der Fläche, wo die Karte sie hergibt; schmaler nimmt sie die ganze Fuß-Breite. */
const MENUE_BREITE = 320;

/**
 * Boden eines Eintrags — rein und exportiert: die Steuerhöhe der Dichtestufe (30 / 48 / 72 px),
 * auch wenn ein Name umbricht (antds Knopf hätte sonst eine feste Höhe und liefe über).
 */
export function werkzeugEintragStil(token: { controlHeight: number }): CSSProperties {
  return {
    height: 'auto',
    minHeight: token.controlHeight,
    whiteSpace: 'normal',
    textAlign: 'start',
  };
}

export interface WerkzeugmenueProps {
  /** Kennung der Fläche — der Knopf nennt sie in `aria-controls`. */
  id: string;
  /** Schließt das Menü (die Seite hält den Zustand: Knopf und Fläche sind Geschwister). */
  onSchliessen: () => void;
  /** Zonen-Zeichnen starten — derselbe Weg wie der Link `?zeichnen=`. */
  onZone: (entwurf: WerkzeugEntwurf) => void;
  /** Taktisches Zeichen platzieren, hier aus „Zuletzt verwendet“. */
  onZeichen: (spec: FreiesZeichenUpdate) => void;
  /** „Weitere …“: der Picker als Dialog; `touch` = ohne Fokus ins Suchfeld. */
  onWeitere: (quelle: 'maus' | 'touch') => void;
  /** Läuft schon ein Taktisches Zeichen? Dann zeigt die Gruppe nur den Zustand. */
  zeichenLaeuft: boolean;
  /** Der Knopf „Zeichenwerkzeuge“: Fokus zurück, und ein Druck darauf ist kein Außenklick. */
  knopf: () => HTMLElement | null;
}

/**
 * Werkzeugmenü an der Karte (LLH-1038, Spec `lagekarte-zeichnen`): steht offen als oberstes
 * Element im Kartenfuß neben der Knopfspalte, also über allen Fuß-Bändern und nie über dem
 * Knopfblock (`fussStil` teilt die Breite, die Bänder stapeln im Fluss). Kein antd-Popover am
 * Knopf: der hinge in der unteren Kartenhälfte über den Bändern (design.md D1). Kein Kontextmenü,
 * keine Klickebene.
 *
 * Offen nimmt es Esc (eigener Zuhörer, `preventDefault`; `escGehoertOverlay` kennt die Kennung),
 * ein Druck außerhalb von Menü und Knopf schließt es. Jeder Eintrag schließt es und gibt den
 * Fokus an den Knopf.
 */
export default function Werkzeugmenue({
  id,
  onSchliessen,
  onZone,
  onZeichen,
  onWeitere,
  zeichenLaeuft,
  knopf,
}: WerkzeugmenueProps) {
  const { token, rollen } = useRollen();
  const flaecheId = useId();
  const zeichenId = useId();
  const menueRef = useRef<HTMLDivElement>(null);
  const [zuletzt, setZuletzt] = useState(leseZuletztVerwendet);
  useEffect(() => abonniereZuletztVerwendet(() => setZuletzt(leseZuletztVerwendet())), []);
  // Woher der Druck auf „Weitere …“ kam: per Finger fokussiert der Picker sein Suchfeld nicht
  // (die Bildschirmtastatur klappte sonst über das Raster, Muster `ZeichenHierDialog`).
  const quelleRef = useRef<'maus' | 'touch'>('maus');

  // Die Zuhörer hängen am Öffnen, nicht an den Handlern der Seite (die sind je Render neu).
  const schliessenRef = useRef(onSchliessen);
  schliessenRef.current = onSchliessen;
  const knopfRef = useRef(knopf);
  knopfRef.current = knopf;

  useEffect(() => {
    menueRef.current
      ?.querySelector<HTMLElement>('button:not([disabled])')
      ?.focus({ preventScroll: true });
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Die Taste gehört dem Menü: kein Zeichnen-, Auswahl- oder Fokus-Esc dahinter.
      e.preventDefault();
      knopfRef.current()?.focus({ preventScroll: true });
      schliessenRef.current();
    };
    const druck = (e: PointerEvent) => {
      const ziel = e.target instanceof Node ? e.target : null;
      if (!ziel) return;
      if (menueRef.current?.contains(ziel) || knopfRef.current()?.contains(ziel)) return;
      schliessenRef.current();
    };
    window.addEventListener('keydown', taste);
    document.addEventListener('pointerdown', druck, true);
    return () => {
      window.removeEventListener('keydown', taste);
      document.removeEventListener('pointerdown', druck, true);
    };
  }, []);

  /** Schließen vor dem Start: der Fokus steht am Knopf, wenn der Modus die Karte übernimmt. */
  const waehle = (start: () => void) => {
    knopf()?.focus({ preventScroll: true });
    onSchliessen();
    start();
  };

  const abstand = Math.max(token.marginXS, 2 * zielEinzug(token));
  const eintrag = werkzeugEintragStil(token);
  const formKnopf = (f: WerkzeugForm, haupt: boolean) => (
    <Button
      key={f.name}
      aria-label={f.name === f.text ? undefined : f.name}
      onClick={() => waehle(() => onZone(f.entwurf))}
      style={{
        ...eintrag,
        ...(haupt ? { flex: '1 1 9em', minWidth: 0, justifyContent: 'flex-start' } : {}),
      }}
    >
      {f.text}
    </Button>
  );

  return (
    <div
      ref={menueRef}
      id={id}
      role="dialog"
      aria-label="Zeichenwerkzeuge"
      data-lfh={WERKZEUGMENUE_KENNUNG}
      style={{
        // Oberstes Element im Fuß-Rahmen: der Rahmen reicht keine Ereignisse durch, das Menü holt
        // sie zurück; der Auto-Rand schiebt die Bänder nach unten und das Menü an die Oberkante.
        pointerEvents: 'auto',
        alignSelf: 'flex-end',
        marginBlockEnd: 'auto',
        width: MENUE_BREITE,
        maxWidth: '100%',
        // Passt es nicht, gibt das Menü vor der nachgiebigen Zeitachse nach und rollt in sich;
        // ein Eintrag bleibt immer sichtbar.
        flex: '0 1000 auto',
        minHeight: token.controlHeight + 2 * token.paddingSM,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        display: 'flex',
        flexDirection: 'column',
        gap: abstand,
        padding: token.paddingSM,
        background: rollen.paneel,
        color: rollen.text,
        border: `1px solid ${rollen.linieStark}`,
      }}
    >
      <div role="group" aria-labelledby={flaecheId} style={{ display: 'grid', gap: abstand }}>
        <Augenbraue als="div" id={flaecheId}>
          Flächen und Linien
        </Augenbraue>
        {werkzeugZeilen(ZONE_TYPEN).map((z) => (
          <div key={z.typ} style={{ display: 'flex', flexWrap: 'wrap', gap: abstand }}>
            {formKnopf(z.haupt, true)}
            {z.weitere.map((f) => formKnopf(f, false))}
          </div>
        ))}
      </div>
      <div role="group" aria-labelledby={zeichenId} style={{ display: 'grid', gap: abstand }}>
        <Augenbraue als="div" id={zeichenId}>
          Taktisches Zeichen
        </Augenbraue>
        {zeichenLaeuft ? (
          // Bedient wird das laufende Zeichen im Modus-Band bzw. im Fuß (LLH-1028).
          <Typography.Text type="secondary">wird platziert</Typography.Text>
        ) : (
          <>
            {zuletzt.length > 0 && (
              <div
                role="group"
                aria-label="Zuletzt verwendet"
                style={{ display: 'flex', flexWrap: 'wrap', gap: abstand }}
              >
                {zuletzt.map((z) => {
                  const name = zeichenName(leseEntwurf(z));
                  return (
                    <Tooltip key={z} title={name}>
                      <button
                        type="button"
                        aria-label={name}
                        onClick={() => waehle(() => onZeichen({ zeichen_spec: z }))}
                        style={{ ...kachelStil(token), ...kachelFarben(rollen, false) }}
                      >
                        <ZeichenAufPlatte
                          drawing={freiesZeichen({ zeichen_spec: z }).drawing}
                          size={KACHEL_BILD}
                        />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
            <Button
              onPointerDown={(e) => {
                quelleRef.current = e.pointerType === 'mouse' ? 'maus' : 'touch';
              }}
              onClick={() => {
                const quelle = quelleRef.current;
                quelleRef.current = 'maus';
                waehle(() => onWeitere(quelle));
              }}
              style={{ ...eintrag, justifyContent: 'flex-start' }}
            >
              Weitere …
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
