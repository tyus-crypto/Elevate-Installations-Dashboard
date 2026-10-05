function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusClass(status){
  return {
    'Pre-Project': 'status-pre',
    'In Progress': 'status-progress',
    'Quality Check': 'status-quality',
    'Complete': 'status-complete',
  }[status] || 'status-progress';
}

async function loadProjects(){
  const grid = document.getElementById('project-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;

  let projects;
  try {
    const res = await fetch('/api/projects');
    if (res.status === 401) { location.href = '/'; return; }
    projects = await res.json();
  } catch {
    grid.innerHTML = '<p class="form-msg error">Could not load projects.</p>';
    return;
  }

  empty.hidden = projects.length > 0;
  grid.innerHTML = projects.map(p => `
    <button class="project-tile" onclick="location.href='/project.html?id=${p.id}'">
      <div class="pt-top">
        <span class="pt-name">${escapeHtml(p.name)}</span>
        <span class="status-pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span>
      </div>
      <div class="pt-sub">${escapeHtml(p.customerName)}${p.address ? ' · ' + escapeHtml(p.address) : ''}</div>
      <div class="pt-progress">
        <div class="progress-track"><div class="progress-fill" style="width:${p.pctComplete}%"></div></div>
        <span class="progress-pct">${p.pctComplete}%</span>
      </div>
      ${p.openIssueCount > 0 ? `<div class="pt-flags">${p.openIssueCount} open hold-up${p.openIssueCount > 1 ? 's' : ''}</div>` : ''}
    </button>
  `).join('');
}
