import React, { useEffect, useRef, useState } from 'react';
import {
  Castle,
  Compass,
  Eye,
  EyeOff,
  Grid,
  Home,
  Maximize2,
  Minimize2,
  Minus,
  Mountain,
  Plus,
  RotateCcw,
  Route,
  Shield,
  Skull,
  Trees,
  Truck,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { OVERWORLD_MAP_IMAGE } from '../data/easternForestData';
import type {
  LocationCategory,
  MapLocation,
  MapRoute,
  MazgalCell,
  ProtagonistState,
  TravelPace,
  TravelTransport,
  WeatherConditionKey,
} from '../types/map';

interface MapViewportProps {
  locations: MapLocation[];
  routes: MapRoute[];
  mazgalCells: MazgalCell[];
  selectedLocationId: string;
  selectedMazgalId: string | null;
  partyLocationId: string;
  protagonist?: ProtagonistState;
  activeWeatherKey?: WeatherConditionKey;
  fogOfWar: boolean;
  showRoutes: boolean;
  soundEnabled: boolean;
  isPlacingPin: boolean;
  resetKey?: number;
  onSelectLocation: (id: string) => void;
  onSelectMazgal: (id: string) => void;
  onPlacePinAt: (x: number, y: number) => void;
  onToggleFogOfWar: () => void;
  onToggleRoutes: () => void;
  onToggleSound: () => void;
  onChangeTravelMode?: (pace: TravelPace, transport: TravelTransport) => void;
  onWeatherChanged?: (weatherKey: WeatherConditionKey, label?: string) => void;
  onOpenInspector?: () => void;
  onOpenProtagonist?: () => void;
}

function getCategoryIcon(category: LocationCategory) {
  switch (category) {
    case 'village':
      return Home;
    case 'burrow':
      return Mountain;
    case 'ruin':
      return Castle;
    case 'nature':
      return Trees;
    case 'danger':
      return Skull;
    case 'crossing':
      return Compass;
  }
}

export const MapViewport: React.FC<MapViewportProps> = ({
  locations,
  routes,
  mazgalCells,
  selectedLocationId,
  selectedMazgalId,
  partyLocationId,
  protagonist,
  activeWeatherKey = 'mist',
  fogOfWar,
  showRoutes,
  soundEnabled,
  isPlacingPin,
  resetKey = 0,
  onSelectLocation,
  onSelectMazgal,
  onPlacePinAt,
  onToggleFogOfWar,
  onToggleRoutes,
  onToggleSound,
  onChangeTravelMode,
  onWeatherChanged,
  onOpenInspector,
  onOpenProtagonist,
}) => {
  const wrapperRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [didDrag, setDidDrag] = useState(false);
  const [mapImageError, setMapImageError] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (resetKey === 0) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setShowGrid(false);
  }, [resetKey]);

  const visibleLocations = fogOfWar
    ? locations.filter((loc) => loc.discovered)
    : locations;

  const visibleRoutes = routes.filter((rt) => {
    const from = locations.find((l) => l.id === rt.fromId);
    const to = locations.find((l) => l.id === rt.toId);
    if (!from || !to) return false;
    if (fogOfWar) return from.discovered && to.discovered;
    return true;
  });

  const clampPan = (nextX: number, nextY: number, targetZoom: number) => {
    const w = containerRef.current?.clientWidth || 900;
    const h = containerRef.current?.clientHeight || 502;
    const maxOffsetX = ((targetZoom - 1) * w) / 2;
    const maxOffsetY = ((targetZoom - 1) * h) / 2;
    return {
      x: Math.round(Math.max(-maxOffsetX, Math.min(maxOffsetX, nextX))),
      y: Math.round(Math.max(-maxOffsetY, Math.min(maxOffsetY, nextY))),
    };
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Math.min(3, Math.max(1, Number((prev + delta).toFixed(2))));
      if (next === 1) {
        setPan({ x: 0, y: 0 });
      } else {
        setPan((currentPan) => clampPan(currentPan.x, currentPan.y, next));
      }
      return next;
    });
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleToggleExpanded = async () => {
    const next = !isExpanded;
    setIsExpanded(next);
    try {
      if (next && wrapperRef.current?.requestFullscreen) {
        await wrapperRef.current.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // In-page expanded fallback handles environments where Fullscreen API is restricted
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button[data-pin="true"]')) return;
    setIsDragging(true);
    setDidDrag(false);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || zoom <= 1) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx - pan.x) > 3 || Math.abs(dy - pan.y) > 3) {
      setDidDrag(true);
    }
    setPan(clampPan(dx, dy, zoom));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (isPlacingPin && !didDrag && innerRef.current) {
      if ((e.target as HTMLElement).closest('button[data-pin="true"]')) return;
      const rect = innerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const clampedX = Math.max(4, Math.min(96, Number((relX * 100).toFixed(1))));
      const clampedY = Math.max(6, Math.min(94, Number((relY * 100).toFixed(1))));
      onPlacePinAt(clampedX, clampedY);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || zoom > 1) {
      e.preventDefault();
      handleZoom(e.deltaY < 0 ? 0.15 : -0.15);
    }
  };

  const partyLoc = locations.find((l) => l.id === partyLocationId);
  const selectedCell = selectedMazgalId
    ? mazgalCells.find((c) => c.id === selectedMazgalId)
    : undefined;
  const neighborById = new Map(
    (selectedCell?.neighbors ?? []).map((n) => [n.id, n])
  );

  return (
    <section
      ref={wrapperRef}
      aria-label="İnteraktif bölge haritası"
      className={
        isExpanded
          ? 'fixed inset-0 z-50 flex flex-col justify-between gap-2 bg-[#080E0C] p-3 sm:p-5 overflow-y-auto'
          : 'flex flex-col gap-3'
      }
    >
      {/* Workspace Map Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#D4A853]/15 bg-[#141F1B] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleFogOfWar}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              fogOfWar
                ? 'bg-[#D4A853] text-[#111916]'
                : 'bg-[#1D2B25] text-[#C8D0CB] hover:text-[#F3EBD8]'
            }`}
          >
            {fogOfWar ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {fogOfWar ? 'Keşif Sisi: Açık' : 'Keşif Sisi: Kapalı'}
          </button>

          <button
            type="button"
            onClick={onToggleRoutes}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showRoutes
                ? 'bg-[#1D2B25] text-[#D4A853] border border-[#D4A853]/30'
                : 'bg-[#1D2B25] text-[#8E9C95] hover:text-[#F3EBD8]'
            }`}
          >
            <Route className="h-3.5 w-3.5" />
            Rotalar
          </button>

          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showGrid
                ? 'bg-[#D4A853] text-[#111916] font-semibold'
                : 'bg-[#1D2B25] text-[#C8D0CB] hover:text-[#F3EBD8]'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            {showGrid ? 'Mazgal Sistemi: Açık' : 'Mazgal Sistemi'}
          </button>

          {onChangeTravelMode && protagonist && (
            <div className="flex flex-wrap items-center gap-1.5 border-l border-[#D4A853]/18 pl-2">
              <select
                aria-label="Yürüyüş temposu"
                value={protagonist.travelPace ?? 'normal'}
                onChange={(e) =>
                  onChangeTravelMode(
                    e.target.value as TravelPace,
                    protagonist.travelTransport ?? 'foot'
                  )
                }
                className="rounded-md border border-[#D4A853]/25 bg-[#101A16] px-2 py-1 text-xs text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none cursor-pointer"
              >
                <option value="stealth">Tempo: Gizli</option>
                <option value="normal">Tempo: Normal</option>
                <option value="forced">Tempo: Zorlu</option>
              </select>

              <select
                aria-label="Ulaşım aracı"
                value={protagonist.travelTransport ?? 'foot'}
                onChange={(e) =>
                  onChangeTravelMode(
                    protagonist.travelPace ?? 'normal',
                    e.target.value as TravelTransport
                  )
                }
                className="rounded-md border border-[#D4A853]/25 bg-[#101A16] px-2 py-1 text-xs text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none cursor-pointer"
              >
                <option value="foot">Yaya</option>
                <option value="mule">Katır / Araba</option>
                <option value="boat">Kayık / Tekne</option>
              </select>
            </div>
          )}

          {onWeatherChanged && (
            <select
              aria-label="Bölge hava durumu"
              value={activeWeatherKey}
              onChange={(e) => {
                const val = e.target.value as WeatherConditionKey;
                const names: Record<WeatherConditionKey, string> = {
                  clear: 'Açık / Soğuk Rüzgar',
                  mist: 'Yoğun Doğu Sisi',
                  rain: 'Soğuk Orman Yağmuru',
                  storm: 'Sert Vadi Fırtınası',
                };
                onWeatherChanged(val, names[val]);
              }}
              className="rounded-md border border-[#67C7C0]/25 bg-[#101A16] px-2 py-1 text-xs text-[#9CE3DD] focus:border-[#67C7C0] focus:outline-none cursor-pointer"
            >
              <option value="clear">Hava: Açık</option>
              <option value="mist">Hava: Yoğun Sis</option>
              <option value="rain">Hava: Yağmur</option>
              <option value="storm">Hava: Fırtına</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Sesi kapat' : 'Sesi aç'}
            title={soundEnabled ? 'Ses efektleri açık' : 'Ses efektleri kapalı'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1D2B25] text-[#C8D0CB] transition-colors hover:text-[#F3EBD8] cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <div className="mx-1 h-4 w-px bg-[#D4A853]/20" aria-hidden="true" />

          <button
            type="button"
            onClick={() => handleZoom(-0.25)}
            disabled={zoom <= 1}
            aria-label="Uzaklaştır"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1D2B25] text-[#C8D0CB] transition-colors hover:text-[#F3EBD8] disabled:opacity-40 cursor-pointer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs text-[#D6D0C2] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => handleZoom(0.25)}
            disabled={zoom >= 3}
            aria-label="Yakınlaştır"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1D2B25] text-[#C8D0CB] transition-colors hover:text-[#F3EBD8] disabled:opacity-40 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Görünümü sıfırla"
            title="Görünümü sıfırla"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1D2B25] text-[#C8D0CB] transition-colors hover:text-[#F3EBD8] cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          <div className="mx-1 h-4 w-px bg-[#D4A853]/20" aria-hidden="true" />

          <button
            type="button"
            onClick={handleToggleExpanded}
            aria-label={isExpanded ? 'Tam ekrandan çık' : 'Tam ekran harita'}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1D2B25] px-3 py-1.5 text-xs font-medium text-[#EDE6D6] transition-colors hover:bg-[#263830] whitespace-nowrap cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isExpanded ? 'Küçült' : 'Tam Ekran'}
          </button>
        </div>
      </div>

      {/* Placement Mode Banner */}
      {isPlacingPin && (
        <div className="flex items-center justify-between rounded-md border border-[#D4A853]/40 bg-[#1D2923] px-4 py-2 text-xs sm:text-sm text-[#F3EBD8]">
          <span>Yeni konum yerleştirmek için harita üzerinde istediğiniz noktaya tıklayın.</span>
          <span className="font-mono text-xs text-[#D4A853]">Yerleştirme Modu</span>
        </div>
      )}

      {/* Main Map Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setIsDragging(false)}
        onWheel={handleWheel}
        className={`map-crisp-container relative w-full aspect-[2752/1536] overflow-hidden rounded-lg border border-[#D4A853]/25 bg-[#0A110E] select-none ${
          isPlacingPin
            ? 'cursor-crosshair'
            : zoom > 1
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-default'
        }`}
      >
        <div
          ref={innerRef}
          className="relative"
          style={{
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            left: `calc(${(1 - zoom) * 50}% + ${pan.x}px)`,
            top: `calc(${(1 - zoom) * 50}% + ${pan.y}px)`,
          }}
        >
          {/* Base Hand-Painted JRPG Map Artwork */}
          {!mapImageError ? (
            <img
              src={OVERWORLD_MAP_IMAGE}
              alt="Kıtanın doğusundaki sisli Kadim Sis Ormanı bölgesi haritası"
              referrerPolicy="no-referrer"
              draggable={false}
              loading="eager"
              decoding="sync"
              onError={() => setMapImageError(true)}
              className="block h-full w-full object-fill contrast-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#13221C] via-[#0F1B17] to-[#1A2923] p-6 text-center">
              <Compass className="mb-3 h-10 w-10 text-[#D4A853]" />
              <p className="font-display text-lg text-[#F3EBD8]">Kadim Sis Ormanı — Doğu Yakası</p>
              <p className="mt-1 text-xs text-[#A3B1AA]">Harita katmanı yüklenemedi, etkileşimli işaretçiler aktif.</p>
            </div>
          )}

          {/* Interactive 16x9 Mazgal Grid Overlay (Hidden by default; shown on toggle) */}
          {showGrid && !isPlacingPin && (
            <div
              role="grid"
              aria-label="Mazgal ızgarası"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(16, minmax(0, 1fr))',
                gridTemplateRows: 'repeat(9, minmax(0, 1fr))',
              }}
              className="absolute inset-0 z-[5] h-full w-full"
            >
              {mazgalCells.map((cell) => {
                const isCellSelected = cell.id === selectedMazgalId;
                const adjacentMeta = neighborById.get(cell.id);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!didDrag) {
                        onSelectMazgal(cell.id);
                      }
                    }}
                    aria-label={`Mazgal ${cell.id} - ${cell.terrainLabel}`}
                    className={`group relative flex items-center justify-center border border-[#D4A853]/22 transition-colors duration-100 cursor-pointer focus-visible:outline-1 focus-visible:outline-[#D4A853] ${
                      isCellSelected
                        ? 'bg-[#D4A853]/25 ring-1 ring-inset ring-[#D4A853]'
                        : adjacentMeta
                        ? 'bg-[#67C7C0]/10 hover:bg-[#67C7C0]/24'
                        : 'hover:bg-[#D4A853]/15'
                    }`}
                  >
                    <span
                      className={`pointer-events-none flex flex-col items-center rounded bg-[#0D1512]/90 px-1.5 py-0.5 font-mono text-[9px] leading-tight text-[#F3EBD8] transition-opacity ${
                        isCellSelected
                          ? 'opacity-100 border border-[#D4A853]/60'
                          : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <span>{cell.id}</span>
                      {adjacentMeta && (
                        <span className="text-[8px] text-[#67C7C0] whitespace-nowrap">
                          {adjacentMeta.travelLabel}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* SVG Travel Routes */}
          {showRoutes && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {visibleRoutes.map((rt) => {
                const from = locations.find((l) => l.id === rt.fromId);
                const to = locations.find((l) => l.id === rt.toId);
                if (!from || !to) return null;
                const isConnectedToSelected =
                  from.id === selectedLocationId || to.id === selectedLocationId;
                return (
                  <line
                    key={rt.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={isConnectedToSelected ? '#E8C472' : '#D4A853'}
                    strokeOpacity={isConnectedToSelected ? 0.92 : 0.45}
                    strokeWidth={isConnectedToSelected ? 0.45 : 0.3}
                    strokeDasharray="1.1 0.8"
                  />
                );
              })}
            </svg>
          )}

          {/* Fog of War Mask */}
          {fogOfWar && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <defs>
                <radialGradient id="fogReveal">
                  <stop offset="0%" stopColor="black" stopOpacity="1" />
                  <stop offset="65%" stopColor="black" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="black" stopOpacity="0" />
                </radialGradient>
                <mask id="fogOfWarMask">
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  {visibleLocations.map((loc) => (
                    <circle key={loc.id} cx={loc.x} cy={loc.y} r="16" fill="url(#fogReveal)" />
                  ))}
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width="100"
                height="100"
                fill="#09110E"
                fillOpacity="0.82"
                mask="url(#fogOfWarMask)"
              />
            </svg>
          )}

          {/* Interactive Location Pins */}
          {visibleLocations.map((loc) => {
            const Icon = getCategoryIcon(loc.category);
            const isSelected = loc.id === selectedLocationId;
            const isPartyHere = loc.id === partyLocationId;
            const contactsHere = (protagonist?.contacts ?? []).filter(
              (c) => c.partyRelation === 'independent' && c.currentLocationId === loc.id
            );

            return (
              <button
                key={loc.id}
                type="button"
                data-pin="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLocation(loc.id);
                }}
                style={{
                  left: `${loc.x}%`,
                  top: `${loc.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                aria-label={`${loc.name} konumunu incele`}
                className={`group absolute flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4A853] hover:z-30 focus-visible:z-30 ${
                  isSelected ? 'z-20' : 'z-10'
                }`}
              >
                {isPartyHere && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-[#67C7C0] shadow-[0_0_10px_rgba(103,199,192,0.5)]"
                  />
                )}

                <span
                  className={`flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full border transition-transform duration-150 ${
                    isSelected
                      ? 'scale-115 border-[#FFF5DC] bg-[#D4A853] text-[#111916] shadow-lg'
                      : loc.discovered
                      ? 'border-[#D4A853]/85 bg-[#121D18]/92 text-[#F3EBD8] group-hover:scale-115 group-hover:border-[#F3EBD8]'
                      : 'border-[#7E9087]/75 bg-[#121D18]/85 text-[#9AA8A1] group-hover:scale-115'
                  }`}
                >
                  <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                </span>

                <span
                  className={`pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded px-2 py-1 text-[11px] font-medium leading-tight whitespace-nowrap shadow-md opacity-0 translate-y-0.5 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 ${
                    isSelected
                      ? 'bg-[#D4A853] text-[#111916] font-semibold'
                      : 'bg-[#0D1512]/92 text-[#EDE6D6] border border-[#D4A853]/40'
                  }`}
                >
                  {loc.name}
                  {isPartyHere ? ' · Sen Buradasın' : ''}
                  {contactsHere.length > 0 ? ` · ${contactsHere.map((c) => c.name).join(', ')}` : ''}
                </span>
              </button>
            );
          })}

          {/* Autonomous Roaming Caravans, Patrols & Raiders */}
          {(protagonist?.roamingUnits ?? []).map((unit) => {
            if (fogOfWar) {
              const targetLoc = locations.find((l) => l.id === unit.currentLocationId);
              if (targetLoc && !targetLoc.discovered && unit.mazgalId !== protagonist?.mazgalId) {
                return null;
              }
            }
            const UnitIcon =
              unit.kind === 'raider' ? Skull : unit.kind === 'caravan' ? Truck : Shield;
            const colorClass =
              unit.kind === 'raider'
                ? 'border-[#DC6B6B]/85 bg-[#2A1416]/95 text-[#F2B8B8]'
                : unit.kind === 'caravan'
                ? 'border-[#D4A853]/85 bg-[#241E12]/95 text-[#E8C472]'
                : 'border-[#67C7C0]/85 bg-[#122622]/95 text-[#9CE3DD]';

            // Offset slightly if currently parked at a settlement so it doesn't hide the town icon
            const atLoc = locations.some(
              (l) => Math.hypot(unit.x - l.x, unit.y - l.y) < 1.2
            );
            return (
              <button
                key={unit.id}
                type="button"
                data-pin="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectMazgal(unit.mazgalId);
                }}
                style={{
                  left: `${unit.x}%`,
                  top: `${unit.y}%`,
                  transform: atLoc ? 'translate(55%, -90%)' : 'translate(-50%, -50%)',
                }}
                aria-label={`${unit.name} · ${unit.statusNote}`}
                className="group absolute z-[18] flex items-center justify-center cursor-pointer hover:z-30"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border shadow-md transition-transform group-hover:scale-115 ${colorClass}`}
                >
                  <UnitIcon className="h-2.5 w-2.5" />
                </span>
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded border border-[#D4A853]/40 bg-[#0D1512]/95 px-2 py-1 text-[10px] leading-tight text-[#EDE6D6] whitespace-nowrap shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                  <strong className="block text-[#F8F3E6]">{unit.name}</strong>
                  <span className="text-[#9AA8A1]">{unit.statusNote}</span>
                </span>
              </button>
            );
          })}

          {/* Individual Protagonist Token (Visible even on open mazgal tiles!) */}
          {protagonist && (
            <button
              type="button"
              data-pin="true"
              onClick={(e) => {
                e.stopPropagation();
                onOpenProtagonist?.();
              }}
              style={{
                left: `${protagonist.x}%`,
                top: `${protagonist.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
              aria-label={`${protagonist.name} (Sen) konumunu aç`}
              className="group absolute z-30 flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#67C7C0]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-[#67C7C0] shadow-[0_0_12px_rgba(103,199,192,0.75)]"
              />
              {!protagonist.locationId && (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#F8F3E6] bg-[#132924] text-[#67C7C0] shadow-lg">
                  <User className="h-3.5 w-3.5" />
                </span>
              )}
              {protagonist.locationId && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#67C7C0] ring-2 ring-[#0D1512] translate-x-3 -translate-y-3" />
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded border border-[#67C7C0]/60 bg-[#0D1512]/95 px-2 py-1 text-[10px] font-semibold text-[#9CE3DD] whitespace-nowrap shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                {protagonist.name} (Sen) · Mazgal {protagonist.mazgalId}
              </span>
            </button>
          )}
        </div>

        {/* Cartographic Scale Bar (Hover-free compact scale reference) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-3 z-20 hidden sm:flex flex-col gap-1 rounded bg-[#0D1512]/82 px-2.5 py-1.5 border border-[#D4A853]/25"
        >
          <div className="flex items-center justify-between gap-4 font-mono text-[9px] text-[#D6D0C2] tabular-nums">
            <span>0</span>
            <span>18</span>
            <span>36 Fersah</span>
          </div>
          <div className="flex h-1 w-32 overflow-hidden rounded-xs border border-[#D4A853]/50">
            <span className="w-1/2 bg-[#D4A853]" />
            <span className="w-1/2 bg-[#141F1B]" />
          </div>
        </div>
      </div>

      {/* Compact Legend Strip under Map */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#9AA8A1]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{locations.filter((l) => l.discovered).length} / {locations.length} Konum Keşfedildi</span>
          <span aria-hidden="true">·</span>
          <span>
            Konumun:{' '}
            <strong className="font-medium text-[#EDE6D6]">
              {protagonist
                ? partyLoc?.name ?? `Açık Arazi (Mazgal ${protagonist.mazgalId})`
                : partyLoc?.name ?? 'Belirtilmedi'}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {onOpenProtagonist && !isExpanded && (
            <button
              type="button"
              onClick={onOpenProtagonist}
              className="font-medium text-[#67C7C0] hover:text-[#9CE3DD] cursor-pointer"
            >
              Karakterim ({protagonist?.name ?? 'Sen'})
            </button>
          )}
          {onOpenInspector && !isExpanded && (
            <button
              type="button"
              onClick={onOpenInspector}
              className="font-medium text-[#D4A853] hover:text-[#E5BD6E] cursor-pointer"
            >
              Seçili Konum Detayını Aç
            </button>
          )}
          <span className="hidden md:inline">Yakınlaştırmak için tekerleği veya +/- tuşlarını kullanın</span>
        </div>
      </div>
    </section>
  );
};
