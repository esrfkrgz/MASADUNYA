import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, RotateCcw, Send } from 'lucide-react';
import type { NarrativeChoice, NarrativeMessage } from '../types/map';

interface NarrativeChatboxProps {
  messages: NarrativeMessage[];
  protagonistName: string;
  currentPlaceLabel: string;
  onSubmitAction: (text: string, choice?: NarrativeChoice) => void;
  onResetNarrative: () => void;
}

export const NarrativeChatbox: React.FC<NarrativeChatboxProps> = ({
  messages,
  protagonistName,
  currentPlaceLabel,
  onSubmitAction,
  onResetNarrative,
}) => {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const activeChoices = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const ch = messages[i]?.choices;
      if (ch && ch.length > 0) return ch;
    }
    return [];
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned) return;
    setDraft('');
    onSubmitAction(cleaned);
  };

  return (
    <section
      aria-label="Anlatı ve eylem akışı"
      className="flex h-[430px] sm:h-[460px] flex-col overflow-hidden rounded-lg border border-[#D4A853]/18 bg-[#101A16]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#D4A853]/15 bg-[#141F1B] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-[#D4A853]" />
            <h2 className="font-display text-sm font-semibold text-[#F3EBD8] truncate">
              Anlatı &amp; Eylem Akışı
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#9AA8A1] truncate">{currentPlaceLabel}</p>
        </div>

        <button
          type="button"
          onClick={onResetNarrative}
          title="Anlatı akışını baştan başlat"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#D4A853]/25 bg-[#192621] px-2.5 py-1.5 text-xs font-medium text-[#C8D0CB] transition-colors hover:border-[#D4A853]/55 hover:text-[#F3EBD8] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Temizle
        </button>
      </div>

      {/* Scrollable Narrative & Dialogue Stream */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
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
                className={`max-w-[78ch] rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
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
      </div>

      {/* Motor / AI Offered Choices */}
      {activeChoices.length > 0 && (
        <div className="border-t border-[#D4A853]/15 bg-[#121D19] px-3.5 py-2.5">
          <p className="mb-2 text-[11px] font-medium text-[#9AA8A1]">
            Önerilen Seçenekler
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {activeChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => onSubmitAction(choice.actionPrompt, choice)}
                className="w-full rounded-md border border-[#D4A853]/22 bg-[#17241F] px-3 py-2 text-left text-xs font-medium text-[#EDE6D6] transition-colors duration-150 hover:border-[#D4A853]/60 hover:bg-[#1E2E28] hover:text-[#FFF8E8] cursor-pointer truncate"
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
          placeholder="Eylemini veya sözlerini yaz..."
          aria-label="Eylem veya konuşma metni"
          className="min-w-0 flex-1 rounded-md border border-[#D4A853]/25 bg-[#0D1512] px-3 py-2 text-xs sm:text-sm text-[#F3EBD8] placeholder:text-[#7E8D85] focus:border-[#D4A853] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#D4A853] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#111916] transition-colors hover:bg-[#E0B96B] disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          Gönder
        </button>
      </form>
    </section>
  );
};
