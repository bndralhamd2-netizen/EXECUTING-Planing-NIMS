/**
 * NIMS Execution Documentation System - Frontend Controller
 * لا يحتوي على أي رموز سرية؛ يرسل رمز العضو المدخل عبر HTTPS POST إلى Apps Script فقط.
 */

const GAS_WEB_APP_URL = 'PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE'; // <-- ضع رابط Web App هنا بعد النشر
const STORAGE_TOKEN_KEY = 'nims_member_token';
const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

let state = {
  token: localStorage.getItem(STORAGE_TOKEN_KEY) || '',
  member: null, // { name, role, tokenHash }
  records: []
};

document.addEventListener('DOMContentLoaded', () => {
  setDefaultDateTime();
  bindEvents();
  loadRecords();

  if (state.token) {
    document.getElementById('memberTokenInput').value = state.token;
    verifySavedToken(state.token, true);
  }
});

function setDefaultDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('executedAtInput').value = now.toISOString().slice(0, 16);
}

function bindEvents() {
  // التبويبات
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');

      if (btn.dataset.tab === 'auditTab') {
        loadAuditLogs();
      }
    });
  });

  // التحقق من رمز العضو
  document.getElementById('verifyTokenBtn').addEventListener('click', () => {
    const val = document.getElementById('memberTokenInput').value.trim();
    if (!val) {
      showToast('أدخل رمز العضو الخاص أولاً.');
      return;
    }
    verifySavedToken(val, false);
  });

  // مسح الرمز من الجهاز
  document.getElementById('clearTokenBtn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    state.token = '';
    state.member = null;
    document.getElementById('memberTokenInput').value = '';
    updateIdentityUI();
    renderRecords();
    showToast('تم مسح رمز العضو من هذا الجهاز.');
  });

  // التصفية والبحث
  document.getElementById('searchInput').addEventListener('input', renderRecords);
  document.getElementById('filterMember').addEventListener('change', renderRecords);
  document.getElementById('filterStatus').addEventListener('change', renderRecords);
  document.getElementById('refreshBtn').addEventListener('click', loadRecords);
  document.getElementById('refreshAuditBtn').addEventListener('click', loadAuditLogs);

  // إنشاء سجل جديد
  document.getElementById('createForm').addEventListener('submit', handleCreateSubmit);

  // نافذة التحديث
  document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('updateModal').classList.add('hidden');
  });
  document.getElementById('updateForm').addEventListener('submit', handleUpdateSubmit);
}

async function verifySavedToken(token, silent) {
  try {
    const res = await postToGAS({ action: 'verify_token', token });
    if (res.ok && res.member) {
      state.token = token;
      state.member = res.member;
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
      updateIdentityUI();
      renderRecords();
      if (!silent) showToast(`تم تفعيل جلسة العضو: ${res.member.name}`);
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      state.token = '';
      state.member = null;
      updateIdentityUI();
      if (!silent) showToast(res.error || 'الرمز غير صالح.');
    }
  } catch (err) {
    if (!silent) showToast('تعذر الاتصال بالخادم للتحقق من الرمز.');
  }
}

function updateIdentityUI() {
  const badge = document.getElementById('memberIdentityBadge');
  const clearBtn = document.getElementById('clearTokenBtn');

  if (state.member) {
    const roleLabel = state.member.role === 'lead' ? 'قائد المشروع' : 'عضو فريق';
    badge.textContent = `مُفعّل: ${state.member.name} (${roleLabel})`;
    badge.classList.remove('muted');
    clearBtn.classList.remove('hidden');
  } else {
    badge.textContent = 'وضع التصفح فقط — أدخل رمزك الخاص لتسجيل أو تحديث مهامك';
    badge.classList.add('muted');
    clearBtn.classList.add('hidden');
  }
}

async function loadRecords() {
  const container = document.getElementById('recordsContainer');
  container.innerHTML = '<div class="loading-box">جارٍ تحميل السجلات...</div>';

  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?action=list`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'فشل الجلب');

    state.records = data.records || [];
    updateStats();
    populateMemberFilter();
    renderRecords();
  } catch (err) {
    container.innerHTML = `<div class="loading-box">تعذّر تحميل السجلات: ${escapeHtml(err.message)}</div>`;
  }
}

function updateStats() {
  const total = state.records.length;
  const completed = state.records.filter(r => r.status === 'Completed').length;
  const passed = state.records.filter(r => r.test_result === 'Passed').length;
  const active = state.records.filter(r => r.status === 'In Progress' || r.status === 'Needs Review').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statCompleted').textContent = completed;
  document.getElementById('statPassed').textContent = passed;
  document.getElementById('statInProgress').textContent = active;
}

function populateMemberFilter() {
  const select = document.getElementById('filterMember');
  const current = select.value;
  const members = [...new Set(state.records.map(r => r.executor_name).filter(Boolean))];

  select.innerHTML = '<option value="">كل أعضاء الفريق</option>' +
    members.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  select.value = current;
}

function renderRecords() {
  const container = document.getElementById('recordsContainer');
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const memberFilter = document.getElementById('filterMember').value;
  const statusFilter = document.getElementById('filterStatus').value;

  const filtered = state.records.filter(r => {
    const matchText = !q ||
      r.task_code.toLowerCase().includes(q) ||
      r.task_title.toLowerCase().includes(q) ||
      r.executor_name.toLowerCase().includes(q) ||
      r.module.toLowerCase().includes(q);
    const matchMember = !memberFilter || r.executor_name === memberFilter;
    const matchStatus = !statusFilter || r.status === statusFilter;
    return matchText && matchMember && matchStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="loading-box">لا توجد سجلات مطابقة للبحث الحالي.</div>';
    return;
  }

  container.innerHTML = filtered.map(r => {
    const canEdit = state.member && (state.member.tokenHash === r.owner_hash || state.member.role === 'lead');
    const statusClass = 'badge-' + r.status.replace(/\s+/g, '-');
    const resultClass = 'badge-' + r.test_result.replace(/\s+/g, '-');

    const historyHtml = (r.versions_history && r.versions_history.length > 1)
      ? `<details class="versions-box">
          <summary>سجل الإصدارات السابقة (${r.versions_history.length} إصدارات محفوظة)</summary>
          <ul>
            ${r.versions_history.map(v => `
              <li>
                <strong>v${v.version}</strong> — ${escapeHtml(v.status)} / ${escapeHtml(v.test_result)}
                (${formatDate(v.updated_at)})
                ${v.file_url ? `— <a class="file-link" href="${escapeHtml(v.file_url)}" target="_blank" rel="noopener">${escapeHtml(v.file_name)}</a>` : ''}
              </li>
            `).join('')}
          </ul>
        </details>`
      : '';

    return `
      <article class="record-card">
        <div class="record-head">
          <div class="record-title-wrap">
            <span class="code-pill">${escapeHtml(r.task_code)}</span>
            <strong>${escapeHtml(r.task_title)}</strong>
            <span class="code-pill">v${r.version}</span>
          </div>
          <div>
            <span class="badge ${statusClass}">${escapeHtml(r.status)}</span>
            <span class="badge ${resultClass}">Test: ${escapeHtml(r.test_result)}</span>
          </div>
        </div>

        <div class="record-meta">
          <span>المنفّذ: <strong>${escapeHtml(r.executor_name)}</strong></span>
          <span>المسار: ${escapeHtml(r.module)}</span>
          <span>تاريخ التنفيذ: ${formatDate(r.executed_at)}</span>
          <span>آخر تحديث: ${formatDate(r.updated_at)}</span>
        </div>

        ${r.notes ? `<div class="record-notes">${escapeHtml(r.notes)}</div>` : ''}

        <div class="record-footer">
          <div>
            ${r.file_url
              ? `<a class="file-link" href="${escapeHtml(r.file_url)}" target="_blank" rel="noopener">📎 فتح المرفق (${escapeHtml(r.file_name)})</a>`
              : '<span class="subtitle">لا يوجد ملف مرفق</span>'}
          </div>

          <div style="display:flex; gap:8px;">
            ${canEdit ? `
              <button type="button" class="btn btn-secondary" onclick="openUpdateModal('${escapeHtml(r.execution_id)}')">تحديث / إصدار جديد</button>
              <button type="button" class="btn btn-danger-soft" onclick="archiveRecord('${escapeHtml(r.execution_id)}')">أرشفة</button>
            ` : ''}
          </div>
        </div>
        ${historyHtml}
      </article>
    `;
  }).join('');
}

async function handleCreateSubmit(e) {
  e.preventDefault();
  if (!state.token || !state.member) {
    showToast('يجب تفعيل رمز العضو الخاص في أعلى الصفحة قبل التسجيل.');
    return;
  }

  const btn = document.getElementById('submitCreateBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ والرفع...';

  try {
    const fileInput = document.getElementById('fileInput');
    const filePayload = await prepareFilePayload(fileInput.files[0]);

    const payload = {
      action: 'create',
      token: state.token,
      task_code: document.getElementById('taskCode').value.trim(),
      task_title: document.getElementById('taskTitle').value.trim(),
      module: document.getElementById('moduleSelect').value,
      status: document.getElementById('statusSelect').value,
      test_result: document.getElementById('testResultSelect').value,
      executed_at: document.getElementById('executedAtInput').value,
      notes: document.getElementById('notesInput').value.trim(),
      file: filePayload
    };

    const res = await postToGAS(payload);
    if (!res.ok) throw new Error(res.error || 'فشل الحفظ');

    showToast(res.message);
    document.getElementById('createForm').reset();
    setDefaultDateTime();
    await loadRecords();
    document.querySelector('[data-tab="recordsTab"]').click();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ وتوثيق التنفيذ';
  }
}

function openUpdateModal(executionId) {
  const rec = state.records.find(r => r.execution_id === executionId);
  if (!rec) return;

  document.getElementById('updExecutionId').value = rec.execution_id;
  document.getElementById('modalTitle').textContent = `تحديث [${rec.task_code}] — الإصدار القادم v${rec.version + 1}`;
  document.getElementById('updStatus').value = rec.status;
  document.getElementById('updTestResult').value = rec.test_result;
  document.getElementById('updNotes').value = rec.notes;
  document.getElementById('updFile').value = '';
  document.getElementById('updateModal').classList.remove('hidden');
}

async function handleUpdateSubmit(e) {
  e.preventDefault();
  if (!state.token) {
    showToast('رمز العضو غير مفعّل.');
    return;
  }

  const btn = document.getElementById('submitUpdateBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ حفظ الإصدار...';

  try {
    const fileObj = document.getElementById('updFile').files[0];
    const filePayload = await prepareFilePayload(fileObj);

    const payload = {
      action: 'update',
      token: state.token,
      execution_id: document.getElementById('updExecutionId').value,
      status: document.getElementById('updStatus').value,
      test_result: document.getElementById('updTestResult').value,
      notes: document.getElementById('updNotes').value.trim(),
      file: filePayload
    };

    const res = await postToGAS(payload);
    if (!res.ok) throw new Error(res.error || 'فشل التحديث');

    showToast(res.message);
    document.getElementById('updateModal').classList.add('hidden');
    await loadRecords();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ كإصدار جديد';
  }
}

async function archiveRecord(executionId) {
  if (!confirm('سيتم نقل السجل إلى الأرشيف مع الاحتفاظ بجميع إصداراته وملفاته دون حذف نهائي. هل تريد المتابعة؟')) {
    return;
  }

  try {
    const res = await postToGAS({
      action: 'archive',
      token: state.token,
      execution_id: executionId
    });
    if (!res.ok) throw new Error(res.error || 'تعذرت الأرشفة');
    showToast(res.message);
    await loadRecords();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '<tr><td colspan="6">جارٍ تحميل سجل التدقيق...</td></tr>';

  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?action=audit`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">لا توجد عمليات مسجلة بعد.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${formatDate(l.timestamp)}</td>
        <td><strong>${escapeHtml(l.actor_name)}</strong></td>
        <td><span class="code-pill">${escapeHtml(l.action)}</span></td>
        <td>${escapeHtml(l.execution_id)}</td>
        <td>${escapeHtml(l.version)}</td>
        <td>${escapeHtml(l.details)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">خطأ: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function prepareFilePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error('حجم الملف يتجاوز الحد المسموح به (12 ميجابايت).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: base64
      });
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف من الجهاز.'));
    reader.readAsDataURL(file);
  });
}

async function postToGAS(payload) {
  const response = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return await response.json();
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return escapeHtml(isoStr);
  return d.toLocaleString('ar-YE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 4200);
}
