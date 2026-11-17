import { useState } from 'react';
import { Button, Checkbox, Input } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { Link, useParams } from 'react-router';
import { IconKreuz } from '../../icons';
import AdminPage from '../../components/AdminPage';
import {
  BearbeitbaresPaneel,
  Datenfeld,
  Datenraster,
  Paneel,
  StatusChip,
  monoStil,
  useRollen,
  type BearbeitbaresFeld,
} from '../../components/instrument';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../../components/SeitenZustand';
import { RechteHinweis, SeitenHinweise } from '../../components/SpeicherHinweis';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import {
  SCOPES,
  SCOPE_TEXT,
  ablehnungText,
  aendereAnbindung,
  ladeAnbindungen,
  stelleAnbindungsCodeAus,
  widerrufeAnbindung,
  type AnbindungPatch,
} from '../../api/anbindungen';
import { ANBINDUNG_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { AnbindungAnzeige, AnbindungCode, Scope } from '../../api/types';
import { CodeDialog, RechteText, WiderrufDialog } from './AnbindungDialoge';
import AnbindungWebhook from './AnbindungWebhook';
import {
  ANBINDUNGEN_ABRUF_MS,
  anbindungenPath,
  einsatzAnzeige,
  uebernimmAnbindung,
  zustandAnzeige,
} from './anbindungAnzeige';

interface ZugangWerte {
  name: string;
  scopes: Scope[];
  gueltig_bis: Dayjs | null;
}

function werteVon(z: AnbindungAnzeige): ZugangWerte {
  return {
    name: z.name,
    scopes: [...z.scopes],
    gueltig_bis: alsZeitpunkt(z.gueltig_bis) ?? null,
  };
}

const fristText = (d: Dayjs | null) => (d ? alsBackendZeit(d) : null);

/**
 * Nur Geändertes (`frontend/AGENTS.md`, „Bearbeiten in der Ansicht“, Punkt 4): der Name getrimmt,
 * die Rechte als Menge (die Reihenfolge der Haken ändert nichts), die Frist auf die Minute des
 * Wire-Formats; `gueltig_bis: null` hebt sie auf. Rein und exportiert für den Test.
 */
export function zugangPatch(vorher: ZugangWerte, nachher: ZugangWerte): AnbindungPatch {
  const patch: AnbindungPatch = {};
  const name = (nachher.name ?? '').trim();
  if (name !== vorher.name) patch.name = name;
  const scopes = nachher.scopes ?? [];
  const gleicheRechte =
    scopes.length === vorher.scopes.length && scopes.every((s) => vorher.scopes.includes(s));
  if (!gleicheRechte) patch.scopes = SCOPES.filter((s) => scopes.includes(s));
  const frist = fristText(nachher.gueltig_bis);
  if (frist !== fristText(vorher.gueltig_bis)) patch.gueltig_bis = frist;
  return patch;
}

/**
 * Ansicht eines Maschinenzugangs `/admin/einstellungen/anbindungen/:zugangId` (LLH-1652, Spec
 * `maschinenzugang`). Name, Rechte und Frist bearbeitet der System-Admin im Paneel „Zugang“
 * (`BearbeitbaresPaneel`, CAS über `geaendert_at`); neuer Code und Widerruf stehen im Kopf. Den
 * Datensatz liefert die Liste der Seite davor (ein Abruf, ein Cache-Fach), alle 30 s frisch.
 * Darunter der Webhook der Anbindung (LLH-1656, `AnbindungWebhook`).
 */
export default function AnbindungAnsicht() {
  const { zugangId } = useParams();
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [code, setCode] = useState<AnbindungCode | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<AnbindungAnzeige | null>(null);

  const listeQ = useQuery({
    queryKey: globalKeys.anbindungen(),
    queryFn: ladeAnbindungen,
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });

  const neuerCode = useMutation({
    mutationFn: (id: string) => stelleAnbindungsCodeAus(id),
    onSuccess: (antwort) => {
      uebernimmAnbindung(qc, antwort.zugang);
      setCode(antwort);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (z: AnbindungAnzeige) => widerrufeAnbindung(z.id),
    onSuccess: (z) => {
      uebernimmAnbindung(qc, z);
      setWiderrufFuer(null);
    },
  });

  const liste = listeQ.data;
  const zugang = liste?.zugaenge.find((z) => z.id === zugangId);

  if (!liste) {
    return listeQ.isError ? (
      <AdminPage titel="Anbindung">
        <SeitenFehler
          text="Anbindungen nicht ladbar"
          ursache={listeQ.error}
          onWiederholen={() => void listeQ.refetch()}
          laedt={listeQ.isFetching}
        />
      </AdminPage>
    ) : (
      <SeitenSkeleton />
    );
  }
  if (!zugang) {
    return (
      <AdminPage titel="Anbindung">
        <SeitenLeer
          titel="Anbindung nicht gefunden"
          hinweis="Die Kennung gehört zu keiner Anbindung dieser Organisation."
          aktion={{ label: 'Zu den Anbindungen', pfad: anbindungenPath() }}
        />
      </AdminPage>
    );
  }

  const zeit = (wert: string) => zeitKurz(wert, konv);
  const zustand = zustandAnzeige(zugang);
  const einsatz = einsatzAnzeige(zugang);
  const istWiderrufen = zugang.zustand === 'widerrufen';
  const gesperrt = liste.gesperrt_grund ?? null;

  const speichern = async (patch: AnbindungPatch, basis: string | undefined) => {
    const z = await aendereAnbindung(zugang.id, {
      ...patch,
      ...(basis !== undefined ? { basis_geaendert_at: basis } : {}),
    });
    uebernimmAnbindung(qc, z);
  };

  const felder: BearbeitbaresFeld<ZugangWerte>[] = [
    {
      name: 'name',
      label: 'Name',
      anzeige: zugang.name,
      eingabe: <Input maxLength={ANBINDUNG_NAME_MAX} autoComplete="off" />,
      regeln: [
        { required: true, whitespace: true, message: 'Name angeben' },
        { max: ANBINDUNG_NAME_MAX, message: `Höchstens ${ANBINDUNG_NAME_MAX} Zeichen` },
      ],
    },
    {
      name: 'gueltig_bis',
      label: 'Gültig bis',
      anzeige: zugang.gueltig_bis ? zeit(zugang.gueltig_bis) : 'bis zum Widerruf',
      eingabe: (
        <ZeitpunktEingabe art="frist" placeholder="bis zum Widerruf" style={{ width: '100%' }} />
      ),
    },
    {
      name: 'scopes',
      label: 'Rechte',
      breit: true,
      anzeige: <RechteText scopes={zugang.scopes} />,
      eingabe: (
        <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
          {SCOPES.map((s) => (
            <Checkbox key={s} value={s}>
              {SCOPE_TEXT[s]}{' '}
              <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>{s}</span>
            </Checkbox>
          ))}
        </Checkbox.Group>
      ),
      regeln: [{ required: true, type: 'array', min: 1, message: 'Mindestens ein Recht wählen' }],
    },
  ];

  return (
    <AdminPage
      pfad={[{ title: <Link to={anbindungenPath()}>Anbindungen</Link> }, { title: zugang.name }]}
      titel={
        <span
          style={{ display: 'inline-flex', gap: token.marginXS, alignItems: 'center' }}
          data-lfh="anbindung-titel"
        >
          {zugang.name}
          <StatusChip ton={zustand.ton} wort={zustand.wort} />
        </span>
      }
      aktionen={
        istAdmin &&
        !istWiderrufen && (
          <span style={{ display: 'inline-flex', gap: token.marginXS }}>
            <Button
              disabled={gesperrt != null}
              loading={neuerCode.isPending}
              onClick={() => neuerCode.mutate(zugang.id)}
            >
              Neuer Code
            </Button>
            <Button
              danger
              icon={<IconKreuz />}
              onClick={() => {
                widerrufen.reset();
                setWiderrufFuer(zugang);
              }}
            >
              Widerrufen …
            </Button>
          </span>
        )
      }
      hinweis={
        <SeitenHinweise
          rechteFehlt={!istAdmin}
          rechteText={NUR_ADMIN}
          fehler={neuerCode.error}
          fehlerTitel="Kein neuer Code"
        />
      }
    >
      {gesperrt && !istWiderrufen && (
        <div style={{ marginBlockEnd: token.margin }}>
          <RechteHinweis sichtbar marke="Am Hub anbinden" text={gesperrt} />
        </div>
      )}
      {listeQ.isError && (
        <div style={{ marginBlockEnd: token.margin }}>
          <SeitenFehler
            text="Stand nicht aktuell: neu laden gescheitert"
            ursache={listeQ.error}
            onWiederholen={() => void listeQ.refetch()}
            laedt={listeQ.isFetching}
          />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <BearbeitbaresPaneel<ZugangWerte, AnbindungPatch>
          key={zugang.id}
          titel="Zugang"
          datensatz={zugang}
          werte={werteVon(zugang)}
          felder={felder}
          patch={zugangPatch}
          onSpeichern={speichern}
          onNeuLaden={() => void listeQ.refetch()}
          darfSchreiben={istAdmin && !istWiderrufen}
          grund={!istAdmin ? NUR_ADMIN : istWiderrufen ? 'widerrufen' : undefined}
          modus="paneel"
          spalten={2}
        />
        <Paneel titel="Schlüssel">
          <Datenraster spalten={2} beschriftung="Schlüssel">
            <Datenfeld label="Fingerabdruck" mono>
              <span data-lfh="anbindung-fingerabdruck">
                {zugang.fingerabdruck ??
                  (istWiderrufen ? 'ohne Schlüssel' : 'Code noch nicht eingelöst')}
              </span>
            </Datenfeld>
            <Datenfeld label="Zuletzt genutzt">
              {zugang.zuletzt_genutzt_at ? zeit(zugang.zuletzt_genutzt_at) : 'noch nie'}
            </Datenfeld>
            {einsatz && (
              <Datenfeld label="Einsatz">
                <span data-lfh="anbindung-einsatz">{einsatz}</span>
              </Datenfeld>
            )}
            {zugang.fingerabdruck_neu && (
              <Datenfeld label="Neuer Schlüssel" breit>
                <span style={monoStil(13)}>{zugang.fingerabdruck_neu}</span>
                <span style={{ color: rollen.gedaempft }}>
                  {' · gilt ab der ersten Anfrage damit'}
                </span>
              </Datenfeld>
            )}
            <Datenfeld label="Diese Instanz" mono>
              {liste.instanz_fingerabdruck}
            </Datenfeld>
            <Datenfeld label="Angelegt">{zeit(zugang.angelegt_at)}</Datenfeld>
            {zugang.widerrufen_at && (
              <Datenfeld label="Widerrufen">
                {zeit(zugang.widerrufen_at)}
                {zugang.widerrufen_von_name ? ` von ${zugang.widerrufen_von_name}` : ''}
              </Datenfeld>
            )}
            {zugang.letzte_ablehnung && !istWiderrufen && (
              <Datenfeld label="Letzte Ablehnung" breit>
                <span data-lfh="anbindung-ablehnung" style={{ color: rollen.achtungText }}>
                  {`${ablehnungText(zugang.letzte_ablehnung)} · ${zeit(zugang.letzte_ablehnung.at)}`}
                </span>
              </Datenfeld>
            )}
          </Datenraster>
        </Paneel>
        <AnbindungWebhook
          zugang={zugang}
          darfSchreiben={istAdmin && !istWiderrufen && gesperrt == null}
          grund={
            !istAdmin
              ? NUR_ADMIN
              : istWiderrufen
                ? 'widerrufen'
                : gesperrt != null
                  ? 'am Hub anbinden'
                  : undefined
          }
          onNeuLaden={() => void listeQ.refetch()}
        />
      </div>

      <WiderrufDialog
        zugang={widerrufFuer}
        laeuft={widerrufen.isPending}
        fehler={widerrufen.error}
        onWiderrufen={(z) => widerrufen.mutate(z)}
        onAbbrechen={() => setWiderrufFuer(null)}
      />
      <CodeDialog code={code} onFertig={() => setCode(null)} />
    </AdminPage>
  );
}
