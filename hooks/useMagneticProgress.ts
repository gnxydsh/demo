'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const MAGNETIC_STAGES = [
  {
    threshold: 0,
    name: '沉睡磁场',
    description: '播放音乐，让第一颗碎片回应你',
  },
  {
    threshold: 3,
    name: '微光星轨',
    description: '星球外层出现一圈微光轨迹',
  },
  {
    threshold: 7,
    name: '脉冲尾迹',
    description: '磁场会跟随音乐缓慢呼吸',
  },
  {
    threshold: 12,
    name: '核心共鸣',
    description: '地核与星轨进入完全共鸣',
  },
] as const;

const STORAGE_KEY = 'magnetic-player-progress-v1';
const PROGRESS_CHANGE_EVENT = 'magnetic-progress-change';
let memoryShardCount = 0;
export const MAX_MAGNETIC_SHARDS =
  MAGNETIC_STAGES[MAGNETIC_STAGES.length - 1].threshold;

function normalizeShardCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_MAGNETIC_SHARDS, Math.max(0, Math.floor(value)));
}

export function getMagneticStageIndex(shardCount: number) {
  for (let index = MAGNETIC_STAGES.length - 1; index >= 0; index -= 1) {
    if (shardCount >= MAGNETIC_STAGES[index].threshold) return index;
  }

  return 0;
}

function readStoredShardCount() {
  try {
    const savedProgress = window.localStorage.getItem(STORAGE_KEY);
    if (!savedProgress) return memoryShardCount;
    const parsedProgress = JSON.parse(savedProgress) as {
      shardCount?: unknown;
    };
    memoryShardCount = normalizeShardCount(parsedProgress.shardCount);
    return memoryShardCount;
  } catch {
    return memoryShardCount;
  }
}

function writeStoredShardCount(shardCount: number) {
  memoryShardCount = normalizeShardCount(shardCount);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ shardCount: memoryShardCount }),
    );
  } catch {
    // 隐私模式或存储空间不可用时，玩法保持当前页面可用，不阻塞播放。
  }
  window.dispatchEvent(new Event(PROGRESS_CHANGE_EVENT));
}

function subscribeToProgress(onStoreChange: () => void) {
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener(PROGRESS_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener(PROGRESS_CHANGE_EVENT, onStoreChange);
  };
}

export function useMagneticProgress() {
  const shardCount = useSyncExternalStore(
    subscribeToProgress,
    readStoredShardCount,
    () => 0,
  );

  const collectShards = useCallback((amount = 1) => {
    writeStoredShardCount(
      Math.min(
        MAX_MAGNETIC_SHARDS,
        readStoredShardCount() + Math.max(1, Math.floor(amount)),
      ),
    );
  }, []);

  const resetProgress = useCallback(() => {
    writeStoredShardCount(0);
  }, []);

  const stageIndex = getMagneticStageIndex(shardCount);
  const nextStage = MAGNETIC_STAGES[stageIndex + 1] ?? null;

  return {
    shardCount,
    stageIndex,
    currentStage: MAGNETIC_STAGES[stageIndex],
    nextStage,
    collectShards,
    resetProgress,
  };
}
