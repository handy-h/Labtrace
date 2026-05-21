// ocr-mapping-wizard.js — 自定义列映射三步向导
// Step 1: 框选表格区域（Canvas拖拽）
// Step 2: 表头列角色映射（卡片流）
// Step 3: 单元格微调 + 分割 + 撤销
const OCRMappingWizard = Vue.defineComponent({
  name: "OCRMappingWizard",
  props: {
    visible: { type: Boolean, default: false },
    reportId: { type: [Number, String], default: null },
    hospitalId: { type: [Number, String], default: null },
    reportImageUrl: { type: String, default: "" },
    filePath: { type: String, default: "" },
  },
  emits: ["close", "done"],

  template: `
<teleport to="body">
<div v-if="visible"
     class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
     @mousedown.self="$emit('close')">
  <!-- 隐藏图片加载器：仅对图片文件生效，PDF 跳过 -->
  <img v-if="!isPdf"
       ref="sourceImgRef"
       :src="reportImageUrl"
       @load="onSourceImageLoad"
       @error="onSourceImageError"
       style="display:none;position:absolute;pointer-events:none;">
  <div class="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
       style="width:96vw;height:92vh;max-width:1400px;">

    <!-- ── 顶栏：步骤指示器 ── -->
    <div class="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0">
      <div class="flex items-center gap-1">
        <template v-for="(s, i) in steps" :key="i">
          <div :class="['flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all',
            step > i+1  ? 'bg-green-100 text-green-700' :
            step === i+1 ? 'bg-blue-600 text-white shadow' :
                           'bg-slate-100 text-slate-400']">
            <span v-if="step > i+1" class="text-xs">✓</span>
            <span v-else class="text-xs font-bold">{{i+1}}</span>
            <span>{{s}}</span>
          </div>
          <div v-if="i < steps.length-1"
               :class="['w-6 h-0.5 transition-colors', step > i+1 ? 'bg-green-400' : 'bg-slate-200']">
          </div>
        </template>
      </div>
      <button @click="$emit('close')"
              class="text-slate-400 hover:text-slate-700 text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100">
        ✕
      </button>
    </div>

    <!-- ════ STEP 1：框选区域 ════ -->
    <!-- ╔╔╔╔ STEP 1：框选区域 ╔╔╔╔ -->
    <div v-if="step===1" class="flex flex-1 min-h-0">

      <!-- 无位置信息模式：全宽提示，不显示 canvas -->
      <div v-if="noPositionMode" class="flex flex-1 flex-col items-center justify-center bg-slate-800 gap-4 p-8">
        <div class="text-5xl">&#128203;</div>
        <h3 class="text-white text-lg font-semibold">此 PDF 的 OCR 结果没有坐标信息</h3>
        <p class="text-slate-300 text-sm text-center max-w-md">
          阿里云 OCR 对该 PDF 返回的是纯文本，无法进行可视化框选。
          可直接跳过表格选择，展开表头映射。
        </p>
        <div class="bg-slate-700 rounded-lg p-3 text-slate-400 text-xs max-w-md w-full">
          <div class="font-medium text-slate-300 mb-1">识别到的文字内容：</div>
          <div class="max-h-32 overflow-y-auto break-all leading-5">
            {{ ocrBlocks.slice(0,40).map(b=>b.text).join(' ') }}
          </div>
        </div>
        <button @click="skipToStep2"
                class="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          跳过布局选择，直接配置表头映射 →
        </button>
      </div>

      <!-- 正常模式：左为 Canvas（图片绘制图像，PDF 由 pdf.js 渲染到 canvas） -->
      <div v-else class="flex-1 relative bg-slate-800" ref="canvasWrapRef"
           style="overflow:hidden;">
        <canvas ref="canvasRef"
                style="position:absolute;inset:0;cursor:crosshair;touch-action:none;"
                @mousedown="onMouseDown"
                @mousemove="onMouseMove"
                @mouseup="onMouseUp"
                @mouseleave="onMouseUp"></canvas>
        <!-- 加载中覆盖层 -->
        <div v-if="blocksLoading || pdfLoading"
             style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;"
             class="text-white/70 text-sm bg-slate-800/90">
          {{ pdfLoading ? '正在渲染 PDF…' : '正在加载图像和OCR数据…' }}
        </div>
      </div>

      <!-- 右：操作指引 -->
      <div class="w-72 shrink-0 flex flex-col justify-between p-5 border-l bg-white">
        <div class="space-y-4">
          <div class="text-4xl">📌</div>
          <div>
            <h3 class="text-base font-semibold mb-1">框选表格区域</h3>
            <p class="text-sm text-slate-500">
              在左侧图片上拖拽选择包含化验数据的表格区域。
            </p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <div><span class="inline-block w-3 h-3 border-2 border-dashed border-blue-500 mr-1"></span>蓝色虚线：自动识别区域</div>
            <div><span class="inline-block w-3 h-3 border-2 border-red-500 mr-1"></span>红色实线：您拖拽的区域</div>
            <div><span class="inline-block w-3 h-3 bg-blue-300/40 mr-1"></span>浅色矩形：OCR识别块</div>
            <div><span class="inline-block w-3 h-3 bg-orange-400/40 mr-1"></span>橙色矩形：框选区域外的OCR块（可拖拽扩大范围包含）</div>
          </div>
          <div v-if="selectionRect"
               class="bg-green-50 border border-green-200 rounded-lg p-2 text-xs text-green-700 space-y-1">
            <div>✓ 已选区域 {{selectionRect.w}} × {{selectionRect.h}} px</div>
            <div>区域内 OCR 块：{{insideBlockCount}} / {{ocrBlocks.length}}</div>
            <div v-if="outsideBlockCount > 0" class="text-amber-600 font-medium">
              ⚠ 区域外还有 {{outsideBlockCount}} 个 OCR 块未包含
            </div>
          </div>
          <div v-else class="text-xs text-slate-400 italic">请在图片上拖拽选择区域</div>
        </div>
        <div class="flex gap-2 justify-end pt-4 border-t">
          <button @click="$emit('close')"
                  class="px-4 py-2 border rounded text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button @click="goStep2" :disabled="!selectionRect"
                  class="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40 hover:bg-blue-700">
            下一步 →
          </button>
        </div>
      </div>
    </div>

    <!-- ════ STEP 2：表头映射 ════ -->
    <div v-if="step===2" class="flex flex-1 min-h-0">
      <!-- 左：预览缩略图 -->
      <div class="flex-1 relative overflow-hidden bg-slate-800">
        <canvas ref="previewCanvasRef" class="absolute inset-0" style="pointer-events:none;"></canvas>
      </div>

      <!-- 右：卡片流 -->
      <div class="w-[440px] shrink-0 flex flex-col border-l bg-white">
        <div class="px-5 py-4 border-b shrink-0">
          <h3 class="font-semibold">表头列角色映射</h3>
          <p class="text-xs text-slate-500 mt-1">
            为每一列指定其语义字段。<span class="text-red-500 font-medium">★ 必填</span>字段每栏至少指定一个。
          </p>
          <div v-if="headerGroups.size > 1"
               class="mt-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
            检测到 {{ headerGroups.size }} 栏表头（如左右两栏的化验单），请分别为每栏配置列映射。
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- 无表头时提示 -->
          <div v-if="columnMappings.length===0"
               class="text-sm text-slate-400 text-center py-8 italic">
            未在选中区域检测到表头行，<br>请返回重新框选包含标题行的区域。
          </div>

          <!-- 多栏分组显示 -->
          <template v-if="headerGroups.size > 1">
            <div v-for="[gId, gCols] of headerGroups" :key="gId" class="mb-4">
              <div class="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full"
                      :class="gId === 0 ? 'bg-blue-500' : 'bg-emerald-500'"></span>
                第 {{ gId + 1 }} 栏
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div v-for="col in gCols" :key="col.col_index"
                     :class="['border-2 rounded-xl p-3 transition-all',
                       col.mapped_field==='name'   ? 'border-blue-400 bg-blue-50' :
                       col.mapped_field==='value'  ? 'border-green-400 bg-green-50' :
                       col.mapped_field==='unit'   ? 'border-purple-300 bg-purple-50' :
                       col.mapped_field==='range'  ? 'border-orange-300 bg-orange-50' :
                       col.mapped_field==='notes'  ? 'border-teal-300 bg-teal-50' :
                       'border-slate-200 bg-slate-50 opacity-60']">
                  <div class="text-sm font-semibold truncate mb-2 text-slate-700"
                       :title="col.header_text">
                    {{ col.header_text || '(空列)' }}
                  </div>
                  <select v-model="col.mapped_field"
                          class="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                          @change="onMappingChange">
                    <option value="name">✦ 检测项目 ★</option>
                    <option value="value">✦ 结果数值 ★</option>
                    <option value="category">检验项目分类</option>
                    <option value="unit">单位</option>
                    <option value="range">参考范围</option>
                    <option value="notes">备注</option>
                    <option value="ignore">忽略此列</option>
                  </select>
                </div>
              </div>
            </div>
          </template>

          <!-- 单栏：卡片网格（保持原有布局） -->
          <template v-else>
            <div class="grid grid-cols-2 gap-3">
              <div v-for="(col, idx) in columnMappings" :key="idx"
                   :class="['border-2 rounded-xl p-3 transition-all',
                     col.mapped_field==='name'   ? 'border-blue-400 bg-blue-50' :
                     col.mapped_field==='value'  ? 'border-green-400 bg-green-50' :
                     col.mapped_field==='unit'   ? 'border-purple-300 bg-purple-50' :
                     col.mapped_field==='range'  ? 'border-orange-300 bg-orange-50' :
                     col.mapped_field==='notes'  ? 'border-teal-300 bg-teal-50' :
                     'border-slate-200 bg-slate-50 opacity-60']">
                <div class="text-sm font-semibold truncate mb-2 text-slate-700"
                     :title="col.header_text">
                  {{ col.header_text || '(空列)' }}
                </div>
                <select v-model="col.mapped_field"
                        class="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                        @change="onMappingChange">
                  <option value="name">✦ 检测项目 ★</option>
                  <option value="value">✦ 结果数值 ★</option>
                  <option value="category">检验项目分类</option>
                  <option value="unit">单位</option>
                  <option value="range">参考范围</option>
                  <option value="notes">备注</option>
                  <option value="ignore">忽略此列</option>
                </select>
              </div>
            </div>
          </template>

          <!-- 校验错误 -->
          <div v-if="step2Error"
               class="mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            ⚠ {{ step2Error }}
          </div>

          <!-- 外部日期选择器（当表内无日期列时显示） -->
          <div v-if="!hasDateCol" class="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <label class="block text-xs font-semibold text-amber-800 mb-1.5">
              📅 表内未检测到采样日期，请手动指定：
            </label>
            <input type="date" v-model="externalDate"
                   class="w-full border rounded-lg px-3 py-1.5 text-sm bg-white">
          </div>
        </div>

        <div class="px-5 py-4 border-t shrink-0 flex gap-2 justify-between">
          <button @click="step=1"
                  class="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            ← 上一步
          </button>
          <button @click="goStep3" :disabled="!!step2Error || isLoading"
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-40 hover:bg-blue-700 flex items-center gap-2">
            <span v-if="isLoading" class="animate-spin">⏳</span>
            {{ isLoading ? '解析中…' : '解析预览 →' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ════ STEP 3：单元格修复 ════ -->
    <div v-if="step===3" class="flex flex-col flex-1 min-h-0">

      <!-- 顶部工具栏 -->
      <div class="flex items-center justify-between px-4 py-2 border-b bg-slate-50 shrink-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-sm text-slate-700">单元格修复</span>
          <span class="text-xs text-slate-400">（点击单元格即可编辑）</span>
          <div class="flex gap-1">
            <button @click="undoEdit" :disabled="undoStack.length===0"
                    class="px-2 py-1 border rounded text-xs text-slate-600 disabled:opacity-30 hover:bg-white"
                    title="撤销 Ctrl+Z">↩ 撤销</button>
            <button @click="redoEdit" :disabled="redoStack.length===0"
                    class="px-2 py-1 border rounded text-xs text-slate-600 disabled:opacity-30 hover:bg-white"
                    title="重做 Ctrl+Y">↪ 重做</button>
          </div>
          <span class="text-xs text-slate-400">共 {{ parsedItems.length }} 条记录</span>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="hospitalId" @click="saveTemplate"
                  class="px-3 py-1.5 border rounded-lg text-xs text-slate-600 hover:bg-white">
            💾 保存为医院模板
          </button>
          <button @click="doApplyAndFinish" :disabled="isLoading"
                  class="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm disabled:opacity-40 hover:bg-green-700 flex items-center gap-2">
            <span v-if="isLoading" class="animate-spin">⏳</span>
            {{ isLoading ? '处理中…' : '✅ 完成并入库' }}
          </button>
        </div>
      </div>

      <!-- 分割工具条 -->
      <div v-if="splitBar.show"
           class="flex items-center gap-3 px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-sm shrink-0 flex-wrap">
        <span class="font-semibold text-yellow-800">✂ 分割</span>
        <span class="text-slate-600 max-w-[200px] truncate" :title="splitBar.cellText">
          "{{ splitBar.cellText }}"
        </span>
        <span class="text-slate-500">按</span>
        <select v-model="splitBar.delimiter" class="border rounded px-2 py-0.5 text-sm bg-white"
                @change="onSplitDelimiterChange">
          <option value=" ">空格</option>
          <option value=":">英文冒号 (:)</option>
          <option value="：">中文冒号 (：)</option>
          <option value="/">斜杠 (/)</option>
          <option value="|">竖线 (|)</option>
          <option value="__custom__">自定义…</option>
        </select>
        <input v-if="splitBar.delimiter === '__custom__'"
               v-model="splitBar.customDelimiter"
               class="border rounded px-2 py-0.5 text-sm bg-white w-16 text-center"
               placeholder="符号"
               @input="updateSplitPreview"
               maxlength="4">
        <span class="text-slate-400">→</span>
        <span v-for="(p, i) in splitBar.preview" :key="i"
              class="px-2 py-0.5 bg-white border rounded text-xs font-mono">{{ p }}</span>
        <div class="flex gap-1 ml-auto">
          <button @click="confirmSplit"
                  class="px-3 py-1 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600">
            确认分割
          </button>
          <button @click="splitBar.show=false"
                  class="px-3 py-1 border rounded text-xs hover:bg-white">
            取消
          </button>
        </div>
      </div>

      <!-- 合并警告遮罩 -->
      <div v-if="mergeWarning.show"
           class="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
        <div class="bg-white rounded-xl p-6 shadow-2xl max-w-md w-full mx-4">
          <div class="text-red-600 font-bold text-lg mb-3">⚠ 合并警告</div>
          <p class="text-sm text-slate-700 mb-3">{{ mergeWarning.message }}</p>
          <p class="text-sm text-slate-500 mb-4">
            💡 建议：将它们拆分为多行会更合适，是否使用"分割"功能？
          </p>
          <div class="flex gap-2 justify-end">
            <button @click="mergeWarning.show=false"
                    class="px-4 py-2 border rounded-lg text-sm hover:bg-slate-50">
              我知道了，继续
            </button>
          </div>
        </div>
      </div>

      <!-- 数据网格 -->
      <div class="flex-1 overflow-auto">
        <table class="w-full text-sm border-collapse">
          <thead class="sticky top-0 bg-slate-50 z-10">
            <tr class="border-b">
              <th class="p-2 text-left text-slate-400 text-xs font-normal w-8">#</th>
              <th v-for="col in activeGridCols" :key="col.field"
                  class="p-2 text-left font-semibold text-slate-700">
                {{ col.label }}
              </th>
              <th class="p-2 text-slate-400 text-xs font-normal w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, rowIdx) in parsedItems" :key="rowIdx"
                :class="['border-b transition-colors hover:bg-slate-50/80',
                  selectedRows.has(rowIdx) ? 'bg-blue-50' : '']"
                @click="onRowClick(rowIdx, $event)">
              <td class="p-2 text-slate-300 text-xs select-none">{{ rowIdx+1 }}</td>
              <td v-for="col in activeGridCols" :key="col.field"
                  class="p-1 relative group cursor-text"
                  @click="startCellEdit(rowIdx, col.field, item[col.field])">
                <!-- 编辑态 -->
                <input v-if="editingCell && editingCell.rowIdx===rowIdx && editingCell.field===col.field"
                       v-model="editingCell.value"
                       class="w-full border border-blue-400 rounded px-1.5 py-0.5 text-sm outline-none bg-blue-50"
                       @blur="commitCellEdit"
                       @keydown.enter.prevent="commitCellEdit"
                       @keydown.escape="cancelCellEdit"
                       @click.stop
                       :ref="el => { if (el) activeEditInput = el }"
                       autofocus>
                <!-- 显示态 -->
                <div v-else class="flex items-center gap-1 min-h-[1.75rem] px-1 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50/50 transition-all">
                  <span class="truncate max-w-[180px]" :title="item[col.field]">
                    {{ item[col.field] || '' }}
                  </span>
                  <!-- 编辑提示图标 -->
                  <span class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-blue-400">
                    ✎
                  </span>
                  <!-- OCR原始文字 tooltip badge -->
                  <span v-if="getCellTooltip(item, col.field)"
                        class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
                               text-[9px] bg-slate-600 text-white rounded px-1 py-0.5 cursor-help"
                        :title="getCellTooltip(item, col.field)">
                    OCR
                  </span>
                </div>
              </td>
              <td class="p-1 text-center whitespace-nowrap">
                <button @click.stop="openSplitBar(rowIdx, 'test_item_name', item.test_item_name)"
                        class="text-slate-300 hover:text-blue-500 px-1 transition-colors"
                        title="分割项目名">✂</button>
                <button @click.stop="deleteRow(rowIdx)"
                        class="text-slate-300 hover:text-red-500 px-1 transition-colors"
                        title="删除此行">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!isLoading && parsedItems.length===0"
             class="p-12 text-center text-slate-400 text-sm">
          未解析到任何数据行。<br>
          请返回检查列映射——确保"检测项目"和"结果数值"列已正确指定。
        </div>
      </div>
    </div>

  </div>
</div>
</teleport>
  `,

  setup(props, { emit }) {
    // ── 通用 ──────────────────────────────────────────────
    const step = Vue.ref(1);
    const steps = ["框选区域", "表头映射", "单元格修复"];
    const isLoading = Vue.ref(false);

    // ── Step 1 ────────────────────────────────────────────
    const canvasRef = Vue.ref(null);
    const canvasWrapRef = Vue.ref(null);
    const sourceImgRef = Vue.ref(null); // DOM <img> 元素，由 Vue 模板驱动加载
    const ocrBlocks = Vue.ref([]);
    const autoRegion = Vue.ref(null);
    const selectionRect = Vue.ref(null);
    const blocksLoading = Vue.ref(false);
    const pdfLoading = Vue.ref(false); // pdf.js 加载/渲染中

    // pdf.js 状态（PDF 模式专用）
    let pdfDoc = null;        // pdf.js document
    let pdfPage = null;       // current page object
    let pdfBgCanvas = null;   // offscreen canvas with rendered PDF page
    let pdfRenderTask = null; // current render task (for cancellation)

    let imgNaturalW = 0,
      imgNaturalH = 0;
    let canvasScale = 1;
    // Canvas 渲染偏移量（图像/PDF 块在 canvas 上的左上角像素偏移）。
    // 由 redrawCanvas() 设置，canvasToImg() 用其做逆变换。
    // 必须为模块变量而非局部变量，因为 canvasToImg 需要读取最新值。
    let canvasOffX = 0;
    let canvasOffY = 0;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let loadedImage = null; // 指向 sourceImgRef.value 的引用
    let apiBlocksReady = false; // API 是否已返回
    let imgLoaded = false; // 图片是否已加载

    // PDF 模式计算属性：根据文件后缀判断
    const isPdf = Vue.computed(() =>
      (props.filePath || "").toLowerCase().endsWith(".pdf"),
    );
    // OCR 块是否完全没有位置信息（PDF 文本降级路径）
    const noPositionMode = Vue.ref(false);

    // 框选区域内/外 OCR 块数量统计
    const insideBlockCount = Vue.computed(() => {
      const sr = selectionRect.value;
      if (!sr || sr.w === 0) return 0;
      const srX2 = sr.x + sr.w;
      const srY2 = sr.y + sr.h;
      return ocrBlocks.value.filter(b => {
        const bx1 = b.has_position ? b.left : b.left - b.width / 2;
        const by1 = b.has_position ? b.top : b.top - b.height / 2;
        const bx2 = b.has_position ? b.left + b.width : b.left + b.width / 2;
        const by2 = b.has_position ? b.top + b.height : b.top + b.height / 2;
        return bx1 < srX2 && bx2 > sr.x && by1 < srY2 && by2 > sr.y;
      }).length;
    });
    const outsideBlockCount = Vue.computed(() => {
      return ocrBlocks.value.length - insideBlockCount.value;
    });

    // ── Step 2 ────────────────────────────────────────────
    const previewCanvasRef = Vue.ref(null);
    const headerCandidates = Vue.ref([]);
    const columnMappings = Vue.ref([]);
    const externalDate = Vue.ref("");
    const hasDateCol = Vue.ref(false);

    // 多栏支持：每个栏（group）必须至少有一个 name 和一个 value
    const headerGroups = Vue.computed(() => {
      // 按 group 分组，group 从 extractHeaderCandidates 中设置
      const groups = new Map();
      for (const c of columnMappings.value) {
        const g = c.group ?? 0;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
      }
      return groups;
    });

    const step2Error = Vue.computed(() => {
      const active = columnMappings.value.filter(
        (c) => c.mapped_field !== "ignore",
      );
      const nameN = active.filter((c) => c.mapped_field === "name").length;
      const valN = active.filter((c) => c.mapped_field === "value").length;
      if (nameN === 0) return '请为"检测项目"指定至少一列（★必填）';
      if (valN === 0) return '请为"结果数值"指定至少一列（★必填）';
      // 多栏校验：每个栏至少有一个 name 和一个 value
      for (const [g, cols] of headerGroups.value) {
        const gActive = cols.filter((c) => c.mapped_field !== "ignore");
        const gName = gActive.filter((c) => c.mapped_field === "name").length;
        const gVal = gActive.filter((c) => c.mapped_field === "value").length;
        if (gActive.length > 0 && (gName === 0 || gVal === 0)) {
          const label = headerGroups.value.size > 1 ? `第${g + 1}栏` : "";
          if (gName === 0) return `${label}缺少"检测项目"列（★必填）`;
          if (gVal === 0) return `${label}缺少"结果数值"列（★必填）`;
        }
      }
      return "";
    });

    // ── Step 3 ────────────────────────────────────────────
    const parsedItems = Vue.ref([]);
    const originalItemIds = Vue.ref(new Set()); // Step 3 开始时的item id集合，用于检测删除
    const undoStack = Vue.ref([]);
    const redoStack = Vue.ref([]);
    const selectedRows = Vue.ref(new Set());
    const editingCell = Vue.ref(null);
    let activeEditInput = null;

    const splitBar = Vue.ref({
      show: false,
      rowIdx: -1,
      field: "",
      cellText: "",
      delimiter: " ",
      customDelimiter: "",
      preview: [],
    });
    const mergeWarning = Vue.ref({ show: false, message: "" });

    const activeGridCols = Vue.computed(() => {
      const mapped = new Set(columnMappings.value.map((c) => c.mapped_field));
      const cols = [
        { field: "test_item_name", label: "检测项目" },
        { field: "original_value", label: "结果数值" },
      ];
      if (mapped.has("unit"))
        cols.push({ field: "original_unit", label: "单位" });
      if (mapped.has("range"))
        cols.push({ field: "ref_interval_text", label: "参考范围" });
      if (mapped.has("notes")) cols.push({ field: "row_notes", label: "备注" });
      return cols;
    });

    // ════════════ STEP 1 LOGIC ════════════════════════════

    // ── 由 <img ref="sourceImgRef" @load> 事件触发，不再使用 new Image() ──────
    function onSourceImageLoad() {
      const img = sourceImgRef.value;
      if (!img) return;
      loadedImage = img;
      imgLoaded = true;
      imgNaturalW = img.naturalWidth;
      imgNaturalH = img.naturalHeight;
      // 如果 API 也已经返回，立刻绘制；否则等 API 回来后再绘
      if (apiBlocksReady) {
        drawCanvasWhenReady();
      }
      // API 还没好，blocksLoading 保持 true（下面 loadBlocks 完成时会 call draw）
    }

    function onSourceImageError() {
      // 图片加载失败（也可能是 PDF)：降级为无图模式，继续用 OCR 块分布图
      imgLoaded = true; // 标记为就绪（无图模式）
      if (apiBlocksReady) drawCanvasWhenReady();
      // 否则等 loadBlocks 完成后自动触发
    }

    // 两路（图片 + API）都就绪后调用，安全绘制 canvas
    function drawCanvasWhenReady() {
      if (!imgLoaded || !apiBlocksReady) return;
      if (noPositionMode.value) return; // 无位置模式不需要绘制

      const canvas = canvasRef.value;
      const wrap = canvasWrapRef.value;
      if (!canvas || !wrap) {
        requestAnimationFrame(drawCanvasWhenReady);
        return;
      }

      // 用 wrap.getBoundingClientRect() 获取真实 CSS 渲染尺寸
      // 比 clientWidth/clientHeight 更可靠（尤其对 flex 容器内的元素）
      const rect = wrap.getBoundingClientRect();
      const w = Math.round(rect.width) || 800;
      const h = Math.round(rect.height) || 600;
      if (w < 10 || h < 10) {
        requestAnimationFrame(drawCanvasWhenReady);
        return;
      }

      // canvas.width/height 设置像素缓冲区尺寸
      // CSS 尺寸由 position:absolute;inset:0 控制，不需要 JS 设置
      canvas.width = w;
      canvas.height = h;

      if (loadedImage) {
        canvasScale = Math.min(w / imgNaturalW, h / imgNaturalH);
      }
      blocksLoading.value = false;
      redrawCanvas();
    }

    async function loadBlocks() {
      if (!props.reportId) return;
      apiBlocksReady = false;
      blocksLoading.value = true;
      try {
        const r = await api.getOCRBlocks(props.reportId);
        if (r.code === 0 && r.data) {
          ocrBlocks.value = r.data.blocks || [];
          autoRegion.value = r.data.auto_region || null;
          if (autoRegion.value && autoRegion.value.w > 0) {
            selectionRect.value = { ...autoRegion.value };
          }
        }
      } catch (e) {
        blocksLoading.value = false;
        return;
      }
      apiBlocksReady = true;

      // 检测是否有有效坐标信息
      // 使用后端返回的 has_position 字段，替代遍历检查零坐标的 heuristic
      const hasPos = ocrBlocks.value.some((b) => b.has_position);
      if (!hasPos) {
        // 无坐标（PDF 文本降级路径）：显示跳过提示界面
        noPositionMode.value = true;
        blocksLoading.value = false;
        return;
      }

      // PDF 模式：用 pdf.js 加载 PDF 页面，渲染到离屏 canvas 作为背景
      if (isPdf.value) {
        pdfLoading.value = true;
        loadPdfBackground().finally(() => {
          pdfLoading.value = false;
          imgLoaded = true;
          drawCanvasWhenReady();
        });
        return;
      }

      // 图片模式：等待图片加载
      if (imgLoaded) {
        drawCanvasWhenReady();
      }
    }

    // 无坐标模式下跳过 Step1，直接进入 Step2 进行文本内容表头配置
    function skipToStep2() {
      // 构造虚拟表头候选：从所有块中取前 N 个不重复的短词作为候选列名
      const tokens = [];
      const seen = new Set();
      for (const b of ocrBlocks.value) {
        const t = (b.text || "").trim();
        if (t && !seen.has(t) && tokens.length < 8) {
          seen.add(t);
          tokens.push(t);
        }
      }
      // 如果识别词太少，提供默认列
      const defaultCols =
        tokens.length >= 2 ? tokens : ["项目", "结果", "单位", "参考区间"];
      headerCandidates.value = defaultCols.map((text, i) => ({
        text,
        left: 0,
        top: 0,
        width: 0,
        x_min: i * 200,
        x_max: (i + 1) * 200,
        group: 0,
      }));
      columnMappings.value = defaultCols.map((text, i) => ({
        col_index: i,
        header_text: text,
        mapped_field: guessField(text, i, defaultCols.length),
        x_min: i * 200,
        x_max: (i + 1) * 200,
        group: 0,
      }));
      hasDateCol.value = false;
      // 自动从OCR块中提取采样日期
      if (!externalDate.value) {
        externalDate.value = extractDateFromOCRBlocks(ocrBlocks.value);
      }
      // 构造一个全局展开选择框
      selectionRect.value = { x: 0, y: 0, w: 1000, h: 1000, page: -1 };
      step.value = 2;
    }

    // ── PDF 背景渲染（pdf.js）────────────────────────────────
    // computeOcrBbox returns the axis-aligned bounding box of all OCR blocks
    // in OCR coordinate space, handling both legacy and new coordinate formats.
    function computeOcrBbox() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of ocrBlocks.value) {
        const x1 = b.has_position ? b.left : b.left - b.width / 2;
        const y1 = b.has_position ? b.top : b.top - b.height / 2;
        const x2 = b.has_position ? b.left + b.width : b.left + b.width / 2;
        const y2 = b.has_position ? b.top + b.height : b.top + b.height / 2;
        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
      return { minX, minY, maxX, maxY,
        w: (maxX - minX) || 1, h: (maxY - minY) || 1 };
    }

    // Load PDF via pdf.js and render the first page to an offscreen canvas.
    // The offscreen canvas is rendered at a scale such that its width matches
    // the OCR coordinate width, so OCR coordinates map 1:1 to the PDF image.
    async function loadPdfBackground() {
      try {
        pdfDoc = await pdfjsLib.getDocument(props.reportImageUrl).promise;
        pdfPage = await pdfDoc.getPage(1);
        await renderPdfToBackground();
      } catch (e) {
        // Fall back to block-only (dark background) on error
        pdfPage = null;
        pdfBgCanvas = null;
      }
    }

    async function renderPdfToBackground() {
      if (!pdfPage || ocrBlocks.value.length === 0) return;
      // Cancel any previous render
      if (pdfRenderTask) { pdfRenderTask.cancel(); pdfRenderTask = null; }

      const bbox = computeOcrBbox();
      const viewport = pdfPage.getViewport({ scale: 1 });
      // Render PDF at a scale matching OCR coordinate width
      const renderScale = bbox.w / viewport.width;
      const scaledViewport = pdfPage.getViewport({ scale: renderScale });

      pdfBgCanvas = document.createElement("canvas");
      pdfBgCanvas.width = scaledViewport.width;
      pdfBgCanvas.height = scaledViewport.height;

      pdfRenderTask = pdfPage.render({
        canvasContext: pdfBgCanvas.getContext("2d"),
        viewport: scaledViewport,
      });
      await pdfRenderTask.promise;
      pdfRenderTask = null;
    }

    function redrawCanvas() {
      const canvas = canvasRef.value;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const cw = canvas.width || canvas.clientWidth || 800;
      const ch = canvas.height || canvas.clientHeight || 600;

      ctx.clearRect(0, 0, cw, ch);

      // Reset to zero then set via the branch below
      canvasOffX = 0;
      canvasOffY = 0;

      if (loadedImage) {
        // 图片模式：绘制图片背景
        const drawW = imgNaturalW * canvasScale;
        const drawH = imgNaturalH * canvasScale;
        canvasOffX = (cw - drawW) / 2;
        canvasOffY = (ch - drawH) / 2;
        ctx.drawImage(loadedImage, canvasOffX, canvasOffY, drawW, drawH);
      } else if (pdfBgCanvas && isPdf) {
        // PDF 模式：绘制 pdf.js 渲染的离屏 canvas 作为背景。
        // OCR 坐标与 PDF 背景对齐——pdfBgCanvas 按 OCR 坐标空间的宽度渲染。
        const bbox = computeOcrBbox();
        canvasScale = Math.min((cw * 0.92) / bbox.w, (ch * 0.92) / bbox.h);
        canvasOffX = (cw - bbox.w * canvasScale) / 2 - bbox.minX * canvasScale;
        canvasOffY = (ch - bbox.h * canvasScale) / 2 - bbox.minY * canvasScale;

        // Draw PDF background: map PDF image (indexed by OCR coords) to display
        const pdfDrawX = canvasOffX + bbox.minX * canvasScale;
        const pdfDrawY = canvasOffY + bbox.minY * canvasScale;
        const pdfDrawW = bbox.w * canvasScale;
        const pdfDrawH = bbox.h * canvasScale;
        ctx.drawImage(pdfBgCanvas, 0, 0, pdfBgCanvas.width, pdfBgCanvas.height,
          pdfDrawX, pdfDrawY, pdfDrawW, pdfDrawH);
      } else if (ocrBlocks.value.length > 0) {
        // 无背景回退模式：纯深色背景 + OCR 块（如 pdf.js 加载失败、或旧无坐标数据）
        const bbox = computeOcrBbox();
        canvasScale = Math.min((cw * 0.92) / bbox.w, (ch * 0.92) / bbox.h);
        canvasOffX = (cw - bbox.w * canvasScale) / 2 - bbox.minX * canvasScale;
        canvasOffY = (ch - bbox.h * canvasScale) / 2 - bbox.minY * canvasScale;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, cw, ch);
      }

      // 绘制 OCR 块（图片模式半透明，PDF 模式实心更明显）
      // Supports both coordinate formats:
      // - New format (has_position=true): Left/Top = top-left corner
      // - Legacy format (has_position=false): Left/Top = center, apply center→edge compensation
      ctx.globalAlpha = loadedImage ? 0.25 : 0.55;
      ctx.fillStyle = "#60a5fa";
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1;
      for (const b of ocrBlocks.value) {
        const bx = b.has_position
          ? canvasOffX + b.left * canvasScale
          : canvasOffX + (b.left - b.width / 2) * canvasScale;
        const by = b.has_position
          ? canvasOffY + b.top * canvasScale
          : canvasOffY + (b.top - b.height / 2) * canvasScale;
        const bw = b.width * canvasScale;
        const bh = b.height * canvasScale;
        ctx.fillRect(bx, by, bw, bh);
        // 图片模式下也绘制块边框，增强可见性
        if (loadedImage) {
          ctx.globalAlpha = 0.5;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.globalAlpha = 0.25;
        }
      }
      ctx.globalAlpha = 1;

      // 在 OCR 块上绘制文字标签（帮助用户识别块内容，特别是边缘区域的块）
      // 仅在无背景图模式或缩放足够大时显示，避免图片模式下文字重叠
      if (!loadedImage || canvasScale > 0.5) {
        ctx.globalAlpha = loadedImage ? 0.7 : 0.9;
        ctx.fillStyle = "#e2e8f0";
        const fontSize = Math.max(8, Math.min(11, 10 * canvasScale));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = "top";
        for (const b of ocrBlocks.value) {
          const bx = b.has_position
            ? canvasOffX + b.left * canvasScale
            : canvasOffX + (b.left - b.width / 2) * canvasScale;
          const by = b.has_position
            ? canvasOffY + b.top * canvasScale
            : canvasOffY + (b.top - b.height / 2) * canvasScale;
          const bw = b.width * canvasScale;
          // 只在块宽度足够时显示文字（避免极小块文字重叠）
          if (bw > 20 && b.text) {
            const label = b.text.length > 12 ? b.text.slice(0, 12) + "…" : b.text;
            ctx.fillText(label, bx + 2, by + 1);
          }
        }
        ctx.globalAlpha = 1;
      }

      // 自动识别区域（蓝色虚线框）
      if (autoRegion.value && autoRegion.value.w > 0) {
        const ar = autoRegion.value;
        ctx.setLineDash([7, 4]);
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          canvasOffX + ar.x * canvasScale,
          canvasOffY + ar.y * canvasScale,
          ar.w * canvasScale,
          ar.h * canvasScale,
        );
        ctx.setLineDash([]);
      }

      // 用户选择区域（红色实线框）
      if (selectionRect.value) {
        const sr = selectionRect.value;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(
          canvasOffX + sr.x * canvasScale,
          canvasOffY + sr.y * canvasScale,
          sr.w * canvasScale,
          sr.h * canvasScale,
        );
        // 半透明填充
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(
          canvasOffX + sr.x * canvasScale,
          canvasOffY + sr.y * canvasScale,
          sr.w * canvasScale,
          sr.h * canvasScale,
        );
        ctx.globalAlpha = 1;

        // 标记框选区域外的 OCR 块（淡橙色提示，告知用户还有未包含的数据）
        const srX2 = sr.x + sr.w;
        const srY2 = sr.y + sr.h;
        const outsideBlocks = ocrBlocks.value.filter(b => {
          const bx1 = b.has_position ? b.left : b.left - b.width / 2;
          const by1 = b.has_position ? b.top : b.top - b.height / 2;
          const bx2 = b.has_position ? b.left + b.width : b.left + b.width / 2;
          const by2 = b.has_position ? b.top + b.height : b.top + b.height / 2;
          // 块与框选区域无重叠 = 在框选区域外
          return !(bx1 < srX2 && bx2 > sr.x && by1 < srY2 && by2 > sr.y);
        });
        if (outsideBlocks.length > 0) {
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = "#f97316"; // 橙色填充
          ctx.strokeStyle = "#ea580c"; // 橙色边框
          ctx.lineWidth = 1.5;
          for (const b of outsideBlocks) {
            const bx = b.has_position
              ? canvasOffX + b.left * canvasScale
              : canvasOffX + (b.left - b.width / 2) * canvasScale;
            const by = b.has_position
              ? canvasOffY + b.top * canvasScale
              : canvasOffY + (b.top - b.height / 2) * canvasScale;
            const bw = b.width * canvasScale;
            const bh = b.height * canvasScale;
            ctx.fillRect(bx, by, bw, bh);
            ctx.strokeRect(bx, by, bw, bh);
          }
          // 框选区域外OCR块也显示文字标签
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#fff7ed";
          const fontSize = Math.max(8, Math.min(11, 10 * canvasScale));
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textBaseline = "top";
          for (const b of outsideBlocks) {
            const bx = b.has_position
              ? canvasOffX + b.left * canvasScale
              : canvasOffX + (b.left - b.width / 2) * canvasScale;
            const by = b.has_position
              ? canvasOffY + b.top * canvasScale
              : canvasOffY + (b.top - b.height / 2) * canvasScale;
            const bw = b.width * canvasScale;
            if (bw > 20 && b.text) {
              const label = b.text.length > 12 ? b.text.slice(0, 12) + "…" : b.text;
              ctx.fillText(label, bx + 2, by + 1);
            }
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // Canvas 坐标 → 图像/OCR 坐标
    // 使用 redrawCanvas() 设定的模块变量而非重新计算 offset，
    // 确保 PDF 模式（无图像、块包围盒居中）也能正确逆变换。
    function canvasToImg(cx, cy) {
      return {
        x: Math.round((cx - canvasOffX) / canvasScale),
        y: Math.round((cy - canvasOffY) / canvasScale),
      };
    }

    function onMouseDown(e) {
      isDragging = true;
      const rect = canvasRef.value.getBoundingClientRect();
      dragStart = canvasToImg(e.clientX - rect.left, e.clientY - rect.top);
      selectionRect.value = null;
    }
    function onMouseMove(e) {
      if (!isDragging) return;
      const rect = canvasRef.value.getBoundingClientRect();
      const cur = canvasToImg(e.clientX - rect.left, e.clientY - rect.top);
      selectionRect.value = {
        x: Math.min(dragStart.x, cur.x),
        y: Math.min(dragStart.y, cur.y),
        w: Math.abs(cur.x - dragStart.x),
        h: Math.abs(cur.y - dragStart.y),
        page: autoRegion.value ? autoRegion.value.page : -1,
      };
      redrawCanvas();
    }
    function onMouseUp() {
      isDragging = false;
      // 拖拽区域太小时还原为自动识别区域
      if (selectionRect.value && selectionRect.value.w < 10) {
        selectionRect.value = autoRegion.value ? { ...autoRegion.value } : null;
        redrawCanvas();
      }
    }

    // ════════════ STEP 2 LOGIC ════════════════════════════

    function goStep2() {
      if (!selectionRect.value) return;
      const cands = extractHeaderCandidates(
        ocrBlocks.value,
        selectionRect.value,
      );
      headerCandidates.value = cands;
      columnMappings.value = cands.map((hc, i) => ({
        col_index: i,
        header_text: hc.text,
        mapped_field: guessField(hc.text, i, cands.length),
        x_min: hc.x_min,
        x_max: hc.x_max,
        group: hc.group ?? 0,
      }));
      hasDateCol.value = cands.some((hc) =>
        /日期|时间|date|time/i.test(hc.text),
      );
      // 如果表内无日期列，自动从OCR块中提取采样日期
      if (!hasDateCol.value && !externalDate.value) {
        externalDate.value = extractDateFromOCRBlocks(ocrBlocks.value);
      }
      step.value = 2;
      Vue.nextTick(drawPreviewCanvas);
    }

    // 从OCR块中提取表头候选列（支持多栏：同一行表头按X位置分栏）
    function extractHeaderCandidates(blocks, region) {
      const newFormat = blocks.length > 0 && blocks[0].has_position;
      const rx2 = region.x + region.w;
      const ry2 = region.y + region.h;
      const filtered = blocks.filter((b) => {
        if (region.page >= 0 && b.page_index !== region.page) return false;
        let bx1, by1, bx2, by2;
        if (newFormat) {
          bx1 = b.left;
          by1 = b.top;
          bx2 = b.left + b.width;
          by2 = b.top + b.height;
        } else {
          bx1 = b.left - b.width / 2;
          by1 = b.top - b.height / 2;
          bx2 = b.left + b.width / 2;
          by2 = b.top + b.height / 2;
        }
        return bx1 < rx2 && bx2 > region.x && by1 < ry2 && by2 > region.y;
      });
      if (filtered.length === 0) return [];

      filtered.sort((a, b) =>
        a.top !== b.top ? a.top - b.top : a.left - b.left,
      );

      // ── 多栏检测 ──
      // 化验单两栏布局的特征：同一 Y 行上有两组重复的表头语义角色
      // 例如：左栏"项目 结果 单位 参考范围" + 右栏"项目 结果 单位 参考范围"
      // 策略：先识别表头行，再在表头行内按语义角色重复 + X 间隙分栏
      const HEADER_KW = /项目|检验|检测|结果|数值|单位|参考|区间|范围|test|item|value|result|unit|ref|range/i;
      const ROW_TOLERANCE = 15;

      // 按行分组（Y坐标相近的块归为同一行）
      const rows = [];
      for (const b of filtered) {
        let found = false;
        for (const row of rows) {
          if (Math.abs(b.top - row.avgY) <= ROW_TOLERANCE) {
            row.blocks.push(b);
            row.avgY = row.blocks.reduce((s, x) => s + x.top, 0) / row.blocks.length;
            found = true;
            break;
          }
        }
        if (!found) {
          rows.push({ avgY: b.top, blocks: [b] });
        }
      }
      rows.sort((a, b) => a.avgY - b.avgY);

      // 检测表头行
      const headerRows = rows.filter((row) => {
        const kwCount = row.blocks.filter((b) => HEADER_KW.test(b.text || "")).length;
        return kwCount >= 2 || (row.blocks.length > 0 && kwCount / row.blocks.length > 0.3);
      });
      if (headerRows.length === 0) {
        headerRows.push(rows[0]);
      }

      // ── 在表头行内按语义角色重复 + X 间隙分栏 ──
      const allResults = [];
      let globalGroup = 0;

      for (const headerRow of headerRows) {
        const headerBlocks = [...headerRow.blocks];
        headerBlocks.sort((a, b) => a.left - b.left);
        if (headerBlocks.length === 0) continue;

        // 为每个表头块猜测语义角色
        const roles = headerBlocks.map((b) => guessField(b.text, 0, 0));

        // 检测多栏：统计"核心角色"(name/value)出现次数
        // 如果 name 或 value 角色出现超过1次，说明是多栏
        const nameCount = roles.filter((r) => r === "name").length;
        const valueCount = roles.filter((r) => r === "value").length;
        const isMultiGroup = (nameCount > 1 || valueCount > 1) && headerBlocks.length >= 4;

        if (isMultiGroup) {
          // 多栏布局：在表头行内按 X 间隙分栏
          // 策略：找到 name 角色出现的所有位置，每个 name 开始一个新的栏
          const namePositions = [];
          for (let i = 0; i < roles.length; i++) {
            if (roles[i] === "name") namePositions.push(i);
          }

          if (namePositions.length > 1) {
            // 按 name 角色位置分栏：每个 name 到下一个 name 之前为一个栏
            for (let g = 0; g < namePositions.length; g++) {
              const gs = namePositions[g];
              const ge = g + 1 < namePositions.length ? namePositions[g + 1] : headerBlocks.length;
              const groupBlocks = headerBlocks.slice(gs, ge);

              const result = groupBlocks.map((b) => ({
                text: b.text,
                left: b.left,
                top: b.top,
                width: b.width,
                x_min: 0,
                x_max: 0,
                group: globalGroup,
              }));

              // 计算列边界（仅在栏内计算）
              for (let i = 0; i < result.length; i++) {
                const newFmt = groupBlocks[i].has_position;
                if (i === 0) {
                  result[i].x_min = newFmt
                    ? groupBlocks[0].left
                    : groupBlocks[0].left - Math.round(groupBlocks[0].width / 2);
                } else {
                  const prevRight = newFmt
                    ? groupBlocks[i - 1].left + groupBlocks[i - 1].width
                    : groupBlocks[i - 1].left + Math.round(groupBlocks[i - 1].width / 2);
                  const curLeft = newFmt
                    ? groupBlocks[i].left
                    : groupBlocks[i].left - Math.round(groupBlocks[i].width / 2);
                  result[i].x_min = Math.round((prevRight + curLeft) / 2);
                  result[i - 1].x_max = result[i].x_min;
                }
                if (i === result.length - 1) {
                  const lastBlock = groupBlocks[groupBlocks.length - 1];
                  result[i].x_max = newFmt
                    ? lastBlock.left + lastBlock.width
                    : lastBlock.left + Math.round(lastBlock.width / 2);
                }
              }
              allResults.push(...result);
              globalGroup++;
            }
          } else {
            // name 角色只出现1次但 value 出现多次，或检测不够准确
            // 回退到 X 间隙分栏
            const gaps = [];
            for (let i = 1; i < headerBlocks.length; i++) {
              const prevRight = newFormat
                ? headerBlocks[i - 1].left + headerBlocks[i - 1].width
                : headerBlocks[i - 1].left + Math.round(headerBlocks[i - 1].width / 2);
              const curLeft = newFormat
                ? headerBlocks[i].left
                : headerBlocks[i].left - Math.round(headerBlocks[i].width / 2);
              gaps.push({ idx: i, gap: curLeft - prevRight });
            }

            const gapValues = gaps.map((g) => g.gap).filter((g) => g > 0);
            if (gapValues.length > 0) {
              gapValues.sort((a, b) => a - b);
              const medianGap = gapValues[Math.floor(gapValues.length / 2)];
              const avgGap = gapValues.reduce((s, v) => s + v, 0) / gapValues.length;
              const splitThreshold = Math.max(medianGap * 3, avgGap * 2, 30);

              const splitPoints = gaps
                .filter((g) => g.gap > splitThreshold)
                .map((g) => g.idx);

              const groupRanges = [];
              let start = 0;
              for (const sp of splitPoints) {
                groupRanges.push([start, sp]);
                start = sp;
              }
              groupRanges.push([start, headerBlocks.length]);

              for (const [gs, ge] of groupRanges) {
                const groupBlocks = headerBlocks.slice(gs, ge);
                const result = groupBlocks.map((b) => ({
                  text: b.text,
                  left: b.left,
                  top: b.top,
                  width: b.width,
                  x_min: 0,
                  x_max: 0,
                  group: globalGroup,
                }));
                for (let i = 0; i < result.length; i++) {
                  const newFmt = groupBlocks[i].has_position;
                  if (i === 0) {
                    result[i].x_min = newFmt
                      ? groupBlocks[0].left
                      : groupBlocks[0].left - Math.round(groupBlocks[0].width / 2);
                  } else {
                    const prevRight = newFmt
                      ? groupBlocks[i - 1].left + groupBlocks[i - 1].width
                      : groupBlocks[i - 1].left + Math.round(groupBlocks[i - 1].width / 2);
                    const curLeft = newFmt
                      ? groupBlocks[i].left
                      : groupBlocks[i].left - Math.round(groupBlocks[i].width / 2);
                    result[i].x_min = Math.round((prevRight + curLeft) / 2);
                    result[i - 1].x_max = result[i].x_min;
                  }
                  if (i === result.length - 1) {
                    const lastBlock = groupBlocks[groupBlocks.length - 1];
                    result[i].x_max = newFmt
                      ? lastBlock.left + lastBlock.width
                      : lastBlock.left + Math.round(lastBlock.width / 2);
                  }
                }
                allResults.push(...result);
                globalGroup++;
              }
            } else {
              // 无法分栏，作为单栏处理
              allResults.push(...buildSingleGroupColumns(headerBlocks, region, newFormat, globalGroup));
              globalGroup++;
            }
          }
        } else {
          // 单栏布局
          allResults.push(...buildSingleGroupColumns(headerBlocks, region, newFormat, globalGroup));
          globalGroup++;
        }
      }
      return allResults;
    }

    // 构建单栏的列候选（提取为辅助函数，避免重复代码）
    function buildSingleGroupColumns(headerBlocks, region, newFormat, group) {
      const result = headerBlocks.map((b) => ({
        text: b.text,
        left: b.left,
        top: b.top,
        width: b.width,
        x_min: 0,
        x_max: 0,
        group: group,
      }));
      for (let i = 0; i < result.length; i++) {
        const newFmt = headerBlocks[i].has_position;
        if (i === 0) {
          result[i].x_min = region.x;
        } else {
          const prevRight = newFmt
            ? headerBlocks[i - 1].left + headerBlocks[i - 1].width
            : headerBlocks[i - 1].left + Math.round(headerBlocks[i - 1].width / 2);
          const curLeft = newFmt
            ? headerBlocks[i].left
            : headerBlocks[i].left - Math.round(headerBlocks[i].width / 2);
          result[i].x_min = Math.round((prevRight + curLeft) / 2);
          result[i - 1].x_max = result[i].x_min;
        }
        if (i === result.length - 1) {
          result[i].x_max = region.x + region.w;
        }
      }
      return result;
    }

    // 根据列标题文字和位置猜测字段角色
    function guessField(text, colIdx, totalCols) {
      const t = (text || "").toLowerCase();
      if (/项目|检验|检测|实验|test|item|name/.test(t)) return "name";
      if (/结果|数值|测定|value|result/.test(t)) return "value";
      if (/分类|类型|category|type/.test(t)) return "category";
      if (/单位|unit/.test(t)) return "unit";
      if (/参考|区间|范围|ref|range|normal/.test(t)) return "range";
      if (/备注|note|镜检|标本|comment|说明/.test(t)) return "notes";
      // 按位置猜测（常见4列布局）
      const pos = ["name", "value", "unit", "range", "notes"];
      return pos[colIdx] || "ignore";
    }

    // 从OCR块中自动提取采样日期
    function extractDateFromOCRBlocks(blocks) {
      // 查找包含"采集时间"/"采样时间"/"采样日期"的块
      for (const b of blocks) {
        const t = (b.text || "").trim();
        // 匹配 "采集时间:2026-04-27 03:49" 或 "采样时间 2026/04/27" 等格式
        const m = t.match(/(?:采集|采样|样本)[时日][间期]?\s*[:：]?\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
        if (m) {
          return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        }
      }
      // 回退：查找任何看起来像日期的块（YYYY-MM-DD 或 YYYY/MM/DD 格式）
      for (const b of blocks) {
        const t = (b.text || "").trim();
        const m = t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
        if (m) {
          const month = parseInt(m[2], 10);
          const day = parseInt(m[3], 10);
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
          }
        }
      }
      return "";
    }

    function onMappingChange() {
      Vue.nextTick(drawPreviewCanvas);
    }

    function drawPreviewCanvas() {
      const canvas = previewCanvasRef.value;
      // 支持图片模式和PDF模式：图片模式用 loadedImage，PDF模式用 pdfBgCanvas
      const hasBg = loadedImage || (pdfBgCanvas && isPdf.value);
      if (!canvas || !hasBg) return;
      const wrap = canvas.parentElement;
      if (!wrap) return;
      const w = wrap.offsetWidth || 700;
      const h = wrap.offsetHeight || 500;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      let sc, offX, offY;

      if (loadedImage) {
        // 图片模式
        sc = Math.min(w / imgNaturalW, h / imgNaturalH);
        offX = (w - imgNaturalW * sc) / 2;
        offY = (h - imgNaturalH * sc) / 2;
        ctx.drawImage(loadedImage, offX, offY, imgNaturalW * sc, imgNaturalH * sc);
      } else {
        // PDF模式：使用 pdfBgCanvas 作为背景
        const bbox = computeOcrBbox();
        sc = Math.min((w * 0.92) / bbox.w, (h * 0.92) / bbox.h);
        offX = (w - bbox.w * sc) / 2 - bbox.minX * sc;
        offY = (h - bbox.h * sc) / 2 - bbox.minY * sc;
        const pdfDrawX = offX + bbox.minX * sc;
        const pdfDrawY = offY + bbox.minY * sc;
        const pdfDrawW = bbox.w * sc;
        const pdfDrawH = bbox.h * sc;
        ctx.drawImage(pdfBgCanvas, 0, 0, pdfBgCanvas.width, pdfBgCanvas.height,
          pdfDrawX, pdfDrawY, pdfDrawW, pdfDrawH);
      }

      // 选中区域红框
      if (selectionRect.value) {
        const sr = selectionRect.value;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          offX + sr.x * sc,
          offY + sr.y * sc,
          sr.w * sc,
          sr.h * sc,
        );
      }

      // 列分割线（紫色虚线）+ 栏间分割线（红色粗虚线）
      if (selectionRect.value && columnMappings.value.length > 1) {
        const sr = selectionRect.value;
        // 先绘制栏内列分割线（紫色细虚线）
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 1.5;
        for (let i = 1; i < columnMappings.value.length; i++) {
          // 跳过栏间分割线（不同 group 的边界）
          if (columnMappings.value[i].group !== columnMappings.value[i - 1].group) continue;
          const xDiv = columnMappings.value[i].x_min;
          const cx = offX + xDiv * sc;
          ctx.beginPath();
          ctx.moveTo(cx, offY + sr.y * sc);
          ctx.lineTo(cx, offY + (sr.y + sr.h) * sc);
          ctx.stroke();
        }
        // 再绘制栏间分割线（红色粗虚线）
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2.5;
        for (let i = 1; i < columnMappings.value.length; i++) {
          if (columnMappings.value[i].group === columnMappings.value[i - 1].group) continue;
          const xDiv = columnMappings.value[i].x_min;
          const cx = offX + xDiv * sc;
          ctx.beginPath();
          ctx.moveTo(cx, offY + sr.y * sc);
          ctx.lineTo(cx, offY + (sr.y + sr.h) * sc);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // ════════════ STEP 3 LOGIC ════════════════════════════

    async function goStep3() {
      if (step2Error.value) return;
      isLoading.value = true;
      try {
        const cfg = buildMappingConfig();
        const r = await api.applyColumnMapping(props.reportId, cfg);
        if (r.code === 0 && r.data) {
          parsedItems.value = r.data.items || [];
          originalItemIds.value = new Set(parsedItems.value.map(it => it.id).filter(Boolean));
          undoStack.value = [];
          redoStack.value = [];
          step.value = 3;
        } else {
          alert(r.message || "解析失败，请检查列映射配置");
        }
      } catch (e) {
        alert("解析请求出错：" + e.message);
      } finally {
        isLoading.value = false;
      }
    }

    function buildMappingConfig() {
      return {
        table_region: { ...selectionRect.value },
        header_row_y: headerCandidates.value[0]?.top ?? 0,
        // 多栏：收集所有表头行的 Y 坐标
        header_row_ys: [...new Set(headerCandidates.value.map((h) => h.top))].sort((a, b) => a - b),
        columns: columnMappings.value.map((c) => ({
          col_index: c.col_index,
          header_text: c.header_text,
          mapped_field: c.mapped_field,
          x_min: c.x_min,
          x_max: c.x_max,
          group: c.group ?? 0,
        })),
        sample_date: externalDate.value || "",
      };
    }

    // ── Undo / Redo ──────────────────────────────────────

    function pushUndo() {
      undoStack.value.push(JSON.parse(JSON.stringify(parsedItems.value)));
      redoStack.value = [];
    }
    function undoEdit() {
      if (!undoStack.value.length) return;
      redoStack.value.push(JSON.parse(JSON.stringify(parsedItems.value)));
      parsedItems.value = undoStack.value.pop();
    }
    function redoEdit() {
      if (!redoStack.value.length) return;
      undoStack.value.push(JSON.parse(JSON.stringify(parsedItems.value)));
      parsedItems.value = redoStack.value.pop();
    }

    // ── 行选中 ───────────────────────────────────────────

    function onRowClick(rowIdx, e) {
      const newSet = new Set(selectedRows.value);
      if (e.shiftKey) {
        if (newSet.has(rowIdx)) newSet.delete(rowIdx);
        else newSet.add(rowIdx);
      } else {
        newSet.clear();
        newSet.add(rowIdx);
      }
      selectedRows.value = newSet;
    }

    // ── 单元格编辑 ───────────────────────────────────────

    function startCellEdit(rowIdx, field, value) {
      // 如果正在编辑同一个单元格，不重复触发
      if (editingCell.value && editingCell.value.rowIdx === rowIdx && editingCell.value.field === field) return;
      // 先提交当前正在编辑的单元格
      if (editingCell.value) commitCellEdit();
      editingCell.value = { rowIdx, field, value: value || "" };
      Vue.nextTick(() => {
        if (activeEditInput) activeEditInput.focus();
      });
    }
    function commitCellEdit() {
      if (!editingCell.value) return;
      const { rowIdx, field, value } = editingCell.value;
      if (
        parsedItems.value[rowIdx] &&
        parsedItems.value[rowIdx][field] !== value
      ) {
        pushUndo();
        parsedItems.value[rowIdx][field] = value;
      }
      editingCell.value = null;
    }
    function cancelCellEdit() {
      editingCell.value = null;
    }

    // ── 分割 ─────────────────────────────────────────────

    function openSplitBar(rowIdx, field, text) {
      splitBar.value = {
        show: true,
        rowIdx,
        field,
        cellText: text || "",
        delimiter: " ",
        customDelimiter: "",
        preview: [],
      };
      updateSplitPreview();
    }
    function onSplitDelimiterChange() {
      // 当切换到自定义时，清空自定义输入并等待用户输入
      if (splitBar.value.delimiter === "__custom__") {
        splitBar.value.customDelimiter = "";
        splitBar.value.preview = [];
      } else {
        updateSplitPreview();
      }
    }
    function updateSplitPreview() {
      const { cellText, delimiter, customDelimiter } = splitBar.value;
      const actualDelimiter = delimiter === "__custom__" ? customDelimiter : delimiter;
      if (!actualDelimiter) {
        splitBar.value.preview = [];
        return;
      }
      splitBar.value.preview = cellText
        .split(actualDelimiter)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    function confirmSplit() {
      const { rowIdx, field, preview } = splitBar.value;
      if (preview.length <= 1) {
        splitBar.value.show = false;
        return;
      }
      pushUndo();
      if (field === "test_item_name") {
        // 按项目名拆为多行
        const original = parsedItems.value[rowIdx];
        const newRows = preview.map((t) => ({
          ...original,
          id: null,
          test_item_name: t,
        }));
        parsedItems.value.splice(rowIdx, 1, ...newRows);
      } else {
        // 其他字段只取首个分段
        parsedItems.value[rowIdx][field] = preview[0];
      }
      splitBar.value.show = false;
    }

    // ── 删除行 ───────────────────────────────────────────

    function deleteRow(rowIdx) {
      pushUndo();
      parsedItems.value.splice(rowIdx, 1);
    }

    // ── OCR 原文 tooltip ─────────────────────────────────

    function getCellTooltip(item, field) {
      if (!item.ocr_bbox || !ocrBlocks.value.length) return "";
      try {
        const bbox =
          typeof item.ocr_bbox === "string"
            ? JSON.parse(item.ocr_bbox)
            : item.ocr_bbox;
        const nearby = ocrBlocks.value.filter(
          (b) =>
            Math.abs(b.left - bbox.x) < 60 && Math.abs(b.top - bbox.y) < 20,
        );
        if (nearby.length)
          return "原始OCR: " + nearby.map((b) => b.text).join(" | ");
      } catch (e) {}
      return "";
    }

    // ── 保存医院模板 ─────────────────────────────────────

    async function saveTemplate() {
      if (!props.hospitalId) return;
      const cfg = buildMappingConfig();
      try {
        const r = await api.saveHospitalMappingTemplate(props.hospitalId, {
          name: "default",
          config: cfg,
        });
        if (r.code === 0) alert("已保存为该医院的默认列映射模板");
        else alert(r.message || "保存失败");
      } catch (e) {
        alert("保存出错：" + e.message);
      }
    }

    // ── 完成，触发核效 ───────────────────────────────────

    async function doApplyAndFinish() {
      isLoading.value = true;
      try {
        // 先删除用户在Step 3中删除的行
        const currentItemIds = new Set(parsedItems.value.map(it => it.id).filter(Boolean));
        for (const origId of originalItemIds.value) {
          if (!currentItemIds.has(origId)) {
            await api.deleteReportItem(props.reportId, origId);
          }
        }
        // 将 Step 3 中手动编辑的结果逐条 PUT 回服务器
        for (const item of parsedItems.value) {
          if (item.id) {
            await api.updateReportItem(props.reportId, item.id, {
              test_item_name: item.test_item_name || "",
              original_value: item.original_value || "",
              original_unit: item.original_unit || "",
              ref_interval_text: item.ref_interval_text || "",
              flag: item.flag || "",
            });
          }
        }
        // 自动入库：匹配参考区间、计算提示符、更新状态为 imported
        const importResult = await api.importReport(props.reportId);
        if (importResult.code !== 0) {
          alert("入库失败：" + (importResult.message || "未知错误"));
          return;
        }
        emit("done", { reportId: props.reportId });
      } catch (e) {
        alert("提交出错：" + e.message);
      } finally {
        isLoading.value = false;
      }
    }

    // ── 键盘快捷键 ───────────────────────────────────────

    function onKeyDown(e) {
      if (!props.visible || step.value !== 3) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        undoEdit();
      }
      if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        redoEdit();
      }
    }

    // ── 生命周期 ─────────────────────────────────────────

    Vue.watch(
      () => props.visible,
      async (v) => {
        if (v) {
          // 重置所有状态
          step.value = 1;
          selectionRect.value = null;
          parsedItems.value = [];
          undoStack.value = [];
          redoStack.value = [];
          headerCandidates.value = [];
          columnMappings.value = [];
          externalDate.value = "";
          loadedImage = null;
          apiBlocksReady = false;
          ocrBlocks.value = [];
          autoRegion.value = null;
          // PDF 模式：跳过图片加载，直接用块分布图作远块背景
          imgLoaded = isPdf.value;
          noPositionMode.value = false;
          loadBlocks();
        }
      },
    );

    // 当从 Step 2 返回 Step 1 时，v-if 销毁并重建 canvas DOM。
    // 必须重新设置 canvas 缓冲区尺寸并重绘，否则 canvas 不响应鼠标事件。
    Vue.watch(step, (newVal, oldVal) => {
      if (newVal === 1 && oldVal !== 1 && !noPositionMode.value) {
        // DOM 重建需要 nextTick + requestAnimationFrame 确保 canvas 已挂载
        Vue.nextTick(() => {
          requestAnimationFrame(() => {
            drawCanvasWhenReady();
          });
        });
      }
    });

    Vue.onMounted(() => {
      document.addEventListener("keydown", onKeyDown);
    });
    Vue.onUnmounted(() => {
      document.removeEventListener("keydown", onKeyDown);
    });

    return {
      step,
      steps,
      isLoading,
      isPdf,
      noPositionMode,
      insideBlockCount,
      outsideBlockCount,
      canvasRef,
      canvasWrapRef,
      sourceImgRef,
      previewCanvasRef,
      ocrBlocks,
      autoRegion,
      selectionRect,
      blocksLoading,
      imageError,
      pdfLoading,
      headerCandidates,
      columnMappings,
      externalDate,
      hasDateCol,
      step2Error,
      headerGroups,
      parsedItems,
      undoStack,
      redoStack,
      selectedRows,
      editingCell,
      splitBar,
      mergeWarning,
      activeGridCols,
      // Step 1
      onSourceImageLoad,
      onSourceImageError,
      skipToStep2,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      goStep2,
      // Step 2
      onMappingChange,
      goStep3,
      // Step 3
      undoEdit,
      redoEdit,
      onRowClick,
      startCellEdit,
      commitCellEdit,
      cancelCellEdit,
      openSplitBar,
      onSplitDelimiterChange,
      updateSplitPreview,
      confirmSplit,
      deleteRow,
      getCellTooltip,
      saveTemplate,
      doApplyAndFinish,
    };
  },
});
