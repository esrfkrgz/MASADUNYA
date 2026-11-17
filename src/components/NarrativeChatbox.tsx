import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, RotateCcw, Send, Settings } from 'lucide-react';
import type { NarrativeChoice, NarrativeMessage } from '../types/map';

interface NarrativeChatboxProps {
  messages: NarrativeMessage[];
  protagonistName: string;
  currentPlaceLabel: string;
  activeModelName?: string;
  isFullscreen?: boolean;
  isPending?: boolean;
  errorMessage?: string | null;
  failedAttempt?: { text: string; choice?: NarrativeChoice } | null;
  onSubmitAction: (
    text: string,
    choice?: NarrativeChoice
  ) => Promise<boolean> | boolean | void;
  onRetryFailedAction?: () => Promise<boolean> | boolean | void;
  onResetNarrative: () => void;
  onOpenSettings?: () => void;
}

export const NarrativeChatbox: React.FC<NarrativeChatboxProps> = ({
  messages,
  protagonistName,
  currentPlaceLabel,
  activeModelName,
  isFullscreen = false,
  isPending = false,
  errorMessage = null,
  failedAttempt = null,
  onSubmitAction,
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

  return (
    <section
      aria-label="Anlatı ve eylem akışı"
      className={`flex flex-col overflow-hidden rounded-lg border border-[#D4A853]/18 bg-[#101A16] ${
        isFullscreen
          ? 'h-[35vh] min-h-[220px] max-h-[340px] shrink-0'
          : 'h-[430px] sm:h-[460px]'
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
    </section>
  );
};
