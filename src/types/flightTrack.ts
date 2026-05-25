/** ==============================
 *  FlightTrack — DJI 飞行轨迹类型定义
 *  解析 frames.json，存储轨迹点与飞行状态
 *  ============================== */

import type { Cartesian3 } from 'cesium';

/** 单帧 OSD 数据（飞行器状态） */
export interface DJIFrameOSD {
  flyTime: number;
  latitude: number;
  longitude: number;
  height: number;
  altitude: number;
  xSpeed: number;
  ySpeed: number;
  zSpeed: number;
  pitch: number;
  roll: number;
  yaw: number;
  flycState: string;
  flightAction: string;
  gpsNum: number;
  gpsLevel: number;
  isOnGround: boolean;
}

/** 单帧云台数据 */
export interface DJIFrameGimbal {
  mode: string;
  pitch: number;
  roll: number;
  yaw: number;
  isPitchAtLimit: boolean;
  isRollAtLimit: boolean;
  isYawAtLimit: boolean;
  isStuck: boolean;
}

/** 单帧相机数据 */
export interface DJIFrameCamera {
  isPhoto: boolean;
  isVideo: boolean;
  sdCardIsInserted: boolean;
  sdCardState: string | null;
}

/** 单帧电池数据 */
export interface DJIFrameBattery {
  chargeLevel: number;
  voltage: number;
  current: number;
  temperature: number;
}

/** 单帧遥控数据 */
export interface DJIFrameRC {
  downlinkSignal: number | null;
  uplinkSignal: number | null;
  aileron: number;
  elevator: number;
  throttle: number;
  rudder: number;
}

/** 解析后的单帧数据 */
export interface FlightTrackFrame {
  /** 时间戳（秒，从起飞开始） */
  timestamp: number;
  /** 经度 */
  longitude: number;
  /** 纬度 */
  latitude: number;
  /** 相对高度（m） */
  height: number;
  /** 绝对海拔（m） */
  altitude: number;
  /** 飞行速度（m/s） */
  speed: number;
  /** 飞机姿态 */
  aircraft: {
    pitch: number;
    roll: number;
    yaw: number;
  };
  /** 云台姿态 */
  gimbal: {
    mode: string;
    pitch: number;
    roll: number;
    yaw: number;
  };
  /** 相机状态 */
  camera: {
    isPhoto: boolean;
    isVideo: boolean;
  };
  /** 电池状态 */
  battery: {
    chargeLevel: number;
    voltage: number;
    current: number;
    temperature: number;
  };
  /** 遥控信号 */
  rc: {
    downlinkSignal: number | null;
    uplinkSignal: number | null;
  };
  /** 飞控状态 */
  flycState: string;
  /** 飞行动作 */
  flightAction: string;
  /** GPS 数量 */
  gpsNum: number;
}

/** 飞行轨迹 */
export interface FlightTrack {
  id: string;
  name: string;
  /** 是否显示 */
  show: boolean;
  /** 轨迹点 */
  frames: FlightTrackFrame[];
  /** Cesium Cartesian3 位置数组 */
  positions: Cartesian3[];
  /** 总时长（秒） */
  totalTime: number;
  /** 总距离（m） */
  totalDistance: number;
  /** 最大高度（m） */
  maxHeight: number;
  /** 最大速度（m/s） */
  maxSpeed: number;
  /** 设备信息 */
  aircraftName: string;
  aircraftSn: string;
  appVersion: string;
  createdAt: number;
}

/** 播放状态 */
export interface PlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  progress: number;
  currentFrameIndex: number;
}
