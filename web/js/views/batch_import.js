// batch_import.js — 批量导入视图
const BatchImportView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">批量导入报告</h1>

    <div class="card">
      <!-- 步骤 1: 基本信息 -->
      <div v-if="step === 1">
        <h3 class="text-lg font-medium mb-4">步骤 1: 选择受检者和医院</h3>
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
            <label class="form-label">检验项目分类</label>
            <select v-model="form.category_id" class="form-select" style="width: 12rem">
              <option value="">未分类</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
        </div>
        <button @click="goToStep2" class="btn btn-primary" :disabled="!form.subject_id">下一步</button>
      </div>

      <!-- 步骤 2: 上传文件 -->
      <div v-if="step === 2">
        <h3 class="text-lg font-medium mb-4">步骤 2: 上传文件</h3>
        <p class="text-sm text-gray-600 mb-4">请选择成对的JSON和PDF文件，文件名必须一致（例如：report_001.json 和 report_001.pdf）</p>
        
        <div class="form-row mb-4">
          <div class="form-group">
            <label class="form-label">JSON文件</label>
            <input type="file" @change="onJsonFileChange" accept=".json" multiple class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">PDF文件</label>
            <input type="file" @change="onPdfFileChange" accept=".pdf" multiple class="form-input">
          </div>
        </div>
        
        <div v-if="filePairs.length > 0" class="mb-4">
          <h4 class="font-medium mb-2">已匹配的文件：</h4>
          <div class="max-h-40 overflow-y-auto border rounded p-2">
            <div v-for="(pair, i) in filePairs" :key="i" class="flex items-center gap-2 py-1">
              <span class="text-green-600">✓</span>
              <span>{{ pair.name }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="errors.length > 0" class="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <h4 class="font-medium text-red-800 mb-2">警告：</h4>
          <ul class="text-sm text-red-700">
            <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
          </ul>
        </div>
        
        <div class="flex gap-2">
          <button @click="step = 1" class="btn btn-secondary">上一步</button>
          <button @click="uploadFiles" class="btn btn-primary" :disabled="filePairs.length === 0 || uploading">
            {{ uploading ? '正在上传...' : '上传文件' }}
          </button>
        </div>
      </div>

      <!-- 步骤 3: 预览和确认 -->
      <div v-if="step === 3">
        <h3 class="text-lg font-medium mb-4">步骤 3: 预览并确认</h3>
        
        <div class="mb-4">
          <h4 class="font-medium mb-2">报告列表：</h4>
          <div class="max-h-60 overflow-y-auto border rounded">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left">文件名</th>
                  <th class="px-3 py-2 text-left">采样日期</th>
                  <th class="px-3 py-2 text-center">项目数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(report, i) in previewData" :key="i" class="border-t hover:bg-gray-50">
                  <td class="px-3 py-2">{{ report.name }}</td>
                  <td class="px-3 py-2">
                    <input type="date" v-model="report.data.sample_date" class="form-input" style="width: 10rem">
                  </td>
                  <td class="px-3 py-2 text-center">{{ report.data.items?.length || 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="flex gap-2">
          <button @click="step = 2" class="btn btn-secondary">上一步</button>
          <button @click="confirmImport" class="btn btn-primary" :disabled="importing">
            {{ importing ? '正在导入...' : '确认导入' }}
          </button>
        </div>
      </div>

      <!-- 完成 -->
      <div v-if="step === 4">
        <h3 class="text-lg font-medium mb-4 text-green-700">导入完成！</h3>
        <div class="mb-4">
          <p class="text-green-600 font-medium">成功: {{ importResult.success_count }} 份</p>
          <p v-if="importResult.fail_count > 0" class="text-red-600 font-medium">失败: {{ importResult.fail_count }} 份</p>
        </div>
        
        <div v-if="importResult.errors?.length > 0" class="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <h4 class="font-medium text-red-800 mb-2">错误信息：</h4>
          <ul class="text-sm text-red-700">
            <li v-for="(err, i) in importResult.errors" :key="i">{{ err }}</li>
          </ul>
        </div>
        
        <button @click="reset" class="btn btn-primary">继续导入</button>
        <button @click="goToReports" class="btn btn-secondary">查看报告</button>
      </div>
    </div>
  </div>
  `,
  setup() {
    const step = Vue.ref(1)
    const subjects = Vue.ref([])
    const hospitals = Vue.ref([])
    const categories = Vue.ref([])
    const form = Vue.ref({ subject_id: '', hospital_id: '', category_id: '' })
    const filePairs = Vue.ref([])
    const errors = Vue.ref([])
    const previewData = Vue.ref([])
    const pdfDataMap = Vue.ref({})
    const uploading = Vue.ref(false)
    const importing = Vue.ref(false)
    const importResult = Vue.ref({ success_count: 0, fail_count: 0 })

    Vue.onMounted(() => {
      api.listSubjects().then(r => { if (r.data) subjects.value = r.data })
      api.listHospitals().then(r => { if (r.data) hospitals.value = r.data })
      api.listCategories().then(r => { if (r.data) categories.value = r.data })
    })

    function onJsonFileChange(e) {
      const files = Array.from(e.target.files)
      matchFiles(files, [])
    }

    function onPdfFileChange(e) {
      const files = Array.from(e.target.files)
      matchFiles([], files)
    }

    function matchFiles(newJsonFiles, newPdfFiles) {
      errors.value = []
      filePairs.value = []
      
      const jsonMap = {}
      for (const f of newJsonFiles) {
        const baseName = getBaseName(f.name)
        jsonMap[baseName] = f
      }
      
      const pdfMap = {}
      for (const f of newPdfFiles) {
        const baseName = getBaseName(f.name)
        pdfMap[baseName] = f
      }
      
      const allNames = new Set([...Object.keys(jsonMap), ...Object.keys(pdfMap)])
      
      for (const name of allNames) {
        if (jsonMap[name] && pdfMap[name]) {
          filePairs.value.push({ name, json: jsonMap[name], pdf: pdfMap[name] })
        } else if (jsonMap[name]) {
          errors.value.push(`${name}: 缺少对应的PDF文件`)
        } else {
          errors.value.push(`${name}: 缺少对应的JSON文件`)
        }
      }
    }

    function getBaseName(filename) {
      const lastDot = filename.lastIndexOf('.')
      return lastDot > 0 ? filename.substring(0, lastDot) : filename
    }

    function goToStep2() {
      step.value = 2
    }

    async function uploadFiles() {
      uploading.value = true
      
      try {
        const formData = new FormData()
        for (const pair of filePairs.value) {
          formData.append('json_files', pair.json)
          formData.append('pdf_files', pair.pdf)
        }
        
        const result = await api.uploadBatchFiles(formData)
        
        if (result.code !== 0) {
          alert(result.message)
          return
        }
        
        if (result.data.errors?.length) {
          errors.value = result.data.errors
        }
        
        previewData.value = result.data.results || []
        
        for (const report of previewData.value) {
          const pair = filePairs.value.find(p => p.name === report.name)
          if (pair) {
            const pdfBase64 = await readFileAsBase64(pair.pdf)
            pdfDataMap.value[report.name] = pdfBase64
          }
        }
        
        step.value = 3
      } catch (err) {
        alert('上传失败: ' + (err.message || err))
      } finally {
        uploading.value = false
      }
    }

    async function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    }

    async function confirmImport() {
      if (!confirm(`确认导入 ${previewData.value.length} 份报告？`)) {
        return
      }
      
      importing.value = true
      
      try {
        const reports = previewData.value.map(r => ({
          name: r.name,
          data: r.data,
          pdf_data: pdfDataMap.value[r.name]
        }))
        
        const result = await api.confirmBatchImport({
          subject_id: parseInt(form.value.subject_id),
          hospital_id: form.value.hospital_id ? parseInt(form.value.hospital_id) : null,
          category_id: form.value.category_id ? parseInt(form.value.category_id) : null,
          reports
        })
        
        if (result.code !== 0) {
          alert(result.message)
          return
        }
        
        importResult.value = result.data
        step.value = 4
      } catch (err) {
        alert('导入失败: ' + (err.message || err))
      } finally {
        importing.value = false
      }
    }

    function reset() {
      step.value = 1
      form.value = { subject_id: '', hospital_id: '', category_id: '' }
      jsonFiles.value = []
      pdfFiles.value = []
      filePairs.value = []
      errors.value = []
      previewData.value = []
      pdfDataMap.value = {}
      importResult.value = { success_count: 0, fail_count: 0 }
    }

    function goToReports() {
      window.location.hash = 'reports'
    }

    return {
      step,
      subjects,
      hospitals,
      categories,
      form,
      filePairs,
      errors,
      previewData,
      uploading,
      importing,
      importResult,
      goToStep2,
      onJsonFileChange,
      onPdfFileChange,
      uploadFiles,
      confirmImport,
      reset,
      goToReports
    }
  }
})
