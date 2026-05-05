// subject-selector.js — 受检者切换选择器组件
const SubjectSelector = Vue.defineComponent({
  name: 'SubjectSelector',
  props: {
    subjects: { type: Array, default: () => [] },
    currentId: { type: [Number, String], default: null },
    currentName: { type: String, default: '未选择' },
  },
  emits: ['change'],
  template: `
  <div class="relative" v-click-outside="close">
    <span class="cursor-pointer hover:text-white" @click="open = !open">
      受检者: <span :class="currentId ? 'text-blue-400' : ''">{{currentId ? currentName : '未选择'}}</span>
    </span>
    <div v-if="open" class="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border z-50 text-slate-800">
      <div class="p-2">
        <input v-model="filterText" placeholder="搜索受检者..." class="w-full border rounded px-2 py-1 text-sm" @click.stop>
      </div>
      <div class="max-h-60 overflow-auto">
        <div v-for="s in filteredSubjects" :key="s.id"
             @click="select(s)"
             :class="['px-3 py-2 text-sm cursor-pointer hover:bg-blue-50', s.id == currentId ? 'bg-blue-100 font-medium' : '']">
          {{s.name}} <span class="text-slate-400 text-xs">({{s.gender}})</span>
        </div>
        <div v-if="!filteredSubjects.length" class="px-3 py-2 text-sm text-slate-400">无匹配结果</div>
      </div>
    </div>
  </div>`,
  setup(props, { emit }) {
    const open = Vue.ref(false);
    const filterText = Vue.ref('');

    const filteredSubjects = Vue.computed(() => {
      if (!filterText.value) return props.subjects;
      const q = filterText.value.toLowerCase();
      return props.subjects.filter(s => s.name.toLowerCase().includes(q));
    });

    function select(s) {
      emit('change', s.id, s.name);
      open.value = false;
      filterText.value = '';
    }

    function close() {
      open.value = false;
    }

    // 点击外部关闭
    function onClickDocument(e) {
      if (open.value && !e.target.closest('.relative')) {
        open.value = false;
      }
    }
    Vue.onMounted(() => document.addEventListener('click', onClickDocument));
    Vue.onUnmounted(() => document.removeEventListener('click', onClickDocument));

    return { open, filterText, filteredSubjects, select, close };
  }
});
