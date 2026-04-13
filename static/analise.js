(function () {
  const { alertMessage, countSummary, exportCertificates, formatCNPJ, loadCertificates,
    formatLoadError, notifyDataChanged, removeCertificate, setText, sortByPriority, updateCertificates } = window.DashboardData;

  const $ = (id) => document.getElementById(id);

  // Sanitiza texto antes de inserir em innerHTML — previne XSS
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const state = {
    certificates: [],
    activeFilter: 'todos',
    selectedCertificate: null,
    currentPage: 1,
    pageSize: 15,
    loadError: '',
  };

  const rows = document.getElementById('rows');
  const searchInput = document.getElementById('searchInput');
  const filterButtons = document.querySelectorAll('.chip');
  const updateBtn = document.getElementById('updateBtn');
  const updateIcon = document.getElementById('updateIcon');
  const uploadHint = document.getElementById('uploadPfxMsg');
  const detailContent = document.getElementById('detailContent');
  const fileInput = document.getElementById('fileInputPfx');
  const drawer = document.getElementById('detailsDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerClose = document.getElementById('drawerClose');
  const drawerSubtitle = document.getElementById('drawerSubtitle');

  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
    document.body.classList.add('drawer-active');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    document.body.classList.remove('drawer-active');
    state.selectedCertificate = null;
    rows.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'));
  }

  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  function progressColor(status) {
    if (status === 'Válido') return 'linear-gradient(90deg, #143f84, #4d87db)';
    if (status === 'A vencer') return 'linear-gradient(90deg, #d19216, #efc058)';
    return 'linear-gradient(90deg, #c63b3b, #ef7d7d)';
  }

  function progressWidth(days) {
    if (days <= 0) return 100;
    if (days <= 5) return 92;
    if (days <= 15) return 68;
    return Math.min(56, Math.max(18, (days / 180) * 56));
  }

  function normalize(value) {
    return (value || '').replace(/\D/g, '');
  }

  function rowClass(item) {
    if (item.duplicado) return 'duplicated';
    if (item.dias < 0) return 'expired';
    if (item.dias <= 5) return 'warning-high';
    if (item.dias <= 15) return 'warning-low';
    return '';
  }

  function badgeClass(status) {
    if (status === 'Válido') return 'ok';
    if (status === 'A vencer') return 'warn';
    return 'danger';
  }

  function daysLabel(days) {
    if (days < 0) return `${Math.abs(days)} dia(s) vencido(s)`;
    if (days === 0) return 'Vence hoje';
    return `${days} dia(s)`;
  }

  function filteredCertificates() {
    const term = searchInput.value.trim().toLowerCase();
    let data = sortByPriority(state.certificates);

    if (state.activeFilter === 'criticos') {
      data = data.filter(item => item.dias < 0);
    } else if (state.activeFilter === '7dias') {
      data = data.filter(item => item.dias >= 0 && item.dias <= 5);
    } else if (state.activeFilter === '15dias') {
      data = data.filter(item => item.dias >= 0 && item.dias <= 15);
    } else if (state.activeFilter === 'validos') {
      data = data.filter(item => item.dias > 15);
    }

    if (term) {
      const termDigits = normalize(term);
      data = data.filter(item =>
        item.empresa.toLowerCase().includes(term) ||
        item.cnpj.toLowerCase().includes(term) ||
        normalize(item.cnpj).includes(termDigits)
      );
    }

    return data;
  }

  function renderSummary() {
    const summary = countSummary(state.certificates);

    setText('mainAlert', state.loadError || alertMessage(summary));
    setText('analysisTotal', summary.total);
    setText('impactCount', summary.expired);
    setText('highRiskCount', summary.next5);
    setText('stableCount', summary.stable);
    setText('lastUpdateInline', new Date().toLocaleString('pt-BR'));
  }

  function renderDetails(cert) {
    if (!cert) return;

    drawerSubtitle.textContent = cert.empresa;

    detailContent.innerHTML = `
      <div class="detail-list">
        <div class="detail-item">
          <strong>Empresa</strong>
          <span>${esc(cert.empresa)}</span>
        </div>
        <div class="detail-item">
          <strong>CNPJ</strong>
          <span>${esc(formatCNPJ(cert.cnpj))}</span>
        </div>
        <div class="detail-item">
          <strong>Vencimento</strong>
          <span>${esc(cert.vencimento)}</span>
        </div>
        <div class="detail-item">
          <strong>Janela</strong>
          <span>${esc(daysLabel(cert.dias))}</span>
        </div>
        <div class="detail-item">
          <strong>Situação</strong>
          <span>${esc(cert.status)}</span>
        </div>
        <div class="detail-item">
          <strong>Risco</strong>
          <span>${esc(cert.risk.label)}</span>
        </div>
        <div class="detail-item">
          <strong>Arquivo</strong>
          <span>${esc(cert.arquivo || '-')}</span>
        </div>
      </div>
    `;

    openDrawer();
  }

  function rowActionsTemplate(index) {
    return `
      <div class="row-actions">
        <button class="table-action btn-detalhes" type="button" title="Ver detalhes" data-idx="${index}" aria-label="Ver detalhes">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/></svg>
        </button>
        <button class="table-action remove btn-remover" type="button" title="Remover certificado" data-idx="${index}" aria-label="Remover certificado">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6 17.874 19.142A2 2 0 0 1 15.882 21H8.118a2 2 0 0 1-1.992-1.858L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
  }

  function renderRows() {
    if (state.loadError) {
      rows.innerHTML = `<div class="empty-state">Erro ao carregar a base: ${esc(state.loadError)}</div>`;
      if ($('pagination')) $('pagination').innerHTML = '';
      return;
    }

    const allData    = filteredCertificates();
    const total      = allData.length;
    const totalPages = Math.ceil(total / state.pageSize) || 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    const start = (state.currentPage - 1) * state.pageSize;
    const data  = allData.slice(start, start + state.pageSize);

    if (!total) {
      rows.innerHTML = '<div class="empty-state">Nenhum certificado encontrado para os filtros aplicados.</div>';
      if ($('pagination')) $('pagination').innerHTML = '';
      return;
    }

    rows.innerHTML = data.map((item, index) => {
      const selectedClass = state.selectedCertificate && state.selectedCertificate.id === item.id ? ' selected' : '';
      const duplicateBadge = item.duplicado
        ? '<span class="dup-badge" title="Mesmo CNPJ e vencimento de outro certificado">Duplicado</span>'
        : '';

      return `
        <div class="row ${rowClass(item)}${selectedClass}" data-row-idx="${index}">
          <div class="company">
            <strong title="${esc(item.empresa)}">${esc(item.empresa)}</strong>
            <span>${duplicateBadge}</span>
          </div>
          <div class="cell" data-label="CNPJ">${esc(formatCNPJ(item.cnpj))}</div>
          <div class="cell" data-label="Vencimento">${esc(item.vencimento)}</div>
          <div class="cell days" data-label="Dias">${item.dias}</div>
          <div class="cell" data-label="Risco"><span class="risk ${item.risk.className}">${esc(item.risk.label)}</span></div>
          <div class="status-wrap" data-label="Situação">
            <span class="badge ${badgeClass(item.status)}">${esc(item.status)}</span>
            <div class="bar"><div style="width:${progressWidth(item.dias)}%; background:${progressColor(item.status)}"></div></div>
          </div>
          <div class="cell" data-label="Ação">${rowActionsTemplate(index)}</div>
        </div>
      `;
    }).join('');

    rows.querySelectorAll('[data-row-idx]').forEach(row => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('.btn-remover') || event.target.closest('.btn-detalhes')) return;
        const cert = data[Number(row.dataset.rowIdx)];
        state.selectedCertificate = cert;
        renderRows();
        renderDetails(cert);
      });
    });

    rows.querySelectorAll('.btn-detalhes').forEach(button => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const cert = data[Number(button.dataset.idx)];
        state.selectedCertificate = cert;
        renderRows();
        renderDetails(cert);
      });
    });

    rows.querySelectorAll('.btn-remover').forEach(button => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const cert = data[Number(button.dataset.idx)];
        showConfirmModal(`Remover certificado da empresa "${cert.empresa}"?`, async () => {
          const response = await removeCertificate(cert.id, cert.arquivo);
          if (response.success) {
            state.certificates = state.certificates.filter(item => item.id !== cert.id);
            if (state.selectedCertificate && state.selectedCertificate.id === cert.id) {
              closeDrawer();
            }
            renderSummary();
            renderRows();
            notifyDataChanged('removed');
            showToast('ok', 'Certificado removido', cert.empresa);
            await refreshData();
          } else {
            showToast('err', 'Falha ao remover', response.error || 'Erro ao remover certificado.');
          }
        });
      });
    });

    renderPagination(total);
  }

  function showConfirmModal(message, onConfirm) {
    const overlay = $('modalOverlay');
    const dialog  = $('modalDialog');
    $('modalMessage').textContent = message;
    overlay.classList.add('open');
    dialog.classList.add('open');

    function close() {
      overlay.classList.remove('open');
      dialog.classList.remove('open');
    }

    $('modalConfirm').onclick = () => { close(); onConfirm(); };
    $('modalCancel').onclick  = close;
    overlay.onclick           = close;
  }

  function renderPagination(total) {
    const pag = $('pagination');
    if (!pag) return;
    const totalPages = Math.ceil(total / state.pageSize);
    if (totalPages <= 1) { pag.innerHTML = ''; return; }

    const cur   = state.currentPage;
    const pages = [];
    pages.push(1);
    if (cur > 3) pages.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) pages.push(i);
    if (cur < totalPages - 2) pages.push('...');
    if (totalPages > 1) pages.push(totalPages);

    const mkBtn = (p, label, disabled, active) =>
      `<button class="page-btn${active ? ' active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;

    let html = mkBtn(cur - 1, '‹ Anterior', cur === 1, false);
    html += pages.map(p =>
      p === '...' ? `<span class="page-ellipsis">…</span>` : mkBtn(p, p, false, p === cur)
    ).join('');
    html += mkBtn(cur + 1, 'Próximo ›', cur === totalPages, false);

    pag.innerHTML = html;
    pag.querySelectorAll('.page-btn:not([disabled])').forEach(b => {
      b.addEventListener('click', () => {
        state.currentPage = Number(b.dataset.page);
        renderRows();
        rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function showToast(type, title, body, duration) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div>
        <div class="toast-title">${title}</div>
        ${body ? `<div>${body}</div>` : ''}
      </div>
    `;

    container.appendChild(toast);

    const timeout = duration || (type === 'warn' ? 8000 : 3500);
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    }, timeout);
  }

  function setUploadMessage(html) {
    uploadHint.innerHTML = html;
  }

  async function handleUpload(file) {
    const formData = new FormData();
    formData.append('file', file);
    setUploadMessage('Enviando certificado...');

    try {
      const response = await fetch('/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (data.duplicate) {
        const info = data.duplicate_info || {};
        const empresa = info.nome || info.arquivo || file.name;
        const cnpj = info.cnpj ? ` | CNPJ: ${info.cnpj}` : '';
        const venc = info.vencimento ? ` | Vencimento: ${info.vencimento}` : '';

        setUploadMessage(`<span style="color: #d6961d; font-weight: 700;">Aviso: certificado já existe na base.</span>`);
        showToast('warn', 'Certificado já existe', `${empresa}${cnpj}${venc}`, 9000);
      } else if (data.success) {
        setUploadMessage('<span style="color: #1f9d62; font-weight: 700;">Sucesso: certificado importado.</span>');
        notifyDataChanged('uploaded');
        showToast('ok', 'Certificado importado', file.name);
        await refreshData();
      } else {
        const error = data.error || 'Verifique o arquivo e tente novamente.';
        setUploadMessage(`<span style="color: #d54a4a; font-weight: 700;">Erro: ${error}</span>`);
        showToast('err', 'Falha ao importar', error);
      }
    } catch (error) {
      setUploadMessage('<span style="color: #d54a4a; font-weight: 700;">Erro: conexão com o servidor indisponível.</span>');
      showToast('err', 'Erro de conexão', 'Não foi possível conectar ao servidor.');
    }
  }

  async function refreshData() {
    updateBtn.disabled = true;
    updateIcon.classList.add('spin-loop');

    try {
      state.certificates = await loadCertificates();
      state.loadError = '';
      renderSummary();
      renderRows();
    } catch (error) {
      state.certificates = [];
      state.loadError = formatLoadError(error);
      setUploadMessage(`<span style="color: #d54a4a; font-weight: 700;">Erro ao carregar a base: ${esc(state.loadError)}</span>`);
      renderSummary();
      renderRows();
    } finally {
      updateBtn.disabled = false;
      updateIcon.classList.remove('spin-loop');
    }
  }

  async function handleUpdate() {
    updateBtn.disabled = true;
    updateIcon.classList.add('spin-loop');
    setUploadMessage('Atualizando base de certificados...');

    try {
      const result = await updateCertificates();
      if (result.success) {
        setUploadMessage('<span style="color: #1f9d62; font-weight: 700;">Base atualizada com sucesso.</span>');
        notifyDataChanged('updated');
        showToast('ok', 'Base atualizada', 'Leitura dos certificados concluída.');
        state.certificates = await loadCertificates();
        state.loadError = '';
        renderSummary();
        renderRows();
      } else {
        const msg = result.error || 'Erro ao atualizar a base.';
        setUploadMessage(`<span style="color: #d54a4a; font-weight: 700;">Erro: ${msg}</span>`);
        showToast('err', 'Falha ao atualizar', msg);
      }
    } catch (error) {
      const msg = formatLoadError(error);
      state.certificates = [];
      state.loadError = msg;
      renderSummary();
      renderRows();
      setUploadMessage(`<span style="color: #d54a4a; font-weight: 700;">Erro: ${esc(msg)}</span>`);
      showToast('err', 'Falha ao atualizar', msg);
    } finally {
      updateBtn.disabled = false;
      updateIcon.classList.remove('spin-loop');
    }
  }

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      filterButtons.forEach(node => node.classList.remove('active'));
      button.classList.add('active');
      state.activeFilter = button.dataset.filter;
      state.currentPage = 1;
      renderRows();
    });
  });

  searchInput.addEventListener('input', () => { state.currentPage = 1; renderRows(); });

  fileInput.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    await handleUpload(file);
    this.value = '';
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    exportCertificates(state.certificates);
  });

  updateBtn.addEventListener('click', handleUpdate);

  // Boot silencioso: carrega os dados atuais sem forçar nova varredura do backend
  (async () => {
    await refreshData();
  })();
})();
