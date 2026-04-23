<template>
  <div class="compass-container" ref="containerRef">
    <div class="compass" :style="{ transform: `rotate(${heading}deg)` }" @mousedown.prevent="handleMouseDown"
      @dblclick.prevent="handleDoubleClick">
      <svg viewBox="0 0 100 100" class="compass-svg">
        <circle cx="50" cy="50" r="48" fill="rgba(50,50,50,0.8)" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
        <polygon points="50,10 55,50 50,45 45,50" fill="#ff4444" />
        <polygon points="50,90 55,50 50,55 45,50" fill="#ffffff" />
        <text x="50" y="8" text-anchor="middle" fill="#ff4444" font-size="8" font-weight="bold">N</text>
      </svg>
    </div>
    <div class="compass-indicator" v-if="isDragging">
      <svg viewBox="0 0 24 24" class="drag-icon">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          fill="currentColor" />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Math as CesiumMath } from 'cesium'
import { ref, onMounted, onUnmounted, toRaw } from 'vue'
import { useCesiumStore } from '@/stores/cesiumStore'

const cesiumStore = useCesiumStore()
const containerRef = ref<HTMLDivElement | null>(null)
const heading = ref(0)
const isDragging = ref(false)

let startX = 0
let currentX = 0

function updateHeading() {
  const v = toRaw(cesiumStore.viewer)
  if (!cesiumStore.hasViewer) return
  const headingVal = CesiumMath.toDegrees(v.camera.heading)
  heading.value = -headingVal
}

function handleDoubleClick() {
  const v = toRaw(cesiumStore.viewer)
  if (!v) return
  const camera = v.camera
  const position = camera.positionWC.clone()
  const height = camera.positionCartographic.height
  v.camera.flyTo({
    destination: position,
    orientation: {
      heading: 0,                            // 正北
      pitch: CesiumMath.toRadians(-90),      // 水平视角
      roll: 0,
    },
    maximumHeight: height,
    duration: 0.5,
  })
}

function handleMouseDown(e: MouseEvent) {
  e.stopPropagation()
  isDragging.value = true
  startX = e.clientX
  currentX = startX

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  e.stopPropagation()
  const deltaX = e.clientX - currentX
  currentX = e.clientX
  const v = toRaw(cesiumStore.viewer)
  v.scene.camera.twistLeft(deltaX * 0.005)
  updateHeading()
}

function handleMouseUp(e: MouseEvent) {
  e.stopPropagation()
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

let animationId: number | null = null

function startHeadingUpdate() {
  const update = () => {
    updateHeading()
    animationId = requestAnimationFrame(update)
  }
  update()
}

onMounted(() => {
  startHeadingUpdate()
})

onUnmounted(() => {
  if (animationId !== null) {
    cancelAnimationFrame(animationId)
  }
  handleMouseUp()
})
</script>

<style scoped>
.compass-container {
  position: relative;
  width: 80px;
  height: 80px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  overscroll-behavior: contain;
}

.compass-container:active {
  cursor: grabbing;
}

.compass {
  width: 100%;
  height: 100%;
  transition: none;
  will-change: transform;
  pointer-events: auto;
}

.compass-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  pointer-events: none;
}

.compass-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
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
