// sparkline.js — 迷你趋势图组件
const SparklineChart = Vue.defineComponent({
  name: 'SparklineChart',
  props: {
    data: { type: Array, default: () => [] },
    subjectId: { type: Number, default: null },
    testItemId: { type: Number, default: null },
  },
  emits: ['navigate'],
  template: `
  <div class="mini-sparkline inline-block cursor-pointer" ref="container" @click="onClick">
    <span v-if="data.length < 2" class="text-slate-400 text-xs">—</span>
  </div>`,
  setup(props, { emit }) {
    const container = Vue.ref(null);
    let chartInstance = null;

    function initChart() {
      if (!container.value || props.data.length < 2 || typeof echarts === 'undefined') return;
      chartInstance = echarts.init(container.value, null, { width: 80, height: 24 });
      chartInstance.setOption({
        animation: false,
        grid: { left: 0, right: 0, top: 0, bottom: 0 },
        xAxis: { type: 'category', show: false, data: props.data.map((_, i) => i) },
        yAxis: { type: 'value', show: false },
        series: [{
          type: 'line',
          data: props.data,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#3b82f6' },
          areaStyle: { color: 'rgba(59,130,246,0.1)' }
        }]
      });
    }

    function dispose() {
      if (chartInstance) {
        chartInstance.dispose();
        chartInstance = null;
      }
    }

    function onClick() {
      if (props.subjectId && props.testItemId) {
        emit('navigate', { subjectId: props.subjectId, testItemId: props.testItemId });
      }
    }

    Vue.onMounted(() => {
      Vue.nextTick(() => initChart());
    });

    Vue.watch(() => props.data, () => {
      dispose();
      Vue.nextTick(() => initChart());
    });

    Vue.onUnmounted(() => dispose());

    return { container, onClick };
  }
});
