'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  DAILY_RESONANCE_TARGET,
  MAGNETIC_COSMETICS,
  MAGNETIC_TITLES,
  type BeatRating,
  type MagneticCosmeticId,
  type MagneticTitleId,
  useMagneticJourney,
} from '@/hooks/useMagneticJourney';
import {
  MAGNETIC_STAGES,
  MAX_MAGNETIC_SHARDS,
  getMagneticStageIndex,
  useMagneticProgress,
} from '@/hooks/useMagneticProgress';
import styles from './MagneticDiscovery.module.css';

type MagneticDiscoveryProps = {
  isPlaying: boolean;
  isMoving: boolean;
  isFavorite: boolean;
  playbackDetail: {
    currentTime: number;
    duration: number;
    progress: number;
    title: string;
    artist: string;
    lyric: string;
  };
  songCatalog: Array<{
    title: string;
    artist: string;
  }>;
};

type ActiveFragment = {
  id: number;
  slotIndex: number;
  spawnedAt: number;
  isRare: boolean;
};

type DetailTab =
  | 'progress'
  | 'planet'
  | 'daily'
  | 'capsule'
  | 'signals'
  | 'archive';

type RewardReveal = {
  eyebrow: string;
  title: string;
  description: string;
};

type BeatChallenge = {
  chorusIndex: number;
  noteIndex: number;
  hits: BeatRating[];
  noteSpawnedAt: number;
};

type UniverseEventId =
  | 'meteor'
  | 'storm'
  | 'black-hole'
  | 'letter'
  | 'parallel';

type AnonymousResonance = {
  id: string;
  message: string;
  detail: string;
};

const FRAGMENT_SLOTS = [
  { x: '29%', y: '22%' },
  { x: '43%', y: '15%' },
  { x: '63%', y: '21%' },
  { x: '69%', y: '64%' },
  { x: '40%', y: '76%' },
  { x: '26%', y: '69%' },
] as const;

const QUICK_CAPTURE_WINDOW = 2400;
const COMBO_CHAIN_WINDOW = 7000;
const DETAIL_TABS = [
  ['progress', '磁场'],
  ['planet', '星球'],
  ['daily', '今日'],
  ['capsule', '胶囊'],
  ['signals', '信号'],
  ['archive', '仓库'],
] as const;
const CHORUS_PROGRESS_POINTS = [0.34, 0.72] as const;
const BEAT_NOTE_COUNT = 3;
const BEAT_TARGET_TIME = 1500;
const BEAT_NOTE_LIFETIME = 3000;
const DAILY_UNIVERSE_EVENTS: Array<{
  id: UniverseEventId;
  name: string;
  eyebrow: string;
  description: string;
}> = [
  {
    id: 'meteor',
    name: '流星雨',
    eyebrow: 'METEOR SHOWER',
    description: '今日普通碎片与节拍奖励翻倍，达到 5 点后结束。',
  },
  {
    id: 'storm',
    name: '磁暴',
    eyebrow: 'MAGNETIC STORM',
    description: '下一次副歌节拍捕获会强化裂缝与爆发动画。',
  },
  {
    id: 'black-hole',
    name: '黑洞',
    eyebrow: 'BLACK HOLE',
    description: '投入三首不同歌曲，从本地曲目中生成一首神秘推荐。',
  },
  {
    id: 'letter',
    name: '星球来信',
    eyebrow: 'PLANET LETTER',
    description: '今日完整听完一首歌后，收到一句星球留言。',
  },
  {
    id: 'parallel',
    name: '平行宇宙',
    eyebrow: 'PARALLEL UNIVERSE',
    description: '开启一套持续三分钟的平行磁场视觉。',
  },
];
const PLANET_HATCH_STAGES = [
  {
    name: '沉睡星球',
    condition: '初始形态',
  },
  {
    name: '裂缝出现',
    condition: '捕获任意碎片 1 次',
  },
  {
    name: '核心发光',
    condition: '收藏任意歌曲 1 次',
  },
  {
    name: '磁场觉醒',
    condition: '完整播放歌曲 1 次',
  },
  {
    name: '星环展开',
    condition: '完成一轮副歌节拍捕获',
  },
  {
    name: '歌曲专属形态',
    condition: '收藏 + 完整播放 3 次 + 隐藏歌词',
  },
] as const;
const ANONYMOUS_RESONANCES: AnonymousResonance[] = [
  {
    id: 'same-line',
    message: '有人也在这一句停留',
    detail: '匿名共振 · “这一刻像被磁场轻轻拉住”',
  },
  {
    id: 'night-listener',
    message: '远方听众留下了一点微光',
    detail: '匿名共振 · “今晚想把这首歌再听一遍”',
  },
  {
    id: 'parallel-heartbeat',
    message: '另一颗星球与你同频',
    detail: '匿名共振 · “副歌响起时，心跳刚好重合”',
  },
];
const SECRET_SIGNALS = [
  {
    id: 'signal-06',
    threshold: 6,
    code: 'SIGNAL 06',
    title: '逆向引力',
    message: '你追逐的光，也正在靠近你。',
  },
  {
    id: 'signal-12',
    threshold: 12,
    code: 'SIGNAL 12',
    title: '轨道闭环',
    message: '磁场完成闭环，下一段轨道已经显现。',
  },
  {
    id: 'signal-20',
    threshold: 20,
    code: 'SIGNAL 20',
    title: '明日坐标',
    message: '明日回响会记得今天留下的坐标。',
  },
] as const;
const COSMETIC_CLASS_NAMES: Partial<
  Record<MagneticCosmeticId, string>
> = {
  'echo-glow': styles.cosmeticEcho,
  'aurora-spectrum': styles.cosmeticAurora,
  'twin-trail': styles.cosmeticTwin,
  'eternal-crown': styles.cosmeticCrown,
};
const COSMETIC_PREVIEW_CLASS_NAMES: Record<
  MagneticCosmeticId,
  string
> = {
  default: styles.previewDefault,
  'echo-glow': styles.previewEcho,
  'aurora-spectrum': styles.previewAurora,
  'twin-trail': styles.previewTwin,
  'eternal-crown': styles.previewCrown,
};
const RESONANCE_NODES = [
  'node-a',
  'node-b',
  'node-c',
  'node-d',
  'node-e',
  'node-f',
] as const;

function getDailyUniverseEvent(dateKey: string) {
  const hash = Array.from(dateKey).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return DAILY_UNIVERSE_EVENTS[
    hash % DAILY_UNIVERSE_EVENTS.length
  ]!;
}

export default function MagneticDiscovery({
  isPlaying,
  isMoving,
  isFavorite,
  playbackDetail,
  songCatalog,
}: MagneticDiscoveryProps) {
  const {
    shardCount,
    stageIndex,
    currentStage,
    nextStage,
    collectShards,
    resetProgress,
  } = useMagneticProgress();
  const {
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
  } = useMagneticJourney();
  const [activeFragment, setActiveFragment] =
    useState<ActiveFragment | null>(null);
  const [sessionCaptureCount, setSessionCaptureCount] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('progress');
  const [feedback, setFeedback] = useState('');
  const [comboCount, setComboCount] = useState(0);
  const [rewardReveal, setRewardReveal] =
    useState<RewardReveal | null>(null);
  const [celebratingStageIndex, setCelebratingStageIndex] =
    useState<number | null>(null);
  const [beatChallenge, setBeatChallenge] =
    useState<BeatChallenge | null>(null);
  const [beatFeedback, setBeatFeedback] = useState('');
  const [isBeatBurstActive, setIsBeatBurstActive] = useState(false);
  const [capsuleMood, setCapsuleMood] = useState('');
  const [anonymousResonance, setAnonymousResonance] =
    useState<AnonymousResonance | null>(null);
  const [isResonanceOpen, setIsResonanceOpen] = useState(false);
  const [parallelThemeNow, setParallelThemeNow] = useState(0);
  const fragmentIdRef = useRef(0);
  const lastSlotIndexRef = useRef(-1);
  const lastCaptureAtRef = useRef(0);
  const seenChorusesRef = useRef(new Set<number>());
  const previousPlaybackTimeRef = useRef(0);
  const previousSongTitleRef = useRef('');
  const fullPlayRecordedRef = useRef(false);
  const favoriteRecordedRef = useRef(false);

  const hasCompletedJourney = shardCount >= MAX_MAGNETIC_SHARDS;
  const dailyUniverseEvent = getDailyUniverseEvent(journey.dateKey);
  const isParallelThemeActive =
    journey.parallelThemeUntil > parallelThemeNow;
  const canSpawnFragment =
    isPlaying &&
    !isMoving &&
    !isDailyMissionComplete &&
    !beatChallenge;

  useEffect(() => {
    if (!canSpawnFragment || activeFragment) return;

    const delay =
      sessionCaptureCount === 0
        ? 1400
        : 3000 + Math.random() * 1500;
    const spawnTimer = window.setTimeout(() => {
      let nextSlotIndex = Math.floor(Math.random() * FRAGMENT_SLOTS.length);
      if (nextSlotIndex === lastSlotIndexRef.current) {
        nextSlotIndex = (nextSlotIndex + 1) % FRAGMENT_SLOTS.length;
      }

      lastSlotIndexRef.current = nextSlotIndex;
      fragmentIdRef.current += 1;
      setActiveFragment({
        id: fragmentIdRef.current,
        slotIndex: nextSlotIndex,
        spawnedAt: Date.now(),
        isRare:
          (sessionCaptureCount + 1) % 4 === 0 ||
          Math.random() < 0.14,
      });
    }, delay);

    return () => window.clearTimeout(spawnTimer);
  }, [activeFragment, canSpawnFragment, sessionCaptureCount]);

  useEffect(() => {
    if (!activeFragment) return;

    const expireTimer = window.setTimeout(() => {
      setActiveFragment(null);
      setComboCount(0);
      lastCaptureAtRef.current = 0;
    }, 11000);

    return () => window.clearTimeout(expireTimer);
  }, [activeFragment]);

  useEffect(() => {
    if (!feedback) return;

    const feedbackTimer = window.setTimeout(() => {
      setFeedback('');
    }, 2400);

    return () => window.clearTimeout(feedbackTimer);
  }, [feedback]);

  useEffect(() => {
    if (celebratingStageIndex === null) return;

    const celebrationTimer = window.setTimeout(() => {
      setCelebratingStageIndex(null);
    }, 2800);

    return () => window.clearTimeout(celebrationTimer);
  }, [celebratingStageIndex]);

  useEffect(() => {
    if (comboCount === 0) return;

    const comboTimer = window.setTimeout(() => {
      setComboCount(0);
      lastCaptureAtRef.current = 0;
    }, COMBO_CHAIN_WINDOW);

    return () => window.clearTimeout(comboTimer);
  }, [comboCount]);

  useEffect(() => {
    if (!rewardReveal) return;

    const rewardTimer = window.setTimeout(() => {
      setRewardReveal(null);
    }, 4600);

    return () => window.clearTimeout(rewardTimer);
  }, [rewardReveal]);

  const handleCollectFragment = () => {
    if (!activeFragment) return;

    const capturedAt = Date.now();
    const isQuickCapture =
      capturedAt - activeFragment.spawnedAt <= QUICK_CAPTURE_WINDOW;
    const isContinuingCombo =
      isQuickCapture &&
      capturedAt - lastCaptureAtRef.current <= COMBO_CHAIN_WINDOW;
    const nextComboCount = isQuickCapture
      ? isContinuingCombo
        ? comboCount + 1
        : 1
      : 0;
    const baseCaptureEnergy = activeFragment.isRare ? 2 : 1;
    const captureEnergy =
      dailyUniverseEvent.id === 'meteor'
        ? baseCaptureEnergy * 2
        : baseCaptureEnergy;
    const nextShardCount = Math.min(
      MAX_MAGNETIC_SHARDS,
      shardCount + captureEnergy,
    );
    const nextStageIndex = getMagneticStageIndex(nextShardCount);
    const nextDailyEnergy = Math.min(
      DAILY_RESONANCE_TARGET,
      journey.dailyEnergy + captureEnergy,
    );
    const isCompletingDailyMission =
      journey.dailyEnergy < DAILY_RESONANCE_TARGET &&
      nextDailyEnergy >= DAILY_RESONANCE_TARGET;
    const nextTotalCaptures = journey.totalCaptures + 1;
    const decodedSignal = SECRET_SIGNALS.find(
      (signal) => signal.threshold === nextTotalCaptures,
    );

    collectShards(captureEnergy);
    recordCapture({
      energy: captureEnergy,
      combo: nextComboCount,
      isRare: activeFragment.isRare,
    });
    setActiveFragment(null);
    setSessionCaptureCount((currentCount) => currentCount + 1);
    setComboCount(nextComboCount);
    lastCaptureAtRef.current = isQuickCapture ? capturedAt : 0;

    if (nextStageIndex > stageIndex) {
      setFeedback(`已解锁 · ${MAGNETIC_STAGES[nextStageIndex].name}`);
      setCelebratingStageIndex(nextStageIndex);
      setIsExpanded(true);
      setDetailTab('progress');
    } else if (isCompletingDailyMission) {
      setFeedback('今日共鸣完成 · 印记待领取');
      setIsExpanded(true);
      setDetailTab('daily');
    } else if (activeFragment.isRare) {
      setFeedback(
        `极光碎片 +${captureEnergy}${nextComboCount >= 2 ? ` · COMBO ×${nextComboCount}` : ''}`,
      );
    } else {
      setFeedback(
        `+${captureEnergy} 磁力碎片${nextComboCount >= 2 ? ` · COMBO ×${nextComboCount}` : ''}`,
      );
    }

    if (decodedSignal) {
      setRewardReveal({
        eyebrow: 'HIDDEN SIGNAL DECODED',
        title: decodedSignal.title,
        description: decodedSignal.message,
      });
      setIsExpanded(true);
      setDetailTab('signals');
    } else if (nextStageIndex === stageIndex) {
      if (nextTotalCaptures === 1) {
        setRewardReveal({
          eyebrow: 'ACHIEVEMENT UNLOCKED',
          title: '初次吸引',
          description: '捕获了第一颗磁力碎片',
        });
      } else if (activeFragment.isRare && journey.rareCaptures === 0) {
        setRewardReveal({
          eyebrow: 'RARE SIGNAL FOUND',
          title: '极光观测员',
          description: '首次捕获价值双倍的极光碎片',
        });
      } else if (nextComboCount >= 3 && journey.bestCombo < 3) {
        setRewardReveal({
          eyebrow: 'COMBO ACHIEVEMENT',
          title: '极速三连',
          description: '连续三次在磁能消散前完成捕获',
        });
      }
    }
  };

  const handleResetProgress = () => {
    resetProgress();
    resetJourney();
    setSessionCaptureCount(0);
    setActiveFragment(null);
    setCelebratingStageIndex(null);
    setRewardReveal(null);
    setComboCount(0);
    setBeatChallenge(null);
    setBeatFeedback('');
    setIsBeatBurstActive(false);
    setCapsuleMood('');
    setAnonymousResonance(null);
    setIsResonanceOpen(false);
    setDetailTab('progress');
    lastCaptureAtRef.current = 0;
    seenChorusesRef.current.clear();
    fullPlayRecordedRef.current = false;
    favoriteRecordedRef.current = false;
    setFeedback('磁场已重新校准');
  };

  const handleReplayResonance = () => {
    setCelebratingStageIndex(MAGNETIC_STAGES.length - 1);
    setFeedback('核心共鸣已重启');
  };

  const handleClaimDailyReward = () => {
    const claimResult = claimDailyReward();
    if (!claimResult) {
      setFeedback(
        isDailyRewardClaimed
          ? '今日印记已经领取'
          : '今日磁能还未收集完成',
      );
      return;
    }

    setRewardReveal({
      eyebrow: 'DAILY RESONANCE CLAIMED',
      title:
        claimResult.resonanceMarks === 1
          ? '回响徽光已装备'
          : '+1 共鸣印记',
      description:
        claimResult.resonanceMarks === 1
          ? '首枚印记已兑换成可用外观，行星周围的呼吸辉光已点亮'
          : `连续共鸣 ${claimResult.streakDays} 天 · 累计 ${claimResult.resonanceMarks} 枚`,
    });
    setDetailTab('archive');
    setFeedback(
      claimResult.resonanceMarks === 1
        ? '奖励已入库并自动装备'
        : '共鸣印记已收入奖励仓库',
    );
  };

  const handleEquipTitle = (titleId: MagneticTitleId) => {
    const title = titleRewards.find((reward) => reward.id === titleId);
    if (!title?.isUnlocked) {
      setFeedback('称号尚未解锁');
      return;
    }

    equipTitle(titleId);
    setFeedback(`已装备称号 · ${title.name}`);
  };

  const handleEquipCosmetic = (cosmeticId: MagneticCosmeticId) => {
    const cosmetic = MAGNETIC_COSMETICS.find(
      (reward) => reward.id === cosmeticId,
    );
    if (!cosmetic || journey.resonanceMarks < cosmetic.threshold) {
      setFeedback('印记数量还不足');
      return;
    }

    equipCosmetic(cosmeticId);
    setFeedback(`外观已切换 · ${cosmetic.name}`);
  };

  const resolveBeatNote = useCallback(
    (rating: BeatRating) => {
      if (!beatChallenge) return;

      const nextHits = [...beatChallenge.hits, rating];
      const isChallengeComplete =
        beatChallenge.noteIndex + 1 >= BEAT_NOTE_COUNT;
      const capturedHiddenLyric =
        rating === 'perfect' &&
        journey.hiddenLyricCaptures === 0 &&
        Boolean(playbackDetail.lyric);

      if (rating !== 'miss' && !isDailyMissionComplete) {
        const baseEnergy = rating === 'perfect' ? 2 : 1;
        const energy =
          dailyUniverseEvent.id === 'meteor'
            ? baseEnergy * 2
            : baseEnergy;
        collectShards(energy);
        recordCapture({
          energy,
          combo: 0,
          isRare: rating === 'perfect',
        });
      }

      recordBeatOutcome({
        rating,
        isChallengeComplete,
        capturedHiddenLyric,
      });

      if (capturedHiddenLyric) {
        setRewardReveal({
          eyebrow: 'HIDDEN LYRIC CAPTURED',
          title: playbackDetail.lyric || '隐藏歌词',
          description: 'Perfect 命中让这句歌词成为星球孵化条件',
        });
      }

      if (!isChallengeComplete) {
        setBeatChallenge({
          ...beatChallenge,
          noteIndex: beatChallenge.noteIndex + 1,
          hits: nextHits,
          noteSpawnedAt: Date.now(),
        });
        setBeatFeedback(
          rating === 'perfect'
            ? isDailyMissionComplete
              ? 'PERFECT · 今日磁能已满'
              : 'PERFECT · 稀有碎片'
            : rating === 'good'
              ? isDailyMissionComplete
                ? 'GOOD · 今日磁能已满'
                : 'GOOD · 普通碎片'
              : 'MISS · 下一拍',
        );
        return;
      }

      const hasHitEveryNote = nextHits.every((hit) => hit !== 'miss');
      setBeatChallenge(null);
      setBeatFeedback(
        hasHitEveryNote ? 'FULL RESONANCE' : '节拍捕获结束',
      );

      if (hasHitEveryNote) {
        setIsBeatBurstActive(true);
        setFeedback('全部命中 · 磁场爆发');
      }

      if (dailyUniverseEvent.id === 'storm') {
        completeDailyEvent();
        setIsBeatBurstActive(true);
      }
    },
    [
      beatChallenge,
      collectShards,
      completeDailyEvent,
      dailyUniverseEvent.id,
      isDailyMissionComplete,
      journey.hiddenLyricCaptures,
      playbackDetail.lyric,
      recordBeatOutcome,
      recordCapture,
    ],
  );

  const handleBeatCapture = () => {
    if (!beatChallenge) return;
    const distanceFromTarget = Math.abs(
      Date.now() - beatChallenge.noteSpawnedAt - BEAT_TARGET_TIME,
    );
    const rating: BeatRating =
      distanceFromTarget <= 360
        ? 'perfect'
        : distanceFromTarget <= 880
          ? 'good'
          : 'miss';
    resolveBeatNote(rating);
  };

  const handleSealCapsule = () => {
    const capsule = sealCapsule({
      songTitle: playbackDetail.title,
      artist: playbackDetail.artist,
      lyric: playbackDetail.lyric,
      mood: capsuleMood,
    });
    if (!capsule) {
      setFeedback('写下一句心情后再封存');
      return;
    }

    setCapsuleMood('');
    setRewardReveal({
      eyebrow: 'MUSIC CAPSULE SEALED',
      title: '七日音乐胶囊',
      description: `${capsule.songTitle} 会在 7 天后带着此刻的心情返回`,
    });
    setFeedback('音乐胶囊已进入七日轨道');
  };

  const handleOpenCapsule = (capsuleId: string) => {
    const capsule = journey.capsules.find((item) => item.id === capsuleId);
    if (!capsule) return;
    openCapsule(capsuleId);
    setRewardReveal({
      eyebrow: 'CAPSULE RETURNED',
      title: capsule.mood,
      description: `${capsule.songTitle} · ${capsule.lyric || '当时没有选择歌词'}`,
    });
  };

  const handleUniverseEventAction = () => {
    if (dailyUniverseEvent.id === 'black-hole') {
      const nextSongs = addDailyEventSong(playbackDetail.title);
      if (nextSongs.length < 3) {
        setFeedback(`黑洞已收录 ${nextSongs.length}/3 首 · 请切换歌曲`);
        return;
      }

      const recommendation =
        songCatalog.find((song) => !nextSongs.includes(song.title)) ??
        songCatalog[0];
      setRewardReveal({
        eyebrow: 'LOCAL MYSTERY RECOMMENDATION',
        title: recommendation?.title ?? '神秘轨道',
        description: recommendation
          ? `${recommendation.artist} · 从当前本地曲目中选出`
          : '当前没有可推荐的本地曲目',
      });
      return;
    }

    if (dailyUniverseEvent.id === 'letter') {
      if (journey.dailyFullPlayCount < 1) {
        setFeedback('完整听完一首歌后，来信才会抵达');
        return;
      }
      completeDailyEvent();
      setRewardReveal({
        eyebrow: 'A LETTER FROM THE PLANET',
        title: '星球来信',
        description:
          playbackDetail.lyric ||
          '今天完整听完的旋律，已经在星球核心留下回声。',
      });
      return;
    }

    if (dailyUniverseEvent.id === 'parallel') {
      activateParallelTheme();
      setParallelThemeNow(Date.now());
      setRewardReveal({
        eyebrow: 'PARALLEL UNIVERSE OPENED',
        title: '平行磁场 · 3 分钟',
        description: '青紫光谱已经覆盖当前宇宙',
      });
      return;
    }

    setFeedback(
      dailyUniverseEvent.id === 'meteor'
        ? '流星雨会自动使今日碎片奖励翻倍'
        : '下一次副歌将触发磁暴节拍事件',
    );
  };

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      setParallelThemeNow(Date.now());
    }, 0);
    const remainingTime = journey.parallelThemeUntil - Date.now();
    const themeTimer =
      remainingTime > 0
        ? window.setTimeout(() => {
            setParallelThemeNow(Date.now());
          }, remainingTime + 50)
        : 0;
    return () => {
      window.clearTimeout(syncTimer);
      if (themeTimer) window.clearTimeout(themeTimer);
    };
  }, [journey.parallelThemeUntil]);

  useEffect(() => {
    if (isFavorite && !favoriteRecordedRef.current) {
      favoriteRecordedRef.current = true;
      recordFavorite();
      setFeedback('收藏行为已写入星球孵化条件');
    }
  }, [isFavorite, recordFavorite]);

  useEffect(() => {
    const hasChangedSong =
      previousSongTitleRef.current !== playbackDetail.title;
    const hasRestartedSong =
      playbackDetail.currentTime < 4 &&
      previousPlaybackTimeRef.current >
        Math.max(20, playbackDetail.duration * 0.75);

    if (hasChangedSong || hasRestartedSong) {
      previousSongTitleRef.current = playbackDetail.title;
      fullPlayRecordedRef.current = false;
      seenChorusesRef.current.clear();
    }

    if (
      playbackDetail.duration > 0 &&
      playbackDetail.progress >= 0.96 &&
      !fullPlayRecordedRef.current
    ) {
      fullPlayRecordedRef.current = true;
      recordFullPlay();
      setFeedback('完整播放 +1 · 星球核心记录了这首歌');
    }

    previousPlaybackTimeRef.current = playbackDetail.currentTime;
  }, [playbackDetail, recordFullPlay]);

  useEffect(() => {
    if (
      !isPlaying ||
      isMoving ||
      beatChallenge ||
      playbackDetail.duration <= 0
    ) {
      return;
    }

    const chorusIndex = CHORUS_PROGRESS_POINTS.findIndex(
      (point, index) =>
        playbackDetail.progress >= point &&
        playbackDetail.progress <= point + 0.035 &&
        !seenChorusesRef.current.has(index),
    );
    if (chorusIndex < 0) return;

    seenChorusesRef.current.add(chorusIndex);
    setActiveFragment(null);
    setBeatChallenge({
      chorusIndex,
      noteIndex: 0,
      hits: [],
      noteSpawnedAt: Date.now(),
    });
    setBeatFeedback('副歌接近 · 在光点穿过磁门时点击');
  }, [
    beatChallenge,
    isMoving,
    isPlaying,
    playbackDetail.duration,
    playbackDetail.progress,
  ]);

  useEffect(() => {
    if (!beatChallenge) return;
    const missTimer = window.setTimeout(() => {
      resolveBeatNote('miss');
    }, BEAT_NOTE_LIFETIME);
    return () => window.clearTimeout(missTimer);
  }, [beatChallenge, resolveBeatNote]);

  useEffect(() => {
    if (!isBeatBurstActive) return;
    const burstTimer = window.setTimeout(() => {
      setIsBeatBurstActive(false);
    }, 2600);
    return () => window.clearTimeout(burstTimer);
  }, [isBeatBurstActive]);

  useEffect(() => {
    if (!isPlaying || anonymousResonance) return;
    const resonanceTimer = window.setTimeout(() => {
      const resonanceIndex =
        (journey.totalCaptures + journey.fullPlayCount) %
        ANONYMOUS_RESONANCES.length;
      setAnonymousResonance(ANONYMOUS_RESONANCES[resonanceIndex]);
    }, 18000);
    return () => window.clearTimeout(resonanceTimer);
  }, [
    anonymousResonance,
    isPlaying,
    journey.fullPlayCount,
    journey.totalCaptures,
  ]);

  useEffect(() => {
    if (
      dailyUniverseEvent.id === 'meteor' &&
      isDailyMissionComplete &&
      !journey.dailyEventCompleted
    ) {
      completeDailyEvent();
    }
  }, [
    completeDailyEvent,
    dailyUniverseEvent.id,
    isDailyMissionComplete,
    journey.dailyEventCompleted,
  ]);

  const progressStart = currentStage.threshold;
  const progressEnd = nextStage?.threshold ?? MAX_MAGNETIC_SHARDS;
  const progressRange = Math.max(1, progressEnd - progressStart);
  const progressValue = nextStage
    ? ((shardCount - progressStart) / progressRange) * 100
    : 100;
  const stageClassName = styles[`stage${stageIndex}`];
  const celebrationStageClassName =
    celebratingStageIndex === null
      ? ''
      : styles[`celebrationStage${celebratingStageIndex}`];
  const celebratingStage =
    celebratingStageIndex === null
      ? null
      : MAGNETIC_STAGES[celebratingStageIndex];
  const activeSlot = activeFragment
    ? FRAGMENT_SLOTS[activeFragment.slotIndex]
    : null;
  const achievements = [
    {
      id: 'first-capture',
      name: '初次吸引',
      description: '捕获第一颗磁力碎片',
      isUnlocked: journey.totalCaptures >= 1,
    },
    {
      id: 'rare-signal',
      name: '极光观测员',
      description: '首次捕获极光碎片',
      isUnlocked: journey.rareCaptures >= 1,
    },
    {
      id: 'combo-three',
      name: '极速三连',
      description: '达成 3 次连续快速捕获',
      isUnlocked: journey.bestCombo >= 3,
    },
    {
      id: 'core-resonance',
      name: '核心共鸣',
      description: '完成 12 颗碎片主线',
      isUnlocked: hasCompletedJourney,
    },
    {
      id: 'daily-echo',
      name: '每日回响',
      description: '领取一次每日共鸣印记',
      isUnlocked: journey.resonanceMarks >= 1,
    },
    {
      id: 'signal-decoder',
      name: '信号解码员',
      description: '解码第一段隐藏信号',
      isUnlocked: journey.totalCaptures >= SECRET_SIGNALS[0].threshold,
    },
    {
      id: 'beat-perfect',
      name: '节拍引力',
      description: '在副歌节拍中获得 Perfect',
      isUnlocked: journey.perfectBeatHits >= 1,
    },
    {
      id: 'capsule-sealed',
      name: '七日回声',
      description: '封存第一颗音乐胶囊',
      isUnlocked: journey.capsules.length >= 1,
    },
  ];
  const titleRewards = MAGNETIC_TITLES.map((title) => {
    let isUnlocked = false;

    if (title.id === 'observer') isUnlocked = journey.totalCaptures >= 1;
    if (title.id === 'aurora-hunter') {
      isUnlocked = journey.rareCaptures >= 1;
    }
    if (title.id === 'combo-runner') isUnlocked = journey.bestCombo >= 3;
    if (title.id === 'core-resonator') isUnlocked = hasCompletedJourney;
    if (title.id === 'daily-echo') {
      isUnlocked = journey.resonanceMarks >= 1;
    }

    return { ...title, isUnlocked };
  });
  const equippedTitle = MAGNETIC_TITLES.find(
    (title) => title.id === journey.equippedTitle,
  );
  const equippedCosmetic = MAGNETIC_COSMETICS.find(
    (cosmetic) =>
      cosmetic.id === journey.equippedCosmetic &&
      journey.resonanceMarks >= cosmetic.threshold,
  );
  const activeCosmeticId = equippedCosmetic?.id ?? 'default';
  const cosmeticClassName = COSMETIC_CLASS_NAMES[activeCosmeticId] ?? '';
  const dailyProgressValue =
    (journey.dailyEnergy / DAILY_RESONANCE_TARGET) * 100;
  const hatchUnlocks = [
    true,
    journey.totalCaptures >= 1,
    journey.hasFavoritedSong,
    journey.fullPlayCount >= 1,
    journey.beatChallengesCompleted >= 1,
    journey.hasFavoritedSong &&
      journey.fullPlayCount >= 3 &&
      journey.hiddenLyricCaptures >= 1,
  ];
  let hatchStageIndex = 0;
  for (let index = 1; index < hatchUnlocks.length; index += 1) {
    if (!hatchUnlocks[index]) break;
    hatchStageIndex = index;
  }
  const hatchStageAvailability = hatchUnlocks.map((_, index) =>
    hatchUnlocks.slice(0, index + 1).every(Boolean),
  );
  const currentHatchStage = PLANET_HATCH_STAGES[hatchStageIndex];
  const planetClassName = styles[`hatchStage${hatchStageIndex}`];
  const hasBeatCrackGlow =
    (beatChallenge?.hits.filter((hit) => hit !== 'miss').length ?? 0) >=
    2;
  const dueCapsule = journey.capsules.find(
    (capsule) =>
      capsule.openedAt === 0 &&
      capsule.revealAt <= parallelThemeNow &&
      capsule.songTitle === playbackDetail.title,
  );
  const dailyEventActionLabel =
    dailyUniverseEvent.id === 'black-hole'
      ? `投入当前歌曲 ${journey.dailyEventSongs.length}/3`
      : dailyUniverseEvent.id === 'letter'
        ? journey.dailyFullPlayCount >= 1
          ? '读取今日来信'
          : '完整播放后解锁'
        : dailyUniverseEvent.id === 'parallel'
          ? isParallelThemeActive
            ? '平行宇宙运行中'
            : '开启 3 分钟'
          : dailyUniverseEvent.id === 'meteor'
            ? '掉落翻倍已生效'
            : '等待下一次副歌';

  return (
    <div
      className={[
        styles.discoveryLayer,
        stageClassName,
        cosmeticClassName,
        planetClassName,
        isParallelThemeActive ? styles.parallelUniverse : '',
        hasBeatCrackGlow ? styles.beatCracksActive : '',
        isBeatBurstActive ? styles.beatBurstActive : '',
        isMoving ? styles.isMoving : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.environment} aria-hidden="true">
        <div className={styles.unlockedOrbit} />
        <div className={styles.pulseTrail} />
        <div className={styles.coreResonance} />
        <div className={styles.secondaryOrbit}>
          <span />
          <span />
        </div>
        <div className={styles.resonanceWaves}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.magneticCrown} />
        <div className={styles.resonanceNodes}>
          {RESONANCE_NODES.map((nodeName) => (
            <span key={nodeName} className={styles[nodeName]} />
          ))}
        </div>
        <div className={styles.rewardAurora} />
        <div className={styles.twinOrbit}>
          <span />
          <span />
        </div>
        <div className={styles.hatchCoreGlow} />
        <div className={styles.songFormSigil}>
          <span>MAGNETIC</span>
        </div>
        <div className={styles.beatBurstVisual}>
          <span />
          <span />
          <span />
        </div>
      </div>

      <section
        className={[
          styles.progressPanel,
          isExpanded ? styles.isExpanded : '',
          hasCompletedJourney ? styles.isComplete : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="磁场探索进度"
      >
        <button
          className={styles.progressSummary}
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
        >
          <span className={styles.summaryCopy}>
            <span className={styles.kicker}>
              {hasCompletedJourney
                ? 'RESONANCE MAX · 共鸣完成'
                : 'MAGNETIC FIELD · 磁场探索'}
            </span>
            <strong>{currentStage.name}</strong>
            {equippedTitle && (
              <em className={styles.equippedTitle}>
                {equippedTitle.name}
              </em>
            )}
            <em className={styles.hatchStageBadge}>
              孵化 · {currentHatchStage.name}
            </em>
          </span>
          <span className={styles.shardCount}>
            {hasCompletedJourney ? (
              <span className={styles.maxBadge}>MAX</span>
            ) : (
              <>
                <b>{shardCount}</b>
                <span>/ {MAX_MAGNETIC_SHARDS}</span>
              </>
            )}
          </span>
        </button>

        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${progressValue}%` }} />
        </div>

        <p className={styles.nextHint}>
          {nextStage && isDailyMissionComplete
            ? `今日磁能已满 · 明日再捕获 ${nextStage.threshold - shardCount} 颗解锁「${nextStage.name}」`
            : nextStage
              ? `再捕获 ${nextStage.threshold - shardCount} 颗，解锁「${nextStage.name}」`
            : `主线 12/12 已完成 · 累计捕获 ${journey.totalCaptures} 次 · 今日磁能 ${journey.dailyEnergy}/${DAILY_RESONANCE_TARGET}`}
        </p>

        <div className={styles.detailPanel}>
          <div
            className={styles.detailTabs}
            role="tablist"
            aria-label="磁场日志分类"
          >
            {DETAIL_TABS.map(([tabId, label]) => (
              <button
                key={tabId}
                className={
                  detailTab === tabId ? styles.isActiveTab : ''
                }
                type="button"
                role="tab"
                aria-selected={detailTab === tabId}
                onClick={() => setDetailTab(tabId as DetailTab)}
              >
                {label}
              </button>
            ))}
          </div>

          {detailTab === 'progress' && (
            <ol className={styles.stageList}>
              {MAGNETIC_STAGES.slice(1).map((stage) => {
                const isUnlocked = shardCount >= stage.threshold;
                return (
                  <li
                    key={stage.name}
                    className={isUnlocked ? styles.isUnlocked : ''}
                  >
                    <span
                      className={styles.stageMarker}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{stage.name}</strong>
                      <small>{stage.description}</small>
                    </span>
                    <b>
                      {isUnlocked ? '已解锁' : `${stage.threshold} 颗`}
                    </b>
                  </li>
                );
              })}
            </ol>
          )}

          {detailTab === 'planet' && (
            <div className={styles.planetPanel}>
              <div className={styles.planetHeading}>
                <span>
                  <small>PLANET HATCHING</small>
                  <strong>{currentHatchStage.name}</strong>
                </span>
                <b>
                  {hatchStageIndex + 1}/{PLANET_HATCH_STAGES.length}
                </b>
              </div>
              <p>
                星球由不同听歌行为共同孵化，不靠单一播放次数堆满。
              </p>
              <ol className={styles.hatchStageList}>
                {PLANET_HATCH_STAGES.map((stage, index) => (
                  <li
                    key={stage.name}
                    className={
                      hatchStageAvailability[index]
                        ? styles.isHatchUnlocked
                        : ''
                    }
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{stage.name}</strong>
                      <small>{stage.condition}</small>
                    </div>
                    <b>
                      {hatchStageAvailability[index]
                        ? '已解锁'
                        : hatchUnlocks[index]
                          ? '条件已达成'
                        : index === hatchStageIndex + 1
                          ? '下一阶段'
                          : '未解锁'}
                    </b>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {detailTab === 'daily' && (
            <div className={styles.dailyMission}>
              <article
                className={[
                  styles.universeEventCard,
                  journey.dailyEventCompleted
                    ? styles.isUniverseEventComplete
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div>
                  <small>{dailyUniverseEvent.eyebrow}</small>
                  <strong>{dailyUniverseEvent.name}</strong>
                  <p>{dailyUniverseEvent.description}</p>
                </div>
                <button
                  type="button"
                  disabled={
                    journey.dailyEventCompleted &&
                    dailyUniverseEvent.id !== 'parallel'
                  }
                  onClick={handleUniverseEventAction}
                >
                  {journey.dailyEventCompleted &&
                  dailyUniverseEvent.id !== 'parallel'
                    ? '今日事件已完成'
                    : dailyEventActionLabel}
                </button>
              </article>
              <div className={styles.dailyMissionHeading}>
                <span>
                  <small>DAILY SIGNAL</small>
                  <strong>捕获 5 点今日磁能</strong>
                </span>
                <b>
                  {journey.dailyEnergy}/{DAILY_RESONANCE_TARGET}
                </b>
              </div>
              <div className={styles.dailyTrack} aria-hidden="true">
                <span style={{ width: `${dailyProgressValue}%` }} />
              </div>
              <p>普通碎片提供 1 点，极光碎片提供 2 点磁能。</p>
              <button
                className={styles.claimButton}
                type="button"
                disabled={
                  !isDailyMissionComplete || isDailyRewardClaimed
                }
                onClick={handleClaimDailyReward}
              >
                {isDailyRewardClaimed
                  ? '今日印记已领取'
                  : isDailyMissionComplete
                    ? '领取 1 枚共鸣印记'
                    : `还差 ${DAILY_RESONANCE_TARGET - journey.dailyEnergy} 点磁能`}
              </button>
              <div className={styles.dailyStats}>
                <span>
                  <small>连续共鸣</small>
                  <b>{journey.streakDays} 天</b>
                </span>
                <span>
                  <small>共鸣印记</small>
                  <b>{journey.resonanceMarks} 枚</b>
                </span>
                <span>
                  <small>最高连击</small>
                  <b>×{journey.bestCombo}</b>
                </span>
              </div>
              <p className={styles.dailyCapNote}>
                今日上限为 5 点；达到后碎片暂停刷新，明日恢复。
                累计捕获会跨天保留，用于解码 SIGNAL。
              </p>
            </div>
          )}

          {detailTab === 'capsule' && (
            <div className={styles.capsulePanel}>
              <div className={styles.capsuleComposer}>
                <small>MUSIC CAPSULE · 7 DAYS</small>
                <strong>
                  封存「{playbackDetail.title || '当前歌曲'}」
                </strong>
                <p>
                  {playbackDetail.lyric ||
                    '播放到喜欢的歌词时，把它和此刻的心情一起留下。'}
                </p>
                <textarea
                  value={capsuleMood}
                  maxLength={80}
                  placeholder="写下一句此刻的心情…"
                  onChange={(event) => setCapsuleMood(event.target.value)}
                />
                <div>
                  <span>{capsuleMood.length}/80</span>
                  <button type="button" onClick={handleSealCapsule}>
                    封存 7 天
                  </button>
                </div>
              </div>
              <div className={styles.capsuleList}>
                {journey.capsules.length === 0 ? (
                  <p className={styles.emptyCapsule}>
                    还没有胶囊。第一颗胶囊会解锁「七日回声」成就。
                  </p>
                ) : (
                  [...journey.capsules].reverse().map((capsule) => {
                    const remainingDays = Math.max(
                      0,
                      Math.ceil(
                        (capsule.revealAt - parallelThemeNow) /
                          (24 * 60 * 60 * 1000),
                      ),
                    );
                    const canOpen =
                      capsule.openedAt === 0 &&
                      capsule.revealAt <= parallelThemeNow;
                    return (
                      <article
                        key={capsule.id}
                        className={
                          canOpen ? styles.isCapsuleReturned : ''
                        }
                      >
                        <span aria-hidden="true" />
                        <div>
                          <strong>{capsule.songTitle}</strong>
                          <small>
                            {capsule.openedAt > 0
                              ? `已开启 · ${capsule.mood}`
                              : canOpen
                                ? '胶囊已返回当前轨道'
                                : `${remainingDays} 天后返回`}
                          </small>
                        </div>
                        {canOpen && (
                          <button
                            type="button"
                            onClick={() => handleOpenCapsule(capsule.id)}
                          >
                            打开
                          </button>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {detailTab === 'archive' && (
            <div className={styles.archivePanel}>
              <div className={styles.rewardSectionHeading}>
                <span>
                  <small>ACHIEVEMENT TITLES</small>
                  <strong>成就称号</strong>
                </span>
                <b>{equippedTitle?.name ?? '尚未装备'}</b>
              </div>
              <div className={styles.titleRewardList}>
                {titleRewards.map((title) => {
                  const isEquipped = journey.equippedTitle === title.id;
                  return (
                    <button
                      key={title.id}
                      className={[
                        title.isUnlocked ? styles.isRewardUnlocked : '',
                        isEquipped ? styles.isRewardEquipped : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      type="button"
                      disabled={!title.isUnlocked}
                      onClick={() => handleEquipTitle(title.id)}
                    >
                      <span>
                        <strong>{title.name}</strong>
                        <small>{title.description}</small>
                      </span>
                      <b>
                        {isEquipped
                          ? '使用中'
                          : title.isUnlocked
                            ? '装备'
                            : '未解锁'}
                      </b>
                    </button>
                  );
                })}
              </div>

              <div className={styles.rewardSectionHeading}>
                <span>
                  <small>RESONANCE SKINS</small>
                  <strong>磁场外观</strong>
                </span>
                <b>{equippedCosmetic?.name ?? '原初磁场'}</b>
              </div>
              <div className={styles.cosmeticTrack}>
                {MAGNETIC_COSMETICS.map((cosmetic) => {
                  const isUnlocked =
                    journey.resonanceMarks >= cosmetic.threshold;
                  const isEquipped = activeCosmeticId === cosmetic.id;
                  return (
                    <button
                      key={cosmetic.id}
                      className={[
                        isUnlocked ? styles.isCosmeticUnlocked : '',
                        isEquipped ? styles.isCosmeticEquipped : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      type="button"
                      disabled={!isUnlocked}
                      onClick={() => handleEquipCosmetic(cosmetic.id)}
                    >
                      <i
                        className={[
                          styles.cosmeticPreview,
                          COSMETIC_PREVIEW_CLASS_NAMES[cosmetic.id],
                        ].join(' ')}
                        aria-hidden="true"
                      />
                      <span>
                        <b>{cosmetic.name}</b>
                        <small>{cosmetic.description}</small>
                      </span>
                      <em>
                        {isEquipped
                          ? '使用中'
                          : isUnlocked
                            ? '装备'
                            : `${journey.resonanceMarks}/${cosmetic.threshold} 印记`}
                      </em>
                    </button>
                  );
                })}
              </div>

              <div className={styles.rewardSectionHeading}>
                <span>
                  <small>COLLECTION</small>
                  <strong>成就图鉴</strong>
                </span>
                <b>
                  {achievements.filter((item) => item.isUnlocked).length}/
                  {achievements.length}
                </b>
              </div>
              <div className={styles.achievementGrid}>
                {achievements.map((achievement) => (
                  <div
                    key={achievement.id}
                    className={
                      achievement.isUnlocked
                        ? styles.isAchievementUnlocked
                        : ''
                    }
                  >
                    <span aria-hidden="true" />
                    <strong>{achievement.name}</strong>
                    <small>{achievement.description}</small>
                    <b>
                      {achievement.isUnlocked ? '已获得' : '未解锁'}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detailTab === 'signals' && (
            <div className={styles.signalPanel}>
              <div className={styles.signalScanner} aria-hidden="true">
                <span />
              </div>
              <p>
                隐藏信号是累计捕获彩蛋，不占用 12
                颗主线进度。达到指定总次数后，会解锁一段磁场广播。
              </p>
              <div className={styles.signalList}>
                {SECRET_SIGNALS.map((signal) => {
                  const isDecoded =
                    journey.totalCaptures >= signal.threshold;
                  return (
                    <article
                      key={signal.id}
                      className={isDecoded ? styles.isSignalDecoded : ''}
                    >
                      <span>{signal.code}</span>
                      <strong>
                        {isDecoded
                          ? signal.title
                          : `累计捕获 ${signal.threshold} 次解锁`}
                      </strong>
                      <p>
                        {isDecoded
                          ? signal.message
                          : `当前 ${journey.totalCaptures}/${signal.threshold} 次 · 还差 ${signal.threshold - journey.totalCaptures} 次`}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.progressActions}>
            {hasCompletedJourney && (
              <button
                className={styles.replayButton}
                type="button"
                onClick={handleReplayResonance}
              >
                重启核心共鸣
              </button>
            )}
            <button
              className={styles.resetButton}
              type="button"
              onClick={handleResetProgress}
            >
              重置体验进度
            </button>
          </div>
        </div>
      </section>

      {activeFragment && activeSlot && (
        <button
          key={activeFragment.id}
          className={[
            styles.fragment,
            activeFragment.isRare ? styles.rareFragment : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={
            {
              '--fragment-x': activeSlot.x,
              '--fragment-y': activeSlot.y,
            } as CSSProperties
          }
          type="button"
          aria-label={
            activeFragment.isRare
              ? '捕获极光碎片，获得双倍磁能'
              : '捕获磁力碎片'
          }
          onClick={handleCollectFragment}
        >
          <span className={styles.fragmentCore} aria-hidden="true" />
          <span className={styles.fragmentLabel}>
            {activeFragment.isRare
              ? '极光碎片 ×2'
              : shardCount === 0
                ? '点击捕获'
                : '磁力碎片'}
          </span>
        </button>
      )}

      {beatChallenge && (
        <section
          className={styles.beatChallenge}
          aria-label="副歌节拍捕获"
        >
          <div className={styles.beatChallengeHeading}>
            <span>
              <small>CHORUS CAPTURE</small>
              <strong>在光点穿过磁门时点击</strong>
            </span>
            <b>
              {beatChallenge.noteIndex + 1}/{BEAT_NOTE_COUNT}
            </b>
          </div>
          <button
            key={`${beatChallenge.chorusIndex}-${beatChallenge.noteIndex}`}
            className={styles.beatLane}
            type="button"
            onClick={handleBeatCapture}
          >
            <span className={styles.beatGate} aria-hidden="true" />
            <span className={styles.beatNote} aria-hidden="true" />
            <span className={styles.beatTapLabel}>点击捕获</span>
          </button>
          <div className={styles.beatResultRow} aria-live="polite">
            <span>
              {Array.from({ length: BEAT_NOTE_COUNT }, (_, index) => (
                <i
                  key={index}
                  data-rating={beatChallenge.hits[index] ?? 'waiting'}
                />
              ))}
            </span>
            <b>{beatFeedback}</b>
          </div>
        </section>
      )}

      {comboCount >= 2 && (
        <div className={styles.comboHud} aria-live="polite">
          <small>MAGNETIC COMBO</small>
          <strong>×{comboCount}</strong>
          <span>快速捕获维持连击</span>
        </div>
      )}

      {dueCapsule && (
        <button
          className={styles.returningCapsule}
          type="button"
          onClick={() => handleOpenCapsule(dueCapsule.id)}
        >
          <span aria-hidden="true" />
          <small>7 DAYS AGO · CAPSULE RETURNED</small>
          <strong>「{dueCapsule.songTitle}」带着回忆回来了</strong>
          <em>点击打开</em>
        </button>
      )}

      {anonymousResonance && (
        <aside className={styles.anonymousResonance}>
          <button
            className={styles.resonanceDot}
            type="button"
            aria-expanded={isResonanceOpen}
            aria-label="查看一位匿名听众留下的共振"
            onClick={() =>
              setIsResonanceOpen((currentValue) => !currentValue)
            }
          >
            <span aria-hidden="true" />
          </button>
          {isResonanceOpen && (
            <div className={styles.resonanceMessage}>
              <button
                type="button"
                aria-label="关闭匿名共振"
                onClick={() => {
                  setIsResonanceOpen(false);
                  setAnonymousResonance(null);
                }}
              >
                ×
              </button>
              <small>ANONYMOUS RESONANCE · 演示信号</small>
              <strong>{anonymousResonance.message}</strong>
              <p>{anonymousResonance.detail}</p>
              <em>不显示昵称、头像与位置</em>
            </div>
          )}
        </aside>
      )}

      {celebratingStage && (
        <div
          className={[
            styles.unlockCelebration,
            celebrationStageClassName,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          <div className={styles.unlockFlash} />
          <div className={styles.unlockRays} />
          <div className={styles.unlockShockwaves}>
            <span />
            <span />
            <span />
          </div>
          <div className={styles.unlockCopy}>
            <span>MAGNETIC FIELD UNLOCKED</span>
            <strong>{celebratingStage.name}</strong>
          </div>
        </div>
      )}

      {rewardReveal && (
        <div
          className={styles.rewardReveal}
          role="dialog"
          aria-label={rewardReveal.title}
        >
          <button
            type="button"
            aria-label="关闭奖励提示"
            onClick={() => setRewardReveal(null)}
          >
            关闭
          </button>
          <small>{rewardReveal.eyebrow}</small>
          <strong>{rewardReveal.title}</strong>
          <p>{rewardReveal.description}</p>
        </div>
      )}

      <div
        className={[
          styles.playGuide,
          isPlaying &&
          shardCount === 0 &&
          !activeFragment &&
          !isMoving
            ? styles.isVisible
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        保持播放，轨道会回应你
      </div>

      <div
        className={[
          styles.feedback,
          feedback ? styles.isVisible : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-live="polite"
      >
        {feedback}
      </div>
    </div>
  );
}
