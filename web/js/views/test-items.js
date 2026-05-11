// test-items.js — 检验项目库视图
const TestItemsView = Vue.defineComponent({
  template: `
  <div class="page">
    <h1 class="page-title">检验项目库</h1>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">标准项目</div>
        <div class="stat-value">{{items.length}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">单位转换</div>
        <div class="stat-value">{{conversions.length}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">计算规则</div>
        <div class="stat-value">{{calcRules.length}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">医院规则</div>
        <div class="stat-value">{{hospitalRules.length}}</div>
      </div>
    </div>

    <!-- 检验项目表 -->
    <div class="card">
      <div class="toolbar">
        <select v-model="category" @change="load" class="form-select" style="width: auto">
          <option value="">全部分类</option><option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
        </select>
        <button @click="showAddItem = true" class="btn btn-primary btn-sm">+ 新增项目</button>
      </div>
      <data-table :columns="itemColumns" :data="items" empty-text="暂无项目">
        <template #cell-code="{ row }">
          <span class="cell-mono">{{row.code}}</span>
        </template>
        <template #cell-standard_name="{ row }">
          <span class="cell-medium">{{row.standard_name}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="viewAliases(row)" class="btn-ghost">别名</button>
          <button @click="viewRefIntervals(row)" class="btn-ghost">参考区间</button>
          <button @click="openEditItem(row)" class="btn-ghost">编辑</button>
          <button @click="deleteItem(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 单位转换 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div class="toolbar">
        <h2 class="page-subtitle" style="margin-bottom: 0">单位转换规则</h2>
        <button @click="openUcModal(null)" class="btn btn-primary btn-sm">+ 新增</button>
      </div>
      <data-table :columns="ucColumns" :data="conversions" empty-text="暂无转换规则">
        <template #cell-formula="{ row }">
          <span class="cell-mono">{{row.formula}}</span>
        </template>
        <template #cell-example="{ row }">
          {{row.example_input}} → {{row.example_output}}
        </template>
        <template #cell-actions="{ row }">
          <button @click="openUcModal(row)" class="btn-ghost">编辑</button>
          <button @click="deleteUc(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 计算规则 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div class="toolbar">
        <h2 class="page-subtitle" style="margin-bottom: 0">计算校验规则</h2>
        <button @click="openCrModal(null)" class="btn btn-primary btn-sm">+ 新增</button>
      </div>
      <data-table :columns="crColumns" :data="calcRules" empty-text="暂无规则">
        <template #cell-formula="{ row }">
          <span class="cell-mono">{{row.formula}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="openCrModal(row)" class="btn-ghost">编辑</button>
          <button @click="deleteCr(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- 医院解析规则 -->
    <div class="card" style="margin-top: var(--card-gap)">
      <div class="toolbar">
        <h2 class="page-subtitle" style="margin-bottom: 0">医院解析规则</h2>
        <select v-model="hrHospitalId" @change="loadHospitalRules" class="form-select" style="width: auto">
          <option value="">全部医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
        </select>
        <button @click="openHrModal(null)" class="btn btn-primary btn-sm">+ 新增</button>
      </div>
      <data-table :columns="hrColumns" :data="hospitalRules" empty-text="暂无规则">
        <template #cell-hospital_name="{ row }">
          {{row.hospital_name || row.hospital_id}}
        </template>
        <template #cell-column_mappings="{ row }">
          <span class="cell-mono text-xs cell-truncate">{{row.column_mappings}}</span>
        </template>
        <template #cell-actions="{ row }">
          <button @click="openHrModal(row)" class="btn-ghost">编辑</button>
          <button @click="deleteHr(row.id)" class="btn-ghost danger">删除</button>
        </template>
      </data-table>
    </div>

    <!-- ===== 弹窗区域 ===== -->

    <!-- 新增项目 -->
    <crud-modal title="新增检验项目" :visible="showAddItem" @close="showAddItem=false" @save="addItem">
      <input v-model="newItem.code" placeholder="编码" class="form-input mb-2">
      <input v-model="newItem.standard_name" placeholder="标准名称" class="form-input mb-2">
      <select v-model="newItem.category" class="form-select mb-2">
        <option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
      </select>
      <input v-model="newItem.default_unit" placeholder="默认单位" class="form-input mb-2">
      <select v-model="newItem.value_type" class="form-select">
        <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
      </select>
    </crud-modal>

    <!-- 编辑项目 -->
    <crud-modal title="编辑检验项目" :visible="showEditItem" @close="showEditItem=false" @save="saveEditItem">
      <input v-model="editItemForm.code" placeholder="编码" class="form-input mb-2">
      <input v-model="editItemForm.standard_name" placeholder="标准名称" class="form-input mb-2">
      <select v-model="editItemForm.category" class="form-select mb-2">
        <option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
      </select>
      <input v-model="editItemForm.default_unit" placeholder="默认单位" class="form-input mb-2">
      <select v-model="editItemForm.value_type" class="form-select">
        <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
      </select>
    </crud-modal>

    <!-- 别名管理 -->
    <div v-if="showAliasModal" class="modal-overlay" @click.self="showAliasModal=false">
      <div class="modal-content w-[500px]">
        <h2 class="modal-title">别名管理 — {{aliasTargetItem.standard_name}}</h2>
        <data-table :columns="aliasTableColumns" :data="aliasList" compact empty-text="暂无别名">
          <template #cell-actions="{ row }">
            <button @click="deleteAlias(row.id)" class="btn-ghost danger">删除</button>
          </template>
        </data-table>
        <div class="form-row" style="margin-top: 0.75rem">
          <input v-model="aliasForm.alias_name" placeholder="别名名称" class="form-input" style="flex:1">
          <select v-model="aliasForm.hospital_id" class="form-select" style="width: auto">
            <option value="">无医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
          </select>
          <button @click="addAlias" class="btn btn-primary btn-sm">新增</button>
        </div>
        <div class="modal-footer">
          <button @click="showAliasModal=false" class="btn btn-secondary">关闭</button>
        </div>
      </div>
    </div>

    <!-- 参考区间管理 -->
    <div v-if="showRefModal" class="modal-overlay" @click.self="showRefModal=false">
      <div class="modal-content w-[600px]">
        <h2 class="modal-title">参考区间 — {{refTargetItem.standard_name}}</h2>
        <data-table :columns="refTableColumns" :data="refList" compact empty-text="暂无参考区间">
          <template #cell-age_range="{ row }">
            {{row.age_min}}-{{row.age_max}}{{row.age_unit || '岁'}}
          </template>
          <template #cell-value_min="{ row }">
            {{row.value_min != null ? row.value_min : '-'}}
          </template>
          <template #cell-value_max="{ row }">
            {{row.value_max != null ? row.value_max : '-'}}
          </template>
          <template #cell-actions="{ row }">
            <button @click="openEditRef(row)" class="btn-ghost">编辑</button>
            <button @click="deleteRef(row.id)" class="btn-ghost danger">删除</button>
          </template>
        </data-table>

        <div class="modal-footer" style="flex-direction: column; align-items: stretch">
          <h3 class="text-sm font-semibold mb-2">{{editingRefId ? '编辑' : '新增'}}参考区间</h3>
          <div class="grid grid-cols-3 gap-2 mb-2">
            <select v-model="refForm.gender" class="form-select">
              <option value="不限">不限</option><option value="男">男</option><option value="女">女</option>
            </select>
            <input v-model.number="refForm.age_min" type="number" placeholder="年龄下限" class="form-input">
            <input v-model.number="refForm.age_max" type="number" placeholder="年龄上限" class="form-input">
          </div>
          <div class="grid grid-cols-3 gap-2 mb-2">
            <input v-model.number="refForm.value_min" type="number" placeholder="下限值" class="form-input">
            <input v-model.number="refForm.value_max" type="number" placeholder="上限值" class="form-input">
            <select v-model="refForm.value_type" class="form-select">
              <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
            </select>
          </div>
          <div v-if="refForm.value_type === 'qualitative'" class="mb-2">
            <input v-model="refForm.qualitative_value" placeholder="定性值(如: 阴性)" class="form-input">
          </div>
          <div class="flex gap-2 justify-end">
            <button v-if="editingRefId" @click="cancelEditRef" class="btn btn-secondary btn-sm">取消编辑</button>
            <button @click="saveRef" class="btn btn-primary btn-sm">{{editingRefId ? '更新' : '新增'}}</button>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showRefModal=false" class="btn btn-secondary">关闭</button>
        </div>
      </div>
    </div>

    <!-- 单位转换弹窗 -->
    <crud-modal :title="(editingUcId ? '编辑' : '新增') + '单位转换'" :visible="showUcModal" @close="showUcModal=false" @save="saveUc">
      <select v-model="ucForm.test_item_id" class="form-select mb-2">
        <option value="">选择项目</option><option v-for="it in items" :key="it.id" :value="it.id">{{it.standard_name}}</option>
      </select>
      <input v-model="ucForm.source_unit" placeholder="源单位" class="form-input mb-2">
      <input v-model="ucForm.target_unit" placeholder="目标单位" class="form-input mb-2">
      <input v-model="ucForm.formula" placeholder="公式 (如: x*18)" class="form-input mb-2">
      <input v-model="ucForm.example_input" placeholder="示例输入" class="form-input mb-2">
      <input v-model="ucForm.example_output" placeholder="示例输出" class="form-input">
    </crud-modal>

    <!-- 计算规则弹窗 -->
    <crud-modal :title="(editingCrId ? '编辑' : '新增') + '计算规则'" :visible="showCrModal" @close="showCrModal=false" @save="saveCr">
      <input v-model="crForm.name" placeholder="规则名称" class="form-input mb-2">
      <input v-model="crForm.formula" placeholder="公式 (如: TP=ALB+GLOB)" class="form-input mb-2">
      <input v-model="crForm.threshold" type="number" placeholder="偏差阈值" class="form-input mb-2">
      <input v-model="crForm.threshold_unit" placeholder="阈值单位" class="form-input">
    </crud-modal>

    <!-- 医院规则弹窗 -->
    <crud-modal :title="(editingHrId ? '编辑' : '新增') + '医院解析规则'" :visible="showHrModal" @close="showHrModal=false" @save="saveHr">
      <select v-model="hrForm.hospital_id" class="form-select mb-2">
        <option value="">选择医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
      </select>
      <input v-model="hrForm.rule_name" placeholder="规则名称" class="form-input mb-2">
      <textarea v-model="hrForm.column_mappings" placeholder="列映射 (JSON)" class="form-input mb-2" rows="3"></textarea>
      <textarea v-model="hrForm.unit_conversions" placeholder="单位转换 (JSON, 可选)" class="form-input mb-2" rows="2"></textarea>
      <input v-model="hrForm.notes_column" type="number" placeholder="备注列位置 (可选)" class="form-input">
    </crud-modal>
  </div>`,
  setup() {
    const items = Vue.ref([]);
    const conversions = Vue.ref([]);
    const calcRules = Vue.ref([]);
    const hospitalRules = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const category = Vue.ref('');

    const itemColumns = [
      { key: 'code', label: '编码', mono: true },
      { key: 'standard_name', label: '标准名称', medium: true },
      { key: 'category', label: '分类' },
      { key: 'default_unit', label: '默认单位' },
      { key: 'value_type', label: '类型' },
      { key: 'actions', label: '操作', width: '14rem' },
    ];
    const ucColumns = [
      { key: 'test_item_id', label: '项目ID', align: 'center' },
      { key: 'source_unit', label: '源单位' },
      { key: 'target_unit', label: '目标单位' },
      { key: 'formula', label: '公式', mono: true },
      { key: 'example', label: '示例' },
      { key: 'actions', label: '操作', width: '8rem' },
    ];
    const crColumns = [
      { key: 'name', label: '名称' },
      { key: 'formula', label: '公式', mono: true },
      { key: 'threshold', label: '阈值', align: 'center' },
      { key: 'actions', label: '操作', width: '8rem' },
    ];
    const hrColumns = [
      { key: 'hospital_name', label: '医院' },
      { key: 'rule_name', label: '规则名称' },
      { key: 'column_mappings', label: '列映射', truncate: true },
      { key: 'actions', label: '操作', width: '8rem' },
    ];
    const aliasTableColumns = [
      { key: 'alias_name', label: '别名' },
      { key: 'hospital_name', label: '来源医院' },
      { key: 'actions', label: '操作', width: '6rem' },
    ];
    const refTableColumns = [
      { key: 'gender', label: '性别', align: 'center' },
      { key: 'age_range', label: '年龄范围' },
      { key: 'value_min', label: '下限', align: 'center' },
      { key: 'value_max', label: '上限', align: 'center' },
      { key: 'value_type', label: '类型' },
      { key: 'actions', label: '操作', width: '8rem' },
    ];

    // 项目CRUD
    const showAddItem = Vue.ref(false);
    const newItem = Vue.ref({ code: '', standard_name: '', category: '血常规', default_unit: '', value_type: 'numeric' });
    const showEditItem = Vue.ref(false);
    const editItemForm = Vue.ref({});
    const editingItemId = Vue.ref(null);

    // 别名管理
    const showAliasModal = Vue.ref(false);
    const aliasTargetItem = Vue.ref({});
    const aliasList = Vue.ref([]);
    const aliasForm = Vue.ref({ alias_name: '', hospital_id: '' });

    // 参考区间
    const showRefModal = Vue.ref(false);
    const refTargetItem = Vue.ref({});
    const refList = Vue.ref([]);
    const refForm = Vue.ref({ gender: '不限', age_min: 0, age_max: 18, value_min: '', value_max: '', value_type: 'numeric', qualitative_value: '' });
    const editingRefId = Vue.ref(null);

    // 单位转换
    const showUcModal = Vue.ref(false);
    const ucForm = Vue.ref({ test_item_id: '', source_unit: '', target_unit: '', formula: '', example_input: '', example_output: '' });
    const editingUcId = Vue.ref(null);

    // 计算规则
    const showCrModal = Vue.ref(false);
    const crForm = Vue.ref({ name: '', formula: '', threshold: '', threshold_unit: '' });
    const editingCrId = Vue.ref(null);

    // 医院规则
    const showHrModal = Vue.ref(false);
    const hrForm = Vue.ref({ hospital_id: '', rule_name: '', column_mappings: '{}', unit_conversions: '{}', notes_column: '' });
    const editingHrId = Vue.ref(null);
    const hrHospitalId = Vue.ref('');

    function load() {
      api.listTestItems(category.value).then(r => { if (r.data) items.value = r.data; });
      api.listUnitConversions().then(r => { if (r.data) conversions.value = r.data; });
      api.listCalcRules().then(r => { if (r.data) calcRules.value = r.data; });
      api.listHospitals().then(r => { if (r.data) hospitals.value = r.data; });
      loadHospitalRules();
    }
    function loadHospitalRules() {
      api.listHospitalRules(hrHospitalId.value || undefined).then(r => { if (r.data) hospitalRules.value = r.data; });
    }

    function addItem() {
      api.createTestItem(newItem.value).then(r => {
        if (r.code === 0) { showAddItem.value = false; newItem.value = { code: '', standard_name: '', category: '血常规', default_unit: '', value_type: 'numeric' }; load(); }
      });
    }
    function openEditItem(it) {
      editingItemId.value = it.id;
      editItemForm.value = deepClone(it);
      showEditItem.value = true;
    }
    function saveEditItem() {
      api.updateTestItem(editingItemId.value, editItemForm.value).then(r => {
        if (r.code === 0) { showEditItem.value = false; load(); }
        else alert(r.message || '更新失败');
      });
    }
    function deleteItem(id) { if (confirm('确认删除？')) api.deleteTestItem(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); load(); }); }

    function viewAliases(it) {
      aliasTargetItem.value = it;
      aliasForm.value = { alias_name: '', hospital_id: '' };
      api.listAliases(it.id).then(r => { if (r.data) aliasList.value = r.data; });
      showAliasModal.value = true;
    }
    function addAlias() {
      if (!aliasForm.value.alias_name) return;
      api.createAlias(aliasTargetItem.value.id, aliasForm.value).then(r => {
        if (r.code === 0) { aliasForm.value = { alias_name: '', hospital_id: '' }; api.listAliases(aliasTargetItem.value.id).then(r2 => { if (r2.data) aliasList.value = r2.data; }); }
        else alert(r.message || '新增失败');
      });
    }
    function deleteAlias(id) {
      if (!confirm('确认删除？')) return;
      api.deleteAlias(id).then(r => {
        if (r.code === 0) api.listAliases(aliasTargetItem.value.id).then(r2 => { if (r2.data) aliasList.value = r2.data; });
        else alert(r.message || '删除失败');
      });
    }

    function viewRefIntervals(it) {
      refTargetItem.value = it;
      refForm.value = { gender: '不限', age_min: 0, age_max: 18, value_min: '', value_max: '', value_type: 'numeric', qualitative_value: '' };
      editingRefId.value = null;
      api.listRefIntervals(it.id).then(r => { if (r.data) refList.value = r.data; });
      showRefModal.value = true;
    }
    function openEditRef(ri) {
      editingRefId.value = ri.id;
      refForm.value = deepClone({ gender: ri.gender, age_min: ri.age_min, age_max: ri.age_max, value_min: ri.value_min, value_max: ri.value_max, value_type: ri.value_type, qualitative_value: ri.qualitative_value || '' });
    }
    function cancelEditRef() {
      editingRefId.value = null;
      refForm.value = { gender: '不限', age_min: 0, age_max: 18, value_min: '', value_max: '', value_type: 'numeric', qualitative_value: '' };
    }
    function saveRef() {
      if (refForm.value.age_min >= refForm.value.age_max) return alert('年龄下限不能大于上限');
      if (editingRefId.value) {
        api.updateRefInterval(editingRefId.value, refForm.value).then(r => {
          if (r.code === 0) { cancelEditRef(); api.listRefIntervals(refTargetItem.value.id).then(r2 => { if (r2.data) refList.value = r2.data; }); }
          else alert(r.message || '更新失败');
        });
      } else {
        api.createRefInterval(refTargetItem.value.id, refForm.value).then(r => {
          if (r.code === 0) { cancelEditRef(); api.listRefIntervals(refTargetItem.value.id).then(r2 => { if (r2.data) refList.value = r2.data; }); }
          else alert(r.message || '新增失败');
        });
      }
    }
    function deleteRef(id) {
      if (!confirm('确认删除？')) return;
      api.deleteRefInterval(id).then(r => {
        if (r.code === 0) api.listRefIntervals(refTargetItem.value.id).then(r2 => { if (r2.data) refList.value = r2.data; });
      });
    }

    function openUcModal(uc) {
      if (uc) { editingUcId.value = uc.id; ucForm.value = deepClone(uc); }
      else { editingUcId.value = null; ucForm.value = { test_item_id: '', source_unit: '', target_unit: '', formula: '', example_input: '', example_output: '' }; }
      showUcModal.value = true;
    }
    function saveUc() {
      const fn = editingUcId.value ? api.updateUnitConversion(editingUcId.value, ucForm.value) : api.createUnitConversion(ucForm.value);
      fn.then(r => { if (r.code === 0) { showUcModal.value = false; load(); } else alert(r.message || '保存失败'); });
    }
    function deleteUc(id) { if (confirm('确认删除？')) api.deleteUnitConversion(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); load(); }); }

    function openCrModal(cr) {
      if (cr) { editingCrId.value = cr.id; crForm.value = deepClone(cr); }
      else { editingCrId.value = null; crForm.value = { name: '', formula: '', threshold: '', threshold_unit: '' }; }
      showCrModal.value = true;
    }
    function saveCr() {
      const fn = editingCrId.value ? api.updateCalcRule(editingCrId.value, crForm.value) : api.createCalcRule(crForm.value);
      fn.then(r => { if (r.code === 0) { showCrModal.value = false; load(); } else alert(r.message || '保存失败'); });
    }
    function deleteCr(id) { if (confirm('确认删除？')) api.deleteCalcRule(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); load(); }); }

    function openHrModal(hr) {
      if (hr) {
        editingHrId.value = hr.id;
        hrForm.value = deepClone({ hospital_id: hr.hospital_id, rule_name: hr.rule_name, column_mappings: hr.column_mappings, unit_conversions: hr.unit_conversions || '{}', notes_column: hr.notes_column || '' });
      } else {
        editingHrId.value = null;
        hrForm.value = { hospital_id: '', rule_name: '', column_mappings: '{}', unit_conversions: '{}', notes_column: '' };
      }
      showHrModal.value = true;
    }
    function saveHr() {
      const fn = editingHrId.value ? api.updateHospitalRule(editingHrId.value, hrForm.value) : api.createHospitalRule(hrForm.value);
      fn.then(r => { if (r.code === 0) { showHrModal.value = false; loadHospitalRules(); } else alert(r.message || '保存失败'); });
    }
    function deleteHr(id) { if (confirm('确认删除？')) api.deleteHospitalRule(id).then(r => { if (r.code === 0) loadHospitalRules(); else alert(r.message || '删除失败'); }); }

    load();
    return {
      items, conversions, calcRules, hospitalRules, hospitals, category,
      itemColumns, ucColumns, crColumns, hrColumns, aliasTableColumns, refTableColumns,
      showAddItem, newItem, addItem,
      showEditItem, editItemForm, openEditItem, saveEditItem, deleteItem,
      showAliasModal, aliasTargetItem, aliasList, aliasForm, viewAliases, addAlias, deleteAlias,
      showRefModal, refTargetItem, refList, refForm, editingRefId, viewRefIntervals, openEditRef, cancelEditRef, saveRef, deleteRef,
      showUcModal, ucForm, editingUcId, openUcModal, saveUc, deleteUc,
      showCrModal, crForm, editingCrId, openCrModal, saveCr, deleteCr,
      showHrModal, hrForm, editingHrId, hrHospitalId, openHrModal, saveHr, deleteHr, loadHospitalRules,
      load
    };
  }
});
