(function () {
  'use strict';

  const { countSummary, formatCNPJ, formatLoadError, loadCertificates, setText, sortByPriority } = window.DashboardData;

  // ── Estado e refs DOM ────────────────────────────────────
  let certs = [];
  let loadError = '';
  const $ = id => document.getElementById(id);

  function renderLoadError(message) {
    const tvAlert = $('tvAlert');
    const badge = $('liveBadge');
    const bars = $('hbarList');
    const chart = $('lineWrap');

    if (tvAlert) {
      tvAlert.textContent = `Falha ao carregar base: ${message}`;
      tvAlert.style.color = 'var(--danger)';
    }

    if (badge) {
      badge.innerHTML = `<span class="live-dot danger-dot"></span>Falha na atualização`;
      badge.className = 'hero-badge live danger';
    }

    if (bars) {
      bars.innerHTML = `<div class="tv-loading">Erro ao carregar certificados: ${message}</div>`;
    }

    if (chart) {
      chart.innerHTML = `<div class="tv-loading">Erro ao carregar certificados: ${message}</div>`;
    }
  }

  // ── Contador animado ─────────────────────────────────────
  const _counters = {};
  function animateCount(id, target) {
    const el = $(id);
    if (!el) return;
    const from = _counters[id] ?? 0;
    if (from === target) {
      el.textContent = target;   // garante que "\u2014" do HTML vira 0
      return;
    }
    const t0 = performance.now();
    const tick = now => {
      const p = Math.min((now - t0) / 600, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * ease);
      if (p < 1) requestAnimationFrame(tick);
      else _counters[id] = target;
    };
    requestAnimationFrame(tick);
  }

  // ── KPIs ─────────────────────────────────────────────────
  function renderKPIs(summary, data) {
    const total    = summary.total   ?? 0;
    const expired  = summary.expired ?? 0;
    const upcoming = summary.next15  ?? 0;
    const stable   = summary.stable  ?? 0;

    animateCount('kpiTotal',     total);
    animateCount('kpiAttention', upcoming);
    animateCount('kpiExpired',   expired);
    animateCount('kpiStable',    stable);

    // Mini barra de saúde
    const hbar = $('kpiHealthBar');
    if (hbar) {
      const pExp  = total > 0 ? (expired / total * 100).toFixed(1) : 0;
      const pWarn = total > 0 ? (summary.next15 / total * 100).toFixed(1) : 0;
      const pOk   = total > 0 ? Math.max(0, 100 - pExp - pWarn).toFixed(1) : 100;
      hbar.innerHTML =
        `<div class="kpi-hb-seg"      style="width:${pExp}%"></div>` +
        `<div class="kpi-hb-seg warn" style="width:${pWarn}%"></div>` +
        `<div class="kpi-hb-seg ok"   style="width:${pOk}%"></div>`;
    }

    // Subtexto total
    setText('kpiTotalSub', `${total} certificado${total !== 1 ? 's' : ''} monitorado${total !== 1 ? 's' : ''}`);

    // Status no cabeçalho
    const tvAlert = $('tvAlert');
    if (tvAlert) {
      if (expired > 0) {
        tvAlert.textContent = `Atenção: ${expired} certificado${expired > 1 ? 's' : ''} expirado${expired > 1 ? 's' : ''}`;
        tvAlert.style.color = 'var(--danger)';
      } else if (upcoming > 0) {
        tvAlert.textContent = `Alerta: ${upcoming} certificado${upcoming > 1 ? 's' : ''} vence${upcoming === 1 ? '' : 'm'} nos próximos 15 dias`;
        tvAlert.style.color = 'var(--warn)';
      } else {
        tvAlert.textContent = 'Situação estável — sem alertas no momento';
        tvAlert.style.color = 'var(--ok)';
      }
    }

    // Badge ao vivo
    const badge = $('liveBadge');
    if (badge) {
      if (expired > 0) {
        badge.innerHTML = `<span class="live-dot danger-dot"></span>Certificados expirados`;
        badge.className = 'hero-badge live danger';
      } else if (upcoming > 0) {
        badge.innerHTML = `<span class="live-dot danger-dot"></span>${upcoming} a vencer`;
        badge.className = 'hero-badge live danger';
      } else {
        badge.innerHTML = `<span class="live-dot"></span>Ao vivo`;
        badge.className = 'hero-badge live';
      }
    }
  }

  // ── Barras por empresa ────────────────────────────────────
  function renderBars(data) {
    const list = $('hbarList');
    if (!list) return;

    if (!data.length) {
      list.innerHTML = `<div class="tv-loading">Nenhum certificado encontrado.</div>`;
      return;
    }

    const sorted   = sortByPriority(data);
    const expired  = sorted.filter(d => d.dias <  0);
    const critical = sorted.filter(d => d.dias >= 0 && d.dias <= 5);
    const warning  = sorted.filter(d => d.dias >  5 && d.dias <= 15);
    const stable   = sorted.filter(d => d.dias >  15);

    const panelLegend = document.querySelector('.bars-panel .bars-legend');
    const panelSub    = document.querySelector('.bars-panel .section-sub');

    // Estado "tudo em dia"
    if (!expired.length && !critical.length && !warning.length) {
      if (panelLegend) panelLegend.style.display = 'none';
      if (panelSub)    panelSub.style.display    = 'none';

      const [next] = stable;
      const proximoTexto = next
        ? `Próximo a vencer: <strong>${next.empresa}</strong> · ${next.vencimento} · ${next.dias} dia${next.dias !== 1 ? 's' : ''}`
        : 'Nenhum vencimento próximo';
      list.innerHTML = `
        <div class="hbar-all-ok">
          <div class="hbar-ok-icon">&#10003;</div>
          <div class="hbar-ok-body">
            <strong>Todos os certificados estão válidos</strong>
            <span>${proximoTexto}</span>
          </div>
        </div>`;
      return;
    }

    // Há urgências — garante visibilidade da legenda
    if (panelLegend) panelLegend.style.display = '';
    if (panelSub)    panelSub.style.display    = '';

    // Escala de urgência para a barra
    const urgPct = item => {
      if (item.dias < 0) return Math.min(Math.round((Math.abs(item.dias) / 30) * 70) + 30, 100);
      return Math.max(Math.round((1 - Math.min(item.dias, 15) / 15) * 100), 4);
    };

    // Coluna de dias (lado direito)
    const daysCol = (item, chipCls) => {
      if (item.dias === 0) {
        return `<div class="hbar-days-wrap hbar-days-hoje"><span class="hbar-hoje-tag">HOJE</span></div>`;
      }
      if (item.dias < 0) {
        const n = Math.abs(item.dias);
        return `<div class="hbar-days-wrap"><span class="hbar-days-num danger">${n}</span><span class="hbar-days-label danger">${n === 1 ? 'vencido' : 'vencidos'}</span></div>`;
      }
      return `<div class="hbar-days-wrap"><span class="hbar-days-num ${chipCls}">${item.dias}</span><span class="hbar-days-label ${chipCls}">${item.dias === 1 ? 'dia' : 'dias'}</span></div>`;
    };

    const html = [];

    function addGroup(items, label, rowCls, chipCls) {
      if (!items.length) return;
      html.push(`<div class="hbar-group-label hbar-gl-${rowCls}">${label} — ${items.length}</div>`);
      items.slice(0, 5).forEach((item, i) => {
        const isToday = item.dias === 0;
        html.push(`
          <div class="hbar-item hbar-row-${rowCls}${isToday ? ' hbar-row-today' : ''}${i % 2 === 1 ? ' hbar-alt' : ''}">
            <div class="hbar-label">
              <span class="hbar-name">${item.empresa}</span>
              <span class="hbar-cnpj">${formatCNPJ(item.cnpj)}</span>
            </div>
            <div class="hbar-track">
              <div class="hbar-fill ${chipCls}" style="width:${urgPct(item)}%"></div>
            </div>
            <div class="hbar-right">
              ${daysCol(item, chipCls)}
              <span class="hbar-date">${item.vencimento}</span>
            </div>
          </div>`);
      });
      if (items.length > 5) {
        html.push(`
          <div class="hbar-overflow">
            <span class="hbar-chip ${chipCls}">+${items.length - 5} neste grupo</span>
            <span class="hbar-date">ver todos em Detalhes dos itens</span>
          </div>`);
      }
    }

    addGroup(expired,  'Expirados',                  'expired', 'danger');
    addGroup(critical, 'Críticos — até 5 dias',      'danger',  'danger');
    addGroup(warning,  'Em atenção — 6 a 15 dias',   'warn',    'warn');

    if (stable.length) {
      html.push(`
        <div class="hbar-stable-footer">
          <span class="hbar-chip ok">${stable.length} ${stable.length > 1 ? 'estáveis' : 'estável'} — ocultos neste painel</span>
        </div>`);
    }

    list.innerHTML = html.join('');
  }

  // ── Calendário de vencimentos ────────────────────────────
  function renderChart(data) {
    const wrap = $('lineWrap');
    if (!wrap) return;

    if (!data.length) {
      wrap.innerHTML = `<div class="tv-loading">Nenhum certificado.</div>`;
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Mapa chave "YYYY-MM-DD" → lista de certs
    const byDate = {};
    data.forEach(item => {
      if (!item.vencimento || item.vencimento === '-') return;
      const [d, m, y] = item.vencimento.split('/');
      const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
    });

    // Meses que têm pelo menos um certificado
    const monthKeys = [...new Set(
      Object.keys(byDate).map(k => k.slice(0, 7))
    )].sort();

    if (!monthKeys.length) {
      wrap.innerHTML = `<div class="tv-loading">Nenhuma data de vencimento disponível.</div>`;
      return;
    }

    const chipCls = dias => {
      if (dias < 0)   return 'danger';
      if (dias <= 5)  return 'danger';
      if (dias <= 15) return 'warn';
      return 'ok';
    };

    const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

    const monthsHtml = monthKeys.map(mk => {
      const [yr, mo] = mk.split('-').map(Number);
      const label    = new Date(yr, mo - 1, 1)
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const firstDow  = new Date(yr, mo - 1, 1).getDay();
      const totalDays = new Date(yr, mo, 0).getDate();
      const isCurMo   = yr === today.getFullYear() && mo - 1 === today.getMonth();

      let cells = DIAS_SEMANA.map(d => `<div class="cal-wd">${d}</div>`).join('');
      for (let i = 0; i < firstDow; i++) cells += `<div class="cal-cell"></div>`;

      for (let day = 1; day <= totalDays; day++) {
        const dd    = String(day).padStart(2,'0');
        const mm    = String(mo).padStart(2,'0');
        const key   = `${yr}-${mm}-${dd}`;
        const dt    = new Date(yr, mo - 1, day);
        const isToday = dt.getTime() === today.getTime();
        const certs = byDate[key] || [];

        const chips = certs.map(c => {
          const cls   = chipCls(c.dias);
          const words = c.empresa.split(' ').filter(w => w.length > 2);
          const lbl   = (words[0] || c.empresa).slice(0, 10);
          return `<span class="cal-chip cal-chip-${cls}" title="${c.empresa} · ${c.vencimento} · ${c.dias < 0 ? 'expirado há ' + Math.abs(c.dias) + 'd' : c.dias + ' dias'}">${lbl}</span>`;
        }).join('');

        const cls = [
          'cal-cell',
          isToday         ? 'cal-today'    : '',
          certs.length    ? 'cal-has-cert' : 'cal-empty',
        ].filter(Boolean).join(' ');

        cells += `<div class="${cls}"><span class="cal-dn">${day}</span>${chips}</div>`;
      }

      return `
        <div class="cal-month${isCurMo ? ' cal-month-current' : ''}">
          <div class="cal-mname">${label}</div>
          <div class="cal-grid">${cells}</div>
        </div>`;
    }).join('');

    wrap.innerHTML = `<div class="cal-container">${monthsHtml}</div>`;
  }

  // ── Relógio ───────────────────────────────────────────────
  function renderClock() {
    setText('lastUpdate', new Date().toLocaleString('pt-BR'));
  }

  // ── Render completo ───────────────────────────────────────
  function render() {
    if (loadError) {
      const summary = countSummary([]);
      renderKPIs(summary, []);
      renderClock();
      renderLoadError(loadError);
      return;
    }

    const summary = countSummary(certs);
    renderKPIs(summary, certs);
    renderBars(certs);
    renderChart(certs);
    renderClock();
  }

  // ── Refresh de dados ──────────────────────────────────────
  async function refresh() {
    try {
      certs = await loadCertificates();
      loadError = '';
    } catch (error) {
      certs = [];
      loadError = formatLoadError(error);
    }
    render();
  }

  // ── Boot ─────────────────────────────────────────────────
  let cd = 60;

  renderClock();
  refresh();

  setInterval(renderClock, 1000);
  setInterval(() => {
    if (--cd <= 0) { cd = 60; refresh(); }
    setText('countdown', cd);
  }, 1000);

})();

