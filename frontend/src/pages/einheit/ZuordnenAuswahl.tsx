import { useId } from 'react';
import { Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordneFahrzeugZu, ordnePersonalZu } from '../../api/einheiten';
import { disponiereFahrzeugeSammel, listEntlasseneFahrzeuge } from '../../api/einsatzFahrzeuge';
import { disponierePersonalSammel, listEntlassenesPersonal } from '../../api/einsatzPersonal';
import { listeFahrzeuge } from '../../api/fahrzeuge';
import { listePersonal } from '../../api/personal';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type { EinsatzFahrzeug, EinsatzPersonal } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { MODUL_FAHRZEUGE_GESPERRT, MODUL_PERSONAL_GESPERRT } from '../../components/nurAnsicht';
import { nichtGefundenInhalt } from '../../components/SeitenZustand';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import { DemoLabel, SUCHTEXT_SUCHE } from '../../stammdaten/demoAuswahl';
import {
  buildFahrzeugZuordnenGroups,
  buildPersonZuordnenGroups,
  fehlerDerKraft,
  parseZuordnenWert,
  type EinheitRechte,
  type ZuordnenGroup,
  type ZuordnenWahl,
} from './einheitAnsichtKern';

/**
 * „Person zuordnen …“ und „Fahrzeug zuordnen …“ der Einheit-Ansicht (LLH-1036 Teil II, design.md
 * D7, D8; Spec `einheit-ansicht`, „Person und Fahrzeug aus Einsatz oder Stamm zuordnen“). Eine
 * Form für beide Arten: bis zu drei Gruppen aus dem Kern („Im Einsatz frei“, „Aus dem Stamm“,
 * „Demo-Daten“ hinten), gesucht über den Suchtext aus LLH-1100.
 *
 * - Einsatz-Eintrag → Zuordnungsweg der Einheit (`ordnePersonalZu`/`ordneFahrzeugZu`).
 * - Stamm-Eintrag → Sammel-Disposition (LLH-1100) mit genau dieser Kraft und `einheit_id`, ohne
 *   Fahrzeug: Disponieren, Initialstatus und Zuordnung in einem Schritt, alles oder nichts.
 *
 * Die Stammliste wird nur mit Freigabe des Zielmoduls abgefragt. Fehlt jede Gruppe, steht die
 * Auswahl gesperrt mit Kurzgrund daneben (`aria-describedby`, LFH-966); ohne Schreibrecht in der
 * Einheit gibt es sie nicht (D14). Der Grund einer Ablehnung steht unter der Auswahl, bis zur
 * nächsten Wahl (LFH-1077), mit dem Grund der Kraft aus `ApiError.zeilen`.
 */

/** Was die Seite von der Einsatzliste weiß: Daten und ob ihr Abruf scheiterte. */
interface EinsatzListe<T> {
  data: readonly T[] | undefined;
  isError: boolean;
  error: unknown;
}

interface Gemeinsam {
  einsatzId: number;
  einheitId: number;
  rechte: EinheitRechte;
}

type ZuordnenAuswahlProps =
  | (Gemeinsam & { art: 'personal'; einsatzListe: EinsatzListe<EinsatzPersonal> })
  | (Gemeinsam & { art: 'fahrzeug'; einsatzListe: EinsatzListe<EinsatzFahrzeug> });

export default function ZuordnenAuswahl(props: ZuordnenAuswahlProps) {
  const { art, einsatzId, einheitId, rechte } = props;
  const qc = useQueryClient();
  const { token } = useRollen();
  const grundId = useId();
  const istPerson = art === 'personal';
  const canEinsatz = istPerson
    ? rechte.canZuordnenPersonalEinsatz
    : rechte.canZuordnenFahrzeugEinsatz;
  const canStamm = istPerson ? rechte.canZuordnenPersonalStamm : rechte.canZuordnenFahrzeugStamm;

  // Stamm im Dienst und die Entlassenen des Einsatzes (die der Sammelweg ablehnte, LLH-1100).
  const stammPersonal = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
    enabled: istPerson && canStamm,
  });
  const entlassenesPersonal = useQuery({
    queryKey: einsatzKeys.personalEntlassene(einsatzId),
    queryFn: () => listEntlassenesPersonal(einsatzId),
    enabled: istPerson && canStamm,
  });
  const stammFahrzeuge = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
    enabled: !istPerson && canStamm,
  });
  const entlasseneFahrzeuge = useQuery({
    queryKey: einsatzKeys.fahrzeugeEntlassene(einsatzId),
    queryFn: () => listEntlasseneFahrzeuge(einsatzId),
    enabled: !istPerson && canStamm,
  });

  const fehler = useZeilenFehler<'zuordnen'>();
  function invalidate() {
    for (const key of [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.personal(einsatzId),
      einsatzKeys.fahrzeuge(einsatzId),
      einsatzKeys.etb(einsatzId),
      einsatzKeys.kraefteZeitachse(einsatzId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  }
  const zuordnen = useMutation({
    mutationFn: async (w: ZuordnenWahl) => {
      if (w.quelle === 'einsatz') {
        await (istPerson
          ? ordnePersonalZu(einsatzId, einheitId, w.id)
          : ordneFahrzeugZu(einsatzId, einheitId, w.id));
      } else if (istPerson) {
        await disponierePersonalSammel(einsatzId, { personal_ids: [w.id], einheit_id: einheitId });
      } else {
        await disponiereFahrzeugeSammel(einsatzId, { fahrzeug_ids: [w.id], einheit_id: einheitId });
      }
    },
    onMutate: () => fehler.beginne('zuordnen'),
    onSuccess: invalidate,
    onError: (e, w) => fehler.melde('zuordnen', fehlerDerKraft(e, art, w.id)),
  });

  if (!rechte.canEditEinheit) return null;

  const gruppen: ZuordnenGroup[] =
    props.art === 'personal'
      ? buildPersonZuordnenGroups({
          einsatz: props.einsatzListe.data ?? [],
          entlassene: entlassenesPersonal.data ?? [],
          stamm: stammPersonal.data ?? [],
          canEinsatz,
          canStamm,
        })
      : buildFahrzeugZuordnenGroups({
          einsatz: props.einsatzListe.data ?? [],
          entlassene: entlasseneFahrzeuge.data ?? [],
          stamm: stammFahrzeuge.data ?? [],
          canEinsatz,
          canStamm,
        });

  const platzhalter = istPerson ? 'Person zuordnen …' : 'Fahrzeug zuordnen …';
  const gesperrt = !canEinsatz && !canStamm;
  const gesperrtGrund = istPerson ? MODUL_PERSONAL_GESPERRT : MODUL_FAHRZEUGE_GESPERRT;

  /*
   * Ein leeres Feld nennt den Ausfall, wenn eine Liste nicht ankam; sonst behauptete es „Keine
   * freien …“. Kein `kein403`: die Stamm-Routen sind org-lesbar ohne Admin-Schranke.
   */
  const stamm = istPerson ? stammPersonal : stammFahrzeuge;
  const leerInhalt =
    (canEinsatz
      ? nichtGefundenInhalt(props.einsatzListe, {
          allgemein: istPerson
            ? 'Kräfte konnten nicht geladen werden'
            : 'Fahrzeuge konnten nicht geladen werden',
        })
      : undefined) ??
    (canStamm
      ? nichtGefundenInhalt(stamm, {
          allgemein: istPerson
            ? 'Personalliste konnte nicht geladen werden'
            : 'Fahrzeugliste konnte nicht geladen werden',
        })
      : undefined) ??
    (istPerson ? 'Keine freien Personen' : 'Keine freien Fahrzeuge');

  const optionen = gruppen.map((g) => ({
    label: g.titel,
    title: g.titel,
    options: g.eintraege.map((e) => ({
      value: e.wert,
      label: g.key === 'demo' ? <DemoLabel>{e.label}</DemoLabel> : e.label,
      suchtext: e.suchtext,
    })),
  }));
  const grund = fehler.grund('zuordnen');

  return (
    <div style={{ marginTop: token.marginSM }}>
      <Select<string>
        style={{ width: '100%' }}
        placeholder={platzhalter}
        aria-label={istPerson ? 'Person zuordnen' : 'Fahrzeug zuordnen'}
        value={null}
        loading={zuordnen.isPending}
        disabled={gesperrt}
        aria-describedby={gesperrt ? grundId : undefined}
        showSearch={SUCHTEXT_SUCHE}
        notFoundContent={leerInhalt}
        options={optionen}
        onSelect={(wert) => {
          const wahl = parseZuordnenWert(String(wert));
          if (wahl) zuordnen.mutate(wahl);
        }}
      />
      {gesperrt && (
        <Typography.Text type="secondary" id={grundId}>
          {gesperrtGrund}
        </Typography.Text>
      )}
      {grund && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={grund.fehler}
            titel="Nicht zugeordnet"
            fallback="Zuordnen fehlgeschlagen"
          />
        </div>
      )}
    </div>
  );
}
