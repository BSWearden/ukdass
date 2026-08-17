'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Polygon as LeafletPolygon } from 'leaflet';
import { createClient } from '../lib/supabase/client';

type Status = 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED';

type Area = {
  id?: string;
  code: string;
  name: string;
  declaredStatus: Status;
  status: Status;
  statusUpdatedAt: string | null;
  statusValidUntil: string | null;
  operationalPeriodPhase?: 'CURRENT' | 'UPCOMING' | null;
  operationalPeriodStartsAt?: string | null;
  operationalPeriodEndsAt?: string | null;
  operationalPeriodReference?: string | null;
  operationalPeriodSource?: string | null;
  period: string;
  limits: string;
  authority: string;
  airspace: string;
  color: string;
  coords: [number, number][];
};

type DbArea = {
  id: string;
  code: string;
  name: string;
  lower_limit: string;
  upper_limit: string;
  promulgated_period: string;
  authority: string;
  airspace_when_inactive: string;
  declared_status: Status;
  effective_status: Status;
  status_updated_at: string | null;
  status_valid_until: string | null;
  operational_period_phase: 'CURRENT' | 'UPCOMING' | null;
  operational_period_starts_at: string | null;
  operational_period_ends_at: string | null;
  operational_period_reference: string | null;
  operational_period_source: string | null;
};

const demonstrationAreas: Area[] = [
  {code:'DEMO D101',name:'North Wales Training Area',declaredStatus:'UNVERIFIED',status:'UNVERIFIED',statusUpdatedAt:null,statusValidUntil:null,period:'0800–2100Z',limits:'SFC – FL100',authority:'MOD DEMO',airspace:'Class G',color:'#ffba4a',coords:[[53.48,-4.65],[53.45,-4.08],[53.22,-3.92],[53.08,-4.25],[53.18,-4.72]]},
  {code:'DEMO D202',name:'Irish Sea Exercise Area',declaredStatus:'UNVERIFIED',status:'UNVERIFIED',statusUpdatedAt:null,statusValidUntil:null,period:'0900–2200Z',limits:'SFC – FL180',authority:'MOD DEMO',airspace:'Class G',color:'#ffba4a',coords:[[54.15,-4.80],[54.10,-4.05],[53.76,-3.95],[53.64,-4.53],[53.88,-4.92]]},
  {code:'DEMO D303',name:'Northern Training Area',declaredStatus:'UNVERIFIED',status:'UNVERIFIED',statusUpdatedAt:null,statusValidUntil:null,period:'0700–2000Z',limits:'SFC – 12,000 FT',authority:'MOD DEMO',airspace:'Class G',color:'#ffba4a',coords:[[55.55,-2.50],[55.50,-1.65],[55.13,-1.55],[55.00,-2.20],[55.22,-2.62]]},
  {code:'DEMO D404',name:'Southern Exercise Area',declaredStatus:'UNVERIFIED',status:'UNVERIFIED',statusUpdatedAt:null,statusValidUntil:null,period:'0830–1900Z',limits:'SFC – FL120',authority:'MOD DEMO',airspace:'Class G',color:'#ffba4a',coords:[[51.35,-2.35],[51.28,-1.62],[50.94,-1.55],[50.82,-2.05],[51.05,-2.48]]}
];

function effectiveStatus(declared: Status, validUntil: string | null): Status {
  if (!validUntil) return 'UNVERIFIED';
  if (new Date(validUntil).getTime() <= Date.now()) return 'UNVERIFIED';
  return declared;
}

function statusColor(status: Status) {
  if (status === 'ACTIVE') return '#ff5a64';
  if (status === 'INACTIVE') return '#4fd18b';
  return '#ffba4a';
}

function formatUtc(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC', day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(new Date(value)) + ' UTC';
}

function formatUtcTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(new Date(value)) + 'Z';
}

function mergeDatabaseArea(current: Area, row: DbArea): Area {
  const effective = row.effective_status;
  return {
    ...current,
    id: row.id,
    name: row.name,
    declaredStatus: row.declared_status,
    status: effective,
    statusUpdatedAt: row.status_updated_at,
    statusValidUntil: row.status_valid_until,
    operationalPeriodPhase: row.operational_period_phase,
    operationalPeriodStartsAt: row.operational_period_starts_at,
    operationalPeriodEndsAt: row.operational_period_ends_at,
    operationalPeriodReference: row.operational_period_reference,
    operationalPeriodSource: row.operational_period_source,
    period: row.promulgated_period,
    limits: `${row.lower_limit} – ${row.upper_limit}`,
    authority: row.authority,
    airspace: row.airspace_when_inactive,
    color: statusColor(effective)
  };
}

export default function Home() {
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Map<string, LeafletPolygon>>(new Map());
  const [areas, setAreas] = useState<Area[]>(demonstrationAreas);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'CONNECTING'|'LIVE'|'DEGRADED'>('CONNECTING');

  const selected = useMemo(() => areas.find(a => a.code === selectedCode) ?? null, [areas, selectedCode]);
  const statusClass = useMemo(() => selected ? selected.status.toLowerCase() : '', [selected]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadStatuses() {
      const { data, error } = await supabase.rpc('get_public_operational_picture');

      if (!active) return;
      if (error || !data) {
        console.error('Unable to load DASS status data', error);
        setConnectionState('DEGRADED');
        return;
      }

      const rows = data as DbArea[];
      setAreas(current => current.map(area => {
        const row = rows.find(item => item.code === area.code);
        return row ? mergeDatabaseArea(area, row) : area;
      }));
      setConnectionState('LIVE');
    }

    loadStatuses();

    const channel = supabase
      .channel('public-danger-area-status')
      .on('postgres_changes', {event:'UPDATE',schema:'public',table:'danger_areas'}, () => {
        void loadStatuses();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setConnectionState('LIVE');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionState('DEGRADED');
      });

    const refreshTimer = window.setInterval(() => {
      void loadStatuses();
    }, 60000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAreas(current => current.map(area => {
        const effective = effectiveStatus(area.declaredStatus, area.statusValidUntil);
        if (effective === area.status) return area;
        return {...area, status: effective, color: statusColor(effective)};
      }));
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || mapRef.current) return;

      const map = L.map('map', {zoomControl:false,attributionControl:true}).setView([54.05,-2.7],6);
      mapRef.current = map;
      L.control.zoom({position:'bottomleft'}).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:12, attribution:'&copy; OpenStreetMap contributors'
      }).addTo(map);

      map.on('click', () => {
        setSelectedCode(null);
        layersRef.current.forEach(layer => layer.setStyle({weight:2}));
      });

      demonstrationAreas.forEach(area => {
        const layer = L.polygon(area.coords, {
          color:area.color,weight:2,fillColor:area.color,fillOpacity:.19,dashArray:'7 6'
        }).addTo(map);

        layer.bindTooltip(area.code, {sticky:true,className:'dass-label',direction:'top'});
        layer.on('click', event => {
          L.DomEvent.stopPropagation(event);
          layersRef.current.forEach(item => item.setStyle({weight:2}));
          layer.setStyle({weight:4});
          layer.bringToFront();
          setSelectedCode(area.code);
        });
        layersRef.current.set(area.code, layer);
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    areas.forEach(area => {
      const layer = layersRef.current.get(area.code);
      if (!layer) return;
      layer.setStyle({
        color:statusColor(area.status),
        fillColor:statusColor(area.status),
        fillOpacity:area.status === 'ACTIVE' ? .28 : .19,
        dashArray:area.status === 'UNVERIFIED' ? '7 6' : undefined
      });
    });
  }, [areas]);

  const closePanel = () => {
    setSelectedCode(null);
    layersRef.current.forEach(layer => layer.setStyle({weight:2}));
  };

  const connectionText =
    connectionState === 'LIVE' ? 'Live Supabase status' :
    connectionState === 'DEGRADED' ? 'Status connection degraded' :
    'Connecting to status feed';

  return (
    <div className="app">
      <div className="demo-banner">DASS ALPHA 0.8.0 · DEMONSTRATION ONLY · NOT FOR OPERATIONAL USE OR FLIGHT PLANNING</div>

      <header>
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div><strong>DASS</strong><span>UK Dynamic Airspace Status System</span></div>
        </div>
        <nav>
          <button className="navbtn active">Live Map</button>
          <button className="navbtn hide-sm">Information</button>
          <a className="navbtn operator" href="/operator/login">Operator Login</a>
        </nav>
      </header>

      <main className={`workspace ${selected ? 'has-selection' : ''}`}>
        <section className="mapwrap">
          <div id="map" className="map" />
          <div className="map-overlay">
            <div className="status-card">
              <div className="eyebrow">Demonstration network</div>
              <div className="status-row">
                <span className="pulse" />
                <strong>{areas.length} areas reporting</strong>
                <span className="sep">·</span>
                <span className="muted">{connectionText}</span>
              </div>
            </div>
            <div className="legend">
              <div className="legend-item"><span className="swatch red" />Active</div>
              <div className="legend-item"><span className="swatch green" />Inactive</div>
              <div className="legend-item"><span className="swatch amber" />Unverified</div>
              <div className="legend-item"><span className="swatch grey" />No data</div>
            </div>
          </div>
        </section>

        <aside className={selected ? 'mobile-open' : ''} onClick={e => e.stopPropagation()}>
          <div className="side-title">
            <div>
              <div className="eyebrow">Airspace information</div>
              <h2>{selected ? 'Selected area' : 'Select an area'}</h2>
            </div>
            <div className="side-actions">
              <div className="tag">ALPHA</div>
              {selected && <button className="close-panel" onClick={closePanel} aria-label="Close airspace information">×</button>}
            </div>
          </div>

          {!selected ? (
            <div className="empty">
              <div className="radar" />
              <p>Select a demonstration Danger Area to inspect its promulgated information and current DASS-reported status.</p>
            </div>
          ) : (
            <div className="details show">
              <div className="area-code">{selected.code}</div>
              <div className="area-name">{selected.name}</div>

              <div className="live">
                <div className="live-top">
                  <div className="live-label">Effective DASS status</div>
                  <div className={`badge ${statusClass}`}>{selected.status}</div>
                </div>
                <div className="time">{formatUtcTime(selected.statusUpdatedAt)}</div>
                <div className="small">
                  {selected.status === 'UNVERIFIED'
                    ? selected.statusValidUntil
                      ? `Previous ${selected.declaredStatus} declaration expired ${formatUtc(selected.statusValidUntil)}`
                      : 'No currently valid operator declaration'
                    : `Declared ${selected.declaredStatus} · valid until ${formatUtc(selected.statusValidUntil)}`}
                </div>
              </div>

              <div className="data-grid">
                <div className="data">
                  <span>Operational period</span>
                  <strong>{selected.operationalPeriodPhase ?? 'NONE SCHEDULED'}</strong>
                </div>
                <div className="data">
                  <span>Period window</span>
                  <strong>
                    {selected.operationalPeriodStartsAt && selected.operationalPeriodEndsAt
                      ? `${formatUtc(selected.operationalPeriodStartsAt)} – ${formatUtc(selected.operationalPeriodEndsAt)}`
                      : '—'}
                  </strong>
                </div>
                <div className="data"><span>Promulgated activity</span><strong>{selected.period}</strong></div>
                <div className="data"><span>Vertical limits</span><strong>{selected.limits}</strong></div>
                <div className="data"><span>Last declaration</span><strong>{selected.declaredStatus}</strong></div>
                <div className="data"><span>Validity deadline</span><strong>{selected.statusValidUntil ? formatUtcTime(selected.statusValidUntil) : 'NONE'}</strong></div>
              </div>

              <div className="notice">
                <strong>Validity protection active.</strong> ACTIVE or INACTIVE is displayed only while an authorised operator declaration remains within its validity period. Missing or expired declarations are shown as UNVERIFIED. DASS does not cancel or amend the associated NOTAM.
              </div>

              <div className="source">
                Status source: live DASS Alpha database
                {selected.operationalPeriodSource ? ` · Period source: ${selected.operationalPeriodSource}` : ''}
                {selected.operationalPeriodReference ? ` · Reference: ${selected.operationalPeriodReference}` : ''}
                {' · '}Geometry remains illustrative demonstration data and does not represent authoritative UK airspace boundaries.
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
