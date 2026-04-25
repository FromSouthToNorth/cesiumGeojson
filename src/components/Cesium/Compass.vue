<!--
  components/Cesium/Compass.vue —— 可拖拽罗盘
  通过 requestAnimationFrame 实时同步相机 heading，
  支持鼠标左右拖拽旋转相机，双击复位至正北俯视
-->
<template>
  <div ref="containerRef" class="compass-container">
    <div
      class="compass"
      :style="{ transform: `rotate(${heading}deg)` }"
      @mousedown.prevent="handleMouseDown"
      @dblclick.prevent="handleDoubleClick"
    >
      <svg viewBox="0 0 100 100" class="compass-svg">
        <circle cx="50" cy="50" r="48" class="compass-circle" stroke-width="2" />
        <polygon points="50,10 55,50 50,45 45,50" class="compass-north" />
        <polygon points="50,90 55,50 50,55 45,50" class="compass-south" />
        <text x="50" y="8" text-anchor="middle" class="compass-label" font-size="8" font-weight="bold">N</text>
      </svg>
    </div>
    <div v-if="isDragging" class="compass-indicator">
      <svg viewBox="0 0 24 24" class="drag-icon">
        <path
          d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          fill="currentColor"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Math as CesiumMath } from 'cesium';
import { ref, onMounted, onUnmounted, toRaw } from 'vue';
import { useCesiumStore } from '@/stores/cesiumStore';

const cesiumStore = useCesiumStore();
const containerRef = ref<HTMLDivElement | null>(null);
const heading = ref(0); // 罗盘旋转角度（deg）
const isDragging = ref(false); // 是否正在拖拽

let startX = 0; // 拖拽起始鼠标 X
let currentX = 0; // 拖拽当前鼠标 X

/** 从相机 heading 更新罗盘角度（取反使物理方向对应） */
function updateHeading() {
  const v = toRaw(cesiumStore.viewer);
  if (!cesiumStore.hasViewer) return;
  const headingVal = CesiumMath.toDegrees(v.camera.heading);
  heading.value = -headingVal;
}

/** 双击复位：正北俯视 */
function handleDoubleClick() {
  const v = toRaw(cesiumStore.viewer);
  if (!v) return;
  const position = v.camera.positionWC.clone();
  const height = v.camera.positionCartographic.height;
  v.camera.flyTo({
    destination: position,
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
    maximumHeight: height,
    duration: 0.5,
  });
}

/** 开始拖拽：注册全局 mouse 事件 */
function handleMouseDown(e: MouseEvent) {
  e.stopPropagation();
  isDragging.value = true;
  startX = e.clientX;
  currentX = startX;

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

/** 拖拽中：水平偏移量映射为相机 twist */
function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  e.stopPropagation();
  const deltaX = e.clientX - currentX;
  currentX = e.clientX;
  const v = toRaw(cesiumStore.viewer);
  v.scene.camera.twistLeft(deltaX * 0.005);
  updateHeading();
}

/** 结束拖拽：移除全局事件 */
function handleMouseUp(e: MouseEvent) {
  e.stopPropagation();
  isDragging.value = false;
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
}

let animationId: number | null = null;

/** 启动 RAF 循环持续同步罗盘角度 */
function startHeadingUpdate() {
  const update = () => {
    updateHeading();
    animationId = requestAnimationFrame(update);
  };
  update();
}

onMounted(() => {
  startHeadingUpdate();
});

onUnmounted(() => {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
  handleMouseUp();
});
</script>

<style scoped>
.compass-container {
  position: relative;
  width: 80px;
  height: 80px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  overscroll-behavior: contain;
}

.compass-container:active {
  cursor: grabbing;
}

.compass {
  width: 100%;
  height: 100%;
  pointer-events: auto;
  will-change: transform;
  transition: none;
}

.compass-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.3));
}

.compass-circle {
  fill: var(--compass-bg);
  stroke: var(--compass-border);
}

.compass-north {
  fill: var(--compass-north);
}

.compass-south {
  fill: var(--surface-text);
}

.compass-label {
  fill: var(--compass-north);
}

.compass-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.drag-icon {
  width: 24px;
  height: 24px;
  color: #fff;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}
</style>
