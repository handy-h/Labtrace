// test-items.js — 检验项目库视图（增强：别名弹窗+参考区间弹窗+编辑弹窗+单位转换CRUD+计算规则CRUD+医院规则管理）
const TestItemsView = Vue.defineComponent({
  template: `
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">检验项目库</h1>
    <div class="grid grid-cols-4 gap-4 mb-4">
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">标准项目</span> <span class="font-bold">{{items.length}}</span></div>
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">单位转换</span> <span class="font-bold">{{conversions.length}}</span></div>
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">计算规则</span> <span class="font-bold">{{calcRules.length}}</span></div>
      <div class="bg-white rounded-lg p-3 shadow-sm text-sm"><span class="text-slate-500">医院规则</span> <span class="font-bold">{{hospitalRules.length}}</span></div>
    </div>
    <!-- 检验项目表 -->
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
            <td class="p-2">
              <button @click="viewAliases(it)" class="text-blue-600 hover:underline text-xs mr-1">别名</button>
              <button @click="viewRefIntervals(it)" class="text-blue-600 hover:underline text-xs mr-1">参考区间</button>
              <button @click="openEditItem(it)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
              <button @click="deleteItem(it.id)" class="text-red-600 hover:underline text-xs">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 单位转换 -->
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-center mb-2">
        <h2 class="font-semibold">单位转换规则</h2>
        <button @click="openUcModal(null)" class="px-2 py-1 bg-blue-600 text-white rounded text-xs">+ 新增</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">项目ID</th><th class="p-2">源单位</th><th class="p-2">目标单位</th><th class="p-2">公式</th><th class="p-2">示例</th><th class="p-2">操作</th></tr></thead>
        <tbody><tr v-for="uc in conversions" :key="uc.id" class="border-t">
          <td class="p-2">{{uc.test_item_id}}</td><td class="p-2">{{uc.source_unit}}</td><td class="p-2">{{uc.target_unit}}</td>
          <td class="p-2 font-mono">{{uc.formula}}</td><td class="p-2">{{uc.example_input}} → {{uc.example_output}}</td>
          <td class="p-2">
            <button @click="openUcModal(uc)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
            <button @click="deleteUc(uc.id)" class="text-red-600 hover:underline text-xs">删除</button>
          </td>
        </tr></tbody>
      </table>
    </div>
    <!-- 计算规则 -->
    <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <div class="flex gap-3 items-center mb-2">
        <h2 class="font-semibold">计算校验规则</h2>
        <button @click="openCrModal(null)" class="px-2 py-1 bg-blue-600 text-white rounded text-xs">+ 新增</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">名称</th><th class="p-2">公式</th><th class="p-2">阈值</th><th class="p-2">操作</th></tr></thead>
        <tbody><tr v-for="r in calcRules" :key="r.id" class="border-t">
          <td class="p-2">{{r.name}}</td><td class="p-2 font-mono">{{r.formula}}</td><td class="p-2">{{r.threshold}}</td>
          <td class="p-2">
            <button @click="openCrModal(r)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
            <button @click="deleteCr(r.id)" class="text-red-600 hover:underline text-xs">删除</button>
          </td>
        </tr></tbody>
      </table>
    </div>
    <!-- 医院解析规则 -->
    <div class="bg-white rounded-lg shadow-sm p-4">
      <div class="flex gap-3 items-center mb-2">
        <h2 class="font-semibold">医院解析规则</h2>
        <select v-model="hrHospitalId" @change="loadHospitalRules" class="border rounded px-2 py-1 text-sm">
          <option value="">全部医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
        </select>
        <button @click="openHrModal(null)" class="px-2 py-1 bg-blue-600 text-white rounded text-xs">+ 新增</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50"><th class="p-2">医院</th><th class="p-2">规则名称</th><th class="p-2">列映射</th><th class="p-2">操作</th></tr></thead>
        <tbody><tr v-for="hr in hospitalRules" :key="hr.id" class="border-t">
          <td class="p-2">{{hr.hospital_name || hr.hospital_id}}</td>
          <td class="p-2">{{hr.rule_name}}</td>
          <td class="p-2 font-mono text-xs truncate max-w-xs">{{hr.column_mappings}}</td>
          <td class="p-2">
            <button @click="openHrModal(hr)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
            <button @click="deleteHr(hr.id)" class="text-red-600 hover:underline text-xs">删除</button>
          </td>
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

    <!-- 编辑项目弹窗 -->
    <div v-if="showEditItem" class="drill-modal" @click.self="showEditItem=false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">编辑检验项目</h2>
      <input v-model="editItemForm.code" placeholder="编码" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="editItemForm.standard_name" placeholder="标准名称" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="editItemForm.category" class="w-full border p-2 rounded mb-2 text-sm">
        <option value="血常规">血常规</option><option value="生化">生化</option><option value="免疫">免疫</option><option value="其他">其他</option>
      </select>
      <input v-model="editItemForm.default_unit" placeholder="默认单位" class="w-full border p-2 rounded mb-2 text-sm">
      <select v-model="editItemForm.value_type" class="w-full border p-2 rounded mb-4 text-sm">
        <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
      </select>
      <div class="flex gap-2 justify-end">
        <button @click="showEditItem=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveEditItem" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>

    <!-- 别名管理弹窗 -->
    <div v-if="showAliasModal" class="drill-modal" @click.self="showAliasModal=false"><div class="w-[500px]">
      <h2 class="text-lg font-bold mb-4">别名管理 — {{aliasTargetItem.standard_name}}</h2>
      <table class="w-full text-sm mb-4">
        <thead><tr class="bg-slate-50"><th class="p-2">别名</th><th class="p-2">来源医院</th><th class="p-2">操作</th></tr></thead>
        <tbody>
          <tr v-for="a in aliasList" :key="a.id" class="border-t">
            <td class="p-2">{{a.alias_name}}</td><td class="p-2">{{a.hospital_name || '-'}}</td>
            <td class="p-2"><button @click="deleteAlias(a.id)" class="text-red-600 hover:underline text-xs">删除</button></td>
          </tr>
          <tr v-if="!aliasList.length"><td colspan="3" class="p-2 text-slate-400 text-center">暂无别名</td></tr>
        </tbody>
      </table>
      <div class="flex gap-2 items-end">
        <input v-model="aliasForm.alias_name" placeholder="别名名称" class="border rounded px-2 py-1 text-sm flex-1">
        <select v-model="aliasForm.hospital_id" class="border rounded px-2 py-1 text-sm">
          <option value="">无医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
        </select>
        <button @click="addAlias" class="px-3 py-1 bg-blue-600 text-white rounded text-sm">新增</button>
      </div>
      <div class="flex justify-end mt-4">
        <button @click="showAliasModal=false" class="px-4 py-2 border rounded text-sm">关闭</button>
      </div>
    </div></div>

    <!-- 参考区间管理弹窗 -->
    <div v-if="showRefModal" class="drill-modal" @click.self="showRefModal=false"><div class="w-[600px] max-h-[70vh] overflow-auto">
      <h2 class="text-lg font-bold mb-4">参考区间 — {{refTargetItem.standard_name}}</h2>
      <table class="w-full text-sm mb-4">
        <thead><tr class="bg-slate-50"><th class="p-2">性别</th><th class="p-2">年龄范围</th><th class="p-2">下限</th><th class="p-2">上限</th><th class="p-2">类型</th><th class="p-2">操作</th></tr></thead>
        <tbody>
          <tr v-for="ri in refList" :key="ri.id" class="border-t">
            <td class="p-2">{{ri.gender}}</td>
            <td class="p-2">{{ri.age_min}}-{{ri.age_max}}{{ri.age_unit || '岁'}}</td>
            <td class="p-2">{{ri.value_min != null ? ri.value_min : '-'}}</td>
            <td class="p-2">{{ri.value_max != null ? ri.value_max : '-'}}</td>
            <td class="p-2">{{ri.value_type}}</td>
            <td class="p-2">
              <button @click="openEditRef(ri)" class="text-blue-600 hover:underline text-xs mr-1">编辑</button>
              <button @click="deleteRef(ri.id)" class="text-red-600 hover:underline text-xs">删除</button>
            </td>
          </tr>
          <tr v-if="!refList.length"><td colspan="6" class="p-2 text-slate-400 text-center">暂无参考区间</td></tr>
        </tbody>
      </table>
      <div class="border-t pt-3">
        <h3 class="text-sm font-semibold mb-2">{{editingRefId ? '编辑' : '新增'}}参考区间</h3>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <select v-model="refForm.gender" class="border rounded px-2 py-1 text-sm">
            <option value="不限">不限</option><option value="男">男</option><option value="女">女</option>
          </select>
          <input v-model.number="refForm.age_min" type="number" placeholder="年龄下限" class="border rounded px-2 py-1 text-sm">
          <input v-model.number="refForm.age_max" type="number" placeholder="年龄上限" class="border rounded px-2 py-1 text-sm">
        </div>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <input v-model.number="refForm.value_min" type="number" placeholder="下限值" class="border rounded px-2 py-1 text-sm">
          <input v-model.number="refForm.value_max" type="number" placeholder="上限值" class="border rounded px-2 py-1 text-sm">
          <select v-model="refForm.value_type" class="border rounded px-2 py-1 text-sm">
            <option value="numeric">数值型</option><option value="titer">滴度型</option><option value="qualitative">半定量</option>
          </select>
        </div>
        <div v-if="refForm.value_type === 'qualitative'" class="mb-2">
          <input v-model="refForm.qualitative_value" placeholder="定性值(如: 阴性)" class="border rounded px-2 py-1 text-sm w-full">
        </div>
        <div class="flex gap-2 justify-end">
          <button v-if="editingRefId" @click="cancelEditRef" class="px-3 py-1 border rounded text-sm">取消编辑</button>
          <button @click="saveRef" class="px-3 py-1 bg-blue-600 text-white rounded text-sm">{{editingRefId ? '更新' : '新增'}}</button>
        </div>
      </div>
      <div class="flex justify-end mt-4">
        <button @click="showRefModal=false" class="px-4 py-2 border rounded text-sm">关闭</button>
      </div>
    </div></div>

    <!-- 单位转换弹窗 -->
    <div v-if="showUcModal" class="drill-modal" @click.self="showUcModal=false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">{{editingUcId ? '编辑' : '新增'}}单位转换</h2>
      <select v-model="ucForm.test_item_id" class="w-full border p-2 rounded mb-2 text-sm">
        <option value="">选择项目</option><option v-for="it in items" :key="it.id" :value="it.id">{{it.standard_name}}</option>
      </select>
      <input v-model="ucForm.source_unit" placeholder="源单位" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="ucForm.target_unit" placeholder="目标单位" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="ucForm.formula" placeholder="公式 (如: x*18)" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="ucForm.example_input" placeholder="示例输入" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="ucForm.example_output" placeholder="示例输出" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showUcModal=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveUc" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>

    <!-- 计算规则弹窗 -->
    <div v-if="showCrModal" class="drill-modal" @click.self="showCrModal=false"><div class="w-96">
      <h2 class="text-lg font-bold mb-4">{{editingCrId ? '编辑' : '新增'}}计算规则</h2>
      <input v-model="crForm.name" placeholder="规则名称" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="crForm.formula" placeholder="公式 (如: TP=ALB+GLOB)" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="crForm.threshold" type="number" placeholder="偏差阈值" class="w-full border p-2 rounded mb-2 text-sm">
      <input v-model="crForm.threshold_unit" placeholder="阈值单位" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showCrModal=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveCr" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>

    <!-- 医院规则弹窗 -->
    <div v-if="showHrModal" class="drill-modal" @click.self="showHrModal=false"><div class="w-[500px]">
      <h2 class="text-lg font-bold mb-4">{{editingHrId ? '编辑' : '新增'}}医院解析规则</h2>
      <select v-model="hrForm.hospital_id" class="w-full border p-2 rounded mb-2 text-sm">
        <option value="">选择医院</option><option v-for="h in hospitals" :key="h.id" :value="h.id">{{h.name}}</option>
      </select>
      <input v-model="hrForm.rule_name" placeholder="规则名称" class="w-full border p-2 rounded mb-2 text-sm">
      <textarea v-model="hrForm.column_mappings" placeholder="列映射 (JSON)" class="w-full border p-2 rounded mb-2 text-sm" rows="3"></textarea>
      <textarea v-model="hrForm.unit_conversions" placeholder="单位转换 (JSON, 可选)" class="w-full border p-2 rounded mb-2 text-sm" rows="2"></textarea>
      <input v-model="hrForm.notes_column" type="number" placeholder="备注列位置 (可选)" class="w-full border p-2 rounded mb-4 text-sm">
      <div class="flex gap-2 justify-end">
        <button @click="showHrModal=false" class="px-4 py-2 border rounded text-sm">取消</button>
        <button @click="saveHr" class="px-4 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
      </div>
    </div></div>
  </div>`,
  setup() {
    const items = Vue.ref([]);
    const conversions = Vue.ref([]);
    const calcRules = Vue.ref([]);
    const hospitalRules = Vue.ref([]);
    const hospitals = Vue.ref([]);
    const category = Vue.ref('');
    const showAddItem = Vue.ref(false);
    const newItem = Vue.ref({ code: '', standard_name: '', category: '血常规', default_unit: '', value_type: 'numeric' });

    // 编辑项目
    const showEditItem = Vue.ref(false);
    const editItemForm = Vue.ref({});
    const editingItemId = Vue.ref(null);

    // 别名管理
    const showAliasModal = Vue.ref(false);
    const aliasTargetItem = Vue.ref({});
    const aliasList = Vue.ref([]);
    const aliasForm = Vue.ref({ alias_name: '', hospital_id: '' });

    // 参考区间管理
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

    // 项目CRUD
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

    // 别名管理
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

    // 参考区间管理
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
        else alert(r.message || '删除失败');
      });
    }

    // 单位转换CRUD
    function openUcModal(uc) {
      if (uc) {
        editingUcId.value = uc.id;
        ucForm.value = deepClone(uc);
      } else {
        editingUcId.value = null;
        ucForm.value = { test_item_id: '', source_unit: '', target_unit: '', formula: '', example_input: '', example_output: '' };
      }
      showUcModal.value = true;
    }
    function saveUc() {
      const fn = editingUcId.value ? api.updateUnitConversion(editingUcId.value, ucForm.value) : api.createUnitConversion(ucForm.value);
      fn.then(r => {
        if (r.code === 0) { showUcModal.value = false; load(); }
        else alert(r.message || '保存失败');
      });
    }
    function deleteUc(id) { if (confirm('确认删除？')) api.deleteUnitConversion(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); load(); }); }

    // 计算规则CRUD
    function openCrModal(cr) {
      if (cr) {
        editingCrId.value = cr.id;
        crForm.value = deepClone(cr);
      } else {
        editingCrId.value = null;
        crForm.value = { name: '', formula: '', threshold: '', threshold_unit: '' };
      }
      showCrModal.value = true;
    }
    function saveCr() {
      const fn = editingCrId.value ? api.updateCalcRule(editingCrId.value, crForm.value) : api.createCalcRule(crForm.value);
      fn.then(r => {
        if (r.code === 0) { showCrModal.value = false; load(); }
        else alert(r.message || '保存失败');
      });
    }
    function deleteCr(id) { if (confirm('确认删除？')) api.deleteCalcRule(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); load(); }); }

    // 医院规则CRUD
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
      fn.then(r => {
        if (r.code === 0) { showHrModal.value = false; loadHospitalRules(); }
        else alert(r.message || '保存失败');
      });
    }
    function deleteHr(id) { if (confirm('确认删除？')) api.deleteHospitalRule(id).then(r => { if (r.code !== 0) alert(r.message || '删除失败'); loadHospitalRules(); }); }

    load();
    return {
      items, conversions, calcRules, hospitalRules, hospitals, category,
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
