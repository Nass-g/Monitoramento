(function () {
  const DATA_URL = '/static/certificados/resultados.json';

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
      arquivo: item.arquivo || '',
      empresa: item.empresa || item.nome || 'Empresa não identificada',
      cnpj: item.cnpj || '',
      vencimento: item.vencimento || '-',
      senha_utilizada: item.senha_utilizada || '',
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
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return json.map(normalizeCertificate);
    } catch (err) {
      console.error('[DashboardData] Falha ao carregar certificados:', err);
      return [];
    }
  }

  async function removeCertificate(cnpj) {
    const response = await fetch('/remover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj }),
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
    loadCertificates,
    removeCertificate,
    setText,
    sortByPriority,
    updateCertificates,
  };
})();
