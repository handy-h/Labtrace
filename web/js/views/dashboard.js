// dashboard.js — 仪表盘视图（增强：CSV导出+OCR配额）
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
    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-lg p-4 shadow-sm">
        <div class="text-sm text-slate-500 mb-1">本月OCR调用次数</div>
        <div class="flex items-center gap-3">
          <span class="text-sm" :class="quotaTextClass">
            {{quota ? quota.used_count : '-'}} / {{quota ? quota.total_quota : '-'}}
          </span>
          <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden" v-if="quota">
            <div class="h-full rounded-full transition-all" :class="quotaBarClass" :style="{width: quotaBarWidth + '%'}"></div>
          </div>
        </div>
        <div class="text-xs text-slate-400 mt-1" v-if="quota">
          成功 {{quota.success_count}} 次，失败 {{quota.fail_count}} 次
        </div>
      </div>
      <div class="bg-white rounded-lg p-4 shadow-sm">
        <div class="text-sm text-slate-500 mb-1">最近操作</div>
        <div class="text-xs text-slate-600 leading-relaxed" v-if="recentLog">
          {{recentLog.action}} · {{recentLog.entity_type}}#{{recentLog.entity_id}} · {{recentLog.created_at}}
        </div>
        <div class="text-xs text-slate-400" v-else>暂无记录</div>
      </div>
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
    const quota = Vue.ref(null);
    const recentLog = Vue.ref(null);

    const quotaTextClass = Vue.computed(() => {
      if (!quota.value) return 'text-slate-500';
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return 'text-green-600 font-bold';
      if (remain > 10) return 'text-orange-500 font-bold';
      return 'text-red-600 font-bold';
    });
    const quotaBarClass = Vue.computed(() => {
      if (!quota.value) return 'bg-green-500';
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return 'bg-green-500';
      if (remain > 10) return 'bg-orange-500';
      return 'bg-red-500';
    });
    const quotaBarWidth = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return 0;
      return Math.min(100, Math.round(quota.value.used_count / quota.value.total_quota * 100));
    });

    function loadSummary() {
      api.dashboardSummary().then(r => { if (r.data) summary.value = r.data; });
    }
    function loadAnomalies() {
      const params = {};
      if (filter.value.confidence) params.confidence = filter.value.confidence;
      if (filter.value.flag) params.flag = filter.value.flag;
      api.dashboardAnomalies(params).then(r => { if (r.data && r.data.data) anomalies.value = r.data.data; });
    }
    function loadQuota() {
      api.getOCRQuota().then(r => { if (r.data) quota.value = r.data; });
    }
    function loadRecentLog() {
      api.listAuditLogs({ action: 'ocr_upload' }).then(r => {
        if (r.data && r.data.length > 0) recentLog.value = r.data[0];
      });
    }

    function exportAnomaliesCsv() {
      const headers = ['subject_name', 'sample_date', 'test_item_name', 'value', 'hospital_name', 'confidence', 'flag'];
      const headerLabels = ['受检者', '采样日期', '项目', '结果', '医院', '置信度', '提示符'];
      const rows = anomalies.value.map(a => ({ ...a, confidence: a.confidence + '%' }));
      exportCsv('异常数据', headerLabels, rows);
    }

    Vue.onMounted(() => { loadSummary(); loadAnomalies(); loadQuota(); loadRecentLog(); });
    return { summary, anomalies, filter, quota, recentLog, quotaTextClass, quotaBarClass, quotaBarWidth, loadAnomalies, exportAnomaliesCsv, confClass, flagBadge };
  }
});
