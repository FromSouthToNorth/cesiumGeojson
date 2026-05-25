/* ==============================
 * FlightTrack Store — DJI 飞行轨迹管理
 * 解析 frames.json，在 Cesium 中绘制轨迹、播放动画、显示姿态
 * ============================== */

import { ref, computed, toRaw } from 'vue';
import { defineStore } from 'pinia';
import {
  Cartesian3,
  Color,
  HeadingPitchRoll,
  Transforms,
  Math as CesiumMath,
  EllipsoidGeodesic,
  Cartographic,
} from 'cesium';
import { useCesiumStore } from './cesiumStore';
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

/** 解析 DJI json_result.json 为 FlightTrack（ altitude 为相对高度，需加上 takeoffLocationAltitude 得绝对海拔） */
function parseDJIFrames(json: any): FlightTrack {
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

    // DJI 的 altitude 是相对高度，绝对海拔 = 相对高度 + 起飞点海拔
    const relativeHeight = fcs.altitude ?? 0;
    const takeoffAlt = fcs.takeoffLocationAltitude ?? 0;

    const speed = Math.sqrt(
      (velocity.velocityX || 0) ** 2 +
        (velocity.velocityY || 0) ** 2 +
        (velocity.velocityZ || 0) ** 2,
    );

    return {
      timestamp: fcs.flightTimeInSeconds ?? idx * timeInterval,
      longitude: loc.longitude ?? 0,
      latitude: loc.latitude ?? 0,
      height: relativeHeight,
      altitude: relativeHeight + takeoffAlt,
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

  const positions = frames.map((f) => Cartesian3.fromDegrees(f.longitude, f.latitude, f.altitude));

  const appVersion = Array.isArray(summary.appVersion)
    ? summary.appVersion.join('.')
    : summary.appVersion || '';

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

  /* ── 状态 ── */
  const tracks = ref<FlightTrack[]>([]);
  const activeTrackId = ref<string | null>(null);
  const isLoading = ref(false);

  /** 播放状态 */
  const playback = ref<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    progress: 0,
    currentFrameIndex: 0,
  });

  const playbackFollowCamera = ref(true);
  let playbackRafId: number | null = null;
  let playbackStartRealTime = 0;
  let playbackPausedTime = 0;
  const playbackSpeed = ref(1);

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
      const track = parseDJIFrames(json);
      tracks.value.push(track);
      activeTrackId.value = track.id;
      createTrackEntities(track);
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
      const track = parseDJIFrames(json);
      track.name = `${file.name.replace(/\.json$/, '')}`;
      tracks.value.push(track);
      activeTrackId.value = track.id;
      createTrackEntities(track);
    } catch (e) {
      console.error('解析飞行轨迹文件失败:', e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  /* ── Cesium 实体管理 ── */

  function createTrackEntities(track: FlightTrack) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const frames = track.frames;
    const positions = track.positions;

    if (positions.length < 2) return;

    // 1. 轨迹线（按高度着色，每段单独 entity）
    const heights = frames.map((f) => f.altitude);
    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);
    const hRange = Math.max(maxH - minH, 1);

    for (let i = 0; i < positions.length - 1; i++) {
      const t = (heights[i] - minH) / hRange;
      const segColor = heightToColor(t);
      v.entities.add({
        id: `flightTrack_${track.id}_seg_${i}`,
        polyline: {
          positions: [positions[i], positions[i + 1]],
          width: 3,
          material: segColor,
          clampToGround: false,
        },
      });
    }

    // 2. 起点标记
    const first = frames[0];
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
        horizontalOrigin: 0, // CENTER
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
        horizontalOrigin: 0, // CENTER
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // 4. 飞机实体（初始位置为起点）
    const hpr = headingPitchRollFromFrame(first);
    const orientation = Transforms.headingPitchRollQuaternion(positions[0], hpr);

    v.entities.add({
      id: `flightTrack_${track.id}_aircraft`,
      position: positions[0],
      orientation,
      point: {
        pixelSize: 16,
        color: Color.fromCssColorString('#FF4D4F'),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // 5. 方向指示器
    v.entities.add({
      id: `flightTrack_${track.id}_direction`,
      position: positions[0],
      billboard: {
        image: createDirectionCanvas(),
        scale: 0.5,
        rotation: CesiumMath.toRadians(-first.aircraft.yaw),
        alignedAxis: Cartesian3.UNIT_Z,
        width: 32,
        height: 32,
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

  /** 从帧数据生成 HeadingPitchRoll */
  function headingPitchRollFromFrame(frame: FlightTrackFrame): HeadingPitchRoll {
    const heading = CesiumMath.toRadians(frame.aircraft.yaw);
    const pitch = CesiumMath.toRadians(frame.aircraft.pitch);
    const roll = CesiumMath.toRadians(frame.aircraft.roll);
    return new HeadingPitchRoll(heading, pitch, roll);
  }

  /** 创建方向箭头 Canvas */
  function createDirectionCanvas(): HTMLCanvasElement {
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

    return canvas;
  }

  function removeTrackEntities(trackId: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;
    const prefix = `flightTrack_${trackId}`;
    const toRemove = v.entities.values.filter((e: any) => e.id && (e.id as string).startsWith(prefix));
    toRemove.forEach((e: any) => v.entities.remove(e));
  }

  function findTrackEntity(trackId: string, suffix: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return null;
    return v.entities.getById(`flightTrack_${trackId}_${suffix}`) ?? null;
  }

  /* ── 播放控制 ── */

  function startPlayback(trackId?: string) {
    const id = trackId ?? activeTrackId.value;
    if (!id) return;
    const track = tracks.value.find((t) => t.id === id);
    if (!track || track.frames.length < 2) return;

    activeTrackId.value = id;
    stopPlayback();

    playback.value = {
      isPlaying: true,
      isPaused: false,
      currentTime: 0,
      progress: 0,
      currentFrameIndex: 0,
    };

    playbackStartRealTime = performance.now();
    playbackPausedTime = 0;
    tickPlayback();
  }

  function tickPlayback() {
    if (!playback.value.isPlaying || playback.value.isPaused) return;

    const track = activeTrack.value;
    if (!track) return;

    const now = performance.now();
    const elapsedReal = (now - playbackStartRealTime - playbackPausedTime) / 1000;
    const elapsedSim = elapsedReal * playbackSpeed.value;

    if (elapsedSim >= track.totalTime) {
      playback.value.currentTime = track.totalTime;
      playback.value.progress = 1;
      playback.value.currentFrameIndex = track.frames.length - 1;
      updateAircraftPosition(track.frames.length - 1);
      playback.value.isPlaying = false;
      return;
    }

    playback.value.currentTime = elapsedSim;
    playback.value.progress = elapsedSim / track.totalTime;

    const frameIdx = findFrameIndexAtTime(track.frames, elapsedSim);
    playback.value.currentFrameIndex = frameIdx;

    updateAircraftPosition(frameIdx);

    playbackRafId = requestAnimationFrame(tickPlayback);
  }

  /** 根据时间找到对应的帧索引 */
  function findFrameIndexAtTime(frames: FlightTrackFrame[], time: number): number {
    for (let i = 0; i < frames.length - 1; i++) {
      if (time >= frames[i].timestamp && time < frames[i + 1].timestamp) {
        const t =
          (time - frames[i].timestamp) / (frames[i + 1].timestamp - frames[i].timestamp || 1);
        return t < 0.5 ? i : i + 1;
      }
    }
    return frames.length - 1;
  }

  /** 更新飞机实体位置和朝向 */
  function updateAircraftPosition(frameIdx: number) {
    const track = activeTrack.value;
    if (!track) return;

    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    const frame = track.frames[frameIdx];
    const pos = track.positions[frameIdx];

    // 更新飞机实体
    const aircraftEntity = findTrackEntity(track.id, 'aircraft');
    if (aircraftEntity) {
      (aircraftEntity.position as any) = pos;
      const hpr = headingPitchRollFromFrame(frame);
      (aircraftEntity.orientation as any) = Transforms.headingPitchRollQuaternion(pos, hpr);
    }

    // 更新方向指示器
    const dirEntity = findTrackEntity(track.id, 'direction');
    if (dirEntity) {
      (dirEntity.position as any) = pos;
      (dirEntity.billboard as any).rotation = CesiumMath.toRadians(-frame.aircraft.yaw);
    }

    // 相机跟随
    if (playbackFollowCamera.value && frameIdx > 0) {
      const heading = CesiumMath.toRadians(frame.aircraft.yaw);
      v.camera.setView({
        destination: Cartesian3.fromDegrees(
          frame.longitude - Math.sin(heading) * 0.0005,
          frame.latitude - Math.cos(heading) * 0.0005,
          frame.altitude + 30,
        ),
        orientation: {
          heading,
          pitch: CesiumMath.toRadians(-35),
          roll: 0,
        },
      });
    }
  }

  function pausePlayback() {
    if (!playback.value.isPlaying || playback.value.isPaused) return;
    playback.value.isPaused = true;
    if (playbackRafId !== null) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
    }
    playbackPausedTime = performance.now();
  }

  function resumePlayback() {
    if (!playback.value.isPlaying || !playback.value.isPaused) return;
    playback.value.isPaused = false;
    const pauseDuration = performance.now() - playbackPausedTime;
    playbackStartRealTime += pauseDuration;
    tickPlayback();
  }

  function stopPlayback() {
    if (playbackRafId !== null) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
    }
    playback.value = {
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      progress: 0,
      currentFrameIndex: 0,
    };
  }

  function seekPlayback(progress: number) {
    const track = activeTrack.value;
    if (!track) return;

    const clamped = Math.max(0, Math.min(1, progress));
    const targetTime = clamped * track.totalTime;

    playback.value.progress = clamped;
    playback.value.currentTime = targetTime;
    playback.value.currentFrameIndex = findFrameIndexAtTime(track.frames, targetTime);

    if (!playback.value.isPlaying) {
      updateAircraftPosition(playback.value.currentFrameIndex);
    } else {
      const elapsedReal = targetTime / playbackSpeed.value;
      playbackStartRealTime = performance.now() - elapsedReal * 1000;
      playbackPausedTime = 0;
    }
  }

  function setPlaybackSpeed(speed: number) {
    if (!playback.value.isPlaying) {
      playbackSpeed.value = speed;
      return;
    }

    const currentSimTime = playback.value.currentTime;
    playbackSpeed.value = speed;
    playbackStartRealTime = performance.now() - (currentSimTime / speed) * 1000;
    playbackPausedTime = 0;
  }

  function togglePlaybackFollowCamera() {
    playbackFollowCamera.value = !playbackFollowCamera.value;
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

    // 计算包围盒
    const lons = track.frames.map((f) => f.longitude);
    const lats = track.frames.map((f) => f.latitude);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        (minLon + maxLon) / 2,
        (minLat + maxLat) / 2,
        track.maxHeight + 100,
      ),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
    });
  }

  return {
    tracks,
    activeTrackId,
    activeTrack,
    hasTracks,
    isLoading,
    playback,
    playbackSpeed,
    playbackFollowCamera,
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
