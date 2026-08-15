'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Polygon as LeafletPolygon } from 'leaflet';

type Area = {
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED';
  time: string;
  meta: string;
  period: string;
  limits: string;
  authority: string;
  airspace: string;
  color: string;
  coords: [number, number][];
};

const areas: Area[] = [
  {code:'DEMO D101',name:'North Wales Training Area',status:'INACTIVE',time:'18:42:11Z',meta:'Activity reported complete · 15 AUG 2026',period:'0800–2100Z',limits:'SFC – FL100',authority:'MOD DEMO',airspace:'Class G',color:'#4fd18b',coords:[[53.48,-4.65],[53.45,-4.08],[53.22,-3.92],[53.08,-4.25],[53.18,-4.72]]},
  {code:'DEMO D202',name:'Irish Sea Exercise Area',status:'ACTIVE',time:'19:06:32Z',meta:'Confirmed active · 15 AUG 2026',period:'0900–2200Z',limits:'SFC – FL180',authority:'MOD DEMO',airspace:'Segregated',color:'#ff5a64',coords:[[54.15,-4.80],[54.10,-4.05],[53.76,-3.95],[53.64,-4.53],[53.88,-4.92]]},
  {code:'DEMO D303',name:'Northern Training Area',status:'UNVERIFIED',time:'17:28:03Z',meta:'Verification overdue · 15 AUG 2026',period:'0700–2000Z',limits:'SFC – 12,000 FT',authority:'MOD DEMO',airspace:'Status unknown',color:'#ffba4a',coords:[[55.55,-2.50],[55.50,-1.65],[55.13,-1.55],[55.00,-2.20],[55.22,-2.62]]},
  {code:'DEMO D404',name:'Southern Exercise Area',status:'INACTIVE',time:'18:55:48Z',meta:'Activity reported complete · 15 AUG 2026',period:'0830–1900Z',limits:'SFC – FL120',authority:'MOD DEMO',airspace:'Class G',color:'#4fd18b',coords:[[51.35,-2.35],[51.28,-1.62],[50.94,-1.55],[50.82,-2.05],[51.05,-2.48]]}
];

export default function Home() {
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LeafletPolygon[]>([]);
  const [selected, setSelected] = useState<Area | null>(null);

  const statusClass = useMemo(() => selected ? selected.status.toLowerCase() : '', [selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || mapRef.current) return;
      const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([54.05, -2.7], 6);
      mapRef.current = map;
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      layersRef.current = areas.map((a) => {
        const layer = L.polygon(a.coords, {
          color: a.color,
          weight: 2,
          fillColor: a.color,
          fillOpacity: a.status === 'ACTIVE' ? 0.28 : 0.19,
          dashArray: a.status === 'UNVERIFIED' ? '7 6' : undefined
        }).addTo(map);
        layer.bindTooltip(a.code, { sticky: true, className: 'dass-label', direction: 'top' });
        layer.on('click', () => {
          layersRef.current.forEach((l) => l.setStyle({ weight: 2 }));
          layer.setStyle({ weight: 4 });
          layer.bringToFront();
          setSelected(a);
        });
        return layer;
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = [];
    };
  }, []);

  return (
    <div className="app">
      <div className="demo-banner">DASS ALPHA 0.1 · DEMONSTRATION ONLY · NOT FOR OPERATIONAL USE OR FLIGHT PLANNING</div>
      <header>
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div><strong>DASS</strong><span>UK Dynamic Airspace Status System</span></div>
        </div>
        <nav>
          <button className="navbtn active">Live Map</button>
          <button className="navbtn hide-sm">Information</button>
          <button className="navbtn operator">Operator Login</button>
        </nav>
      </header>

      <main className="workspace">
        <section className="mapwrap">
          <div id="map" className="map" />
          <div className="map-overlay">
            <div className="status-card">
              <div className="eyebrow">Demonstration network</div>
              <div className="status-row"><span className="pulse" /><strong>4 areas reporting</strong><span className="sep">·</span><span className="muted">Updated live</span></div>
            </div>
            <div className="legend">
              <div className="legend-item"><span className="swatch red" />Active</div>
              <div className="legend-item"><span className="swatch green" />Inactive</div>
              <div className="legend-item"><span className="swatch amber" />Unverified</div>
              <div className="legend-item"><span className="swatch grey" />No data</div>
            </div>
          </div>
        </section>

        <aside>
          <div className="side-title"><div><div className="eyebrow">Airspace information</div><h2>{selected ? 'Selected area' : 'Select an area'}</h2></div><div className="tag">ALPHA</div></div>
          {!selected ? (
            <div className="empty"><div className="radar" /><p>Select a demonstration Danger Area on the map to inspect its promulgated information and reported DASS operational status.</p></div>
          ) : (
            <div className="details show">
              <div className="area-code">{selected.code}</div>
              <div className="area-name">{selected.name}</div>
              <div className="live">
                <div className="live-top"><div className="live-label">Reported operational status</div><div className={`badge ${statusClass}`}>{selected.status}</div></div>
                <div className="time">{selected.time}</div>
                <div className="small">{selected.meta}</div>
              </div>
              <div className="data-grid">
                <div className="data"><span>Promulgated period</span><strong>{selected.period}</strong></div>
                <div className="data"><span>Vertical limits</span><strong>{selected.limits}</strong></div>
                <div className="data"><span>Authority</span><strong>{selected.authority}</strong></div>
                <div className="data"><span>Airspace</span><strong>{selected.airspace}</strong></div>
              </div>
              <div className="notice"><strong>Demonstration data.</strong> DASS Alpha does not supersede the UK AIP, NOTAM, ATC instructions or established Danger Area crossing procedures.</div>
              <div className="source">Status source: DASS demonstration dataset · Geometry is illustrative and deliberately does not represent authoritative UK airspace boundaries.</div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
