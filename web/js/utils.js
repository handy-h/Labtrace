// utils.js — 通用工具函数

/**
 * 防抖函数
 * @param {Function} fn - 被防抖的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { fn.apply(this, args); timer = null; }, delay);
  };
}

/**
 * 导出数据为CSV文件并触发浏览器下载
 * @param {string} filename - 文件名（不含扩展名）
 * @param {string[]} headers - 列头数组
 * @param {Object[]} rows - 数据行数组
 */
function exportCsv(filename, headers, rows) {
  const BOM = '\uFEFF';
  const headerLine = headers.join(',');
  const dataLines = rows.map(row =>
    headers.map(h => {
      const val = row[h] != null ? String(row[h]) : '';
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',')
  );
  const csv = BOM + headerLine + '\n' + dataLines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 深拷贝对象（JSON序列化方式，适用于纯数据对象）
 * @param {Object} obj - 源对象
 * @returns {Object} 深拷贝后的新对象
 */
function deepClone(obj) {
  if (obj == null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 计算年龄
 * @param {string} birthDate - 出生日期
 * @param {string} refDate - 参考日期
 * @returns {number|string} 年龄
 */
function calcAge(birthDate, refDate) {
  if (!birthDate) return '-';
  const b = new Date(birthDate);
  const r = refDate ? new Date(refDate) : new Date();
  let age = r.getFullYear() - b.getFullYear();
  if (r.getMonth() < b.getMonth() || (r.getMonth() === b.getMonth() && r.getDate() < b.getDate())) age--;
  return age;
}

/**
 * 置信度CSS类名
 * @param {number} c - 置信度值
 * @returns {string} CSS类名
 */
function confClass(c) {
  if (c >= 95) return 'conf-high';
  if (c >= 80) return 'conf-medium';
  return 'conf-low';
}

/**
 * 提示符徽章HTML
 * @param {string} f - 提示符
 * @returns {string} HTML字符串
 */
function flagBadge(f) {
  if (!f || f === 'normal') return '';
  // 白名单校验，防止 XSS
  const allowed = { H: 1, L: 1, '阳性': 1, '阴性': 1, '↑': 1, '↓': 1 };
  if (!(f in allowed)) return '';
  const cls = (f === 'H' || f === '阳性' || f === '↑') ? 'text-red-600 font-bold' : 'text-blue-600 font-bold';
  return `<span class="${cls}">${f}</span>`;
}

/**
 * 计算配额使用百分比
 * @param {Object} quota - 配额对象 {total_quota, used_count}
 * @returns {number} 使用百分比 (0-100)
 */
function quotaPct(quota) {
  if (!quota || quota.total_quota === 0) return 0;
  return Math.min(100, Math.round(quota.used_count / quota.total_quota * 100));
}

/**
 * 配额文字颜色类名
 * @param {Object} quota - 配额对象 {total_quota, used_count}
 * @returns {string} CSS类名
 */
function quotaTextClass(quota) {
  if (!quota) return 'text-slate-500';
  const remain = quota.total_quota - quota.used_count;
  if (remain > 50) return 'text-green-600 font-bold';
  if (remain > 10) return 'text-orange-500 font-bold';
  return 'text-red-600 font-bold';
}

/**
 * 配额进度条颜色类名
 * @param {Object} quota - 配额对象 {total_quota, used_count}
 * @returns {string} CSS类名
 */
function quotaBarClass(quota) {
  if (!quota) return 'bg-green-500';
  const remain = quota.total_quota - quota.used_count;
  if (remain > 50) return 'bg-green-500';
  if (remain > 10) return 'bg-orange-500';
  return 'bg-red-500';
}
