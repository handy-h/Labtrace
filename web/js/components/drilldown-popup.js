// drilldown-popup.js — 数据下钻浮窗组件
const DrilldownPopup = Vue.defineComponent({
  name: 'DrilldownPopup',
  props: {
    visible: { type: Boolean, default: false },
    dataPoint: { type: Object, default: () => ({}) },
  },
  emits: ['close'],
  template: `
  <div v-if="visible" class="drill-modal" @click.self="$emit('close')">
    <div class="w-[500px]">
      <h3 class="text-lg font-bold mb-3">数据详情</h3>
      <div class="mb-3">
        <div v-if="reportImage" class="mb-3">
          <img :src="reportImage" :class="imageExpanded ? 'max-w-full cursor-zoom-out' : 'max-w-xs cursor-zoom-in'"
               @click="imageExpanded = !imageExpanded" class="border rounded" @error="onImageError">
        </div>
        <div v-else-if="imageLoading" class="text-sm text-slate-400 mb-3">加载图片中...</div>
        <div v-else-if="imageError" class="text-sm text-slate-400 mb-3">原始文件不可用</div>
      </div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span class="text-slate-500">采样日期:</span> {{dataPoint.sample_date || '-'}}</div>
        <div><span class="text-slate-500">医院:</span> {{dataPoint.hospital_name || '-'}}</div>
        <div><span class="text-slate-500">结果值:</span> <span class="font-medium">{{dataPoint.converted_value || dataPoint.value || '-'}}</span></div>
        <div><span class="text-slate-500">单位:</span> {{dataPoint.unit || '-'}}</div>
        <div><span class="text-slate-500">置信度:</span> {{dataPoint.confidence != null ? dataPoint.confidence + '%' : '-'}}</div>
        <div><span class="text-slate-500">提示符:</span> <span v-html="flagBadge(dataPoint.flag)"></span></div>
      </div>
      <div v-if="dataPoint.note || dataPoint.row_notes" class="mt-3 text-sm">
        <span class="text-slate-500">备注:</span> {{dataPoint.note || dataPoint.row_notes}}
      </div>
      <div class="flex justify-end mt-4">
        <button @click="$emit('close')" class="px-4 py-2 border rounded text-sm hover:bg-slate-50">关闭</button>
      </div>
    </div>
  </div>`,
  setup(props, { emit }) {
    const reportImage = Vue.ref('');
    const imageExpanded = Vue.ref(false);
    const imageLoading = Vue.ref(false);
    const imageError = Vue.ref(false);

    function loadImage(reportId) {
      if (!reportId) {
        reportImage.value = '';
        imageError.value = true;
        return;
      }
      imageLoading.value = true;
      imageError.value = false;
      reportImage.value = api.getReportImage(reportId);
      imageLoading.value = false;
    }

    function onImageError() {
      imageError.value = true;
      reportImage.value = '';
    }

    function onKeydown(e) {
      if (e.key === 'Escape' && props.visible) emit('close');
    }

    Vue.watch(() => props.visible, (v) => {
      if (v && props.dataPoint) {
        imageExpanded.value = false;
        imageError.value = false;
        loadImage(props.dataPoint.report_id);
      }
    });

    Vue.onMounted(() => document.addEventListener('keydown', onKeydown));
    Vue.onUnmounted(() => document.removeEventListener('keydown', onKeydown));

    return { reportImage, imageExpanded, imageLoading, imageError, onImageError, flagBadge };
  }
});
