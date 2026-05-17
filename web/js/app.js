// app.js — Vue 3 应用入口（重构：仅保留路由+全局状态+组件注册）
const {
  createApp,
  ref,
  computed,
  reactive,
  onMounted,
  watch,
  nextTick,
  provide,
  inject,
} = Vue;

// ===== 应用实例 =====
const app = createApp({
  data() {
    return {
      currentView: "dashboard",
      navItems: [
        { hash: "dashboard", label: "仪表盘", icon: "📊" },
        { hash: "ocr", label: "上传 OCR", icon: "📷" },
        { hash: "batch-import", label: "批量导入", icon: "📦" },
        { hash: "batch-import-imaging", label: "批量导入影像", icon: "🩻" },
        { hash: "reports", label: "报告单", icon: "📄" },
        { hash: "subjects", label: "受检者", icon: "👤" },
        { hash: "test-items", label: "项目库", icon: "🧪" },
        { hash: "trend", label: "趋势分析", icon: "📈" },
        { hash: "settings", label: "设置", icon: "⚙️" },
      ],
      // 全局状态
      currentSubjectId: null,
      currentSubjectName: "未选择",
      globalSearchQuery: "",
      allSubjects: [],
    };
  },
  computed: {
    currentComponent() {
      const map = {
        dashboard: "DashboardView",
        ocr: "OCRImportView",
        "batch-import": "BatchImportView",
        "batch-import-imaging": "BatchImportImagingView",
        reports: "ReportsView",
        subjects: "SubjectsView",
        "test-items": "TestItemsView",
        trend: "TrendView",
        settings: "SettingsView",
      };
      return map[this.currentView] || "DashboardView";
    },
  },
  provide() {
    return {
      currentSubjectId: Vue.computed(() => this.currentSubjectId),
    };
  },
  mounted() {
    const hash = window.location.hash.replace("#", "") || "dashboard";
    this.currentView = hash;
    window.addEventListener("hashchange", () => {
      this.currentView = window.location.hash.replace("#", "") || "dashboard";
    });
    // 加载受检者列表缓存
    api.listSubjects().then((r) => {
      if (r.data) this.allSubjects = r.data;
    });
  },
  methods: {
    onSubjectChange(id, name) {
      this.currentSubjectId = id;
      this.currentSubjectName = name;
    },
    onSearchNavigate(view, id, name) {
      this.currentView = view;
      window.location.hash = view;
    },
  },
});

// 注册视图组件
app.component("DashboardView", DashboardView);
app.component("OCRImportView", OCRImportView);
app.component("BatchImportView", BatchImportView);
app.component("BatchImportImagingView", BatchImportImagingView);
app.component("ReportsView", ReportsView);
app.component("SubjectsView", SubjectsView);
app.component("TestItemsView", TestItemsView);
app.component("TrendView", TrendView);
app.component("SettingsView", SettingsView);

// 注册可复用组件
app.component("DataTable", DataTable);
app.component("OcrMappingWizard", OCRMappingWizard);
app.component("CrudModal", CrudModal);
app.component("SearchDropdown", SearchDropdown);
app.component("SubjectSelector", SubjectSelector);
app.component("SparklineChart", SparklineChart);
app.component("SyncScrollPanel", SyncScrollPanel);
app.component("DrilldownPopup", DrilldownPopup);

app.mount("#app");
