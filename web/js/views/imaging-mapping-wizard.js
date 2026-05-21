// imaging-mapping-wizard.js — 影像报告字段映射三步向导
// Step 1: 可视化预览 + 自动高亮（显示OCR块，颜色标记当前关键词匹配）
// Step 2: 字段级映射调整（字段卡片 + 点击高亮 + 拖拽分配）
// Step 3: 确认并保存（预览 + 提交）

const ImagingMappingWizard = Vue.defineComponent({
  name: "ImagingMappingWizard",
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
     @click.self="$emit('close')">
  <!-- 隐藏图片加载器 -->
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

    <!-- ════ STEP 1：可视化预览 + 自动高亮 ════ -->
    <div v-if="step===1" class="flex flex-1 min-h-0">
      <!-- 左侧：Canvas 预览 -->
      <div :class="['flex-1 relative', isPdf ? 'bg-slate-100' : 'bg-slate-800']"
           ref="canvasWrapRef"
           style="overflow:hidden;">
        <canvas ref="canvasRef"
                style="position:absolute;inset:0;cursor:default;touch-action:none;"
                @click="onCanvasClick"
                @wheel="onWheel"
                @mousedown="onMouseDown"
                @mousemove="onMouseMove"
                @mouseup="onMouseUp"
                @mouseleave="onMouseUp"></canvas>
        <!-- 缩放级别指示 -->
        <div class="absolute bottom-2 right-2 text-white/60 text-xs bg-black/40 px-2 py-1 rounded select-none">
          {{ (zoomLevel * 100).toFixed(0) }}%
        </div>
        <!-- 加载中覆盖层 -->
        <div v-if="blocksLoading || pdfLoading"
             style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;"
             class="text-white/70 text-sm bg-slate-800/90">
          {{ pdfLoading ? '正在渲染 PDF…' : '正在加载图像和OCR数据…' }}
        </div>
      </div>

      <!-- 右侧：OCR 块列表 + 图例 -->
      <div class="w-80 shrink-0 flex flex-col border-l bg-white">
        <!-- 图例 -->
        <div class="p-4 border-b">
          <h3 class="text-sm font-semibold mb-2">字段颜色图例</h3>
          <div class="space-y-1.5">
            <div v-for="(color, field) in fieldColors" :key="field" class="flex items-center gap-2">
              <div class="w-4 h-4 rounded" :style="{background: color}"></div>
              <span class="text-xs">{{getFieldLabel(field)}}</span>
            </div>
          </div>
        </div>

        <!-- OCR 块列表 -->
        <div class="flex-1 overflow-y-auto p-4">
          <h3 class="text-sm font-semibold mb-2">OCR 识别块 ({{ocrBlocks.length}})</h3>
          <div v-for="(block, idx) in ocrBlocks" :key="idx"
               class="p-2 mb-1 rounded text-xs cursor-pointer transition-all"
               :class="{'ring-2 ring-blue-500': selectedBlockIdx === idx}"
               :style="{background: getBlockColor(block, idx)}"
               @click="selectBlock(idx)">
            <div class="font-medium truncate">{{block.text}}</div>
            <div class="text-slate-500 mt-0.5">置信度: {{Math.round(block.confidence)}}%</div>
          </div>
          <div v-if="!ocrBlocks.length" class="text-center text-slate-400 py-8">
            暂无 OCR 数据
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="p-4 border-t bg-slate-50">
          <button @click="goStep2"
                  :disabled="!ocrBlocks.length"
                  class="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            下一步：调整映射 →
          </button>
        </div>
      </div>
    </div>

    <!-- ════ STEP 2：字段级映射调整 ════ -->
    <div v-if="step===2" class="flex flex-1 min-h-0">
      <!-- 左侧：字段卡片 -->
      <div class="w-96 shrink-0 flex flex-col border-r bg-slate-50">
        <div class="p-4 border-b bg-white">
          <h3 class="text-sm font-semibold">字段映射</h3>
          <p class="text-xs text-slate-500 mt-1">点击字段高亮对应 OCR 块，或拖拽 OCR 块到字段</p>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-for="field in fieldList" :key="field.key"
               class="bg-white rounded-lg border p-3 cursor-pointer transition-all"
               :class="{'ring-2 ring-blue-500 shadow': activeField === field.key, 'bg-blue-50': isDraggingOver === field.key}"
               @click="selectField(field.key)"
               @dragover.prevent="onDragOver(field.key)"
               @dragleave="onDragLeave(field.key)"
               @drop="onDrop(field.key, $event)">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium">{{field.label}}</span>
              <span class="text-xs px-2 py-0.5 rounded"
                    :style="{background: fieldColors[field.key] + '20', color: fieldColors[field.key]}">
                {{getFieldBlockCount(field.key)}} 块
              </span>
            </div>

            <!-- 编辑模式 -->
            <div v-if="editingField === field.key" class="mt-2">
              <textarea v-model="fieldEditValues[field.key]"
                        class="w-full p-2 text-xs border rounded resize-none"
                        rows="3"
                        @keydown.escape="cancelFieldEdit"
                        autofocus></textarea>
              <div class="flex gap-2 mt-2">
                <button @click.stop="saveFieldEdit(field.key)"
                        class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                  保存
                </button>
                <button @click.stop="cancelFieldEdit"
                        class="px-2 py-1 border text-xs rounded hover:bg-slate-50">
                  取消
                </button>
              </div>
            </div>

            <!-- 非编辑模式 -->
            <div v-else>
              <div class="text-xs text-slate-600 line-clamp-3 whitespace-pre-wrap mb-2"
                   style="max-height: 4.5rem; overflow: hidden;">
                {{getFieldValue(field.key) || '未分配'}}
              </div>

              <!-- 已分配的 OCR 块列表（可移除） -->
              <div v-if="fieldMappings[field.key] && fieldMappings[field.key].length > 0" class="space-y-1">
                <div v-for="idx in fieldMappings[field.key]" :key="idx"
                     class="flex items-center justify-between text-xs px-2 py-1 rounded"
                     :style="{background: fieldColors[field.key] + '10'}">
                  <span class="truncate flex-1">{{ocrBlocks[idx]?.text || ''}}</span>
                  <button @click.stop="removeBlockFromField(field.key, idx)"
                          class="ml-2 text-red-500 hover:text-red-700 shrink-0"
                          title="移除此块">
                    ✕
                  </button>
                </div>
              </div>

              <!-- 编辑按钮 -->
              <button v-if="activeField === field.key && !editingField"
                      @click.stop="startFieldEdit(field.key)"
                      class="mt-2 text-xs text-blue-600 hover:text-blue-800">
                ✎ 编辑内容
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：Canvas 预览 + OCR 块 -->
      <div class="flex-1 flex flex-col min-h-0">
        <!-- Canvas 区域 -->
        <div :class="['flex-1 relative', isPdf ? 'bg-slate-100' : 'bg-slate-800']"
             ref="canvasWrapRef2"
             style="overflow:hidden;">
          <canvas ref="canvasRef2"
                  style="position:absolute;inset:0;cursor:default;touch-action:none;"
                  @click="onCanvasClick2"
                  @wheel="onWheel"
                  @mousedown="onMouseDown"
                  @mousemove="onMouseMove"
                  @mouseup="onMouseUp"
                  @mouseleave="onMouseUp"></canvas>
          <!-- 缩放级别指示 -->
          <div class="absolute bottom-2 right-2 text-white/60 text-xs bg-black/40 px-2 py-1 rounded select-none">
            {{ (zoomLevel * 100).toFixed(0) }}%
          </div>
        </div>
        <!-- 底部 OCR 块列表（可拖拽） -->
        <div class="h-48 border-t bg-white overflow-y-auto p-3">
          <h4 class="text-xs font-medium text-slate-500 mb-2">OCR 块列表（拖拽到左侧字段）</h4>
          <div class="flex flex-wrap gap-2">
            <div v-for="(block, idx) in ocrBlocks" :key="idx"
                 draggable="true"
                 @dragstart="onDragStart(idx)"
                 class="px-2 py-1 rounded text-xs cursor-grab active:cursor-grabbing transition-all"
                 :style="{background: getBlockColor(block, idx)}"
                 :title="block.text">
              {{block.text.substring(0, 20)}}{{block.text.length > 20 ? '...' : ''}}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ STEP 3：确认并保存 ════ -->
    <div v-if="step===3" class="flex flex-1 min-h-0 flex-col">
      <div class="flex-1 overflow-y-auto p-6">
        <h3 class="text-lg font-semibold mb-4">确认映射结果</h3>
        <div class="grid grid-cols-2 gap-4">
          <div v-for="field in fieldList" :key="field.key" class="bg-slate-50 rounded-lg p-4">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-3 h-3 rounded" :style="{background: fieldColors[field.key]}"></div>
              <span class="text-sm font-medium">{{field.label}}</span>
            </div>
            <div class="text-sm text-slate-700 whitespace-pre-wrap">{{getFieldValue(field.key) || '—'}}</div>
          </div>
        </div>
      </div>
      <div class="px-6 py-4 border-t bg-slate-50 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" v-model="saveAsTemplate" class="rounded">
            保存为医院模板（同医院报告自动应用）
          </label>
        </div>
        <div class="flex gap-3">
          <button @click="step=2" class="px-4 py-2 border rounded-lg text-sm hover:bg-slate-100">
            ← 返回调整
          </button>
          <button @click="doApplyAndFinish"
                  class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            确认并保存
          </button>
        </div>
      </div>
    </div>

    <!-- ── 底栏：导航按钮 ── -->
    <div class="flex items-center justify-between px-6 py-3 border-t bg-white shrink-0">
      <button v-if="step > 1" @click="step--"
              class="px-4 py-2 border rounded-lg text-sm hover:bg-slate-100">
        ← 上一步
      </button>
      <div v-else></div>
      <div class="flex items-center gap-2">
        <button v-if="step < 3" @click="step++"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          下一步 →
        </button>
      </div>
    </div>

  </div>
</div>
</teleport>`,

  setup(props, { emit }) {
    const steps = ["预览高亮", "字段映射", "确认保存"];
    const step = Vue.ref(1);

    // OCR 数据
    const ocrBlocks = Vue.ref([]);
    const blocksLoading = Vue.ref(false);
    const pdfLoading = Vue.ref(false);
    const isPdf = Vue.computed(() => props.filePath.toLowerCase().endsWith(".pdf"));

    // Canvas 引用
    const canvasRef = Vue.ref(null);
    const canvasWrapRef = Vue.ref(null);
    const sourceImgRef = Vue.ref(null);
    const canvasRef2 = Vue.ref(null);
    const canvasWrapRef2 = Vue.ref(null);

    // pdf.js 状态（PDF 模式专用）
    let pdfDoc = null;
    let pdfPage = null;
    let pdfBgCanvas = null;
    let pdfRenderTask = null;
    let loadedImage = null;
    let imgNaturalW = 0, imgNaturalH = 0;
    let canvasScale = 1;
    let canvasOffX = 0, canvasOffY = 0;
    // 缩放状态
    const zoomLevel = Vue.ref(1);
    let isPanning = false;
    let panOffsetX = 0, panOffsetY = 0;
    let lastMouseX = 0, lastMouseY = 0;

    // 字段定义
    const fieldList = [
      { key: "exam_item_name", label: "检查项目" },
      { key: "inspect_no", label: "检查号" },
      { key: "sample_date", label: "检查日期" },
      { key: "exam_site", label: "检查部位" },
      { key: "exam_description", label: "影像表现" },
      { key: "diagnosis_result", label: "诊断结论" },
    ];

    // 字段颜色
    const fieldColors = {
      exam_item_name: "#3B82F6",    // 蓝色
      inspect_no: "#10B981",        // 绿色
      sample_date: "#8B5CF6",       // 紫色
      exam_site: "#EF4444",         // 红色
      exam_description: "#EC4899",  // 粉色
      diagnosis_result: "#F97316",  // 橙色
    };

    // 映射配置：field -> [block indices]
    const fieldMappings = Vue.ref({});
    // 手动编辑的字段值
    const fieldEditValues = Vue.ref({});
    const editingField = Vue.ref(null);
    const activeField = Vue.ref(null);
    const selectedBlockIdx = Vue.ref(-1);

    // 模板保存
    const saveAsTemplate = Vue.ref(false);

    // 初始化：加载 OCR 数据
    Vue.onMounted(async () => {
      if (props.visible && props.reportId) {
        resetWizardState();
        await loadOCRBlocks();
      }
    });

    Vue.watch(() => props.visible, async (val) => {
      if (val && props.reportId) {
        resetWizardState();
        await loadOCRBlocks();
      }
    });

    function resetWizardState() {
      step.value = 1;
      ocrBlocks.value = [];
      fieldMappings.value = {};
      fieldEditValues.value = {};
      editingField.value = null;
      activeField.value = null;
      selectedBlockIdx.value = -1;
      saveAsTemplate.value = false;
      zoomLevel.value = 1;
      panOffsetX = 0;
      panOffsetY = 0;
      loadedImage = null;
      imgNaturalW = 0;
      imgNaturalH = 0;
      canvasScale = 1;
      canvasOffX = 0;
      canvasOffY = 0;
      pdfDoc = null;
      pdfPage = null;
      pdfBgCanvas = null;
      if (pdfRenderTask) {
        pdfRenderTask.cancel();
        pdfRenderTask = null;
      }
    }

    async function loadOCRBlocks() {
      blocksLoading.value = true;
      try {
        const r = await api.getImagingOCRBlocks(props.reportId);
        if (r.code === 0 && r.data) {
          let blocks = r.data.blocks || [];
          ocrBlocks.value = blocks;
          // 尝试加载医院模板
          if (props.hospitalId) {
            await loadHospitalTemplate();
          }
          // 如果没有映射，使用自动关键词匹配
          if (Object.keys(fieldMappings.value).length === 0) {
            autoMapFields();
          }
        }
      } catch (e) {
        console.error("加载 OCR 块失败:", e);
      } finally {
        blocksLoading.value = false;
      }

      // PDF 模式：加载 PDF 背景
      if (isPdf.value && ocrBlocks.value.length > 0) {
        pdfLoading.value = true;
        await loadPdfBackground();
        pdfLoading.value = false;
        Vue.nextTick(() => {
          renderCanvas(canvasRef.value, canvasWrapRef.value);
        });
      }
    }

    // 自动关键词匹配
    function autoMapFields() {
      const keywords = {
        exam_item_name: [/检查项目/, /检查名称/],
        inspect_no: [/检查号/, /报告编号/, /编号/],
        sample_date: [/检查日期/, /报告日期/, /日期/],
        exam_site: [/检查部位/, /部位/],
        exam_description: [/影像表现/, /所见/, /描述/],
        diagnosis_result: [/诊断结论/, /印象/, /诊断意见/],
      };

      const mappings = {};
      ocrBlocks.value.forEach((block, idx) => {
        const text = block.text.toLowerCase();
        for (const [field, patterns] of Object.entries(keywords)) {
          if (patterns.some(p => p.test(text))) {
            if (!mappings[field]) mappings[field] = [];
            mappings[field].push(idx);
            break;
          }
        }
      });

      fieldMappings.value = mappings;
    }

    // 字段操作
    function getFieldLabel(key) {
      return fieldList.find(f => f.key === key)?.label || key;
    }

    function getFieldValue(key) {
      // 如果有手动编辑的值，优先使用
      if (fieldEditValues.value[key] !== undefined && fieldEditValues.value[key] !== "") {
        return fieldEditValues.value[key];
      }
      // 否则使用映射的 OCR 块内容
      const indices = fieldMappings.value[key] || [];
      if (!indices.length) return "";
      const texts = indices
        .filter(idx => idx >= 0 && idx < ocrBlocks.value.length)
        .map(idx => ocrBlocks.value[idx].text)
        .filter(Boolean);
      return texts.join("\n");
    }

    function getFieldBlockCount(key) {
      return (fieldMappings.value[key] || []).length;
    }

    function getBlockColor(block, idx) {
      // 查找该块属于哪个字段
      for (const [field, indices] of Object.entries(fieldMappings.value)) {
        if (indices.includes(idx)) {
          return fieldColors[field] + "0D"; // 5% 透明度（十六进制 0D ≈ 5%）
        }
      }
      return "#E2E8F0"; // 默认灰色
    }

    function getBlockField(idx) {
      for (const [field, indices] of Object.entries(fieldMappings.value)) {
        if (indices.includes(idx)) return field;
      }
      return "";
    }

    async function loadHospitalTemplate() {
      try {
        const r = await api.getImagingMappingTemplate(props.hospitalId);
        if (r.code === 0 && r.data) {
          fieldMappings.value = r.data.field_mappings || {};
        }
      } catch (e) {
        // 模板不存在时继续使用自动匹配。
      }
    }

    async function loadPdfBackground() {
      try {
        pdfDoc = await pdfjsLib.getDocument(props.reportImageUrl).promise;
        pdfPage = await pdfDoc.getPage(1);
        await renderPdfToBackground();
      } catch (e) {
        console.error("[imaging-wizard] pdf.js load error", e);
        pdfPage = null;
        pdfBgCanvas = null;
      }
    }

    async function renderPdfToBackground() {
      if (!pdfPage || ocrBlocks.value.length === 0) return;
      if (pdfRenderTask) {
        pdfRenderTask.cancel();
        pdfRenderTask = null;
      }

      const bbox = computeOcrBbox();
      const viewport = pdfPage.getViewport({ scale: 1 });
      const renderScale = bbox.w / viewport.width;
      const scaledViewport = pdfPage.getViewport({ scale: renderScale });

      pdfBgCanvas = document.createElement("canvas");
      pdfBgCanvas.width = Math.ceil(scaledViewport.width);
      pdfBgCanvas.height = Math.ceil(scaledViewport.height);

      const bgCtx = pdfBgCanvas.getContext("2d");
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, pdfBgCanvas.width, pdfBgCanvas.height);

      pdfRenderTask = pdfPage.render({
        canvasContext: bgCtx,
        viewport: scaledViewport,
        background: "#ffffff",
      });
      await pdfRenderTask.promise;
      pdfRenderTask = null;
    }

    function selectBlock(idx) {
      selectedBlockIdx.value = idx;
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    function selectField(key) {
      activeField.value = key;
      // 高亮对应 OCR 块
      selectedBlockIdx.value = -1;
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    function startFieldEdit(key) {
      editingField.value = key;
      fieldEditValues.value[key] = getFieldValue(key);
    }

    function saveFieldEdit(key) {
      // 保存手动编辑的值（不改变映射，只覆盖显示值）
      editingField.value = null;
    }

    function cancelFieldEdit() {
      editingField.value = null;
    }

    // 拖拽状态
    const isDraggingOver = Vue.ref(null);

    // 拖拽（从 OCR 块列表到字段卡片）
    function onDragStart(idx) {
      // 设置拖拽数据
      event.dataTransfer.setData("text/plain", idx);
    }

    function onDragOver(fieldKey) {
      isDraggingOver.value = fieldKey;
    }

    function onDragLeave(fieldKey) {
      isDraggingOver.value = null;
    }

    function onDrop(fieldKey, event) {
      event.preventDefault();
      isDraggingOver.value = null;
      const idx = parseInt(event.dataTransfer.getData("text/plain"));
      if (isNaN(idx) || idx < 0 || idx >= ocrBlocks.value.length) return;

      // 将 OCR 块添加到字段
      if (!fieldMappings.value[fieldKey]) {
        fieldMappings.value[fieldKey] = [];
      }
      if (!fieldMappings.value[fieldKey].includes(idx)) {
        fieldMappings.value[fieldKey].push(idx);
      }

      // 重新渲染 Canvas
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    function removeBlockFromField(fieldKey, blockIdx) {
      if (!fieldMappings.value[fieldKey]) return;
      fieldMappings.value[fieldKey] = fieldMappings.value[fieldKey].filter(idx => idx !== blockIdx);
      // 如果字段没有块了，删除该字段
      if (fieldMappings.value[fieldKey].length === 0) {
        delete fieldMappings.value[fieldKey];
      }
      // 重新渲染 Canvas
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    // 计算 OCR 块的包围盒（用于 PDF 背景缩放）
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

    // Canvas 渲染（支持缩放和平移）
    function renderCanvas(canvas, wrapRef) {
      if (!canvas || !wrapRef) return;
      const wrap = wrapRef;
      const w = wrap.clientWidth || 800;
      const h = wrap.clientHeight || 600;

      // 如果容器尺寸为 0，延迟重试
      if (w < 10 || h < 10) {
        requestAnimationFrame(() => renderCanvas(canvas, wrapRef));
        return;
      }

      const ctx = canvas.getContext("2d");
      canvas.width = w;
      canvas.height = h;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = isPdf.value ? "#f8fafc" : "#0f172a";
      ctx.fillRect(0, 0, w, h);
      canvasOffX = 0;
      canvasOffY = 0;

      // 应用缩放和平移
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoomLevel.value, zoomLevel.value);
      ctx.translate(-w / 2, -h / 2);
      ctx.translate(panOffsetX, panOffsetY);

      if (loadedImage) {
        // 图片模式：绘制图片背景
        const drawW = imgNaturalW * canvasScale;
        const drawH = imgNaturalH * canvasScale;
        canvasOffX = (w - drawW) / 2;
        canvasOffY = (h - drawH) / 2;
        ctx.drawImage(loadedImage, canvasOffX, canvasOffY, drawW, drawH);
      } else if (pdfBgCanvas && isPdf.value) {
        // PDF 模式：绘制 pdf.js 渲染的离屏 canvas
        const bbox = computeOcrBbox();
        canvasScale = Math.min((w * 0.92) / bbox.w, (h * 0.92) / bbox.h);
        canvasOffX = (w - bbox.w * canvasScale) / 2 - bbox.minX * canvasScale;
        canvasOffY = (h - bbox.h * canvasScale) / 2 - bbox.minY * canvasScale;
        const pdfDrawX = canvasOffX + bbox.minX * canvasScale;
        const pdfDrawY = canvasOffY + bbox.minY * canvasScale;
        const pdfDrawW = bbox.w * canvasScale;
        const pdfDrawH = bbox.h * canvasScale;
        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.14)";
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(pdfDrawX, pdfDrawY, pdfDrawW, pdfDrawH);
        ctx.restore();
        ctx.drawImage(pdfBgCanvas, 0, 0, pdfBgCanvas.width, pdfBgCanvas.height,
          pdfDrawX, pdfDrawY, pdfDrawW, pdfDrawH);
      } else if (ocrBlocks.value.length > 0) {
        // 无背景回退模式：深色背景
        const bbox = computeOcrBbox();
        canvasScale = Math.min((w * 0.92) / bbox.w, (h * 0.92) / bbox.h);
        canvasOffX = (w - bbox.w * canvasScale) / 2 - bbox.minX * canvasScale;
        canvasOffY = (h - bbox.h * canvasScale) / 2 - bbox.minY * canvasScale;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, w, h);
      }

      // 绘制 OCR 块（浅色底 + 边框），PDF 扫描件很浅时也能定位文字区域。
      // 支持两种坐标格式：has_position=true（左上角坐标）和 has_position=false（中心点坐标）
      ocrBlocks.value.forEach((block, idx) => {
        const bx = block.has_position
          ? canvasOffX + block.left * canvasScale
          : canvasOffX + (block.left - block.width / 2) * canvasScale;
        const by = block.has_position
          ? canvasOffY + block.top * canvasScale
          : canvasOffY + (block.top - block.height / 2) * canvasScale;
        const bw = block.width * canvasScale;
        const bh = block.height * canvasScale;
        const field = getBlockField(idx);
        const color = field ? fieldColors[field] : "#64748B";
        const isSelected = selectedBlockIdx.value === idx;
        const isActiveFieldBlock = activeField.value && field === activeField.value;

        ctx.globalAlpha = field ? 0.16 : 0.08;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, bw, bh);

        if (field || isSelected || isActiveFieldBlock) {
          ctx.globalAlpha = isSelected || isActiveFieldBlock ? 0.95 : 0.5;
          ctx.strokeStyle = isSelected ? "#2563EB" : color;
          ctx.lineWidth = isSelected || isActiveFieldBlock ? 2.5 : 1.2;
          ctx.strokeRect(bx, by, bw, bh);
        }
      });
      ctx.globalAlpha = 1;

      // 在预览上回绘 OCR 文本。部分影像 PDF 的原始扫描文字非常淡，
      // 仅展示 PDF 背景无法阅读，文本层作为可读性兜底。
      const shouldDrawText = isPdf.value || !loadedImage || canvasScale > 0.45;
      if (shouldDrawText) {
        const fontSize = Math.max(10, Math.min(15, 12 * canvasScale));
        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(2.5, fontSize / 3);
        ocrBlocks.value.forEach((block, idx) => {
          if (!block.text) return;
          const bx = block.has_position
            ? canvasOffX + block.left * canvasScale
            : canvasOffX + (block.left - block.width / 2) * canvasScale;
          const by = block.has_position
            ? canvasOffY + block.top * canvasScale
            : canvasOffY + (block.top - block.height / 2) * canvasScale;
          const bw = block.width * canvasScale;
          if (bw < 14) return;

          const maxChars = Math.max(4, Math.floor(bw / Math.max(fontSize * 0.55, 5)));
          const label = block.text.length > maxChars
            ? block.text.slice(0, Math.max(1, maxChars - 1)) + "…"
            : block.text;
          const field = getBlockField(idx);
          const fill = field ? fieldColors[field] : "#0f172a";

          ctx.globalAlpha = 1;
          ctx.strokeStyle = "rgba(255,255,255,0.96)";
          ctx.strokeText(label, bx + 2, by + 1);
          ctx.fillStyle = fill;
          ctx.fillText(label, bx + 2, by + 1);
        });
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    // 鼠标滚轮缩放
    function onWheel(e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomLevel.value = Math.max(0.5, Math.min(5, zoomLevel.value * delta));
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    // 鼠标拖拽平移
    function onMouseDown(e) {
      if (e.button !== 0) return; // 只响应左键
      isPanning = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }

    function onMouseMove(e) {
      if (!isPanning) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      panOffsetX += dx;
      panOffsetY += dy;
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    function onMouseUp() {
      isPanning = false;
    }

    function onSourceImageLoad() {
      const img = sourceImgRef.value;
      if (!img) return;
      loadedImage = img;
      imgNaturalW = img.naturalWidth;
      imgNaturalH = img.naturalHeight;
      canvasScale = Math.min(
        (canvasWrapRef.value?.clientWidth || 800) / imgNaturalW,
        (canvasWrapRef.value?.clientHeight || 600) / imgNaturalH
      );
      Vue.nextTick(() => {
        renderCanvas(canvasRef.value, canvasWrapRef.value);
        renderCanvas(canvasRef2.value, canvasWrapRef2.value);
      });
    }

    function onSourceImageError() {
      console.error("图片加载失败");
    }

    function onCanvasClick(e) {
      const rect = canvasRef.value.getBoundingClientRect();
      const x = (e.clientX - rect.left - canvasOffX) / canvasScale;
      const y = (e.clientY - rect.top - canvasOffY) / canvasScale;

      for (let i = ocrBlocks.value.length - 1; i >= 0; i--) {
        const block = ocrBlocks.value[i];
        const bx1 = block.has_position ? block.left : block.left - block.width / 2;
        const by1 = block.has_position ? block.top : block.top - block.height / 2;
        const bx2 = block.has_position ? block.left + block.width : block.left + block.width / 2;
        const by2 = block.has_position ? block.top + block.height : block.top + block.height / 2;
        if (x >= bx1 && x <= bx2 && y >= by1 && y <= by2) {
          selectedBlockIdx.value = i;
          Vue.nextTick(() => {
            renderCanvas(canvasRef.value, canvasWrapRef.value);
          });
          break;
        }
      }
    }

    function onCanvasClick2(e) {
      onCanvasClick(e);
    }

    // 步骤导航
    function goStep2() {
      step.value = 2;
      // 使用 requestAnimationFrame 确保 DOM 完全渲染和布局
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renderCanvas(canvasRef2.value, canvasWrapRef2.value);
        });
      });
    }

    function buildMappingConfig(includeFieldValues) {
      const config = {
        field_mappings: fieldMappings.value,
        hospital_id: props.hospitalId || null,
      };

      if (includeFieldValues) {
        const values = {};
        for (const [field, value] of Object.entries(fieldEditValues.value)) {
          if (typeof value !== "string") continue;
          const trimmed = value.trim();
          if (trimmed) values[field] = trimmed;
        }
        if (Object.keys(values).length > 0) {
          config.field_values = values;
        }
      }

      return config;
    }

    // 应用映射并保存
    async function doApplyAndFinish() {
      const config = buildMappingConfig(true);

      try {
        const r = await api.applyImagingMapping(props.reportId, config);
        if (r.code === 0) {
          // 如果选择保存模板
          if (saveAsTemplate.value && props.hospitalId) {
            await api.saveImagingMappingTemplate(props.hospitalId, {
              name: "default",
              config: buildMappingConfig(false),
            });
          }
          emit("done");
        } else {
          alert(r.message || "保存失败");
        }
      } catch (e) {
        alert("网络错误: " + e.message);
      }
    }

    // 监听 step 变化，切换到 Step 2 时重新渲染 Canvas
    Vue.watch(step, (newVal) => {
      if (newVal === 2) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            renderCanvas(canvasRef2.value, canvasWrapRef2.value);
          });
        });
      }
    });

    return {
      steps, step,
      ocrBlocks, blocksLoading, pdfLoading, isPdf,
      canvasRef, canvasWrapRef, sourceImgRef, canvasRef2, canvasWrapRef2,
      fieldList, fieldColors,
      fieldMappings, fieldEditValues, editingField, activeField, selectedBlockIdx,
      saveAsTemplate, isDraggingOver, zoomLevel,
      getFieldLabel, getFieldValue, getFieldBlockCount, getBlockColor,
      selectBlock, selectField, startFieldEdit, saveFieldEdit, cancelFieldEdit,
      onDragStart, onDragOver, onDragLeave, onDrop, removeBlockFromField,
      onWheel, onMouseDown, onMouseMove, onMouseUp,
      onSourceImageLoad, onSourceImageError,
      onCanvasClick, onCanvasClick2,
      goStep2, doApplyAndFinish,
    };
  },
});
