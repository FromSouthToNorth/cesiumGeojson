/* ==============================
 * FlightTrack Store — DJI 飞行轨迹管理
 * 解析 frames.json，在 Cesium 中绘制轨迹、播放动画、显示姿态
 * ============================== */

import { ref, computed, toRaw, watch, markRaw, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import {
  Cartesian3,
  Color,
  Math as CesiumMath,
  EllipsoidGeodesic,
  Cartographic,
  sampleTerrain,
  BoundingSphere,
  HeadingPitchRange,
} from 'cesium';
import { useCesiumStore } from './cesiumStore';
import { usePlayback } from '@/utils/cesium/shared/usePlayback';
import type { PlaybackTrack } from '@/utils/cesium/shared/usePlayback';
import { isValidViewer, genId } from '@/utils/cesium/shared/common';
import type { FlightTrack, FlightTrackFrame, PlaybackState } from '@/types/flightTrack';

/* ── 颜色配置 ── */
const START_COLOR = '#52C41A';
const END_COLOR = '#FA541C';

/** 计算两帧之间的大地距离（水平 + 垂直） */
function calcFrameDistance(a: FlightTrackFrame, b: FlightTrackFrame): number {
  const c1 = Cartographic.fromDegrees(a.longitude, a.latitude);
  const c2 = Cartographic.fromDegrees(b.longitude, b.latitude);
  const horizontal = new EllipsoidGeodesic(c1, c2).surfaceDistance;
  const vertical = Math.abs(b.altitude - a.altitude);
  return Math.sqrt(horizontal * horizontal + vertical * vertical);
}

/** 从 GPSSignalLevel 字符串提取数字，如 'Level5' → 5 */
function parseGPSSignalLevel(level: string | undefined): number {
  if (!level) return 0;
  const match = String(level).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/** 将 FlightTrack 转换为通用 PlaybackTrack */
function toPlaybackTrack(track: FlightTrack): PlaybackTrack {
  return {
    id: track.id,
    keyframes: track.frames.map((f, i) => ({
      time: f.timestamp,
      position: toRaw(track.positions[i]),
      heading: f.aircraft.yaw,
      pitch: f.aircraft.pitch,
      roll: f.aircraft.roll,
    })),
    totalTime: track.totalTime,
    color: '#FF4D4F',
  };
}

/** 解析 DJI json_result.json 为 FlightTrack */
async function parseDJIFrames(json: any, v?: any): Promise<FlightTrack> {
  const summary = json.summary || {};
  const frameStates: any[] = json.info?.frameTimeStates || [];

  // 过滤有效帧（有 GPS 坐标的）
  const validRaw = frameStates.filter((f) => {
    const loc = f.flightControllerState?.aircraftLocation;
    return loc && loc.latitude !== 0 && loc.longitude !== 0;
  });

  const totalTime = summary.totalTime ?? 0;
  const frameCount = validRaw.length;
  const timeInterval = frameCount > 1 ? totalTime / (frameCount - 1) : 0;

  // 取第一个有效点的地形海拔作为基准，叠加到每帧的相对高度上
  let terrainHeight = 0;
  if (isValidViewer(v) && validRaw.length > 0) {
    const firstLoc = validRaw[0].flightControllerState?.aircraftLocation;
    if (firstLoc) {
      try {
        const sampled = await sampleTerrain(v.terrainProvider, 11, [
          Cartographic.fromDegrees(firstLoc.longitude, firstLoc.latitude),
        ]);
        if (sampled[0]?.height !== undefined) {
          terrainHeight = sampled[0].height;
        }
      } catch {
        console.warn('[flightTrack] 地形海拔查询失败，使用相对高度');
      }
    }
  }

  const frames: FlightTrackFrame[] = validRaw.map((f, idx) => {
    const fcs = f.flightControllerState || {};
    const loc = fcs.aircraftLocation || {};
    const attitude = fcs.attitude || {};
    const velocity = fcs.velocity || {};

    // 云台数据可能在 gimbalState 或 gimbalsState['0'] 中，字段名是 atitude（少一个 t）
    const gimbal = f.gimbalState || f.gimbalsState?.['0'] || {};
    const gimbalAttitude = gimbal.atitude || gimbal.attitude || {};

    // 相机、电池数据同理
    const camera = f.cameraState || f.camerasState?.['0'] || {};
    const battery = f.batteryState || f.batteriesState?.['0'] || {};
    const airLink = f.airLinkState || {};

    // DJI 的 altitude 是相对高度，叠加地形海拔得绝对海拔
    const relativeHeight = fcs.altitude ?? 0;
    const absoluteAlt = relativeHeight + terrainHeight;

    const speed = Math.sqrt(
      (velocity.velocityX || 0) ** 2 + (velocity.velocityY || 0) ** 2 + (velocity.velocityZ || 0) ** 2,
    );

    return {
      timestamp: fcs.flightTimeInSeconds ?? idx * timeInterval,
      longitude: loc.longitude ?? 0,
      latitude: loc.latitude ?? 0,
      height: relativeHeight,
      altitude: absoluteAlt,
      speed,
      aircraft: {
        pitch: attitude.pitch ?? 0,
        roll: attitude.roll ?? 0,
        yaw: attitude.yaw ?? 0,
      },
      gimbal: {
        mode: gimbal.mode || 'Unknown',
        pitch: gimbalAttitude.pitch ?? 0,
        roll: gimbalAttitude.roll ?? 0,
        yaw: gimbalAttitude.yaw ?? 0,
      },
      camera: {
        isPhoto: camera.isShootingSinglePhoto ?? false,
        isVideo: camera.isRecording ?? false,
      },
      battery: {
        chargeLevel: battery.chargeRemainingInPercent ?? 0,
        voltage: (battery.voltage ?? 0) / 1000, // mV → V
        current: battery.current ?? 0,
        temperature: battery.temperature ?? 0,
      },
      rc: {
        downlinkSignal: airLink.downlinkSignalQuality ?? null,
        uplinkSignal: airLink.uplinkSignalQuality ?? null,
      },
      flycState: fcs.flightMode || 'Unknown',
      flightAction: 'None',
      gpsNum: fcs.satelliteCount ?? parseGPSSignalLevel(fcs.GPSSignalLevel),
    };
  });

  let totalDistance = summary.totalDistance ?? 0;
  if (totalDistance <= 0) {
    for (let i = 1; i < frames.length; i++) {
      totalDistance += calcFrameDistance(frames[i - 1], frames[i]);
    }
  }

  const positions = markRaw(frames.map((f) => Cartesian3.fromDegrees(f.longitude, f.latitude, f.altitude)));

  const appVersion = Array.isArray(summary.appVersion) ? summary.appVersion.join('.') : summary.appVersion || '';

  return {
    id: genId(),
    name: `${summary.aircraftName || 'DJI'} 飞行记录`,
    show: true,
    frames,
    positions,
    totalTime,
    totalDistance,
    maxHeight: summary.maxHeight ?? 0,
    maxSpeed: summary.maxHorizontalSpeed ?? 0,
    aircraftName: summary.aircraftName || 'Unknown',
    aircraftSn: summary.flightControllerInformation?.serialNumber || '',
    appVersion,
    createdAt: Date.now(),
  };
}

export const useFlightTrackStore = defineStore('flightTrack', () => {
  const cesiumStore = useCesiumStore();
  const viewer = computed(() => cesiumStore.viewer);

  /* ── 通用回放实例 ── */
  const pb = usePlayback({ viewer });

  /* ── 状态 ── */
  const tracks = ref<FlightTrack[]>([]);
  const activeTrackId = ref<string | null>(null);
  const isLoading = ref(false);

  /** 播放状态（shallowRef：避免 Vue 深度代理触发大量 UI 重渲染） */
  const playback = shallowRef<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    progress: 0,
    currentFrameIndex: 0,
  });

  /* ── 同步 pb 状态到 playback shallowRef ──
   * 规则：
   * 1. isPlaying / isPaused 立即同步（按钮状态需要即时反馈）
   * 2. currentTime / progress / currentFrameIndex 与 usePlayback 的 syncUiState 相同节奏
   *    避免 FlightTrack.vue 的 currentFrame computed + 大量 DOM 每 200ms 重渲染
   */
  watch(pb.isPlaying, (v) => {
    playback.value = { ...playback.value, isPlaying: v };
  });
  watch(pb.isPaused, (v) => {
    playback.value = { ...playback.value, isPaused: v };
  });

  watch(pb.currentTime, (v) => {
    const track = activeTrack.value;
    let frameIdx = playback.value.currentFrameIndex;
    if (track) {
      frameIdx = findFrameInterval(track.frames, v).index;
    }
    playback.value = {
      ...playback.value,
      currentTime: v,
      progress: pb.progress.value,
      currentFrameIndex: frameIdx,
    };
  });

  const activeTrack = computed(() => tracks.value.find((t) => t.id === activeTrackId.value) ?? null);
  const hasTracks = computed(() => tracks.value.length > 0);

  /* ── 加载轨迹 ── */

  /** 从 URL 加载 frames.json */
  async function loadFromUrl(url: string): Promise<void> {
    isLoading.value = true;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const v = toRaw(viewer.value);
      const track = await parseDJIFrames(json, v);
      registerTrack(track);
    } catch (e) {
      console.error('加载飞行轨迹失败:', e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  /** 从文件加载 */
  async function loadFromFile(file: File): Promise<void> {
    isLoading.value = true;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const v = toRaw(viewer.value);
      const track = await parseDJIFrames(json, v);
      track.name = file.name.replace(/\.json$/, '');
      registerTrack(track);
    } catch (e) {
      console.error('解析飞行轨迹文件失败:', e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  /** 将轨迹注册到 store 并创建实体 */
  function registerTrack(track: FlightTrack): void {
    tracks.value.push(track);
    activeTrackId.value = track.id;
    createTrackEntities(track);
    flyToTrack(track.id);
  }

  /* ── Cesium 实体管理 ── */

  function createTrackEntities(track: FlightTrack) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const frames = track.frames;
    const positions = track.positions;

    if (positions.length < 2) return;

    // 1. 轨迹线（按高度着色，单 Entity + 顶点颜色，避免 N 个 Entity 拖垮帧率）
    const heights = frames.map((f) => f.altitude);
    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);
    const hRange = Math.max(maxH - minH, 1);

    const colors = frames.map((f) => {
      const t = (f.altitude - minH) / hRange;
      return heightToColor(t);
    });

    v.entities.add({
      id: `flightTrack_${track.id}_trail`,
      polyline: {
        positions,
        width: 3,
        colors,
        colorsPerVertex: true,
        clampToGround: false,
      } as any,
    });

    // 2. 起点标记
    v.entities.add({
      id: `flightTrack_${track.id}_start`,
      position: positions[0],
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString(START_COLOR),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '起点',
        font: '12px sans-serif',
        fillColor: Color.fromCssColorString(START_COLOR),
        pixelOffset: new Cartesian3(0, -18, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // 3. 终点标记
    v.entities.add({
      id: `flightTrack_${track.id}_end`,
      position: positions[positions.length - 1],
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString(END_COLOR),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '终点',
        font: '12px sans-serif',
        fillColor: Color.fromCssColorString(END_COLOR),
        pixelOffset: new Cartesian3(0, -18, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /** 高度映射颜色（绿→黄→红） */
  function heightToColor(t: number): Color {
    if (t < 0.5) {
      const t2 = t / 0.5;
      return new Color(t2, 1, 0);
    }
    const t2 = (t - 0.5) / 0.5;
    return new Color(1, 1 - t2, 0);
  }

  /** 单调递增缓存，避免每帧 O(n) 线性扫描 */
  let lastFindFrameIndex = 0;

  /** 根据时间找到当前所处的帧区间和插值系数 t（0~1） */
  function findFrameInterval(
    frames: FlightTrackFrame[],
    time: number,
  ): { index: number; nextIndex: number; t: number } {
    const n = frames.length;
    if (n === 0) return { index: 0, nextIndex: 0, t: 0 };

    let i = lastFindFrameIndex;
    if (time < frames[i].timestamp) {
      i = 0;
    }
    for (; i < n - 1; i++) {
      if (time < frames[i + 1].timestamp) {
        lastFindFrameIndex = i;
        const t = (time - frames[i].timestamp) / (frames[i + 1].timestamp - frames[i].timestamp || 1);
        return { index: i, nextIndex: i + 1, t };
      }
    }
    lastFindFrameIndex = n - 1;
    const last = n - 1;
    return { index: last, nextIndex: last, t: 0 };
  }

  function removeTrackEntities(trackId: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const prefix = `flightTrack_${trackId}`;
    const toRemove = v.entities.values.filter((e: any) => e.id && (e.id as string).startsWith(prefix));
    toRemove.forEach((e: any) => v.entities.remove(e));
  }

  /* ── 播放控制（委托给 usePlayback） ── */

  function startPlayback(trackId?: string) {
    const id = trackId ?? activeTrackId.value;
    if (!id) return;
    const track = tracks.value.find((t) => t.id === id);
    if (!track || track.frames.length < 2) return;

    activeTrackId.value = id;
    lastFindFrameIndex = 0;
    pb.startPlayback(toPlaybackTrack(track), {
      speed: pb.speed.value,
      followCamera: pb.followCamera.value,
    });
  }

  function pausePlayback() {
    pb.pausePlayback();
  }

  function resumePlayback() {
    pb.resumePlayback();
  }

  function stopPlayback() {
    lastFindFrameIndex = 0;
    pb.stopPlayback();
  }

  function seekPlayback(p: number) {
    lastFindFrameIndex = 0;
    pb.seekPlayback(p);
  }

  function setPlaybackSpeed(s: number) {
    pb.setPlaybackSpeed(s);
  }

  function togglePlaybackFollowCamera() {
    pb.togglePlaybackFollowCamera();
  }

  /* ── 轨迹管理 ── */

  function removeTrack(id: string) {
    stopPlayback();
    removeTrackEntities(id);
    tracks.value = tracks.value.filter((t) => t.id !== id);
    if (activeTrackId.value === id) {
      activeTrackId.value = tracks.value.length > 0 ? tracks.value[0].id : null;
    }
  }

  function clearAll() {
    stopPlayback();
    for (const t of tracks.value) {
      removeTrackEntities(t.id);
    }
    tracks.value = [];
    activeTrackId.value = null;
  }

  function selectTrack(id: string) {
    activeTrackId.value = id;
  }

  function toggleVisibility(id: string) {
    const track = tracks.value.find((t) => t.id === id);
    if (!track) return;
    track.show = !track.show;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const prefix = `flightTrack_${id}`;
    v.entities.values.forEach((e: any) => {
      if (e.id && (e.id as string).startsWith(prefix)) {
        e.show = track.show;
      }
    });
  }

  function flyToTrack(id: string) {
    const track = tracks.value.find((t) => t.id === id);
    if (!track || track.positions.length === 0) return;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    if (track.positions.length === 1) {
      v.camera.flyTo({
        destination: track.positions[0],
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
      });
      return;
    }

    // 用所有轨迹点计算 3D 包围球，自动适配相机距离和角度
    const boundingSphere = BoundingSphere.fromPoints(track.positions);
    v.camera.flyToBoundingSphere(boundingSphere, {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), boundingSphere.radius * 2.5),
    });
  }

  return {
    tracks,
    activeTrackId,
    activeTrack,
    hasTracks,
    isLoading,
    playback,
    playbackSpeed: pb.speed,
    playbackFollowCamera: pb.followCamera,
    loadFromUrl,
    loadFromFile,
    removeTrack,
    clearAll,
    selectTrack,
    toggleVisibility,
    flyToTrack,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    seekPlayback,
    setPlaybackSpeed,
    togglePlaybackFollowCamera,
  };
});
