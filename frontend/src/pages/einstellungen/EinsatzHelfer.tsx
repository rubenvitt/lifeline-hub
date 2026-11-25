import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, Form, Modal } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { QRCodeSVG } from 'qrcode.react';
import { IconKreuz, IconPersonPlus, IconStift, IconUhr } from '../../icons';
import {
  Augenbraue,
  Feld,
  Formularpaneel,
  Knopfreihe,
  MetaZeile,
  monoStil,
  Stapel,
  Textstufe,
  useRollen,
} from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import { Select } from '../../components/Select';
import KopierbarerText from '../../components/KopierbarerText';
import { ErfassungsModal } from '../../components/Erfassung';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import Druckkopf from '../../components/druck/Druckkopf';
import DruckKnopf from '../../components/druck/DruckKnopf';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { relativ } from '../../anzeige/dauer';
import { pflicht } from '../../components/pflichtRegel';
import { ApiError } from '../../api/client';
import {
  confirmHelfer,
  createHelferEinladung,
  extendHelfer,
  GRUND_PERSON_NOT_REQUESTED,
  GRUND_TRACKER_TAKEN,
  loadHelfer,
  rejectHelfer,
  removeAllHelfer,
  removeHelfer,
  revokeHelferEinladung,
  type HelferBestaetigungBody,
} from '../../api/helfer';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  EinsatzAnzeige,
  HelferAnzeige,
  HelferEinladungAnzeige,
  HelferUebersicht,
  HelferZiel,
} from '../../api/types';
import { helferAdresse } from '../../routing/deeplinks';
import { positionsAlter } from '../lagekarte/positionsAlter';
import { codeGruppiert, endeFehler, verlaengernVorbelegung } from './geraeteKern';
import {
  EINLADUNG_DAUER_OPTIONEN,
  EINLADUNG_VORGABE_MINUTEN,
  findTracker,
  gleichesZiel,
  GRUPPEN_TITEL,
  HELFER_GRUPPEN,
  helferGruppe,
  sortHelfer,
  suggestPerson,
  zielSchluessel,
  zielText,
  type HelferGruppe,
} from './helferKern';
import './helferEinladungPrint.css';

/** Grund, wenn die Organisation die Ortung ausgeschaltet hat (Server: 403 beim Einladen). */
export const ORTUNG_AUS_TEXT =
  'Ortung ist für diese Organisation ausgeschaltet (Verwaltung → Einsatz-Vorgaben).';

/** Anker des Bereichs; der Hinweis im Einsatzkopf springt hierher (`einsatzHelferPfad`). */
export const HELFER_ANKER = 'helfer';

interface EinladenWerte {
  dauer: number;
}

interface BestaetigenWerte {
  /** Ziel als `unit:<id>` bzw. `vehicle:<id>` (`zielSchluessel`); vorbelegt mit der Wahl des Helfers. */
  ziel?: string;
  is_tracker: boolean;
  person_id?: number | null;
}

interface VerlaengernWerte {
  ende: Dayjs | null;
}

/** Aktion nach einem 409 `tracker_taken`: das alte Ortungsgerät ersetzen oder nur die Person orten. */
type KonfliktAktion = 'ersetzen' | 'nur-person';

interface Belegt {
  helferId: number;
  halterName: string;
}

function istTrackerTaken(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409 && e.grund === GRUND_TRACKER_TAKEN;
}

function istPersonNichtGewuenscht(e: unknown): boolean {
  return e instanceof ApiError && e.status === 422 && e.grund === GRUND_PERSON_NOT_REQUESTED;
}

/** Text zum 422 `person_not_requested`; der Server lehnt eine Person ohne Wunsch der Kraft ab. */
const PERSON_NICHT_GEWUENSCHT_TEXT =
  'Die Kraft hat keine Personenortung gewählt. Bitte die Person entfernen und erneut bestätigen.';

/** Rückfrage vor einer neuen Einladung, solange eine gültige besteht. */
const NEUE_EINLADUNG_FRAGE =
  'Neue Einladung anlegen? Gedruckte QR-Codes der bisherigen Einladung werden ungültig.';

function istOrtungAus(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403;
}

interface Props {
  einsatzId: number;
  einsatz: EinsatzAnzeige;
  /** Einladen, Bestätigen und Abmelden: Einsatzleitung am aktiven, selbst geführten Einsatz. */
  darf: boolean;
}

/**
 * Bereich „Helfer“ der Geräte-Sektion (Helfer-App, Spec
 * `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Oberfläche“).
 *
 * „Helfer einladen“ gibt einen Code aus, der als QR (`https://<server>/helfer#<CODE>`) und Text
 * einmal im Dialog steht und dort als Blatt „Helfer anmelden“ gedruckt werden kann; danach zeigt
 * die Liste nur noch die Gültigkeit (der Server speichert den Code nicht im Klartext). Wer den
 * Code einlöst, wartet, bis die Leitung ihn bestätigt (Ziel, Person, Ortungsgerät) oder ablehnt.
 *
 * Live über das Ereignis `helfer` (nur an die Einsatzleitung). Ist die Ortung der Organisation aus,
 * ist „Helfer einladen“ gesperrt und nennt den Grund; die Freigabe (`tracking_enabled`,
 * `person_tracking_allowed`) steht in der Helfer-Übersicht selbst, nicht in den Org-Einstellungen.
 */
export default function EinsatzHelfer({ einsatzId, einsatz, darf }: Props) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();

  const [einladenOffen, setEinladenOffen] = useState(false);
  const [neueEinladung, setNeueEinladung] = useState<HelferEinladungAnzeige | null>(null);
  const [bestaetigenFuer, setBestaetigenFuer] = useState<HelferAnzeige | null>(null);
  const [belegt, setBelegt] = useState<Belegt | null>(null);
  const [entfernenFuer, setEntfernenFuer] = useState<HelferAnzeige | null>(null);
  const [verlaengernFuer, setVerlaengernFuer] = useState<HelferAnzeige | null>(null);
  const [alleAbmelden, setAlleAbmelden] = useState(false);

  const helferQ = useQuery({
    queryKey: einsatzKeys.helfer(einsatzId),
    queryFn: () => loadHelfer(einsatzId),
  });
  const ortungAus = helferQ.data?.tracking_enabled === false;
  // Die Person wird nur angeboten, wenn die Kraft „als Person orten“ gewählt hat und die
  // Organisation Personenortung erlaubt; der Server lehnt sonst mit 422 `person_not_requested` ab.
  const personFeld =
    bestaetigenFuer != null &&
    bestaetigenFuer.person_requested &&
    helferQ.data?.person_tracking_allowed === true;
  const zielQ = useQuery({
    queryKey: [...einsatzKeys.helfer(einsatzId), 'ziele'] as const,
    queryFn: async () => {
      const [einheiten, fahrzeuge] = await Promise.all([
        listeEinheiten(einsatzId),
        listeEinsatzFahrzeuge(einsatzId),
      ]);
      const ziele: HelferZiel[] = [
        ...einheiten.map((e) => ({ kind: 'unit' as const, id: e.id, name: e.name })),
        ...fahrzeuge
          .filter((f) => f.beendet_als == null)
          .map((f) => ({ kind: 'vehicle' as const, id: f.id, name: f.funkrufname })),
      ];
      return ziele;
    },
    enabled: bestaetigenFuer != null && darf,
  });
  const personalQ = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personFeld,
  });

  const [einladenForm] = Form.useForm<EinladenWerte>();
  const [bestaetigenForm] = Form.useForm<BestaetigenWerte>();
  const gewaehlt = Form.useWatch('ziel', bestaetigenForm);
  const gewaehltePerson = Form.useWatch('person_id', bestaetigenForm);
  const [verlaengernForm] = Form.useForm<VerlaengernWerte>();

  // Sprung aus dem Hinweis im Einsatzkopf: der Bereich steht unter Gerätekopplung und Anbindungen.
  const geladen = helferQ.data != null;
  useEffect(() => {
    if (!geladen || window.location.hash !== `#${HELFER_ANKER}`) return;
    document.getElementById(HELFER_ANKER)?.scrollIntoView?.({ block: 'start' });
  }, [geladen]);

  /** Übernimmt einen geänderten Helfer in die geladene Übersicht. */
  const uebernimm = (h: HelferAnzeige) =>
    qc.setQueryData<HelferUebersicht>(einsatzKeys.helfer(einsatzId), (alt) =>
      alt
        ? {
            ...alt,
            helpers: alt.helpers.some((x) => x.id === h.id)
              ? alt.helpers.map((x) => (x.id === h.id ? h : x))
              : [...alt.helpers, h],
          }
        : alt,
    );
  const neuLaden = () => qc.invalidateQueries({ queryKey: einsatzKeys.helfer(einsatzId) });

  const einladen = useMutation({
    mutationFn: (minuten: number) => createHelferEinladung(einsatzId, minuten),
    onSuccess: (e) => {
      setNeueEinladung(e);
      void neuLaden();
    },
  });
  const einladungWiderrufen = useMutation({
    mutationFn: (id: number) => revokeHelferEinladung(einsatzId, id),
    onSuccess: () => {
      message.success('Einladung widerrufen');
      void neuLaden();
    },
  });
  const bestaetigen = useMutation({
    mutationFn: (v: { h: HelferAnzeige; body: HelferBestaetigungBody }) =>
      confirmHelfer(einsatzId, v.h.id, v.body),
    onSuccess: (h) => {
      uebernimm(h);
      setBelegt(null);
      // Ein ersetztes Ortungsgerät hat seine Rolle verloren.
      void neuLaden();
      message.success(`${h.display_name} bestätigt`);
    },
  });
  const ablehnen = useMutation({
    mutationFn: (h: HelferAnzeige) => rejectHelfer(einsatzId, h.id),
    onSuccess: (h) => {
      uebernimm(h);
      message.success(`${h.display_name} abgelehnt`);
    },
  });
  const entfernen = useMutation({
    mutationFn: (h: HelferAnzeige) => removeHelfer(einsatzId, h.id),
    onSuccess: (h) => {
      uebernimm(h);
      setEntfernenFuer(null);
      message.success(`${h.display_name} abgemeldet`);
    },
  });
  const alleEntfernen = useMutation({
    mutationFn: () => removeAllHelfer(einsatzId),
    onSuccess: (u) => {
      qc.setQueryData(einsatzKeys.helfer(einsatzId), u);
      setAlleAbmelden(false);
      message.success('Alle Helfer abgemeldet');
    },
  });
  const verlaengern = useMutation({
    mutationFn: (v: { h: HelferAnzeige; ende: Dayjs }) =>
      extendHelfer(einsatzId, v.h.id, alsBackendZeit(v.ende)),
    onSuccess: (h) => {
      uebernimm(h);
      message.success(`${h.display_name} verlängert`);
    },
  });

  const liste = sortHelfer(helferQ.data?.helpers ?? []);

  const oeffneBestaetigen = (h: HelferAnzeige) => {
    bestaetigen.reset();
    setBelegt(null);
    setBestaetigenFuer(h);
  };

  const menueLaeuft = verlaengern.isPending || entfernen.isPending || bestaetigen.isPending;
  const helferMenue: WeitereAktionen<HelferAnzeige> | undefined = darf
    ? {
        eintraege: (h) =>
          h.state === 'aktiv'
            ? [
                { key: 'aendern', icon: <IconStift />, label: 'Ändern …' },
                { key: 'verlaengern', icon: <IconUhr />, label: 'Verlängern …' },
                { key: 'entfernen', icon: <IconKreuz />, label: 'Entfernen …', gefahr: true },
              ]
            : [],
        zugaenglicherName: (h) => `Aktionen zu Helfer ${h.display_name}`,
        laeuft: () => menueLaeuft,
        onWahl: (key, h) => {
          if (key === 'aendern') oeffneBestaetigen(h);
          else if (key === 'verlaengern') {
            verlaengern.reset();
            setVerlaengernFuer(h);
          } else if (key === 'entfernen') {
            entfernen.reset();
            setEntfernenFuer(h);
          }
        },
      }
    : undefined;
  const kontext = useZeilenMenueKontext(helferMenue, {
    finde: (id) => helferQ.data?.helpers.find((h) => h.id === id),
    schluessel: (h) => h.id,
  });

  if (helferQ.isLoading) return <SeitenSkeleton />;
  // Ohne Daten ist der Fehler die Seite; mit Daten bleibt der letzte Stand stehen und ein
  // Hinweis nennt den gescheiterten Neuabruf (Live-Abgleich, jeder Netzaussetzer löste sonst aus).
  if (!helferQ.data) {
    return (
      <SeitenFehler
        text="Helfer nicht ladbar"
        ursache={helferQ.error}
        onWiederholen={() => void helferQ.refetch()}
      />
    );
  }

  const { invitation } = helferQ.data;
  const laufende = liste.filter((h) => helferGruppe(h.state) !== 'beendet');
  const jetzt = new Date();

  const zustandZeile = (h: HelferAnzeige) => {
    const gruppe = helferGruppe(h.state);
    const alter = positionsAlter(h.last_position_at, jetzt);
    return (
      <MetaZeile>
        <MetaZeile.Teil>{zielText(h.target)}</MetaZeile.Teil>
        <MetaZeile.Teil>
          {gruppe === 'wartet' && h.person_requested ? 'möchte als Person geortet werden' : null}
          {gruppe !== 'wartet' && h.is_tracker ? 'Ortungsgerät' : null}
        </MetaZeile.Teil>
        <MetaZeile.Teil>{h.person ? `Person ${h.person.name}` : null}</MetaZeile.Teil>
        <MetaZeile.Teil>
          {gruppe === 'angemeldet'
            ? h.paused
              ? 'pausiert'
              : alter
                ? `Position ${relativ(alter.minuten, 'vor')}`
                : 'noch keine Position'
            : null}
        </MetaZeile.Teil>
        <MetaZeile.Teil>
          {gruppe === 'wartet' ? (
            <>
              {'seit '}
              <MetaZeile.Zahl>{zeitKurz(h.created_at, konv)}</MetaZeile.Zahl>
            </>
          ) : gruppe === 'angemeldet' ? (
            <>
              {'bis '}
              <MetaZeile.Zahl>{zeitKurz(h.expires_at, konv)}</MetaZeile.Zahl>
            </>
          ) : h.state === 'abgelehnt' ? (
            'abgelehnt'
          ) : (
            'beendet'
          )}
        </MetaZeile.Teil>
      </MetaZeile>
    );
  };

  const aktionen = (h: HelferAnzeige) => {
    if (!darf) return undefined;
    if (h.state === 'unbestaetigt') {
      return [
        <Button key="bestaetigen" type="primary" onClick={() => oeffneBestaetigen(h)}>
          Bestätigen …
        </Button>,
        <Button
          key="ablehnen"
          danger
          loading={ablehnen.isPending && ablehnen.variables?.id === h.id}
          onClick={() => ablehnen.mutate(h)}
        >
          Ablehnen
        </Button>,
      ];
    }
    if (h.state === 'aktiv' && helferMenue) {
      return [<ZeilenMenueAusloeser key="aktionen" menue={helferMenue} zeile={h} />];
    }
    return undefined;
  };

  const gruppe = (g: HelferGruppe) => {
    const eintraege = liste.filter((h) => helferGruppe(h.state) === g);
    if (eintraege.length === 0) return null;
    return (
      <div key={g} data-lfh={`helfer-gruppe-${g}`}>
        <Augenbraue als="h3">{GRUPPEN_TITEL[g]}</Augenbraue>
        <Liste<HelferAnzeige>
          // Ohne `unterEbene`: eine Einstellungsliste, keine eigenständigen Gegenstände (LFH-826).
          bordered
          dataSource={eintraege}
          rowKey={(h) => h.id}
          renderItem={(h) => (
            <div
              data-lfh="helfer-eintrag"
              {...(helferMenue && h.state === 'aktiv' ? kontext.ausloeser(h) : {})}
            >
              <ListenEintrag actions={aktionen(h)}>
                <ListenEintragMeta
                  title={<span data-lfh="helfer-name">{h.display_name}</span>}
                  description={<div data-lfh="helfer-zustand">{zustandZeile(h)}</div>}
                />
              </ListenEintrag>
            </div>
          )}
        />
      </div>
    );
  };

  // Wählbare Ziele; das Ziel des Helfers steht immer darin, auch wenn es nicht mehr geladen ist.
  const zielOptionen = (() => {
    const ziele = [...(zielQ.data ?? [])];
    const eigenes = bestaetigenFuer?.target;
    if (eigenes && !ziele.some((z) => zielSchluessel(z) === zielSchluessel(eigenes))) {
      ziele.unshift(eigenes);
    }
    return ziele;
  })();
  const bestaetigenZiel =
    zielOptionen.find((z) => zielSchluessel(z) === gewaehlt) ?? bestaetigenFuer?.target ?? null;
  const zielFrei = bestaetigenFuer
    ? findTracker(liste, bestaetigenZiel, bestaetigenFuer.id) == null
    : true;
  // „Nur Person orten“ gibt es nur mit gewählter Person, sonst entstünde ein Helfer ohne Ortung.
  const konfliktAktionen = belegt
    ? [
        { schluessel: 'ersetzen', text: 'Ersetzen' },
        ...(personFeld && gewaehltePerson != null
          ? [{ schluessel: 'nur-person', text: 'Nur Person orten' }]
          : []),
      ]
    : undefined;
  const personNichtGewuenscht = istPersonNichtGewuenscht(bestaetigen.error);
  const bestaetigenFehler =
    istTrackerTaken(bestaetigen.error) || personNichtGewuenscht ? null : bestaetigen.error;

  const sendeBestaetigung = async (
    h: HelferAnzeige,
    w: BestaetigenWerte,
    aktion?: KonfliktAktion,
  ) => {
    const ziel = zielOptionen.find((z) => zielSchluessel(z) === w.ziel);
    const body: HelferBestaetigungBody = {
      ...(ziel && !gleichesZiel(ziel, h.target)
        ? { target: { kind: ziel.kind, id: ziel.id } }
        : {}),
      is_tracker: aktion === 'nur-person' ? false : w.is_tracker,
      ...(personFeld && w.person_id != null ? { person_id: w.person_id } : {}),
      ...(aktion === 'ersetzen' ? { replace: true } : {}),
    };
    try {
      return await bestaetigen.mutateAsync({ h, body });
    } catch (e) {
      if (istTrackerTaken(e)) {
        const halter = e.details.holder;
        const name =
          liste.find((x) => x.id === halter)?.display_name ??
          findTracker(liste, h.target, h.id)?.display_name ??
          'anderer Helfer';
        setBelegt({ helferId: h.id, halterName: name });
      }
      throw e;
    }
  };

  const einladungsAdresse = neueEinladung?.code
    ? (neueEinladung.url ?? helferAdresse(window.location.origin, neueEinladung.code))
    : null;

  return (
    <section id={HELFER_ANKER} aria-label="Helfer">
      <Formularpaneel
        titel="Helfer"
        dataUpdatedAt={helferQ.dataUpdatedAt}
        beschreibung={ortungAus ? ORTUNG_AUS_TEXT : undefined}
        aktion={
          darf && (
            <Button
              type="primary"
              icon={<IconPersonPlus />}
              disabled={ortungAus}
              onClick={() => {
                einladen.reset();
                if (!invitation) {
                  setEinladenOffen(true);
                  return;
                }
                modal.confirm({
                  title: NEUE_EINLADUNG_FRAGE,
                  okText: 'Neue Einladung',
                  cancelText: 'Abbrechen',
                  onOk: () => setEinladenOffen(true),
                });
              }}
            >
              Helfer einladen
            </Button>
          )
        }
      >
        <Stapel abstand="md">
          <SeitenHinweise
            fehler={helferQ.isError ? helferQ.error : null}
            fehlerTitel="Helfer nicht aktualisiert — letzter Stand"
            fehlerFallback="Aktualisieren fehlgeschlagen"
          />
          <div data-lfh="helfer-einladung">
            {invitation ? (
              <Stapel richtung="zeile" abstand="md" ausrichten="mitte" umbruch>
                <Textstufe>
                  {'Einladung gültig bis '}
                  <span style={monoStil('mono')}>{zeitKurz(invitation.expires_at, konv)}</span>
                </Textstufe>
                {darf && (
                  <Button
                    loading={einladungWiderrufen.isPending}
                    onClick={() => einladungWiderrufen.mutate(invitation.id)}
                  >
                    Einladung widerrufen
                  </Button>
                )}
              </Stapel>
            ) : (
              <Textstufe ton="gedaempft">Keine gültige Einladung</Textstufe>
            )}
            <SpeicherFehler fehler={einladungWiderrufen.error} titel="Nicht widerrufen" />
          </div>
          {liste.length === 0 ? (
            <Textstufe ton="gedaempft">Noch kein Helfer angemeldet</Textstufe>
          ) : (
            HELFER_GRUPPEN.map(gruppe)
          )}
          <SpeicherFehler fehler={ablehnen.error} titel="Nicht abgelehnt" />
          {darf && laufende.length > 0 && (
            <Knopfreihe>
              <Button
                danger
                onClick={() => {
                  alleEntfernen.reset();
                  setAlleAbmelden(true);
                }}
              >
                Alle Helfer abmelden …
              </Button>
            </Knopfreihe>
          )}
        </Stapel>
        {kontext.menue}
      </Formularpaneel>

      <ErfassungsModal<EinladenWerte>
        offen={einladenOffen}
        titel="Helfer einladen"
        form={einladenForm}
        initialValues={{ dauer: EINLADUNG_VORGABE_MINUTEN }}
        erfassenText="Einladen"
        laeuft={einladen.isPending}
        onErfassen={(w) => einladen.mutateAsync(w.dauer)}
        onFertig={() => setEinladenOffen(false)}
        onAbbrechen={() => {
          einladen.reset();
          setEinladenOffen(false);
        }}
      >
        <Feld
          label="Gültigkeit"
          name="dauer"
          abstand="ohne"
          rules={[pflicht('Gültigkeit')]}
          extra="Eine neue Einladung ersetzt die alte; angemeldete Helfer bleiben."
        >
          <Select<number> options={[...EINLADUNG_DAUER_OPTIONEN]} />
        </Feld>
        {istOrtungAus(einladen.error) ? (
          <Alert type="error" showIcon title="Nicht eingeladen" description={ORTUNG_AUS_TEXT} />
        ) : (
          <SpeicherFehler fehler={einladen.error} titel="Nicht eingeladen" />
        )}
      </ErfassungsModal>

      <Modal
        open={neueEinladung != null}
        title="Helfer anmelden"
        footer={
          <Knopfreihe fuss>
            <DruckKnopf />
            <Button type="primary" onClick={() => setNeueEinladung(null)}>
              Fertig
            </Button>
          </Knopfreihe>
        }
        // Der Code steht nur jetzt da: weder Escape noch ein Klick daneben schließt den Dialog.
        keyboard={false}
        maskClosable={false}
        onCancel={() => setNeueEinladung(null)}
        destroyOnHidden
      >
        {neueEinladung?.code && einladungsAdresse && (
          // Druckwurzel (Druck-Regeln, `frontend/src/druck/AGENTS.md`): nur solange der Code
          // bekannt ist, also nur in diesem Dialog. Das Blatt „Helfer anmelden“ ist sein Inhalt.
          <div
            data-lfh="druckwurzel"
            className="helfer-einladung-print-root"
            data-testid="helfer-einladung"
          >
            <Druckkopf
              dokumentart="Helfer anmelden"
              einsatz={einsatz}
              sichtbarkeit="druck"
              zeilen={[{ etikett: 'Gültig bis', wert: zeitKurz(neueEinladung.expires_at, konv) }]}
            />
            <Stapel abstand="sm">
              <Textstufe als="p">
                {`Gültig bis ${zeitKurz(neueEinladung.expires_at, konv)}, für beliebig viele Helfer. Der Code steht nur jetzt da.`}
              </Textstufe>
              <div
                style={{
                  // Wie bei der Gerätekopplung: Grund und Ruhezone trägt das SVG selbst.
                  background: rollen.flaeche,
                  width: 'fit-content',
                }}
              >
                <QRCodeSVG value={einladungsAdresse} size={200} marginSize={4} />
              </div>
              <KopierbarerText text={neueEinladung.code} bezeichnung="Helfer-Code">
                <span
                  data-lfh="helfer-code"
                  style={{ ...monoStil('datenwertKlein'), letterSpacing: '0.1em' }}
                >
                  {codeGruppiert(neueEinladung.code)}
                </span>
              </KopierbarerText>
              <Textstufe ton="gedaempft">
                <span data-schrift="kennung">{einladungsAdresse}</span>
              </Textstufe>
              <ol
                data-lfh="helfer-schritte"
                style={{ margin: 0, paddingInlineStart: token.paddingLG }}
              >
                <li>
                  App „Lifeline Helfer“ installieren (iPhone: über TestFlight, Android: APK von der
                  Einsatzleitung).
                </li>
                <li>QR-Code mit der Kamera scannen oder den Code in der App eingeben.</li>
                <li>
                  Namen eingeben, Einheit oder Fahrzeug wählen und warten, bis die Einsatzleitung
                  bestätigt.
                </li>
              </ol>
            </Stapel>
          </div>
        )}
      </Modal>

      <ErfassungsModal<BestaetigenWerte>
        offen={bestaetigenFuer != null}
        titel={
          bestaetigenFuer ? `Helfer bestätigen — ${bestaetigenFuer.display_name}` : 'Bestätigen'
        }
        form={bestaetigenForm}
        initialValues={{
          ziel: zielSchluessel(bestaetigenFuer?.target),
          is_tracker: bestaetigenFuer?.state === 'aktiv' ? bestaetigenFuer.is_tracker : zielFrei,
        }}
        erfassenText="Bestätigen"
        laeuft={bestaetigen.isPending}
        nebenaktionen={konfliktAktionen}
        speicherung={{
          error: bestaetigenFehler,
          isPending: bestaetigen.isPending,
          reset: bestaetigen.reset,
        }}
        speicherFehlerTitel="Nicht bestätigt"
        onErfassen={(w, aktion) => {
          const h = bestaetigenFuer;
          if (!h) return Promise.reject(new Error('Kein Helfer'));
          return sendeBestaetigung(h, w, aktion as KonfliktAktion | undefined);
        }}
        onFertig={() => {
          setBestaetigenFuer(null);
          setBelegt(null);
        }}
        onAbbrechen={() => {
          bestaetigen.reset();
          setBestaetigenFuer(null);
          setBelegt(null);
        }}
      >
        {bestaetigenFuer && (
          <Stapel abstand="sm">
            <Feld label="Ziel" name="ziel">
              <Select<string>
                aria-label="Ziel"
                options={zielOptionen.map((z) => ({
                  value: zielSchluessel(z),
                  label: zielText(z),
                }))}
                loading={zielQ.isPending}
              />
            </Feld>
            <Feld
              name="is_tracker"
              valuePropName="checked"
              abstand={personFeld ? undefined : 'ohne'}
            >
              <Checkbox>
                {zielFrei
                  ? 'Ortungsgerät: dieses Gerät meldet die Position des Ziels'
                  : 'Ortungsgerät: ersetzt das bisherige Ortungsgerät des Ziels'}
              </Checkbox>
            </Feld>
            {personFeld &&
              (personalQ.data ? (
                <Feld
                  key={bestaetigenFuer.id}
                  label="Person"
                  name="person_id"
                  abstand="ohne"
                  initialValue={
                    bestaetigenFuer.person?.id ??
                    suggestPerson(bestaetigenFuer.display_name, personalQ.data) ??
                    undefined
                  }
                  extra={
                    bestaetigenFuer.person_requested
                      ? 'Die Kraft möchte als Person geortet werden.'
                      : undefined
                  }
                >
                  <Select<number>
                    allowClear
                    placeholder="Ohne Person"
                    options={personalQ.data.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Feld>
              ) : (
                <Textstufe ton="gedaempft">Kräfte werden geladen …</Textstufe>
              ))}
            {personNichtGewuenscht && (
              <Alert
                type="error"
                showIcon
                data-lfh="helfer-person-nicht-gewuenscht"
                title="Nicht bestätigt"
                description={PERSON_NICHT_GEWUENSCHT_TEXT}
              />
            )}
            {belegt && belegt.helferId === bestaetigenFuer.id && (
              <Alert
                type="warning"
                showIcon
                data-lfh="helfer-belegt"
                title={`${bestaetigenZiel?.name ?? 'Das Ziel'} hat schon ein Ortungsgerät (${belegt.halterName}). Ersetzen oder nur Person orten?`}
              />
            )}
          </Stapel>
        )}
      </ErfassungsModal>

      <ErfassungsModal<VerlaengernWerte>
        offen={verlaengernFuer != null}
        titel={verlaengernFuer ? `Verlängern — ${verlaengernFuer.display_name}` : 'Verlängern'}
        form={verlaengernForm}
        initialValues={{ ende: verlaengernVorbelegung() }}
        erfassenText="Verlängern"
        laeuft={verlaengern.isPending}
        onErfassen={(w) => {
          const h = verlaengernFuer;
          if (!h || !w.ende) return Promise.reject(new Error('Ende angeben'));
          return verlaengern.mutateAsync({ h, ende: w.ende });
        }}
        onFertig={() => setVerlaengernFuer(null)}
        onAbbrechen={() => setVerlaengernFuer(null)}
      >
        <Feld
          label="Neues Ende"
          name="ende"
          abstand="ohne"
          rules={[
            {
              validator: (_, wert: Dayjs | null) => {
                const fehler = endeFehler(wert);
                return fehler ? Promise.reject(new Error(fehler)) : Promise.resolve();
              },
            },
          ]}
        >
          <ZeitpunktEingabe art="frist" style={{ width: '100%' }} />
        </Feld>
        <SpeicherFehler fehler={verlaengern.error} titel="Nicht verlängert" />
      </ErfassungsModal>

      <Modal
        open={entfernenFuer != null}
        title={entfernenFuer ? `${entfernenFuer.display_name} entfernen?` : 'Entfernen?'}
        okText="Entfernen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: entfernen.isPending }}
        onOk={() => entfernenFuer && entfernen.mutate(entfernenFuer)}
        onCancel={() => setEntfernenFuer(null)}
        destroyOnHidden
      >
        <p>Das Gerät meldet sich sofort ab; eine geortete Person verliert ihre Position.</p>
        <SpeicherFehler fehler={entfernen.error} titel="Nicht entfernt" />
      </Modal>

      <Modal
        open={alleAbmelden}
        title="Alle Helfer abmelden?"
        okText="Alle abmelden"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: alleEntfernen.isPending }}
        onOk={() => alleEntfernen.mutate()}
        onCancel={() => setAlleAbmelden(false)}
        destroyOnHidden
      >
        <p>
          {`${laufende.length} Helfer verlieren sofort den Zugang; geortete Personen ihre Position. Die Einladung bleibt.`}
        </p>
        <SpeicherFehler fehler={alleEntfernen.error} titel="Nicht abgemeldet" />
      </Modal>
    </section>
  );
}
