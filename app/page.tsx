'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Polygon as LeafletPolygon } from 'leaflet';
import { createClient } from '../lib/supabase/client';

type Status = 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED';

type Area = {
  id?: string;
  code: string;
  name: string;
  status: Status;
  statusUpdatedAt: string | null;
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
  current_status: Status;
  status_updated_at: string | null;
};

const demonstrationAreas: Area[] = [
  {
    code:'DEMO D101',
    name:'North Wales Training Area',
    status:'UNVERIFIED',
    statusUpdatedAt:null,
    period:'0800–2100Z',
    limits:'SFC – FL100',
    authority:'MOD DEMO',
    airspace:'Class G',
    color:'#ffba4a',
    coords:[[53.48,-4.65],[53.45,-4.08],[53.22,-3.92],[53.08,-4.25],[53.18,-4.72]]
  },
  {
    code:'DEMO D202',
    name:'Irish Sea Exercise Area',
    status:'UNVERIFIED',
    statusUpdatedAt:null,
    period:'0900–2200Z',
    limits:'SFC – FL180',
    authority:'MOD DEMO',
    airspace:'Class G',
    color:'#ffba4a',
    coords:[[54.15,-4.80],[54.10,-4.05],[53.76,-3.95],[53.64,-4.53],[53.88,-4.92]]
  },
  {
    code:'DEMO D303',
    name:'Northern Training Area',
    status:'UNVERIFIED',
    statusUpdatedAt:null,
    period:'0700–2000Z',
    limits:'SFC – 12,000 FT',
    authority:'MOD DEMO',
    airspace:'Class G',
    color:'#ffba4a',
    coords:[[55.55,-2.50],[55.50,-1.65],[55.13,-1.55],[55.00,-2.20],[55.22,-2.62]]
  },
  {
    code:'DEMO D404',
    name:'Southern Exercise Area',
    status:'UNVERIFIED',
    statusUpdatedAt:null,
    period:'0830–1900Z',
    limits:'SFC – FL120',
    authority:'MOD DEMO',
    airspace:'Class G',
    color:'#ffba4a',
    coords:[[51.35,-2.35],[51.28,-1.62],[50.94,-1.55],[50.82,-2.05],[51.05,-2.48]]
  }
];

function statusColor(status: Status) {
  if (status === 'ACTIVE') return '#ff5a64';
  if (status === 'INACTIVE') return '#4fd18b';
  return '#ffba4a';
}

function formatUtc(value: string | null) {
  if (!value) return 'No DASS status event recorded';

  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));

  return `${formatted} UTC`;
}

function formatUtcTime(value: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value)) + 'Z';
}

function mergeDatabaseArea(current: Area, row: DbArea): Area {
  return {
    ...current,
    id: row.id,
    name: row.name,
    status: row.current_status,
    statusUpdatedAt: row.status_updated_at,
    period: row.promulgated_period,
    limits: `${row.lower_limit} – ${row.upper_limit}`,
    authority: row.authority,
    airspace: row.airspace_when_inactive,
    color: statusColor(row.current_status)
  };
}

export default function Home() {
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Map<string, LeafletPolygon>>(new Map());
  const [areas, setAreas] = useState<Area[]>(demonstrationAreas);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'CONNECTING' | 'LIVE' | 'DEGRADED'>('CONNECTING');

  const selected = useMemo(
    () => areas.find((area) => area.code === selectedCode) ?? null,
    [areas, selectedCode]
  );

  const statusClass = useMemo(
    () => selected ? selected.status.toLowerCase() : '',
    [selected]
  );

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadStatuses() {
      const { data, error } = await supabase
        .from('danger_areas')
        .select(`
          id,
          code,
          name,
          lower_limit,
          upper_limit,
          promulgated_period,
          authority,
          airspace_when_inactive,
          current_status,
          status_updated_at
        `)
        .order('code');

      if (!active) return;

      if (error || !data) {
        console.error('Unable to load DASS status data', error);
        setConnectionState('DEGRADED');
        return;
      }

      const rows = data as DbArea[];
      setAreas((current) =>
        current.map((area) => {
          const row = rows.find((item) => item.code === area.code);
          return row ? mergeDatabaseArea(area, row) : area;
        })
      );
      setConnectionState('LIVE');
    }

    loadStatuses();

    const channel = supabase
      .channel('public-danger-area-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'danger_areas'
        },
        (payload) => {
          const row = payload.new as DbArea;
          if (!row?.code) return;

          setAreas((current) =>
            current.map((area) =>
              area.code === row.code ? mergeDatabaseArea(area, row) : area
            )
          );
          setConnectionState('LIVE');
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnectionState('LIVE');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionState('DEGRADED');
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      if (cancelled || mapRef.current) return;

      const map = L.map('map', {
        zoomControl: false,
        attributionControl: true
      }).setView([54.05, -2.7], 6);

      mapRef.current = map;

      L.control.zoom({ position: 'bottomleft' }).addTo(map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      map.on('click', () => {
        setSelectedCode(null);
        layersRef.current.forEach((layer) => layer.setStyle({ weight: 2 }));
      });

      demonstrationAreas.forEach((area) => {
        const layer = L.polygon(area.coords, {
          color: area.color,
          weight: 2,
          fillColor: area.color,
          fillOpacity: 0.19,
          dashArray: '7 6'
        }).addTo(map);

        layer.bindTooltip(area.code, {
          sticky: true,
          className: 'dass-label',
          direction: 'top'
        });

        layer.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          layersRef.current.forEach((item) => item.setStyle({ weight: 2 }));
          layer.setStyle({ weight: 4 });
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
    areas.forEach((area) => {
      const layer = layersRef.current.get(area.code);
      if (!layer) return;

      layer.setStyle({
        color: statusColor(area.status),
        fillColor: statusColor(area.status),
        fillOpacity: area.status === 'ACTIVE' ? 0.28 : 0.19,
        dashArray: area.status === 'UNVERIFIED' ? '7 6' : undefined
      });
    });
  }, [areas]);

  const closePanel = () => {
    setSelectedCode(null);
    layersRef.current.forEach((layer) => layer.setStyle({ weight: 2 }));
  };

  const connectionText =
    connectionState === 'LIVE'
      ? 'Live Supabase status'
      : connectionState === 'DEGRADED'
      ? 'Status connection degraded'
      : 'Connecting to status feed';

  return (
    <div className="app">
      <div className="demo-banner">
        DASS ALPHA 0.2.3 · DEMONSTRATION ONLY · NOT FOR OPERATIONAL USE OR FLIGHT PLANNING
      </div>

      <header>
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <strong>DASS</strong>
            <span>UK Dynamic Airspace Status System</span>
          </div>
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

        <aside className={selected ? 'mobile-open' : ''} onClick={(e) => e.stopPropagation()}>
          <div className="side-title">
            <div>
              <div className="eyebrow">Airspace information</div>
              <h2>{selected ? 'Selected area' : 'Select an area'}</h2>
            </div>

            <div className="side-actions">
              <div className="tag">ALPHA</div>
              {selected && (
                <button
                  className="close-panel"
                  onClick={closePanel}
                  aria-label="Close airspace information"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {!selected ? (
            <div className="empty">
              <div className="radar" />
              <p>
                Select a demonstration Danger Area on the map to inspect its promulgated
                information and current DASS-reported operational status.
              </p>
            </div>
          ) : (
            <div className="details show">
              <div className="area-code">{selected.code}</div>
              <div className="area-name">{selected.name}</div>

              <div className="live">
                <div className="live-top">
                  <div className="live-label">DASS reported status</div>
                  <div className={`badge ${statusClass}`}>{selected.status}</div>
                </div>

                <div className="time">{formatUtcTime(selected.statusUpdatedAt)}</div>
                <div className="small">
                  {selected.statusUpdatedAt
                    ? `Status reported ${formatUtc(selected.statusUpdatedAt)}`
                    : 'No operator status event has yet been recorded'}
                </div>
              </div>

              <div className="data-grid">
                <div className="data">
                  <span>Promulgated activity</span>
                  <strong>{selected.period}</strong>
                </div>
                <div className="data">
                  <span>Vertical limits</span>
                  <strong>{selected.limits}</strong>
                </div>
                <div className="data">
                  <span>Authority</span>
                  <strong>{selected.authority}</strong>
                </div>
                <div className="data">
                  <span>When reported inactive</span>
                  <strong>{selected.airspace}</strong>
                </div>
              </div>

              <div className="notice">
                <strong>Promulgated activity and DASS status are separate.</strong> A DASS
                status report does not cancel, amend or replace the associated NOTAM and
                does not supersede the UK AIP, ATC instructions or established Danger Area
                crossing procedures.
              </div>

              <div className="source">
                Status source: live DASS Alpha database · Geometry remains illustrative
                demonstration data and deliberately does not represent authoritative UK
                airspace boundaries.
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
