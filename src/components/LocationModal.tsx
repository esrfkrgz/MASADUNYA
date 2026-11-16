import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CATEGORY_LABELS } from '../data/easternForestData';
import type { LocationCategory, MapLocation } from '../types/map';

interface LocationModalProps {
  isOpen: boolean;
  coords: { x: number; y: number } | null;
  editingLocation: MapLocation | null;
  onClose: () => void;
  onSave: (data: Omit<MapLocation, 'id'> & { id?: string }) => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({
  isOpen,
  coords,
  editingLocation,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [category, setCategory] = useState<LocationCategory>('ruin');
  const [dangerLevel, setDangerLevel] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [travelTime, setTravelTime] = useState('Orman Eşiği: 4 Saat');
  const [discovered, setDiscovered] = useState(true);
  const [playerLore, setPlayerLore] = useState('');
  const [gmSecret, setGmSecret] = useState('');
  const [hooksText, setHooksText] = useState('');

  useEffect(() => {
    if (editingLocation) {
      setName(editingLocation.name);
      setSubtitle(editingLocation.subtitle);
      setCategory(editingLocation.category);
      setDangerLevel(editingLocation.dangerLevel);
      setTravelTime(editingLocation.travelTime);
      setDiscovered(editingLocation.discovered);
      setPlayerLore(editingLocation.playerLore);
      setGmSecret(editingLocation.gmSecret);
      setHooksText(editingLocation.hooks.join('\n'));
    } else {
      setName('');
      setSubtitle('Sisli Orman Bölgesi');
      setCategory('ruin');
      setDangerLevel(3);
      setTravelTime('Yakın Bölgeden 3 Saat');
      setDiscovered(true);
      setPlayerLore('');
      setGmSecret('');
      setHooksText('');
    }
  }, [editingLocation, isOpen]);

  if (!isOpen) return null;

  const finalX = editingLocation ? editingLocation.x : coords?.x ?? 50;
  const finalY = editingLocation ? editingLocation.y : coords?.y ?? 50;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const hooks = hooksText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    onSave({
      id: editingLocation?.id,
      name: name.trim(),
      subtitle: subtitle.trim() || 'Özel Bölge',
      category,
      x: finalX,
      y: finalY,
      dangerLevel,
      travelTime: travelTime.trim() || 'Belirsiz',
      discovered,
      isCustom: editingLocation ? editingLocation.isCustom : true,
      imageUrl: editingLocation?.imageUrl,
      playerLore:
        playerLore.trim() ||
        'Sisin derinliklerinde yer alan bu nokta, henüz tam olarak haritalandırılmamış gizemli bir alan.',
      gmSecret: gmSecret.trim() || 'Bu konum için henüz gizli yönetici notu eklenmedi.',
      hooks,
      npcsOrFoes: editingLocation?.npcsOrFoes ?? [],
      loot: editingLocation?.loot ?? [],
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#D4A853]/30 bg-[#141F1B] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#D4A853]/15 pb-3">
          <div>
            <h2 id="location-modal-title" className="font-display text-xl font-semibold text-[#F8F3E6]">
              {editingLocation ? 'Konumu Düzenle' : 'Yeni Harita Konumu'}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-[#9AA8A1] tabular-nums">
              Koordinat: {finalX.toFixed(1)}% D · {finalY.toFixed(1)}% K
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Pencereyi kapat"
            className="rounded-md p-1.5 text-[#A3B1AA] hover:bg-[#1E2E28] hover:text-[#F8F3E6] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs text-[#A3B1AA]">
              Konum Adı
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Sisli Kütük Mabedi"
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] placeholder:text-[#63726B] focus:border-[#D4A853] focus:outline-none"
              />
            </label>

            <label className="block text-xs text-[#A3B1AA]">
              Alt Başlık
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Örn: Unutulmuş Sunak"
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs text-[#A3B1AA]">
              Tür
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as LocationCategory)}
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
              >
                {(Object.keys(CATEGORY_LABELS) as LocationCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-[#A3B1AA]">
              Tehlike (1 - 5)
              <select
                value={dangerLevel}
                onChange={(e) => setDangerLevel(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
              >
                <option value={1}>1 - Güvenli</option>
                <option value={2}>2 - Düşük Risk</option>
                <option value={3}>3 - Orta Tehlike</option>
                <option value={4}>4 - Yüksek Tehlike</option>
                <option value={5}>5 - Ölümcül</option>
              </select>
            </label>

            <label className="block text-xs text-[#A3B1AA]">
              Ulaşım Süresi
              <input
                type="text"
                value={travelTime}
                onChange={(e) => setTravelTime(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-xs text-[#A3B1AA]">
            Oyunculara Okunabilir Tasvir
            <textarea
              rows={3}
              value={playerLore}
              onChange={(e) => setPlayerLore(e.target.value)}
              placeholder="Grup bu noktaya yaklaştığında ne görür, ne duyar?"
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] placeholder:text-[#63726B] focus:border-[#D4A853] focus:outline-none"
            />
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Yönetici Sırrı (GM Notu)
            <textarea
              rows={2}
              value={gmSecret}
              onChange={(e) => setGmSecret(e.target.value)}
              placeholder="Gizli geçitler, tuzaklar veya NPC niyetleri..."
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] placeholder:text-[#63726B] focus:border-[#D4A853] focus:outline-none"
            />
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Macera İpuçları (Her satıra bir madde)
            <textarea
              rows={2}
              value={hooksText}
              onChange={(e) => setHooksText(e.target.value)}
              placeholder="Kayıp feneri yakmak&#10;Rün kapısını açmak"
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#EDE6D6] placeholder:text-[#63726B] focus:border-[#D4A853] focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-[#EDE6D6] cursor-pointer">
            <input
              type="checkbox"
              checked={discovered}
              onChange={(e) => setDiscovered(e.target.checked)}
              className="h-4 w-4 accent-[#D4A853]"
            />
            Oyuncular için keşfedilmiş (Keşif Sisi içinde görünür)
          </label>

          <div className="flex items-center justify-end gap-3 border-t border-[#D4A853]/15 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#D4A853]/25 px-4 py-2 text-sm font-medium text-[#C8D0CB] hover:text-[#F8F3E6] cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              className="rounded-md bg-[#D4A853] px-5 py-2 text-sm font-semibold text-[#111916] hover:bg-[#E0B96B] cursor-pointer"
            >
              Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
