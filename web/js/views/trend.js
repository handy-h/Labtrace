// trend.js — 纵向趋势分析视图（增强：动态参考带+下钻浮窗+CSV导出+迷你趋势图）
const TrendView = Vue.defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">纵向趋势分析</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-end flex-wrap">
        <div><label class="text-sm text-slate-600">受检者</label>
          <select v-model="filter.subject_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{s.name}}</option>
          </select></div>
        <div><label class="text-sm text-slate-600">检验项目</label>
          <select v-model="filter.test_item_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="it in testItems" :key="it.id" :value="it.id">{{it.standard_name}}</option>
          </select></div>
        <button @click="loadTrend" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">查询</button>
        <button @click="exportTrendCsv" class="px-4 py-2 bg-slate-600 text-white rounded text-sm" v-if="trendData.length">导出CSV</button>
      </div>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div id="trend-chart" style="height:400px;"></div>
    </div>
    <div v-if="trendData.length" class="bg-white rounded-lg shadow-sm p-4">
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">采样日期</th><th class="p-2">医院</th><th class="p-2">数值</th><th class="p-2">单位</th><th class="p-2">置信度</th><th class="p-2">提示符</th><th class="p-2">参考区间</th><th class="p-2">趋势</th></tr></thead>
        <tbody>
          <tr v-for="d in trendData" :key="d.report_item_id" class="border-t hover:bg-slate-50">
            <td class="p-2">{{d.sample_date}}</td><td class="p-2">{{d.hospital_name}}</td>
            <td class="p-2 font-medium">{{d.converted_value}}</td><td class="p-2">{{d.unit}}</td>
            <td class="p-2">{{d.confidence}}%</td><td class="p-2" v-html="flagBadge(d.flag)"></td>
            <td class="p-2 text-slate-500">{{d.ref_min != null && d.ref_max != null ? d.ref_min + '-' + d.ref_max : '-'}}</td>
            <td class="p-2">
              <sparkline-chart :data="sparklineData[d.test_item_id] || []" :subject-id="filter.subject_id" :test-item-id="d.test_item_id" @navigate="onSparklineNavigate"></sparkline-chart>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 下钻浮窗 -->
    <drilldown-popup :visible="showDrilldown" :data-point="drilldownDataPoint" @close="showDrilldown = false"></drilldown-popup>
  </div>`,
  setup() {
    const subjects = Vue.ref([]);
    const testItems = Vue.ref([]);
    const filter = Vue.ref({ subject_id: '', test_item_id: '' });
    const trendData = Vue.ref([]);
    const showDrilldown = Vue.ref(false);
    const drilldownDataPoint = Vue.ref({});
    const sparklineData = Vue.ref({});
    let chartInstance = null;

    // 全局受检者联动
    const currentSubjectId = Vue.inject('currentSubjectId', null);

    Vue.onMounted(() => {
      api.listSubjects().then(r => { if (r.data) subjects.value = r.data; });
      api.listTestItems().then(r => { if (r.data) testItems.value = r.data; });
      window.addEventListener('resize', onResize);
    });

    Vue.onUnmounted(() => {
      window.removeEventListener('resize', onResize);
      if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
    });

    // 受检者联动
    if (currentSubjectId) {
      Vue.watch(currentSubjectId, (id) => {
        if (id) filter.value.subject_id = id;
      });
    }

    function onResize() {
      if (chartInstance) chartInstance.resize();
    }

    function loadTrend() {
      if (!filter.value.subject_id || !filter.value.test_item_id) return;
      api.getTrendData({ subject_id: filter.value.subject_id, test_item_id: filter.value.test_item_id }).then(r => {
        if (r.data) { trendData.value = r.data; renderChart(); loadSparklineData(); }
      });
    }

    function loadSparklineData() {
      // 为迷你趋势图准备数据（使用当前趋势数据）
      const itemId = filter.value.test_item_id;
      const data = trendData.value.map(d => d.converted_value);
      sparklineData.value = { [itemId]: data };
    }

    function buildRefBands(data) {
      const bands = [];
      let currentBand = null;
      data.forEach((point, index) => {
        const refMin = point.ref_min;
        const refMax = point.ref_max;
        if (refMin == null || refMax == null) {
          if (currentBand) { bands.push(currentBand); currentBand = null; }
          return;
        }
        const key = `${refMin}-${refMax}`;
        if (!currentBand || currentBand.key !== key) {
          if (currentBand) bands.push(currentBand);
          currentBand = { key, refMin, refMax, startIndex: index, endIndex: index };
        } else {
          currentBand.endIndex = index;
        }
      });
      if (currentBand) bands.push(currentBand);
      return bands.map(band => ([
        { xAxis: band.startIndex, yAxis: band.refMin, itemStyle: { color: 'rgba(76,175,80,0.1)' } },
        { xAxis: band.endIndex, yAxis: band.refMax }
      ]));
    }

    function renderChart() {
      const el = document.getElementById('trend-chart');
      if (!el || typeof echarts === 'undefined') return;
      if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
      chartInstance = echarts.init(el);
      const dates = trendData.value.map(d => d.sample_date);
      const values = trendData.value.map(d => d.converted_value);
      const refBands = buildRefBands(trendData.value);

      const series = [
        { name: '数值', type: 'line', data: values, symbolSize: 8 }
      ];

      // 动态参考带
      if (refBands.length) {
        series.push({
          name: '参考区间',
          type: 'line',
          data: [],
          markArea: {
            silent: true,
            data: refBands,
            itemStyle: { borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)', borderType: 'dashed' }
          }
        });
      }

      chartInstance.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: refBands.length ? ['数值', '参考区间'] : ['数值'] },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'value' },
        series
      });

      // 下钻点击
      chartInstance.on('click', (params) => {
        if (params.seriesIndex === 0 && params.dataIndex >= 0 && params.dataIndex < trendData.value.length) {
          const d = trendData.value[params.dataIndex];
          drilldownDataPoint.value = d;
          showDrilldown.value = true;
        }
      });
    }

    function exportTrendCsv() {
      const headerLabels = ['采样日期', '医院', '原始值', '转换值', '单位', '置信度', '提示符', '参考区间'];
      const rows = trendData.value.map(d => ({
        sample_date: d.sample_date,
        hospital_name: d.hospital_name,
        original_value: d.original_value || '',
        converted_value: d.converted_value,
        unit: d.unit,
        confidence: d.confidence + '%',
        flag: d.flag || '',
        ref_range: d.ref_min != null && d.ref_max != null ? d.ref_min + '-' + d.ref_max : ''
      }));
      exportCsv('趋势数据', headerLabels, rows);
    }

    function onSparklineNavigate({ subjectId, testItemId }) {
      filter.value.subject_id = subjectId;
      filter.value.test_item_id = testItemId;
      loadTrend();
    }

    return { subjects, testItems, filter, trendData, showDrilldown, drilldownDataPoint, sparklineData, loadTrend, exportTrendCsv, onSparklineNavigate, flagBadge };
  }
});
