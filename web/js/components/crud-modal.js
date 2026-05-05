// crud-modal.js — 通用CRUD弹窗组件
const CrudModal = Vue.defineComponent({
  name: 'CrudModal',
  props: {
    title: { type: String, default: '' },
    visible: { type: Boolean, default: false },
    width: { type: String, default: 'w-96' },
    hideFooter: { type: Boolean, default: false },
  },
  emits: ['close', 'save'],
  template: `
  <div v-if="visible" class="drill-modal" @click.self="$emit('close')">
    <div :class="width">
      <h2 class="text-lg font-bold mb-4">{{title}}</h2>
      <slot></slot>
      <div v-if="!hideFooter" class="flex gap-2 justify-end mt-4">
        <button @click="$emit('close')" class="px-4 py-2 border rounded text-sm hover:bg-slate-50">取消</button>
        <button @click="$emit('save')" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
      </div>
    </div>
  </div>`,
  setup(props, { emit }) {
    function onKeydown(e) {
      if (e.key === 'Escape' && props.visible) {
        emit('close');
      }
    }
    Vue.onMounted(() => document.addEventListener('keydown', onKeydown));
    Vue.onUnmounted(() => document.removeEventListener('keydown', onKeydown));
  }
});
