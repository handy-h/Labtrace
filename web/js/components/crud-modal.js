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
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div :class="['modal-content', width]">
      <h2 class="modal-title">{{title}}</h2>
      <slot></slot>
      <div v-if="!hideFooter" class="modal-footer">
        <button @click="$emit('close')" class="btn btn-secondary">取消</button>
        <button @click="$emit('save')" class="btn btn-primary">保存</button>
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
