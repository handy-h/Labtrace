// ocr-import.js — OCR上传与沉浸式比对视图
const OCRImportView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">检验单上传与 OCR</h1>

    <!-- 上传表单 -->
    <div class="card">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">受检者</label>
          <select v-model="form.subject_id" class="form-select" style="width: 16rem">
            <option value="">请选择</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{s.name}}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">医院</label>
          <select v-model="form.hospital_id" class="form-select" style="width: 16rem">
            <option value="">请选择</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">采样日期</label>
          <input v-model="form.sample_date" type="date" class="form-input" style="width: auto">
        </div>
        <div class="form-group">
          <label class="form-label">文件</label>
          <input type="file" @change="onFileChange" accept="image/*,.pdf" multiple class="text-sm">
          <div v-if="selectedFiles.length > 1" class="flex flex-col gap-1 mt-1" style="max-height: 6rem; overflow-y: auto; font-size: 0.75rem">
            <div v-for="(f, i) in selectedFiles" :key="i" class="flex items-center gap-2">
              <span style="color: var(--color-text-muted)">#{{i + 1}}</span>
              <span class="truncate" style="max-width: 14rem">{{ f.name }}</span>
              <span style="color: var(--color-text-muted)">{{ (f.size / 1024).toFixed(0) }}KB</span>
              <button @click="removeFile(i)" class="text-red-400 hover:text-red-600" style="font-size: 0.65rem">x</button>
            </div>
          </div>
        </div>
        <button @click="upload" class="btn btn-primary" :disabled="uploading || batchUploading">{{ batchUploading ? '正在上传 (' + (batchCurrent + 1) + '/' + batchQueue.length + ')' : uploading ? '上传中...' : '上传' }}</button>
      </div>
    </div>

    <!-- 报告列表 -->
    <div v-if="reports.length" class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">报告列表</h2>
      <data-table :columns="reportListColumns" :data="reports" empty-text="暂无报告">
        <template #cell-category_name="{ row }">
          <span v-if="row.category_name">{{ row.category_name }}</span>
          <span v-else style="color: var(--color-text-muted)">—</span>
        </template>
        <template #cell-ocr_status="{ row }">
          <span :class="statusClass(row.ocr_status)">{{statusText(row.ocr_status)}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewReport(row.id)" class="btn-ghost" style="font-size: 0.875rem">查看</button>
          <button v-if="row.ocr_status==='review'" @click="openMappingWizard(row)" class="btn-ghost" style="font-size: 0.875rem; color: #9333ea">自定义映射</button>
          <button v-if="row.ocr_status==='review'" @click="doImport(row.id)" class="btn-ghost" style="font-size: 0.875rem; color: var(--color-success)">入库</button>
          <button v-if="row.ocr_status!=='processing'" @click="doReOCR(row.id)" class="btn-ghost" style="font-size: 0.875rem; color: var(--color-warning)">重新识别</button>
        </template>
      </data-table>
    </div>

    <!-- 报告详情弹窗（沉浸式） -->
    <div v-if="selectedReport" class="modal-overlay">
      <div class="modal-content modal-full" style="display: flex; flex-direction: column">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-3 shrink-0" style="border-bottom: 1px solid var(--table-border)">
          <h2 class="modal-title" style="margin-bottom: 0">报告详情 #{{selectedReport.id}} <span :class="statusClass(selectedReport.ocr_status)">({{statusText(selectedReport.ocr_status)}})</span></h2>
          <div class="flex items-center gap-2">
            <label class="text-xs" style="color: var(--color-text-secondary)">分类：</label>
            <select v-model="selectedReport.category_id" @change="onCategoryChange" class="form-select" style="width: 10rem; padding: 2px 6px; font-size: 0.8rem">
              <option :value="null">未分类</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
            <span v-if="selectedReport._mismatchCategory" class="flex items-center gap-1">
              <span class="text-xs text-orange-600">{{ selectedReport._mismatchCategory }}</span>
              <button @click="showNormalizeModal = true" class="btn-ghost" style="font-size: 0.75rem; color: var(--color-warning); border: 1px solid var(--color-warning); padding: 0 6px; border-radius: 4px">归一</button>
            </span>
          </div>
          <span class="text-xs" style="color: var(--color-text-muted)">点击单元格即可编辑</span>
          <div class="flex gap-2">
            <button v-if="selectedReport.ocr_status === 'review'" @click="doConfirm(selectedReport.id)"
                    class="btn btn-primary btn-sm" style="background: var(--color-warning); border-color: var(--color-warning)">确认核效</button>
            <button @click="closeReport" class="btn btn-secondary btn-sm">关闭</button>
          </div>
        </div>

        <!-- Main content area -->
        <div class="flex-1 flex overflow-hidden min-h-0">
          <!-- Left: file preview -->
          <div class="relative overflow-auto" style="width: 45%" ref="imageContainer">
            <img :src="reportImageUrl" ref="imageEl" v-if="reportImageUrl && !isPdf"
                 :style="zoomLevel > 1 ? { width: 'auto', maxWidth: 'none' } : { maxWidth: '100%' }"
                 style="border: 1px solid var(--table-border)" @load="onImageLoad">
            <embed :src="reportImageUrl" v-if="reportImageUrl && isPdf"
                   type="application/pdf" class="w-full" style="height: 100%; min-height: 100%; border: none">
            <div v-if="highlightRect && !isPdf" class="highlight-breathe absolute pointer-events-none border-2 border-blue-500 rounded"
                 :style="highlightStyle"></div>
            <canvas v-if="highlightRect && magnifierReady && !isPdf" ref="magnifier"
                    class="absolute pointer-events-none border-2 border-blue-400 rounded shadow-lg"
                    :style="magnifierStyle" width="120" height="80"></canvas>
          </div>

          <!-- Right: data table -->
          <div class="overflow-auto" style="width: 55%; border-left: 1px solid var(--table-border)">
            <table class="lt-table">
              <thead><tr>
                <th>项目</th><th>结果</th><th>参考区间</th><th>单位</th><th>提示符</th>
              </tr></thead>
              <tbody>
                <tr v-for="(it, idx) in selectedReport.items" :key="it.id"
                    :class="{ 'bg-blue-50': selectedRowIndex === idx }"
                    @click="selectRow(idx)" style="cursor: pointer">
                  <td class="cell-medium group relative" style="cursor: text"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.test_item_name"
                           class="form-input" style="padding: 2px 6px; width: 100%" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" ref="editInput" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.test_item_name || '-'}}</span>
                      <button v-if="!it.test_item_id && it.test_item_name"
                              @click.stop="openLinkModal(it)"
                              class="text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100"
                              style="font-size: 10px">关联</button>
                      <span class="opacity-0 group-hover:opacity-100 text-blue-400" style="font-size: 10px">✎</span>
                    </div>
                  </td>
                  <td class="group relative" :class="confClass(it.confidence)"
                      style="cursor: text" @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.original_value"
                           class="form-input" style="padding: 2px 6px; width: 5rem" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.original_value}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-blue-400" style="font-size: 10px">✎</span>
                    </div>
                  </td>
                  <td class="cell-muted group relative" style="cursor: text"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.ref_interval_text"
                           class="form-input" style="padding: 2px 6px; width: 5rem" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.ref_interval_text || it.row_notes || '-'}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-blue-400" style="font-size: 10px">✎</span>
                    </div>
                  </td>
                  <td class="group relative" style="cursor: text"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.original_unit"
                           class="form-input" style="padding: 2px 6px; width: 4rem" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.original_unit}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-blue-400" style="font-size: 10px">✎</span>
                    </div>
                  </td>
                  <td class="group relative" style="cursor: text"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.flag"
                           class="form-input" style="padding: 2px 6px; width: 3rem" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span v-html="flagBadge(it.flag)"></span>
                      <span class="opacity-0 group-hover:opacity-100 text-blue-400" style="font-size: 10px">✎</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷键提示条 -->
    <div v-if="selectedReport" class="shortcut-hint">
      <kbd>Tab</kbd> 切换 | <kbd>Enter</kbd> 保存跳转 | <kbd>Space</kbd> 缩放
    </div>

    <!-- OCR 配额条 -->
    <div class="fixed bottom-3 left-3 z-50 card flex items-center gap-3"
         v-if="quota" style="padding: 0.5rem 1rem; font-size: 0.75rem">
      <span class="font-medium" style="color: var(--color-text-secondary)">本月 OCR</span>
      <span :class="quotaClass">{{quota.used_count}}/{{quota.total_quota}}</span>
      <div class="progress-bar" style="width: 6rem">
        <div class="progress-bar-fill" :class="quotaBarClass" :style="{width: quotaPct + '%'}"></div>
      </div>
      <span style="color: var(--color-text-muted)">成功{{quota.success_count}} 失败{{quota.fail_count}}</span>
    </div>

    <!-- 批量上传队列 -->
    <div class="fixed bottom-3 left-3 z-50 card"
         v-if="batchQueue.length > 0"
         style="padding: 0.6rem 1rem; font-size: 0.75rem; min-width: 14rem; max-width: 20rem">
      <div class="flex items-center justify-between mb-1">
        <span class="font-medium" style="color: var(--color-text-secondary)">批量上传队列</span>
        <span style="color: var(--color-text-muted)">{{ batchDoneCount }}/{{ batchQueue.length }} 已完成</span>
      </div>
      <div class="progress-bar" style="width: 100%; margin-bottom: 0.4rem">
        <div class="progress-bar-fill bg-blue-500" :style="{ width: batchPct + '%' }"></div>
      </div>
      <div style="max-height: 5rem; overflow-y: auto">
        <div v-for="(item, i) in batchQueue" :key="i" class="flex items-center gap-2" style="padding: 1px 0">
          <span v-if="item.status === 'done'" style="color: var(--color-success)">&#10003;</span>
          <span v-else-if="item.status === 'error'" style="color: var(--color-danger)">&#10007;</span>
          <span v-else-if="item.status === 'uploading'" style="color: var(--color-warning)">&#9679;</span>
          <span v-else style="color: var(--color-text-muted)">&#9675;</span>
          <span class="truncate" style="max-width: 12rem">{{ item.file.name }}</span>
        </div>
      </div>
    </div>

    <!-- 自定义列映射向导 -->
    <ocr-mapping-wizard
      :visible="wizardVisible"
      :report-id="wizardReportId"
      :hospital-id="wizardHospitalId"
      :report-image-url="wizardImageUrl"
      :file-path="wizardFilePath"
      @close="wizardVisible=false"
      @done="onWizardDone">
    </ocr-mapping-wizard>

    <!-- 关联标准项目弹窗 -->
    <div v-if="showLinkModal" class="modal-overlay" @click.self="showLinkModal=false">
      <div class="modal-content w-[420px]">
        <h2 class="modal-title">关联标准项目</h2>
        <div class="card" style="background: var(--color-bg); margin-bottom: 0.75rem">
          <span class="text-sm" style="color: var(--color-text-secondary)">OCR 识别名：</span>
          <span class="font-medium">{{linkingItem.test_item_name}}</span>
        </div>
        <div style="margin-bottom: 0.75rem">
          <label class="form-label">选择标准项目</label>
          <input v-model="linkSearch" placeholder="输入关键字搜索..."
                 class="form-input mb-1" @input="filterLinkItems">
          <div class="table-wrap" style="max-height: 12rem; overflow-y: auto">
            <div v-for="it in filteredLinkItems" :key="it.id"
                 class="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50"
                 :class="{'bg-blue-100': linkSelectedId === it.id}"
                 @click="linkSelectedId = it.id">
              {{it.standard_name}} <span style="color: var(--color-text-muted); font-size: 0.75rem; margin-left: 0.5rem">{{it.category}}</span>
            </div>
            <div v-if="!filteredLinkItems.length" class="empty-state">无匹配项目</div>
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm" style="margin-bottom: 1rem; cursor: pointer">
          <input type="checkbox" v-model="linkCreateAlias" class="rounded">
          同时创建别名（今后该 OCR 名称自动匹配）
        </label>
        <div class="modal-footer">
          <button @click="showLinkModal=false" class="btn btn-secondary">取消</button>
          <button @click="doLinkItem" :disabled="!linkSelectedId"
                  class="btn btn-primary" :class="{ 'opacity-50': !linkSelectedId }">关联</button>
        </div>
      </div>
    </div>
  </div>`,
  setup() {
    const subjects = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const reports = Vue.ref([]);
    const form = Vue.ref({ subject_id: "", hospital_id: "", sample_date: "" });
    const uploading = Vue.ref(false);
    const selectedReport = Vue.ref(null);
    const reportImageUrl = Vue.ref("");
    const selectedRowIndex = Vue.ref(-1);
    const editingItemId = Vue.ref(null);
    const editForm = Vue.ref({ test_item_name: "", original_value: "", original_unit: "", ref_interval_text: "", flag: "" });
    const isPdf = Vue.computed(() => {
      if (!selectedReport.value || !selectedReport.value.file_path) return false;
      return selectedReport.value.file_path.toLowerCase().endsWith(".pdf");
    });
    const zoomLevel = Vue.ref(1);
    const quota = Vue.ref(null);
    const highlightRect = Vue.ref(null);
    const magnifierReady = Vue.ref(false);
    const imageEl = Vue.ref(null);
    const magnifier = Vue.ref(null);
    const editInput = Vue.ref(null);
    let selectedFiles = [];
    const batchQueue = Vue.ref([]);
    const batchUploading = Vue.ref(false);
    const batchCurrent = Vue.ref(0);

    const reportListColumns = [
      { key: 'id', label: 'ID', align: 'center' },
      { key: 'sample_date', label: '采样日期', align: 'center' },
      { key: 'category_name', label: '检验项目分类', align: 'center' },
      { key: 'ocr_status', label: '状态', align: 'center' },
      { key: 'actions', label: '操作', align: 'center', width: '16rem' },
    ];

    // 关联项目
    const showLinkModal = Vue.ref(false);
    const linkingItem = Vue.ref(null);
    const linkSearch = Vue.ref('');
    const allTestItems = Vue.ref([]);
    const filteredLinkItems = Vue.ref([]);
    const linkSelectedId = Vue.ref(null);
    const linkCreateAlias = Vue.ref(true);

    const currentSubjectId = Vue.inject("currentSubjectId", null);

    // 检验项目分类
    const categories = Vue.ref([]);
    const showNormalizeModal = Vue.ref(false);

    Vue.onMounted(() => {
      api.listSubjects().then((r) => { if (r.data) subjects.value = r.data; });
      api.listHospitals().then((r) => { if (r.data) hospitals.value = r.data; });
      api.listCategories().then((r) => { if (r.data) categories.value = r.data; });
      loadReports();
      loadQuota();
      document.addEventListener("keydown", onKeyDown);
    });

    Vue.onUnmounted(() => { document.removeEventListener("keydown", onKeyDown); });

    if (currentSubjectId) {
      Vue.watch(currentSubjectId, (id) => { if (id) form.value.subject_id = id; });
    }

    function loadReports() { api.listReports({ ocr_status: "" }).then((r) => { if (r.data) reports.value = r.data; }); }
    function onFileChange(e) {
      selectedFiles = Array.from(e.target.files || []);
      if (!batchUploading.value) { batchQueue.value = []; batchCurrent.value = 0; }
    }
    function removeFile(index) { selectedFiles.splice(index, 1); }
    function clearFileInput() { const input = document.querySelector('input[type="file"]'); if (input) input.value = ''; }
    async function upload() {
      if (!selectedFiles.length || !form.value.subject_id) return alert("请选择文件和受检者");
      const formSnapshot = { ...form.value };
      if (selectedFiles.length === 1) {
        uploading.value = true;
        const fd = new FormData();
        fd.append("file", selectedFiles[0]);
        fd.append("subject_id", formSnapshot.subject_id);
        fd.append("hospital_id", formSnapshot.hospital_id);
        fd.append("sample_date", formSnapshot.sample_date);
        const r = await api.ocrUpload(fd);
        uploading.value = false;
        if (r.code === 0) { alert("上传成功，OCR识别中"); loadReports(); } else alert(r.message);
        clearFileInput(); selectedFiles = [];
        return;
      }
      batchUploading.value = true;
      batchCurrent.value = 0;
      batchQueue.value = selectedFiles.map(f => ({ file: f, status: 'pending', reportId: null, errorMsg: '' }));
      for (let i = 0; i < batchQueue.value.length; i++) {
        batchCurrent.value = i;
        batchQueue.value[i].status = 'uploading';
        const fd = new FormData();
        fd.append("file", batchQueue.value[i].file);
        fd.append("subject_id", formSnapshot.subject_id);
        fd.append("hospital_id", formSnapshot.hospital_id);
        fd.append("sample_date", formSnapshot.sample_date);
        try {
          const r = await api.ocrUpload(fd);
          if (r.code === 0) { batchQueue.value[i].status = 'done'; batchQueue.value[i].reportId = r.data.report_id; }
          else { batchQueue.value[i].status = 'error'; batchQueue.value[i].errorMsg = r.message || "上传失败"; }
        } catch (err) { batchQueue.value[i].status = 'error'; batchQueue.value[i].errorMsg = err.message || "网络错误"; }
      }
      batchUploading.value = false;
      loadReports();
      const doneCount = batchQueue.value.filter(x => x.status === 'done').length;
      const failCount = batchQueue.value.filter(x => x.status === 'error').length;
      let msg = `批量上传完成：${doneCount} 成功`;
      if (failCount) msg += `，${failCount} 失败`;
      alert(msg);
      clearFileInput(); selectedFiles = [];
    }
    function viewReport(id) {
      api.getReport(id).then((r) => {
        if (r.data) {
          selectedReport.value = r.data;
          reportImageUrl.value = api.getReportImage(r.data.id) + '?t=' + Date.now();
          selectedRowIndex.value = -1;
          editingItemId.value = null;
          const lowConfItem = r.data.items && r.data.items.find((it) => it.confidence < 80);
          if (lowConfItem) startEdit(lowConfItem, r.data.items.indexOf(lowConfItem));
        }
      });
    }
    function closeReport() { selectedReport.value = null; editingItemId.value = null; selectedRowIndex.value = -1; }
    function doImport(id) {
      if (!confirm("确认入库？")) return;
      flushEditFormToLocal();
      const pendingSave = editingItemId.value && selectedReport.value;
      if (pendingSave) {
        const item = selectedReport.value.items.find((it) => it.id === editingItemId.value);
        if (item) {
          api.updateReportItem(selectedReport.value.id, item.id, { ...editForm.value }).then(() => { editingItemId.value = null; doImportApi(id); });
          return;
        }
      }
      doImportApi(id);
    }
    function doImportApi(id) {
      api.importReport(id).then((r) => {
        if (r.code === 0) { alert("入库成功"); loadReports(); if (selectedReport.value) viewReport(selectedReport.value.id); }
        else alert(r.message);
      });
    }
    function doConfirm(id) {
      if (!confirm("确认核效？")) return;
      flushEditFormToLocal();
      const pendingSave = editingItemId.value && selectedReport.value;
      if (pendingSave) {
        const item = selectedReport.value.items.find((it) => it.id === editingItemId.value);
        if (item) {
          api.updateReportItem(selectedReport.value.id, item.id, { ...editForm.value }).then(() => { editingItemId.value = null; doConfirmApi(id); });
          return;
        }
      }
      doConfirmApi(id);
    }
    function doConfirmApi(id) {
      api.confirmReport(id).then((r) => {
        if (r.code === 0) { alert("核效成功"); loadReports(); if (selectedReport.value) viewReport(selectedReport.value.id); }
        else alert(r.message);
      });
    }
    function doReOCR(id) {
      if (!confirm("确认重新识别？现有数据将被替换。")) return;
      api.reOCR(id).then((r) => {
        if (r.code === 0) { alert("重新识别完成，请查看结果"); loadReports(); loadQuota(); }
        else alert(r.message || "重新识别失败");
      });
    }
    function loadQuota() { api.getOCRQuota().then((r) => { if (r.data) quota.value = r.data; }); }
    const quotaPct = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return 0;
      return Math.min(100, Math.round((quota.value.used_count / quota.value.total_quota) * 100));
    });
    const quotaClass = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return "font-bold text-slate-600";
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return "font-bold text-green-600";
      if (remain > 10) return "font-bold text-orange-500";
      return "font-bold text-red-600";
    });
    const quotaBarClass = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return "bg-green-500";
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return "bg-green-500";
      if (remain > 10) return "bg-orange-500";
      return "bg-red-500";
    });

    const batchDoneCount = Vue.computed(() => batchQueue.value.filter(item => item.status === 'done' || item.status === 'error').length);
    const batchPct = Vue.computed(() => {
      if (!batchQueue.value.length) return 0;
      return Math.round((batchDoneCount.value / batchQueue.value.length) * 100);
    });

    // 行内编辑
    function startEdit(item, idx) {
      if (editingItemId.value === item.id) return;
      flushEditFormToLocal();
      editingItemId.value = item.id;
      editForm.value = {
        test_item_name: item.test_item_name || "",
        original_value: item.original_value || "",
        original_unit: item.original_unit || "",
        ref_interval_text: item.ref_interval_text || item.row_notes || "",
        flag: item.flag || "",
      };
      selectedRowIndex.value = idx;
      Vue.nextTick(() => { if (editInput.value && editInput.value[0]) editInput.value[0].focus(); });
    }
    function flushEditFormToLocal() {
      if (!editingItemId.value || !selectedReport.value || !selectedReport.value.items) return;
      const item = selectedReport.value.items.find(it => it.id === editingItemId.value);
      if (!item) return;
      item.test_item_name = editForm.value.test_item_name;
      item.original_value = editForm.value.original_value;
      item.original_unit = editForm.value.original_unit;
      item.ref_interval_text = editForm.value.ref_interval_text;
      item.flag = editForm.value.flag;
    }
    function saveEdit(item) {
      flushEditFormToLocal();
      const snapshot = { ...editForm.value };
      api.updateReportItem(selectedReport.value.id, item.id, snapshot).then((r) => {
        if (r.code === 0) { editingItemId.value = null; } else { alert(r.message || "保存失败"); }
      });
    }
    function onEditBlur() {
      if (!editingItemId.value || !selectedReport.value) return;
      flushEditFormToLocal();
      const itemId = editingItemId.value;
      const reportId = selectedReport.value.id;
      const editFormSnapshot = { ...editForm.value };
      setTimeout(() => { api.updateReportItem(reportId, itemId, editFormSnapshot).catch(() => {}); }, 300);
    }
    function cancelEdit() { editingItemId.value = null; }

    function selectRow(idx) { selectedRowIndex.value = idx; updateHighlight(idx); }

    const highlightStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" };
    });
    const magnifierStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return { left: r.x + r.w + 8 + "px", top: Math.max(0, r.y - 20) + "px" };
    });

    function onImageLoad() {}
    function updateHighlight(idx) {
      if (!selectedReport.value || !selectedReport.value.items || idx < 0 || idx >= selectedReport.value.items.length) {
        highlightRect.value = null; magnifierReady.value = false; return;
      }
      const item = selectedReport.value.items[idx];
      let bbox = null;
      if (item.ocr_bbox) {
        try { bbox = typeof item.ocr_bbox === "string" ? JSON.parse(item.ocr_bbox) : item.ocr_bbox; } catch (e) { bbox = null; }
      }
      if (bbox && bbox.x != null && bbox.y != null) {
        highlightRect.value = { x: bbox.x, y: bbox.y, w: bbox.w || 100, h: bbox.h || 30 };
        Vue.nextTick(() => drawMagnifier(bbox));
      } else { highlightRect.value = null; magnifierReady.value = false; }
    }
    function drawMagnifier(bbox) {
      if (!magnifier.value || !imageEl.value) return;
      const canvas = magnifier.value[0] || magnifier.value;
      const ctx = canvas.getContext("2d");
      const img = imageEl.value[0] || imageEl.value;
      const sx = Math.max(0, bbox.x - 10), sy = Math.max(0, bbox.y - 10);
      const sw = bbox.w + 20, sh = bbox.h + 20;
      ctx.clearRect(0, 0, 120, 80);
      try { ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 80); magnifierReady.value = true; }
      catch (e) { magnifierReady.value = false; }
    }

    // 快捷键
    function onKeyDown(e) {
      if (!selectedReport.value) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") { if (e.key === " ") e.preventDefault(); return; }
      if (e.key === "Tab") { e.preventDefault(); moveToNextCell(); }
      else if (e.key === "Enter") { e.preventDefault(); saveAndJumpNext(); }
      else if (e.key === " ") { e.preventDefault(); zoomLevel.value = zoomLevel.value === 1 ? 2 : 1; }
    }
    function moveToNextCell() {
      if (!selectedReport.value || !selectedReport.value.items) return;
      const nextIdx = selectedRowIndex.value + 1;
      if (nextIdx < selectedReport.value.items.length) { const item = selectedReport.value.items[nextIdx]; startEdit(item, nextIdx); }
    }
    function saveAndJumpNext() {
      if (editingItemId.value && selectedReport.value) {
        const item = selectedReport.value.items.find((it) => it.id === editingItemId.value);
        if (item) {
          flushEditFormToLocal();
          api.updateReportItem(selectedReport.value.id, item.id, editForm.value).then((r) => {
            if (r.code === 0) {
              editingItemId.value = null;
              const items = selectedReport.value.items;
              const currentIdx = items.indexOf(item);
              for (let i = currentIdx + 1; i < items.length; i++) {
                if (items[i].confidence < 95) { startEdit(items[i], i); return; }
              }
            }
          });
        }
      }
    }

    // 映射向导
    const wizardVisible = Vue.ref(false);
    const wizardReportId = Vue.ref(null);
    const wizardHospitalId = Vue.ref(null);
    const wizardImageUrl = Vue.ref("");
    const wizardFilePath = Vue.ref("");
    function openMappingWizard(report) {
      wizardReportId.value = report.id; wizardHospitalId.value = report.hospital_id || null;
      wizardImageUrl.value = api.getReportImage(report.id); wizardFilePath.value = report.file_path || "";
      wizardVisible.value = true;
    }
    function onWizardDone({ reportId }) { wizardVisible.value = false; loadReports(); loadQuota(); viewReport(reportId); }

    // 关联项目
    function openLinkModal(item) {
      linkingItem.value = item; linkSearch.value = ''; linkSelectedId.value = null; linkCreateAlias.value = true;
      showLinkModal.value = true;
      if (!allTestItems.value.length) { api.listTestItems().then(r => { if (r.data) { allTestItems.value = r.data; filterLinkItems(); } }); }
      else filterLinkItems();
    }
    function filterLinkItems() {
      const q = linkSearch.value.toLowerCase();
      filteredLinkItems.value = allTestItems.value.filter(it => it.standard_name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q));
    }
    async function doLinkItem() {
      if (!linkSelectedId.value || !linkingItem.value) return;
      const reportId = selectedReport.value.id;
      const itemId = linkingItem.value.id;
      await api.updateReportItem(reportId, itemId, Object.assign({}, linkingItem.value, { test_item_id: linkSelectedId.value }));
      if (linkCreateAlias.value) { await api.createAlias(linkSelectedId.value, { alias_name: linkingItem.value.test_item_name, hospital_id: selectedReport.value.hospital_id || null }); }
      linkingItem.value.test_item_id = linkSelectedId.value;
      const matched = allTestItems.value.find(it => it.id === linkSelectedId.value);
      if (matched) linkingItem.value.test_item_name = matched.standard_name;
      showLinkModal.value = false;
    }

    function onCategoryChange() {
      if (!selectedReport.value) return;
      const catId = selectedReport.value.category_id;
      api.updateReport(selectedReport.value.id, { category_id: catId || 0 }).then((r) => {
        if (r.code === 0) {
          // 更新本地报告列表中的 category_name
          const cat = categories.value.find(c => c.id === catId);
          const rep = reports.value.find(r => r.id === selectedReport.value.id);
          if (rep) rep.category_name = cat ? cat.name : '';
          selectedReport.value.category_name = cat ? cat.name : '';
        }
      });
    }

    function statusClass(s) {
      return { pending: "text-slate-500", processing: "text-yellow-600", review: "text-orange-600", imported: "text-green-600", failed: "text-red-600" }[s] || "";
    }
    function statusText(s) {
      return { pending: "待识别", processing: "识别中", review: "待核效", imported: "已入库", failed: "失败" }[s] || s;
    }

    return {
      subjects, hospitals, reports, form, uploading, selectedReport, reportImageUrl, selectedRowIndex,
      editingItemId, editForm, zoomLevel, quota, quotaPct, quotaClass, quotaBarClass,
      highlightRect, highlightStyle, magnifierReady, magnifierStyle, imageEl, magnifier, editInput,
      reportListColumns, onFileChange, upload, viewReport, closeReport, doImport, doConfirm, doReOCR,
      loadQuota, startEdit, saveEdit, onEditBlur, flushEditFormToLocal, cancelEdit, selectRow,
      onImageLoad, statusClass, statusText, confClass, flagBadge, isPdf,
      wizardVisible, wizardReportId, wizardHospitalId, wizardImageUrl, wizardFilePath, openMappingWizard, onWizardDone,
      categories, showNormalizeModal, onCategoryChange,
      showLinkModal, linkingItem, linkSearch, filteredLinkItems, linkSelectedId, linkCreateAlias,
      openLinkModal, filterLinkItems, doLinkItem,
      selectedFiles, batchQueue, batchUploading, batchCurrent, batchDoneCount, batchPct, removeFile,
    };
  },
});
