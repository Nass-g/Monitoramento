(function () {
  const DATA_URL = '/api/certificados';

  function parseDateBR(value) {
    if (!value || typeof value !== 'string' || !value.includes('/')) return null;
    const parts = value.split('/');
    if (parts.length !== 3) return null;
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
  }

  function getDaysUntil(date) {
    if (!date) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((date - today) / (1000 * 60 * 60 * 24));
  }

  function getStatus(days) {
    if (days < 0) return 'Expirado';
    if (days <= 15) return 'A vencer';
    return 'Válido';
  }

  function getRisk(days) {
    if (days < 0) return { label: 'Crítico', className: 'critical' };
    if (days <= 5) return { label: 'Alto', className: 'high' };
    if (days <= 15) return { label: 'Médio', className: 'medium' };
    return { label: 'Baixo', className: 'low' };
  }

  function normalizeCertificate(item) {
    const expiresAt = parseDateBR(item.vencimento);
    const days = getDaysUntil(expiresAt);

    return {
      id: item.id || [item.arquivo || '', item.cnpj || '', item.vencimento || ''].join('|'),
      arquivo: item.arquivo || '',
      empresa: item.empresa || item.nome || 'Empresa não identificada',
      cnpj: item.cnpj || '',
      vencimento: item.vencimento || '-',
      duplicado: Boolean(item.duplicado),
      dias: days,
      status: getStatus(days),
      risk: getRisk(days),
    };
  }

  function sortByPriority(data) {
    return [...data].sort((a, b) => a.dias - b.dias || a.empresa.localeCompare(b.empresa));
  }

  function formatCNPJ(value) {
    if (!value) return 'CNPJ não informado';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  function countSummary(data) {
    const expired = data.filter(item => item.dias < 0).length;
    const next5 = data.filter(item => item.dias >= 0 && item.dias <= 5).length;
    const next15 = data.filter(item => item.dias >= 0 && item.dias <= 15).length;
    const stable = data.filter(item => item.dias > 15).length;

    return {
      total: data.length,
      expired,
      next5,
      next15,
      stable,
    };
  }

  async function loadCertificates() {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload && payload.error ? payload.error : `HTTP ${response.status}`;
      const error = new Error(detail);
      console.error('[DashboardData] Falha ao carregar certificados:', error);
      throw error;
    }

    if (!Array.isArray(payload)) {
      const error = new Error('Resposta inválida ao carregar certificados.');
      console.error('[DashboardData] Falha ao carregar certificados:', error);
      throw error;
    }

    return payload.map(normalizeCertificate);
  }

  function formatLoadError(error) {
    if (!error) return 'Não foi possível carregar a base de certificados.';
    return error.message || 'Não foi possível carregar a base de certificados.';
  }

  async function removeCertificate(id, arquivo) {
    const response = await fetch('/remover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, arquivo }),
    });

    return response.json();
  }

  async function updateCertificates() {
    const response = await fetch('/atualizar', { method: 'POST' });
    return response.json();
  }

  function exportCertificates(data) {
    const csv = 'Nome;CNPJ;Vencimento;Dias;Status\n' + data.map(item =>
      `${item.empresa};${item.cnpj};${item.vencimento};${item.dias};${item.status}`
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `certificados_${new Date().toISOString().split('T')[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function alertMessage(summary) {
    if (summary.expired > 0) {
      return `${summary.expired} certificado${summary.expired > 1 ? 's' : ''} expirado${summary.expired > 1 ? 's' : ''} — ação imediata necessária`;
    }
    if (summary.next5 > 0) {
      return `${summary.next5} certificado${summary.next5 > 1 ? 's' : ''} vence${summary.next5 === 1 ? '' : 'm'} nos próximos 5 dias`;
    }
    return 'Base sem itens críticos no momento';
  }

  window.DashboardData = {
    alertMessage,
    countSummary,
    exportCertificates,
    formatCNPJ,
    formatLoadError,
    loadCertificates,
    removeCertificate,
    setText,
    sortByPriority,
    updateCertificates,
  };
})();
