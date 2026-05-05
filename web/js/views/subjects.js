// subjects.js — 受检者管理视图（增强：编辑弹窗+CSV导出）
const SubjectsView = Vue.defineComponent({
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
              <button @click="openEdit(s)" class="text-blue-600 hover:underline text-xs mr-2">编辑</button>
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
    <!-- 编辑弹窗 -->
    <div v-if="showEditForm" class="drill-modal" @click.self="showEditForm = false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">编辑受检者</h2>
      <input v-model="editForm.name" placeholder="姓名" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="editForm.gender" class="w-full border p-2 rounded mb-2 text-sm"><option value="男">男</option><option value="女">女</option></select>
      <input v-model="editForm.birth_date" type="date" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showEditForm = false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveEdit" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
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
      <div class="flex gap-2 mb-3">
        <button @click="exportDetailCsv" class="px-3 py-1 bg-slate-600 text-white rounded text-sm" v-if="detailReports.length">导出CSV</button>
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
    const subjects = Vue.ref([]);
    const search = Vue.ref('');
    const showForm = Vue.ref(false);
    const form = Vue.ref({ name: '', gender: '男', birth_date: '' });
    const showEditForm = Vue.ref(false);
    const editForm = Vue.ref({ name: '', gender: '男', birth_date: '' });
    const editingId = Vue.ref(null);
    const detail = Vue.ref(null);
    const detailReports = Vue.ref([]);

    function load() {
      api.listSubjects(search.value).then(r => { if (r.data) subjects.value = r.data; });
    }
    function create() {
      api.createSubject(form.value).then(r => {
        if (r.code === 0) { showForm.value = false; form.value = { name: '', gender: '男', birth_date: '' }; load(); }
      });
    }
    function openEdit(s) {
      editingId.value = s.id;
      editForm.value = deepClone({ name: s.name, gender: s.gender, birth_date: s.birth_date });
      showEditForm.value = true;
    }
    function saveEdit() {
      api.updateSubject(editingId.value, editForm.value).then(r => {
        if (r.code === 0) { showEditForm.value = false; load(); }
        else alert(r.message || '更新失败');
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
    function exportDetailCsv() {
      const headerLabels = ['采样日期', '医院', '状态'];
      const headers = ['sample_date', 'hospital_name', 'ocr_status'];
      exportCsv(detail.value.name + '_检验记录', headerLabels, detailReports.value);
    }

    load();
    return { subjects, search, showForm, form, showEditForm, editForm, detail, detailReports, load, create, openEdit, saveEdit, deleteSubject, viewDetail, exportDetailCsv, calcAge };
  }
});
