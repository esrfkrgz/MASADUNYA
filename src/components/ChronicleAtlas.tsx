import React, { useState } from 'react';
import { ArrowUpRight, Compass, MapPin } from 'lucide-react';
import { CATEGORY_LABELS } from '../data/easternForestData';
import type { JourneyLogEntry, LocationCategory, MapLocation } from '../types/map';

interface ChronicleAtlasProps {
  locations: MapLocation[];
  partyLocationId: string;
  fogOfWar: boolean;
  journeyLog: JourneyLogEntry[];
  onInspectOnMap: (id: string) => void;
}

const FILTER_OPTIONS: { id: 'all' | LocationCategory; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'village', label: 'Yerleşim' },
  { id: 'burrow', label: 'İlkel İn' },
  { id: 'ruin', label: 'Harabe' },
  { id: 'nature', label: 'Doğa Alanı' },
  { id: 'crossing', label: 'Geçit ve Yol' },
  { id: 'danger', label: 'Tehlike Bölgesi' },
];

export const ChronicleAtlas: React.FC<ChronicleAtlasProps> = ({
  locations,
  partyLocationId,
  fogOfWar,
  journeyLog,
  onInspectOnMap,
}) => {
  const [filter, setFilter] = useState<'all' | LocationCategory>('all');

  const visibleLocations = locations
    .filter((loc) => (!fogOfWar ? true : loc.discovered))
    .filter((loc) => (filter === 'all' ? true : loc.category === filter));

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#D4A853]/15 pb-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#F8F3E6] sm:text-3xl">
            Doğu Ormanı Konum Günlüğü
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A3B1AA]">
            Kıtanın doğusundaki Kadim Sis Ormanı\'nda yer alan yerleşimler, antik harabeler ve tehlikeli geçitlerin tam fihristi.
          </p>
        </div>

        {/* Interactive Filter Segmented Control */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#141F1B] p-1 border border-[#D4A853]/15">
          {FILTER_OPTIONS.map((opt) => {
            const active = filter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#D4A853] text-[#111916]'
                    : 'text-[#A3B1AA] hover:text-[#F3EBD8]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Location Cards Grid */}
        <div className="lg:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleLocations.length === 0 ? (
            <div className="col-span-full rounded-lg border border-[#D4A853]/15 bg-[#141F1B] p-8 text-center">
              <Compass className="mx-auto mb-2 h-7 w-7 text-[#D4A853]" />
              <p className="text-sm text-[#EDE6D6]">Bu kategoride henüz keşfedilmiş bir konum bulunmuyor.</p>
            </div>
          ) : (
            visibleLocations.map((loc) => {
              const isParty = loc.id === partyLocationId;
              return (
                <article
                  key={loc.id}
                  className="flex flex-col justify-between rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-5 transition-colors hover:border-[#D4A853]/45"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
                        {loc.name}
                      </h2>
                      <button
                        type="button"
                        onClick={() => onInspectOnMap(loc.id)}
                        aria-label={`${loc.name} konumunu haritada aç`}
                        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#D4A853] hover:bg-[#1E2E28] cursor-pointer"
                      >
                        Haritada Aç
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#9AA8A1] tabular-nums">
                      <span>{CATEGORY_LABELS[loc.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span>Tehlike {loc.dangerLevel}/5</span>
                      <span aria-hidden="true">·</span>
                      <span>{loc.discovered ? 'Keşfedildi' : 'Siste Gizli'}</span>
                      {loc.livingState?.enabled && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#D4A853]">{loc.livingState.mood}</span>
                        </>
                      )}
                      {isParty && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#67C7C0]">Grup Burada</span>
                        </>
                      )}
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-[#CFC8B9]">
                      {loc.playerLore}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#D4A853]/12 pt-3 text-xs text-[#8E9C95] tabular-nums">
                    <span>{loc.travelTime}</span>
                    <span className="font-mono">
                      {loc.x.toFixed(0)}°D / {loc.y.toFixed(0)}°K
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Expedition Travel Log */}
        <section
          aria-label="Sefer günlüğü"
          className="h-fit rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-5"
        >
          <div className="flex items-center justify-between border-b border-[#D4A853]/15 pb-3">
            <h2 className="font-display text-base font-semibold text-[#F8F3E6]">
              Grup Sefer Günlüğü
            </h2>
            <span className="font-mono text-xs text-[#9AA8A1] tabular-nums">
              {journeyLog.length} Kayıt
            </span>
          </div>

          {journeyLog.length === 0 ? (
            <p className="mt-4 text-sm text-[#9AA8A1]">
              Grubu harita üzerinde yeni bir konuma taşıdığınızda yolculuk adımları burada kaydedilir.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {journeyLog.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-[#D4A853]/10 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectOnMap(entry.locationId)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#EDE6D6] hover:text-[#D4A853] cursor-pointer"
                    >
                      <MapPin className="h-3.5 w-3.5 text-[#D4A853]" />
                      {entry.locationName}
                    </button>
                    <span className="font-mono text-xs text-[#8E9C95] tabular-nums">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#9AA8A1]">{entry.note}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
};
