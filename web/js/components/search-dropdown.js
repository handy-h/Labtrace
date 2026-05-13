// search-dropdown.js — 全局搜索下拉面板组件
const SearchDropdown = Vue.defineComponent({
  name: 'SearchDropdown',
  props: {
    query: { type: String, default: '' },
  },
  emits: ['navigate'],
  template: `
  <div ref="rootEl" v-if="visible && query" class="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border max-h-80 overflow-auto z-50">
    <div v-if="loading" class="p-3 text-sm text-slate-400">搜索中...</div>
    <template v-else>
      <div v-if="results.subjects.length" class="border-b">
        <div class="px-3 py-1.5 text-xs text-slate-500 bg-slate-50 font-semibold">受检者</div>
        <div v-for="s in results.subjects" :key="'s-'+s.id"
             @click="clickItem('subjects', s.id, s.name)"
             class="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer flex items-center gap-2">
          <span class="text-slate-400">👤</span><span>{{s.name}}</span>
        </div>
      </div>
      <div v-if="results.testItems.length" class="border-b">
        <div class="px-3 py-1.5 text-xs text-slate-500 bg-slate-50 font-semibold">检验项目</div>
        <div v-for="it in results.testItems" :key="'t-'+it.id"
             @click="clickItem('test-items', it.id, it.standard_name)"
             class="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer flex items-center gap-2">
          <span class="text-slate-400">🧪</span><span>{{it.standard_name}}</span>
        </div>
      </div>
      <div v-if="!results.subjects.length && !results.testItems.length" class="p-3 text-sm text-slate-400">未找到匹配结果</div>
    </template>
  </div>`,
  setup(props, { emit }) {
    const results = Vue.reactive({ subjects: [], testItems: [] });
    const loading = Vue.ref(false);
    const visible = Vue.ref(false);
    const rootEl = Vue.ref(null);

    const doSearch = debounce(async (q) => {
      if (!q.trim()) {
        results.subjects = [];
        results.testItems = [];
        visible.value = false;
        return;
      }
      loading.value = true;
      visible.value = true;
      try {
        const [sr, tr] = await Promise.all([
          api.listSubjects(q),
          api.listTestItems()
        ]);
        results.subjects = sr.data || [];
        const allItems = tr.data || [];
        results.testItems = allItems.filter(it =>
          it.standard_name.includes(q) || it.code.includes(q)
        );
      } catch (e) {
        // 搜索错误静默处理
      }
      loading.value = false;
    }, 300);

    Vue.watch(() => props.query, (q) => {
      doSearch(q);
    });

    function clickItem(view, id, name) {
      emit('navigate', view, id, name);
      visible.value = false;
    }

    function onClickOutside(e) {
      if (rootEl.value && !rootEl.value.contains(e.target)) {
        visible.value = false;
      }
    }

    Vue.onMounted(() => {
      document.addEventListener('click', onClickOutside, true);
    });

    Vue.onUnmounted(() => {
      document.removeEventListener('click', onClickOutside, true);
    });

    return { results, loading, visible, rootEl, clickItem };
  }
});
