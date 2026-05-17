// api.js — HTTP 请求封装
const API_BASE = "/api/v1";

const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    const json = await res.json();
    if (json.code !== 0) {
      console.error("API error:", json.message);
    }
    return json;
  },

  async upload(path, formData) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      body: formData,
    });
    return res.json();
  },

  get(path) {
    return this.request("GET", path);
  },
  post(path, b) {
    return this.request("POST", path, b);
  },
  put(path, b) {
    return this.request("PUT", path, b);
  },
  del(path) {
    return this.request("DELETE", path);
  },

  // Health
  ping() {
    return this.get("/ping");
  },

  // Subjects
  listSubjects(search) {
    return this.get(
      "/subjects" + (search ? "?search=" + encodeURIComponent(search) : ""),
    );
  },
  createSubject(data) {
    return this.post("/subjects", data);
  },
  getSubject(id) {
    return this.get("/subjects/" + id);
  },
  updateSubject(id, d) {
    return this.put("/subjects/" + id, d);
  },
  deleteSubject(id) {
    return this.del("/subjects/" + id);
  },

  // Hospitals
  listHospitals() {
    return this.get("/hospitals");
  },
  createHospital(data) {
    return this.post("/hospitals", data);
  },
  updateHospital(id, d) {
    return this.put("/hospitals/" + id, d);
  },
  deleteHospital(id) {
    return this.del("/hospitals/" + id);
  },

  // Test Items
  listTestItems(category) {
    return this.get(
      "/test-items" +
        (category ? "?category=" + encodeURIComponent(category) : ""),
    );
  },
  createTestItem(data) {
    return this.post("/test-items", data);
  },
  updateTestItem(id, d) {
    return this.put("/test-items/" + id, d);
  },
  deleteTestItem(id) {
    return this.del("/test-items/" + id);
  },

  // Aliases
  listAliases(itemId) {
    return this.get("/test-items/" + itemId + "/aliases");
  },
  createAlias(itemId, d) {
    return this.post("/test-items/" + itemId + "/aliases", d);
  },
  deleteAlias(id) {
    return this.del("/test-item-aliases/" + id);
  },

  // Reference Intervals
  listRefIntervals(itemId) {
    return this.get("/test-items/" + itemId + "/reference-intervals");
  },
  createRefInterval(itemId, d) {
    return this.post("/test-items/" + itemId + "/reference-intervals", d);
  },
  updateRefInterval(id, d) {
    return this.put("/reference-intervals/" + id, d);
  },
  deleteRefInterval(id) {
    return this.del("/reference-intervals/" + id);
  },

  // Unit Conversions
  listUnitConversions(itemId) {
    return this.get(
      "/unit-conversions" + (itemId ? "?test_item_id=" + itemId : ""),
    );
  },
  createUnitConversion(d) {
    return this.post("/unit-conversions", d);
  },
  updateUnitConversion(id, d) {
    return this.put("/unit-conversions/" + id, d);
  },
  deleteUnitConversion(id) {
    return this.del("/unit-conversions/" + id);
  },

  // Calculation Rules
  listCalcRules() {
    return this.get("/calculation-rules");
  },
  createCalcRule(d) {
    return this.post("/calculation-rules", d);
  },
  updateCalcRule(id, d) {
    return this.put("/calculation-rules/" + id, d);
  },
  deleteCalcRule(id) {
    return this.del("/calculation-rules/" + id);
  },

  // Reports
  listReports(params) {
    const q = new URLSearchParams(params).toString();
    return this.get("/reports" + (q ? "?" + q : ""));
  },
  getReport(id) {
    return this.get("/reports/" + id);
  },
  updateReportItem(reportId, itemId, d) {
    return this.put("/reports/" + reportId + "/items/" + itemId, d);
  },
  deleteReportItem(reportId, itemId) {
    return this.del("/reports/" + reportId + "/items/" + itemId);
  },
  confirmReport(id) {
    return this.post("/reports/" + id + "/confirm");
  },
  importReport(id) {
    return this.post("/reports/" + id + "/import");
  },
  getReportImage(id) {
    return API_BASE + "/reports/" + id + "/image";
  },

  // OCR
  ocrUpload(formData) {
    return this.upload("/ocr/upload", formData);
  },
  reOCR(id) {
    return this.post("/reports/" + id + "/re-ocr");
  },
  getOCRQuota() {
    return this.get("/ocr/quota");
  },
  updateOCRQuota(d) {
    return this.put("/ocr/quota", d);
  },

  // Column Mapping
  getOCRBlocks(id) {
    return this.get("/reports/" + id + "/ocr-blocks");
  },
  applyColumnMapping(id, config) {
    return this.post("/reports/" + id + "/apply-mapping", config);
  },
  getHospitalMappingTemplate(hospId) {
    return this.get("/hospitals/" + hospId + "/mapping-template");
  },
  saveHospitalMappingTemplate(hospId, d) {
    return this.post("/hospitals/" + hospId + "/mapping-template", d);
  },

  // Hospital Rules
  listHospitalRules(hospitalId) {
    return this.get(
      "/hospital-rules" + (hospitalId ? "?hospital_id=" + hospitalId : ""),
    );
  },
  createHospitalRule(d) {
    return this.post("/hospital-rules", d);
  },
  updateHospitalRule(id, d) {
    return this.put("/hospital-rules/" + id, d);
  },
  deleteHospitalRule(id) {
    return this.del("/hospital-rules/" + id);
  },

  // Trend
  getTrendData(params) {
    const q = new URLSearchParams(params).toString();
    return this.get("/trend/data" + (q ? "?" + q : ""));
  },

  // Dashboard
  dashboardSummary() {
    return this.get("/dashboard/summary");
  },
  dashboardAnomalies(params) {
    const q = new URLSearchParams(params).toString();
    return this.get("/dashboard/anomalies" + (q ? "?" + q : ""));
  },

  // Backups
  exportBackup(desc) {
    return this.post("/backups/export", { description: desc });
  },
  importBackup(formData) {
    return this.upload("/backups/import", formData);
  },
  listBackups() {
    return this.get("/backups");
  },
  deleteBackup(id) {
    return this.del("/backups/" + id);
  },

  // Report update (category etc.)
  updateReport(id, d) {
    return this.put("/reports/" + id, d);
  },

  // Report Categories
  listCategories() {
    return this.get("/categories");
  },
  createCategory(data) {
    return this.post("/categories", data);
  },
  updateCategory(id, d) {
    return this.put("/categories/" + id, d);
  },
  deleteCategory(id) {
    return this.del("/categories/" + id);
  },
  normalizeCategory(d) {
    return this.post("/categories/normalize", d);
  },

  // Audit Logs
  listAuditLogs(params) {
    const q = new URLSearchParams(params).toString();
    return this.get("/audit-logs" + (q ? "?" + q : ""));
  },

  // Imaging Reports
  listImagingReportTypes() {
    return this.get("/imaging-report-types");
  },
  listImagingExamItems() {
    return this.get("/imaging-exam-items");
  },
  uploadImagingReport(formData) {
    return this.upload("/imaging/upload", formData);
  },
  listImagingReports(params) {
    const q = new URLSearchParams(params).toString();
    return this.get("/imaging-reports" + (q ? "?" + q : ""));
  },
  getImagingReport(id) {
    return this.get("/imaging-reports/" + id);
  },
  updateImagingReport(id, d) {
    return this.put("/imaging-reports/" + id, d);
  },
  deleteImagingReport(id) {
    return this.del("/imaging-reports/" + id);
  },
  getImagingReportImage(id) {
    return API_BASE + "/imaging-reports/" + id + "/image";
  },
  importImagingReport(id) {
    return this.post("/imaging-reports/" + id + "/import");
  },
  reOCRImaging(id) {
    return this.post("/imaging-reports/" + id + "/re-ocr")
  },
  
  uploadBatchFiles(formData) {
    return this.upload("/batch/upload", formData)
  },
  
  confirmBatchImport(data) {
    return this.post("/batch/confirm", data)
  },

  // Batch Import Imaging
  uploadBatchImagingFiles(formData) {
    return this.upload("/batch/imaging/upload", formData)
  },

  confirmBatchImagingImport(data) {
    return this.post("/batch/imaging/confirm", data)
  }
};
