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
        <h3 class="text-lg font-medium mb-3">步骤 3: 配置字段映射</h3>

        <!-- 文件切换标签（独立一行） -->
        <div v-if="previewData.length > 1" class="mb-3">
          <div class="flex gap-1 flex-wrap">
            <button v-for="(r, i) in previewData" :key="i"
              @click="selectedFileIndex = i"
              :class="['px-2 py-1 text-xs rounded border', selectedFileIndex === i ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50']">
              {{ r.file_name }}
            </button>
          </div>
        </div>

        <!-- JSON预览 + 字段映射 -->
        <div class="flex gap-4 mb-3">
          <!-- 左侧：JSON 内容 -->
          <div class="flex-1 p-3 border rounded flex flex-col" style="min-width: 0; height: 380px; overflow: hidden;">
            <h4 class="font-medium text-sm mb-2 flex-shrink-0">示例JSON数据</h4>
            <div class="overflow-y-auto bg-gray-50 rounded" style="flex: 1 1 0; min-width: 0;">
              <pre class="text-xs p-2" style="white-space: pre-wrap; word-break: break-word;">{{ formatJSON(previewData[selectedFileIndex]?.data) }}</pre>
            </div>
          </div>
          <!-- 右侧：字段映射 -->
          <div class="flex-1 p-3 border rounded" style="min-width: 0; height: 380px; overflow-y: auto;">
            <h4 class="font-medium text-sm mb-2">字段映射</h4>
            <div class="space-y-1.5">
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">采样日期</label>
                <input v-model="mappings.sample_date" class="form-input flex-1" placeholder="如: sample_date" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">项目数组路径</label>
                <input v-model="mappings.items_path" class="form-input flex-1" placeholder="如: 留空自动查找" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">项目名称</label>
                <input v-model="mappings.item_name" class="form-input flex-1" placeholder="如: name" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">结果值</label>
                <input v-model="mappings.item_value" class="form-input flex-1" placeholder="如: value.result" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">单位</label>
                <input v-model="mappings.item_unit" class="form-input flex-1" placeholder="如: value.unit" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">项目分类</label>
                <input v-model="mappings.item_category" class="form-input flex-1" placeholder="如: category" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">参考区间(整体)</label>
                <input v-model="mappings.ref_range" class="form-input flex-1" placeholder="如: refRange" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">参考值下限</label>
                <input v-model="mappings.ref_min" class="form-input flex-1" placeholder="如: value.min" />
              </div>
              <div class="flex items-center gap-2 text-sm">
                <label class="form-label flex-shrink-0 w-24">参考值上限</label>
                <input v-model="mappings.ref_max" class="form-input flex-1" placeholder="如: value.max" />
              </div>
            </div>
          </div>
        </div>

        <!-- 预览 -->
        <div class="mb-3">
          <h4 class="font-medium text-sm mb-1">预览</h4>
          <div class="border rounded p-2">
            <div class="flex gap-4 text-sm mb-2 px-1">
              <span><span class="text-gray-500">采样日期:</span> {{ (previewData[selectedFileIndex]?.sample_date || '-') }}</span>
              <span><span class="text-gray-500">项目:</span> {{ (previewData[selectedFileIndex]?.file_name || '-') }}</span>
            </div>
            <div class="max-h-36 overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left">项目</th>
                  <th class="px-3 py-2 text-left">分类</th>
                  <th class="px-3 py-2 text-left">结果</th>
                  <th class="px-3 py-2 text-left">单位</th>
                  <th class="px-3 py-2 text-left">参考区间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in previewItems" :key="i" class="border-t hover:bg-gray-50">
                  <td class="px-3 py-2">{{ item.name }}</td>
                  <td class="px-3 py-2 text-gray-500">{{ item.category || '-' }}</td>
                  <td class="px-3 py-2">{{ item.value }}</td>
                  <td class="px-3 py-2">{{ item.unit }}</td>
                  <td class="px-3 py-2">{{ item.ref }}</td>
                </tr>
              </tbody>
            </table>
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
                  <th class="px-3 py-2 text-center">项目数</th>
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
                  <td class="px-3 py-2 text-center">{{ r.items?.length || 0 }}</td>
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
    const form = Vue.ref({ subject_id: '', hospital_id: '' });

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
      items_path: '',
      item_name: 'name',
      item_value: 'value',
      item_unit: 'unit',
      item_category: '',
      ref_range: '',
      ref_min: 'min',
      ref_max: 'max'
    });

    // 将 'null' 字符串和空值统一转为横线
    function displayVal(v) {
      return (v && v !== 'null') ? v : '-';
    }

    const previewItems = Vue.computed(() => {
      const report = previewData.value[selectedFileIndex.value];
      if (!report || !report.items) return [];
      return report.items.slice(0, 5).map(item => {
        const refMin = mappings.value.ref_min ? getNestedValue(item, mappings.value.ref_min) : '';
        const refMax = mappings.value.ref_max ? getNestedValue(item, mappings.value.ref_max) : '';
        const refRange = mappings.value.ref_range ? getNestedValue(item, mappings.value.ref_range) : '';

        // 参考区间：优先取上下限，回退取整体值
        let ref = '-';
        if (refMin && refMin !== 'null' && refMax && refMax !== 'null') {
          ref = `${refMin}-${refMax}`;
        } else if (refMin && refMin !== 'null') {
          ref = `${refMin}-`;
        } else if (refMax && refMax !== 'null') {
          ref = `-${refMax}`;
        } else if (refRange && refRange !== 'null') {
          ref = refRange;
        }

        return {
          name: displayVal(getNestedValue(item, mappings.value.item_name)),
          value: displayVal(getNestedValue(item, mappings.value.item_value)),
          unit: displayVal(getNestedValue(item, mappings.value.item_unit)),
          category: displayVal(getNestedValue(item, mappings.value.item_category) || getNestedValue(report.data, mappings.value.item_category)),
          ref
        };
      });
    });

    // 检查是否有报告缺少采样日期
    const hasEmptyDates = Vue.computed(() => {
      return previewData.value.some(r => !r.sample_date);
    });

    // 监听 mappings 变化，同步更新 previewData 中每条报告的 sample_date
    Vue.watch(
      () => mappings.value.sample_date,
      (newPath) => {
        for (const report of previewData.value) {
          report.sample_date = parseDateForInput(getNestedValue(report.data, newPath)) || '';
        }
      },
      { deep: true }
    );

    // 监听 items_path 变化，重新提取检验项目
    Vue.watch(
      () => mappings.value.items_path,
      (newPath) => {
        for (const report of previewData.value) {
          report.items = extractItemsClient(report.data, newPath);
        }
      },
      { deep: true }
    );

    Vue.onMounted(() => {
      api.listSubjects().then(r => subjects.value = r.data || []);
      api.listHospitals().then(r => hospitals.value = r.data || []);
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

    // 将各种日期字符串转为 input[type=date] 可接受的 YYYY-MM-DD 格式
    function parseDateForInput(raw) {
      if (!raw) return '';
      // 提取日期部分（去掉时间）
      const datePart = String(raw).split(/\s+/)[0];
      // 统一分隔符为 -
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
        const r = await api.uploadBatchFiles(fd);
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

    function extractItemsClient(data, itemsPath) {
      if (!itemsPath) {
        // Auto-detect: find first array of objects among top-level values
        for (const v of Object.values(data || {})) {
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
            return v;
          }
        }
        return [data];
      }
      const parts = itemsPath.split('.');
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
          return [data];
        }
        if (curr && typeof curr === 'object' && p in curr) curr = curr[p];
        else return [data];
      }
      return Array.isArray(curr) ? curr : [curr];
    }

    async function confirmImport() {
      if (!confirm(`确认导入 ${previewData.value.length} 份报告?`)) return;
      importing.value = true;
      try {
        const reports = previewData.value.map(r => ({
          file_name: r.file_name,
          data: r.data,
          pdf_data: pdfDataMap.value[r.file_name],
          sample_date: r.sample_date || ''
        }));

        const r = await api.confirmBatchImport({
          subject_id: parseInt(form.value.subject_id),
          hospital_id: form.value.hospital_id ? parseInt(form.value.hospital_id) : null,
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
      form.value = { subject_id: '', hospital_id: '' };
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

    function showJsonModal(report) {
      jsonModalData.value = report;
      jsonModalVisible.value = true;
    }

    function viewPdf(report) {
      const base64 = pdfDataMap.value[report.file_name];
      if (!base64) { alert('PDF数据未找到'); return; }
      // 去掉 data:application/pdf;base64, 前缀
      const raw = base64.includes(',') ? base64.split(',')[1] : base64;
      const blob = new Blob([Uint8Array.from(atob(raw), c => c.charCodeAt(0))], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }

    return {
      step, subjects, hospitals, form,
      filePairs, uploadErrors, previewData, previewItems,
      uploading, importing, importResult, mappings,
      selectedFileIndex, jsonModalVisible, jsonModalData, hasEmptyDates,
      onJsonFileChange, onPdfFileChange, uploadFiles,
      confirmImport, reset, goToReports, formatJSON,
      showJsonModal, viewPdf
    };
  }
});
