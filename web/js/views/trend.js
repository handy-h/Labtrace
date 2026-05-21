// trend.js — 纵向趋势分析视图
const TrendView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">纵向趋势分析</h1>

    <!-- 筛选栏 -->
    <div class="card">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">受检者</label>
          <select v-model="filter.subject_id" class="form-select" style="width: 16rem">
            <option value="">请选择</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{s.name}}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">检验项目</label>
          <select v-model="filter.test_item_id" class="form-select" style="width: 16rem">
            <option value="">请选择</option><option v-for="it in testItems" :key="it.id" :value="it.id">{{it.standard_name}}</option>
          </select>
        </div>
        <button @click="loadTrend" class="btn btn-primary">查询</button>
        <button @click="exportTrendCsv" class="btn btn-secondary" v-if="trendData.length">导出CSV</button>
      </div>
    </div>

    <!-- 图表 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div id="trend-chart" style="height:400px;"></div>
    </div>

    <!-- 数据表 -->
    <div v-if="trendData.length" class="card" style="margin-top: var(--card-gap)">
      <data-table :columns="trendColumns" :data="trendData" empty-text="暂无数据">
        <template #cell-converted_value="{ row }">
          <span class="cell-medium">{{row.converted_value}}</span>
        </template>
        <template #cell-ref_interval="{ row }">
          <span class="cell-muted">{{row.ref_interval_text || (row.ref_min != null && row.ref_max != null ? row.ref_min + '-' + row.ref_max : '-')}}</span>
        </template>
        <template #cell-flag="{ row }">
          <span v-html="flagBadge(row.flag)"></span>
        </template>
        <template #cell-sparkline="{ row }">
          <sparkline-chart :data="sparklineData[row.test_item_name || ('item_' + row.report_item_id)] || []" :subject-id="filter.subject_id" :test-item-id="row.test_item_id" @navigate="onSparklineNavigate"></sparkline-chart>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewTrendReport(row.report_id)" class="btn-ghost">查看检查单</button>
        </template>
      </data-table>
    </div>

    <!-- 下钻浮窗 -->
    <drilldown-popup :visible="showDrilldown" :data-point="drilldownDataPoint" @close="showDrilldown = false"></drilldown-popup>

    <!-- 检验报告查看弹窗 -->
    <div v-if="trendReportView" class="modal-overlay">
      <div class="modal-content modal-full" style="display: flex; flex-direction: column">
        <div class="flex items-center justify-between px-6 py-3 shrink-0" style="border-bottom: 1px solid var(--table-border)">
          <h2 class="modal-title" style="margin-bottom: 0">检验报告 #{{ trendReportView.id }} &nbsp;<span style="font-size:0.875rem; font-weight:400; color: var(--color-text-muted)">{{ trendReportView.sample_date }} · {{ trendReportView.hospital_name }}</span></h2>
          <button @mousedown.stop @click="closeTrendReport" class="btn btn-secondary btn-sm">关闭</button>
        </div>
        <div class="flex-1 flex overflow-hidden min-h-0">
          <div class="relative overflow-auto" style="width: 45%">
            <img :src="trendReportImageUrl" v-if="trendReportImageUrl && !isTrendReportPdf" style="max-width:100%; border:1px solid var(--table-border)">
            <embed :src="trendReportImageUrl" v-if="trendReportImageUrl && isTrendReportPdf" type="application/pdf" class="w-full" style="height:100%; min-height:100%; border:none">
          </div>
          <div class="overflow-auto" style="width: 55%; border-left: 1px solid var(--table-border)">
            <div style="padding: 1rem 1.5rem">
              <h3 class="page-subtitle">检验项目</h3>
              <table class="lt-table">
                <thead><tr><th>项目</th><th>结果</th><th>参考区间</th><th>单位</th><th>提示符</th></tr></thead>
                <tbody>
                  <tr v-for="item in trendReportView.items" :key="item.id">
                    <td class="cell-medium">{{ item.test_item_name || '-' }}</td>
                    <td>{{ item.original_value }}</td>
                    <td class="cell-muted">{{ item.ref_interval_text || '-' }}</td>
                    <td>{{ item.original_unit }}</td>
                    <td><span v-html="flagBadge(item.flag)"></span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
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
    const _ctrl = new AbortController();

    const currentSubjectId = Vue.inject('currentSubjectId', null);

    const trendColumns = Vue.computed(() => {
      const cols = [
        { key: 'sample_date', label: '采样日期', align: 'center' },
      ];
      if (!filter.value.test_item_id) {
        cols.push({ key: 'test_item_name', label: '检验项目' });
      }
      cols.push(
        { key: 'converted_value', label: '数值', align: 'center', medium: true },
        { key: 'ref_interval', label: '参考区间', align: 'center', muted: true },
        { key: 'flag', label: '提示符', align: 'center' },
        { key: 'unit', label: '单位', align: 'center' },
        { key: 'sparkline', label: '趋势', width: '100px' },
        { key: 'hospital_name', label: '医院' },
        { key: 'actions', label: '' },
      );
      return cols;
    });

    Vue.onMounted(() => {
      api.listSubjects(null, _ctrl.signal).then(r => { if (r && r.data) subjects.value = r.data; });
      api.listTestItems(null, _ctrl.signal).then(r => { if (r && r.data) testItems.value = r.data; });
      window.addEventListener('resize', onResize);
    });

    Vue.onUnmounted(() => {
      window.removeEventListener('resize', onResize);
      if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
      _ctrl.abort();
    });

    if (currentSubjectId) {
      Vue.watch(currentSubjectId, (id) => { if (id) filter.value.subject_id = id; });
    }

    function onResize() { if (chartInstance) chartInstance.resize(); }

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
      const refColor = 'rgba(42, 157, 143, 0.12)';  /* 与主色呼应的青绿 */
      const refBorderColor = 'rgba(42, 157, 143, 0.3)';
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
        { xAxis: band.startIndex, yAxis: band.refMin, itemStyle: { color: refColor } },
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
        const groups = {};
        trendData.value.forEach(d => {
          const key = d.test_item_name || ('项目' + d.test_item_id);
          if (!groups[key]) groups[key] = {};
          groups[key][d.sample_date] = d.converted_value;
        });
        const colors = ['#0F766E','#4A7EBB','#C27A3C','#C25151','#2A9D8F','#8B5CF6','#64748B','#D97706','#0D9488','#5B21B6'];
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
        const refBorderColor = 'rgba(42, 157, 143, 0.3)';
        const values = allDates.map(dt => {
          const pt = trendData.value.find(d => d.sample_date === dt);
          return pt ? pt.converted_value : null;
        });
        const nonNullCount = values.filter(v => v !== null).length;
        const chartType = nonNullCount <= 1 ? 'scatter' : 'line';
        series.push({ name: '数值', type: chartType, data: values, symbolSize: 8, connectNulls: true });
        legendData.push('数值');

        const refBands = buildRefBands(trendData.value);
        if (refBands.length) {
          series.push({
            name: '参考区间', type: 'line', data: [],
            markArea: { silent: true, data: refBands, itemStyle: { borderWidth: 1, borderColor: refBorderColor, borderType: 'dashed' } }
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

    const trendReportView = Vue.ref(null);
    const trendReportImageUrl = Vue.ref('');
    const isTrendReportPdf = Vue.computed(() =>
      trendReportView.value && trendReportView.value.file_path
        ? trendReportView.value.file_path.toLowerCase().endsWith('.pdf')
        : false
    );

    function viewTrendReport(reportId) {
      if (!reportId) return;
      api.getReport(reportId).then(r => {
        if (r && r.data) {
          trendReportView.value = r.data;
          trendReportImageUrl.value = api.getReportImage(r.data.id) + '?t=' + Date.now();
        }
      });
    }

    function closeTrendReport() {
      trendReportView.value = null;
      trendReportImageUrl.value = '';
    }

    return { subjects, testItems, filter, trendData, trendColumns, showDrilldown, drilldownDataPoint, sparklineData, loadTrend, exportTrendCsv, onSparklineNavigate, flagBadge, trendReportView, trendReportImageUrl, isTrendReportPdf, viewTrendReport, closeTrendReport };
  }
});
