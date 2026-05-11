// ocr-import.js — OCR上传与沉浸式比对视图（增强：行内编辑+确认核效+Sync-Scroll联动+快捷键+提示条+自动聚焦）
const OCRImportView = Vue.defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">检验单上传与 OCR</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-end flex-wrap">
        <div><label class="text-sm text-slate-600">受检者</label>
          <select v-model="form.subject_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{s.name}}</option>
          </select></div>
        <div><label class="text-sm text-slate-600">医院</label>
          <select v-model="form.hospital_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
          </select></div>
        <div><label class="text-sm text-slate-600">采样日期</label>
          <input v-model="form.sample_date" type="date" class="border rounded px-2 py-1 text-sm"></div>
        <div><label class="text-sm text-slate-600">文件</label>
          <input type="file" @change="onFileChange" accept="image/*,.pdf" class="text-sm"></div>
        <button @click="upload" class="px-4 py-2 bg-blue-600 text-white rounded text-sm" :disabled="uploading">{{uploading ? '上传中...' : '上传'}}</button>
      </div>
    </div>
    <div v-if="reports.length" class="bg-white rounded-lg shadow-sm p-4">
      <h2 class="font-semibold mb-3">报告列表</h2>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50 text-left text-slate-600">
          <th class="p-2">ID</th><th class="p-2">采样日期</th><th class="p-2">状态</th><th class="p-2">操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in reports" :key="r.id" class="border-t hover:bg-slate-50">
            <td class="p-2">{{r.id}}</td><td class="p-2">{{r.sample_date}}</td>
            <td class="p-2"><span :class="statusClass(r.ocr_status)">{{statusText(r.ocr_status)}}</span></td>
            <td class="p-2">
              <button @click="viewReport(r.id)" class="text-blue-600 hover:underline text-xs mr-2">查看</button>
              <button v-if="r.ocr_status==='review'" @click="openMappingWizard(r)" class="text-purple-600 hover:underline text-xs mr-2">自定义映射</button>
              <button v-if="r.ocr_status==='review'" @click="doImport(r.id)" class="text-green-600 hover:underline text-xs mr-2">入库</button>
              <button v-if="r.ocr_status!=='processing'" @click="doReOCR(r.id)" class="text-orange-600 hover:underline text-xs mr-2">重新识别</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 报告详情弹窗 -->
    <div v-if="selectedReport" class="drill-modal" @click.self="closeReport">
      <div class="w-full h-full bg-white flex flex-col drill-modal-full">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-3 border-b shrink-0">
          <h2 class="text-lg font-bold">报告详情 #{{selectedReport.id}} <span :class="statusClass(selectedReport.ocr_status)">({{statusText(selectedReport.ocr_status)}})</span></h2>
          <span class="text-xs text-slate-400">点击单元格即可编辑</span>
          <div class="flex gap-2">
            <button v-if="selectedReport.ocr_status === 'review'" @click="doConfirm(selectedReport.id)"
                    class="px-4 py-1.5 bg-orange-600 text-white rounded text-sm hover:bg-orange-700">确认核效</button>
            <button @click="closeReport" class="px-4 py-1.5 border rounded text-sm hover:bg-slate-50">关闭</button>
          </div>
        </div>

        <!-- Main content area -->
        <div class="flex-1 flex overflow-hidden min-h-0">
          <!-- Left: file preview -->
          <div class="w-[45%] relative overflow-auto" ref="imageContainer">
            <img :src="reportImageUrl" ref="imageEl" v-if="reportImageUrl && !isPdf"
                 :style="zoomLevel > 1 ? { width: 'auto', maxWidth: 'none' } : { maxWidth: '100%' }"
                 class="border" @load="onImageLoad">
            <embed :src="reportImageUrl" v-if="reportImageUrl && isPdf"
                   type="application/pdf" class="w-full border-0" style="height: 100%; min-height: 100%;">
            <div v-if="highlightRect && !isPdf" class="highlight-breathe absolute pointer-events-none border-2 border-blue-500 rounded"
                 :style="highlightStyle"></div>
            <canvas v-if="highlightRect && magnifierReady && !isPdf" ref="magnifier"
                    class="absolute pointer-events-none border-2 border-blue-400 rounded shadow-lg"
                    :style="magnifierStyle" width="120" height="80"></canvas>
          </div>

          <!-- Right: data table -->
          <div class="w-[55%] overflow-auto border-l">
            <table class="w-full text-sm">
              <thead><tr class="bg-slate-50 text-left text-slate-600 sticky top-0">
                <th class="p-2">项目</th><th class="p-2">结果</th><th class="p-2">参考区间</th><th class="p-2">单位</th><th class="p-2">提示符</th>
              </tr></thead>
              <tbody>
                <tr v-for="(it, idx) in selectedReport.items" :key="it.id"
                    class="border-t hover:bg-slate-50"
                    :class="{ 'bg-blue-50': selectedRowIndex === idx }"
                    @click="selectRow(idx)">
                  <td class="p-2 font-medium cursor-text group relative"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.test_item_name"
                           class="border rounded px-1 py-0.5 text-sm w-full" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" ref="editInput" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.test_item_name || '-'}}</span>
                      <button v-if="!it.test_item_id && it.test_item_name"
                              @click.stop="openLinkModal(it)"
                              class="text-[10px] text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 py-0 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100">关联</button>
                      <span class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400">✎</span>
                    </div>
                  </td>
                  <td class="p-2 cursor-text group relative" :class="confClass(it.confidence)"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.original_value"
                           class="border rounded px-1 py-0.5 text-sm w-20" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.original_value}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400">✎</span>
                    </div>
                  </td>
                  <td class="p-2 text-slate-500 cursor-text group relative"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.ref_interval_text"
                           class="border rounded px-1 py-0.5 text-sm w-20" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.ref_interval_text || it.row_notes || '-'}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400">✎</span>
                    </div>
                  </td>
                  <td class="p-2 cursor-text group relative"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.original_unit"
                           class="border rounded px-1 py-0.5 text-sm w-16" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span>{{it.original_unit}}</span>
                      <span class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400">✎</span>
                    </div>
                  </td>
                  <td class="p-2 cursor-text group relative"
                      @click.stop="startEdit(it, idx)">
                    <input v-if="editingItemId === it.id" v-model="editForm.flag"
                           class="border rounded px-1 py-0.5 text-sm w-12" @keydown.enter="saveEdit(it)"
                           @keydown.escape="cancelEdit" @blur="onEditBlur" autofocus>
                    <div v-else class="flex items-center gap-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 px-1 transition-all">
                      <span v-html="flagBadge(it.flag)"></span>
                      <span class="opacity-0 group-hover:opacity-100 text-[10px] text-blue-400">✎</span>
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
    <div class="fixed bottom-3 left-3 z-50 bg-white border rounded-lg shadow-md px-4 py-2 text-xs flex items-center gap-3"
         v-if="quota">
      <span class="font-medium text-slate-600">本月 OCR</span>
      <span :class="quotaClass">{{quota.used_count}}/{{quota.total_quota}}</span>
      <div class="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all" :class="quotaBarClass" :style="{width: quotaPct + '%'}"></div>
      </div>
      <span class="text-slate-400">成功{{quota.success_count}} 失败{{quota.fail_count}}</span>
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
    <div v-if="showLinkModal" class="drill-modal" @click.self="showLinkModal=false"><div class="w-[420px]">
      <h2 class="text-lg font-bold mb-3">关联标准项目</h2>
      <div class="bg-slate-50 rounded p-3 mb-3">
        <span class="text-sm text-slate-500">OCR 识别名：</span>
        <span class="font-medium">{{linkingItem.test_item_name}}</span>
      </div>
      <div class="mb-3">
        <label class="text-sm text-slate-600 mb-1 block">选择标准项目</label>
        <input v-model="linkSearch" placeholder="输入关键字搜索..."
               class="w-full border rounded px-2 py-1.5 text-sm mb-1" @input="filterLinkItems">
        <div class="border rounded max-h-48 overflow-auto">
          <div v-for="it in filteredLinkItems" :key="it.id"
               class="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50"
               :class="{'bg-blue-100': linkSelectedId === it.id}"
               @click="linkSelectedId = it.id">
            {{it.standard_name}} <span class="text-slate-400 text-xs ml-2">{{it.category}}</span>
          </div>
          <div v-if="!filteredLinkItems.length" class="p-3 text-slate-400 text-center text-sm">无匹配项目</div>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm mb-4 cursor-pointer">
        <input type="checkbox" v-model="linkCreateAlias" class="rounded">
        同时创建别名（今后该 OCR 名称自动匹配）
      </label>
      <div class="flex gap-2 justify-end">
        <button @click="showLinkModal=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="doLinkItem" :disabled="!linkSelectedId"
                class="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">关联</button>
      </div>
    </div></div>
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
      if (!selectedReport.value || !selectedReport.value.file_path)
        return false;
      return selectedReport.value.file_path.toLowerCase().endsWith(".pdf");
    });
    const zoomLevel = Vue.ref(1);
    const quota = Vue.ref(null);
    const highlightRect = Vue.ref(null);
    const magnifierReady = Vue.ref(false);
    const imageEl = Vue.ref(null);
    const magnifier = Vue.ref(null);
    const editInput = Vue.ref(null);
    let selectedFile = null;

    // 关联项目
    const showLinkModal = Vue.ref(false);
    const linkingItem = Vue.ref(null);
    const linkSearch = Vue.ref('');
    const allTestItems = Vue.ref([]);
    const filteredLinkItems = Vue.ref([]);
    const linkSelectedId = Vue.ref(null);
    const linkCreateAlias = Vue.ref(true);

    // 全局受检者联动
    const currentSubjectId = Vue.inject("currentSubjectId", null);

    Vue.onMounted(() => {
      api.listSubjects().then((r) => {
        if (r.data) subjects.value = r.data;
      });
      api.listHospitals().then((r) => {
        if (r.data) hospitals.value = r.data;
      });
      loadReports();
      loadQuota();
      document.addEventListener("keydown", onKeyDown);
    });

    Vue.onUnmounted(() => {
      document.removeEventListener("keydown", onKeyDown);
    });

    // 受检者联动
    if (currentSubjectId) {
      Vue.watch(currentSubjectId, (id) => {
        if (id) form.value.subject_id = id;
      });
    }

    function loadReports() {
      api.listReports({ ocr_status: "" }).then((r) => {
        if (r.data) reports.value = r.data;
      });
    }
    function onFileChange(e) {
      selectedFile = e.target.files[0];
    }
    function upload() {
      if (!selectedFile || !form.value.subject_id)
        return alert("请选择文件和受检者");
      uploading.value = true;
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("subject_id", form.value.subject_id);
      fd.append("hospital_id", form.value.hospital_id);
      fd.append("sample_date", form.value.sample_date);
      api.ocrUpload(fd).then((r) => {
        uploading.value = false;
        if (r.code === 0) {
          alert("上传成功，OCR识别中");
          loadReports();
        } else alert(r.message);
      });
    }
    function viewReport(id) {
      api.getReport(id).then((r) => {
        if (r.data) {
          selectedReport.value = r.data;
          reportImageUrl.value = api.getReportImage(r.data.id) + '?t=' + Date.now();
          selectedRowIndex.value = -1;
          editingItemId.value = null;
          // 低置信度自动聚焦
          const lowConfItem =
            r.data.items && r.data.items.find((it) => it.confidence < 80);
          if (lowConfItem) {
            startEdit(lowConfItem, r.data.items.indexOf(lowConfItem));
          }
        }
      });
    }
    function closeReport() {
      selectedReport.value = null;
      editingItemId.value = null;
      selectedRowIndex.value = -1;
    }
    function doImport(id) {
      if (!confirm("确认入库？")) return;
      // 先保存当前正在编辑的数据
      flushEditFormToLocal();
      const pendingSave = editingItemId.value && selectedReport.value;
      if (pendingSave) {
        const item = selectedReport.value.items.find((it) => it.id === editingItemId.value);
        if (item) {
          const snapshot = { ...editForm.value };
          api.updateReportItem(selectedReport.value.id, item.id, snapshot).then(() => {
            editingItemId.value = null;
            doImportApi(id);
          });
          return;
        }
      }
      doImportApi(id);
    }
    function doImportApi(id) {
      api.importReport(id).then((r) => {
        if (r.code === 0) {
          alert("入库成功");
          loadReports();
          // 重新加载报告详情以反映后端修改（匹配test_item_id、计算flag等）
          if (selectedReport.value) {
            viewReport(selectedReport.value.id);
          }
        } else alert(r.message);
      });
    }
    function doConfirm(id) {
      if (!confirm("确认核效？")) return;
      // 先保存当前正在编辑的数据
      flushEditFormToLocal();
      const pendingSave = editingItemId.value && selectedReport.value;
      if (pendingSave) {
        const item = selectedReport.value.items.find((it) => it.id === editingItemId.value);
        if (item) {
          const snapshot = { ...editForm.value };
          api.updateReportItem(selectedReport.value.id, item.id, snapshot).then(() => {
            editingItemId.value = null;
            doConfirmApi(id);
          });
          return;
        }
      }
      doConfirmApi(id);
    }
    function doConfirmApi(id) {
      api.confirmReport(id).then((r) => {
        if (r.code === 0) {
          alert("核效成功");
          loadReports();
          // 重新加载报告详情以反映后端修改
          if (selectedReport.value) {
            viewReport(selectedReport.value.id);
          }
        } else alert(r.message);
      });
    }
    function doReOCR(id) {
      if (!confirm("确认重新识别？现有数据将被替换。")) return;
      api.reOCR(id).then((r) => {
        if (r.code === 0) {
          alert("重新识别完成，请查看结果");
          loadReports();
          loadQuota();
        } else {
          alert(r.message || "重新识别失败");
        }
      });
    }
    function loadQuota() {
      api.getOCRQuota().then((r) => {
        if (r.data) quota.value = r.data;
      });
    }
    const quotaPct = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return 0;
      return Math.min(
        100,
        Math.round((quota.value.used_count / quota.value.total_quota) * 100),
      );
    });
    const quotaClass = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0)
        return "font-bold text-slate-600";
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

    // 行内编辑
    function startEdit(item, idx) {
      // 如果正在编辑同一行，不重复触发
      if (editingItemId.value === item.id) return;
      // 先将当前编辑的数据本地写回（不调API），避免blur时editForm已被覆盖
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
      Vue.nextTick(() => {
        if (editInput.value && editInput.value[0]) editInput.value[0].focus();
      });
    }
    // 将 editForm 中的数据写回到 selectedReport.items 的当前编辑行（本地更新，不调API）
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
      // 先本地写回
      flushEditFormToLocal();
      // 快照当前editForm，避免异步回调时editForm已被覆盖
      const snapshot = { ...editForm.value };
      api
        .updateReportItem(selectedReport.value.id, item.id, snapshot)
        .then((r) => {
          if (r.code === 0) {
            editingItemId.value = null;
          } else {
            alert(r.message || "保存失败");
          }
        });
    }
    function saveEditQuiet(item) {
      flushEditFormToLocal();
      const snapshot = { ...editForm.value };
      api
        .updateReportItem(selectedReport.value.id, item.id, snapshot)
        .then(() => { editingItemId.value = null; });
    }
    // blur时的处理：本地写回 + 异步保存到API（不重新加载整个报告）
    function onEditBlur() {
      if (!editingItemId.value || !selectedReport.value) return;
      flushEditFormToLocal();
      const itemId = editingItemId.value;
      const reportId = selectedReport.value.id;
      // 快照当前editForm，避免延迟回调时editForm已被下一行覆盖
      const editFormSnapshot = { ...editForm.value };
      // 每行独立延迟保存，不取消前一个行的保存
      setTimeout(() => {
        api.updateReportItem(reportId, itemId, editFormSnapshot).catch(() => {});
      }, 300);
    }
    function cancelEdit() {
      editingItemId.value = null;
    }

    // 行选中联动
    function selectRow(idx) {
      selectedRowIndex.value = idx;
      updateHighlight(idx);
    }

    // 高亮框
    const highlightStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return {
        left: r.x + "px",
        top: r.y + "px",
        width: r.w + "px",
        height: r.h + "px",
      };
    });
    const magnifierStyle = Vue.computed(() => {
      if (!highlightRect.value) return {};
      const r = highlightRect.value;
      return { left: r.x + r.w + 8 + "px", top: Math.max(0, r.y - 20) + "px" };
    });

    function onImageLoad() {}
    function updateHighlight(idx) {
      if (
        !selectedReport.value ||
        !selectedReport.value.items ||
        idx < 0 ||
        idx >= selectedReport.value.items.length
      ) {
        highlightRect.value = null;
        magnifierReady.value = false;
        return;
      }
      const item = selectedReport.value.items[idx];
      let bbox = null;
      if (item.ocr_bbox) {
        try {
          bbox =
            typeof item.ocr_bbox === "string"
              ? JSON.parse(item.ocr_bbox)
              : item.ocr_bbox;
        } catch (e) {
          bbox = null;
        }
      }
      if (bbox && bbox.x != null && bbox.y != null) {
        highlightRect.value = {
          x: bbox.x,
          y: bbox.y,
          w: bbox.w || 100,
          h: bbox.h || 30,
        };
        Vue.nextTick(() => drawMagnifier(bbox));
      } else {
        highlightRect.value = null;
        magnifierReady.value = false;
      }
    }
    function drawMagnifier(bbox) {
      if (!magnifier.value || !imageEl.value) return;
      const canvas = magnifier.value[0] || magnifier.value;
      const ctx = canvas.getContext("2d");
      const img = imageEl.value[0] || imageEl.value;
      const sx = Math.max(0, bbox.x - 10);
      const sy = Math.max(0, bbox.y - 10);
      const sw = bbox.w + 20;
      const sh = bbox.h + 20;
      ctx.clearRect(0, 0, 120, 80);
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 80);
        magnifierReady.value = true;
      } catch (e) {
        magnifierReady.value = false;
      }
    }

    // 快捷键
    function onKeyDown(e) {
      if (!selectedReport.value) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === " ") e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        moveToNextCell();
      } else if (e.key === "Enter") {
        e.preventDefault();
        saveAndJumpNext();
      } else if (e.key === " ") {
        e.preventDefault();
        zoomLevel.value = zoomLevel.value === 1 ? 2 : 1;
      }
    }
    function moveToNextCell() {
      if (!selectedReport.value || !selectedReport.value.items) return;
      const nextIdx = selectedRowIndex.value + 1;
      if (nextIdx < selectedReport.value.items.length) {
        const item = selectedReport.value.items[nextIdx];
        startEdit(item, nextIdx);
      }
    }
    function saveAndJumpNext() {
      if (editingItemId.value && selectedReport.value) {
        const item = selectedReport.value.items.find(
          (it) => it.id === editingItemId.value,
        );
        if (item) {
          flushEditFormToLocal();
          api
            .updateReportItem(selectedReport.value.id, item.id, editForm.value)
            .then((r) => {
              if (r.code === 0) {
                editingItemId.value = null;
                // 跳转下一个异常行
                const items = selectedReport.value.items;
                const currentIdx = items.indexOf(item);
                for (let i = currentIdx + 1; i < items.length; i++) {
                  if (items[i].confidence < 95) {
                    startEdit(items[i], i);
                    return;
                  }
                }
              }
            });
        }
      }
    }

    // ── 自定义映射向导 ──────────────────────────────────
    const wizardVisible = Vue.ref(false);
    const wizardReportId = Vue.ref(null);
    const wizardHospitalId = Vue.ref(null);
    const wizardImageUrl = Vue.ref("");
    const wizardFilePath = Vue.ref("");

    function openMappingWizard(report) {
      wizardReportId.value = report.id;
      wizardHospitalId.value = report.hospital_id || null;
      wizardImageUrl.value = api.getReportImage(report.id);
      wizardFilePath.value = report.file_path || "";
      wizardVisible.value = true;
    }

    function onWizardDone({ reportId }) {
      wizardVisible.value = false;
      loadReports();
      loadQuota();
      viewReport(reportId);
    }

    // 关联项目
    function openLinkModal(item) {
      linkingItem.value = item;
      linkSearch.value = '';
      linkSelectedId.value = null;
      linkCreateAlias.value = true;
      showLinkModal.value = true;
      if (!allTestItems.value.length) {
        api.listTestItems().then(r => { if (r.data) { allTestItems.value = r.data; filterLinkItems(); } });
      } else {
        filterLinkItems();
      }
    }
    function filterLinkItems() {
      const q = linkSearch.value.toLowerCase();
      filteredLinkItems.value = allTestItems.value.filter(it =>
        it.standard_name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q)
      );
    }
    async function doLinkItem() {
      if (!linkSelectedId.value || !linkingItem.value) return;
      const reportId = selectedReport.value.id;
      const itemId = linkingItem.value.id;
      // 1. 更新 report_item 的 test_item_id
      const snapshot = Object.assign({}, linkingItem.value, { test_item_id: linkSelectedId.value });
      await api.updateReportItem(reportId, itemId, snapshot);
      // 2. 可选：创建别名
      if (linkCreateAlias.value) {
        const hospitalId = selectedReport.value.hospital_id || null;
        await api.createAlias(linkSelectedId.value, { alias_name: linkingItem.value.test_item_name, hospital_id: hospitalId });
      }
      // 3. 本地刷新
      linkingItem.value.test_item_id = linkSelectedId.value;
      const matched = allTestItems.value.find(it => it.id === linkSelectedId.value);
      if (matched) linkingItem.value.test_item_name = matched.standard_name;
      showLinkModal.value = false;
    }

    function statusClass(s) {
      return (
        {
          pending: "text-slate-500",
          processing: "text-yellow-600",
          review: "text-orange-600",
          imported: "text-green-600",
          failed: "text-red-600",
        }[s] || ""
      );
    }
    function statusText(s) {
      return (
        {
          pending: "待识别",
          processing: "识别中",
          review: "待核效",
          imported: "已入库",
          failed: "失败",
        }[s] || s
      );
    }

    return {
      subjects,
      hospitals,
      reports,
      form,
      uploading,
      selectedReport,
      reportImageUrl,
      selectedRowIndex,
      editingItemId,
      editForm,
      zoomLevel,
      quota,
      quotaPct,
      quotaClass,
      quotaBarClass,
      highlightRect,
      highlightStyle,
      magnifierReady,
      magnifierStyle,
      imageEl,
      magnifier,
      editInput,
      onFileChange,
      upload,
      viewReport,
      closeReport,
      doImport,
      doConfirm,
      doReOCR,
      loadQuota,
      startEdit,
      saveEdit,
      saveEditQuiet,
      onEditBlur,
      flushEditFormToLocal,
      cancelEdit,
      selectRow,
      onImageLoad,
      statusClass,
      statusText,
      confClass,
      flagBadge,
      isPdf,
      wizardVisible,
      wizardReportId,
      wizardHospitalId,
      wizardImageUrl,
      wizardFilePath,
      openMappingWizard,
      onWizardDone,
      showLinkModal,
      linkingItem,
      linkSearch,
      filteredLinkItems,
      linkSelectedId,
      linkCreateAlias,
      openLinkModal,
      filterLinkItems,
      doLinkItem,
    };
  },
});
