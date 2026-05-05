// app.js — Vue 3 应用入口
const { createApp, ref, computed, defineComponent, reactive, onMounted, watch, nextTick } = Vue;

// ===== 通用工具 =====
function calcAge(birthDate, refDate) {
  if (!birthDate) return '-';
  const b = new Date(birthDate);
  const r = refDate ? new Date(refDate) : new Date();
  let age = r.getFullYear() - b.getFullYear();
  if (r.getMonth() < b.getMonth() || (r.getMonth() === b.getMonth() && r.getDate() < b.getDate())) age--;
  return age;
}

function confClass(c) {
  if (c >= 95) return 'conf-high';
  if (c >= 80) return 'conf-medium';
  return 'conf-low';
}

function flagBadge(f) {
  if (!f || f === 'normal') return '';
  const cls = (f === 'H' || f === '阳性') ? 'text-red-600 font-bold' : (f === 'L' || f === '阴性') ? 'text-blue-600 font-bold' : '';
  return `<span class="${cls}">${f}</span>`;
}

// ===== 仪表盘视图 =====
const DashboardView = defineComponent({
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
    const summary = ref({ subjects: 0, pending: 0, anomalies: 0, hospitals: 0 });
    const anomalies = ref([]);
    const filter = ref({ confidence: '', flag: '' });

    function loadSummary() {
      api.dashboardSummary().then(r => { if (r.data) summary.value = r.data; });
    }
    function loadAnomalies() {
      const params = {};
      if (filter.value.confidence) params.confidence = filter.value.confidence;
      if (filter.value.flag) params.flag = filter.value.flag;
      api.dashboardAnomalies(params).then(r => { if (r.data && r.data.data) anomalies.value = r.data.data; });
    }

    onMounted(() => { loadSummary(); loadAnomalies(); });
    return { summary, anomalies, filter, loadAnomalies, confClass, flagBadge };
  }
});

// ===== OCR上传与沉浸式比对视图 =====
const OCRImportView = defineComponent({
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
              <button v-if="r.ocr_status==='review'" @click="doImport(r.id)" class="text-green-600 hover:underline text-xs mr-2">入库</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 报告详情弹窗 -->
    <div v-if="selectedReport" class="drill-modal" @click.self="selectedReport=null">
      <div class="w-[90vw] max-w-5xl max-h-[80vh] overflow-auto bg-white rounded-lg p-4">
        <h2 class="text-lg font-bold mb-3">报告详情 #{{selectedReport.id}}</h2>
        <div class="flex gap-4">
          <div class="w-[45%]"><img :src="reportImageUrl" class="max-w-full border rounded" v-if="reportImageUrl"></div>
          <div class="w-[55%] overflow-auto">
            <table class="w-full text-sm">
              <thead><tr class="bg-slate-50 text-left text-slate-600">
                <th class="p-2">项目</th><th class="p-2">结果</th><th class="p-2">单位</th><th class="p-2">置信度</th><th class="p-2">提示符</th><th class="p-2">参考区间</th>
              </tr></thead>
              <tbody>
                <tr v-for="it in selectedReport.items" :key="it.id" class="border-t hover:bg-slate-50">
                  <td class="p-2 font-medium">{{it.test_item_name || '-'}}</td>
                  <td class="p-2" :class="confClass(it.confidence)">{{it.original_value}}</td>
                  <td class="p-2">{{it.original_unit}}</td>
                  <td class="p-2">{{it.confidence}}%</td>
                  <td class="p-2" v-html="flagBadge(it.flag)"></td>
                  <td class="p-2 text-slate-500">{{it.ref_interval_text || '-'}}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>`,
  setup() {
    const subjects = ref([]);
    const hospitals = ref([]);
    const reports = ref([]);
    const form = ref({ subject_id: '', hospital_id: '', sample_date: '' });
    const uploading = ref(false);
    const selectedReport = ref(null);
    const reportImageUrl = ref('');
    let selectedFile = null;

    onMounted(() => {
      api.listSubjects().then(r => { if (r.data) subjects.value = r.data; });
      api.listHospitals().then(r => { if (r.data) hospitals.value = r.data; });
      loadReports();
    });

    function loadReports() {
      api.listReports({ ocr_status: '' }).then(r => { if (r.data) reports.value = r.data; });
    }
    function onFileChange(e) { selectedFile = e.target.files[0]; }
    function upload() {
      if (!selectedFile || !form.value.subject_id) return alert('请选择文件和受检者');
      uploading.value = true;
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('subject_id', form.value.subject_id);
      fd.append('hospital_id', form.value.hospital_id);
      fd.append('sample_date', form.value.sample_date);
      api.ocrUpload(fd).then(r => {
        uploading.value = false;
        if (r.code === 0) { alert('上传成功，OCR识别中'); loadReports(); }
        else alert(r.message);
      });
    }
    function viewReport(id) {
      api.getReport(id).then(r => {
        if (r.data) { selectedReport.value = r.data; reportImageUrl.value = api.getReportImage(id); }
      });
    }
    function doImport(id) {
      if (!confirm('确认入库？')) return;
      api.importReport(id).then(r => {
        if (r.code === 0) { alert('入库成功'); loadReports(); }
        else alert(r.message);
      });
    }
    function statusClass(s) {
      return { pending: 'text-slate-500', processing: 'text-yellow-600', review: 'text-orange-600', imported: 'text-green-600', failed: 'text-red-600' }[s] || '';
    }
    function statusText(s) {
      return { pending: '待识别', processing: '识别中', review: '待核效', imported: '已入库', failed: '失败' }[s] || s;
    }
    return { subjects, hospitals, reports, form, uploading, selectedReport, reportImageUrl, onFileChange, upload, viewReport, doImport, statusClass, statusText, confClass, flagBadge };
  }
});

// ===== 受检者管理视图 =====
const SubjectsView = defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">受检者管理</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4 flex gap-3">
      <input v-model="search" placeholder="搜索姓名" class="border rounded px-2 py-1 text-sm" @keyup.enter="load">
      <button @click="showForm = !showForm" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">+ 新增受检者</button>
    </div>
    <div class="bg-white rounded-lg shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50 text-left text-slate-600">
          <th class="p-3">姓名</th><th class="p-3">性别</th><th class="p-3">出生日期</th><th class="p-3">报告数</th><th class="p-3">最近检验</th><th class="p-3">操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="s in subjects" :key="s.id" class="border-t hover:bg-slate-50">
            <td class="p-3 font-medium">{{s.name}}</td>
            <td class="p-3">{{s.gender}}</td>
            <td class="p-3">{{s.birth_date}}</td>
            <td class="p-3">{{s.report_count}}</td>
            <td class="p-3 text-slate-500">{{s.last_report_date || '-'}}</td>
            <td class="p-3">
              <button @click="viewDetail(s)" class="text-blue-600 hover:underline text-xs mr-2">详情</button>
              <button @click="deleteSubject(s.id)" class="text-red-600 hover:underline text-xs">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 新增表单 -->
    <div v-if="showForm" class="drill-modal" @click.self="showForm = false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">新增受检者</h2>
      <input v-model="form.name" placeholder="姓名" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="form.gender" class="w-full border p-2 rounded mb-2 text-sm"><option value="男">男</option><option value="女">女</option></select>
      <input v-model="form.birth_date" type="date" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showForm = false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="create" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>
    <!-- 详情弹窗 -->
    <div v-if="detail" class="drill-modal" @click.self="detail=null"><div class="w-[600px] max-h-[70vh] overflow-auto">
      <h2 class="text-lg font-bold mb-3">{{detail.name}} 的档案</h2>
      <div class="grid grid-cols-3 gap-2 mb-4 text-sm">
        <div>性别: {{detail.gender}}</div>
        <div>出生日期: {{detail.birth_date}}</div>
        <div>当前年龄: {{calcAge(detail.birth_date)}}岁</div>
      </div>
      <h3 class="font-semibold mb-2">检验记录</h3>
      <div v-if="detailReports.length">
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-50"><th class="p-2">采样日期</th><th class="p-2">医院</th><th class="p-2">状态</th></tr></thead>
          <tbody>
            <tr v-for="r in detailReports" :key="r.id" class="border-t">
              <td class="p-2">{{r.sample_date}}</td><td class="p-2">{{r.hospital_name||'-'}}</td><td class="p-2">{{r.ocr_status}}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="text-slate-400 text-sm">暂无检验记录</div>
    </div></div>
  </div>`,
  setup() {
    const subjects = ref([]);
    const search = ref('');
    const showForm = ref(false);
    const form = ref({ name: '', gender: '男', birth_date: '' });
    const detail = ref(null);
    const detailReports = ref([]);

    function load() {
      api.listSubjects(search.value).then(r => { if (r.data) subjects.value = r.data; });
    }
    function create() {
      api.createSubject(form.value).then(r => {
        if (r.code === 0) { showForm.value = false; form.value = { name: '', gender: '男', birth_date: '' }; load(); }
      });
    }
    function deleteSubject(id) {
      if (!confirm('确认删除？')) return;
      api.deleteSubject(id).then(() => load());
    }
    function viewDetail(s) {
      detail.value = s;
      api.listReports({ subject_id: s.id }).then(r => { if (r.data) detailReports.value = r.data; });
    }

    load();
    return { subjects, search, showForm, form, detail, detailReports, load, create, deleteSubject, viewDetail, calcAge };
  }
});

// ===== 检验项目库视图 =====
const TestItemsView = defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">检验项目库</h1>
    <div class="grid grid-cols-4 gap-4 mb-4">
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">标准项目</span> <span class="font-bold">{{items.length}}</span></div>
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">单位转换</span> <span class="font-bold">{{conversions.length}}</span></div>
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">计算规则</span> <span class="font-bold">{{calcRules.length}}</span></div>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 mb-3">
        <select v-model="category" @change="load" class="border rounded px-2 py-1 text-sm">
          <option value="">全部分类</option><option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
        </select>
        <button @click="showAddItem = true" class="px-3 py-1 bg-blue-600 text-white rounded text-sm">+ 新增项目</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50 text-left text-slate-600">
          <th class="p-2">编码</th><th class="p-2">标准名称</th><th class="p-2">分类</th><th class="p-2">默认单位</th><th class="p-2">类型</th><th class="p-2">操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="it in items" :key="it.id" class="border-t hover:bg-slate-50">
            <td class="p-2 font-mono">{{it.code}}</td><td class="p-2 font-medium">{{it.standard_name}}</td>
            <td class="p-2">{{it.category}}</td><td class="p-2">{{it.default_unit}}</td><td class="p-2">{{it.value_type}}</td>
            <td class="p-2"><button @click="viewAliases(it)" class="text-blue-600 hover:underline text-xs mr-1">别名</button>
              <button @click="viewRefIntervals(it)" class="text-blue-600 hover:underline text-xs mr-1">参考区间</button>
              <button @click="deleteItem(it.id)" class="text-red-600 hover:underline text-xs">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 单位转换 -->
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h2 class="font-semibold mb-2">单位转换规则</h2>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">项目ID</th><th class="p-2">源单位</th><th class="p-2">目标单位</th><th class="p-2">公式</th><th class="p-2">示例</th></tr></thead>
        <tbody><tr v-for="uc in conversions" :key="uc.id" class="border-t">
          <td class="p-2">{{uc.test_item_id}}</td><td class="p-2">{{uc.source_unit}}</td><td class="p-2">{{uc.target_unit}}</td>
          <td class="p-2 font-mono">{{uc.formula}}</td><td class="p-2">{{uc.example_input}} → {{uc.example_output}}</td>
        </tr></tbody>
      </table>
    </div>
    <!-- 计算规则 -->
    <div class="bg-white rounded-lg shadow-sm p-4">
      <h2 class="font-semibold mb-2">计算校验规则</h2>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">名称</th><th class="p-2">公式</th><th class="p-2">阈值</th></tr></thead>
        <tbody><tr v-for="r in calcRules" :key="r.id" class="border-t">
          <td class="p-2">{{r.name}}</td><td class="p-2 font-mono">{{r.formula}}</td><td class="p-2">{{r.threshold}}</td>
        </tr></tbody>
      </table>
    </div>
    <!-- 新增项目弹窗 -->
    <div v-if="showAddItem" class="drill-modal" @click.self="showAddItem=false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">新增检验项目</h2>
      <input v-model="newItem.code" placeholder="编码" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="newItem.standard_name" placeholder="标准名称" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="newItem.category" class="w-full border p-2 rounded mb-2 text-sm">
        <option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
      </select>
      <input v-model="newItem.default_unit" placeholder="默认单位" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="newItem.value_type" class="w-full border p-2 rounded mb-4 text-sm">
        <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
      </select>
      <div class="flex gap-2 justify-end">
        <button @click="showAddItem=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="addItem" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>
  </div>`,
  setup() {
    const items = ref([]);
    const conversions = ref([]);
    const calcRules = ref([]);
    const category = ref('');
    const showAddItem = ref(false);
    const newItem = ref({ code: '', standard_name: '', category: '血常规', default_unit: '', value_type: 'numeric' });

    function load() {
      api.listTestItems(category.value).then(r => { if (r.data) items.value = r.data; });
      api.listUnitConversions().then(r => { if (r.data) conversions.value = r.data; });
      api.listCalcRules().then(r => { if (r.data) calcRules.value = r.data; });
    }
    function addItem() {
      api.createTestItem(newItem.value).then(r => {
        if (r.code === 0) { showAddItem.value = false; newItem.value = { code: '', standard_name: '', category: '血常规', default_unit: '', value_type: 'numeric' }; load(); }
      });
    }
    function deleteItem(id) { if (confirm('确认删除？')) api.deleteTestItem(id).then(() => load()); }
    function viewAliases(it) { alert('别名管理: ' + it.standard_name + ' (ID:' + it.id + ')'); }
    function viewRefIntervals(it) { alert('参考区间: ' + it.standard_name + ' (ID:' + it.id + ')'); }

    load();
    return { items, conversions, calcRules, category, showAddItem, newItem, load, addItem, deleteItem, viewAliases, viewRefIntervals };
  }
});

// ===== 纵向趋势分析视图 =====
const TrendView = defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">纵向趋势分析</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-end flex-wrap">
        <div><label class="text-sm text-slate-600">受检者</label>
          <select v-model="filter.subject_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{s.name}}</option>
          </select></div>
        <div><label class="text-sm text-slate-600">检验项目</label>
          <select v-model="filter.test_item_id" class="border rounded px-2 py-1 text-sm w-40">
            <option value="">请选择</option><option v-for="it in testItems" :key="it.id" :value="it.id">{{it.standard_name}}</option>
          </select></div>
        <button @click="loadTrend" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">查询</button>
      </div>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div id="trend-chart" style="height:400px;"></div>
    </div>
    <div v-if="trendData.length" class="bg-white rounded-lg shadow-sm p-4">
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">采样日期</th><th class="p-2">医院</th><th class="p-2">数值</th><th class="p-2">单位</th><th class="p-2">置信度</th><th class="p-2">提示符</th><th class="p-2">参考区间</th></tr></thead>
        <tbody>
          <tr v-for="d in trendData" :key="d.report_item_id" class="border-t hover:bg-slate-50">
            <td class="p-2">{{d.sample_date}}</td><td class="p-2">{{d.hospital_name}}</td>
            <td class="p-2 font-medium">{{d.converted_value}}</td><td class="p-2">{{d.unit}}</td>
            <td class="p-2">{{d.confidence}}%</td><td class="p-2" v-html="flagBadge(d.flag)"></td>
            <td class="p-2 text-slate-500">{{d.ref_min && d.ref_max ? d.ref_min + '-' + d.ref_max : '-'}}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
  setup() {
    const subjects = ref([]);
    const testItems = ref([]);
    const filter = ref({ subject_id: '', test_item_id: '' });
    const trendData = ref([]);

    onMounted(() => {
      api.listSubjects().then(r => { if (r.data) subjects.value = r.data; });
      api.listTestItems().then(r => { if (r.data) testItems.value = r.data; });
    });

    function loadTrend() {
      if (!filter.value.subject_id || !filter.value.test_item_id) return;
      api.getTrendData({ subject_id: filter.value.subject_id, test_item_id: filter.value.test_item_id }).then(r => {
        if (r.data) { trendData.value = r.data; renderChart(); }
      });
    }

    function renderChart() {
      const el = document.getElementById('trend-chart');
      if (!el || typeof echarts === 'undefined') return;
      const chart = echarts.init(el);
      const dates = trendData.value.map(d => d.sample_date);
      const values = trendData.value.map(d => d.converted_value);
      const refMins = trendData.value.map(d => d.ref_min || null);
      const refMaxs = trendData.value.map(d => d.ref_max || null);

      chart.setOption({
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'value' },
        series: [
          { name: '数值', type: 'line', data: values, symbolSize: 8 },
          { name: '参考下限', type: 'line', data: refMins, lineStyle: { type: 'dashed', color: '#ccc' }, itemStyle: { color: '#ccc' }, symbol: 'none' },
          { name: '参考上限', type: 'line', data: refMaxs, lineStyle: { type: 'dashed', color: '#ccc' }, itemStyle: { color: '#ccc' }, symbol: 'none',
            areaStyle: { color: 'rgba(76,175,80,0.1)' } },
        ]
      });
    }

    return { subjects, testItems, filter, trendData, loadTrend, flagBadge };
  }
});

// ===== 设置视图 =====
const SettingsView = defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">设置</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h2 class="font-semibold mb-2">数据库加密</h2>
      <p class="text-sm text-slate-500">加密状态: <span class="text-green-600">已启用</span> (密钥来自 .env)</p>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h2 class="font-semibold mb-2">备份与恢复</h2>
      <div class="flex gap-3 mb-3">
        <input v-model="backupDesc" placeholder="备份描述" class="border rounded px-2 py-1 text-sm">
        <button @click="doExport" class="px-3 py-1 bg-blue-600 text-white rounded text-sm">导出备份</button>
        <label class="px-3 py-1 bg-slate-600 text-white rounded text-sm cursor-pointer">
          导入备份 <input type="file" @change="doImport" accept=".bak" class="hidden">
        </label>
      </div>
      <table v-if="backups.length" class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">文件名</th><th class="p-2">描述</th><th class="p-2">大小</th><th class="p-2">时间</th><th class="p-2">操作</th></tr></thead>
        <tbody>
          <tr v-for="b in backups" :key="b.id" class="border-t">
            <td class="p-2">{{b.filename}}</td><td class="p-2">{{b.description}}</td>
            <td class="p-2">{{(b.file_size/1024).toFixed(1)}}KB</td><td class="p-2">{{b.created_at}}</td>
            <td class="p-2"><button @click="deleteBackup(b.id)" class="text-red-600 hover:underline text-xs">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="bg-white rounded-lg shadow-sm p-4">
      <h2 class="font-semibold mb-2">审计日志</h2>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">操作</th><th class="p-2">实体</th><th class="p-2">时间</th></tr></thead>
        <tbody>
          <tr v-for="l in auditLogs" :key="l.id" class="border-t">
            <td class="p-2">{{l.action}}</td><td class="p-2">{{l.entity_type}}#{{l.entity_id}}</td><td class="p-2">{{l.created_at}}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
  setup() {
    const backupDesc = ref('');
    const backups = ref([]);
    const auditLogs = ref([]);

    function loadBackups() { api.listBackups().then(r => { if (r.data) backups.value = r.data; }); }
    function loadAudit() { api.listAuditLogs().then(r => { if (r.data) auditLogs.value = r.data; }); }
    function doExport() {
      api.exportBackup(backupDesc.value).then(r => {
        if (r.code === 0) { alert('备份成功: ' + r.data.filename); backupDesc.value = ''; loadBackups(); }
      });
    }
    function doImport(e) {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      api.importBackup(fd).then(r => {
        if (r.code === 0) alert('恢复成功'); else alert('恢复失败: ' + r.message);
      });
    }
    function deleteBackup(id) { if (confirm('确认删除？')) api.deleteBackup(id).then(() => loadBackups()); }

    onMounted(() => { loadBackups(); loadAudit(); });
    return { backupDesc, backups, auditLogs, doExport, doImport, deleteBackup };
  }
});

// ===== 应用实例 =====
const app = createApp({
  data() {
    return {
      currentView: 'dashboard',
      navItems: [
        { hash: 'dashboard',  label: '仪表盘',     icon: '📊' },
        { hash: 'ocr',        label: '上传 OCR',    icon: '📷' },
        { hash: 'subjects',   label: '受检者',      icon: '👤' },
        { hash: 'test-items', label: '项目库',      icon: '🧪' },
        { hash: 'trend',      label: '趋势分析',    icon: '📈' },
        { hash: 'settings',   label: '设置',        icon: '⚙️' },
      ]
    };
  },
  computed: {
    currentComponent() {
      const map = {
        dashboard:  'DashboardView',
        ocr:        'OCRImportView',
        subjects:   'SubjectsView',
        'test-items':'TestItemsView',
        trend:      'TrendView',
        settings:   'SettingsView',
      };
      return map[this.currentView] || 'DashboardView';
    }
  },
  mounted() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    this.currentView = hash;
    window.addEventListener('hashchange', () => {
      this.currentView = window.location.hash.replace('#', '') || 'dashboard';
    });
  }
});

app.component('DashboardView', DashboardView);
app.component('OCRImportView', OCRImportView);
app.component('SubjectsView', SubjectsView);
app.component('TestItemsView', TestItemsView);
app.component('TrendView', TrendView);
app.component('SettingsView', SettingsView);

app.mount('#app');
