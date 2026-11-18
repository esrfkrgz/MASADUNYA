import React, { useEffect, useRef, useState } from 'react';
import {
  Backpack,
  Coins,
  Flame,
  FlaskConical,
  HeartPulse,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Shield,
  Sword,
  Utensils,
} from 'lucide-react';
import type {
  InventoryItem,
  InventoryItemId,
  NarrativeChoice,
  NarrativeMessage,
} from '../types/map';

interface NarrativeChatboxProps {
  messages: NarrativeMessage[];
  protagonistName: string;
  currentPlaceLabel: string;
  activeModelName?: string;
  inventory?: InventoryItem[];
  rations?: number;
  silver?: number;
  isFullscreen?: boolean;
  isPending?: boolean;
  errorMessage?: string | null;
  failedAttempt?: { text: string; choice?: NarrativeChoice } | null;
  onSubmitAction: (
    text: string,
    choice?: NarrativeChoice
  ) => Promise<boolean> | boolean | void;
  onUseQuickItem?: (itemId: 'rations' | InventoryItemId) => void;
  onRetryFailedAction?: () => Promise<boolean> | boolean | void;
  onResetNarrative: () => void;
  onOpenSettings?: () => void;
}

export const NarrativeChatbox: React.FC<NarrativeChatboxProps> = ({
  messages,
  protagonistName,
  currentPlaceLabel,
  activeModelName,
  inventory = [],
  rations = 0,
  silver = 0,
  isFullscreen = false,
  isPending = false,
  errorMessage = null,
  failedAttempt = null,
  onSubmitAction,
  onUseQuickItem,
  onRetryFailedAction,
  onResetNarrative,
  onOpenSettings,
}) => {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, isPending, errorMessage]);

  const activeChoices = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const ch = messages[i]?.choices;
      if (ch && ch.length > 0) return ch;
    }
    return [];
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    const cleaned = draft.trim();
    if (!cleaned) return;
    const succeeded = await onSubmitAction(cleaned);
    if (succeeded !== false) {
      setDraft('');
    }
  };

  const handleRetryClick = async () => {
    if (isPending || !failedAttempt) return;
    const succeeded = onRetryFailedAction
      ? await onRetryFailedAction()
      : await onSubmitAction(failedAttempt.text, failedAttempt.choice);
    if (succeeded !== false && draft.trim() === failedAttempt.text.trim()) {
      setDraft('');
    }
  };

  const activeInventory = inventory.filter((item) => item.qty > 0);
  const usableWeapons = activeInventory.filter((item) => (item.physBonus ?? 0) > 0);
  const usableConsumables = activeInventory.filter((item) => item.category === 'Tüketim');
  const passiveCarriedItems = activeInventory.filter(
    (item) => (item.physBonus ?? 0) <= 0 && item.category !== 'Tüketim'
  );

  const getConsumableIcon = (id: InventoryItemId) => {
    if (id === 'healing_herb') return HeartPulse;
    if (id === 'antidote_vial') return FlaskConical;
    return Flame;
  };

  return (
    <section
      aria-label="Anlatı ve eylem akışı"
      className={`flex flex-col overflow-hidden rounded-lg border border-[#D4A853]/18 bg-[#101A16] ${
        isFullscreen
          ? 'h-[39vh] min-h-[250px] max-h-[390px] shrink-0'
          : 'h-[470px] sm:h-[500px]'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-3 border-b border-[#D4A853]/15 bg-[#141F1B] px-4 ${
          isFullscreen ? 'py-2' : 'py-3'
        }`}
      >
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <MessageSquare className="h-4 w-4 shrink-0 text-[#D4A853]" />
            <h2 className="font-display text-sm font-semibold text-[#F3EBD8] whitespace-nowrap">
              Anlatı &amp; Eylem Akışı
            </h2>
          </div>
          <span aria-hidden="true" className="hidden sm:inline text-[#56665F]">·</span>
          <p className="hidden sm:block text-xs text-[#9AA8A1] truncate">
            {currentPlaceLabel}
            {activeModelName ? ` · ${activeModelName}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Anlatıcı modeli ve sahne derinliği ayarları"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D4A853]/25 bg-[#192621] px-2.5 py-1 text-xs font-medium text-[#EDE6D6] transition-colors hover:border-[#D4A853]/55 hover:text-[#FFF8E8] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-[#D4A853]" />
              Ayarlar
            </button>
          )}
          <button
            type="button"
            onClick={onResetNarrative}
            title="Anlatı akışını baştan başlat"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D4A853]/25 bg-[#192621] px-2.5 py-1 text-xs font-medium text-[#C8D0CB] transition-colors hover:border-[#D4A853]/55 hover:text-[#F3EBD8] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Temizle
          </button>
        </div>
      </div>

      {/* Scrollable Narrative & Dialogue Stream */}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto px-4 ${
          isFullscreen ? 'space-y-2 py-2.5' : 'space-y-3 py-4'
        }`}
      >
        {messages.map((msg) => {
          const isPlayer = msg.role === 'player';
          const isDialogue = msg.role === 'dialogue';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isPlayer ? 'items-end' : 'items-start'}`}
            >
              {/* Quiet unboxed speaker & time caption */}
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8E9C95]">
                <span
                  className={
                    isPlayer
                      ? 'font-medium text-[#9CE3DD]'
                      : isDialogue
                      ? 'font-medium text-[#E8C472]'
                      : 'font-medium text-[#C8D0CB]'
                  }
                >
                  {isPlayer ? protagonistName : msg.speaker ?? 'Anlatıcı'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{msg.timestamp}</span>
              </div>

              {/* Message Surface */}
              <div
                className={`max-w-[78ch] rounded-lg px-3.5 ${
                  isFullscreen ? 'py-2 text-[13px]' : 'py-2.5 text-[13.5px]'
                } leading-relaxed ${
                  isPlayer
                    ? 'border border-[#67C7C0]/30 bg-[#142924] text-[#EAF7F5]'
                    : isDialogue
                    ? 'border border-[#D4A853]/30 bg-[#19241E] text-[#F5EBD4] italic'
                    : 'border border-[#D4A853]/14 bg-[#141F1B] text-[#E3DDD0]'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        {isPending && (
          <div className="flex flex-col items-start">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[#8E9C95]">
              <span className="font-medium text-[#C8D0CB]">Anlatıcı</span>
            </div>
            <div className="rounded-lg border border-[#D4A853]/18 bg-[#141F1B] px-3.5 py-2 text-xs text-[#9AA8A1] italic">
              Motor zarları değerlendiriyor ve sahneyi hazırlıyor...
            </div>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-red-400/35 bg-red-950/40 px-3.5 py-2.5 text-xs text-red-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="leading-relaxed">{errorMessage}</p>
              {failedAttempt && (
                <p className="text-[11px] text-red-200/80 truncate">
                  Korunan girdi: &ldquo;{failedAttempt.text}&rdquo;
                </p>
              )}
            </div>
            {failedAttempt && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleRetryClick}
                className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-md border border-red-300/40 bg-red-900/50 px-3 py-1.5 text-xs font-medium text-red-50 transition-colors hover:bg-red-800/65 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Tekrar Dene
              </button>
            )}
          </div>
        )}
      </div>

      {/* Motor / AI Offered Choices */}
      {activeChoices.length > 0 && (
        <div
          className={`border-t border-[#D4A853]/15 bg-[#121D19] px-3.5 ${
            isFullscreen ? 'py-2' : 'py-2.5'
          }`}
        >
          {!isFullscreen && (
            <p className="mb-2 text-[11px] font-medium text-[#9AA8A1]">
              Önerilen Seçenekler
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {activeChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                disabled={isPending}
                onClick={() => onSubmitAction(choice.actionPrompt, choice)}
                className="w-full rounded-md border border-[#D4A853]/22 bg-[#17241F] px-3 py-1.5 text-left text-xs font-medium text-[#EDE6D6] transition-colors duration-150 hover:border-[#D4A853]/60 hover:bg-[#1E2E28] hover:text-[#FFF8E8] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer truncate"
                title={choice.label}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action & Speech Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-[#D4A853]/18 bg-[#141F1B] p-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          placeholder={
            isPending
              ? 'Anlatıcı yanıtlıyor...'
              : 'Eylemini veya sözlerini yaz...'
          }
          aria-label="Eylem veya konuşma metni"
          className="min-w-0 flex-1 rounded-md border border-[#D4A853]/25 bg-[#0D1512] px-3 py-2 text-xs sm:text-sm text-[#F3EBD8] placeholder:text-[#7E8D85] focus:border-[#D4A853] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isPending || !draft.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#D4A853] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#111916] transition-colors hover:bg-[#E0B96B] disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          {isPending ? 'Bekleniyor' : 'Gönder'}
        </button>
      </form>

      {/* Quick Inventory Strip directly under the input box */}
      <div
        aria-label="Envanter ve hızlı kullanım"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-[#D4A853]/15 bg-[#0E1714] px-3 py-2 text-[11px]"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 font-medium text-[#9AA8A1] mr-0.5">
            <Sword className="h-3 w-3 text-[#D4A853]" />
            Kullanılabilir:
          </span>

          {usableWeapons.map((weapon) => (
            <button
              key={weapon.id}
              type="button"
              disabled={isPending}
              title={`${weapon.name} ile önündeki hedefe doğrudan saldır (${weapon.description})`}
              onClick={() =>
                onSubmitAction(
                  `Elimdeki ${weapon.name} ile önümdeki hedefe doğrudan saldırıyorum!`,
                  {
                    id: `quick-atk-${weapon.id}`,
                    label: `${weapon.name} ile Saldır`,
                    actionPrompt: `Elimdeki ${weapon.name} ile önümdeki hedefe doğrudan saldırıyorum!`,
                    kind: 'risk',
                  }
                )
              }
              className="inline-flex items-center gap-1 rounded border border-[#DC6B6B]/40 bg-[#251617] px-2 py-0.5 font-medium text-[#F5C6C6] transition-colors hover:border-[#DC6B6B]/75 hover:bg-[#321D1F] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <Sword className="h-3 w-3 text-[#E89898]" />
              <span>{weapon.name}</span>
              <span className="font-mono text-[10px] text-[#E89898]">+{weapon.physBonus}</span>
            </button>
          ))}

          {usableConsumables.map((item) => {
            const ItemIcon = getConsumableIcon(item.id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={isPending}
                title={item.description}
                onClick={() => {
                  if (onUseQuickItem) {
                    onUseQuickItem(item.id);
                  } else {
                    onSubmitAction(`${item.name} kullanıyorum.`);
                  }
                }}
                className="inline-flex items-center gap-1 rounded border border-[#67C7C0]/35 bg-[#122521] px-2 py-0.5 font-medium text-[#AEEAE4] transition-colors hover:border-[#67C7C0]/70 hover:bg-[#18322C] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                <ItemIcon className="h-3 w-3 text-[#67C7C0]" />
                <span>{item.name}</span>
                <span className="font-mono text-[10px] text-[#67C7C0]">x{item.qty}</span>
              </button>
            );
          })}

          {rations > 0 && (
            <button
              type="button"
              disabled={isPending}
              title="1 porsiyon kuru erzak ye (Açlığı azaltır, +8 Zindelik)"
              onClick={() => {
                if (onUseQuickItem) {
                  onUseQuickItem('rations');
                } else {
                  onSubmitAction('Çantamdan 1 porsiyon kuru erzak yiyorum.');
                }
              }}
              className="inline-flex items-center gap-1 rounded border border-[#D4A853]/35 bg-[#201D14] px-2 py-0.5 font-medium text-[#F0DFB6] transition-colors hover:border-[#D4A853]/70 hover:bg-[#2C271B] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <Utensils className="h-3 w-3 text-[#D4A853]" />
              <span>Kuru Erzak</span>
              <span className="font-mono text-[10px] text-[#D4A853]">x{rations}</span>
            </button>
          )}

          {usableWeapons.length === 0 && usableConsumables.length === 0 && rations <= 0 && (
            <span className="text-[#73837B]">Kullanılabilir silah veya eşya yok</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 font-medium text-[#8E9C95] mr-0.5">
            <Backpack className="h-3 w-3 text-[#9AA8A1]" />
            Üstümdekiler:
          </span>

          <span
            title="Kesendeki gümüş sikke miktarı"
            className="inline-flex items-center gap-1 rounded border border-[#D4A853]/20 bg-[#141F1B] px-2 py-0.5 font-mono text-[10.5px] text-[#E8C472] whitespace-nowrap select-none"
          >
            <Coins className="h-3 w-3 text-[#D4A853]" />
            {silver} Gümüş
          </span>

          {passiveCarriedItems.map((item) => (
            <span
              key={item.id}
              title={item.description}
              className="inline-flex items-center gap-1 rounded border border-[#56665F]/35 bg-[#131C18] px-2 py-0.5 text-[#C8D0CB] whitespace-nowrap select-none"
            >
              {(item.armorReduction ?? 0) > 0 && (
                <Shield className="h-3 w-3 text-[#9AA8A1]" />
              )}
              <span>{item.name}</span>
              {item.qty > 1 && (
                <span className="font-mono text-[10px] text-[#8E9C95]">x{item.qty}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};
