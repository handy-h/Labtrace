// batch_import_imaging.js - 影像报告批量导入视图
const BatchImportImagingView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">批量导入影像报告</h1>
    <div class="card">
      <!-- Step 1: 基本信息 -->
      <div v-if="step === 1">
        <h3 class="text-lg font-medium mb-4">步骤 1: 选择受检者和医院</h3>
        <div class="form-row mb-4">
          <div class="form-group">
            <label class="form-label">受检者</label>
            <select v-model="form.subject_id" class="form-select" style="width: 200px">
              <option value="">请选择</option>
              <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">医院</label>
            <select v-model="form.hospital_id" class="form-select" style="width: 200px">
              <option value="">请选择</option>
              <option v-for="h in hospitals" :key="h.id" :value="h.id">{{ h.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">影像报告类型</label>
            <select v-model="form.report_type" class="form-select" style="width: 200px">
              <option value="">请选择</option>
              <option v-for="t in imagingTypes" :key="t.id" :value="t.code">{{ t.name }}</option>
            </select>
          </div>
        </div>
        <button @click="step = 2" class="btn btn-primary" :disabled="!form.subject_id">下一步</button>
      </div>

      <!-- Step 2: 上传文件 -->
      <div v-if="step === 2">
        <h3 class="text-lg font-medium mb-4">步骤 2: 上传文件</h3>
        <p class="text-sm text-gray-600 mb-4">请上传JSON和PDF文件，文件名将自动匹配</p>
        <div class="form-row mb-4">
          <div class="form-group">
            <label class="form-label">JSON文件</label>
            <input type="file" @change="onJsonFileChange" accept=".json" multiple class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">PDF文件</label>
            <input type="file" @change="onPdfFileChange" accept=".pdf" multiple class="form-input" />
          </div>
        </div>
        <div v-if="filePairs.length" class="mb-4">
          <h4 class="font-medium mb-2">已匹配的文件</h4>
          <div class="max-h-32 overflow-y-auto border rounded p-2">
            <div v-for="(p, i) in filePairs" :key="i" class="flex items-center gap-2 py-1">
              <span class="text-green-600">✓</span>
              <span>{{ p.name }}</span>
            </div>
          </div>
        </div>
        <div v-if="uploadErrors.length" class="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <h4 class="font-medium text-red-800 mb-2">警告</h4>
          <ul class="text-sm text-red-700">
            <li v-for="(e, i) in uploadErrors" :key="i">{{ e }}</li>
          </ul>
        </div>
        <div class="flex gap-2">
          <button @click="step = 1" class="btn btn-secondary">上一步</button>
          <button @click="uploadFiles" class="btn btn-primary" :disabled="!filePairs.length || uploading">
            {{ uploading ? '上传中...' : '上传文件' }}
          </button>
        </div>
      </div>

      <!-- Step 3: 字段映射 -->
      <div v-if="step === 3">
        <h3 class="text-lg font-medium mb-4">步骤 3: 配置字段映射</h3>
        <div class="flex gap-4 mb-4">
          <div class="flex-1 p-3 border rounded flex flex-col">
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-medium">示例JSON数据</h4>
              <div v-if="previewData.length > 1" class="flex gap-1">
                <button v-for="(r, i) in previewData" :key="i"
                  @click="selectedFileIndex = i"
                  :class="['px-2 py-0.5 text-xs rounded border', selectedFileIndex === i ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50']">
                  {{ r.file_name }}
                </button>
              </div>
            </div>
            <div class="overflow-y-auto bg-gray-50 rounded flex-1">
              <pre class="text-xs p-2" style="white-space: pre-wrap; word-break: break-word; max-width: 100%;">{{ formatJSON(selectedReport?.data) }}</pre>
            </div>
          </div>
          <div class="flex-1 p-3 border rounded">
            <h4 class="font-medium mb-2">字段映射</h4>
            <div class="space-y-2">
              <div class="form-group">
                <label class="form-label">采样日期</label>
                <input v-model="mappings.sample_date" class="form-input" placeholder="如: sample_date" />
              </div>
              <div class="form-group">
                <label class="form-label">检查项目名称</label>
                <input v-model="mappings.exam_item_name" class="form-input" placeholder="如: exam_item_name · checkItem" />
              </div>
              <div class="form-group">
                <label class="form-label">检查部位</label>
                <input v-model="mappings.exam_site" class="form-input" placeholder="如: items[0].bodyPart · exam_site" />
              </div>
              <div class="form-group">
                <label class="form-label">检查所见 <span class="text-gray-400 text-xs">(长文本)</span></label>
                <input v-model="mappings.exam_description" class="form-input" placeholder="如: items[0].findings · exam_description" />
              </div>
              <div class="form-group">
                <label class="form-label">诊断结果 <span class="text-gray-400 text-xs">(长文本)</span></label>
                <input v-model="mappings.diagnosis_result" class="form-input" placeholder="如: diagnosis_result · impression" />
              </div>
              <div class="form-group">
                <label class="form-label">检查号</label>
                <input v-model="mappings.inspect_no" class="form-input" placeholder="如: inspect_no · accessionNumber" />
              </div>
            </div>
          </div>
        </div>
        <div class="mb-4">
          <h4 class="font-medium mb-2">预览</h4>
          <div class="border rounded p-3">
            <table class="w-full text-sm">
              <tbody>
                <tr class="border-b"><td class="py-1.5 pr-3 text-gray-500 w-28">检查项目</td><td class="py-1.5 font-medium">{{ previewValues.exam_item_name || '-' }}</td></tr>
                <tr class="border-b"><td class="py-1.5 pr-3 text-gray-500">检查部位</td><td class="py-1.5">{{ previewValues.exam_site || '-' }}</td></tr>
                <tr class="border-b"><td class="py-1.5 pr-3 text-gray-500">检查号</td><td class="py-1.5">{{ previewValues.inspect_no || '-' }}</td></tr>
                <tr class="border-b"><td class="py-1.5 pr-3 text-gray-500">采样日期</td><td class="py-1.5">{{ previewValues.sample_date || '-' }}</td></tr>
              </tbody>
            </table>
            <div class="mt-3 pt-3 border-t">
              <div class="text-xs text-gray-500 mb-1">检查所见</div>
              <div class="text-sm bg-gray-50 p-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap">{{ previewValues.exam_description || '-' }}</div>
            </div>
            <div class="mt-3">
              <div class="text-xs text-gray-500 mb-1">诊断结果</div>
              <div class="text-sm bg-gray-50 p-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap">{{ previewValues.diagnosis_result || '-' }}</div>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="step = 2" class="btn btn-secondary">上一步</button>
          <button @click="step = 4" class="btn btn-primary">下一步</button>
        </div>
      </div>

      <!-- Step 4: 确认导入 -->
      <div v-if="step === 4">
        <h3 class="text-lg font-medium mb-4">步骤 4: 确认导入</h3>
        <div v-if="hasEmptyDates" class="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          ⚠️ 有报告未提取到采样日期，请手动填写或查看原始JSON/PDF确认后再提交。
        </div>
        <div class="mb-4">
          <h4 class="font-medium mb-2">待导入报告</h4>
          <div class="max-h-48 overflow-y-auto border rounded">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left">文件名</th>
                  <th class="px-3 py-2 text-left">采样日期</th>
                  <th class="px-3 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewData" :key="i" class="border-t hover:bg-gray-50">
                  <td class="px-3 py-2">{{ r.file_name }}</td>
                  <td class="px-3 py-2">
                    <input type="date" v-model="r.sample_date" class="form-input" style="width:130px"
                      :class="!r.sample_date ? 'border-red-400 bg-red-50' : ''" />
                  </td>
                  <td class="px-3 py-2 text-center">
                    <div class="flex gap-1 justify-center">
                      <button @click="showJsonModal(r)" class="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200">JSON</button>
                      <button @click="viewPdf(r)" class="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 border border-green-200">PDF</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="step = 3" class="btn btn-secondary">上一步</button>
          <button @click="confirmImport" class="btn btn-primary" :disabled="importing || hasEmptyDates">
            {{ importing ? '导入中...' : '确认导入' }}
          </button>
        </div>
      </div>

      <!-- JSON 查看弹窗 -->
      <div v-if="jsonModalVisible" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="jsonModalVisible = false">
        <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between p-4 border-b">
            <h4 class="font-medium">{{ jsonModalData?.file_name }} - JSON数据</h4>
            <button @click="jsonModalVisible = false" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>
          <div class="overflow-y-auto flex-1 p-4">
            <pre class="text-xs bg-gray-50 p-3 rounded whitespace-pre-wrap">{{ formatJSON(jsonModalData?.data) }}</pre>
          </div>
        </div>
      </div>

      <!-- 完成 -->
      <div v-if="step === 5">
        <h3 class="text-lg font-medium mb-4 text-green-700">导入完成!</h3>
        <div class="mb-4">
          <p class="text-green-600 font-medium">成功: {{ importResult.success_count }} 份</p>
          <p v-if="importResult.fail_count" class="text-red-600 font-medium">失败: {{ importResult.fail_count }} 份</p>
        </div>
        <div v-if="importResult.errors?.length" class="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <h4 class="font-medium text-red-800 mb-2">错误信息</h4>
          <ul class="text-sm text-red-700">
            <li v-for="(e, i) in importResult.errors" :key="i">{{ e }}</li>
          </ul>
        </div>
        <div class="flex gap-2">
          <button @click="reset" class="btn btn-primary">继续导入</button>
          <button @click="goToReports" class="btn btn-secondary">查看报告</button>
        </div>
      </div>
    </div>
  </div>
  `,
  setup() {
    const step = Vue.ref(1);
    const subjects = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const imagingTypes = Vue.ref([]);
    const form = Vue.ref({ subject_id: '', hospital_id: '', report_type: '' });

    const jsonFiles = Vue.ref([]);
    const pdfFiles = Vue.ref([]);
    const filePairs = Vue.ref([]);
    const uploadErrors = Vue.ref([]);
    const previewData = Vue.ref([]);
    const pdfDataMap = Vue.ref({});
    const uploading = Vue.ref(false);
    const importing = Vue.ref(false);
    const importResult = Vue.ref({ success_count: 0, fail_count: 0 });
    const selectedFileIndex = Vue.ref(0);
    const jsonModalVisible = Vue.ref(false);
    const jsonModalData = Vue.ref(null);

    const mappings = Vue.ref({
      sample_date: '',
      exam_item_name: '',
      exam_site: '',
      exam_description: '',
      diagnosis_result: '',
      inspect_no: ''
    });

    const selectedReport = Vue.computed(() => {
      return previewData.value[selectedFileIndex.value] || null;
    });

    const previewValues = Vue.computed(() => {
      const r = selectedReport.value;
      if (!r || !r.data) return {};
      return {
        sample_date: parseDateForInput(getNestedValue(r.data, mappings.value.sample_date)),
        exam_item_name: getNestedValue(r.data, mappings.value.exam_item_name),
        exam_site: getNestedValue(r.data, mappings.value.exam_site),
        exam_description: getNestedValue(r.data, mappings.value.exam_description),
        diagnosis_result: getNestedValue(r.data, mappings.value.diagnosis_result),
        inspect_no: getNestedValue(r.data, mappings.value.inspect_no),
      };
    });

    // 检查是否有报告缺少采样日期
    const hasEmptyDates = Vue.computed(() => {
      return previewData.value.some(r => !r.sample_date);
    });

    // 监听采样日期映射变化，同步更新所有报告的 sample_date
    Vue.watch(
      () => mappings.value.sample_date,
      (newPath) => {
        for (const report of previewData.value) {
          report.sample_date = parseDateForInput(getNestedValue(report.data, newPath)) || '';
        }
      },
      { deep: true }
    );

    Vue.onMounted(() => {
      api.listSubjects().then(r => subjects.value = r.data || []);
      api.listHospitals().then(r => hospitals.value = r.data || []);
      api.listImagingReportTypes().then(r => imagingTypes.value = r.data || []);
    });

    function onJsonFileChange(e) {
      const files = Array.from(e.target.files);
      jsonFiles.value = files;
      matchFiles();
    }

    function onPdfFileChange(e) {
      const files = Array.from(e.target.files);
      pdfFiles.value = files;
      matchFiles();
    }

    function matchFiles() {
      const jsonMap = {};
      const pdfMap = {};
      for (const f of jsonFiles.value) jsonMap[getBaseName(f.name)] = f;
      for (const f of pdfFiles.value) pdfMap[getBaseName(f.name)] = f;

      filePairs.value = [];
      uploadErrors.value = [];
      const allNames = new Set([...Object.keys(jsonMap), ...Object.keys(pdfMap)]);

      for (const name of allNames) {
        if (jsonMap[name] && pdfMap[name]) {
          filePairs.value.push({ name, json: jsonMap[name], pdf: pdfMap[name] });
        } else if (jsonMap[name]) {
          uploadErrors.value.push(`${name}: 缺少对应的PDF`);
        } else {
          uploadErrors.value.push(`${name}: 缺少对应的JSON`);
        }
      }
    }

    function getBaseName(n) {
      const idx = n.lastIndexOf('.');
      return idx > 0 ? n.substring(0, idx) : n;
    }

    function parseDateForInput(raw) {
      if (!raw) return '';
      const datePart = String(raw).split(/\s+/)[0];
      return datePart.replace(/[\/.]/g, '-');
    }

    async function uploadFiles() {
      uploading.value = true;
      try {
        const fd = new FormData();
        for (const p of filePairs.value) {
          fd.append('json_files', p.json);
          fd.append('pdf_files', p.pdf);
        }
        const r = await api.uploadBatchImagingFiles(fd);
        if (r.code !== 0) { alert(r.message); return; }
        previewData.value = r.data.results;
        uploadErrors.value = r.data.errors;

        for (const report of previewData.value) {
          const fp = filePairs.value.find(p => p.name === report.file_name);
          if (fp) pdfDataMap.value[report.file_name] = await readFileAsBase64(fp.pdf);
          report.sample_date = parseDateForInput(getNestedValue(report.data, mappings.value.sample_date)) || '';
        }

        step.value = 3;
      } catch (err) { alert('上传失败: ' + (err.message || err)); }
      finally { uploading.value = false; }
    }

    async function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function formatJSON(data) {
      return JSON.stringify(data, null, 2);
    }

    function getNestedValue(data, path) {
      if (!path || !data) return '';
      const parts = path.split('.');
      let curr = data;
      for (const p of parts) {
        // 支持数组索引: key[N]
        const m = p.match(/^(\w+)\[(\d+)\]$/);
        if (m) {
          const key = m[1];
          const index = parseInt(m[2], 10);
          if (curr && typeof curr === 'object' && key in curr) {
            const arr = curr[key];
            if (Array.isArray(arr) && index >= 0 && index < arr.length) {
              curr = arr[index];
              continue;
            }
          }
          return '';
        }
        if (curr && typeof curr === 'object' && p in curr) curr = curr[p];
        else return '';
      }
      return curr !== undefined ? String(curr) : '';
    }

    async function confirmImport() {
      if (!confirm(`确认导入 ${previewData.value.length} 份影像报告?`)) return;
      importing.value = true;
      try {
        const reports = previewData.value.map(r => ({
          file_name: r.file_name,
          data: r.data,
          pdf_data: pdfDataMap.value[r.file_name],
          sample_date: r.sample_date || ''
        }));

        const r = await api.confirmBatchImagingImport({
          subject_id: parseInt(form.value.subject_id),
          hospital_id: form.value.hospital_id ? parseInt(form.value.hospital_id) : null,
          report_type: form.value.report_type,
          mappings: mappings.value,
          reports
        });

        if (r.code !== 0) { alert(r.message); return; }
        importResult.value = r.data;
        step.value = 5;
      } catch (err) { alert('导入失败: ' + (err.message || err)); }
      finally { importing.value = false; }
    }

    function reset() {
      step.value = 1;
      form.value = { subject_id: '', hospital_id: '', report_type: '' };
      jsonFiles.value = [];
      pdfFiles.value = [];
      filePairs.value = [];
      uploadErrors.value = [];
      previewData.value = [];
      pdfDataMap.value = {};
      importResult.value = { success_count: 0, fail_count: 0 };
      selectedFileIndex.value = 0;
    }

    function goToReports() {
      window.location.hash = 'reports';
    }

    function showJsonModal(report) {
      jsonModalData.value = report;
      jsonModalVisible.value = true;
    }

    function viewPdf(report) {
      const base64 = pdfDataMap.value[report.file_name];
      if (!base64) { alert('PDF数据未找到'); return; }
      const raw = base64.includes(',') ? base64.split(',')[1] : base64;
      const blob = new Blob([Uint8Array.from(atob(raw), c => c.charCodeAt(0))], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }

    return {
      step, subjects, hospitals, imagingTypes, form,
      filePairs, uploadErrors, previewData, previewValues, selectedReport,
      uploading, importing, importResult, mappings,
      selectedFileIndex, jsonModalVisible, jsonModalData, hasEmptyDates,
      onJsonFileChange, onPdfFileChange, uploadFiles,
      confirmImport, reset, goToReports, formatJSON,
      showJsonModal, viewPdf
    };
  }
});
