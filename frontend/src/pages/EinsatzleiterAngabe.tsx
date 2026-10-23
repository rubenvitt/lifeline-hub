import { Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Dayjs } from 'dayjs';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeModulFreigaben } from '../api/einsaetze';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type {
  EinsatzPersonal,
  Einsatzleiter,
  EinsatzleiterEingabe,
  Fuehrungsstelle,
} from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { EINSATZLEITER_NAME_MAX } from '../api/eingabegrenzen';
import { InlineAngabe } from '../components/InlineAngabe';
import { istZuLang, Zeichenzaehler } from '../components/zeichenGrenze';
import { monoStil, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { einsatzleiterDarstellung, einsatzleiterKurz } from '../stab/einsatzleiter';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import { personLabel } from '../kraefte/einsatzfunktionKern';
import { zeitKurz } from '../anzeige/zeitDarstellung';

/**
 * Zeile „Einsatzleiter“ der eigenen Führungsstelle (LFH-1199): eine disponierte Person oder ein
 * externer Einsatzleiter als Freitext, dazu „seit“ (leer = jetzt). Ein Wechsel schreibt der Server
 * als Übergabe ins ETB. Herleitung: `openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md` (D6).
 *
 * Die Wahl ist ein Schlüssel: `p:<einsatz_personal.id>` für eine Person, `x:<Name>` für einen
 * externen, `bisher` für eine inzwischen entlassene Person (ihr Name steht nur noch eingefroren).
 */
interface Wahl {
  wahl: string | null;
  seit: Dayjs | null;
}

const BISHER = 'bisher';

function toWahl(e: Einsatzleiter | null | undefined): string | null {
  if (!e) return null;
  if (e.art === 'extern') return `x:${e.name ?? ''}`;
  return e.personal_id != null ? `p:${e.personal_id}` : BISHER;
}

function isSameZeit(a: Dayjs | null, b: Dayjs | null): boolean {
  return a === null || b === null ? a === b : a.valueOf() === b.valueOf();
}

/** Die Wahl als PATCH-Feld; ohne „seit“ nimmt der Server die Zeit des Speicherns. */
function toEingabe(w: Wahl): EinsatzleiterEingabe | null {
  if (w.wahl === null) return null;
  const seit = w.seit ? { seit: alsBackendZeit(w.seit) } : {};
  if (w.wahl.startsWith('p:')) {
    return { art: 'personal', personal_id: Number(w.wahl.slice(2)), ...seit };
  }
  if (w.wahl.startsWith('x:')) return { art: 'extern', name: w.wahl.slice(2), ...seit };
  // Eine entlassene Person lässt sich nicht erneut senden; nur „seit“ zu ändern geht nicht.
  throw new Error('Die Person ist nicht mehr disponiert — bitte neu wählen');
}

function personText(p: EinsatzPersonal): string {
  // Gleichnamige Personen bleiben über die Funktion unterscheidbar (wie die Stab-Besetzung).
  return personLabel(p);
}

/**
 * Das disponierte Personal für die Auswahl, abgerufen nur mit Freigabe des Moduls Personal und
 * nur, wenn jemand schreiben darf (Muster `useFahrzeugeQuelle`).
 */
function usePersonalQuelle(
  einsatzId: number,
  aktiv: boolean,
): { zustand: AbrufZustand; personal: EinsatzPersonal[] } {
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const frei = freigabenQuery.data != null && istKeyFreigegeben('personal', freigabenQuery.data);
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: aktiv && frei,
  });
  const zustand: AbrufZustand = freigabenQuery.isError
    ? 'fehler'
    : freigabenQuery.data == null
      ? 'laden'
      : !frei
        ? 'gesperrt'
        : abrufZustand(personalQuery);
  return { zustand, personal: zustand === 'daten' ? (personalQuery.data ?? []) : [] };
}

export default function EinsatzleiterAngabe({
  einsatzId,
  fs,
  darfSchreiben,
  onSpeichern,
}: {
  einsatzId: number;
  fs: Fuehrungsstelle;
  darfSchreiben: boolean;
  onSpeichern: (einsatzleiter: EinsatzleiterEingabe | null) => Promise<unknown>;
}) {
  const { konventionen } = useAnzeigeKonventionen();
  const { token, rollen } = useRollen();
  const quelle = usePersonalQuelle(einsatzId, darfSchreiben);
  const [suche, setSuche] = useState('');
  const e = fs.einsatzleiter;
  const d = einsatzleiterDarstellung({ zustand: 'daten', daten: fs });
  const gespeichert: Wahl = { wahl: toWahl(e), seit: alsZeitpunkt(e?.seit) ?? null };

  const optionen = (wert: Wahl) => {
    const text = suche.trim();
    const personen = quelle.personal.map((p) => ({ value: `p:${p.id}`, label: personText(p) }));
    // Die gespeicherte Wahl bleibt wählbar, auch wenn sie in der Liste fehlt (extern, entlassen).
    const bisher =
      e && gespeichert.wahl && !personen.some((o) => o.value === gespeichert.wahl)
        ? [{ value: gespeichert.wahl, label: einsatzleiterKurz(d) }]
        : [];
    const eigene =
      wert.wahl?.startsWith('x:') && wert.wahl !== gespeichert.wahl
        ? [{ value: wert.wahl, label: `${wert.wahl.slice(2)} (extern)` }]
        : [];
    // Freitext nur, wenn er keiner Person gleicht und die Grenze des Servers hält: über ihr sperrt
    // die Zeile das Angebot, und der Zähler nennt die Überlänge (`components/zeichenGrenze.tsx`).
    const istPerson = quelle.personal.some(
      (p) => p.name.localeCompare(text, 'de', { sensitivity: 'base' }) === 0,
    );
    const freitext =
      text && !istPerson && !istZuLang(text, EINSATZLEITER_NAME_MAX)
        ? [{ value: `x:${text}`, label: `„${text}“ als externen Einsatzleiter übernehmen` }]
        : [];
    // Eine Wahl steht nur einmal da, auch wenn der Suchtext sie noch einmal vorschlägt.
    const alle = [...bisher, ...eigene, ...personen, ...freitext];
    return alle.filter((o, i) => alle.findIndex((x) => x.value === o.value) === i);
  };

  return (
    <InlineAngabe<Wahl>
      etikett="Einsatzleiter"
      wert={gespeichert}
      anzeige={
        d.art === 'erfasst' ? (
          <>
            {einsatzleiterKurz(d)}
            {' · '}
            <span style={monoStil(13)}>{`seit ${zeitKurz(d.seit, konventionen)}`}</span>
          </>
        ) : null
      }
      leer={(w) => w.wahl === null}
      gleich={(a, b) => a.wahl === b.wahl && isSameZeit(a.seit, b.seit)}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w) => {
        setSuche('');
        return Promise.resolve()
          .then(() => toEingabe(w))
          .then(onSpeichern);
      }}
      eingabe={({ feld, popup, value, onChange }) => (
        <>
          <Select<string>
            {...feld}
            {...popup}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="Person wählen oder Namen eintippen"
            options={optionen(value)}
            value={value.wahl ?? undefined}
            onSearch={setSuche}
            // rc-select leert seine Suche nach einer Wahl, meldet das aber nicht: sonst bliebe der
            // Freitext als zweite Option stehen (Muster `fuehrung/EinWertAuswahl.tsx`).
            onSelect={() => setSuche('')}
            onBlur={() => setSuche('')}
            onChange={(w) => {
              // Eine eigens gesetzte Zeit bleibt. Sonst beginnt eine neue Wahl „jetzt“, und die
              // gespeicherte Wahl bekommt ihr gespeichertes „seit“ zurück.
              const eigeneZeit = value.seit !== null && !isSameZeit(value.seit, gespeichert.seit);
              onChange({
                wahl: w ?? null,
                seit: eigeneZeit ? value.seit : w === gespeichert.wahl ? gespeichert.seit : null,
              });
            }}
            style={{ width: '100%' }}
          />
          <Zeichenzaehler wert={suche.trim()} max={EINSATZLEITER_NAME_MAX} />
          {(quelle.zustand === 'gesperrt' || quelle.zustand === 'fehler') && (
            <div style={{ color: rollen.gedaempft }}>
              {`Personal ${ZUSTAND_GRUND[quelle.zustand]} — nur Freitext`}
            </div>
          )}
          <ZeitpunktEingabe
            art="ereignis"
            aria-label="Einsatzleiter seit"
            placeholder="seit jetzt"
            keineZukunftstage
            style={{ width: '100%' }}
            value={value.seit}
            onChange={(seit) => onChange({ ...value, seit: seit ?? null })}
          />
          {value.wahl !== null && (
            <Button
              type="link"
              style={{ alignSelf: 'flex-start', paddingInline: 0, minHeight: token.controlHeight }}
              onClick={() => onChange({ wahl: null, seit: null })}
            >
              Einsatzleiter leeren
            </Button>
          )}
        </>
      )}
    />
  );
}
