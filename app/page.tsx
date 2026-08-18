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
  hasLiveNotam: boolean;
  hasPublishedNotam: boolean;
  notamNumber: string | null;
  notamValidFrom: string | null;
  notamValidUntil: string | null;
  notamPhase: string;
  notamFeedState: string;
  visibilityReason: string;
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
  geometry: [number, number][];
  declared_status: Status;
  effective_status: Status;
  status_updated_at: string | null;
  status_valid_until: string | null;
  operational_period_phase: 'CURRENT' | 'UPCOMING' | null;
  operational_period_starts_at: string | null;
  operational_period_ends_at: string | null;
  operational_period_reference: string | null;
  operational_period_source: string | null;
  has_live_notam: boolean;
  has_published_notam: boolean;
  notam_number: string | null;
  notam_valid_from: string | null;
  notam_valid_until: string | null;
  notam_phase: string;
  notam_feed_state: string;
  visibility_reason: string;
};

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

function pointOnSegment(point:[number,number],a:[number,number],b:[number,number]){
  const [py,px]=point,[ay,ax]=a,[by,bx]=b;
  const cross=(px-ax)*(by-ay)-(py-ay)*(bx-ax);
  if(Math.abs(cross)>1e-8)return false;
  return px>=Math.min(ax,bx)-1e-8&&px<=Math.max(ax,bx)+1e-8&&py>=Math.min(ay,by)-1e-8&&py<=Math.max(ay,by)+1e-8;
}

function containsPoint(point:[number,number],polygon:[number,number][]){
  if(polygon.length<3)return false;
  const [py,px]=point;let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i];
    if(pointOnSegment(point,a,b))return true;
    const [ay,ax]=a,[by,bx]=b;
    if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
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

function databaseArea(row: DbArea): Area {
  const effective = row.effective_status;
  return {
    id: row.id,
    code: row.code,
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
    color: statusColor(effective),
    coords: row.geometry,
    hasLiveNotam: row.has_live_notam,
    hasPublishedNotam: row.has_published_notam,
    notamNumber: row.notam_number,
    notamValidFrom: row.notam_valid_from,
    notamValidUntil: row.notam_valid_until,
    notamPhase: row.notam_phase,
    notamFeedState: row.notam_feed_state,
    visibilityReason: row.visibility_reason
  };
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Map<string, LeafletPolygon>>(new Map());
  const areasRef = useRef<Area[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [overlapCodes,setOverlapCodes]=useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<'CONNECTING'|'LIVE'|'DEGRADED'>('CONNECTING');

  const selected = useMemo(() => areas.find(a => a.code === selectedCode) ?? null, [areas, selectedCode]);
  const overlapAreas=useMemo(()=>overlapCodes.map(code=>areas.find(area=>area.code===code)).filter((area):area is Area=>Boolean(area)),[areas,overlapCodes]);
  const statusClass = useMemo(() => selected ? selected.status.toLowerCase() : '', [selected]);

  useEffect(() => {
    areasRef.current=areas;
  },[areas]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadStatuses() {
      const { data, error } = await supabase.rpc('get_public_operational_picture_v4');

      if (!active) return;
      if (error || !data) {
        console.error('Unable to load DASS status data', error);
        setConnectionState('DEGRADED');
        return;
      }

      const rows = data as DbArea[];
      setAreas(rows.map(databaseArea));
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
      const container = mapContainerRef.current;
      if (cancelled || mapRef.current || !container) return;

      const map = L.map(container, {zoomControl:false,attributionControl:true}).setView([54.05,-2.7],6);
      mapRef.current = map;
      L.control.zoom({position:'bottomleft'}).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:12, attribution:'&copy; OpenStreetMap contributors'
      }).addTo(map);

      map.on('click', event => {
        const hits=areasRef.current.filter(area=>containsPoint([event.latlng.lat,event.latlng.lng],area.coords)).sort((a,b)=>a.code.localeCompare(b.code));
        const codes=hits.map(area=>area.code);
        setOverlapCodes(codes);
        setSelectedCode(codes[0]??null);
      });

      let resizeFrame = 0;
      const resizeMap = () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => map.invalidateSize({animate:false,pan:false}));
      };
      const resizeObserver = new ResizeObserver(resizeMap);
      resizeObserver.observe(container);
      window.addEventListener('resize',resizeMap);
      window.addEventListener('orientationchange',resizeMap);
      window.visualViewport?.addEventListener('resize',resizeMap);
      resizeMap();

      map.once('unload',() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver.disconnect();
        window.removeEventListener('resize',resizeMap);
        window.removeEventListener('orientationchange',resizeMap);
        window.visualViewport?.removeEventListener('resize',resizeMap);
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
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      const map = mapRef.current;
      if (cancelled || !map) return;

      const currentCodes = new Set(areas.map(area => area.code));
      layersRef.current.forEach((layer, code) => {
        if (!currentCodes.has(code)) {
          layer.remove();
          layersRef.current.delete(code);
        }
      });

      areas.forEach(area => {
        let layer = layersRef.current.get(area.code);
        if (!layer) {
          layer = L.polygon(area.coords).addTo(map);
          layer.bindTooltip(area.code, {sticky:true,className:'dass-label',direction:'top'});
          layersRef.current.set(area.code, layer);
        } else {
          layer.setLatLngs(area.coords);
        }
        const overlap=overlapCodes.includes(area.code),isSelected=selectedCode===area.code;
        layer.setStyle({
          color:statusColor(area.status), weight:isSelected?5:overlap?3:2,
          fillColor:statusColor(area.status),
          fillOpacity:isSelected ? .38 : overlap ? .10 : area.status === 'ACTIVE' ? .28 : .19,
          dashArray:area.status === 'UNVERIFIED' ? '7 6' : undefined
        });
        if(isSelected)layer.bringToFront();
      });

      if (areas.length > 0 && map.getZoom() === 6) {
        const bounds = L.latLngBounds(areas.flatMap(area => area.coords));
        if (bounds.isValid()) map.fitBounds(bounds, {padding:[24,24],maxZoom:8});
      }
    })();

    return () => { cancelled = true; };
  }, [areas, selectedCode,overlapCodes]);

  const closePanel = () => {
    setSelectedCode(null);
    setOverlapCodes([]);
    layersRef.current.forEach(layer => layer.setStyle({weight:2}));
  };

  const connectionText =
    connectionState === 'LIVE' ? 'Live Supabase status' :
    connectionState === 'DEGRADED' ? 'Status connection degraded' :
    'Connecting to status feed';

  return (
    <div className="app">
      <div className="demo-banner">DASS ALPHA 0.9.0 · DEMONSTRATION ONLY · NOT FOR OPERATIONAL USE OR FLIGHT PLANNING</div>

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
          <div ref={mapContainerRef} id="map" className="map" />
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
              {overlapAreas.length>1&&<section aria-label="Overlapping airspace sectors" style={{marginBottom:'14px',border:'1px solid #385267',background:'#091720',borderRadius:'10px',padding:'11px'}}><div className="eyebrow">{overlapAreas.length} overlapping sectors at selected point</div><p style={{margin:'6px 0 9px',fontSize:'10px',lineHeight:1.45,color:'#91a6b8'}}>Select a sector to inspect and highlight it individually. All intersecting sectors remain listed.</p><div style={{display:'grid',gap:'6px'}}>{overlapAreas.map(area=><button key={area.code} type="button" aria-pressed={area.code===selectedCode} onClick={()=>setSelectedCode(area.code)} style={{display:'grid',gridTemplateColumns:'minmax(72px,.65fr) minmax(115px,1.35fr) auto',gap:'8px',alignItems:'center',textAlign:'left',border:area.code===selectedCode?'1px solid #8fdaf0':'1px solid #203746',background:area.code===selectedCode?'rgba(89,208,240,.12)':'#0b1722',color:'#edf5fb',borderRadius:'8px',padding:'9px'}}><strong style={{color:'#8fdaf0',fontSize:'11px'}}>{area.code}</strong><span style={{fontSize:'9px',color:'#b6c5cf'}}>{area.limits}</span><span style={{fontSize:'8px',fontWeight:900,color:statusColor(area.status)}}>{area.status}</span></button>)}</div></section>}
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
                <div className="data"><span>NOTAM assurance</span><strong>{selected.hasPublishedNotam ? `${selected.notamPhase} · ${selected.notamNumber ?? 'MATCHED'}` : 'NO PUBLISHED MATCH'}</strong></div>
                <div className="data"><span>NOTAM validity</span><strong>{selected.notamValidFrom&&selected.notamValidUntil?`${formatUtc(selected.notamValidFrom)} – ${formatUtc(selected.notamValidUntil)}`:'—'}</strong></div>
                <div className="data"><span>NOTAM feed</span><strong>{selected.notamFeedState}</strong></div>
              </div>

              <div className="notice">
                <strong>Validity protection active.</strong> ACTIVE or INACTIVE is displayed only while an authorised operator declaration remains within its validity period. Missing or expired declarations are shown as UNVERIFIED. DASS does not cancel or amend the associated NOTAM.
              </div>

              <div className="source">
                Status source: live DASS Alpha database · Visibility: {selected.visibilityReason}
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
