// sync-scroll.js — Sync-Scroll双屏联动组件
const SyncScrollPanel = Vue.defineComponent({
  name: 'SyncScrollPanel',
  props: {
    imageUrl: { type: String, default: '' },
    items: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: -1 },
  },
  emits: ['select', 'zoomToggle'],
  template: `
  <div class="flex gap-4 w-full">
    <!-- 左侧图片区 -->
    <div class="w-[45%] relative" ref="imageContainer">
      <div :class="zoomLevel > 1 ? 'overflow-auto' : 'overflow-hidden'" :style="zoomLevel > 1 ? {} : { height: imageHeight + 'px' }">
        <img :src="imageUrl" ref="imageEl"
             :style="zoomLevel > 1 ? { width: 'auto', maxWidth: 'none' } : { maxWidth: '100%' }"
             class="border rounded" v-if="imageUrl"
             @load="onImageLoad">
      </div>
      <!-- 高亮呼吸框 -->
      <div v-if="highlightRect" class="highlight-breathe absolute pointer-events-none border-2 border-blue-500 rounded"
           :style="highlightStyle">
      </div>
      <!-- 局部放大镜 -->
      <canvas v-if="highlightRect && magnifierReady" ref="magnifier"
              class="absolute pointer-events-none border-2 border-blue-400 rounded shadow-lg"
              :style="magnifierStyle" width="120" height="80">
      </canvas>
    </div>
    <!-- 右侧slot区 -->
    <div class="w-[55%] overflow-auto">
      <slot></slot>
    </div>
  </div>`,
  setup(props, { emit }) {
    const imageContainer = Vue.ref(null);
    const imageEl = Vue.ref(null);
    const magnifier = Vue.ref(null);
    const highlightRect = Vue.ref(null);
    const zoomLevel = Vue.ref(1);
    const imageHeight = Vue.ref(500);
    const magnifierReady = Vue.ref(false);

    const highlightStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return {
        left: r.x + 'px',
        top: r.y + 'px',
        width: r.w + 'px',
        height: r.h + 'px',
      };
    });

    const magnifierStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return {
        left: (r.x + r.w + 8) + 'px',
        top: Math.max(0, r.y - 20) + 'px',
      };
    });

    function onImageLoad() {
      if (imageEl.value && zoomLevel.value === 1) {
        imageHeight.value = Math.min(imageEl.value.naturalHeight, 500);
      }
    }

    function updateHighlight(index) {
      if (index < 0 || index >= props.items.length) {
        highlightRect.value = null;
        magnifierReady.value = false;
        return;
      }
      const item = props.items[index];
      // 尝试从ocr_bbox获取位置信息
      let bbox = null;
      if (item.ocr_bbox) {
        try {
          bbox = typeof item.ocr_bbox === 'string' ? JSON.parse(item.ocr_bbox) : item.ocr_bbox;
        } catch (e) { bbox = null; }
      }
      if (bbox && bbox.x != null && bbox.y != null) {
        highlightRect.value = { x: bbox.x, y: bbox.y, w: bbox.w || 100, h: bbox.h || 30 };
        Vue.nextTick(() => drawMagnifier(bbox));
      } else {
        highlightRect.value = null;
        magnifierReady.value = false;
      }
    }

    function drawMagnifier(bbox) {
      if (!magnifier.value || !imageEl.value) return;
      const canvas = magnifier.value;
      const ctx = canvas.getContext('2d');
      const img = imageEl.value;
      const scale = 2;
      const sx = Math.max(0, bbox.x - 10);
      const sy = Math.max(0, bbox.y - 10);
      const sw = bbox.w + 20;
      const sh = bbox.h + 20;
      ctx.clearRect(0, 0, 120, 80);
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 80);
        magnifierReady.value = true;
      } catch (e) {
        magnifierReady.value = false;
      }
    }

    function toggleZoom() {
      zoomLevel.value = zoomLevel.value === 1 ? 2 : 1;
      emit('zoomToggle', zoomLevel.value);
    }

    Vue.watch(() => props.selectedIndex, (idx) => {
      updateHighlight(idx);
    });

    return {
      imageContainer, imageEl, magnifier,
      highlightRect, zoomLevel, imageHeight, magnifierReady,
      highlightStyle, magnifierStyle,
      onImageLoad, toggleZoom, updateHighlight
    };
  }
});
