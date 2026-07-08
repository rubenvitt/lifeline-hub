import { useMemo, useState } from 'react';
import { Select } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';

/**
 * Strukturierter Wert der Halter-Combobox. Genau eine Variante (oder null = unbekannt).
 * Spiegelt das halter_person_id XOR halter_kontakt des Backends.
 */
export type HalterWert =
  | { typ: 'person'; refId: number; label: string }
  | { typ: 'extern'; kontakt: string }
  | null;

/** Option-Objekt mit Zusatzfeldern; onChange liest typ/refId/kontakt vom Objekt (nie value-String parsen). */
interface HalterOption {
  value: string;
  label: string;
  typ?: 'person' | 'extern';
  refId?: number;
  kontakt?: string;
}

/** Label einer betroffenen Person: R-nnn + ggf. Name. */
function personLabel(registrierNr: number, name: string | null | undefined, vorname: string | null | undefined): string {
  const reg = registrierAnzeige(registrierNr);
  const voll = [vorname, name].filter(Boolean).join(' ').trim();
  return voll ? `${reg} · ${voll}` : reg;
}

interface Props {
  einsatzId: number;
  /** Von Form.Item injiziert. */
  value?: HalterWert;
  onChange?: (v: HalterWert) => void;
}

/**
 * Gemischtes Select für den Tier-Halter: wählt entweder eine betroffene Person des Einsatzes
 * (→ halter_person_id) oder erfasst einen externen Kontakt als Freitext (→ halter_kontakt).
 * Muster gespiegelt von GeschaedigtPicker.
 */
export default function HalterPicker({ einsatzId, value = null, onChange }: Props) {
  const [suche, setSuche] = useState('');

  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: Number.isFinite(einsatzId),
  });

  // Aktuell gewählter value-String (Schlüssel) + Label für die Anzeige.
  const aktuellerKey =
    value == null ? undefined : value.typ === 'person' ? `p${value.refId}` : 'extern';
  const aktuellesLabel =
    value == null ? undefined : value.typ === 'extern' ? value.kontakt : value.label;

  const optionen = useMemo<DefaultOptionType[]>(() => {
    const term = suche.trim();
    const lower = term.toLowerCase();
    const passt = (label: string) => !term || label.toLowerCase().includes(lower);

    const personOptions: HalterOption[] = (personenQuery.data ?? [])
      .map((p) => ({
        value: `p${p.id}`,
        label: personLabel(p.registrier_nr, p.name, p.vorname),
        typ: 'person' as const,
        refId: p.id,
      }))
      .filter((o) => passt(o.label));

    const gruppen: DefaultOptionType[] = [];

    // Freitext: nur, wenn ein Suchbegriff existiert und nicht exakt einer Option entspricht.
    const exaktVorhanden = personOptions.some((o) => o.label.toLowerCase() === lower);
    if (term && !exaktVorhanden) {
      gruppen.push({ value: 'extern', label: `Als externen Kontakt: „${term}“`, typ: 'extern', kontakt: term });
    }

    if (personOptions.length) gruppen.push({ label: 'Betroffene Personen', options: personOptions });

    // Edit-Modus: aktuelle Person-Auswahl als Option vorhalten, damit der Select das Label statt
    // eines rohen Tokens zeigt (sofern sie nicht ohnehin schon in der Liste steckt).
    if (aktuellerKey && aktuellerKey !== 'extern' && aktuellesLabel != null) {
      const bereitsDa = personOptions.some((o) => o.value === aktuellerKey);
      if (!bereitsDa) {
        gruppen.push({
          value: aktuellerKey,
          label: aktuellesLabel,
          typ: 'person',
          refId: value && value.typ === 'person' ? value.refId : undefined,
        });
      }
    }

    return gruppen;
  }, [suche, personenQuery.data, aktuellerKey, aktuellesLabel, value]);

  return (
    <Select
      allowClear
      placeholder="Betroffene Person (R-Nr.) oder externer Kontakt …"
      style={{ width: '100%' }}
      value={aktuellerKey}
      // Anzeige-Label aus dem Wert ableiten (extern hat keine bleibende Option nach Such-Reset).
      labelRender={() => aktuellesLabel ?? ''}
      // Eigene Filterung (useMemo) — antd-Filter würde die synthetische Freitext-Option verstecken.
      showSearch={{ filterOption: false, onSearch: setSuche }}
      options={optionen}
      loading={personenQuery.isLoading}
      onChange={(_val, option) => {
        setSuche('');
        const roh = Array.isArray(option) ? option[0] : option;
        const opt = roh as HalterOption | undefined;
        if (!opt || !opt.typ) {
          onChange?.(null);
          return;
        }
        if (opt.typ === 'person' && opt.refId != null) {
          onChange?.({ typ: 'person', refId: opt.refId, label: opt.label });
        } else if (opt.typ === 'extern' && opt.kontakt != null) {
          onChange?.({ typ: 'extern', kontakt: opt.kontakt });
        } else {
          onChange?.(null);
        }
      }}
    />
  );
}
