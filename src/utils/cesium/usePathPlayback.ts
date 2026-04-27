/* ==============================
 * usePathPlayback —— 轨迹播放核心逻辑
 * 沿路径逐帧插值运动、尾迹效果
 * ============================== */

import { ref, toRaw, type ComputedRef } from 'vue';
import {
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
  Color,
} from 'cesium';
import { isValidViewer } from './clipCommon';
import { calcPathDistances } from './usePathMeasure';
import type { GeoPath, PlaybackOptions } from '@/types/geoPath';

/** 默认播放选项 */
const DEFAULT_OPTIONS: PlaybackOptions = {
  defaultSpeed: 50,
  showTrail: true,
  trailLength: 100,
  thirdPersonDistance: 50,
  thirdPersonHeight: 20,
  firstPersonHeightOffset: 2,
};

/** 判断 Cartesian3 是否有效 */
function isValidCartesian3(pos: Cartesian3): boolean {
  return isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z) &&
    !(pos.x === 0 && pos.y === 0 && pos.z === 0);
}

/** 沿路径根据进度插值位置 */
function interpolatePosition(
  positions: Cartesian3[],
  segmentDistances: number[],
  totalDistance: number,
  progress: number,
): Cartesian3 {
  if (!positions || positions.length < 2 || !isFinite(progress)) {
    return positions && positions.length > 0 ? positions[0] : Cartesian3.ZERO.clone();
  }

  const targetDist = Math.max(0, progress) * totalDistance;
  let accumulated = 0;

  for (let i = 0; i < segmentDistances.length; i++) {
    const segDist = segmentDistances[i];
    if (!isFinite(segDist)) continue;
    if (targetDist < accumulated + segDist || i === segmentDistances.length - 1) {
      const frac = segDist > 0 ? Math.max(0, Math.min(1, (targetDist - accumulated) / segDist)) : 0;
      const startPos = positions[i];
      const endPos = positions[i + 1];
      if (!isValidCartesian3(startPos) || !isValidCartesian3(endPos)) {
        return startPos;
      }

      const startCarto = Cartographic.fromCartesian(startPos);
      const endCarto = Cartographic.fromCartesian(endPos);
      if (!isFinite(startCarto.longitude) || !isFinite(endCarto.longitude)) {
        return startPos;
      }

      if (frac <= 0) return startPos;
      if (frac >= 1) return endPos;

      const geodesic = new EllipsoidGeodesic(startCarto, endCarto);
      let result: Cartographic;
      try { result = geodesic.interpolateUsingFraction(frac); } catch {
        return startPos;
      }
      if (!isFinite(result.longitude) || !isFinite(result.latitude)) {
        return startPos;
      }

      return Cartesian3.fromRadians(result.longitude, result.latitude, result.height);
    }
    accumulated += segDist;
  }

  return positions.length >= 2
    ? positions[positions.length - 1]
    : positions[0];
}

export function usePathPlayback(options: { viewer: ComputedRef<any> }) {
  const { viewer } = options;

  /* ===== 响应式状态 ===== */

  const isPlaying = ref(false);
  const isPaused = ref(false);
  const speed = ref(1);
  const progress = ref(0);
  const currentDistance = ref(0);
  const currentDuration = ref(0);
  const estimatedDuration = ref(0);
  const followCamera = ref(true);

  /* ===== 内部状态 ===== */

  let opts: PlaybackOptions = { ...DEFAULT_OPTIONS };
  let pathPositions: Cartesian3[] = [];
  let segmentDistances: number[] = [];
  let totalDistance = 0;
  let markerEntity: any = null;
  let trailEntity: any = null;
  let trailHistory: Cartesian3[] = [];
  let removePreUpdate: (() => void) | null = null;
  let pauseElapsed = 0;
  let playbackId = '';
  let lastFrameTime = 0;

  function genPlaybackId(): string {
    return `playback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ===== 实体管理 ===== */

  function createEntities(firstPos: Cartesian3, color: string) {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v)) return;

    markerEntity = v.entities.add({
      id: `${playbackId}_marker`,
      position: firstPos,
      point: {
        pixelSize: 22,
        color: Color.fromCssColorString(color),
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        heightReference: 1,
      },
    });

    if (followCamera.value) v.trackedEntity = markerEntity;

    trailHistory = [firstPos];
    if (opts.showTrail) {
      trailEntity = v.entities.add({
        id: `${playbackId}_trail`,
        polyline: {
          positions: [firstPos, firstPos],
          width: 4,
          material: Color.fromCssColorString(color).withAlpha(0.6),
          clampToGround: true,
        },
      });
    }
  }

  function cleanupEntities() {
    if (!playbackId) return;
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) {
      const toRemove: any[] = [];
      v.entities.values.forEach((e: any) => {
        if (e.id && (e.id as string).startsWith(playbackId)) toRemove.push(e);
      });
      toRemove.forEach((e) => v.entities.remove(e));
    }
    markerEntity = null;
    trailEntity = null;
    trailHistory = [];
  }

  /* ===== 逐帧更新 ===== */

  function startFrameLoop() {
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || removePreUpdate) return;

    const handler = v.scene.preUpdate.addEventListener(() => {
      try {
        if (!isPlaying.value || isPaused.value) return;

        const now = performance.now();
        if (lastFrameTime === 0) { lastFrameTime = now; return; }
        const dt = Math.min((now - lastFrameTime) / 1000, 1);
        lastFrameTime = now;

        pauseElapsed += dt * speed.value;
        const p = Math.min(pauseElapsed / estimatedDuration.value, 1);
        progress.value = p;
        currentDuration.value = pauseElapsed;

        const position = interpolatePosition(pathPositions, segmentDistances, totalDistance, p);
        if (!isValidCartesian3(position)) { stopPlayback(); return; }

        currentDistance.value = p * totalDistance;

        // 更新 marker 位置
        if (markerEntity) markerEntity.position = position;

        // 更新尾迹
        if (opts.showTrail && trailEntity) {
          trailHistory.push(position);
          if (trailHistory.length > opts.trailLength) trailHistory = trailHistory.slice(-opts.trailLength);
          trailEntity.polyline.positions = [...trailHistory];
        }

        if (p >= 1) stopPlayback();
      } catch (err) {
        console.error('轨迹播放帧错误:', err);
        stopPlayback();
      }
    });

    removePreUpdate = () => handler();
  }

  function stopFrameLoop() {
    if (removePreUpdate) { removePreUpdate(); removePreUpdate = null; }
  }

  /* ===== 公开 API ===== */

  function startPlayback(path: GeoPath, partialOpts?: Partial<PlaybackOptions>) {
    if (!path || path.positions.length < 2) return;

    stopPlayback();

    opts = { ...DEFAULT_OPTIONS, ...partialOpts };
    playbackId = genPlaybackId();

    // 克隆位置（避免 Vue proxy 破坏 Cesium instanceof 判断）
    const rawPositions = path.positions.map((p) => Cartesian3.clone(p));
    for (const p of rawPositions) {
      if (!isValidCartesian3(p)) return;
    }

    pathPositions = rawPositions;
    totalDistance = calcPathDistances(pathPositions).total;
    segmentDistances = [];
    for (let i = 1; i < pathPositions.length; i++) {
      const start = Cartographic.fromCartesian(pathPositions[i - 1]);
      const end = Cartographic.fromCartesian(pathPositions[i]);
      segmentDistances.push(new EllipsoidGeodesic(start, end).surfaceDistance);
    }
    if (totalDistance < 1) return;

    estimatedDuration.value = totalDistance / opts.defaultSpeed;

    createEntities(pathPositions[0], path.color);

    progress.value = 0;
    currentDistance.value = 0;
    currentDuration.value = 0;
    pauseElapsed = 0;
    lastFrameTime = 0;
    isPaused.value = false;
    isPlaying.value = true;

    startFrameLoop();
  }

  function pausePlayback() {
    if (!isPlaying.value || isPaused.value) return;
    isPaused.value = true;
  }

  function resumePlayback() {
    if (!isPlaying.value || !isPaused.value) return;
    isPaused.value = false;
  }

  function stopPlayback() {
    stopFrameLoop();
    releaseCamera();
    cleanupEntities();
    isPlaying.value = false;
    isPaused.value = false;
    progress.value = 0;
    currentDistance.value = 0;
    currentDuration.value = 0;
    pauseElapsed = 0;
    lastFrameTime = 0;
  }

  /** 释放相机追踪 */
  function releaseCamera() {
    const v = toRaw(viewer.value);
    if (isValidViewer(v)) {
      v.trackedEntity = undefined;
    }
  }

  function setSpeed(s: number) { speed.value = s; }

  function toggleFollowCamera() {
    followCamera.value = !followCamera.value;
    const v = toRaw(viewer.value);
    if (!isValidViewer(v) || !playbackId) return;
    if (followCamera.value && markerEntity) {
      v.trackedEntity = markerEntity;
    } else {
      if (v.trackedEntity?.id?.toString().startsWith(playbackId)) {
        v.trackedEntity = undefined;
      }
    }
  }

  function seekTo(p: number) {
    const clampedP = Math.max(0, Math.min(1, p));
    progress.value = clampedP;
    pauseElapsed = clampedP * estimatedDuration.value;
    currentDuration.value = pauseElapsed;
    currentDistance.value = clampedP * totalDistance;

    const position = interpolatePosition(pathPositions, segmentDistances, totalDistance, clampedP);
    if (isValidCartesian3(position) && markerEntity) markerEntity.position = position;

    trailHistory = [position];
    if (trailEntity) trailEntity.polyline.positions = [position, position];
  }

  function destroy() { stopPlayback(); }

  return {
    isPlaying, isPaused, speed, progress, followCamera,
    currentDistance, currentDuration, estimatedDuration,
    startPlayback, pausePlayback, resumePlayback, stopPlayback,
    setSpeed, seekTo, toggleFollowCamera, destroy,
  };
}
