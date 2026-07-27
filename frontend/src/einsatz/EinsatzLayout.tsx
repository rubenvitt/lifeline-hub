import { useEffect, useState } from 'react';
import { Layout, Space, Spin } from 'antd';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import {
  kategorien, modulRegistry, moduleNachKategorie, modulZielRoute,
  type KategorieKey, type ModulEintrag,
} from './modulRegistry';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';
import AlarmZentrale from './AlarmZentrale';
import ThemeToggle from '../components/ThemeToggle';
import BenutzerMenu from '../components/BenutzerMenu';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import LiveStatusBanner from '../live/LiveStatusBanner';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';

const { Header, Content } = Layout;

/** Ebene 2: Einsatz-Workspace mit Switcher-Header, Icon-Rail und Modul-Panel. */
export default function EinsatzLayout() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // EINE SSE-Verbindung für den gesamten Einsatz-Workspace (hier gehoistet, NICHT pro Page),
  // damit die Alarm-Zentrale seitenunabhängig auflöst und das HTTP/1.1-6-Verbindungslimit
  // sicher eingehalten wird (siehe useEinsatzLiveStream-Doku).
  useEinsatzLiveStream(einsatzId);

  // Die 401-Brücke (F14/LFH-263) saß bis LFH-268 hier und war damit einsatz-lokal: /admin,
  // /profil, Stammdaten und die Einsatzliste hatten gar keine Behandlung. Sie liegt jetzt als
  // `useSitzungsWache` in `App` und bedient SSE und HTTP über denselben Kanal.

  // Modul-Segment ist der Pfad-Teil direkt nach der Einsatz-ID
  // (…/einsaetze/:id/<route>/…) — nicht das letzte Segment, sonst verliert das
  // Menü auf Sub-Routen (Detail, Liste) die Hervorhebung.
  const aktuellesSegment = pathname.split('/').filter(Boolean)[2];
  const aktuellesModul = modulRegistry.find((m) => m.route === aktuellesSegment);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);

  // Panel an die aktuelle Modul-Kategorie angleichen (auch nach Default-Redirect, der kein Remount auslöst).
  useEffect(() => {
    setOffeneKategorie(aktiveKategorie);
  }, [aktiveKategorie]);

  const { data: einsatz, isLoading } = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  // Modul-Overrides (LFH-132) für die Nav-Reflexion; geteilter queryKey wie die
  // Einstellungen (Hot-Path, einmal gecacht je Einsatz).
  const { data: modulOverrides } = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });

  function onKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  function onModulKlick(modul: ModulEintrag) {
    navigate(`/einsaetze/${einsatzId}/${modulZielRoute(modul)}`);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {isLoading ? (
          <Spin />
        ) : (
          <EinsatzSwitcher aktuellName={einsatz?.bezeichnung ?? 'Einsatz'} />
        )}
        <Space style={{ marginLeft: 'auto' }} size="middle">
          <AlarmZentrale />
          <ThemeToggle />
          <BenutzerMenu />
        </Space>
      </Header>
      <LiveStatusBanner />
      <Layout hasSider>
        <IconRail
          kategorien={kategorien}
          aktiveKategorie={offeneKategorie ?? aktiveKategorie}
          onKategorieKlick={onKategorieKlick}
        />
        {offeneKategorie && (
          <ModulPanel
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            overrides={modulOverrides}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
          />
        )}
        <Content style={{ padding: 24 }}>
          <EinsatzAnzeigeProvider einsatzId={einsatzId}>
            <Outlet />
          </EinsatzAnzeigeProvider>
        </Content>
      </Layout>
    </Layout>
  );
}
