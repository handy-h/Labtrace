// batch_import.js - 批量导入视图
const BatchImportView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">批量导入报告</h1>
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
            <label class="form-label">检验分类</label>
            <select v-model="form.category_id" class="form-select" style="width: 200px">
              <option value="">未分类</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
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
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="p-3 border rounded">
            <h4 class="font-medium mb-2">示例JSON数据</h4>
            <pre class="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-64">{{ formatJSON(previewData[0]?.data) }}</pre>
          </div>
          <div class="p-3 border rounded">
            <h4 class="font-medium mb-2">字段映射</h4>
            <div class="space-y-2">
              <div class="form-group">
                <label class="form-label">采样日期</label>
                <input v-model="mappings.sample_date" class="form-input" placeholder="如: sample_date" />
              </div>
              <div class="form-group">
                <label class="form-label">检验项目名称</label>
                <input v-model="mappings.item_name" class="form-input" placeholder="如: name" />
              </div>
              <div class="form-group">
                <label class="form-label">结果值</label>
                <input v-model="mappings.item_value" class="form-input" placeholder="如: value.result" />
              </div>
              <div class="form-group">
                <label class="form-label">单位</label>
                <input v-model="mappings.item_unit" class="form-input" placeholder="如: value.unit" />
              </div>
              <div class="form-group">
                <label class="form-label">参考值下限</label>
                <input v-model="mappings.ref_min" class="form-input" placeholder="如: value.min" />
              </div>
              <div class="form-group">
                <label class="form-label">参考值上限</label>
                <input v-model="mappings.ref_max" class="form-input" placeholder="如: value.max" />
              </div>
            </div>
          </div>
        </div>
        <div class="mb-4">
          <h4 class="font-medium mb-2">预览</h4>
          <div class="max-h-40 overflow-y-auto border rounded p-2">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left">项目</th>
                  <th class="px-3 py-2 text-left">结果</th>
                  <th class="px-3 py-2 text-left">单位</th>
                  <th class="px-3 py-2 text-left">参考区间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in previewItems" :key="i" class="border-t hover:bg-gray-50">
                  <td class="px-3 py-2">{{ item.name }}</td>
                  <td class="px-3 py-2">{{ item.value }}</td>
                  <td class="px-3 py-2">{{ item.unit }}</td>
                  <td class="px-3 py-2">{{ item.ref }}</td>
                </tr>
              </tbody>
            </table>
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
        <div class="mb-4">
          <h4 class="font-medium mb-2">待导入报告</h4>
          <div class="max-h-48 overflow-y-auto border rounded">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left">文件名</th>
                  <th class="px-3 py-2 text-left">采样日期</th>
                  <th class="px-3 py-2 text-center">项目数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewData" :key="i" class="border-t hover:bg-gray-50">
                  <td class="px-3 py-2">{{ r.file_name }}</td>
                  <td class="px-3 py-2">
                    <input type="date" v-model="r.sample_date" class="form-input" style="width:130px" />
                  </td>
                  <td class="px-3 py-2 text-center">{{ r.items?.length || 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="step = 3" class="btn btn-secondary">上一步</button>
          <button @click="confirmImport" class="btn btn-primary" :disabled="importing">
            {{ importing ? '导入中...' : '确认导入' }}
          </button>
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
    const categories = Vue.ref([]);
    const form = Vue.ref({ subject_id: '', hospital_id: '', category_id: '' });

    const jsonFiles = Vue.ref([]);
    const pdfFiles = Vue.ref([]);
    const filePairs = Vue.ref([]);
    const uploadErrors = Vue.ref([]);
    const previewData = Vue.ref([]);
    const pdfDataMap = Vue.ref({});
    const uploading = Vue.ref(false);
    const importing = Vue.ref(false);
    const importResult = Vue.ref({ success_count: 0, fail_count: 0 });

    const mappings = Vue.ref({
      sample_date: '',
      item_name: 'name',
      item_value: 'value',
      item_unit: 'unit',
      ref_min: 'min',
      ref_max: 'max'
    });

    const previewItems = Vue.computed(() => {
      const firstReport = previewData.value[0];
      if (!firstReport || !firstReport.items) return [];
      return firstReport.items.slice(0, 5).map(item => {
        return {
          name: getNestedValue(item, mappings.value.item_name),
          value: getNestedValue(item, mappings.value.item_value),
          unit: getNestedValue(item, mappings.value.item_unit),
          ref: `${getNestedValue(item, mappings.value.ref_min)}-${getNestedValue(item, mappings.value.ref_max)}`
        };
      });
    });

    Vue.onMounted(() => {
      api.listSubjects().then(r => subjects.value = r.data || []);
      api.listHospitals().then(r => hospitals.value = r.data || []);
      api.listCategories().then(r => categories.value = r.data || []);
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

    async function uploadFiles() {
      uploading.value = true;
      try {
        const fd = new FormData();
        for (const p of filePairs.value) {
          fd.append('json_files', p.json);
          fd.append('pdf_files', p.pdf);
        }
        const r = await api.uploadBatchFiles(fd);
        if (r.code !== 0) { alert(r.message); return; }
        previewData.value = r.data.results;
        uploadErrors.value = r.data.errors;

        for (const report of previewData.value) {
          const fp = filePairs.value.find(p => p.name === report.file_name);
          if (fp) pdfDataMap.value[report.file_name] = await readFileAsBase64(fp.pdf);
          report.sample_date = getNestedValue(report.data, mappings.value.sample_date) || '';
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
        if (curr && typeof curr === 'object' && p in curr) curr = curr[p];
        else return '';
      }
      return curr !== undefined ? String(curr) : '';
    }

    async function confirmImport() {
      if (!confirm(`确认导入 ${previewData.value.length} 份报告?`)) return;
      importing.value = true;
      try {
        const reports = previewData.value.map(r => ({
          file_name: r.file_name,
          data: r.data,
          pdf_data: pdfDataMap.value[r.file_name]
        }));

        const r = await api.confirmBatchImport({
          subject_id: parseInt(form.value.subject_id),
          hospital_id: form.value.hospital_id ? parseInt(form.value.hospital_id) : null,
          category_id: form.value.category_id ? parseInt(form.value.category_id) : null,
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
      form.value = { subject_id: '', hospital_id: '', category_id: '' };
      jsonFiles.value = [];
      pdfFiles.value = [];
      filePairs.value = [];
      uploadErrors.value = [];
      previewData.value = [];
      pdfDataMap.value = {};
      importResult.value = { success_count: 0, fail_count: 0 };
    }

    function goToReports() {
      window.location.hash = 'reports';
    }

    return {
      step, subjects, hospitals, categories, form,
      filePairs, uploadErrors, previewData, previewItems,
      uploading, importing, importResult, mappings,
      onJsonFileChange, onPdfFileChange, uploadFiles,
      confirmImport, reset, goToReports, formatJSON
    };
  }
});
