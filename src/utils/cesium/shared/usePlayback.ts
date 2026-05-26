/* ==============================
 * usePlayback —— 通用轨迹回放核心
 * 基于 Cesium Clock + SampledPositionProperty
 * 供 GeoPath / FlightTrack 共用
 * ============================== */

import { ref, toRaw, type ComputedRef } from 'vue';
import {
  Cartesian3,
  Color,
  Math as CesiumMath,
  JulianDate,
  SampledPositionProperty,
  ClockRange,
} from 'cesium';
import { isValidViewer } from './common';

/** 回放关键帧 */
export interface PlaybackKeyframe {
  /** 时间（秒，从0开始） */
  time: number;
  /** 位置 */
  position: Cartesian3;
  /** 航向（度），可选 */
  heading?: number;
  /** 俯仰（度），可选 */
  pitch?: number;
  /** 横滚（度），可选 */
  roll?: number;
}

/** 回放轨道 */
export interface PlaybackTrack {
  id: string;
  keyframes: PlaybackKeyframe[];
  /** 总时长（秒） */
  totalTime: number;
  /** 主题色（marker/trail 用） */
  color?: string;
}

/** 回放选项 */
export interface PlaybackOptions {
  /** 倍速，默认 1 */
  speed?: number;
  /** 相机跟随，默认 true */
  followCamera?: boolean;
  /** 显示尾迹，默认 true */
  showTrail?: boolean;
  /** 尾迹颜色，默认 #52C41A */
  trailColor?: string;
  /** 显示方向箭头，默认 true */
  showDirection?: boolean;
  /** trail/marker 是否贴地，默认 false */
  clampToGround?: boolean;
  /** trackedEntity 视角偏移，默认 (0, -150, 60) */
  viewFromOffset?: Cartesian3;
  /** 基础速度（m/s），用于计算 currentDistance，默认 1 */
  baseSpeed?: number;
}

const DEFAULT_OPTIONS: Required<PlaybackOptions> = {
  speed: 1,
  followCamera: true,
  showTrail: true,
  trailColor: '#52C41A',
  showDirection: true,
  clampToGround: false,
  viewFromOffset: new Cartesian3(0, -150, 60),
  baseSpeed: 1,
};

/** 方向箭头 Canvas 缓存 */
let cachedDirectionCanvas: HTMLCanvasElement | null = null;

function createDirectionCanvas(): HTMLCanvasElement {
  if (cachedDirectionCanvas) return cachedDirectionCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(44, 28);
  ctx.lineTo(36, 28);
  ctx.lineTo(36, 52);
  ctx.lineTo(28, 52);
  ctx.lineTo(28, 28);
  ctx.lineTo(20, 28);
  ctx.closePath();
  ctx.fillStyle = '#FF4D4F';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  cachedDirectionCanvas = canvas;
  return canvas;
}

/* ── requestRenderMode & terrain SSE 引用计数（多实例共用） ── */
let requestRenderModeRefCount = 0;
let originalRequestRenderMode: boolean | undefined = undefined;
let terrainSSERefCount = 0;
let originalMaxSSE: number | undefined = undefined;
const PLAYBACK_SSE = 4; // 播放期间降低 terrain 精度以提升帧率（默认 2）

export function usePlayback(options: { viewer: ComputedRef<any> }) {
  const { viewer } = options;

  /* ===== 响应式状态 ===== */
  const isPlaying = ref(false);
  const isPaused = ref(false);
  const progress = ref(0);
  const currentTime = ref(0);
  const currentDistance = ref(0);
  const speed = ref(1);
  const followCamera = ref(true);

  /* ===== 内部状态 ===== */
  let opts: Required<PlaybackOptions> = { ...DEFAULT_OPTIONS };
  let activeTrackId = '';
  let activeTrackTotalTime = 0;
  let activeKeyframes: PlaybackKeyframe[] = [];
  let sampledPosition: SampledPositionProperty | null = null;
  let startTime: JulianDate | null = null;
  let stopTime: JulianDate | null = null;
  let onTickRemoveCallback: (() => void) | null = null;

  /* ===== 运行时缓存（避免每帧查找） ===== */
  let cachedTrailEntity: any = null;
  let cachedDirEntity: any = null;
  let lastKeyframeIndex = 0;
  let lastTrailIndex = -1;
  let lastHeading: number | undefined = undefined;

  /* ===== 实体 ID 工具 ===== */
  function entityId(suffix: string) {
    return `playback_${activeTrackId}_${suffix}`;
  }

  function findEntity(v: any, suffix: string) {
    return v.entities.getById(entityId(suffix)) ?? null;
  }

  function removeAllEntities(v: any) {
    if (!activeTrackId) return;
    const prefix = `playback_${activeTrackId}`;
    const toRemove: any[] = [];
    v.entities.values.forEach((e: any) => {
      if (e.id && (e.id as string).startsWith(prefix)) toRemove.push(e);
    });
    toRemove.forEach((e) => v.entities.remove(e));
    cachedTrailEntity = null;
    cachedDirEntity = null;
    lastKeyframeIndex = 0;
    lastTrailIndex = -1;
    lastHeading = undefined;
  }

  /* ===== 实体创建 ===== */
  function createEntities(track: PlaybackTrack) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || track.keyframes.length < 2) return;

    const first = track.keyframes[0];
    const firstPos = first.position;
    const markerColor = Color.fromCssColorString(track.color ?? '#1890FF');

    // aircraft point
    v.entities.add({
      id: entityId('aircraft'),
      position: sampledPosition!,
      point: {
        pixelSize: 16,
        color: markerColor,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: opts.clampToGround ? 1 : 0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // direction billboard
    if (opts.showDirection && first.heading !== undefined) {
      v.entities.add({
        id: entityId('direction'),
        position: sampledPosition!,
        billboard: {
          image: createDirectionCanvas(),
          scale: 0.5,
          rotation: CesiumMath.toRadians(-first.heading),
          alignedAxis: Cartesian3.UNIT_Z,
          width: 32,
          height: 32,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // trail polyline
    if (opts.showTrail) {
      v.entities.add({
        id: entityId('trail'),
        polyline: {
          positions: [firstPos, firstPos],
          width: 4,
          material: Color.fromCssColorString(opts.trailColor).withAlpha(0.6),
          clampToGround: opts.clampToGround,
        },
      });
    }

    // trackedEntity camera follow
    if (opts.followCamera) {
      const aircraftEntity = findEntity(v, 'aircraft');
      if (aircraftEntity) v.trackedEntity = aircraftEntity;
    }

    // 缓存引用
    cachedTrailEntity = opts.showTrail ? findEntity(v, 'trail') : null;
    cachedDirEntity = opts.showDirection ? findEntity(v, 'direction') : null;
  }

  /* ===== 构建 SampledPositionProperty ===== */
  function buildSampledProperties(track: PlaybackTrack) {
    const sp = new SampledPositionProperty();
    const st = JulianDate.fromDate(new Date(0));

    for (const kf of track.keyframes) {
      const t = JulianDate.addSeconds(st, kf.time, new JulianDate());
      sp.addSample(t, kf.position);
    }

    sampledPosition = sp;
    startTime = st;
    stopTime = JulianDate.addSeconds(st, track.totalTime, new JulianDate());
  }

  /* ===== 根据时间找最近帧索引（单调递增搜索） ===== */
  function findKeyframeIndex(time: number): number {
    const n = activeKeyframes.length;
    if (n === 0) return 0;

    let i = lastKeyframeIndex;
    if (time < activeKeyframes[i].time) {
      i = 0;
    }
    for (; i < n - 1; i++) {
      if (time < activeKeyframes[i + 1].time) {
        lastKeyframeIndex = i;
        return i;
      }
    }
    lastKeyframeIndex = n - 1;
    return n - 1;
  }

  /* ===== 同步播放状态 ===== */
  function syncPlaybackState(v: any, elapsed: number) {
    const clamped = Math.max(0, Math.min(activeTrackTotalTime, elapsed));
    currentTime.value = clamped;
    progress.value = activeTrackTotalTime > 0 ? clamped / activeTrackTotalTime : 0;
    currentDistance.value = clamped * opts.baseSpeed;

    const idx = findKeyframeIndex(clamped);
    const nextIdx = Math.min(idx + 1, activeKeyframes.length - 1);

    // 更新尾迹（只在索引变化时重设）
    if (cachedTrailEntity && nextIdx !== lastTrailIndex) {
      lastTrailIndex = nextIdx;
      const trailPositions: Cartesian3[] = [];
      for (let i = 0; i <= nextIdx; i++) {
        trailPositions.push(activeKeyframes[i].position);
      }
      (cachedTrailEntity.polyline as any).positions = trailPositions;
    }

    // 更新方向箭头（只在 heading 变化时更新）
    if (cachedDirEntity && cachedDirEntity.billboard) {
      const kf = activeKeyframes[idx];
      if (kf?.heading !== undefined && kf.heading !== lastHeading) {
        lastHeading = kf.heading;
        (cachedDirEntity.billboard as any).rotation = CesiumMath.toRadians(-kf.heading);
      }
    }
  }

  /* ===== Clock.onTick 驱动（与 Cesium 渲染同步） ===== */
  function attachOnTick(v: any) {
    if (onTickRemoveCallback) {
      onTickRemoveCallback();
      onTickRemoveCallback = null;
    }

    onTickRemoveCallback = v.clock.onTick.addEventListener((clock: any) => {
      if (!isPlaying.value || isPaused.value) return;
      if (!startTime || !stopTime) return;

      const elapsed = JulianDate.secondsDifference(clock.currentTime, startTime);
      syncPlaybackState(v, elapsed);

      if (JulianDate.greaterThanOrEquals(clock.currentTime, stopTime)) {
        syncPlaybackState(v, activeTrackTotalTime);
        stopPlayback();
      }
    });
  }

  function detachOnTick() {
    if (onTickRemoveCallback) {
      onTickRemoveCallback();
      onTickRemoveCallback = null;
    }
  }

  /* ===== 公开 API ===== */

  function startPlayback(track: PlaybackTrack, partialOpts?: PlaybackOptions) {
    if (!track || track.keyframes.length < 2) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    stopPlayback();

    opts = { ...DEFAULT_OPTIONS, ...partialOpts };
    activeTrackId = track.id;
    activeTrackTotalTime = track.totalTime;
    activeKeyframes = track.keyframes;

    buildSampledProperties(track);

    // 播放期间关闭 requestRenderMode，让 Cesium 以自身 RAF 持续渲染
    if (requestRenderModeRefCount === 0) {
      originalRequestRenderMode = v.scene.requestRenderMode;
      v.scene.requestRenderMode = false;
    }
    requestRenderModeRefCount++;

    // 降低 terrain 精度以提升高空飞行轨迹的帧率
    if (terrainSSERefCount === 0) {
      originalMaxSSE = v.scene.globe.maximumScreenSpaceError;
    }
    terrainSSERefCount++;
    v.scene.globe.maximumScreenSpaceError = PLAYBACK_SSE;

    v.clock.startTime = startTime!.clone();
    v.clock.stopTime = stopTime!.clone();
    v.clock.currentTime = startTime!.clone();
    v.clock.clockRange = ClockRange.CLAMPED;
    v.clock.multiplier = opts.speed;
    v.clock.shouldAnimate = true;

    createEntities(track);
    attachOnTick(v);

    isPlaying.value = true;
    isPaused.value = false;
    progress.value = 0;
    currentTime.value = 0;
    speed.value = opts.speed;
    followCamera.value = opts.followCamera;
  }

  function pausePlayback() {
    if (!isPlaying.value || isPaused.value) return;
    isPaused.value = true;
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) v.clock.shouldAnimate = false;
  }

  function resumePlayback() {
    if (!isPlaying.value || !isPaused.value) return;
    isPaused.value = false;
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) v.clock.shouldAnimate = true;
  }

  function stopPlayback() {
    const v = toRaw(viewer.value);

    // 无论 Viewer 是否有效都减少引用计数，防止泄漏
    if (requestRenderModeRefCount > 0) requestRenderModeRefCount--;
    if (terrainSSERefCount > 0) terrainSSERefCount--;

    if (isValidViewer(v)) {
      v.clock.shouldAnimate = false;
      v.trackedEntity = undefined;
      if (startTime) JulianDate.clone(startTime, v.clock.currentTime);
      removeAllEntities(v);

      // 恢复 requestRenderMode
      if (requestRenderModeRefCount <= 0) {
        requestRenderModeRefCount = 0;
        if (originalRequestRenderMode !== undefined) {
          v.scene.requestRenderMode = originalRequestRenderMode;
          originalRequestRenderMode = undefined;
        }
      }

      // 恢复 terrain SSE
      if (terrainSSERefCount <= 0) {
        terrainSSERefCount = 0;
        if (originalMaxSSE !== undefined) {
          v.scene.globe.maximumScreenSpaceError = originalMaxSSE;
          originalMaxSSE = undefined;
        }
      }
    }

    detachOnTick();

    isPlaying.value = false;
    isPaused.value = false;
    progress.value = 0;
    currentTime.value = 0;
    currentDistance.value = 0;
    activeTrackId = '';
    activeTrackTotalTime = 0;
    activeKeyframes = [];
    sampledPosition = null;
    startTime = null;
    stopTime = null;
    cachedTrailEntity = null;
    cachedDirEntity = null;
    lastKeyframeIndex = 0;
    lastTrailIndex = -1;
    lastHeading = undefined;
  }

  function seekPlayback(p: number) {
    const clamped = Math.max(0, Math.min(1, p));
    const targetTime = clamped * activeTrackTotalTime;

    const v = toRaw(viewer.value);
    if (isValidViewer(v) && startTime) {
      JulianDate.addSeconds(startTime, targetTime, v.clock.currentTime);
    }

    progress.value = clamped;
    currentTime.value = targetTime;

    // seek 后时间可能回退，重置索引缓存
    lastKeyframeIndex = 0;

    // 同步更新尾迹和方向
    const idx = findKeyframeIndex(targetTime);
    const nextIdx = Math.min(idx + 1, activeKeyframes.length - 1);

    if (cachedTrailEntity) {
      lastTrailIndex = nextIdx;
      const trailPositions: Cartesian3[] = [];
      for (let i = 0; i <= nextIdx; i++) {
        trailPositions.push(activeKeyframes[i].position);
      }
      (cachedTrailEntity.polyline as any).positions = trailPositions;
    }

    if (cachedDirEntity && cachedDirEntity.billboard) {
      const kf = activeKeyframes[idx];
      if (kf?.heading !== undefined) {
        lastHeading = kf.heading;
        (cachedDirEntity.billboard as any).rotation = CesiumMath.toRadians(-kf.heading);
      }
    }
  }

  function setPlaybackSpeed(s: number) {
    speed.value = s;
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) v.clock.multiplier = s;
  }

  function togglePlaybackFollowCamera() {
    followCamera.value = !followCamera.value;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    if (followCamera.value && isPlaying.value) {
      const aircraftEntity = findEntity(v, 'aircraft');
      if (aircraftEntity) v.trackedEntity = aircraftEntity;
    } else {
      v.trackedEntity = undefined;
    }
  }

  function destroy() {
    stopPlayback();
  }

  return {
    isPlaying,
    isPaused,
    progress,
    currentTime,
    currentDistance,
    speed,
    followCamera,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    seekPlayback,
    setPlaybackSpeed,
    togglePlaybackFollowCamera,
    destroy,
  };
}
