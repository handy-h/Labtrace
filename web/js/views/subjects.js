// subjects.js — 受检者管理视图
const SubjectsView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">受检者管理</h1>

    <!-- 搜索 + 新增 -->
    <div class="card" style="margin-bottom: var(--card-gap)">
      <div class="form-row">
        <input v-model="search" placeholder="搜索姓名" class="form-input" style="max-width: 16rem" @keyup.enter="load">
        <button @click="showForm = !showForm" class="btn btn-primary">+ 新增受检者</button>
      </div>
    </div>

    <!-- 表格 -->
    <div class="card">
      <data-table
        :columns="columns"
        :data="subjects"
        empty-text="暂无受检者"
      >
        <template #cell-name="{ row }">
          <span class="cell-medium">{{row.name}}</span>
        </template>
        <template #cell-last_report_date="{ row }">
          <span class="cell-muted">{{row.last_report_date || '-'}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewDetail(row)" class="btn-ghost">详情</button>
          <button @click="openEdit(row)" class="btn-ghost">编辑</button>
          <button @click="deleteSubject(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 新增表单 -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal-content w-96">
        <h2 class="modal-title">新增受检者</h2>
        <input v-model="form.name" placeholder="姓名" class="form-input mb-2">
        <select v-model="form.gender" class="form-select mb-2"><option value="男">男</option><option value="女">女</option></select>
        <input v-model="form.birth_date" type="date" class="form-input mb-4">
        <div class="modal-footer" style="border-top: none; padding-top: 0">
          <button @click="showForm = false" class="btn btn-secondary">取消</button>
          <button @click="create" class="btn btn-primary">保存</button>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="showEditForm" class="modal-overlay" @click.self="showEditForm = false">
      <div class="modal-content w-96">
        <h2 class="modal-title">编辑受检者</h2>
        <input v-model="editForm.name" placeholder="姓名" class="form-input mb-2">
        <select v-model="editForm.gender" class="form-select mb-2"><option value="男">男</option><option value="女">女</option></select>
        <input v-model="editForm.birth_date" type="date" class="form-input mb-4">
        <div class="modal-footer" style="border-top: none; padding-top: 0">
          <button @click="showEditForm = false" class="btn btn-secondary">取消</button>
          <button @click="saveEdit" class="btn btn-primary">保存</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="detail" class="modal-overlay" @click.self="detail=null">
      <div class="modal-content w-[600px]">
        <h2 class="modal-title">{{detail.name}} 的档案</h2>
        <div class="grid grid-cols-3 gap-2 mb-4 text-sm">
          <div>性别: {{detail.gender}}</div>
          <div>出生日期: {{detail.birth_date}}</div>
          <div>当前年龄: {{calcAge(detail.birth_date)}}岁</div>
        </div>
        <div style="margin-bottom: 0.75rem" v-if="detailReports.length">
          <button @click="exportDetailCsv" class="btn btn-secondary btn-sm">导出CSV</button>
        </div>
        <h3 class="page-subtitle">检验记录</h3>
        <div v-if="detailReports.length">
          <data-table
            :columns="reportColumns"
            :data="detailReports"
            compact
            empty-text="暂无检验记录"
          />
        </div>
        <div v-else class="empty-state">暂无检验记录</div>
      </div>
    </div>
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

    const columns = [
      { key: 'name', label: '姓名', medium: true },
      { key: 'gender', label: '性别' },
      { key: 'birth_date', label: '出生日期' },
      { key: 'report_count', label: '报告数', align: 'center' },
      { key: 'last_report_date', label: '最近检验', muted: true },
      { key: 'actions', label: '操作', width: '10rem' },
    ];

    const reportColumns = [
      { key: 'sample_date', label: '采样日期' },
      { key: 'hospital_name', label: '医院' },
      { key: 'ocr_status', label: '状态' },
    ];

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
    return { subjects, search, showForm, form, showEditForm, editForm, detail, detailReports, columns, reportColumns, load, create, openEdit, saveEdit, deleteSubject, viewDetail, exportDetailCsv, calcAge };
  }
});
