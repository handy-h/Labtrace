// dashboard.js — 仪表盘视图
const DashboardView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">仪表盘</h1>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">总受检者</div>
        <div class="stat-value">{{summary.subjects}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待核效</div>
        <div class="stat-value" style="color: var(--color-warning)">{{summary.pending}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">异常条目</div>
        <div class="stat-value" style="color: var(--color-danger)">{{summary.anomalies}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">最近医院</div>
        <div class="stat-value">{{summary.hospitals}}</div>
      </div>
    </div>

    <!-- OCR 配额 + 最近操作 -->
    <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="card">
        <div class="stat-label mb-1">本月OCR调用次数</div>
        <div class="flex items-center gap-3">
          <span class="text-sm" :class="quotaTextClass">
            {{quota ? quota.used_count : '-'}} / {{quota ? quota.total_quota : '-'}}
          </span>
          <div class="progress-bar flex-1" v-if="quota">
            <div class="progress-bar-fill" :class="quotaBarClass" :style="{width: quotaBarWidth + '%'}"></div>
          </div>
        </div>
        <div class="text-xs mt-1" style="color: var(--color-text-muted)" v-if="quota">
          成功 {{quota.success_count}} 次，失败 {{quota.fail_count}} 次
        </div>
      </div>
      <div class="card">
        <div class="stat-label mb-1">最近操作</div>
        <div class="text-xs" style="color: var(--color-text-secondary); line-height: 1.6" v-if="recentLog">
          {{recentLog.action}} · {{recentLog.entity_type}}#{{recentLog.entity_id}} · {{recentLog.created_at}}
        </div>
        <div class="text-xs" style="color: var(--color-text-muted)" v-else>暂无记录</div>
      </div>
    </div>

    <!-- 异常筛选 -->
    <div class="card">
      <h2 class="page-subtitle">异常筛选</h2>
      <div class="toolbar">
        <select v-model="filter.flag" class="form-select" style="width: auto">
          <option value="">全部提示符</option><option value="H">H(偏高)</option><option value="L">L(偏低)</option>
        </select>
        <button @click="loadAnomalies" class="btn btn-primary btn-sm">筛选</button>
        <button @click="exportAnomaliesCsv" class="btn btn-secondary btn-sm" v-if="anomalies.length">导出CSV</button>
      </div>

      <data-table
        :columns="anomalyColumns"
        :data="anomalies"
        empty-text="暂无异常数据"
      >
        <template #cell-value="{ row }">
          <span class="cell-medium" :class="confClass(row.confidence)">{{row.value}}</span>
        </template>
        <template #cell-flag="{ row }">
          <span v-html="flagBadge(row.flag)"></span>
        </template>
      </data-table>
    </div>
  </div>`,
  setup() {
    const summary = Vue.ref({ subjects: 0, pending: 0, anomalies: 0, hospitals: 0 });
    const anomalies = Vue.ref([]);
    const filter = Vue.ref({ flag: '' });
    const quota = Vue.ref(null);
    const recentLog = Vue.ref(null);

    const anomalyColumns = [
      { key: 'subject_name', label: '受检者', align: 'center' },
      { key: 'sample_date', label: '采样日期', align: 'center' },
      { key: 'test_item_name', label: '项目', align: 'center' },
      { key: 'value', label: '结果', align: 'center', medium: true },
      { key: 'hospital_name', label: '医院' },
      { key: 'flag', label: '提示符', align: 'center' },
    ];

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
      const headers = ['subject_name', 'sample_date', 'test_item_name', 'value', 'hospital_name', 'flag'];
      const headerLabels = ['受检者', '采样日期', '项目', '结果', '医院', '提示符'];
      exportCsv('异常数据', headerLabels, anomalies.value);
    }

    Vue.onMounted(() => { loadSummary(); loadAnomalies(); loadQuota(); loadRecentLog(); });
    return { summary, anomalies, filter, quota, recentLog, anomalyColumns, quotaTextClass, quotaBarClass, quotaBarWidth, loadAnomalies, exportAnomaliesCsv, confClass, flagBadge };
  }
});
