import React, { useEffect, useState } from 'react';
import { Cpu, SlidersHorizontal, X } from 'lucide-react';
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
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    subtitle: 'Güçlü kurgu ve uzun süreli anlatı akışları için olgun model.',
    tierLabel: 'Güçlü · Eski',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    subtitle: 'Hızlı ve ekonomik akış; hızlı temiz anlatımlar.',
    tierLabel: 'Hızlı · Eski',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    subtitle: 'Çok hızlı, düşük maliyetli eski nesil model.',
    tierLabel: 'Çok Hızlı · Eski',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    subtitle: 'Çok hızlı ve ekonomik akıllı anlatım modeli.',
    tierLabel: 'Çok Hızlı · Ekonomik',
  },
  {
    id: 'gemini-2.5-thinking',
    name: 'Gemini 2.5 Thinking',
    subtitle: 'Derin muhakeme ve kurgu odaklı düşünce modeli.',
    tierLabel: 'Düşünce · Eski',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    subtitle: 'Uzun bağlamlı kurgu ve diyalog modelleri.',
    tierLabel: 'Güçlü · Çok Eski',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    subtitle: 'Hızlı ve ucuz akıllı anlatım modeli.',
    tierLabel: 'Hızlı · Çok Eski',
  },
  {
    id: 'gemini-1.5-flash-8b',
    name: 'Gemini 1.5 Flash-8B',
    subtitle: 'Çok hızlı, düşük maliyetli konuşma modeli.',
    tierLabel: 'Çok Hızlı · Çok Eski',
  },
  {
    id: 'gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash-Lite',
    subtitle: 'Çok hızlı ve ekonomik eski nesil model.',
    tierLabel: 'Çok Hızlı · Eski',
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    subtitle: 'Güçlü kurgu ve derin anlatım için gelişmiş model.',
    tierLabel: 'Güçlü · Yeni',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    subtitle: 'Hızlı ve akıcı anlatım için hafif model.',
    tierLabel: 'Hızlı · Yeni',
  },
  {
    id: 'gemini-3-flash-lite',
    name: 'Gemini 3 Flash-Lite',
    subtitle: 'Çok hızlı ve ekonomik akıllı anlatım modeli.',
    tierLabel: 'Çok Hızlı · Yeni',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    subtitle: 'Gelişmiş hızlı anlatım modeli.',
    tierLabel: 'Hızlı · 3.7',
  },
  {
    id: 'gemini-3.7-flash-lite',
    name: 'Gemini 3.7 Flash-Lite',
    subtitle: 'Çok hızlı ve ekonomik 3.7 serisi modeli.',
    tierLabel: 'Çok Hızlı · 3.7',
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    subtitle: 'Yeni nesil hızlı anlatım modeli.',
    tierLabel: 'Hızlı · 3.8',
  },
  {
    id: 'gemini-3.8-flash-lite',
    name: 'Gemini 3.8 Flash-Lite',
    subtitle: 'Çok hızlı ve ekonomik 3.8 serisi modeli.',
    tierLabel: 'Çok Hızlı · 3.8',
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
  const [anyThinkModels, setAnyThinkModels] = useState<Array<{ id: string; name?: string }>>([]);
  const [anyThinkStatus, setAnyThinkStatus] = useState('');
  const [anyThinkReloadKey, setAnyThinkReloadKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    if (settings.provider !== 'anythinkllm') {
      setAnyThinkModels([]);
      setAnyThinkStatus('');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setAnyThinkStatus('Modeller yükleniyor...');
      try {
        const res = await fetch('/api/narrative/anythinkllm/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: settings.anythinkllmBaseUrl ?? '',
            apiKey: settings.anythinkllmApiKey ?? '',
          }),
        });
        const data = (await res.json()) as {
          models?: Array<{ id: string; name?: string }>;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setAnyThinkModels([]);
          setAnyThinkStatus(data.error || 'Model listesi alınamadı (HTTP ' + res.status + ').');
          return;
        }
        const list = (data.models ?? []).filter((model) => model && model.id);
        setAnyThinkModels(list);
        setAnyThinkStatus(
          list.length > 0
            ? list.length + ' model bulundu.'
            : 'Model bulunamadı; model adını elle yazabilirsiniz.'
        );
        if (list.length > 0 && !list.some((model) => model.id === settings.anythinkllmModel)) {
          onChange({ ...settings, anythinkllmModel: list[0].id });
        }
      } catch (err) {
        if (cancelled) return;
        setAnyThinkModels([]);
        setAnyThinkStatus(err instanceof Error ? 'Bağlantı hatası: ' + err.message : 'Bağlantı hatası.');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, settings.provider, settings.anythinkllmBaseUrl, settings.anythinkllmApiKey, anyThinkReloadKey]);

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
          {/* AI Provider Selection */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-[#EDE6D6]">Yapay Zeka Sağlayıcı</h3>
            <select
              value={settings.provider ?? 'gemini'}
              onChange={(e) =>
                onChange({ ...settings, provider: e.target.value as 'gemini' | 'anythinkllm' })
              }
              className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors focus:border-[#D4A853]/60"
            >
              <option value="gemini">Google Gemini</option>
              <option value="anythinkllm">AnyThinkLLM</option>
            </select>
            {settings.provider === 'anythinkllm' && (
              <div className="mt-3 space-y-2.5">
                <div>
                  <label
                    htmlFor="anythinkllm-base-url"
                    className="mb-1 block text-[11px] font-medium text-[#A3B1AA]"
                  >
                    AnyThinkLLM API URL
                  </label>
                  <input
                    id="anythinkllm-base-url"
                    type="text"
                    value={settings.anythinkllmBaseUrl ?? ''}
                    onChange={(e) =>
                      onChange({ ...settings, anythinkllmBaseUrl: e.target.value })
                    }
                    placeholder="http://localhost:3001/api/v1/openai"
                    className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors placeholder:text-[#6B7A72] focus:border-[#D4A853]/60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="anythinkllm-api-key"
                    className="mb-1 block text-[11px] font-medium text-[#A3B1AA]"
                  >
                    AnyThinkLLM API Anahtarı
                  </label>
                  <input
                    id="anythinkllm-api-key"
                    type="password"
                    value={settings.anythinkllmApiKey ?? ''}
                    onChange={(e) =>
                      onChange({ ...settings, anythinkllmApiKey: e.target.value })
                    }
                    placeholder="AnyThinkLLM API anahtarı"
                    autoComplete="off"
                    className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors placeholder:text-[#6B7A72] focus:border-[#D4A853]/60"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label
                      htmlFor="anythinkllm-model"
                      className="text-[11px] font-medium text-[#A3B1AA]"
                    >
                      Model
                    </label>
                    <button
                      type="button"
                      onClick={() => setAnyThinkReloadKey((key) => key + 1)}
                      className="cursor-pointer text-[10px] font-medium text-[#D4A853] underline-offset-2 hover:underline"
                    >
                      Modelleri Yenile
                    </button>
                  </div>
                  {anyThinkModels.length > 0 ? (
                    <select
                      id="anythinkllm-model"
                      value={settings.anythinkllmModel ?? ''}
                      onChange={(e) =>
                        onChange({ ...settings, anythinkllmModel: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors focus:border-[#D4A853]/60"
                    >
                      {anyThinkModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name || model.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="anythinkllm-model"
                      type="text"
                      value={settings.anythinkllmModel ?? ''}
                      onChange={(e) =>
                        onChange({ ...settings, anythinkllmModel: e.target.value })
                      }
                      placeholder="Model adı (örn. gpt-4o)"
                      className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors placeholder:text-[#6B7A72] focus:border-[#D4A853]/60"
                    />
                  )}
                  <p className="mt-1 text-[10px] leading-snug text-[#8E9C95]">{anyThinkStatus}</p>
                </div>
              </div>
            )}
          </div>

          {/* Gemini API Key */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-[#EDE6D6]">Gemini API Anahtarı</h3>
            <input
              type="password"
              value={settings.apiKey ?? ''}
              onChange={(e) => onChange({ ...settings, apiKey: e.target.value })}
              placeholder="AI anlatıcı API anahtarı"
              autoComplete="off"
              className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 font-mono text-xs text-[#EDE6D6] outline-none transition-colors placeholder:text-[#6B7A72] focus:border-[#D4A853]/60"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#8E9C95]">
              Anahtar kaydedildikten sonra ekranda **** ile maskelenir, düz metin olarak görünmez.
            </p>
          </div>

          {/* Model Selection */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[#D4A853]" />
              <h3 className="text-sm font-medium text-[#EDE6D6]">Yapay Zeka Modeli</h3>
            </div>
            <select
              value={settings.model}
              onChange={(e) =>
                onChange({ ...settings, model: e.target.value as NarrativeAiModelId })
              }
              className="w-full rounded-lg border border-[#D4A853]/25 bg-[#0E1712] px-3 py-2 text-xs text-[#EDE6D6] outline-none transition-colors focus:border-[#D4A853]/60"
            >
              {NARRATIVE_MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} — {opt.tierLabel}
                </option>
              ))}
            </select>
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
