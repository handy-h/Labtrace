// settings.js — 设置视图
const SettingsView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">设置</h1>

    <!-- 数据库加密 -->
    <div class="card">
      <h2 class="page-subtitle">数据库加密</h2>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        加密状态: <span class="badge badge-success">已启用</span> (密钥来自 .env)
      </p>
    </div>

    <!-- OCR 配额管理 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">OCR 月度配额</h2>
      <div class="flex items-center gap-4 text-sm" v-if="quota">
        <span style="color: var(--color-text-secondary)">当前用量</span>
        <span :class="quotaTextClass">{{quota.used_count}} / {{quota.total_quota}}</span>
        <div class="progress-bar" style="width: 8rem">
          <div class="progress-bar-fill" :class="quotaBarClass" :style="{width: quotaPct + '%'}"></div>
        </div>
        <span style="color: var(--color-text-muted)">成功{{quota.success_count}} 失败{{quota.fail_count}}</span>
      </div>
      <div class="form-row" style="margin-top: 0.5rem">
        <span class="text-xs" style="color: var(--color-text-secondary)">校准用量</span>
        <input v-model="editUsed" type="number" class="form-input" style="width: 5rem" min="0">
        <button @click="saveQuota" class="btn btn-primary btn-sm">校准</button>
        <span class="text-xs" style="color: var(--color-text-muted)" v-if="quota">当前月份 {{quota.year_month}}</span>
      </div>
    </div>

    <!-- 医院管理 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div class="toolbar">
        <h2 class="page-subtitle" style="margin-bottom: 0">医院管理</h2>
        <button @click="openHospModal(null)" class="btn btn-primary btn-sm">+ 新增医院</button>
      </div>
      <data-table :columns="hospitalColumns" :data="hospitals" empty-text="暂无医院">
        <template #cell-level="{ row }">
          <span class="cell-muted">{{row.level || '-'}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="openHospModal(row)" class="btn-ghost">编辑</button>
          <button @click="deleteHospital(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 医院弹窗 -->
    <crud-modal :title="(editingHospId ? '编辑' : '新增') + '医院'" :visible="showHospModal" @close="showHospModal=false" @save="saveHospital">
      <input v-model="hospForm.name" placeholder="医院名称" class="form-input mb-2">
      <select v-model="hospForm.level" class="form-select">
        <option value="">请选择医院级别</option>
        <option value="三甲">三甲</option><option value="三乙">三乙</option>
        <option value="二甲">二甲</option><option value="二乙">二乙</option>
        <option value="一甲">一甲</option><option value="一乙">一乙</option>
        <option value="其他">其他</option>
      </select>
    </crud-modal>

    <!-- 备份与恢复 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">备份与恢复</h2>
      <div class="form-row" style="margin-bottom: 0.75rem">
        <input v-model="backupDesc" placeholder="备份描述" class="form-input" style="max-width: 20rem">
        <button @click="doExport" class="btn btn-primary btn-sm">导出备份</button>
        <label class="btn btn-secondary btn-sm" style="cursor: pointer">
          导入备份 <input type="file" @change="doImport" accept=".bak" class="hidden">
        </label>
      </div>
      <data-table v-if="backups.length" :columns="backupColumns" :data="backups" empty-text="">
        <template #cell-file_size="{ row }">
          {{(row.file_size/1024).toFixed(1)}}KB
        </template>
        <template #cell-actions="{ row }">
          <button @click="deleteBackup(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 检验项目分类（标准项目库） -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div class="toolbar">
        <h2 class="page-subtitle" style="margin-bottom: 0">检验项目分类（标准项目库）</h2>
      </div>
      <div class="mb-3">
        <p class="text-xs" style="color: var(--color-text-muted)">导入时若检验项目不存在，会自动创建并记录分类。以下为所有已入库的检验项目。</p>
      </div>
      <div class="mb-2 flex gap-2 flex-wrap" v-if="testItemCategories.length">
        <button v-for="cat in testItemCategories" :key="cat"
          @click="testItemCategoryFilter = (testItemCategoryFilter === cat ? '' : cat)"
          :class="['px-2 py-0.5 text-xs rounded border', testItemCategoryFilter === cat ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50']">
          {{ cat }} ({{ testItemsByCategory(cat).length }})
        </button>
      </div>
      <data-table :columns="testItemColumns" :data="filteredTestItems" empty-text="暂无检验项目">
        <template #cell-standard_name="{ row }">
          <span class="cell-medium">{{ row.standard_name }}</span>
        </template>
        <template #cell-category="{ row }">
          <span class="px-1.5 py-0.5 rounded text-xs" style="background: var(--color-primary); color: white">{{ row.category || '-' }}</span>
        </template>
        <template #cell-default_unit="{ row }">
          <span class="cell-muted">{{ row.default_unit || '-' }}</span>
        </template>
      </data-table>
    </div>

    <!-- 审计日志 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <h2 class="page-subtitle">审计日志</h2>
      <data-table :columns="auditColumns" :data="auditLogs" empty-text="暂无日志">
        <template #cell-entity_info="{ row }">
          <span v-if="row.sample_date">{{ row.sample_date }}</span>
          <span v-else style="color: var(--color-text-muted)">—</span>
        </template>
      </data-table>
    </div>
  </div>`,
  setup() {
    const backupDesc = Vue.ref('');
    const backups = Vue.ref([]);
    const auditLogs = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const showHospModal = Vue.ref(false);
    const hospForm = Vue.ref({ name: '', level: '' });
    const editingHospId = Vue.ref(null);
    const quota = Vue.ref(null);
    const editUsed = Vue.ref('');
    const _ctrl = new AbortController();

    // 检验项目分类
    const testItems = Vue.ref([]);
    const testItemCategoryFilter = Vue.ref('');

    const filteredTestItems = Vue.computed(() => {
      if (!testItemCategoryFilter.value) return testItems.value;
      return testItems.value.filter(it => it.category === testItemCategoryFilter.value);
    });
    const testItemCategories = Vue.computed(() => {
      const cats = [...new Set(testItems.value.map(it => it.category).filter(Boolean))];
      cats.sort();
      return cats;
    });
    function testItemsByCategory(cat) {
      return testItems.value.filter(it => it.category === cat);
    }

    const testItemColumns = [
      { key: 'code', label: '编码', align: 'center', mono: true },
      { key: 'standard_name', label: '标准名称', medium: true },
      { key: 'category', label: '分类', align: 'center' },
      { key: 'default_unit', label: '默认单位', align: 'center', muted: true },
    ];

    const hospitalColumns = [
      { key: 'name', label: '名称', medium: true },
      { key: 'level', label: '级别', align: 'center', muted: true },
      { key: 'actions', label: '操作', width: '8rem' },
    ];
    const backupColumns = [
      { key: 'filename', label: '文件名' },
      { key: 'description', label: '描述' },
      { key: 'file_size', label: '大小', align: 'center' },
      { key: 'created_at', label: '时间', align: 'center' },
      { key: 'actions', label: '操作', width: '6rem' },
    ];
    const auditColumns = [
      { key: 'action_label', label: '操作' },
      { key: 'entity_info', label: '采样日期/分类', align: 'center' },
      { key: 'created_at', label: '时间', align: 'center' },
    ];

    const quotaPct = Vue.computed(() => {
      if (!quota.value || quota.value.total_quota === 0) return 0;
      return Math.min(100, Math.round(quota.value.used_count / quota.value.total_quota * 100));
    });
    const quotaTextClass = Vue.computed(() => {
      if (!quota.value) return 'text-slate-500';
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return 'text-green-600 font-bold';
      if (remain > 10) return 'text-orange-500 font-bold';
      return 'text-red-600 font-bold';
    });
    const quotaBarClass = Vue.computed(() => {
      if (!quota.value) return 'bg-green-500';
      const remain = quota.value.total_quota - quota.value.used_count;
      if (remain > 50) return 'bg-green-500';
      if (remain > 10) return 'bg-orange-500';
      return 'bg-red-500';
    });

    function loadQuota() {
      api.getOCRQuota(_ctrl.signal).then(r => {
        if (r && r.data) { quota.value = r.data; editUsed.value = String(r.data.used_count); }
      });
    }
    function saveQuota() {
      if (!quota.value) return;
      const used = parseInt(editUsed.value);
      if (isNaN(used) || used < 0) return alert('请输入有效数字');
      api.updateOCRQuota({ year_month: quota.value.year_month, used_count: used }).then(r => {
        if (r.code === 0) { alert('用量已校准'); loadQuota(); }
        else alert(r.message || '校准失败');
      });
    }

    function loadBackups() { api.listBackups(_ctrl.signal).then(r => { if (r && r.data) backups.value = r.data; }); }
    function loadAudit() { api.listAuditLogs(null, _ctrl.signal).then(r => { if (r && r.data) auditLogs.value = r.data; }); }
    function loadHospitals() { api.listHospitals(_ctrl.signal).then(r => { if (r && r.data) hospitals.value = r.data; }); }
    function loadTestItems() { api.listTestItems(null, _ctrl.signal).then(r => { if (r && r.data) testItems.value = r.data; }); }
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

    function openHospModal(h) {
      if (h) {
        editingHospId.value = h.id;
        hospForm.value = deepClone({ name: h.name, level: h.level || '' });
      } else {
        editingHospId.value = null;
        hospForm.value = { name: '', level: '' };
      }
      showHospModal.value = true;
    }
    function saveHospital() {
      const fn = editingHospId.value ? api.updateHospital(editingHospId.value, hospForm.value) : api.createHospital(hospForm.value);
      fn.then(r => {
        if (r.code === 0) { showHospModal.value = false; loadHospitals(); }
        else alert(r.message || '保存失败');
      });
    }
    function deleteHospital(id) {
      if (!confirm('确认删除？')) return;
      api.deleteHospital(id).then(r => {
        if (r.code === 0) loadHospitals();
        else alert(r.message || '删除失败');
      });
    }

    Vue.onMounted(() => { loadBackups(); loadAudit(); loadHospitals(); loadQuota(); loadTestItems(); });
    Vue.onUnmounted(() => _ctrl.abort());
    return {
      backupDesc, backups, auditLogs, hospitals, showHospModal, hospForm, editingHospId,
      quota, editUsed, quotaPct, quotaTextClass, quotaBarClass,
      hospitalColumns, backupColumns, auditColumns, testItemColumns,
      testItems, filteredTestItems, testItemCategories, testItemCategoryFilter, testItemsByCategory,
      doExport, doImport, deleteBackup, openHospModal, saveHospital, deleteHospital, saveQuota
    };
  }
});
