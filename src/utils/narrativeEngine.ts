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
  getHoursWithoutSleep,
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWordPrefix(normText: string, prefixes: string[]): boolean {
  return prefixes.some((p) => {
    const clean = normalizeTr(p);
    if (!clean) return false;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}`);
    return re.test(normText);
  });
}

function hasExactWord(normText: string, words: string[]): boolean {
  return words.some((w) => {
    const clean = normalizeTr(w);
    if (!clean) return false;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`);
    return re.test(normText);
  });
}

function getPlaceLabel(location: MapLocation | undefined, cell: MazgalCell): string {
  return location ? location.name : cell.terrainLabel;
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
    const originKnown =
      Boolean(currentLocation?.discovered) ||
      allLocations.some(
        (l) => l.discovered && l.id === unit.currentLocationId
      );
    if (unit.kind === 'raider') {
      const labelTarget = originKnown ? unit.name : 'silahlı karartılara';
      choices.push({
        id: `ch-unit-${unit.id}`,
        label: originKnown ? `Pusu kur: ${unit.name}` : 'Yakındaki tehlikeye pusu kur',
        actionPrompt: `${labelTarget} karşı pusu kurup saldırıya geçiyorum.`,
        kind: 'risk',
      });
    } else {
      const genericRole =
        unit.kind === 'caravan'
          ? 'kervana'
          : unit.kind === 'patrol'
          ? 'devriyeye'
          : 'gözcülere';
      choices.push({
        id: `ch-unit-${unit.id}`,
        label: originKnown ? `Yaklaş ve konuş: ${unit.name}` : `Yoldaki ${genericRole} yaklaş`,
        actionPrompt: originKnown
          ? `${unit.name} grubuna yaklaşıp yol ve takas hakkında konuşuyorum.`
          : `Yoldaki ${genericRole} temkinli biçimde yaklaşıp sesleniyorum.`,
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

  // 4. Sağlık / Yorgunluk / Uykusuzluk durumu
  const hoursAwake = getHoursWithoutSleep(protagonist, ctx.gameTimeMs);
  if (protagonist.health <= 60 && (protagonist.inventory ?? []).some((i) => i.id === 'healing_herb' && i.qty > 0)) {
    choices.push({
      id: 'ch-heal',
      label: 'Şifalı kekiği kullan ve yarayı sar',
      actionPrompt: 'Çantamdaki şifalı dağ kekiğini çıkarıp yaralarımı sarıyorum.',
      kind: 'rest',
    });
  } else if (hoursAwake >= 22 || protagonist.stamina <= 42) {
    choices.push({
      id: 'ch-rest',
      label: hoursAwake >= 40 ? 'Hemen dur, kamp kur ve uyu' : 'Kamp kur ve uyu',
      actionPrompt:
        hoursAwake >= 40
          ? 'Gözlerim kapanıyor; daha fazla dayanacak halim kalmadı, kuytu bir yer bulup uyumaya çekiliyorum.'
          : 'Güvenli bir köşe bulup kamp kurarak uyuyup dinlenmeye çekiliyorum.',
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
      const linkedDiscovered = routes
        .filter((r) => r.fromId === currentLocation.id || r.toId === currentLocation.id)
        .map((r) => {
          const destId = r.fromId === currentLocation.id ? r.toId : r.fromId;
          return allLocations.find((l) => l.id === destId && l.discovered);
        })
        .find((l): l is MapLocation => Boolean(l));

      if (linkedDiscovered) {
        choices.push({
          id: `ch-move-${linkedDiscovered.id}`,
          label: `${linkedDiscovered.name} yönüne yola çık`,
          actionPrompt: `${linkedDiscovered.name} istikametine doğru yola çıkıyorum.`,
          kind: 'travel',
        });
      } else if (currentMazgal.neighbors.length > 0) {
        const nb = currentMazgal.neighbors[0];
        const visitedSet = new Set(protagonist.visitedMazgalIds ?? [currentMazgal.id]);
        const phase = getDayPhaseLabel(ctx.gameTimeMs);
        const canSeeTerrain =
          visitedSet.has(nb.id) ||
          (phase !== 'Gece' && phase !== 'Gece Yarısı' && currentMazgal.visibilityMeters >= 45);
        choices.push({
          id: `ch-step-${nb.id}`,
          label: canSeeTerrain
            ? `${nb.direction} yönüne doğru ilerle (${nb.terrainLabel})`
            : `${nb.direction} yönüne doğru ilerle`,
          actionPrompt: `${nb.direction} yönüne doğru ilerliyorum.`,
          kind: 'travel',
        });
      }
    } else if (currentMazgal.neighbors.length > 0) {
      const nb = currentMazgal.neighbors[0];
      const visitedSet = new Set(protagonist.visitedMazgalIds ?? [currentMazgal.id]);
      const phase = getDayPhaseLabel(ctx.gameTimeMs);
      const canSeeTerrain =
        visitedSet.has(nb.id) ||
        (phase !== 'Gece' && phase !== 'Gece Yarısı' && currentMazgal.visibilityMeters >= 45);
      choices.push({
        id: `ch-step-${nb.id}`,
        label: canSeeTerrain
          ? `${nb.direction} yönüne doğru ilerle (${nb.terrainLabel})`
          : `${nb.direction} yönüne doğru ilerle`,
        actionPrompt: `${nb.direction} yönüne doğru ilerliyorum.`,
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

  const isEsrefAwakening =
    !currentLocation &&
    currentMazgal.id === 'G4' &&
    protagonist.activeConditions.includes('Hafıza Kaybı');

  if (isEsrefAwakening) {
    return [
      {
        id: 'nar-init-1',
        role: 'narrator',
        speaker: 'Anlatıcı',
        text: `Sisli Doğu Ormanı'nın derinliklerinde, dev çam ve meşelerin altındaki nemli yosunların üzerinde ${phase.toLowerCase()} vakti ${weatherDesc} içinde gözlerini açıyorsun. Geçmişin, buraya nasıl düştüğün ve kim olduğun zihninde karanlık bir boşluktan ibaret; hatırladığın tek gerçek, adının Eşref olduğu. 18 yaşındaki esmer, 185 cm boyunda ve atletik yapılı bedenin serin orman rüzgarıyla ürperirken ayağa kalkıp çevreni tartıyorsun.`,
        timestamp: ts,
        locationLabel: placeLabel,
        choices: [
          {
            id: 'ch-g4-inspect',
            label: 'Üstünü başını yokla ve izleri incele',
            actionPrompt: 'Üstümü başımı, ceplerimi ve yosunların üzerindeki izleri dikkatle inceliyorum.',
            kind: 'observe',
          },
          {
            id: 'ch-g4-climb',
            label: 'Yüksek bir çama tırmanıp yönünü kestir',
            actionPrompt: 'Atletik çevikliğimle yüksek bir çam ağacına tırmanıp çevrede duman veya yerleşim arıyorum.',
            kind: 'observe',
          },
          {
            id: 'ch-g4-south',
            label: 'Güney yönüne, orman derinliğine doğru yürü',
            actionPrompt: 'Güney yönüne doğru ormanın içinden ilerliyorum.',
            kind: 'travel',
          },
          {
            id: 'ch-g4-east',
            label: 'Doğu yönüne, ağaçların arasından patika ara',
            actionPrompt: 'Doğu yönüne doğru patika arayarak ilerliyorum.',
            kind: 'travel',
          },
        ],
      },
    ];
  }

  const openingLine = currentLocation
    ? `${currentLocation.name} eşiğinde ${phase.toLowerCase()} vakti ${weatherDesc} hakim. ${protagonist.lastObservation}`
    : `${currentMazgal.terrainLabel} boyunca ${phase.toLowerCase()} vakti ${weatherDesc} sürüyor. ${currentMazgal.summary}`;

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

  const { chosenOption } = input;
  const forceObserve = chosenOption?.kind === 'observe';

  // 1. Önce yer veya hareketli birim hedefleyen doğrudan seyahat niyeti var mı?
  if (!forceObserve && includesAny(norm, ['yola cik', 'git', 'gid', 'yuru', 'ilerle', 'istikametine'])) {
    const namedLoc = allLocations.find(
      (l) =>
        l.discovered &&
        l.id !== currentLocation?.id &&
        norm.includes(normalizeTr(l.name.split(' ')[0]))
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
      { words: ['kuzeybati', 'kuzey bati'], dir: 'Kuzeybatı' },
      { words: ['kuzeydogu', 'kuzey dogu'], dir: 'Kuzeydoğu' },
      { words: ['guneybati', 'guney bati'], dir: 'Güneybatı' },
      { words: ['guneydogu', 'guney dogu'], dir: 'Güneydoğu' },
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
    hasWordPrefix(norm, [c.name.split(' ')[0]])
  );
  const isDialogueIntent =
    !forceObserve &&
    (Boolean(matchedContact) ||
      trimmed.includes('"') ||
      (hasWordPrefix(norm, ['sor']) && !hasWordPrefix(norm, ['sorun'])) ||
      hasExactWord(norm, ['de']) ||
      includesAny(norm, [
        'konus',
        'sohbet',
        'flort',
        'bastan',
        'selam',
        'fisilda',
        'ikna',
        'yuzles',
        'pazarlik',
        'soyle',
        'seslen',
      ]));

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
  if (
    !forceObserve &&
    (hasExactWord(norm, ['av', 'avi']) ||
      hasWordPrefix(norm, ['avlan', 'avla']) ||
      includesAny(norm, ['topla', 'calis', 'kazan', 'odun', 'balik']))
  ) {
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

  // 8. Gözlem / İnceleme / İz sürme / Hafıza ve cep yoklama
  if (
    forceObserve ||
    hasWordPrefix(norm, ['iz', 'bak', 'goz', 'ara']) ||
    includesAny(norm, [
      'incele',
      'dinle',
      'kesfet',
      'kokla',
      'yokla',
      'cep',
      'ceb',
      'ustumu',
      'kiyafet',
      'hafiza',
      'kimim',
      'tirman',
      'gozetle',
    ])
  ) {
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
    const modLabel =
      mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : `${mods.perceptionMod}`;
    const isSelfInspect = includesAny(norm, [
      'yokla',
      'cep',
      'ceb',
      'ustumu',
      'kiyafet',
      'hafiza',
      'kimim',
    ]);
    const isClimbing = includesAny(norm, ['tirman', 'agac']) && !currentLocation;

    const parts: string[] = [];

    const phaseNow = getDayPhaseLabel(gameTimeMs);
    const isNightNow = phaseNow === 'Gece' || phaseNow === 'Gece Yarısı';
    const hasTorchNow = (protagonist.activeConditions ?? []).includes('Meşale Işığı');
    const effVisNow = isNightNow
      ? hasTorchNow
        ? Math.min(18, currentMazgal.visibilityMeters)
        : Math.min(5, currentMazgal.visibilityMeters)
      : currentMazgal.visibilityMeters;

    if (isClimbing) {
      parts.push(
        !isNightNow && effVisNow >= 45
          ? `185 cm boyun ve atletik çevikliğinle kalın dallara tutunup yüksek bir çamın tepesine yükseldiğinde (Algı ${roll}${modLabel}=${total}), sisin inceldiği noktalarda yalnızca yakın çevredeki ağaç örtüsünün kıvrımlarını seçebiliyorsun.`
          : `185 cm boyun ve atletik çevikliğinle yüksek bir ağaca tırmansan da (Algı ${roll}${modLabel}=${total}), ${
              isNightNow && !hasTorchNow
                ? 'gece karanlığı'
                : `yaklaşık ${effVisNow} metrelik yoğun doğu sisi`
            } ötesini örtüyor; uzak yapılar veya yerleşimler görünmüyor.`
      );
    } else if (isSelfInspect) {
      parts.push(
        `Üstünü başını yokladığında üzerinde koyu renk, dayanıklı ama işaret taşımayan bir yolcu tuniği, belinde dengeli bir kısa kılıç, kesende ${protagonist.silver} gümüş sikke ve çantanda ${protagonist.rations} porsiyon kuru erzak buluyorsun. Kıyafetlerinde ne bir aile arması ne de bir mektup var; zihnin ise yalnızca "Eşref" adını fısıldıyor.`
      );
      if (includesAny(norm, ['yosun']) || hasWordPrefix(norm, ['iz'])) {
        parts.push(
          total >= 12
            ? `Çömelip yosunları dikkatle incelediğinde (Algı ${roll}${modLabel}=${total}) çam diplerinden güneye doğru uzanan aceleyle bırakılmış iki çift bot izi ve kırık bir dal parçası fark ediyorsun.`
            : `Nemli yosunların üzerinde kendi düşüşünden kalan ezik dışında izler çiğ ile silinmiş (Algı ${roll}${modLabel}=${total}).`
        );
      }
    } else {
      parts.push(outcome.nextProtagonist.lastObservation);
      if (!currentLocation) {
        if (total >= 13) {
          const nearHint =
            !isNightNow && effVisNow >= 45 && currentMazgal.neighbors[0]
              ? `${currentMazgal.neighbors[0].direction} yönünde ${currentMazgal.neighbors[0].terrainLabel.toLowerCase()} başlıyor.`
              : '';
          parts.push(
            `Keskin gözlemin (Algı ${roll}${modLabel}=${total}) yakın çevredeki detayları yakalıyor: etrafta ${currentMazgal.resourceYield.toLowerCase()} izleri var. ${nearHint}`.trim()
          );
        } else {
          parts.push(
            `Dikkatle kulak kabartsan da (Algı ${roll}${modLabel}=${total}) yoğun doğu sisi rüzgar dışındaki sesleri boğuyor.`
          );
        }
      }
    }

    if (unitsHere.length > 0) {
      const unitDesc = unitsHere
        .map((u) => {
          const known =
            Boolean(currentLocation?.discovered) ||
            allLocations.some((l) => l.discovered && l.id === u.currentLocationId);
          if (known) return `${u.name} (${u.statusNote})`;
          return u.kind === 'raider'
            ? 'sis içinde beliren silahlı karartılar'
            : u.kind === 'caravan'
            ? 'yüklü yabancı bir kervan'
            : 'yakında hareket eden silahlı bir devriye';
        })
        .join(' ve ');
      parts.push(`Yakında ${unitDesc} hareket halinde.`);
    }
    if (total >= 13 && living && living.rumors.length > 0) {
      let rumorText = living.rumors[0];
      for (const loc of allLocations) {
        if (loc.discovered || loc.id === currentLocation?.id) continue;
        rumorText = rumorText.replace(new RegExp(escapeRegExp(loc.name), 'gi'), 'bilinmeyen bir yer');
      }
      parts.push(`Dikkatli kulak kabartman sana şu söylentiyi yakalattı: "${rumorText}"`);
    } else if (total >= 12 && currentMazgal.neighborEffects.length > 0) {
      parts.push(currentMazgal.neighborEffects[0]);
    }
    if (protagonist.activeWorldWave) {
      parts.push(
        currentLocation?.discovered
          ? `Bölge genelinde "${protagonist.activeWorldWave.title}" etkisi hissediliyor.`
          : 'Bölge genelinde olağan dışı bir tedirginlik ve hareketlilik hissediliyor.'
      );
    }

    const finalObservationText = parts.join(' ');
    const updatedProtag: ProtagonistState = {
      ...outcome.nextProtagonist,
      lastObservation: finalObservationText,
    };

    const msg: NarrativeMessage = {
      id: makeMsgId('nar'),
      role: 'narrator',
      speaker: 'Anlatıcı',
      text: finalObservationText,
      timestamp: formatGameDateTime(nextMs),
      locationLabel: currentPlace,
      choices: buildContextualChoices({
        ...input,
        protagonist: updatedProtag,
        gameTimeMs: nextMs,
      }),
    };
    return {
      appendedMessages: [playerMsg, msg],
      nextProtagonist: updatedProtag,
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
    : `${currentMazgal.terrainLabel} içinde ${weatherDesc} altında attığın her adım çiğnememiş toprak ve dallar arasında yankılanıyor.`;
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
