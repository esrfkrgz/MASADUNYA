import React from 'react';
import { Check, Cpu, SlidersHorizontal, X } from 'lucide-react';
import type {
  NarrativeAiModelId,
  NarrativeAiSettings,
  NarrativeThinkingMode,
} from '../types/map';

interface NarrativeSettingsModalProps {
  isOpen: boolean;
  settings: NarrativeAiSettings;
  onChange: (next: NarrativeAiSettings) => void;
  onClose: () => void;
}

export const NARRATIVE_MODEL_OPTIONS: Array<{
  id: NarrativeAiModelId;
  name: string;
  subtitle: string;
  tierLabel: string;
}> = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    subtitle: 'Hızlı, dengeli anlatı akışı ve güvenilir motor aracı kullanımı (Varsayılan).',
    tierLabel: 'Dengeli · Varsayılan',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    subtitle: 'En düşük bekleme süresi ve seri sahne geçişleri için hafif model.',
    tierLabel: 'En Hızlı',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    subtitle: 'Karmaşık çok aşamalı eylemler ve tutarlı karakter psikolojisi için gelişmiş model.',
    tierLabel: 'Gelişmiş Kurgu',
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    subtitle: 'En derin akıl yürütme, ince ipuçları ve çok katmanlı sahne dokusu.',
    tierLabel: 'Maksimum Derinlik',
  },
];

const THINKING_OPTIONS: Array<{
  id: NarrativeThinkingMode;
  label: string;
  hint: string;
}> = [
  { id: 'fast', label: 'Hızlı', hint: 'Kısa bekleme, akıcı yanıt' },
  { id: 'balanced', label: 'Dengeli', hint: 'Tutarlı niyet ve kurgu' },
  { id: 'deep', label: 'Derin', hint: 'Zengin ayrıntı ve muhakeme' },
];

export const NarrativeSettingsModal: React.FC<NarrativeSettingsModalProps> = ({
  isOpen,
  settings,
  onChange,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="narrative-settings-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-[#D4A853]/30 bg-[#101A16] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#D4A853]/18 bg-[#141F1B] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-4 w-4 text-[#D4A853]" />
            <h2
              id="narrative-settings-title"
              className="font-display text-base font-semibold text-[#F3EBD8]"
            >
              Anlatıcı Ayarları
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Ayarları kapat"
            className="rounded-md p-1 text-[#9AA8A1] transition-colors hover:bg-[#1E2E28] hover:text-[#F3EBD8] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
          {/* Model Selection */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[#D4A853]" />
              <h3 className="text-sm font-medium text-[#EDE6D6]">Yapay Zeka Modeli</h3>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {NARRATIVE_MODEL_OPTIONS.map((opt) => {
                const selected = settings.model === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange({ ...settings, model: opt.id })}
                    className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#D4A853]/75 bg-[#1B2B24]'
                        : 'border-[#D4A853]/18 bg-[#141F1B] hover:border-[#D4A853]/45 hover:bg-[#182520]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#F3EBD8]">{opt.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-[#D4A853]" />}
                    </div>
                    <span className="mt-0.5 text-[11px] font-medium text-[#D4A853]/90">
                      {opt.tierLabel}
                    </span>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#A3B1AA]">{opt.subtitle}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thinking / Depth Selection */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-[#EDE6D6]">Sahne İşleme Derinliği</h3>
            <div className="grid grid-cols-3 gap-2">
              {THINKING_OPTIONS.map((t) => {
                const active = settings.thinkingMode === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ ...settings, thinkingMode: t.id })}
                    className={`rounded-md border px-3 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[#D4A853]/75 bg-[#1B2B24] text-[#F3EBD8]'
                        : 'border-[#D4A853]/18 bg-[#141F1B] text-[#B8C4BD] hover:border-[#D4A853]/45'
                    }`}
                  >
                    <div className="text-xs font-semibold">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-[#8E9C95]">{t.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[#D4A853]/15 bg-[#141F1B] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-[#D4A853] px-4 py-1.5 text-xs sm:text-sm font-medium text-[#111916] transition-colors hover:bg-[#E0B96B] cursor-pointer"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
