import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioLockScreenOptions,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { useSyncExternalStore } from 'react';

import { getSettingsSnapshot, type AudioQuality } from '@/features/settings/store';
import { sizedImage } from '@/lib/format';

import { offlineCacheActions } from './cache-store';

import { playHistoryActions } from './history-store';
import { loadLyricLines } from './lyrics';
import { resolveSongSource } from './song-url';
import type { LyricLine, LyricsStatus, PlayMode, PlayerTrack } from './types';

export type PlayerState = {
  queue: PlayerTrack[];
  index: number;
  track: PlayerTrack | null;
  playing: boolean;
  buffering: boolean;
  loading: boolean;
  mode: PlayMode;
  error: string;
  lyrics: LyricLine[];
  lyricsStatus: LyricsStatus;
  activeQuality: AudioQuality;
  fromCache: boolean;
  playbackRate: number;
  sleepTimerEndAt: number | null;
  sleepMinutesLeft: number | null;
  sleepAfterCurrentTrack: boolean;
};

export type ProgressState = {
  positionMs: number;
  durationMs: number;
};

const INITIAL_PLAYER_STATE: PlayerState = {
  queue: [],
  index: -1,
  track: null,
  playing: false,
  buffering: false,
  loading: false,
  mode: 'sequence',
  error: '',
  lyrics: [],
  lyricsStatus: 'idle',
  activeQuality: '320',
  fromCache: false,
  playbackRate: 1,
  sleepTimerEndAt: null,
  sleepMinutesLeft: null,
  sleepAfterCurrentTrack: false,
};

const INITIAL_PROGRESS_STATE: ProgressState = {
  positionMs: 0,
  durationMs: 0,
};

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    getInitialState: () => initial,
    setState(partial: Partial<T>) {
      let changed = false;
      for (const key of Object.keys(partial) as (keyof T)[]) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }

      if (!changed) {
        return;
      }

      state = { ...state, ...partial };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const playerStore = createStore(INITIAL_PLAYER_STATE);
const progressStore = createStore(INITIAL_PROGRESS_STATE);

let audioPlayer: AudioPlayer | null = null;
let loadSequence = 0;
let failStreak = 0;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;
// 每次“建立新队列”都会自增；后台补齐歌单剩余曲目时靠它判断队列是否已被替换。
let queueGeneration = 0;
let sleepTimeout: ReturnType<typeof setTimeout> | null = null;
let sleepTickInterval: ReturnType<typeof setInterval> | null = null;
const playNextHashes = new Set<string>();

// expo-audio 单 player 的锁屏/通知栏没有上一首/下一首命令(原生侧明确移除),
// 只有 播放暂停+进度条+±10 秒;切歌按钮需迁移原生队列(AudioPlaylist),暂不做。
const LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekForward: true,
  showSeekBackward: true,
};

function lockScreenMetadataFor(track: PlayerTrack): AudioMetadata {
  return {
    title: track.title,
    artist: track.artist,
    albumTitle: track.album,
    artworkUrl: sizedImage(track.coverUrl, 480) ?? undefined,
  };
}

function ensureAudioPlayer(): AudioPlayer {
  if (audioPlayer) {
    return audioPlayer;
  }

  audioPlayer = createAudioPlayer(null, { updateInterval: 500 });
  audioPlayer.addListener('playbackStatusUpdate', handlePlaybackStatus);
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: getSettingsSnapshot().mixWithOthers ? 'mixWithOthers' : 'doNotMix',
  });

  return audioPlayer;
}

function handlePlaybackStatus(status: AudioStatus) {
  const current = progressStore.getState();
  progressStore.setState({
    positionMs: Math.max(0, Math.round(status.currentTime * 1000)),
    durationMs: status.duration > 0 ? Math.round(status.duration * 1000) : current.durationMs,
  });

  const state = playerStore.getState();
  const playing = status.playing;
  const buffering = status.isBuffering && !status.playing;
  if (state.playing !== playing || state.buffering !== buffering) {
    playerStore.setState({ playing, buffering });
  }

  if (status.didJustFinish) {
    handleTrackFinished();
  }
}

function handleTrackFinished() {
  const { mode, queue, sleepAfterCurrentTrack } = playerStore.getState();

  if (sleepAfterCurrentTrack) {
    const player = ensureAudioPlayer();
    player.pause();
    void player.seekTo(0);
    progressStore.setState({ positionMs: 0 });
    playerStore.setState({ sleepAfterCurrentTrack: false });
    return;
  }

  if (mode === 'none') {
    const { index } = playerStore.getState();
    const nextTrack = index >= 0 ? queue[index + 1] : undefined;
    if (nextTrack && playNextHashes.has(nextTrack.hash)) {
      playNextHashes.delete(nextTrack.hash);
      void loadTrackAt(index + 1);
      return;
    }

    const player = ensureAudioPlayer();
    player.pause();
    void player.seekTo(0);
    progressStore.setState({ positionMs: 0 });
    return;
  }

  if (mode === 'single' || queue.length <= 1) {
    const player = ensureAudioPlayer();
    void player.seekTo(0);
    player.play();
    return;
  }

  void skip(1, true);
}

function pickNextIndex(step: 1 | -1, auto: boolean): number {
  const { queue, index, mode } = playerStore.getState();
  if (!queue.length) {
    return -1;
  }

  if (mode === 'shuffle' && queue.length > 1 && (auto || step === 1)) {
    let candidate = index;
    while (candidate === index) {
      candidate = Math.floor(Math.random() * queue.length);
    }
    return candidate;
  }

  return (index + step + queue.length) % queue.length;
}

async function loadTrackAt(index: number, options?: { autoplay?: boolean }) {
  const { queue } = playerStore.getState();
  const track = queue[index];
  if (!track) {
    return;
  }

  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  playNextHashes.delete(track.hash);
  const sequence = ++loadSequence;
  playerStore.setState({
    index,
    track,
    loading: true,
    error: '',
    lyrics: [],
    lyricsStatus: 'idle',
  });
  progressStore.setState({ positionMs: 0, durationMs: track.durationMs ?? 0 });

  try {
    const preferredQuality = getSettingsSnapshot().preferredQuality;
    const source = await resolveSongSource(track, preferredQuality);
    if (sequence !== loadSequence) {
      return;
    }

    const player = ensureAudioPlayer();
    player.replace({ uri: source.uri });
    const currentRate = playerStore.getState().playbackRate;
    if (currentRate !== 1) {
      player.setPlaybackRate(currentRate);
    }
    // 每次换曲重新激活即可同步刷新锁屏元数据;Android 侧同时启动前台服务,
    // 保证息屏后台连续播放不受系统 3 分钟限制。
    player.setActiveForLockScreen(true, lockScreenMetadataFor(track), LOCK_SCREEN_OPTIONS);
    if (options?.autoplay !== false) {
      player.play();
    }

    failStreak = 0;
    playHistoryActions.record(track);
    playerStore.setState({
      loading: false,
      activeQuality: source.quality,
      fromCache: Boolean(source.fromCache),
    });
    if (source.durationMs > 0) {
      progressStore.setState({ durationMs: source.durationMs });
    }

  } catch (error) {
    if (sequence !== loadSequence) {
      return;
    }

    failStreak += 1;
    playerStore.setState({
      loading: false,
      playing: false,
      buffering: false,
      lyricsStatus: 'empty',
      error: error instanceof Error ? error.message : '播放失败，请稍后重试',
    });

    const { queue: currentQueue } = playerStore.getState();
    const maxStreak = Math.min(currentQueue.length, 6);
    if (currentQueue.length > 1 && failStreak < maxStreak) {
      advanceTimer = setTimeout(() => {
        advanceTimer = null;
        void skip(1, true);
      }, 1400);
    }
  }
}

async function loadLyricsFor(track: PlayerTrack, sequence: number) {
  try {
    const lines = await loadLyricLines(track);
    if (sequence !== loadSequence) {
      return;
    }

    playerStore.setState({
      lyrics: lines,
      lyricsStatus: lines.length ? 'ready' : 'empty',
    });
  } catch {
    if (sequence === loadSequence) {
      playerStore.setState({ lyrics: [], lyricsStatus: 'error' });
    }
  }
}

async function skip(step: 1 | -1, auto = false) {
  const nextIndex = pickNextIndex(step, auto);
  if (nextIndex < 0) {
    return;
  }

  await loadTrackAt(nextIndex);
}

/** 当前队列的 generation 是否仍是 expected（供后台补齐判断队列是否已被替换/清空）。 */
export function isCurrentQueueGeneration(expected: number): boolean {
  return expected === queueGeneration;
}

export const playerActions = {
  async loadLyrics() {
    const { track, lyricsStatus } = playerStore.getState();
    if (!track || (lyricsStatus !== 'idle' && lyricsStatus !== 'error')) {
      return;
    }

    const sequence = loadSequence;
    playerStore.setState({ lyricsStatus: 'loading' });
    await loadLyricsFor(track, sequence);
  },

  /**
   * 用一批曲目建立新队列并从 startIndex 开始播放。
   * 返回本次队列的 generation，供 appendTracks 后台补齐时校验队列未被替换；
   * 无可播曲目时返回 null。
   */
  async playTracks(tracks: PlayerTrack[], startIndex = 0): Promise<number | null> {
    playNextHashes.clear();
    const playable = tracks.filter((track) => track.hash);
    if (!playable.length) {
      return null;
    }

    const targetHash = tracks[startIndex]?.hash;
    const index = Math.max(
      0,
      playable.findIndex((track) => track.hash === targetHash)
    );

    failStreak = 0;
    const generation = ++queueGeneration;
    playerStore.setState({ queue: playable });
    await loadTrackAt(index);
    return generation;
  },

  /**
   * 把后续分页的曲目追加到当前队列末尾（按 hash 去重）。
   * generation 与当前队列不一致（队列已被替换/清空）时不追加并返回 false。
   */
  appendTracks(tracks: PlayerTrack[], generation: number): boolean {
    if (generation !== queueGeneration) {
      return false;
    }

    const { queue } = playerStore.getState();
    if (!queue.length) {
      return false;
    }

    const seen = new Set(queue.map((track) => track.hash));
    const fresh = tracks.filter((track) => track.hash && !seen.has(track.hash));
    if (fresh.length) {
      playerStore.setState({ queue: [...queue, ...fresh] });
    }

    return true;
  },

  async playTrackNow(track: PlayerTrack) {
    if (!track.hash) {
      return;
    }

    const { queue, index } = playerStore.getState();
    const existing = queue.findIndex((item) => item.hash === track.hash);
    if (existing >= 0) {
      await loadTrackAt(existing);
      return;
    }

    // 插播只是把歌插到当前曲目之后，不改变队列归属：
    // 歌单的后台补齐继续追加到队尾，顺序仍与歌单一致。
    const nextQueue = [...queue];
    nextQueue.splice(index + 1, 0, track);
    failStreak = 0;
    playerStore.setState({ queue: nextQueue });
    await loadTrackAt(index + 1);
  },

  pause() {
    playerStore.getState().track && audioPlayer?.pause();
  },

  toggle() {
    const { track, playing, loading, error } = playerStore.getState();
    if (!track || loading) {
      return;
    }

    if (error) {
      void loadTrackAt(playerStore.getState().index);
      return;
    }

    const player = ensureAudioPlayer();
    if (playing) {
      player.pause();
      return;
    }

    const { positionMs, durationMs } = progressStore.getState();
    if (durationMs > 0 && positionMs >= durationMs - 300) {
      void player.seekTo(0);
    }
    player.play();
  },

  next() {
    void skip(1);
  },

  previous() {
    void skip(-1);
  },

  seekToMs(positionMs: number) {
    const { track } = playerStore.getState();
    if (!track || !audioPlayer) {
      return;
    }

    const { durationMs } = progressStore.getState();
    const clamped = Math.max(0, durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs);
    progressStore.setState({ positionMs: clamped });
    void audioPlayer.seekTo(clamped / 1000);
  },

  setMode(mode: PlayMode) {
    playerStore.setState({ mode });
  },

  cycleMode() {
    const { mode } = playerStore.getState();
    const order: PlayMode[] = ['sequence', 'shuffle', 'single', 'none'];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    playerStore.setState({ mode: next });
    return next;
  },

  async jumpTo(index: number) {
    const { queue } = playerStore.getState();
    if (index < 0 || index >= queue.length) {
      return;
    }

    await loadTrackAt(index);
  },

  removeAt(index: number) {
    const { queue, index: currentIndex } = playerStore.getState();
    if (index < 0 || index >= queue.length) {
      return;
    }

    const removed = queue[index];
    if (removed) {
      playNextHashes.delete(removed.hash);
    }
    const nextQueue = queue.filter((_, itemIndex) => itemIndex !== index);

    if (!nextQueue.length) {
      playerActions.clearQueue();
      return;
    }

    if (index === currentIndex) {
      playerStore.setState({ queue: nextQueue });
      void loadTrackAt(Math.min(index, nextQueue.length - 1));
      return;
    }

    playerStore.setState({
      queue: nextQueue,
      index: index < currentIndex ? currentIndex - 1 : currentIndex,
    });
  },

  async switchQuality(quality: AudioQuality) {
    const { track, playing } = playerStore.getState();
    if (!track) {
      return;
    }
    const resumePosMs = progressStore.getState().positionMs;
    const sequence = ++loadSequence;
    playerStore.setState({ loading: true, error: '' });
    try {
      const source = await resolveSongSource(track, quality, { ignoreCache: true });
      if (sequence !== loadSequence) {
        return;
      }
      const player = ensureAudioPlayer();
      player.replace({ uri: source.uri });
      const currentRate = playerStore.getState().playbackRate;
      if (currentRate !== 1) {
        player.setPlaybackRate(currentRate);
      }
      if (resumePosMs > 1000) {
        void player.seekTo(resumePosMs / 1000);
      }
      if (playing) {
        player.play();
      }
      playerStore.setState({
        loading: false,
        activeQuality: source.quality,
        fromCache: false,
      });
    } catch (error) {
      if (sequence !== loadSequence) {
        return;
      }
      playerStore.setState({
        loading: false,
        error: error instanceof Error ? error.message : '音质切换失败',
      });
    }
  },

  setPlaybackRate(rate: number) {
    playerStore.setState({ playbackRate: rate });
    if (audioPlayer) {
      audioPlayer.setPlaybackRate(rate);
    }
  },

  setSleepTimer(minutes: number) {
    if (sleepTimeout) {
      clearTimeout(sleepTimeout);
      sleepTimeout = null;
    }
    if (sleepTickInterval) {
      clearInterval(sleepTickInterval);
      sleepTickInterval = null;
    }
    const endAt = Date.now() + minutes * 60 * 1000;
    playerStore.setState({
      sleepTimerEndAt: endAt,
      sleepMinutesLeft: minutes,
      sleepAfterCurrentTrack: false,
    });
    sleepTickInterval = setInterval(() => {
      const diff = endAt - Date.now();
      if (diff <= 0) {
        if (sleepTickInterval) {
          clearInterval(sleepTickInterval);
          sleepTickInterval = null;
        }
        return;
      }
      playerStore.setState({ sleepMinutesLeft: Math.max(1, Math.ceil(diff / 60000)) });
    }, 15000);
    sleepTimeout = setTimeout(() => {
      sleepTimeout = null;
      if (sleepTickInterval) {
        clearInterval(sleepTickInterval);
        sleepTickInterval = null;
      }
      audioPlayer?.pause();
      playerStore.setState({ sleepTimerEndAt: null, sleepMinutesLeft: null });
    }, minutes * 60 * 1000);
  },

  setSleepAfterCurrentTrack() {
    if (sleepTimeout) {
      clearTimeout(sleepTimeout);
      sleepTimeout = null;
    }
    if (sleepTickInterval) {
      clearInterval(sleepTickInterval);
      sleepTickInterval = null;
    }
    playerStore.setState({
      sleepTimerEndAt: null,
      sleepMinutesLeft: null,
      sleepAfterCurrentTrack: true,
    });
  },

  clearSleepTimer() {
    if (sleepTimeout) {
      clearTimeout(sleepTimeout);
      sleepTimeout = null;
    }
    if (sleepTickInterval) {
      clearInterval(sleepTickInterval);
      sleepTickInterval = null;
    }
    playerStore.setState({
      sleepTimerEndAt: null,
      sleepMinutesLeft: null,
      sleepAfterCurrentTrack: false,
    });
  },

  async cacheCurrentTrack(): Promise<boolean> {
    const { track, activeQuality } = playerStore.getState();
    if (!track) {
      return false;
    }
    const targetQuality = activeQuality || getSettingsSnapshot().preferredQuality;
    const source = await resolveSongSource(track, targetQuality, { ignoreCache: true });
    await offlineCacheActions.downloadTrack(track, source.uri, source.quality);
    return true;
  },

  playNext(track: PlayerTrack) {
    const { queue, index, track: currentTrack } = playerStore.getState();
    if (!currentTrack || !queue.length || index < 0) {
      void playerActions.playTracks([track], 0);
      return;
    }
    if (currentTrack.hash === track.hash) {
      return;
    }

    let nextIndex = index;
    const filtered: PlayerTrack[] = [];
    queue.forEach((item, idx) => {
      if (item.hash === track.hash) {
        if (idx < index) {
          nextIndex -= 1;
        }
        return;
      }
      filtered.push(item);
    });

    const insertPos = Math.min(filtered.length, Math.max(0, nextIndex) + 1);
    const nextQueue = [
      ...filtered.slice(0, insertPos),
      track,
      ...filtered.slice(insertPos),
    ];
    playNextHashes.add(track.hash);
    playerStore.setState({ queue: nextQueue, index: nextIndex });
  },

  clearQueue() {
    playNextHashes.clear();
    loadSequence += 1;
    queueGeneration += 1;
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }

    audioPlayer?.pause();
    audioPlayer?.clearLockScreenControls();
    playerStore.setState({
      ...INITIAL_PLAYER_STATE,
      mode: playerStore.getState().mode,
    });
    progressStore.setState(INITIAL_PROGRESS_STATE);
  },
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    playerStore.subscribe,
    playerStore.getState,
    playerStore.getInitialState
  );
}

/** 仅订阅“是否有曲目”这一布尔值，供布局类组件使用，避免高频重渲染。 */
export function useHasTrack(): boolean {
  return useSyncExternalStore(
    playerStore.subscribe,
    () => Boolean(playerStore.getState().track),
    () => false
  );
}

export function usePlayerProgress(): ProgressState {
  return useSyncExternalStore(
    progressStore.subscribe,
    progressStore.getState,
    progressStore.getInitialState
  );
}

type ProgressSelection = string | number | boolean | null | undefined;

export function usePlayerProgressSelector<T extends ProgressSelection>(
  selector: (state: ProgressState) => T
): T {
  return useSyncExternalStore(
    progressStore.subscribe,
    () => selector(progressStore.getState()),
    () => selector(progressStore.getInitialState())
  );
}
