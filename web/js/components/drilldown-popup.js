// drilldown-popup.js — 数据下钻浮窗组件
const DrilldownPopup = Vue.defineComponent({
  name: 'DrilldownPopup',
  props: {
    visible: { type: Boolean, default: false },
    dataPoint: { type: Object, default: () => ({}) },
  },
  emits: ['close'],
  template: `
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content w-[500px]">
      <h3 class="modal-title">数据详情</h3>
      <div style="margin-bottom: 0.75rem">
        <div v-if="reportImage" style="margin-bottom: 0.75rem">
          <img :src="reportImage" :class="imageExpanded ? 'max-w-full cursor-zoom-out' : 'max-w-xs cursor-zoom-in'"
               @click="imageExpanded = !imageExpanded" style="border: 1px solid var(--table-border); border-radius: var(--radius-md)" @error="onImageError">
        </div>
        <div v-else-if="imageLoading" class="text-sm" style="color: var(--color-text-muted); margin-bottom: 0.75rem">加载图片中...</div>
        <div v-else-if="imageError" class="text-sm" style="color: var(--color-text-muted); margin-bottom: 0.75rem">原始文件不可用</div>
      </div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span style="color: var(--color-text-secondary)">采样日期:</span> {{dataPoint.sample_date || '-'}}</div>
        <div><span style="color: var(--color-text-secondary)">医院:</span> {{dataPoint.hospital_name || '-'}}</div>
        <div><span style="color: var(--color-text-secondary)">结果值:</span> <span class="font-medium">{{dataPoint.converted_value || dataPoint.value || '-'}}</span></div>
        <div><span style="color: var(--color-text-secondary)">单位:</span> {{dataPoint.unit || '-'}}</div>
        <div><span style="color: var(--color-text-secondary)">置信度:</span> {{dataPoint.confidence != null ? dataPoint.confidence + '%' : '-'}}</div>
        <div><span style="color: var(--color-text-secondary)">提示符:</span> <span v-html="flagBadge(dataPoint.flag)"></span></div>
      </div>
      <div v-if="dataPoint.note || dataPoint.row_notes" class="text-sm" style="margin-top: 0.75rem">
        <span style="color: var(--color-text-secondary)">备注:</span> {{dataPoint.note || dataPoint.row_notes}}
      </div>
      <div class="modal-footer">
        <button @click="$emit('close')" class="btn btn-secondary">关闭</button>
      </div>
    </div>
  </div>`,
  setup(props, { emit }) {
    const reportImage = Vue.ref('');
    const imageExpanded = Vue.ref(false);
    const imageLoading = Vue.ref(false);
    const imageError = Vue.ref(false);

    function loadImage(reportId) {
      if (!reportId) { reportImage.value = ''; imageError.value = true; return; }
      imageLoading.value = true; imageError.value = false;
      reportImage.value = api.getReportImage(reportId);
      imageLoading.value = false;
    }

    function onImageError() { imageError.value = true; reportImage.value = ''; }

    function onKeydown(e) { if (e.key === 'Escape' && props.visible) emit('close'); }

    Vue.watch(() => props.visible, (v) => {
      if (v && props.dataPoint) {
        imageExpanded.value = false; imageError.value = false;
        loadImage(props.dataPoint.report_id);
      }
    });

    Vue.onMounted(() => document.addEventListener('keydown', onKeydown));
    Vue.onUnmounted(() => document.removeEventListener('keydown', onKeydown));

    return { reportImage, imageExpanded, imageLoading, imageError, onImageError, flagBadge };
  }
});
