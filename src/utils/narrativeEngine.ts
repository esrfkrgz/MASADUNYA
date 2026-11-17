import type {
  MapLocation,
  MapRoute,
  MazgalCell,
  MazgalNeighborSummary,
  NarrativeChoice,
  NarrativeMessage,
  ProtagonistState,
  WeatherConditionKey,
} from '../types/map';
import { rollDie } from './diceEngine';
import { addGameHours, formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { interactWithLivingNpc, type NpcInteractionType } from './partyAndRelationsEngine';
import {
  ACTION_HOURS,
  getProtagonistModifiers,
  performProtagonistAction,
} from './protagonistEngine';
import {
  interactWithRoamingUnit,
  performShadowAction,
  resolveSettlementProblemAttempt,
  useInventoryItem,
} from './worldSystemsEngine';

export interface NarrativeContextInput {
  protagonist: ProtagonistState;
  currentLocation?: MapLocation;
  currentMazgal: MazgalCell;
  allLocations: MapLocation[];
  routes: MapRoute[];
  activeWeatherKey: WeatherConditionKey;
  gameTimeMs: number;
}

export interface NarrativeTurnInput extends NarrativeContextInput {
  rawText: string;
  chosenOption?: NarrativeChoice;
}

export interface NarrativeTurnOutput {
  appendedMessages: NarrativeMessage[];
  nextProtagonist: ProtagonistState;
  hoursSpent: number;
  locationMoraleDelta: number;
  locationNoteTitle?: string;
  locationNoteDetail?: string;
  solvedProblemId?: string;
  attemptedProblemId?: string;
  travelToLocationId?: string;
  travelToMazgal?: MazgalNeighborSummary;
}

/**
 * Gelecekte harici bir yapay zeka anlatıcısı bağlamak için hazır adaptör arayüzü.
 */
export type NarrativeTurnAdapter = (
  input: NarrativeTurnInput,
  history: NarrativeMessage[]
) => Promise<NarrativeTurnOutput> | NarrativeTurnOutput;

const WEATHER_PROSE: Record<WeatherConditionKey, string> = {
  clear: 'soğuk ama berrak rüzgar',
  mist: 'toprağın üzerine çöken yoğun doğu sisi',
  rain: 'iliklere işleyen ince orman yağmuru',
  storm: 'dalları eğen sert vadi fırtınası',
};

function makeMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeTr(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

function includesAny(normText: string, words: string[]): boolean {
  return words.some((w) => normText.includes(normalizeTr(w)));
}

function getPlaceLabel(location: MapLocation | undefined, cell: MazgalCell): string {
  return location ? location.name : `Mazgal ${cell.id} (${cell.terrainLabel})`;
}

export function buildContextualChoices(ctx: NarrativeContextInput): NarrativeChoice[] {
  const { protagonist, currentLocation, currentMazgal, routes, allLocations } = ctx;
  const choices: NarrativeChoice[] = [];
  const living = currentLocation?.livingState;

  const unitsHere = (protagonist.roamingUnits ?? []).filter(
    (u) => u.mazgalId === currentMazgal.id
  );
  const contactsHere = (protagonist.contacts ?? []).filter(
    (c) =>
      c.partyRelation !== 'independent' ||
      (currentLocation
        ? c.currentLocationId === currentLocation.id
        : c.currentMazgalId === currentMazgal.id)
  );

  // 1. Öncelikli yerleşim sorunu varsa
  if (living && living.activeProblems.length > 0) {
    const prob = living.activeProblems[0];
    choices.push({
      id: `ch-prob-${prob.id}`,
      label: `Soruna el at: ${prob.title}`,
      actionPrompt: `Yerleşimdeki "${prob.title}" meselesini araştırıp müdahale ediyorum.`,
      kind: 'action',
    });
  }

  // 2. Aynı mazgalda hareketli grup varsa
  if (unitsHere.length > 0) {
    const unit = unitsHere[0];
    if (unit.kind === 'raider') {
      choices.push({
        id: `ch-unit-${unit.id}`,
        label: `Pusu kur: ${unit.name}`,
        actionPrompt: `${unit.name} birliğine karşı pusu kurup saldırıya geçiyorum.`,
        kind: 'risk',
      });
    } else {
      choices.push({
        id: `ch-unit-${unit.id}`,
        label: `Yaklaş ve konuş: ${unit.name}`,
        actionPrompt: `${unit.name} grubuna yaklaşıp yol ve takas hakkında konuşuyorum.`,
        kind: 'talk',
      });
    }
  }

  // 3. Yakındaki bir NPC veya yerleşim sakiniyle konuşma
  if (contactsHere.length > 0) {
    const npc = contactsHere[0];
    choices.push({
      id: `ch-npc-${npc.id}`,
      label: `${npc.name} ile konuş`,
      actionPrompt: `${npc.name} ile durum ve söylentiler üzerine konuşuyorum.`,
      kind: 'talk',
    });
  } else if (living && living.notableResidents.length > 0) {
    const res = living.notableResidents[0];
    choices.push({
      id: `ch-res-${res.id}`,
      label: `${res.name} ile sohbet et`,
      actionPrompt: `${res.name} yanına gidip bölgedeki gelişmeleri soruyorum.`,
      kind: 'talk',
    });
  }

  // 4. Sağlık / Yorgunluk / Açlık durumu
  if (protagonist.health <= 60 && (protagonist.inventory ?? []).some((i) => i.id === 'healing_herb' && i.qty > 0)) {
    choices.push({
      id: 'ch-heal',
      label: 'Şifalı kekiği kullan ve yarayı sar',
      actionPrompt: 'Çantamdaki şifalı dağ kekiğini çıkarıp yaralarımı sarıyorum.',
      kind: 'rest',
    });
  } else if (protagonist.stamina <= 42) {
    choices.push({
      id: 'ch-rest',
      label: 'Kamp kur ve dinlen',
      actionPrompt: 'Güvenli bir köşe bulup ateş yakarak dinlenmeye çekiliyorum.',
      kind: 'rest',
    });
  } else {
    choices.push({
      id: 'ch-observe',
      label: 'Çevreyi sessizce gözetle',
      actionPrompt: 'Durup etrafı, izleri ve yaklaşan tehlikeleri dikkatle gözetliyorum.',
      kind: 'observe',
    });
  }

  // 5. Seyahat veya av/iş seçeneği (en fazla 4 seçenek)
  if (choices.length < 4) {
    if (currentLocation) {
      const linked = routes.find(
        (r) => r.fromId === currentLocation.id || r.toId === currentLocation.id
      );
      if (linked) {
        const destId =
          linked.fromId === currentLocation.id ? linked.toId : linked.fromId;
        const dest = allLocations.find((l) => l.id === destId);
        if (dest) {
          choices.push({
            id: `ch-move-${dest.id}`,
            label: `${dest.name} yönüne yola çık`,
            actionPrompt: `${dest.name} istikametine doğru yola çıkıyorum.`,
            kind: 'travel',
          });
        }
      }
    } else if (currentMazgal.neighbors.length > 0) {
      const nb = currentMazgal.neighbors[0];
      choices.push({
        id: `ch-step-${nb.id}`,
        label: `${nb.direction} yönüne ilerle (${nb.id})`,
        actionPrompt: `${nb.direction} yönündeki ${nb.id} karesine doğru ilerliyorum.`,
        kind: 'travel',
      });
    }
  }

  return choices.slice(0, 4);
}

export function createInitialNarrativeMessages(
  ctx: NarrativeContextInput
): NarrativeMessage[] {
  const { protagonist, currentLocation, currentMazgal, activeWeatherKey, gameTimeMs } = ctx;
  const ts = formatGameDateTime(gameTimeMs);
  const placeLabel = getPlaceLabel(currentLocation, currentMazgal);
  const phase = getDayPhaseLabel(gameTimeMs);
  const weatherDesc = WEATHER_PROSE[activeWeatherKey];

  const openingLine = currentLocation
    ? `${currentLocation.name} eşiğinde ${phase.toLowerCase()} vakti ${weatherDesc} hakim. ${protagonist.lastObservation}`
    : `Mazgal ${currentMazgal.id} (${currentMazgal.terrainLabel}) içinde ${phase.toLowerCase()} vakti ${weatherDesc} sürüyor. ${currentMazgal.summary}`;

  const messages: NarrativeMessage[] = [
    {
      id: 'nar-init-1',
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: openingLine,
      timestamp: ts,
      locationLabel: placeLabel,
    },
  ];

  if (protagonist.lastDialogue) {
    const colonIdx = protagonist.lastDialogue.indexOf(':');
    const speaker =
      colonIdx > 0 && colonIdx < 36
        ? protagonist.lastDialogue.slice(0, colonIdx).trim()
        : 'Çevreden Bir Ses';
    const line =
      colonIdx > 0 && colonIdx < 36
        ? protagonist.lastDialogue.slice(colonIdx + 1).trim()
        : protagonist.lastDialogue;

    messages.push({
      id: 'nar-init-2',
      role: 'dialogue',
      speaker,
      text: line,
      timestamp: ts,
      locationLabel: placeLabel,
      choices: buildContextualChoices(ctx),
    });
  } else {
    messages[0].choices = buildContextualChoices(ctx);
  }

  return messages;
}

export function createTravelNarrativeNotice(
  ctx: NarrativeContextInput,
  summaryText: string
): NarrativeMessage {
  return {
    id: makeMsgId('nar-trv'),
    role: 'narrator',
    speaker: 'Anlatıcı',
    text: summaryText,
    timestamp: formatGameDateTime(ctx.gameTimeMs),
    locationLabel: getPlaceLabel(ctx.currentLocation, ctx.currentMazgal),
    choices: buildContextualChoices(ctx),
  };
}

export function resolveNarrativeTurn(input: NarrativeTurnInput): NarrativeTurnOutput {
  const {
    rawText,
    protagonist,
    currentLocation,
    currentMazgal,
    allLocations,
    routes,
    activeWeatherKey,
    gameTimeMs,
  } = input;

  const trimmed = rawText.trim();
  const norm = normalizeTr(trimmed);
  const currentTs = formatGameDateTime(gameTimeMs);
  const currentPlace = getPlaceLabel(currentLocation, currentMazgal);

  const playerMsg: NarrativeMessage = {
    id: makeMsgId('plr'),
    role: 'player',
    speaker: protagonist.name,
    text: trimmed,
    timestamp: currentTs,
    locationLabel: currentPlace,
  };

  const mods = getProtagonistModifiers(protagonist, currentLocation, currentMazgal);
  const living = currentLocation?.livingState;
  const contactsHere = (protagonist.contacts ?? []).filter(
    (c) =>
      c.partyRelation !== 'independent' ||
      (currentLocation
        ? c.currentLocationId === currentLocation.id
        : c.currentMazgalId === currentMazgal.id)
  );
  const unitsHere = (protagonist.roamingUnits ?? []).filter(
    (u) => u.mazgalId === currentMazgal.id
  );

  // 1. Önce yer veya hareketli birim hedefleyen doğrudan seyahat niyeti var mı?
  if (includesAny(norm, ['yola cik', 'git', 'yuru', 'ilerle', 'istikametine'])) {
    const namedLoc = allLocations.find(
      (l) => l.id !== currentLocation?.id && norm.includes(normalizeTr(l.name.split(' ')[0]))
    );
    if (namedLoc) {
      return {
        appendedMessages: [playerMsg],
        nextProtagonist: protagonist,
        hoursSpent: 0,
        locationMoraleDelta: 0,
        travelToLocationId: namedLoc.id,
      };
    }

    const dirMap: Array<{ words: string[]; dir: string }> = [
      { words: ['kuzeybati'], dir: 'Kuzeybatı' },
      { words: ['kuzeydogu'], dir: 'Kuzeydoğu' },
      { words: ['guneybati'], dir: 'Güneybatı' },
      { words: ['guneydogu'], dir: 'Güneydoğu' },
      { words: ['kuzey'], dir: 'Kuzey' },
      { words: ['guney'], dir: 'Güney' },
      { words: ['dogu'], dir: 'Doğu' },
      { words: ['bati'], dir: 'Batı' },
    ];
    for (const d of dirMap) {
      if (includesAny(norm, d.words)) {
        const nb = currentMazgal.neighbors.find((n) => n.direction === d.dir);
        if (nb) {
          return {
            appendedMessages: [playerMsg],
            nextProtagonist: protagonist,
            hoursSpent: 0,
            locationMoraleDelta: 0,
            travelToMazgal: nb,
          };
        }
      }
    }
    const matchingCellNb = currentMazgal.neighbors.find((n) =>
      norm.includes(normalizeTr(n.id))
    );
    if (matchingCellNb) {
      return {
        appendedMessages: [playerMsg],
        nextProtagonist: protagonist,
        hoursSpent: 0,
        locationMoraleDelta: 0,
        travelToMazgal: matchingCellNb,
      };
    }
  }

  // 2. İsimle eşleşen yaşayan NPC veya yerleşim sakiniyle konuşma / flört / yüzleşme
  const matchedContact = contactsHere.find((c) =>
    norm.includes(normalizeTr(c.name.split(' ')[0]))
  );
  const isDialogueIntent =
    Boolean(matchedContact) ||
    trimmed.includes('"') ||
    includesAny(norm, [
      'konus',
      'sor',
      'sohbet',
      'flort',
      'bastan',
      'selam',
      'fisilda',
      'ikna',
      'yuzles',
      'pazarlik',
      'soyle',
      'de ',
      'seslen',
    ]);

  if (isDialogueIntent) {
    // Hareketli grup ismi geçiyorsa onunla etkileş
    const matchedUnit = unitsHere.find((u) =>
      norm.includes(normalizeTr(u.name.split(' ')[0]))
    );
    if (matchedUnit && !matchedContact) {
      const mode = includesAny(norm, ['eslik', 'yardim', 'koru']) ? 'escort_aid' : 'greet_trade';
      const nextMs = addGameHours(gameTimeMs, 1);
      const res = interactWithRoamingUnit(protagonist, matchedUnit.id, mode, currentMazgal, nextMs);
      const reply: NarrativeMessage = {
        id: makeMsgId('dlg'),
        role: 'dialogue',
        speaker: matchedUnit.name,
        text: res.message,
        timestamp: formatGameDateTime(nextMs),
        locationLabel: currentPlace,
        choices: buildContextualChoices({
          ...input,
          protagonist: res.nextProtagonist,
          gameTimeMs: nextMs,
        }),
      };
      return {
        appendedMessages: [playerMsg, reply],
        nextProtagonist: res.nextProtagonist,
        hoursSpent: 1,
        locationMoraleDelta: 0,
      };
    }

    const targetContact = matchedContact ?? contactsHere[0];
    if (targetContact) {
      let npcAction: NpcInteractionType = 'talk';
      if (includesAny(norm, ['bastan', 'op', 'yatak', 'arzula', 'kandir'])) {
        npcAction = 'seduce_or_charm';
      } else if (includesAny(norm, ['flort', 'iltifat', 'yaklas', 'sevgi', 'gulumse'])) {
        npcAction = 'flirt_or_romance';
      } else if (includesAny(norm, ['yuzles', 'tehdit', 'zorla', 'hesap sor', 'suphe'])) {
        npcAction = 'confront_or_test';
      }

      const nextMs = addGameHours(gameTimeMs, 1);
      const res = interactWithLivingNpc(
        protagonist,
        targetContact.id,
        npcAction,
        currentLocation,
        currentMazgal,
        nextMs,
        mods,
        routes,
        allLocations
      );
      const nextTs = formatGameDateTime(nextMs);
      const dlgMsg: NarrativeMessage = {
        id: makeMsgId('dlg'),
        role: 'dialogue',
        speaker: `${targetContact.name} (${targetContact.role})`,
        text: res.feedbackText,
        timestamp: nextTs,
        locationLabel: currentPlace,
        choices: buildContextualChoices({
          ...input,
          protagonist: res.nextProtagonist,
          gameTimeMs: nextMs,
        }),
      };
      return {
        appendedMessages: [playerMsg, dlgMsg],
        nextProtagonist: res.nextProtagonist,
        hoursSpent: res.hoursSpent,
        locationMoraleDelta: res.locationMoraleDelta ?? 0,
        locationNoteTitle: res.locationNoteTitle,
        locationNoteDetail: res.locationNoteDetail,
      };
    }

    // Yerleşimdeki bir sakin veya genel konuşma
    const nextMs = addGameHours(gameTimeMs, 1);
    const resident = living?.notableResidents.find((r) =>
      norm.includes(normalizeTr(r.name.split(' ')[0]))
    ) ?? living?.notableResidents[0];

    const outcome = performProtagonistAction(
      protagonist,
      'converse',
      currentLocation,
      currentMazgal,
      nextMs
    );
    const speakerName = resident
      ? `${resident.name} (${resident.role})`
      : currentLocation
      ? `${currentLocation.name} Sakini`
      : 'Rüzgar ve Yankı';

    const rumorSnippet =
      living && living.rumors.length > 0
        ? ` "${living.rumors[0]}"`
        : '';
    const problemSnippet =
      living && living.activeProblems.length > 0
        ? ` Ayrıca burada ${living.activeProblems[0].title.toLowerCase()} herkesin uykusunu kaçırıyor.`
        : '';

    const spokenReply = currentLocation
      ? `${outcome.nextProtagonist.lastDialogue}${rumorSnippet}${problemSnippet}`
      : 'Açık arazide sözlerin sisin içinde dağılıyor; yanında konuşacak kimse yoksa yalnızca rüzgar karşılık veriyor.';

    const dlgMsg: NarrativeMessage = {
      id: makeMsgId('dlg'),
      role: resident || currentLocation ? 'dialogue' : 'narrator',
      speaker: speakerName,
      text: spokenReply,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: outcome.nextProtagonist,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, dlgMsg],
      nextProtagonist: outcome.nextProtagonist,
      hoursSpent: ACTION_HOURS.converse,
      locationMoraleDelta: outcome.locationMoraleDelta,
      locationNoteTitle: `${protagonist.name} Sohbeti`,
      locationNoteDetail: outcome.locationEventNote,
    };
  }

  // 3. Yerleşim sorununa müdahale / yardım
  if (
    living &&
    living.activeProblems.length > 0 &&
    includesAny(norm, ['sorun', 'mesele', 'mudahale', 'yardim', 'coz', 'onar', 'koru', 'destek'])
  ) {
    const prob =
      living.activeProblems.find((p) => norm.includes(normalizeTr(p.title.split(' ')[0]))) ??
      living.activeProblems[0];
    const nextMs = addGameHours(gameTimeMs, 3);
    const attempt = resolveSettlementProblemAttempt(
      protagonist,
      currentLocation,
      prob.id,
      currentMazgal,
      nextMs
    );
    const narMsg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: attempt.message,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: attempt.nextProtagonist,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, narMsg],
      nextProtagonist: attempt.nextProtagonist,
      hoursSpent: 3,
      locationMoraleDelta: 0,
      solvedProblemId: attempt.solved ? prob.id : undefined,
      attemptedProblemId: !attempt.solved ? prob.id : undefined,
    };
  }

  // 4. Erzak / Şifalı Ot / Panzehir / Meşale kullanımı
  if (includesAny(norm, ['erzak', 'yemek ye', 'karnimi doyur', 'ekmek', 'peksimet'])) {
    if (protagonist.rations <= 0) {
      const emptyMsg: NarrativeMessage = {
        id: makeMsgId('nar'),
        role: 'narrator',
        speaker: 'Anlatıcı',
        text: 'Çantanı yokladın ama hiç kuru erzak kalmamış. Avlanman ya da bir yerleşimden erzak alman gerekecek.',
        timestamp: currentTs,
        locationLabel: currentPlace,
        choices: buildContextualChoices(input),
      };
      return {
        appendedMessages: [playerMsg, emptyMsg],
        nextProtagonist: protagonist,
        hoursSpent: 0,
        locationMoraleDelta: 0,
      };
    }
    const nextProtag: ProtagonistState = {
      ...protagonist,
      rations: protagonist.rations - 1,
      hunger: Math.max(0, protagonist.hunger - 45),
      stamina: Math.min(100, protagonist.stamina + 8),
      lastObservation: '1 porsiyon kuru erzak yedin; açlığın dindi ve gücün toplandı.',
    };
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: 'Kuru et ve peksimetten oluşan 1 porsiyon erzak tüketip suyla boğazını ıslattın. Gücün biraz yerine geldi.',
      timestamp: currentTs,
      locationLabel: currentPlace,
      choices: buildContextualChoices({ ...input, protagonist: nextProtag }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: nextProtag,
      hoursSpent: 0,
      locationMoraleDelta: 0,
    };
  }

  if (includesAny(norm, ['kekik', 'sargi', 'yara', 'sifa', 'iyiles'])) {
    const res = useInventoryItem(protagonist, 'healing_herb', gameTimeMs);
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: res.message,
      timestamp: currentTs,
      locationLabel: currentPlace,
      choices: buildContextualChoices({ ...input, protagonist: res.nextProtagonist }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: res.nextProtagonist,
      hoursSpent: 0,
      locationMoraleDelta: 0,
    };
  }

  if (includesAny(norm, ['panzehir', 'zehir', 'sitma'])) {
    const res = useInventoryItem(protagonist, 'antidote_vial', gameTimeMs);
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: res.message,
      timestamp: currentTs,
      locationLabel: currentPlace,
      choices: buildContextualChoices({ ...input, protagonist: res.nextProtagonist }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: res.nextProtagonist,
      hoursSpent: 0,
      locationMoraleDelta: 0,
    };
  }

  if (includesAny(norm, ['mesale', 'isik yak'])) {
    const res = useInventoryItem(protagonist, 'torch_bundle', gameTimeMs);
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: res.message,
      timestamp: currentTs,
      locationLabel: currentPlace,
      choices: buildContextualChoices({ ...input, protagonist: res.nextProtagonist }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: res.nextProtagonist,
      hoursSpent: 0,
      locationMoraleDelta: 0,
    };
  }

  // 5. Dinlenme / Kamp
  if (includesAny(norm, ['dinlen', 'uyu', 'kamp', 'yat', 'mola', 'gecele', 'ates yak'])) {
    const nextMs = addGameHours(gameTimeMs, ACTION_HOURS.rest_camp);
    const outcome = performProtagonistAction(
      protagonist,
      'rest_camp',
      currentLocation,
      currentMazgal,
      nextMs
    );
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: `${outcome.nextProtagonist.lastObservation} Kamp süresi geride kalırken çevre ${getDayPhaseLabel(nextMs).toLowerCase()} ışığına büründü.`,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: outcome.nextProtagonist,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: outcome.nextProtagonist,
      hoursSpent: ACTION_HOURS.rest_camp,
      locationMoraleDelta: outcome.locationMoraleDelta,
      locationNoteTitle: 'Kamp ve Dinlenme',
      locationNoteDetail: outcome.locationEventNote,
    };
  }

  // 6. Avlanma / Çalışma / Toplama
  if (includesAny(norm, ['avlan', 'av ', 'topla', 'calis', 'kazan', 'odun', 'balik'])) {
    const nextMs = addGameHours(gameTimeMs, ACTION_HOURS.forage_or_work);
    const outcome = performProtagonistAction(
      protagonist,
      'forage_or_work',
      currentLocation,
      currentMazgal,
      nextMs
    );
    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: outcome.nextProtagonist.lastObservation,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: outcome.nextProtagonist,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: outcome.nextProtagonist,
      hoursSpent: ACTION_HOURS.forage_or_work,
      locationMoraleDelta: outcome.locationMoraleDelta,
      locationNoteTitle: 'İş ve Av',
      locationNoteDetail: outcome.locationEventNote,
    };
  }

  // 7. Saldırı / Pusu / Hırsızlık / Kötülük / Zorlu Fiziksel Eylem
  if (
    includesAny(norm, [
      'saldir',
      'pusu',
      'kilic',
      'hancer',
      'vur',
      'cal',
      'gasp',
      'yagma',
      'kacir',
      'tutsak',
      'baskin',
      'oldur',
    ])
  ) {
    if (unitsHere.length > 0 && includesAny(norm, ['pusu', 'saldir', 'kilic', 'baskin', 'yagma'])) {
      const unit = unitsHere.find((u) => u.kind === 'raider') ?? unitsHere[0];
      const nextMs = addGameHours(gameTimeMs, 1);
      const res = interactWithRoamingUnit(
        protagonist,
        unit.id,
        'ambush_raid',
        currentMazgal,
        nextMs
      );
      const msg: NarrativeMessage = {
        id: makeMsgId('nar'),
        role: 'narrator',
        speaker: 'Anlatıcı',
        text: res.message,
        timestamp: formatGameDateTime(nextMs),
        locationLabel: currentPlace,
        choices: buildContextualChoices({
          ...input,
          protagonist: res.nextProtagonist,
          gameTimeMs: nextMs,
        }),
      };
      return {
        appendedMessages: [playerMsg, msg],
        nextProtagonist: res.nextProtagonist,
        hoursSpent: 1,
        locationMoraleDelta: 0,
      };
    }

    if (includesAny(norm, ['cal', 'hirsiz', 'kacir', 'tutsak', 'gasp'])) {
      const shadowKind = includesAny(norm, ['kacir', 'tutsak'])
        ? 'capture_captive'
        : includesAny(norm, ['gasp', 'harac'])
        ? 'extort_locals'
        : 'raid_supply';
      const nextMs = addGameHours(gameTimeMs, 2);
      const res = performShadowAction(
        protagonist,
        shadowKind,
        currentLocation,
        currentMazgal,
        nextMs,
        mods
      );
      const msg: NarrativeMessage = {
        id: makeMsgId('nar'),
        role: 'narrator',
        speaker: 'Anlatıcı',
        text: res.feedbackText,
        timestamp: formatGameDateTime(nextMs),
        locationLabel: currentPlace,
        choices: buildContextualChoices({
          ...input,
          protagonist: res.nextProtagonist,
          gameTimeMs: nextMs,
        }),
      };
      return {
        appendedMessages: [playerMsg, msg],
        nextProtagonist: res.nextProtagonist,
        hoursSpent: 2,
        locationMoraleDelta: res.locationMoraleDelta,
        locationNoteTitle: res.locationNoteTitle,
        locationNoteDetail: res.locationNoteDetail,
      };
    }

    // Genel taktik çarpışma / güç sınaması
    const nextMs = addGameHours(gameTimeMs, 1);
    const roll = rollDie(20);
    const total = roll + mods.physicalMod;
    const dc = 10 + currentMazgal.dangerLevel;
    const won = total >= dc;
    const dmg = won ? (roll >= 15 ? 0 : 6) : 14;
    const loot = won ? 2 + currentMazgal.dangerLevel : 0;

    const nextProtag: ProtagonistState = {
      ...protagonist,
      health: Math.max(10, protagonist.health - dmg),
      stamina: Math.max(5, protagonist.stamina - 14),
      silver: protagonist.silver + loot,
      lastUpdatedMs: nextMs,
    };

    const narText = won
      ? `Hızlı hamlenle tehlikeyi bastırdın (${roll}${mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod}=${total} vs DC ${dc}). Çatışma kısa sürdü${dmg > 0 ? `, sıyrıklarla ${dmg} can kaybettin` : ''} ve ${loot} gümüş değerinde ganimet topladın.`
      : `Hamlen beklediğin gibi gitmedi (${roll}${mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod}=${total} vs DC ${dc}). Karşı darbe seni geri püskürttü ve ${dmg} can yitirerek nefes nefese geri çekildin.`;

    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: narText,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: nextProtag,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: nextProtag,
      hoursSpent: 1,
      locationMoraleDelta: 0,
    };
  }

  // 8. Gözlem / İnceleme / İz sürme
  if (includesAny(norm, ['bak', 'gozle', 'incele', 'dinle', 'iz', 'ara', 'kesfet', 'kokla'])) {
    const nextMs = addGameHours(gameTimeMs, ACTION_HOURS.observe);
    const outcome = performProtagonistAction(
      protagonist,
      'observe',
      currentLocation,
      currentMazgal,
      nextMs
    );
    const roll = rollDie(20);
    const total = roll + mods.perceptionMod;
    const extraClues: string[] = [];
    if (unitsHere.length > 0) {
      extraClues.push(
        `Yakında ${unitsHere.map((u) => `${u.name} (${u.statusNote})`).join(' ve ')} hareket halinde.`
      );
    }
    if (total >= 13 && living && living.rumors.length > 0) {
      extraClues.push(`Dikkatli kulak kabartman sana şu söylentiyi yakalattı: "${living.rumors[0]}"`);
    } else if (total >= 12 && currentMazgal.neighborEffects.length > 0) {
      extraClues.push(currentMazgal.neighborEffects[0]);
    }
    if (protagonist.activeWorldWave) {
      extraClues.push(
        `Bölge genelinde "${protagonist.activeWorldWave.title}" etkisi hissediliyor.`
      );
    }

    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: [outcome.nextProtagonist.lastObservation, ...extraClues].join(' '),
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: outcome.nextProtagonist,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: outcome.nextProtagonist,
      hoursSpent: ACTION_HOURS.observe,
      locationMoraleDelta: outcome.locationMoraleDelta,
      locationNoteTitle: 'Çevre Gözlemi',
      locationNoteDetail: outcome.locationEventNote,
    };
  }

  // 9. Serbest rol yapma eylemi (Motor atmosferik tepki üretir)
  const companion = (protagonist.contacts ?? []).find(
    (c) => c.partyRelation === 'companion' || c.partyRelation === 'hired_by_player'
  );
  const weatherDesc = WEATHER_PROSE[activeWeatherKey];
  const atmosphere = currentLocation
    ? `${currentLocation.name} (${living?.mood ?? 'Temkinli'} hava) içinde ${weatherDesc} sürerken eylemin çevredeki bakışların kısa süreliğine sana çevrilmesine yol açtı.`
    : `Mazgal ${currentMazgal.id} (${currentMazgal.terrainLabel}) içinde ${weatherDesc} altında attığın her adım çiğnememiş toprak ve dallar arasında yankılanıyor.`;
  const companionNote = companion
    ? ` Yanındaki ${companion.name} başını kaldırıp durumunu tartıyor: "${companion.lastReaction}"`
    : '';

  const freeMsg: NarrativeMessage = {
    id: makeMsgId('nar'),
    role: 'narrator',
    speaker: 'Anlatıcı',
    text: `${atmosphere}${companionNote}`,
    timestamp: currentTs,
    locationLabel: currentPlace,
    choices: buildContextualChoices(input),
  };

  return {
    appendedMessages: [playerMsg, freeMsg],
    nextProtagonist: {
      ...protagonist,
      lastObservation: atmosphere,
    },
    hoursSpent: 0,
    locationMoraleDelta: 0,
  };
}
