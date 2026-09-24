// Synthetic, memory-only interactions. No application store, API, or storage.
(() => {
  const root = document.getElementById('koc-proportions');
  let mode = 'quiet';

  const controls = document.createElement('nav');
  controls.className = 'preview-controls';
  controls.setAttribute('aria-label', 'Design preview controls');
  controls.innerHTML = `<div class="preview-note"><strong>LOCAL DESIGN PREVIEW</strong><span>Sample data only · app unchanged</span></div>
    <div class="preview-options"><label>Courts <select aria-label="Number of courts"><option value="3">3 · 6 teams</option><option value="7">7 · 14 teams</option><option value="8" selected>8 · 16 teams</option></select></label>
    <div class="preview-switch" aria-label="Compare design"><button type="button" data-preview-mode="detailed" aria-pressed="false">Before</button><button type="button" data-preview-mode="quiet" aria-pressed="true">After</button></div></div>`;
  document.body.append(controls);

  function fitText() {
    root.style.setProperty('--koc-font-scale', '1');
    root.querySelectorAll('.koc-match-row').forEach(row => {
      row.style.removeProperty('--court-fit');
      row.style.removeProperty('--score-button-size');
      row.querySelector('.koc-score strong').style.fontSize = '';
    });
    if (mode !== 'quiet' || window.innerWidth <= 900) return;
    const rows = [...root.querySelectorAll('.koc-rank')];
    let scale = 1;
    for (let attempt = 0; attempt < 7; attempt++) {
      const ratio = Math.min(1, ...rows.map(row => (row.clientHeight - 3) / row.querySelector('.koc-rank-name').scrollHeight));
      if (ratio >= 1) break;
      scale *= ratio * .98;
      root.style.setProperty('--koc-font-scale', String(scale));
    }
    root.querySelectorAll('.koc-match-row').forEach(row => {
      row.style.setProperty('--score-button-size', `${Math.max(24, Math.min(44, row.clientHeight - 3))}px`);
      const score = row.querySelector('.koc-score strong');
      score.style.fontSize = `${Math.min(parseFloat(getComputedStyle(score).fontSize), (row.clientHeight - 6) / 1.2)}px`;
      row.style.setProperty('--court-fit', '1');
      const text = row.querySelector('.koc-pair');
      // Wrapping changes in steps, so find the largest fitting size rather than
      // shrinking by a height ratio that can make long names needlessly tiny.
      if (text.scrollHeight > row.clientHeight - 6) {
        let low = 0;
        let high = 1;
        for (let attempt = 0; attempt < 10; attempt++) {
          const size = (low + high) / 2;
          row.style.setProperty('--court-fit', String(size));
          if (text.scrollHeight <= row.clientHeight - 6) low = size;
          else high = size;
        }
        row.style.setProperty('--court-fit', String(low));
      }
    });
  }

  function decorate() {
    const names = [...root.querySelectorAll('.koc-feature-pair strong')].map(element => element.textContent);
    root.querySelectorAll('.koc-feature-score>b').forEach((oldScore, index) => {
      const group = document.createElement('div');
      group.className = 'koc-feature-score-control';
      const score = document.createElement('strong');
      score.textContent = oldScore.textContent;
      score.setAttribute('aria-live', 'polite');
      [-1, 1].forEach(delta => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.scoreDelta = String(delta);
        button.textContent = delta < 0 ? '−' : '+';
        button.setAttribute('aria-label', `${delta < 0 ? 'Reduce' : 'Increase'} ${names[index]} score`);
        group.append(button);
        if (delta < 0) group.append(score);
      });
      oldScore.replaceWith(group);
    });
    root.querySelectorAll('.koc-match-row').forEach(row => {
      const name = row.querySelector('.koc-pair strong').textContent;
      row.querySelector('.koc-score strong').setAttribute('aria-live', 'polite');
      row.querySelectorAll('[data-score-delta]').forEach(button => button.setAttribute('aria-label', `${Number(button.dataset.scoreDelta) < 0 ? 'Reduce' : 'Increase'} ${name} score`));
    });
    applyMode();
  }

  function applyMode() {
    root.dataset.preview = mode;
    root.querySelector('.koc-brand small').textContent = mode === 'quiet' ? 'Jungle Padel Sanur' : 'Jungle Padel Sanur · Round 3 of 6';
    root.querySelector('.koc-preview-label').textContent = mode === 'quiet' ? 'Sample scores · not a live event' : 'Previous adjustment · sample data';
    controls.querySelectorAll('[data-preview-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.previewMode === mode)));
    if (mode !== 'quiet') root.style.setProperty('--koc-font-scale', '1');
    requestAnimationFrame(fitText);
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-preview-mode]');
    if (!button) return;
    mode = button.dataset.previewMode;
    applyMode();
  });
  controls.querySelector('select').addEventListener('change', event => {
    root.preview.setCourts(event.target.value);
  });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-score-delta]')) requestAnimationFrame(fitText);
  });
  root.addEventListener('preview:render', decorate);
  window.addEventListener('resize', () => requestAnimationFrame(fitText));
  const observer = new ResizeObserver(() => requestAnimationFrame(fitText));
  observer.observe(root.querySelector('.koc-body'));
  void document.fonts.ready.then(fitText);
  decorate();
})();
