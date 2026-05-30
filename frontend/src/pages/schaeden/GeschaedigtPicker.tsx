import { useMemo, useState } from 'react';
import { Select } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';

/** Strukturierter Wert der Geschädigt-Combobox. Genau eine Variante (oder null = unbekannt/öffentlich). */
export type GeschaedigtWert =
  | { typ: 'person'; refId: number; label: string }
  | { typ: 'personal'; refId: number; label: string }
  | { typ: 'organisation'; label: string }
  | { typ: 'extern'; kontakt: string }
  | null;

/** Option-Objekt mit Zusatzfeldern; onChange liest typ/refId/kontakt vom Objekt (nie value-String parsen). */
interface GeschaedigtOption {
  value: string;
  label: string;
  typ?: 'person' | 'personal' | 'organisation' | 'extern';
  refId?: number;
  kontakt?: string;
}

interface GeschaedigtGroup {
  label: string;
  options: GeschaedigtOption[];
}

/** Label einer betroffenen Person: R-nnn + ggf. Name. */
function personLabel(registrierNr: number, name: string | null, vorname: string | null): string {
  const reg = registrierAnzeige(registrierNr);
  const voll = [vorname, name].filter(Boolean).join(' ').trim();
  return voll ? `${reg} · ${voll}` : reg;
}

interface Props {
  einsatzId: number;
  /** Eigene Org-ID; vom Aufrufer beim Submit genutzt (Server clamped serverseitig). */
  orgId?: number;
  orgName: string;
  value: GeschaedigtWert;
  onChange: (v: GeschaedigtWert) => void;
}

export default function GeschaedigtPicker({ einsatzId, orgName, value, onChange }: Props) {
  const [suche, setSuche] = useState('');

  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
    queryFn: () => listePersonen(einsatzId),
    enabled: Number.isFinite(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: ['einsatz-personal', einsatzId],
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: Number.isFinite(einsatzId),
  });

  // Aktuell gewählter value-String (Schlüssel) + Label für die Anzeige.
  const aktuellerKey =
    value == null
      ? undefined
      : value.typ === 'person'
        ? `p${value.refId}`
        : value.typ === 'personal'
          ? `ek${value.refId}`
          : value.typ === 'organisation'
            ? 'org'
            : 'extern';
  const aktuellesLabel =
    value == null
      ? undefined
      : value.typ === 'extern'
        ? value.kontakt
        : value.label;

  const optionen = useMemo<DefaultOptionType[]>(() => {
    const term = suche.trim();
    const lower = term.toLowerCase();
    const passt = (label: string) => !term || label.toLowerCase().includes(lower);

    const personen = personenQuery.data ?? [];
    const personal = personalQuery.data ?? [];

    const personOptions: GeschaedigtOption[] = personen
      .map((p) => ({
        value: `p${p.id}`,
        label: personLabel(p.registrier_nr, p.name, p.vorname),
        typ: 'person' as const,
        refId: p.id,
      }))
      .filter((o) => passt(o.label));

    const personalOptions: GeschaedigtOption[] = personal
      .map((ek) => ({
        value: `ek${ek.id}`,
        label: ek.funktion ? `${ek.name} · ${ek.funktion}` : ek.name,
        typ: 'personal' as const,
        refId: ek.id,
      }))
      .filter((o) => passt(o.label));

    const orgOption: GeschaedigtOption = {
      value: 'org',
      label: orgName,
      typ: 'organisation' as const,
    };
    const orgOptions = passt(orgName) ? [orgOption] : [];

    const gruppen: (GeschaedigtGroup | GeschaedigtOption)[] = [];

    // Freitext: nur, wenn ein Suchbegriff existiert und nicht exakt einer Option entspricht.
    const exaktVorhanden = [...personOptions, ...personalOptions, ...orgOptions].some(
      (o) => o.label.toLowerCase() === lower,
    );
    if (term && !exaktVorhanden) {
      gruppen.push({
        value: 'extern',
        label: `Als externen Kontakt: „${term}“`,
        typ: 'extern',
        kontakt: term,
      });
    }

    if (personOptions.length) gruppen.push({ label: 'Betroffene Personen', options: personOptions });
    if (personalOptions.length) gruppen.push({ label: 'Einsatzkräfte', options: personalOptions });
    if (orgOptions.length) gruppen.push({ label: 'Eigene Organisation', options: orgOptions });

    // Edit-Modus: aktuelle Auswahl als Option vorhalten, damit der Select das Label statt eines
    // rohen Tokens zeigt (sofern sie nicht ohnehin schon in einer Gruppe steckt).
    if (aktuellerKey && aktuellesLabel != null && aktuellerKey !== 'extern') {
      const bereitsDa = [...personOptions, ...personalOptions, ...orgOptions].some(
        (o) => o.value === aktuellerKey,
      );
      if (!bereitsDa) {
        gruppen.push({
          value: aktuellerKey,
          label: aktuellesLabel,
          typ: value?.typ,
          refId: value && (value.typ === 'person' || value.typ === 'personal') ? value.refId : undefined,
        });
      }
    }

    return gruppen as DefaultOptionType[];
  }, [suche, personenQuery.data, personalQuery.data, orgName, aktuellerKey, aktuellesLabel, value]);

  return (
    <Select
      showSearch
      allowClear
      placeholder="Person, Einsatzkraft, eigene Organisation oder Freitext …"
      style={{ width: '100%' }}
      value={aktuellerKey}
      // Anzeige-Label aus dem Wert ableiten (extern hat keine Option im value-Key-Sinn).
      labelRender={() => aktuellesLabel ?? ''}
      // Eigene Filterung (useMemo) — antd-Filter würde die synthetische Freitext-Option verstecken.
      filterOption={false}
      onSearch={setSuche}
      options={optionen}
      loading={personenQuery.isLoading || personalQuery.isLoading}
      onChange={(_val, option) => {
        setSuche('');
        const roh = Array.isArray(option) ? option[0] : option;
        const opt = roh as GeschaedigtOption | undefined;
        if (!opt || !opt.typ) {
          onChange(null);
          return;
        }
        if (opt.typ === 'person' && opt.refId != null) {
          onChange({ typ: 'person', refId: opt.refId, label: opt.label });
        } else if (opt.typ === 'personal' && opt.refId != null) {
          onChange({ typ: 'personal', refId: opt.refId, label: opt.label });
        } else if (opt.typ === 'organisation') {
          onChange({ typ: 'organisation', label: orgName });
        } else if (opt.typ === 'extern' && opt.kontakt != null) {
          onChange({ typ: 'extern', kontakt: opt.kontakt });
        } else {
          onChange(null);
        }
      }}
    />
  );
}
