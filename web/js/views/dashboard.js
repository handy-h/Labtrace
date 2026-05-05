// dashboard.js — 仪表盘视图（增强：CSV导出）
const DashboardView = Vue.defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">仪表盘</h1>
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg p-4 shadow-sm"><div class="text-sm text-slate-500">总受检者</div><div class="text-2xl font-bold">{{summary.subjects}}</div></div>
      <div class="bg-white rounded-lg p-4 shadow-sm"><div class="text-sm text-slate-500">待核效</div><div class="text-2xl font-bold text-orange-500">{{summary.pending}}</div></div>
      <div class="bg-white rounded-lg p-4 shadow-sm"><div class="text-sm text-slate-500">异常条目</div><div class="text-2xl font-bold text-red-500">{{summary.anomalies}}</div></div>
      <div class="bg-white rounded-lg p-4 shadow-sm"><div class="text-sm text-slate-500">最近医院</div><div class="text-2xl font-bold">{{summary.hospitals}}</div></div>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h2 class="font-semibold mb-3">异常筛选</h2>
      <div class="flex gap-3 mb-3 flex-wrap">
        <select v-model="filter.confidence" class="border rounded px-2 py-1 text-sm">
          <option value="">全部置信度</option><option value="high">高(≥95)</option><option value="medium">中(80-94)</option><option value="low">低(<80)</option>
        </select>
        <select v-model="filter.flag" class="border rounded px-2 py-1 text-sm">
          <option value="">全部提示符</option><option value="H">H(偏高)</option><option value="L">L(偏低)</option>
        </select>
        <button @click="loadAnomalies" class="px-3 py-1 bg-blue-600 text-white rounded text-sm">筛选</button>
        <button @click="exportAnomaliesCsv" class="px-3 py-1 bg-slate-600 text-white rounded text-sm" v-if="anomalies.length">导出CSV</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50 text-left text-slate-600">
          <th class="p-2">受检者</th><th class="p-2">采样日期</th><th class="p-2">项目</th><th class="p-2">结果</th><th class="p-2">医院</th><th class="p-2">置信度</th><th class="p-2">提示符</th>
        </tr></thead>
        <tbody>
          <tr v-for="a in anomalies" :key="a.id" class="border-t hover:bg-slate-50">
            <td class="p-2">{{a.subject_name}}</td><td class="p-2">{{a.sample_date}}</td><td class="p-2">{{a.test_item_name}}</td>
            <td class="p-2 font-medium" :class="confClass(a.confidence)">{{a.value}}</td>
            <td class="p-2">{{a.hospital_name}}</td><td class="p-2">{{a.confidence}}%</td>
            <td class="p-2" v-html="flagBadge(a.flag)"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
  setup() {
    const summary = Vue.ref({ subjects: 0, pending: 0, anomalies: 0, hospitals: 0 });
    const anomalies = Vue.ref([]);
    const filter = Vue.ref({ confidence: '', flag: '' });

    function loadSummary() {
      api.dashboardSummary().then(r => { if (r.data) summary.value = r.data; });
    }
    function loadAnomalies() {
      const params = {};
      if (filter.value.confidence) params.confidence = filter.value.confidence;
      if (filter.value.flag) params.flag = filter.value.flag;
      api.dashboardAnomalies(params).then(r => { if (r.data && r.data.data) anomalies.value = r.data.data; });
    }
    function exportAnomaliesCsv() {
      const headers = ['subject_name', 'sample_date', 'test_item_name', 'value', 'hospital_name', 'confidence', 'flag'];
      const headerLabels = ['受检者', '采样日期', '项目', '结果', '医院', '置信度', '提示符'];
      const rows = anomalies.value.map(a => ({
        ...a,
        confidence: a.confidence + '%'
      }));
      exportCsv('异常数据', headerLabels, rows);
    }

    Vue.onMounted(() => { loadSummary(); loadAnomalies(); });
    return { summary, anomalies, filter, loadAnomalies, exportAnomaliesCsv, confClass, flagBadge };
  }
});
