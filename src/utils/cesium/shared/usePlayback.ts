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
  SampledProperty,
  Quaternion,
  ClockRange,
  HeadingPitchRoll,
  Transforms,
  Ellipsoid,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
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

/** ENU 变换工厂（模块级常量，避免每次 startPlayback 重复创建） */
const ENU_TRANSFORM = Transforms.localFrameToFixedFrameGenerator('east', 'north');
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
  let sampledOrientation: SampledProperty | null = null;
  let startTime: JulianDate | null = null;
  let stopTime: JulianDate | null = null;
  let onTickRemoveCallback: (() => void) | null = null;

  /* ===== 运行时缓存（避免每帧查找） ===== */
  let cachedTrailEntity: any = null;
  let cachedDirEntity: any = null;
  let lastKeyframeIndex = 0;
  let lastTrailIndex = -1;
  let lastHeading: number | undefined = undefined;
  let lastUiUpdateTime = 0;
  const UI_UPDATE_INTERVAL = 500; // ms，限制 Vue 响应式更新频率，与 FlightTrack store 同步
  let trailPositions: Cartesian3[] = []; // 预分配，避免每次重建数组
  let clickHandler: ScreenSpaceEventHandler | null = null; // 暂停时点击无人机恢复播放

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
    trailPositions = [];
    sampledOrientation = null;
  }

  /* ===== 实体创建 ===== */
  function createEntities(track: PlaybackTrack) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || track.keyframes.length < 2) return;

    const first = track.keyframes[0];
    const firstPos = first.position;

    // 无人机 3D 模型（orientation 用 SampledProperty 预采样，Cesium 自动插值，平滑无跳变）
    v.entities.add({
      id: entityId('aircraft'),
      position: sampledPosition!,
      orientation: sampledOrientation!,
      model: {
        uri: '/models/drone.glb',
        scale: 1,
        minimumPixelSize: 32,
        heightReference: opts.clampToGround ? 1 : 0,
        silhouetteColor: Color.fromCssColorString('#FF4D4F'),
        silhouetteSize: 1,
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

    // trail polyline —— 预分配数组，只追加不重建，避免 Cesium 每帧重建 geometry
    if (opts.showTrail) {
      trailPositions = [firstPos];
      v.entities.add({
        id: entityId('trail'),
        polyline: {
          positions: trailPositions,
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
    const so = new SampledProperty(Quaternion);
    const st = JulianDate.fromDate(new Date(0));

    // ENU 坐标系：Entity.orientation 使用 ENU，与 NED 的 HPR 定义不同
    // NED 中 pitch 绕横向轴(East)、roll 绕纵向轴(North)
    // ENU 中 pitch 绕纵向轴(North)、roll 绕横向轴(East)
    // 因此 DJI 的 NED 姿态需要映射：heading=yaw, pitch=roll, roll=-pitch

    for (const kf of track.keyframes) {
      const t = JulianDate.addSeconds(st, kf.time, new JulianDate());
      sp.addSample(t, kf.position);

      const hpr = new HeadingPitchRoll(
        CesiumMath.toRadians(kf.heading ?? 0),
        CesiumMath.toRadians(kf.roll ?? 0),
        CesiumMath.toRadians(-(kf.pitch ?? 0)),
      );
      so.addSample(t, Transforms.headingPitchRollQuaternion(kf.position, hpr, Ellipsoid.WGS84, ENU_TRANSFORM));
    }

    sampledPosition = sp;
    sampledOrientation = so;
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

  /* ===== 同步 Cesium 实体（每 tick 执行，与渲染帧同步） ===== */
  function syncEntities(_v: any, elapsed: number) {
    const clamped = Math.max(0, Math.min(activeTrackTotalTime, elapsed));
    const idx = findKeyframeIndex(clamped);
    const nextIdx = Math.min(idx + 1, activeKeyframes.length - 1);

    // 更新尾迹：只追加新点，避免每次重建整个数组 + Cesium geometry
    if (cachedTrailEntity && nextIdx > lastTrailIndex) {
      for (let i = lastTrailIndex + 1; i <= nextIdx; i++) {
        trailPositions.push(activeKeyframes[i].position);
      }
      lastTrailIndex = nextIdx;
      (cachedTrailEntity.polyline as any).positions = trailPositions;
    }

    const kf = activeKeyframes[idx];

    // 更新方向箭头（每 tick 更新，确保与无人机模型姿态同步）
    if (cachedDirEntity && cachedDirEntity.billboard && kf) {
      if (kf.heading !== undefined && kf.heading !== lastHeading) {
        lastHeading = kf.heading;
        (cachedDirEntity.billboard as any).rotation = CesiumMath.toRadians(-kf.heading);
      }
    }
  }

  /* ===== 同步 Vue ref 状态（限制频率，避免 UI 组件每帧重渲染） ===== */
  function syncUiState(elapsed: number) {
    const clamped = Math.max(0, Math.min(activeTrackTotalTime, elapsed));
    currentTime.value = clamped;
    progress.value = activeTrackTotalTime > 0 ? clamped / activeTrackTotalTime : 0;
    currentDistance.value = clamped * opts.baseSpeed;
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

      // 结束检测每 tick 执行，不能漏
      if (JulianDate.greaterThanOrEquals(clock.currentTime, stopTime)) {
        syncEntities(v, activeTrackTotalTime);
        syncUiState(activeTrackTotalTime);
        stopPlayback();
        return;
      }

      // Cesium 实体（尾迹、方向箭头）每 tick 更新，与渲染帧同步
      syncEntities(v, elapsed);

      // Vue ref 限制更新频率，避免 UI 组件每帧重渲染
      const now = performance.now();
      if (now - lastUiUpdateTime >= UI_UPDATE_INTERVAL) {
        lastUiUpdateTime = now;
        syncUiState(elapsed);
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

    // 暂停时点击无人机恢复播放
    if (!clickHandler) {
      clickHandler = new ScreenSpaceEventHandler(v.scene.canvas);
      clickHandler.setInputAction((click: any) => {
        if (!isPlaying.value || !isPaused.value) return;
        const picked = v.scene.pick(click.position);
        if (picked?.id?.id === entityId('aircraft')) {
          resumePlayback();
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
    }

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

    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }

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
      trailPositions.length = 0;
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
