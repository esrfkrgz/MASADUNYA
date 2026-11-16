import React, { useState } from 'react';
import { Download, FileJson, Plus, RotateCcw, Route, Trash2, Upload } from 'lucide-react';
import { OVERWORLD_MAP_IMAGE } from '../data/easternForestData';
import type { MapLocation, MapRoute } from '../types/map';
import { exportCampaignJson, exportMapPng } from '../utils/exportMap';

interface GmToolsPanelProps {
  locations: MapLocation[];
  routes: MapRoute[];
  partyLocationId: string;
  fogOfWar: boolean;
  onAddRoute: (route: Omit<MapRoute, 'id'>) => void;
  onDeleteRoute: (id: string) => void;
  onImportCampaign: (locations: MapLocation[], routes: MapRoute[], partyLocationId: string) => void;
  onResetAll: () => void;
}

export const GmToolsPanel: React.FC<GmToolsPanelProps> = ({
  locations,
  routes,
  partyLocationId,
  fogOfWar,
  onAddRoute,
  onDeleteRoute,
  onImportCampaign,
  onResetAll,
}) => {
  const [fromId, setFromId] = useState(locations[0]?.id ?? '');
  const [toId, setToId] = useState(locations[1]?.id ?? '');
  const [routeName, setRouteName] = useState('');
  const [travelHours, setTravelHours] = useState(4);
  const [hazard, setHazard] = useState('Orta');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isExportingPng, setIsExportingPng] = useState(false);

  const handleCreateRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId || fromId === toId) {
      setStatusMsg('Başlangıç ve varış noktaları farklı olmalıdır.');
      return;
    }
    onAddRoute({
      fromId,
      toId,
      name: routeName.trim() || 'Orman Patikası',
      travelHours: Math.max(1, travelHours),
      hazard,
    });
    setRouteName('');
    setStatusMsg('Yeni seyahat rotası haritaya eklendi.');
  };

  const handlePngDownload = async () => {
    try {
      setIsExportingPng(true);
      await exportMapPng(OVERWORLD_MAP_IMAGE, locations, routes, partyLocationId, fogOfWar);
      setStatusMsg('PNG harita görseli indirildi.');
    } catch {
      setStatusMsg('PNG oluşturulurken bir hata meydana geldi.');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.locations) && Array.isArray(parsed.routes)) {
          onImportCampaign(
            parsed.locations,
            parsed.routes,
            parsed.partyLocationId || parsed.locations[0]?.id || ''
          );
          setStatusMsg('Kampanya harita yedeği başarıyla yüklendi.');
        } else {
          setStatusMsg('Geçersiz harita JSON dosyası.');
        }
      } catch {
        setStatusMsg('JSON dosyası okunamadı.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-8 sm:px-6">
      <div className="border-b border-[#D4A853]/15 pb-6">
        <h1 className="font-display text-2xl font-semibold text-[#F8F3E6] sm:text-3xl">
          Oyun Yöneticisi Harita Araçları
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A3B1AA]">
          Haritanızı Roll20 veya masaüstü baskı için PNG olarak dışa aktarın, özel yollar bağlayın ve sefer kayıtlarınızı yedekleyin.
        </p>
      </div>

      {statusMsg && (
        <div className="flex items-center justify-between rounded-md border border-[#D4A853]/35 bg-[#192621] px-4 py-2.5 text-sm text-[#F3EBD8]">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-xs text-[#A3B1AA] hover:text-[#F3EBD8] cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Export & Backup Card */}
        <section className="rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
              Dışa Aktarım ve Yedekleme
            </h2>
            <p className="mt-1 text-sm text-[#A3B1AA]">
              Haritadaki tüm güncel konumları ve rotaları görsel veya veri dosyası olarak alın.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handlePngDownload}
              disabled={isExportingPng}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#D4A853] px-4 py-2.5 text-sm font-semibold text-[#111916] transition-colors hover:bg-[#E0B96B] disabled:opacity-60 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              {isExportingPng ? 'Hazırlanıyor...' : 'Haritayı PNG İndir'}
            </button>

            <button
              type="button"
              onClick={() => {
                exportCampaignJson(locations, routes, partyLocationId);
                setStatusMsg('JSON sefer dosyası indirildi.');
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#D4A853]/30 bg-[#192621] px-4 py-2.5 text-sm font-medium text-[#EDE6D6] transition-colors hover:border-[#D4A853]/60 cursor-pointer"
            >
              <FileJson className="h-4 w-4 text-[#D4A853]" />
              JSON Yedeği İndir
            </button>

            <label className="inline-flex items-center justify-center gap-2 rounded-md border border-[#D4A853]/20 bg-[#192621] px-4 py-2.5 text-sm font-medium text-[#EDE6D6] transition-colors hover:border-[#D4A853]/50 cursor-pointer">
              <Upload className="h-4 w-4 text-[#67C7C0]" />
              JSON Yedeği Yükle
              <input
                type="file"
                accept="application/json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onResetAll();
                setStatusMsg('Harita başlangıç verilerine sıfırlandı.');
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#DC6B6B]/30 bg-[#26191A] px-4 py-2.5 text-sm font-medium text-[#E89898] transition-colors hover:bg-[#322021] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Varsayılana Sıfırla
            </button>
          </div>
        </section>

        {/* Route Builder Card */}
        <section className="rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
              Yeni Seyahat Rotası Bağla
            </h2>
            <p className="mt-1 text-sm text-[#A3B1AA]">
              Özel konumlarınız arasında yürüme süresi ve tehlike seviyesi içeren patikalar çizin.
            </p>
          </div>

          <form onSubmit={handleCreateRoute} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-[#A3B1AA]">
                Başlangıç Konumu
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-[#A3B1AA]">
                Varış Konumu
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs text-[#A3B1AA] sm:col-span-1">
                Yol Adı
                <input
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Sisli Patika"
                  className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] placeholder:text-[#66766E] focus:border-[#D4A853] focus:outline-none"
                />
              </label>

              <label className="block text-xs text-[#A3B1AA]">
                Süre (Saat)
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={travelHours}
                  onChange={(e) => setTravelHours(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 font-mono text-sm text-[#EDE6D6] tabular-nums focus:border-[#D4A853] focus:outline-none"
                />
              </label>

              <label className="block text-xs text-[#A3B1AA]">
                Tehlike
                <select
                  value={hazard}
                  onChange={(e) => setHazard(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
                >
                  <option value="Düşük">Düşük</option>
                  <option value="Orta">Orta</option>
                  <option value="Yüksek">Yüksek</option>
                  <option value="Çok Yüksek">Çok Yüksek</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#D4A853] px-4 py-2 text-sm font-semibold text-[#111916] transition-colors hover:bg-[#E0B96B] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Rotayı Ekle
            </button>
          </form>
        </section>
      </div>

      {/* Existing Routes Table */}
      <section className="overflow-hidden rounded-lg border border-[#D4A853]/18 bg-[#141F1B]">
        <div className="flex items-center justify-between border-b border-[#D4A853]/15 px-5 py-4">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-[#D4A853]" />
            <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
              Kayıtlı Bölge Rotaları
            </h2>
          </div>
          <span className="font-mono text-xs text-[#9AA8A1] tabular-nums">{routes.length} Rota</span>
        </div>
        <div className="divide-y divide-[#D4A853]/10">
          {routes.map((rt) => {
            const from = locations.find((l) => l.id === rt.fromId)?.name ?? 'Bilinmeyen';
            const to = locations.find((l) => l.id === rt.toId)?.name ?? 'Bilinmeyen';
            return (
              <div
                key={rt.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 text-sm"
              >
                <div>
                  <span className="font-medium text-[#F3EBD8]">{rt.name}</span>
                  <span className="ml-2 text-xs text-[#9AA8A1]">
                    {from} → {to}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-[#D4A853] tabular-nums">
                    {rt.travelHours >= 24
                      ? `${(rt.travelHours / 24).toFixed(rt.travelHours % 24 === 0 ? 0 : 1)} Gün`
                      : `${rt.travelHours} Saat`}{' '}
                    · {rt.hazard}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteRoute(rt.id)}
                    aria-label={`${rt.name} rotasını sil`}
                    className="rounded p-1.5 text-[#9AA8A1] transition-colors hover:bg-[#26191A] hover:text-[#E89898] cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
