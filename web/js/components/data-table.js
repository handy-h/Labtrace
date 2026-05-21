// data-table.js — 通用数据表格组件
const DataTable = Vue.defineComponent({
  name: 'DataTable',
  props: {
    columns: { type: Array, required: true },
    // columns: [{ key, label, align?, mono?, muted?, truncate?, width?, sortable? }]
    data: { type: Array, default: () => [] },
    striped: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    emptyText: { type: String, default: '暂无数据' },
    rowKey: { type: String, default: 'id' },
    sortField: { type: String, default: '' },
    sortOrder: { type: String, default: '' },
  },
  emits: ['row-click', 'update:sortField', 'update:sortOrder'],
  template: `
    <div class="table-wrap">
      <table :class="['lt-table', { striped, compact }]">
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key"
                :style="{ ...(col.width ? { width: col.width } : {}), ...(col.sortable ? { cursor: 'pointer', userSelect: 'none' } : {}) }"
                :class="{ 'cell-center': col.align === 'center', 'cell-right': col.align === 'right' }"
                @click="col.sortable ? toggleSort(col.key) : null">
              {{ col.label }}
              <span v-if="col.sortable && sortField === col.key" style="margin-left: 4px; font-size: 0.75rem">
                {{ sortOrder === 'asc' ? '▲' : '▼' }}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!data.length">
            <td :colspan="columns.length" class="empty-state">{{ emptyText }}</td>
          </tr>
          <tr v-for="(row, idx) in data" :key="row[rowKey] ?? idx"
              @click="$emit('row-click', row)"
              :class="{ 'cursor-pointer': $attrs.onRowClick }">
            <td v-for="col in columns" :key="col.key"
                :class="{
                  'cell-mono': col.mono,
                  'cell-medium': col.medium,
                  'cell-center': col.align === 'center',
                  'cell-right': col.align === 'right',
                  'cell-muted': col.muted,
                  'cell-truncate': col.truncate,
                }">
              <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]" :index="idx">
                {{ row[col.key] ?? '-' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  methods: {
    toggleSort(key) {
      if (this.sortField === key) {
        const newOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        this.$emit('update:sortOrder', newOrder);
      } else {
        this.$emit('update:sortField', key);
        this.$emit('update:sortOrder', 'desc');
      }
    }
  }
});
