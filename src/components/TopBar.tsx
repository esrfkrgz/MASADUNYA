import React from 'react';
import type { ActiveTab } from '../types/map';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  isPlacingPin: boolean;
  onTogglePlacePin: () => void;
}

const NAV_ITEMS: { id: ActiveTab; label: string }[] = [
  { id: 'map', label: 'Bölge Haritası' },
  { id: 'chronicle', label: 'Konum Günlüğü' },
  { id: 'encounters', label: 'Zar & Olay Motoru' },
  { id: 'gm', label: 'Yönetici Araçları' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  isPlacingPin,
  onTogglePlacePin,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-[#D4A853]/18 bg-[#0D1512]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-8 px-4 py-3 sm:px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onTabChange('map')}
          className="font-display text-lg font-semibold tracking-wide text-[#F3EBD8] transition-colors hover:text-[#D4A853] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4A853] whitespace-nowrap shrink-0 cursor-pointer"
        >
          Sisli Doğu Atlası
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav aria-label="Ana gezinme" className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4A853] ${
                  isActive
                    ? 'text-[#F3EBD8]'
                    : 'text-[#A3B1AA] hover:text-[#EDE6D6]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-[#D4A853]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onTogglePlacePin}
            className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4A853] ${
              isPlacingPin
                ? 'bg-[#2A3A34] text-[#F3EBD8] border border-[#D4A853]/50 hover:bg-[#33463F]'
                : 'bg-[#D4A853] text-[#111916] hover:bg-[#E0B96B]'
            }`}
          >
            {isPlacingPin ? 'Eklemeyi İptal Et' : 'Yeni Konum Ekle'}
          </button>
        </div>
      </div>

      {/* Mobile navigation row */}
      <nav
        aria-label="Mobil gezinme"
        className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-[#D4A853]/10 px-4 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`py-1 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                isActive ? 'text-[#D4A853]' : 'text-[#A3B1AA]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
