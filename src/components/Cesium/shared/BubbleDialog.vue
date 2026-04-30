<!--
  BubbleDialog.vue — 通用气泡对话框
  提供 SVG 牵引线 + 定位 + 三组样式变体 + 可自定义内容的插槽
  与 Cesium 无关，任何需要指向屏幕坐标的气泡均可复用
-->
<template>
  <div v-if="visible && screenPos" class="bubble-shell" @click.stop>
    <!-- SVG 牵引线 -->
    <svg class="bubble-leader-svg">
      <path :d="leaderPath" class="bubble-leader-line" />
      <circle v-if="leaderPath" :cx="screenPos.x" :cy="screenPos.y" r="3" class="bubble-leader-dot" />
    </svg>

    <!-- 气泡卡片 -->
    <div ref="cardRef" class="bubble-card" :class="[`bubble-card--${styleVariant}`]" :style="cardStyle">
      <!-- 头部（仅在存在标题/关闭按钮/插槽内容时渲染） -->
      <div v-if="hasHeader" class="bubble-header">
        <div class="bubble-header-left">
          <slot name="header-left" />
          <span v-if="title" class="bubble-title">{{ title }}</span>
        </div>
        <div class="bubble-header-right">
          <slot name="header-actions" />
          <button v-if="showCloseButton" class="bubble-icon-btn" aria-label="关闭" @click="close">
            <CloseOutlined />
          </button>
        </div>
      </div>

      <!-- 主体（默认插槽） -->
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, useSlots } from 'vue';
import { CloseOutlined } from '@ant-design/icons-vue';
import type { PopupVariantKey } from './popupVariants';

defineOptions({ name: 'BubbleDialog' });

const props = withDefaults(
  defineProps<{
    visible: boolean;
    screenPos: { x: number; y: number } | null;
    styleVariant: PopupVariantKey;
    width?: number;
    title?: string;
    showCloseButton?: boolean;
    /** 卡片与锚点之间的间距（px），值越大牵引线越长，默认 20 */
    anchorGap?: number;
  }>(),
  {
    width: 280,
    showCloseButton: true,
    anchorGap: 40,
  },
);

const emit = defineEmits<{
  close: [];
}>();

/* ==============================
 *  内部状态
 * ============================== */

const slots = useSlots();
const cardRef = ref<HTMLElement | null>(null);
const cardHeight = ref(180);
const leaderPath = ref('');
let resizeObserver: ResizeObserver | null = null;

const hasHeader = computed(() => {
  return !!(props.title || props.showCloseButton || slots['header-left'] || slots['header-actions']);
});

/* ==============================
 *  定位 & 牵引线
 * ============================== */

const POPUP_GAP = computed(() => props.anchorGap);
const MARGIN = 8;

const cardStyle = computed(() => {
  if (!props.screenPos) return { display: 'none' };

  let left = props.screenPos.x - props.width / 2;
  let top = props.screenPos.y - cardHeight.value - POPUP_GAP.value;

  left = Math.max(MARGIN, Math.min(window.innerWidth - props.width - MARGIN, left));
  top = Math.max(MARGIN, top);
  if (top + cardHeight.value > window.innerHeight - MARGIN) {
    top = window.innerHeight - cardHeight.value - MARGIN;
  }

  return { left: `${left}px`, top: `${top}px`, width: `${props.width}px` };
});

function computeLeaderPath() {
  if (!props.screenPos || !cardRef.value) {
    leaderPath.value = '';
    return;
  }

  const rect = cardRef.value.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    leaderPath.value = '';
    return;
  }

  const startX = rect.left + rect.width / 2;
  const startY = rect.bottom;
  const endX = props.screenPos.x;
  const endY = props.screenPos.y;

  const dx = endX - startX;
  if (Math.abs(dx) < 3) {
    leaderPath.value = `M ${startX} ${startY} L ${endX} ${endY}`;
    return;
  }

  const midY = startY + (endY - startY) * 0.5;
  const ctrlX = startX + dx * 0.3;
  leaderPath.value = `M ${startX} ${startY} Q ${ctrlX} ${midY} ${endX} ${endY}`;
}

/* ==============================
 *  可见性生命周期
 * ============================== */

watch(
  () => props.visible,
  (v, old) => {
    if (v && !old) {
      document.addEventListener('keydown', onKeyDown);
      nextTick(() => {
        computeLeaderPath();
        if (cardRef.value) {
          const rect = cardRef.value.getBoundingClientRect();
          if (rect.height > 0) cardHeight.value = rect.height;

          resizeObserver?.disconnect();
          resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              if (entry.contentRect.height > 0) {
                cardHeight.value = entry.contentRect.height;
                computeLeaderPath();
              }
            }
          });
          resizeObserver.observe(cardRef.value);
        }
      });
    } else if (!v && old) {
      document.removeEventListener('keydown', onKeyDown);
      resizeObserver?.disconnect();
      resizeObserver = null;
      leaderPath.value = '';
    }
  },
);

watch(
  () => props.screenPos,
  () => {
    if (props.visible && props.screenPos) {
      nextTick(computeLeaderPath);
    }
  },
);

/* ==============================
 *  窗口 resize
 * ============================== */

function onResize() {
  if (props.visible) {
    nextTick(computeLeaderPath);
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  resizeObserver?.disconnect();
});

/* ==============================
 *  关闭
 * ============================== */

function close() {
  emit('close');
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
</script>

<style scoped>
/* ───────── Shell（不拦截事件） ───────── */
.bubble-shell {
  position: fixed;
  inset: 0;
  z-index: 250;
  pointer-events: none;
}

/* ───────── SVG 牵引线 ───────── */
.bubble-leader-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.bubble-leader-line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 1.5px;
  opacity: 0.55;
}

.bubble-leader-dot {
  fill: var(--color-primary);
  opacity: 0.7;
}

/* ───────── 气泡卡片 ───────── */
.bubble-card {
  position: fixed;
  z-index: 251;
  border-radius: 10px;
  pointer-events: auto;
  animation: bubbleFadeIn 0.2s ease-out;
}

/* ───────── 3 种视觉变体 ───────── */
.bubble-card--glass {
  border: 1px solid var(--surface-border);
  background: var(--surface-bg);
  box-shadow: 0 8px 32px var(--surface-shadow);
  backdrop-filter: blur(12px);
}

.bubble-card--minimal {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-bg) 60%, transparent);
  box-shadow: none;
  backdrop-filter: blur(4px);
}

.bubble-card--card {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-bg) 95%, #000);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  backdrop-filter: none;
}

/* ───────── 头部 ───────── */
.bubble-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
}

.bubble-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.bubble-header-right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.bubble-title {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ───────── 图标按钮（关闭） ───────── */
.bubble-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--surface-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bubble-icon-btn:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}

/* ───────── 动画 ───────── */
@keyframes bubbleFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubble-card {
    animation: none;
  }
}
</style>
