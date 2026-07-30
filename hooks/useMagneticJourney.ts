'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export const DAILY_RESONANCE_TARGET = 5;

export const MAGNETIC_TITLES = [
  {
    id: 'observer',
    name: '磁场观测员',
    description: '完成第一次磁力捕获',
  },
  {
    id: 'aurora-hunter',
    name: '极光猎手',
    description: '捕获第一颗极光碎片',
  },
  {
    id: 'combo-runner',
    name: '磁场疾行者',
    description: '达成极速三连',
  },
  {
    id: 'core-resonator',
    name: '核心共鸣者',
    description: '完成 12 颗碎片主线',
  },
  {
    id: 'daily-echo',
    name: '每日回响者',
    description: '领取第一枚共鸣印记',
  },
] as const;

export const MAGNETIC_COSMETICS = [
  {
    id: 'default',
    name: '原初磁场',
    description: '最初的磁场光谱',
    threshold: 0,
  },
  {
    id: 'echo-glow',
    name: '回响徽光',
    description: '让行星周围浮现呼吸辉光',
    threshold: 1,
  },
  {
    id: 'aurora-spectrum',
    name: '极光色谱',
    description: '点亮青金双色极光',
    threshold: 3,
  },
  {
    id: 'twin-trail',
    name: '双星尾迹',
    description: '让双星沿额外轨道巡游',
    threshold: 7,
  },
  {
    id: 'eternal-crown',
    name: '永恒磁冠',
    description: '强化核心磁冠与共鸣光环',
    threshold: 14,
  },
] as const;

export type MagneticTitleId = (typeof MAGNETIC_TITLES)[number]['id'];
export type MagneticCosmeticId =
  (typeof MAGNETIC_COSMETICS)[number]['id'];

export type MusicCapsule = {
  id: string;
  songTitle: string;
  artist: string;
  lyric: string;
  mood: string;
  sealedAt: number;
  revealAt: number;
  openedAt: number;
};

export type BeatRating = 'perfect' | 'good' | 'miss';

export type MagneticJourney = {
  dateKey: string;
  dailyEnergy: number;
  lastClaimedDate: string;
  streakDays: number;
  resonanceMarks: number;
  totalCaptures: number;
  rareCaptures: number;
  bestCombo: number;
  hasFavoritedSong: boolean;
  fullPlayCount: number;
  dailyFullPlayCount: number;
  perfectBeatHits: number;
  goodBeatHits: number;
  beatChallengesCompleted: number;
  hiddenLyricCaptures: number;
  dailyEventCompleted: boolean;
  dailyEventSongs: string[];
  parallelThemeUntil: number;
  capsules: MusicCapsule[];
  equippedTitle: MagneticTitleId | '';
  equippedCosmetic: MagneticCosmeticId;
};

type CaptureInput = {
  energy: number;
  combo: number;
  isRare: boolean;
};

type ClaimResult = {
  streakDays: number;
  resonanceMarks: number;
};

type BeatOutcomeInput = {
  rating: BeatRating;
  isChallengeComplete: boolean;
  capturedHiddenLyric: boolean;
};

type CapsuleInput = {
  songTitle: string;
  artist: string;
  lyric: string;
  mood: string;
};

const STORAGE_KEY = 'magnetic-player-journey-v1';
const JOURNEY_CHANGE_EVENT = 'magnetic-journey-change';
const EMPTY_JOURNEY: MagneticJourney = {
  dateKey: '',
  dailyEnergy: 0,
  lastClaimedDate: '',
  streakDays: 0,
  resonanceMarks: 0,
  totalCaptures: 0,
  rareCaptures: 0,
  bestCombo: 0,
  hasFavoritedSong: false,
  fullPlayCount: 0,
  dailyFullPlayCount: 0,
  perfectBeatHits: 0,
  goodBeatHits: 0,
  beatChallengesCompleted: 0,
  hiddenLyricCaptures: 0,
  dailyEventCompleted: false,
  dailyEventSongs: [],
  parallelThemeUntil: 0,
  capsules: [],
  equippedTitle: '',
  equippedCosmetic: 'default',
};
const SERVER_SNAPSHOT = JSON.stringify(EMPTY_JOURNEY);
let memorySnapshot = SERVER_SNAPSHOT;

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPreviousDateKey() {
  const previousDate = new Date();
  previousDate.setDate(previousDate.getDate() - 1);
  return getLocalDateKey(previousDate);
}

function normalizeCount(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.floor(value)));
}

function normalizeText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeCapsules(value: unknown): MusicCapsule[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .map((capsule): MusicCapsule | null => {
      if (typeof capsule !== 'object' || capsule === null) return null;
      const source = capsule as Partial<MusicCapsule>;
      const id = normalizeText(source.id, 80);
      const mood = normalizeText(source.mood, 80);
      const songTitle = normalizeText(source.songTitle, 80);
      if (!id || !mood || !songTitle) return null;

      return {
        id,
        songTitle,
        artist: normalizeText(source.artist, 80),
        lyric: normalizeText(source.lyric, 160),
        mood,
        sealedAt: normalizeTimestamp(source.sealedAt),
        revealAt: normalizeTimestamp(source.revealAt),
        openedAt: normalizeTimestamp(source.openedAt),
      };
    })
    .filter((capsule): capsule is MusicCapsule => capsule !== null);
}

function isMagneticTitleId(value: unknown): value is MagneticTitleId {
  return MAGNETIC_TITLES.some((title) => title.id === value);
}

function isMagneticCosmeticId(
  value: unknown,
): value is MagneticCosmeticId {
  return MAGNETIC_COSMETICS.some((cosmetic) => cosmetic.id === value);
}

function normalizeJourney(value: unknown): MagneticJourney {
  const source =
    typeof value === 'object' && value !== null
      ? (value as Partial<MagneticJourney>)
      : {};
  const today = getLocalDateKey();
  const isCurrentDay = source.dateKey === today;

  return {
    dateKey: today,
    dailyEnergy: isCurrentDay
      ? normalizeCount(source.dailyEnergy, DAILY_RESONANCE_TARGET)
      : 0,
    lastClaimedDate:
      typeof source.lastClaimedDate === 'string'
        ? source.lastClaimedDate
        : '',
    streakDays: normalizeCount(source.streakDays),
    resonanceMarks: normalizeCount(source.resonanceMarks),
    totalCaptures: normalizeCount(source.totalCaptures),
    rareCaptures: normalizeCount(source.rareCaptures),
    bestCombo: normalizeCount(source.bestCombo),
    hasFavoritedSong: source.hasFavoritedSong === true,
    fullPlayCount: normalizeCount(source.fullPlayCount),
    dailyFullPlayCount: isCurrentDay
      ? normalizeCount(source.dailyFullPlayCount)
      : 0,
    perfectBeatHits: normalizeCount(source.perfectBeatHits),
    goodBeatHits: normalizeCount(source.goodBeatHits),
    beatChallengesCompleted: normalizeCount(
      source.beatChallengesCompleted,
    ),
    hiddenLyricCaptures: normalizeCount(source.hiddenLyricCaptures),
    dailyEventCompleted: isCurrentDay
      ? source.dailyEventCompleted === true
      : false,
    dailyEventSongs:
      isCurrentDay && Array.isArray(source.dailyEventSongs)
        ? source.dailyEventSongs
            .map((songTitle) => normalizeText(songTitle, 80))
            .filter(Boolean)
            .slice(0, 3)
        : [],
    parallelThemeUntil: normalizeTimestamp(source.parallelThemeUntil),
    capsules: normalizeCapsules(source.capsules),
    equippedTitle: isMagneticTitleId(source.equippedTitle)
      ? source.equippedTitle
      : '',
    equippedCosmetic: isMagneticCosmeticId(source.equippedCosmetic)
      ? source.equippedCosmetic
      : 'default',
  };
}

function parseJourney(snapshot: string) {
  try {
    return normalizeJourney(JSON.parse(snapshot));
  } catch {
    return normalizeJourney(null);
  }
}

function readJourneySnapshot() {
  try {
    const storedSnapshot = window.localStorage.getItem(STORAGE_KEY);
    memorySnapshot = JSON.stringify(
      parseJourney(storedSnapshot ?? memorySnapshot),
    );
  } catch {
    memorySnapshot = JSON.stringify(parseJourney(memorySnapshot));
  }

  return memorySnapshot;
}

function writeJourneySnapshot(journey: MagneticJourney) {
  memorySnapshot = JSON.stringify(normalizeJourney(journey));
  try {
    window.localStorage.setItem(STORAGE_KEY, memorySnapshot);
  } catch {
    // 存储不可用时仍保留当前页面内的进度，不阻塞音乐播放。
  }
  window.dispatchEvent(new Event(JOURNEY_CHANGE_EVENT));
}

function subscribeToJourney(onStoreChange: () => void) {
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener(JOURNEY_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener(JOURNEY_CHANGE_EVENT, onStoreChange);
  };
}

export function useMagneticJourney() {
  const journeySnapshot = useSyncExternalStore(
    subscribeToJourney,
    readJourneySnapshot,
    () => SERVER_SNAPSHOT,
  );
  const journey = parseJourney(journeySnapshot);
  const isDailyRewardClaimed =
    journey.lastClaimedDate === journey.dateKey;
  const isDailyMissionComplete =
    journey.dailyEnergy >= DAILY_RESONANCE_TARGET;

  useEffect(() => {
    const nextDay = new Date();
    nextDay.setHours(24, 0, 1, 0);
    const rolloverTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event(JOURNEY_CHANGE_EVENT));
    }, nextDay.getTime() - Date.now());

    return () => window.clearTimeout(rolloverTimer);
  }, [journey.dateKey]);

  const recordCapture = useCallback(
    ({ energy, combo, isRare }: CaptureInput) => {
      const currentJourney = parseJourney(readJourneySnapshot());
      writeJourneySnapshot({
        ...currentJourney,
        dailyEnergy: Math.min(
          DAILY_RESONANCE_TARGET,
          currentJourney.dailyEnergy + normalizeCount(energy),
        ),
        totalCaptures: currentJourney.totalCaptures + 1,
        rareCaptures:
          currentJourney.rareCaptures + (isRare ? 1 : 0),
        bestCombo: Math.max(
          currentJourney.bestCombo,
          normalizeCount(combo),
        ),
      });
    },
    [],
  );

  const claimDailyReward = useCallback((): ClaimResult | null => {
    const currentJourney = parseJourney(readJourneySnapshot());
    const canClaim =
      currentJourney.dailyEnergy >= DAILY_RESONANCE_TARGET &&
      currentJourney.lastClaimedDate !== currentJourney.dateKey;

    if (!canClaim) return null;

    const nextStreakDays =
      currentJourney.lastClaimedDate === getPreviousDateKey()
        ? currentJourney.streakDays + 1
        : 1;
    const nextJourney = {
      ...currentJourney,
      lastClaimedDate: currentJourney.dateKey,
      streakDays: nextStreakDays,
      resonanceMarks: currentJourney.resonanceMarks + 1,
      equippedCosmetic:
        currentJourney.resonanceMarks === 0
          ? ('echo-glow' as const)
          : currentJourney.equippedCosmetic,
    };

    writeJourneySnapshot(nextJourney);
    return {
      streakDays: nextJourney.streakDays,
      resonanceMarks: nextJourney.resonanceMarks,
    };
  }, []);

  const recordFavorite = useCallback(() => {
    const currentJourney = parseJourney(readJourneySnapshot());
    if (currentJourney.hasFavoritedSong) return;
    writeJourneySnapshot({
      ...currentJourney,
      hasFavoritedSong: true,
    });
  }, []);

  const recordFullPlay = useCallback(() => {
    const currentJourney = parseJourney(readJourneySnapshot());
    writeJourneySnapshot({
      ...currentJourney,
      fullPlayCount: currentJourney.fullPlayCount + 1,
      dailyFullPlayCount: currentJourney.dailyFullPlayCount + 1,
    });
  }, []);

  const recordBeatOutcome = useCallback(
    ({
      rating,
      isChallengeComplete,
      capturedHiddenLyric,
    }: BeatOutcomeInput) => {
      const currentJourney = parseJourney(readJourneySnapshot());
      writeJourneySnapshot({
        ...currentJourney,
        perfectBeatHits:
          currentJourney.perfectBeatHits +
          (rating === 'perfect' ? 1 : 0),
        goodBeatHits:
          currentJourney.goodBeatHits + (rating === 'good' ? 1 : 0),
        beatChallengesCompleted:
          currentJourney.beatChallengesCompleted +
          (isChallengeComplete ? 1 : 0),
        hiddenLyricCaptures:
          currentJourney.hiddenLyricCaptures +
          (capturedHiddenLyric ? 1 : 0),
      });
    },
    [],
  );

  const addDailyEventSong = useCallback((songTitle: string) => {
    const currentJourney = parseJourney(readJourneySnapshot());
    const normalizedSongTitle = normalizeText(songTitle, 80);
    if (!normalizedSongTitle) return currentJourney.dailyEventSongs;
    const nextSongs = Array.from(
      new Set([...currentJourney.dailyEventSongs, normalizedSongTitle]),
    ).slice(0, 3);
    writeJourneySnapshot({
      ...currentJourney,
      dailyEventSongs: nextSongs,
      dailyEventCompleted:
        currentJourney.dailyEventCompleted || nextSongs.length >= 3,
    });
    return nextSongs;
  }, []);

  const completeDailyEvent = useCallback(() => {
    const currentJourney = parseJourney(readJourneySnapshot());
    if (currentJourney.dailyEventCompleted) return;
    writeJourneySnapshot({
      ...currentJourney,
      dailyEventCompleted: true,
    });
  }, []);

  const activateParallelTheme = useCallback(() => {
    const currentJourney = parseJourney(readJourneySnapshot());
    writeJourneySnapshot({
      ...currentJourney,
      dailyEventCompleted: true,
      parallelThemeUntil: Date.now() + 3 * 60 * 1000,
    });
  }, []);

  const sealCapsule = useCallback(
    ({
      songTitle,
      artist,
      lyric,
      mood,
    }: CapsuleInput): MusicCapsule | null => {
      const normalizedMood = normalizeText(mood, 80);
      const normalizedSongTitle = normalizeText(songTitle, 80);
      if (!normalizedMood || !normalizedSongTitle) return null;

      const currentJourney = parseJourney(readJourneySnapshot());
      const sealedAt = Date.now();
      const capsule: MusicCapsule = {
        id: `${sealedAt.toString(36)}-${currentJourney.capsules.length}`,
        songTitle: normalizedSongTitle,
        artist: normalizeText(artist, 80),
        lyric: normalizeText(lyric, 160),
        mood: normalizedMood,
        sealedAt,
        revealAt: sealedAt + 7 * 24 * 60 * 60 * 1000,
        openedAt: 0,
      };

      writeJourneySnapshot({
        ...currentJourney,
        capsules: [...currentJourney.capsules, capsule].slice(-12),
      });
      return capsule;
    },
    [],
  );

  const openCapsule = useCallback((capsuleId: string) => {
    const currentJourney = parseJourney(readJourneySnapshot());
    writeJourneySnapshot({
      ...currentJourney,
      capsules: currentJourney.capsules.map((capsule) =>
        capsule.id === capsuleId
          ? { ...capsule, openedAt: Date.now() }
          : capsule,
      ),
    });
  }, []);

  const equipTitle = useCallback((titleId: MagneticTitleId) => {
    const currentJourney = parseJourney(readJourneySnapshot());
    writeJourneySnapshot({
      ...currentJourney,
      equippedTitle: titleId,
    });
  }, []);

  const equipCosmetic = useCallback(
    (cosmeticId: MagneticCosmeticId) => {
      const currentJourney = parseJourney(readJourneySnapshot());
      writeJourneySnapshot({
        ...currentJourney,
        equippedCosmetic: cosmeticId,
      });
    },
    [],
  );

  const resetJourney = useCallback(() => {
    writeJourneySnapshot(normalizeJourney(null));
  }, []);

  return {
    journey,
    isDailyMissionComplete,
    isDailyRewardClaimed,
    recordCapture,
    claimDailyReward,
    recordFavorite,
    recordFullPlay,
    recordBeatOutcome,
    addDailyEventSong,
    completeDailyEvent,
    activateParallelTheme,
    sealCapsule,
    openCapsule,
    equipTitle,
    equipCosmetic,
    resetJourney,
  };
}
