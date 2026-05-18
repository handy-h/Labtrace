// reports.js — 报告单管理视图
const ReportsView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">报告单管理</h1>

    <!-- 报告类型切换 -->
    <div class="card">
      <div class="flex gap-4 mb-4">
        <button 
          @click="reportType = 'lab'"
          :class="['btn', reportType === 'lab' ? 'btn-primary' : 'btn-secondary']"
        >
          检验报告
        </button>
        <button 
          @click="reportType = 'imaging'"
          :class="['btn', reportType === 'imaging' ? 'btn-primary' : 'btn-secondary']"
        >
          影像报告
        </button>
      </div>

      <!-- 筛选区域 -->
      <div class="toolbar">
        <select v-model="filters.subject_id" class="form-select" style="width: 12rem">
          <option value="">全部受检者</option>
          <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <select v-model="filters.hospital_id" class="form-select" style="width: 12rem">
          <option value="">全部医院</option>
          <option v-for="h in hospitals" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>

        <select v-if="reportType === 'imaging'" v-model="filters.exam_item_name" class="form-select" style="width: 10rem">
          <option value="">全部类型</option>
          <option v-for="item in examItemTypes" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="filters.ocr_status" class="form-select" style="width: 10rem">
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="review">待核效</option>
          <option value="imported">已入库</option>
          <option value="failed">失败</option>
        </select>
        <input v-model="filters.start_date" type="date" class="form-input" style="width: 9rem" placeholder="开始日期">
        <input v-model="filters.end_date" type="date" class="form-input" style="width: 9rem" placeholder="结束日期">
        <button @click="loadReports" class="btn btn-primary btn-sm">筛选</button>
        <button @click="resetFilters" class="btn btn-secondary btn-sm">重置</button>
      </div>
    </div>

    <!-- 检验报告列表 -->
    <div v-if="reportType === 'lab'" class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">检验报告列表</h2>
      <data-table :columns="labReportColumns" :data="labReports" empty-text="暂无检验报告">
        <template #cell-categories="{ row }">
          <span v-if="row.categories">{{ row.categories }}</span>
          <span v-else style="color: var(--color-text-muted)">—</span>
        </template>
        <template #cell-ocr_status="{ row }">
          <span :class="statusClass(row.ocr_status)">{{ statusText(row.ocr_status) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewLabReport(row.id)" class="btn-ghost" style="font-size: 0.875rem">查看</button>
        </template>
      </data-table>
    </div>

    <!-- 影像报告列表 -->
    <div v-if="reportType === 'imaging'" class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">影像报告列表</h2>
      <data-table :columns="imagingReportColumns" :data="imagingReports" empty-text="暂无影像报告"
        :sort-field="imagingSort.field" :sort-order="imagingSort.order"
        @update:sort-field="imagingSort.field = $event; loadImagingReports()"
        @update:sort-order="imagingSort.order = $event; loadImagingReports()">
        <template #cell-exam_item_name="{ row }">
          <span v-if="row.exam_item_name" class="px-2 py-0.5 rounded text-xs" style="background: var(--color-primary); color: white">{{ row.exam_item_name }}</span>
          <span v-else style="color: var(--color-text-muted)">—</span>
        </template>
        <template #cell-exam_site="{ row }">
          <span v-if="row.exam_site">{{ row.exam_site }}</span>
          <span v-else style="color: var(--color-text-muted)">—</span>
        </template>
        <template #cell-diagnosis_result="{ row }">
          <span v-if="row.diagnosis_result && row.diagnosis_result !== 'null'" class="truncate" style="max-width: 20rem; display: block" :title="row.diagnosis_result">{{ row.diagnosis_result.substring(0, 50) }}{{ row.diagnosis_result.length > 50 ? '...' : '' }}</span>
          <span v-else></span>
        </template>
        <template #cell-ocr_status="{ row }">
          <span :class="statusClass(row.ocr_status)">{{ statusText(row.ocr_status) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewImagingReport(row.id)" class="btn-ghost" style="font-size: 0.875rem">查看</button>
        </template>
      </data-table>
    </div>

    <!-- 检验报告详情弹窗 -->
    <div v-if="selectedLabReport" class="modal-overlay">
      <div class="modal-content modal-full" style="display: flex; flex-direction: column">
        <div class="flex items-center justify-between px-6 py-3 shrink-0" style="border-bottom: 1px solid var(--table-border)">
          <h2 class="modal-title" style="margin-bottom: 0">检验报告详情 #{{ selectedLabReport.id }} <span :class="statusClass(selectedLabReport.ocr_status)">({{ statusText(selectedLabReport.ocr_status) }})</span></h2>
          <div class="flex gap-2">
            <button @click="closeLabReport" class="btn btn-secondary btn-sm">关闭</button>
          </div>
        </div>

        <div class="flex-1 flex overflow-hidden min-h-0">
          <div class="relative overflow-auto" style="width: 45%" ref="labImageContainer">
            <img 
              :src="labReportImageUrl" 
              ref="labImageEl" 
              v-if="labReportImageUrl && !isLabReportPdf"
              style="max-width: 100%; border: 1px solid var(--table-border)"
            >
            <embed 
              :src="labReportImageUrl" 
              v-if="labReportImageUrl && isLabReportPdf"
              type="application/pdf" 
              class="w-full" 
              style="height: 100%; min-height: 100%; border: none"
            >
          </div>

          <div class="overflow-auto" style="width: 55%; border-left: 1px solid var(--table-border)">
            <div style="padding: 1rem 1.5rem">
              <h3 class="text-lg font-medium mb-4" style="color: var(--color-text)">基本信息</h3>
              <div class="info-grid mb-4">
                <div class="info-item"><span class="info-label">受检者:&nbsp;&nbsp;</span><span class="info-value">{{ subjectName(selectedLabReport.subject_id) }}</span></div>
                <div class="info-item"><span class="info-label">采样日期:&nbsp;&nbsp;</span><span class="info-value">{{ selectedLabReport.sample_date || '-' }}</span></div>
                <div class="info-item"><span class="info-label">医院:&nbsp;&nbsp;</span><span class="info-value">{{ selectedLabReport.hospital_name || '-' }}</span></div>
                <div class="info-item"><span class="info-label">分类:&nbsp;&nbsp;</span><span class="info-value">{{ selectedLabReport.categories || '-' }}</span></div>
              </div>

              <h3 class="text-lg font-medium mb-4" style="color: var(--color-text)">检验项目</h3>
              <table class="lt-table">
                <thead><tr>
                  <th>项目</th><th>结果</th><th>参考区间</th><th>单位</th><th>提示符</th>
                </tr></thead>
                <tbody>
                  <tr v-for="(item, idx) in selectedLabReport.items" :key="item.id">
                    <td class="cell-medium">{{ item.test_item_name || '-' }}</td>
                    <td :class="confClass(item.confidence)">{{ item.original_value }}</td>
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

    <!-- 影像报告详情弹窗 -->
    <div v-if="selectedImagingReport" class="modal-overlay">
      <div class="modal-content modal-full" style="display: flex; flex-direction: column; max-width: 95vw">
        <div class="flex items-center justify-between px-6 py-3 shrink-0" style="border-bottom: 1px solid var(--table-border)">
          <h2 class="modal-title" style="margin-bottom: 0">
            影像报告详情 #{{ selectedImagingReport.id }}
            <span class="px-2 py-0.5 rounded text-xs ml-2" style="background: var(--color-primary); color: white">{{ selectedImagingReport.exam_item_name || selectedImagingReport.report_type }}</span>
            <span :class="statusClass(selectedImagingReport.ocr_status)">({{ statusText(selectedImagingReport.ocr_status) }})</span>
          </h2>
          <div class="flex gap-2">
            <button @click="closeImagingReport" class="btn btn-secondary btn-sm">关闭</button>
          </div>
        </div>

        <div class="flex-1 flex overflow-hidden min-h-0">
          <div class="relative overflow-auto" style="width: 55%; background: #1a1a2e" ref="imagingContainer">
            <img 
              :src="imagingImageUrl" 
              ref="imagingEl" 
              v-if="imagingImageUrl && !isImagingPdf"
              style="max-width: 100%; display: block; margin: 0 auto"
            >
            <embed 
              :src="imagingImageUrl" 
              v-if="imagingImageUrl && isImagingPdf"
              type="application/pdf" 
              class="w-full" 
              style="height: 100%; min-height: 100%; border: none"
            >
          </div>

          <div class="overflow-auto" style="width: 45%; border-left: 1px solid var(--table-border)">
            <div style="padding: 1.5rem">
              <h3 class="text-lg font-medium mb-4" style="color: var(--color-text)">基本信息</h3>
              <div class="info-grid mb-6">
                <div class="info-item"><span class="info-label">受检者:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.subject_name || '-' }}</span></div>
                <div class="info-item"><span class="info-label">检查日期:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.sample_date || '-' }}</span></div>
                <div class="info-item"><span class="info-label">医院:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.hospital_name || '-' }}</span></div>
                <div class="info-item"><span class="info-label">检查项目:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.exam_item_name || '-' }}</span></div>
                <div class="info-item"><span class="info-label">检查号:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.inspect_no || '-' }}</span></div>
                <div class="info-item"><span class="info-label">检查部位:&nbsp;&nbsp;</span><span class="info-value">{{ selectedImagingReport.exam_site || '-' }}</span></div>
              </div>

              <h3 class="text-lg font-medium mb-4" style="color: var(--color-text)">诊断结论</h3>
              <p class="text-sm" style="color: var(--color-text); white-space: pre-wrap">{{ selectedImagingReport.diagnosis_result && selectedImagingReport.diagnosis_result !== 'null' ? selectedImagingReport.diagnosis_result : '' }}</p>

              <h3 class="text-lg font-medium mb-4 mt-6" style="color: var(--color-text)">影像表现</h3>
              <p class="text-sm" style="color: var(--color-text); white-space: pre-wrap">{{ selectedImagingReport.exam_description || '暂无' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
  setup() {
    const reportType = Vue.ref('lab');
    const subjects = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const imagingTypes = Vue.ref([]);
    const examItemTypes = Vue.ref([]);
    const labReports = Vue.ref([]);
    const imagingReports = Vue.ref([]);
    const imagingSort = Vue.ref({ field: '', order: '' });
    const filters = Vue.ref({
      subject_id: '',
      hospital_id: '',
      report_type: '',
      exam_item_name: '',
      ocr_status: '',
      start_date: '',
      end_date: ''
    });

    const selectedLabReport = Vue.ref(null);
    const selectedImagingReport = Vue.ref(null);
    const labReportImageUrl = Vue.ref('');
    const imagingImageUrl = Vue.ref('');

    const labZoomLevel = Vue.ref(1);

    const isLabReportPdf = Vue.computed(() => {
      if (!selectedLabReport.value || !selectedLabReport.value.file_path) return false;
      return selectedLabReport.value.file_path.toLowerCase().endsWith('.pdf');
    });
    const isImagingPdf = Vue.computed(() => {
      if (!selectedImagingReport.value || !selectedImagingReport.value.file_path) return false;
      return selectedImagingReport.value.file_path.toLowerCase().endsWith('.pdf');
    });

    const labReportColumns = [
      { key: 'id', label: 'ID', align: 'center' },
      { key: 'sample_date', label: '采样日期', align: 'center' },
      { key: 'categories', label: '分类', align: 'center' },
      { key: 'ocr_status', label: '状态', align: 'center' },
      { key: 'actions', label: '操作', align: 'center', width: '8rem' }
    ];

    const imagingReportColumns = [
      { key: 'id', label: 'ID', align: 'center' },
      { key: 'sample_date', label: '检查日期', align: 'center', sortable: true },
      { key: 'exam_item_name', label: '类型', align: 'center', sortable: true },
      { key: 'exam_site', label: '部位', align: 'center', sortable: true },
      { key: 'diagnosis_result', label: '诊断结论', align: 'left' },
      { key: 'ocr_status', label: '状态', align: 'center', sortable: true },
      { key: 'actions', label: '操作', align: 'center', width: '8rem' }
    ];

    function statusText(status) {
      const map = {
        pending: '待处理',
        processing: '处理中',
        review: '待核效',
        imported: '已入库',
        failed: '失败'
      };
      return map[status] || status;
    }

    function statusClass(status) {
      const map = {
        pending: 'text-slate-500',
        processing: 'text-blue-500',
        review: 'text-orange-500',
        imported: 'text-green-500',
        failed: 'text-red-500'
      };
      return map[status] || '';
    }

    function confClass(confidence) {
      if (confidence >= 90) return '';
      if (confidence >= 70) return 'text-orange-500';
      return 'text-red-500';
    }

    function flagBadge(flag) {
      if (!flag || flag === 'normal') return '<span style="color: #16a34a; font-weight: bold">正常</span>';
      if (flag === 'H' || flag === 'h') return '<span style="color: var(--color-danger); font-weight: bold">偏高</span>';
      if (flag === 'L' || flag === 'l') return '<span style="color: #2563eb; font-weight: bold">偏低</span>';
      if (flag === '阳性') return '<span style="color: var(--color-danger); font-weight: bold">阳性</span>';
      if (flag === '阴性') return '<span style="color: #2563eb; font-weight: bold">阴性</span>';
      return `<span style="font-weight: bold">${flag}</span>`;
    }

    function getImagingTypeName(code) {
      const type = imagingTypes.value.find(t => t.code === code);
      return type ? type.name : code;
    }

    function subjectName(id) {
      const s = subjects.value.find(sub => sub.id === id);
      return s ? s.name : '-';
    }

    function loadReports() {
      if (reportType.value === 'lab') {
        loadLabReports();
      } else {
        loadImagingReports();
      }
    }

    function loadLabReports() {
      const params = {};
      if (filters.value.subject_id) params.subject_id = filters.value.subject_id;
      if (filters.value.hospital_id) params.hospital_id = filters.value.hospital_id;
      if (filters.value.ocr_status) params.ocr_status = filters.value.ocr_status;
      if (filters.value.start_date) params.start_date = filters.value.start_date;
      if (filters.value.end_date) params.end_date = filters.value.end_date;
      
      api.listReports(params).then(r => {
        if (r.data) labReports.value = r.data;
      });
    }

    function loadImagingReports() {
      const params = {};
      if (filters.value.subject_id) params.subject_id = filters.value.subject_id;
      if (filters.value.hospital_id) params.hospital_id = filters.value.hospital_id;
      if (filters.value.exam_item_name) params.exam_item_name = filters.value.exam_item_name;
      if (filters.value.ocr_status) params.ocr_status = filters.value.ocr_status;
      if (filters.value.start_date) params.start_date = filters.value.start_date;
      if (filters.value.end_date) params.end_date = filters.value.end_date;
      if (imagingSort.value.field) params.sort_by = imagingSort.value.field;
      if (imagingSort.value.order) params.sort_order = imagingSort.value.order;
      
      api.listImagingReports(params).then(r => {
        if (r.data) imagingReports.value = r.data;
      });
    }

    function resetFilters() {
      filters.value = {
        subject_id: '',
        hospital_id: '',
        report_type: '',
        exam_item_name: '',
        ocr_status: '',
        start_date: '',
        end_date: ''
      };
      imagingSort.value = { field: '', order: '' };
      loadReports();
    }

    function viewLabReport(id) {
      api.getReport(id).then(r => {
        if (r.data) {
          selectedLabReport.value = r.data;
          labReportImageUrl.value = api.getReportImage(r.data.id) + '?t=' + Date.now();
        }
      });
    }

    function viewImagingReport(id) {
      api.getImagingReport(id).then(r => {
        if (r.data) {
          selectedImagingReport.value = r.data;
          imagingImageUrl.value = api.getImagingReportImage(r.data.id) + '?t=' + Date.now();
        }
      });
    }

    function closeLabReport() {
      selectedLabReport.value = null;
    }

    function closeImagingReport() {
      selectedImagingReport.value = null;
    }

    Vue.onMounted(() => {
      api.listSubjects().then(r => { if (r.data) subjects.value = r.data; });
      api.listHospitals().then(r => { if (r.data) hospitals.value = r.data; });
      api.listImagingReportTypes().then(r => { if (r.data) imagingTypes.value = r.data; });
      api.listImagingExamItems().then(r => { if (r.data) examItemTypes.value = r.data; });
      loadReports();
    });

    Vue.watch(reportType, () => {
      loadReports();
    });

    return {
      reportType,
      subjects,
      hospitals,
      imagingTypes,
      examItemTypes,
      labReports,
      imagingReports,
      imagingSort,
      filters,
      selectedLabReport,
      selectedImagingReport,
      labReportImageUrl,
      imagingImageUrl,
      isLabReportPdf,
      isImagingPdf,
      labReportColumns,
      imagingReportColumns,
      statusText,
      statusClass,
      confClass,
      flagBadge,
      getImagingTypeName,
      subjectName,
      loadReports,
      resetFilters,
      viewLabReport,
      viewImagingReport,
      closeLabReport,
      closeImagingReport
    };
  }
});
