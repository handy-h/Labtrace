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
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <thead><tr class="bg-slate-100">
          <th class="p-2 text-center border-r border-dashed border-slate-200">采样日期</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200" v-if="!filter.test_item_id">检验项目</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200">数值</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200">参考区间</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200">提示符</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200">单位</th>
          <th class="p-2 text-center border-r border-dashed border-slate-200">趋势</th>
          <th class="p-2 text-center">医院</th>
        </tr></thead>
        <tbody>
          <tr v-for="(d, idx) in trendData" :key="d.report_item_id"
              :class="idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100'">
            <td class="p-2 text-center border-r border-dashed border-slate-100">{{d.sample_date}}</td>
            <td class="p-2 text-left border-r border-dashed border-slate-100" v-if="!filter.test_item_id">{{d.test_item_name}}</td>
            <td class="p-2 text-center font-medium border-r border-dashed border-slate-100">{{d.converted_value}}</td>
            <td class="p-2 text-center text-slate-500 border-r border-dashed border-slate-100">{{d.ref_interval_text || (d.ref_min != null && d.ref_max != null ? d.ref_min + '-' + d.ref_max : '-')}}</td>
            <td class="p-2 text-center border-r border-dashed border-slate-100" v-html="flagBadge(d.flag)"></td>
            <td class="p-2 text-center border-r border-dashed border-slate-100">{{d.unit}}</td>
            <td class="p-2 text-left border-r border-dashed border-slate-100">
              <sparkline-chart :data="sparklineData[d.test_item_name || ('item_' + d.report_item_id)] || []" :subject-id="filter.subject_id" :test-item-id="d.test_item_id" @navigate="onSparklineNavigate"></sparkline-chart>
            </td>
            <td class="p-2 text-left">{{d.hospital_name}}</td>
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
      if (!filter.value.subject_id) { alert('请选择受检者'); return; }
      const params = { subject_id: filter.value.subject_id };
      if (filter.value.test_item_id) params.test_item_id = filter.value.test_item_id;
      api.getTrendData(params).then(r => {
        if (r.code !== 0) { alert(r.message || '查询失败'); return; }
        if (!r.data || r.data.length === 0) { trendData.value = []; alert('未找到趋势数据，请确认该受检者有已导入的检验报告'); return; }
        trendData.value = r.data; renderChart(); loadSparklineData();
      });
    }

    function loadSparklineData() {
      // Group sparkline data by test_item_name to show trend across multiple reports
      const groups = {};
      trendData.value.forEach(d => {
        const key = d.test_item_name || ('item_' + d.report_item_id);
        if (!groups[key]) groups[key] = [];
        groups[key].push(d.converted_value);
      });
      sparklineData.value = groups;
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

      const allDates = [...new Set(trendData.value.map(d => d.sample_date))].sort();
      const isAllItems = !filter.value.test_item_id;

      let series = [];
      let legendData = [];

      if (isAllItems) {
        // Group by test_item_name for multi-series
        const groups = {};
        trendData.value.forEach(d => {
          const key = d.test_item_name || ('项目' + d.test_item_id);
          if (!groups[key]) groups[key] = {};
          groups[key][d.sample_date] = d.converted_value;
        });
        const colors = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc','#5ab1ef'];
        let ci = 0;
        Object.keys(groups).forEach(name => {
          const data = allDates.map(dt => groups[name][dt] ?? null);
          const nonNullCount = data.filter(v => v !== null).length;
          const chartType = nonNullCount <= 1 ? 'scatter' : 'line';
          series.push({ name, type: chartType, data, symbolSize: 6, connectNulls: true, color: colors[ci % colors.length] });
          legendData.push(name);
          ci++;
        });
      } else {
        const values = allDates.map(dt => {
          const pt = trendData.value.find(d => d.sample_date === dt);
          return pt ? pt.converted_value : null;
        });
        const nonNullCount = values.filter(v => v !== null).length;
        const chartType = nonNullCount <= 1 ? 'scatter' : 'line';
        series.push({ name: '数值', type: chartType, data: values, symbolSize: 8, connectNulls: true });
        legendData.push('数值');

        // Reference bands
        const refBands = buildRefBands(trendData.value);
        if (refBands.length) {
          series.push({
            name: '参考区间', type: 'line', data: [],
            markArea: { silent: true, data: refBands, itemStyle: { borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)', borderType: 'dashed' } }
          });
          legendData.push('参考区间');
        }
      }

      chartInstance.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: legendData },
        xAxis: { type: 'category', data: allDates },
        yAxis: { type: 'value' },
        series
      });

      // 下钻点击
      chartInstance.on('click', (params) => {
        if (params.seriesIndex === 0 && params.dataIndex >= 0) {
          const dt = allDates[params.dataIndex];
          const d = trendData.value.find(p => p.sample_date === dt && (isAllItems || true));
          if (d) { drilldownDataPoint.value = d; showDrilldown.value = true; }
        }
      });
    }

    function exportTrendCsv() {
      const isAllItems = !filter.value.test_item_id;
      const headerLabels = isAllItems
        ? ['检验项目', '采样日期', '医院', '原始值', '转换值', '单位', '提示符', '参考区间']
        : ['采样日期', '医院', '原始值', '转换值', '单位', '提示符', '参考区间'];
      const rows = trendData.value.map(d => {
        const row = {
          sample_date: d.sample_date,
          hospital_name: d.hospital_name,
          original_value: d.original_value || '',
          converted_value: d.converted_value,
          unit: d.unit,
          flag: d.flag || '',
          ref_range: d.ref_interval_text || (d.ref_min != null && d.ref_max != null ? d.ref_min + '-' + d.ref_max : '')
        };
        if (isAllItems) row['检验项目'] = d.test_item_name;
        return row;
      });
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
