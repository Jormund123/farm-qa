import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { GeoJSON, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { Check, Download, Maximize2, Pencil, X } from "lucide-react";
import type { PlotFeature, PlotFeatureCollection, PlotProperties, PropValue } from "@/api/types";
import { Input } from "@/components/ui/input";
import { useFeatures, useReplaceFeatures, useRows } from "@/hooks";
import { useApp } from "@/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Status = "invalid" | "duplicate" | "valid";

/** Pastel accents from the design system — dark canvas, pastel data. */
const TONES: Record<Status | "selected", string> = {
  selected: "#C9B8F5",
  invalid: "#F2A6B6",
  duplicate: "#F5E38A",
  valid: "#B7E4B0",
};

const BASEMAPS = {
  dark: {
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Maxar, Earthstar Geographics",
  },
} as const;

const fidOf = (f: Feature | undefined) => Number(f?.properties?.fid);

const parseValue = (raw: string): PropValue =>
  raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;

const EARTH_RADIUS_M = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Live spherical area in hectares (Chamberlain–Duquette). Within ~0.3% of the
 * server's geodesic value — good enough for on-screen feedback while drawing;
 * the saved number always comes from the tested backend.
 */
function ringAreaHa(latlngs: L.LatLng[]): number {
  const n = latlngs.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % n];
    const p3 = latlngs[(i + 2) % n];
    total += (rad(p3.lng) - rad(p1.lng)) * Math.sin(rad(p2.lat));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2) / 10_000;
}

/** Asks for the new plot's attributes right after it is drawn (area is computed). */
function NewPlotForm({
  keys,
  nextFid,
  areaHa,
  onSubmit,
  onDiscard,
}: {
  keys: string[];
  nextFid: number;
  areaHa: number;
  onSubmit: (props: PlotProperties) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    fid: String(nextFid),
    ...Object.fromEntries(keys.map((k) => [k, ""])),
  }));

  return (
    <form
      className="mx-3 mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-raised px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseValue(v)])));
      }}
    >
      <span className="w-full text-sm font-medium sm:w-auto">
        New plot drawn{" "}
        <span className="font-normal text-muted-foreground">
          · ≈ {areaHa.toFixed(2)} ha (computed)
        </span>
      </span>
      {["fid", ...keys].map((k) => (
        <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
          {k === "fid" ? "Plot ID" : k}
          <Input
            value={draft[k]}
            required={k === "fid"}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            className="h-8 w-28 bg-chip px-3"
          />
        </label>
      ))}
      <div className="flex gap-1.5">
        <Button type="submit" variant="accent" size="sm">
          Add plot
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </form>
  );
}

/** GeoJSON properties are user data — escape before injecting into tooltip HTML. */
const esc = (v: PropValue | undefined) =>
  String(v ?? "—").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Below this zoom plots are too small to see — pins take over. */
const PIN_HIDE_ZOOM = 14;

/** Beyond this many features, per-plot pins become clutter (and DOM weight). */
const PIN_MAX_FEATURES = 150;

/**
 * Chip pins over each plot at low zoom, so far-apart or tiny plots stay
 * findable. Plots sharing a field stack their pins vertically — four chips
 * piled on one farm is the duplicate problem, visible from orbit.
 */
function PlotPins({
  fc,
  status,
}: {
  fc: FeatureCollection;
  status: (fid: number) => Status;
}) {
  const select = useApp((s) => s.select);
  const selectedFid = useApp((s) => s.selectedFid);
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const pins = useMemo(() => {
    if (fc.features.length > PIN_MAX_FEATURES) return [];
    const seen = new Map<string, number>();
    return fc.features.map((f) => {
      const fid = fidOf(f);
      const center = L.geoJSON(f).getBounds().getCenter();
      const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
      const stack = seen.get(key) ?? 0;
      seen.set(key, stack + 1);
      return { fid, center, stack };
    });
  }, [fc]);

  if (zoom >= PIN_HIDE_ZOOM || pins.length === 0) return null;

  return (
    <>
      {pins.map(({ fid, center, stack }) => (
        <Marker
          key={fid}
          position={center}
          eventHandlers={{ click: () => select(fid) }}
          icon={L.divIcon({
            className: "plot-pin-wrap",
            iconSize: [0, 0],
            html: `
              <span class="map-pin" style="transform:translate(-50%,calc(-100% - 10px - ${stack * 32}px))">
                <i class="map-pin-dot" style="background:${
                  fid === selectedFid ? TONES.selected : TONES[status(fid)]
                }"></i>Plot ${esc(fid)}
              </span>
              ${stack === 0 ? '<i class="map-pin-anchor"></i>' : ""}`,
          })}
        />
      ))}
    </>
  );
}

/** Flies to the selected plot; back to the full extent on deselect. */
function Camera({ fc, selectedFid }: { fc: FeatureCollection; selectedFid?: number }) {
  const map = useMap();
  useEffect(() => {
    const target =
      selectedFid != null ? fc.features.find((f) => fidOf(f) === selectedFid) : undefined;
    const bounds = L.geoJSON(target ?? fc).getBounds();
    if (!bounds.isValid()) return;
    map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 17, duration: 0.6 });
  }, [selectedFid]); // eslint-disable-line react-hooks/exhaustive-deps -- initial framing comes from MapContainer bounds
  return null;
}

/**
 * Watches geoman draw/edit interactions and reports the live spherical area
 * of the geometry being worked on — the operator's sanity check against the
 * farmer's declared hectares.
 */
function LiveArea({ active, onArea }: { active: boolean; onArea: (ha: number | null) => void }) {
  const map = useMap();
  const areaRef = useRef(onArea);
  areaRef.current = onArea;

  useEffect(() => {
    if (!active) {
      areaRef.current(null);
      return;
    }
    const bound: Array<[L.Evented, string, L.LeafletEventHandlerFn]> = [];
    const listen = (target: L.Evented, event: string, handler: L.LeafletEventHandlerFn) => {
      target.on(event, handler);
      bound.push([target, event, handler]);
    };

    const onDrawStart: L.LeafletEventHandlerFn = (e) => {
      const layer = (e as L.LeafletEvent & { workingLayer: L.Polyline }).workingLayer;
      listen(layer, "pm:vertexadded", () =>
        areaRef.current(ringAreaHa(layer.getLatLngs() as L.LatLng[]))
      );
    };
    listen(map, "pm:drawstart", onDrawStart);
    listen(map, "pm:drawend", () => areaRef.current(null));

    // Vertex drags on existing plots.
    map.eachLayer((l) => {
      if (!(l instanceof L.Polygon)) return;
      const report = () => areaRef.current(ringAreaHa((l.getLatLngs()[0] ?? []) as L.LatLng[]));
      listen(l, "pm:markerdrag", report);
      listen(l, "pm:edit", report);
    });

    return () => {
      bound.forEach(([target, event, handler]) => target.off(event, handler));
      areaRef.current(null);
    };
  }, [active, map]);
  return null;
}

/**
 * Freehand pencil: trace the boundary with the mouse; on release the trace is
 * simplified (Leaflet's built-in Douglas-Peucker) and closed into a polygon.
 * geoman-free has no freehand tool — this fills that gap without a new dep.
 */
function FreehandDraw({
  active,
  onDone,
  onTrace,
}: {
  active: boolean;
  onDone: (polygon: L.Polygon) => void;
  onTrace: (ha: number | null) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    map.dragging.disable();
    const container = map.getContainer();
    container.style.cursor = "crosshair";

    let points: L.LatLng[] = [];
    let preview: L.Polyline | null = null;
    let drawing = false;

    const down = (e: L.LeafletMouseEvent) => {
      drawing = true;
      points = [e.latlng];
      preview = L.polyline(points, { color: "#C9B8F5", weight: 2, dashArray: "5 5" }).addTo(map);
    };
    const move = (e: L.LeafletMouseEvent) => {
      if (!drawing) return;
      points.push(e.latlng);
      preview?.setLatLngs(points);
      onTrace(ringAreaHa(points));
    };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      preview?.remove();
      onTrace(null);
      if (points.length >= 4) {
        const projected = points.map((ll) => map.latLngToLayerPoint(ll));
        const simplified = L.LineUtil.simplify(projected, 3).map((p) =>
          map.layerPointToLatLng(p)
        );
        onDone(L.polygon(simplified));
      }
    };

    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      map.dragging.enable();
      container.style.cursor = "";
      onTrace(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are stable per session
  }, [active, map]);
  return null;
}

/** Mounts the geoman draw/edit/drag/remove toolbar while edit mode is on. */
function EditTools({
  active,
  drawn,
  onToggleFreehand,
  onCreated,
}: {
  active: boolean;
  drawn: React.MutableRefObject<L.Layer[]>;
  onToggleFreehand: () => void;
  onCreated: (layer: L.Layer) => void;
}) {
  const map = useMap();
  const toggleRef = useRef(onToggleFreehand);
  toggleRef.current = onToggleFreehand;
  const createdRef = useRef(onCreated);
  createdRef.current = onCreated;

  useEffect(() => {
    if (!active) return;
    const onCreate = (e: { layer: L.Layer }) => {
      drawn.current.push(e.layer);
      createdRef.current(e.layer);
    };
    map.on("pm:create", onCreate as L.LeafletEventHandlerFn);
    map.pm.addControls({
      position: "topleft",
      drawPolygon: true,
      drawRectangle: true,
      editMode: true,
      dragMode: true,
      removalMode: true,
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });

    // Freehand lives in the same toolbar as the other tools (created once).
    const anyMap = map as L.Map & { _freehandAdded?: boolean };
    if (!anyMap._freehandAdded) {
      anyMap._freehandAdded = true;
      map.pm.Toolbar.createCustomControl({
        name: "Freehand",
        block: "draw",
        title: "Freehand draw",
        className: "leaflet-pm-icon-freehand",
        toggle: true,
        afterClick: () => toggleRef.current(),
      });
    }

    return () => {
      // geoman can throw during teardown if layers were already unmounted —
      // guard each step separately so one failure never leaves the toolbar
      // behind or takes down the React tree.
      const safely = (fn: () => void) => {
        try {
          fn();
        } catch {
          /* already torn down */
        }
      };
      map.off("pm:create", onCreate as L.LeafletEventHandlerFn);
      safely(() => map.pm.removeControls());
      safely(() => map.pm.disableDraw());
      safely(() => map.pm.disableGlobalEditMode());
      safely(() => map.pm.disableGlobalDragMode());
      safely(() => map.pm.disableGlobalRemovalMode());
    };
  }, [active, map, drawn]);
  return null;
}

export function MapView() {
  const { data: fc } = useFeatures();
  const { data: rows } = useRows();
  const selectedFid = useApp((s) => s.selectedFid);
  const select = useApp((s) => s.select);
  const replace = useReplaceFeatures();
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>("dark");
  const [map, setMap] = useState<L.Map | null>(null);
  const [editing, setEditing] = useState(false);
  const [freehand, setFreehand] = useState(false);
  const [session, setSession] = useState(0); // bump to discard client-side edits
  const [pendingDraw, setPendingDraw] = useState<L.Polygon | null>(null);
  const [liveHa, setLiveHa] = useState<number | null>(null);
  const drawnRef = useRef<L.Layer[]>([]);
  const basemapBeforeEdit = useRef<keyof typeof BASEMAPS>("dark");

  // Initial framing must be synchronous — an animated fly on a freshly
  // mounted map can be dropped, stranding the camera at the fallback view.
  const bounds = useMemo(
    () => (fc?.features.length ? L.geoJSON(fc).getBounds() : null),
    [fc]
  );

  // Attribute keys of the dataset (minus fid) — the new-plot form asks for these.
  const propKeys = useMemo(
    () => (rows?.length ? Object.keys(rows[0].properties).filter((k) => k !== "fid") : []),
    [rows]
  );

  // fid → status / area, derived from the same tested QA flags the table uses.
  const byFid = useMemo(() => {
    const m = new Map<number, { status: Status; area: number }>();
    rows?.forEach((r) =>
      m.set(Number(r.properties.fid), {
        status: !r.valid ? "invalid" : r.duplicate ? "duplicate" : "valid",
        area: r.area_ha,
      })
    );
    return m;
  }, [rows]);

  if (!fc || !rows || !bounds)
    return <Skeleton className="h-[480px] w-full rounded-[1.75rem]" />;

  const style = (feature?: Feature): L.PathOptions => {
    const fid = fidOf(feature);
    const tone = fid === selectedFid ? TONES.selected : TONES[byFid.get(fid)?.status ?? "valid"];
    return {
      color: tone,
      weight: fid === selectedFid ? 3 : 2,
      fillColor: tone,
      fillOpacity: fid === selectedFid ? 0.5 : 0.25,
    };
  };

  const onEachFeature = (feature: Feature, layer: L.Layer) => {
    const fid = fidOf(feature);
    const info = byFid.get(fid);
    const props = feature.properties ?? {};
    const status = info?.status ?? "valid";
    const extras = Object.entries(props)
      .filter(([k]) => k !== "fid")
      .map(([k, v]) => `${esc(k)} ${esc(v)}`)
      .join(" · ");
    layer.bindTooltip(
      `<div class="plot-tip-title">Plot ${esc(fid)} · ${info?.area.toFixed(2) ?? "?"} ha</div>
       <div class="plot-tip-sub">${extras}</div>
       <div class="plot-tip-sub">
         <span class="plot-tip-dot" style="background:${TONES[status]}"></span>${status}
       </div>`,
      { className: "plot-pill", sticky: true, direction: "top", offset: [0, -10] }
    );
    // Read selection from the store at click time — the layer mounts once and
    // is restyled in place, so a closure over selectedFid would go stale.
    // Bound in edit mode too: clicking a plot zooms to it either way.
    layer.on("click", () => {
      const current = useApp.getState().selectedFid;
      select(current === fid ? undefined : fid);
    });
  };

  const cleanupDrawn = () => {
    drawnRef.current.forEach((l) => {
      try {
        l.remove();
      } catch {
        /* already removed (e.g. via the eraser tool) */
      }
    });
    drawnRef.current = [];
  };

  const untoggleFreehandButton = () => {
    if (!map) return;
    try {
      // Runtime API present but missing from geoman's type defs.
      const toolbar = map.pm.Toolbar as typeof map.pm.Toolbar & {
        toggleButton(name: string, on: boolean): void;
      };
      toolbar.toggleButton("Freehand", false);
    } catch {
      /* toolbar not mounted */
    }
  };

  /** Collect every polygon on the map (edited originals + newly drawn) as a FC. */
  const collect = (): PlotFeatureCollection => {
    const features: PlotFeature[] = [];
    let nextFid = Math.max(0, ...[...byFid.keys()].filter(Number.isFinite));
    map?.eachLayer((l) => {
      if (!(l instanceof L.Polygon)) return;
      const gj = l.toGeoJSON();
      const original = (l as L.Polygon & { feature?: PlotFeature }).feature?.properties;
      features.push({ ...gj, properties: original ? { ...original } : { fid: ++nextFid } });
    });
    return { type: "FeatureCollection", features };
  };

  const saveEdits = () =>
    replace.mutate(collect(), {
      onSuccess: () => {
        cleanupDrawn();
        setSession((s) => s + 1);
        exitEditing();
      },
    });

  const cancelEdits = () => {
    cleanupDrawn();
    setSession((s) => s + 1); // remount the layer, discarding vertex edits
    exitEditing();
  };

  // Entering edit mode keeps the current camera and selection (no zoom jump)
  // and switches to satellite — boundaries are adjusted against imagery.
  const startEditing = () => {
    basemapBeforeEdit.current = basemap;
    setBasemap("satellite");
    setEditing(true);
  };

  const exitEditing = () => {
    setBasemap(basemapBeforeEdit.current);
    setEditing(false);
    setFreehand(false);
    setPendingDraw(null);
    setLiveHa(null);
  };

  const onDrawn = (layer: L.Layer) => {
    if (!(layer instanceof L.Polygon)) return;
    layer.setStyle({ color: TONES.selected, weight: 2, fillColor: TONES.selected, fillOpacity: 0.3 });
    setPendingDraw(layer);
  };

  const attachProps = (props: PlotProperties) => {
    if (!pendingDraw) return;
    const target = pendingDraw as L.Polygon & { feature?: PlotFeature };
    target.feature = {
      type: "Feature",
      geometry: pendingDraw.toGeoJSON().geometry,
      properties: props,
    };
    setPendingDraw(null);
  };

  const discardPending = () => {
    if (!pendingDraw) return;
    pendingDraw.remove();
    drawnRef.current = drawnRef.current.filter((l) => l !== pendingDraw);
    setPendingDraw(null);
  };

  const onFreehandDone = (polygon: L.Polygon) => {
    polygon.addTo(map as L.Map);
    drawnRef.current.push(polygon);
    onDrawn(polygon);
    setFreehand(false);
    untoggleFreehandButton();
  };

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "farm-plots.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    // `isolate` keeps Leaflet's internal z-indexes (up to 1000) inside this card.
    <div className="isolate rounded-[1.75rem] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-semibold tracking-tight">Field map</h2>
          <p className="text-sm text-muted-foreground">
            {editing
              ? "Draw, reshape, drag or delete plots — then save"
              : "Click a plot in the table to see it in the map."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!editing && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {(["valid", "duplicate", "invalid"] as Status[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: TONES[s] }} />
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 rounded-full bg-chip p-1">
            {(Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]).map((k) => (
              <button
                key={k}
                onClick={() => setBasemap(k)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                  basemap === k
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {BASEMAPS[k].label}
              </button>
            ))}
          </div>

          {editing ? (
            <>
              <Button variant="accent" size="sm" onClick={saveEdits} disabled={replace.isPending}>
                <Check className="size-3.5" />
                {replace.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEdits} disabled={replace.isPending}>
                <X className="size-3.5" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={startEditing}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={exportFile}>
                <Download className="size-3.5" />
                Export
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && pendingDraw && (
        <NewPlotForm
          key={drawnRef.current.length} // fresh form per drawn plot
          keys={propKeys}
          nextFid={Math.max(0, ...[...byFid.keys()].filter(Number.isFinite)) + drawnRef.current.length}
          areaHa={ringAreaHa((pendingDraw.getLatLngs()[0] ?? []) as L.LatLng[])}
          onSubmit={attachProps}
          onDiscard={discardPending}
        />
      )}

      <div className="relative">
        <button
          title="Zoom to fit all plots"
          aria-label="Zoom to fit all plots"
          onClick={() => {
            select(undefined);
            map?.flyToBounds(bounds, { padding: [56, 56], maxZoom: 17, duration: 0.6 });
          }}
          className="absolute right-3 top-3 z-[1000] flex size-10 items-center justify-center rounded-full border border-border bg-chip text-foreground transition-colors hover:bg-raised"
        >
          <Maximize2 className="size-4" />
        </button>

        {liveHa !== null && liveHa > 0 && (
          <span className="absolute bottom-4 left-3 z-[1000] rounded-full border border-border bg-chip px-3.5 py-1.5 text-sm font-medium tabular-nums">
            ≈ {liveHa.toFixed(2)} ha
          </span>
        )}

        <MapContainer
          ref={setMap}
          bounds={bounds}
          boundsOptions={{ padding: [56, 56], maxZoom: 17 }}
          scrollWheelZoom
          preferCanvas
          className="h-[460px] w-full rounded-[1.35rem]"
        >
          <TileLayer
            key={basemap}
            url={BASEMAPS[basemap].url}
            attribution={BASEMAPS[basemap].attribution}
          />
          {/* Selection restyles the mounted layer (react-leaflet re-applies the
              style prop) — remounting thousands of paths per click would jank. */}
          <GeoJSON
            key={`plots-${session}-${byFid.size}`}
            data={fc}
            style={style}
            onEachFeature={onEachFeature}
          />
          <PlotPins fc={fc} status={(fid) => byFid.get(fid)?.status ?? "valid"} />
          <EditTools
            active={editing}
            drawn={drawnRef}
            onToggleFreehand={() => setFreehand((f) => !f)}
            onCreated={onDrawn}
          />
          <FreehandDraw active={editing && freehand} onDone={onFreehandDone} onTrace={setLiveHa} />
          <LiveArea active={editing} onArea={setLiveHa} />
          <Camera fc={fc} selectedFid={selectedFid} />
        </MapContainer>
      </div>
    </div>
  );
}
