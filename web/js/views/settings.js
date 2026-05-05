// settings.js — 设置视图（增强：医院管理区）
const SettingsView = Vue.defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">设置</h1>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h2 class="font-semibold mb-2">数据库加密</h2>
      <p class="text-sm text-slate-500">加密状态: <span class="text-green-600">已启用</span> (密钥来自 .env)</p>
    </div>
    <!-- 医院管理 -->
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-center mb-2">
        <h2 class="font-semibold">医院管理</h2>
        <button @click="openHospModal(null)" class="px-2 py-1 bg-blue-600 text-white rounded text-xs">+ 新增医院</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">名称</th><th class="p-2">地址</th><th class="p-2">操作</th></tr></thead>
        <tbody>
          <tr v-for="h in hospitals" :key="h.id" class="border-t">
            <td class="p-2 font-medium">{{h.name}}</td>
            <td class="p-2 text-slate-500">{{h.address || '-'}}</td>
            <td class="p-2">
              <button @click="openHospModal(h)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
              <button @click="deleteHospital(h.id)" class="text-red-600 hover:underline text-xs">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 医院弹窗 -->
    <div v-if="showHospModal" class="drill-modal" @click.self="showHospModal=false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">{{editingHospId ? '编辑' : '新增'}}医院</h2>
      <input v-model="hospForm.name" placeholder="医院名称" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="hospForm.address" placeholder="地址(可选)" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showHospModal=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveHospital" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>
    <!-- 备份与恢复 -->
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
    const backupDesc = Vue.ref('');
    const backups = Vue.ref([]);
    const auditLogs = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const showHospModal = Vue.ref(false);
    const hospForm = Vue.ref({ name: '', address: '' });
    const editingHospId = Vue.ref(null);

    function loadBackups() { api.listBackups().then(r => { if (r.data) backups.value = r.data; }); }
    function loadAudit() { api.listAuditLogs().then(r => { if (r.data) auditLogs.value = r.data; }); }
    function loadHospitals() { api.listHospitals().then(r => { if (r.data) hospitals.value = r.data; }); }
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

    // 医院CRUD
    function openHospModal(h) {
      if (h) {
        editingHospId.value = h.id;
        hospForm.value = deepClone({ name: h.name, address: h.address || '' });
      } else {
        editingHospId.value = null;
        hospForm.value = { name: '', address: '' };
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

    Vue.onMounted(() => { loadBackups(); loadAudit(); loadHospitals(); });
    return { backupDesc, backups, auditLogs, hospitals, showHospModal, hospForm, editingHospId, doExport, doImport, deleteBackup, openHospModal, saveHospital, deleteHospital };
  }
});
