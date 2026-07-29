(() => {
  'use strict';

  if (window.__MON_CARNET_STABILISATION_236__) return;
  window.__MON_CARNET_STABILISATION_236__ = true;

  const VERSION = 'V2.3.6';
  const DB_NAME = 'mon-carnet-cuisine-v1';
  const DB_VERSION = 1;
  const PATCH_TAG = 'data-v236-patch';
  let clairCleanupScheduled = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function fold(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatDuration(minutes = 0) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (!total) return '';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (!hours) return `${mins} min`;
    return mins ? `${hours} h ${String(mins).padStart(2, '0')}` : `${hours} h`;
  }

  function humanDurationFromInput(input) {
    const minutes = Math.max(0, Number(input?.value) || 0);
    return minutes ? formatDuration(minutes) : '';
  }

  function injectStyles() {
    if ($('#v236Styles')) return;
    const style = document.createElement('style');
    style.id = 'v236Styles';
    style.textContent = `
      .v236-top-actions{display:flex;align-items:center;gap:9px}
      .v236-duration-help{display:block;margin-top:6px;color:var(--forest,#153c35);font-weight:750;min-height:18px}
      .v236-help-overlay{position:fixed;inset:0;z-index:2200;background:rgba(14,22,19,.58);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:flex-end;justify-content:center;padding:18px}
      .v236-help-overlay.open{display:flex}
      .v236-help-card{width:min(680px,100%);max-height:88dvh;overflow:auto;background:var(--card-solid,#fffdf8);border-radius:28px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.28);color:var(--ink,#17211e)}
      .v236-help-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
      .v236-help-head h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:27px;font-weight:500}
      .v236-help-head p{margin:5px 0 0;color:var(--muted,#68736f);font-size:13px}
      .v236-help-section{padding:14px 0;border-top:1px solid var(--line,rgba(23,33,30,.12))}
      .v236-help-section h3{margin:0 0 8px;font-family:Georgia,"Times New Roman",serif;font-size:20px;font-weight:500}
      .v236-help-section p,.v236-help-section li{line-height:1.5;color:#4f5955}
      .v236-help-section ul{padding-left:20px;margin:8px 0 0}
      .v236-status{padding:12px 14px;border-radius:14px;background:rgba(21,60,53,.08);color:var(--forest,#153c35);white-space:pre-line;font-size:13px;line-height:1.5}
      .v236-status.warn{background:rgba(182,119,69,.14);color:#86512e}
      .v236-course-note{margin:0 0 10px;padding:10px 12px;border-radius:13px;background:rgba(21,60,53,.07);color:var(--forest,#153c35);font-size:12px;line-height:1.45}
      .v236-course-tools{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
      .v236-patch-tag{outline:0}
      @media(min-width:760px){.v236-help-overlay{align-items:center}}
    `;
    document.head.appendChild(style);
  }

  function updateVersionLabels() {
    document.title = `Mon carnet de cuisine — ${VERSION}`;
    $$('.brand small').forEach(el => {
      if (/collection personnelle/i.test(el.textContent || '')) el.textContent = `Collection personnelle · ${VERSION}`;
    });
  }

  function addDurationHelper(inputId, label) {
    const input = $('#' + inputId);
    if (!input) return;
    let helper = $('#' + inputId + 'Human');
    const refresh = () => {
      helper = $('#' + inputId + 'Human');
      if (!helper) return;
      const value = humanDurationFromInput(input);
      helper.textContent = value ? `${label} : ${value}` : '';
    };
    if (input.dataset.v236DurationReady) {
      refresh();
      return;
    }
    input.dataset.v236DurationReady = '1';
    input.setAttribute('aria-describedby', `${inputId}Human`);
    helper = document.createElement('small');
    helper.id = `${inputId}Human`;
    helper.className = 'v236-duration-help';
    input.insertAdjacentElement('afterend', helper);
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    refresh();
  }

  function installDurationHelpers() {
    addDurationHelper('recipePrepDuration', 'Affichage');
    addDurationHelper('recipeCookDuration', 'Affichage');
    addDurationHelper('recipeDuration', 'Total affiché');
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ouverture impossible'));
      request.onblocked = () => reject(new Error('Base momentanément bloquée'));
    });
  }

  async function readAllRecipes() {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('recipes', 'readonly');
        const request = tx.objectStore('recipes').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Lecture impossible'));
      });
    } finally {
      db.close();
    }
  }

  function detailHasLabel(meta, label) {
    return fold(meta?.textContent || '').includes(fold(label));
  }

  async function ensureDetailDurations() {
    const sheet = $('.detail-sheet');
    const meta = sheet?.querySelector('.detail-meta');
    const title = sheet?.querySelector('h2')?.textContent?.trim();
    if (!sheet || !meta || !title) return;

    try {
      const recipes = await readAllRecipes();
      const recipe = recipes.find(item => String(item?.title || '').trim() === title);
      if (!recipe) return;

      const prep = Math.max(0, Number(recipe.prepDuration) || 0);
      const marinade = Math.max(0, Number(recipe.marinadeDuration) || 0);
      const cook = Math.max(0, Number(recipe.cookDuration) || 0);
      const explicitTotal = Math.max(0, Number(recipe.duration) || 0);
      const total = prep || marinade || cook
        ? prep + cook + (marinade > 0 && marinade < 60 ? marinade : 0)
        : explicitTotal;

      const additions = [];
      if (prep && !detailHasLabel(meta, 'Préparation')) additions.push(`Préparation ${formatDuration(prep)}`);
      if (marinade && !detailHasLabel(meta, 'Marinade')) additions.push(`Marinade ${formatDuration(marinade)}${marinade >= 60 ? ' · à prévoir à l’avance' : ''}`);
      if (cook && !detailHasLabel(meta, 'Cuisson')) additions.push(`Cuisson ${formatDuration(cook)}`);
      if (total && !detailHasLabel(meta, 'Temps en cuisine') && !detailHasLabel(meta, 'Total')) {
        additions.push(`${prep || marinade || cook ? 'Temps en cuisine' : 'Total'} ${formatDuration(total)}`);
      }

      additions.forEach(text => {
        const tag = document.createElement('span');
        tag.className = 'tag v236-patch-tag';
        tag.setAttribute(PATCH_TAG, 'duration');
        tag.textContent = text;
        meta.appendChild(tag);
      });
    } catch (error) {
      recordError('Durées', error);
    }
  }

  function isSuspiciousCourseLine(text = '') {
    const normalized = fold(text)
      .replace(/^[✓☐☑\-–—•\d.)\s]+/, '')
      .trim();
    if (!normalized) return true;
    if (/^(preparation|etapes?|instructions?|cuisson|methode|realisation|dressage|finition|temps|duree|total)(?:\s*[:：]|$)/.test(normalized)) return true;
    if (/^(ingredients?|pour la sauce|pour le service|garniture|accompagnement)\s*[:：]?$/.test(normalized)) return true;
    if (/^(eplucher|peler|laver|rincer|egoutter|secher|couper|decouper|tailler|trancher|emincer|hacher|ciseler|ecraser|raper|presser|zester|melanger|fouetter|battre|ajouter|incorporer|verser|mettre|deposer|disposer|repartir|recouvrir|badigeonner|assaisonner|saler|poivrer|saupoudrer|arroser|prechauffer|chauffer|fondre|revenir|dorer|saisir|griller|cuire|enfourner|laisser|reserver|retourner|remuer|servir|garnir)\b/.test(normalized)) return true;
    if (/\b\d{2,3}\s*°\s*c\b/.test(normalized)) return true;
    if (/\b(?:pendant|puis|ensuite|jusqu|a mi[- ]cuisson)\b/.test(normalized) && /\b(?:min|minute|minutes|h|heure|heures|cuire|four|poele|plancha|airfryer)\b/.test(normalized)) return true;
    if (normalized.length > 170) return true;
    return false;
  }

  function courseItemText(item) {
    const select = item.querySelector('select');
    if (select?.value) return select.value.trim();
    const direct = item.querySelector('.clair-review-copy > span:first-child');
    if (direct?.textContent?.trim()) return direct.textContent.trim();
    const copy = item.querySelector('.clair-review-copy');
    return copy?.textContent?.trim() || '';
  }

  function uncheckCourseInput(input) {
    if (!input || !input.checked) return false;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function cleanCourseReview(showMessage = false) {
    const list = $('#clairReviewList');
    if (!list) return { removed: 0, duplicates: 0 };
    let removed = 0;
    let duplicates = 0;
    const seen = new Set();

    $$('.clair-review-item', list).forEach(item => {
      const input = item.querySelector('input[type="checkbox"]');
      const text = courseItemText(item);
      const normalized = fold(text).replace(/[^a-z0-9œ]+/g, ' ').trim();
      if (isSuspiciousCourseLine(text)) {
        if (uncheckCourseInput(input)) removed += 1;
        return;
      }
      if (normalized && seen.has(normalized)) {
        if (uncheckCourseInput(input)) duplicates += 1;
        return;
      }
      if (normalized) seen.add(normalized);
    });

    const note = $('#v236CourseNote');
    if (note) {
      const total = $$('.clair-review-item', list).length;
      note.textContent = `${total} article${total > 1 ? 's' : ''} à vérifier. ${removed + duplicates ? `${removed + duplicates} ligne${removed + duplicates > 1 ? 's' : ''} suspecte${removed + duplicates > 1 ? 's' : ''} décochée${removed + duplicates > 1 ? 's' : ''}.` : 'Aucune ligne manifestement incorrecte détectée.'}`;
    }
    if (showMessage) showPatchToast('Nettoyage prudent effectué');
    return { removed, duplicates };
  }

  function enhanceCourseModal() {
    const modal = $('#clairModal .modal');
    const list = $('#clairReviewList');
    if (!modal || !list) return;

    if (!$('#v236CourseNote')) {
      const note = document.createElement('p');
      note.id = 'v236CourseNote';
      note.className = 'v236-course-note';
      note.textContent = 'Vérifiez les articles avant l’envoi.';
      list.insertAdjacentElement('beforebegin', note);
    }

    if (!$('#v236CourseTools')) {
      const tools = document.createElement('div');
      tools.id = 'v236CourseTools';
      tools.className = 'v236-course-tools';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-light';
      button.textContent = 'Nettoyage prudent';
      button.addEventListener('click', () => cleanCourseReview(true));
      tools.appendChild(button);
      list.insertAdjacentElement('beforebegin', tools);
    }

    if (!clairCleanupScheduled) {
      clairCleanupScheduled = true;
      setTimeout(() => {
        clairCleanupScheduled = false;
        cleanCourseReview(false);
      }, 120);
    }
  }

  function recordError(context, error) {
    try {
      const payload = {
        date: new Date().toISOString(),
        context,
        message: String(error?.message || error || 'Erreur inconnue')
      };
      localStorage.setItem('monCarnet.lastError', JSON.stringify(payload));
    } catch (_) {}
  }

  function showPatchToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showPatchToast.timer);
    showPatchToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  async function runDiagnostic() {
    const status = $('#v236Status');
    if (!status) return;
    status.classList.remove('warn');
    status.textContent = 'Vérification en cours…';
    const missing = [];
    const required = [
      ['#quickAddBtn', 'Ajout de recette'],
      ['#recipeForm', 'Fiche recette'],
      ['#recipePrepDuration', 'Temps de préparation'],
      ['#recipeCookDuration', 'Temps de cuisson'],
      ['#prepareClairBtn', 'Clair Courses'],
      ['#cookingMode', 'Mode Je cuisine']
    ];
    required.forEach(([selector, label]) => { if (!$(selector)) missing.push(label); });

    let recipeCount = null;
    try {
      recipeCount = (await readAllRecipes()).length;
    } catch (error) {
      missing.push('Accès aux recettes');
      recordError('Diagnostic', error);
    }

    const lastError = (() => {
      try { return JSON.parse(localStorage.getItem('monCarnet.lastError') || 'null'); }
      catch (_) { return null; }
    })();

    if (missing.length) {
      status.classList.add('warn');
      status.textContent = `À contrôler : ${missing.join(', ')}.\nRecettes détectées : ${recipeCount ?? 'lecture impossible'}.`;
    } else {
      status.textContent = `Application opérationnelle.\nRecettes détectées : ${recipeCount}.\nBase conservée : ${DB_NAME} — version ${DB_VERSION}.${lastError ? `\nDernière erreur mémorisée : ${lastError.context} — ${lastError.message}` : ''}`;
    }
  }

  function closeHelp() {
    $('#v236HelpOverlay')?.classList.remove('open');
  }

  function openHelp() {
    $('#v236HelpOverlay')?.classList.add('open');
    runDiagnostic();
  }

  function addHelp() {
    const topbar = $('.topbar');
    const addButton = $('#quickAddBtn');
    if (!topbar || !addButton || $('#v236HelpBtn')) return;

    let actions = $('.v236-top-actions', topbar);
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'v236-top-actions';
      addButton.replaceWith(actions);
      actions.appendChild(addButton);
    }

    const helpButton = document.createElement('button');
    helpButton.id = 'v236HelpBtn';
    helpButton.className = 'icon-btn';
    helpButton.type = 'button';
    helpButton.setAttribute('aria-label', 'Aide et vérification');
    helpButton.textContent = '?';
    helpButton.addEventListener('click', openHelp);
    actions.insertBefore(helpButton, addButton);

    const overlay = document.createElement('div');
    overlay.id = 'v236HelpOverlay';
    overlay.className = 'v236-help-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'v236HelpTitle');
    overlay.innerHTML = `
      <div class="v236-help-card">
        <div class="v236-help-head">
          <div><h2 id="v236HelpTitle">Aide · ${VERSION}</h2><p>Version de stabilisation, sans modification de vos recettes.</p></div>
          <button class="icon-btn" id="v236HelpClose" type="button" aria-label="Fermer">×</button>
        </div>
        <section class="v236-help-section">
          <h3>Durées</h3>
          <p>Les valeurs restent enregistrées en minutes pour protéger les anciennes recettes. L’affichage lisible apparaît automatiquement : 75 minutes devient 1 h 15.</p>
        </section>
        <section class="v236-help-section">
          <h3>Clair Courses</h3>
          <p>La liste reste vérifiable avant l’envoi. Le bouton « Nettoyage prudent » décoche les consignes de préparation et les doublons évidents, sans effacer les ingrédients de la recette.</p>
        </section>
        <section class="v236-help-section">
          <h3>Vérification</h3>
          <div class="v236-status" id="v236Status">Vérification en cours…</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btn-primary" id="v236CheckBtn" type="button">Vérifier maintenant</button>
            <button class="btn btn-light" id="v236ReloadBtn" type="button">Recharger l’application</button>
          </div>
        </section>
      </div>`;
    document.body.appendChild(overlay);
    $('#v236HelpClose').addEventListener('click', closeHelp);
    $('#v236CheckBtn').addEventListener('click', runDiagnostic);
    $('#v236ReloadBtn').addEventListener('click', () => location.reload());
    overlay.addEventListener('click', event => { if (event.target === overlay) closeHelp(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHelp(); });
  }

  function observeDynamicViews() {
    const detail = $('#detailContent');
    if (detail) {
      new MutationObserver(() => setTimeout(ensureDetailDurations, 40))
        .observe(detail, { childList: true, subtree: true });
    }

    const clairModal = $('#clairModal');
    if (clairModal) {
      new MutationObserver(() => {
        if (clairModal.classList.contains('open')) enhanceCourseModal();
      }).observe(clairModal, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  function init() {
    injectStyles();
    updateVersionLabels();
    addHelp();
    installDurationHelpers();
    observeDynamicViews();
    ensureDetailDurations();
    enhanceCourseModal();

    window.addEventListener('error', event => recordError('JavaScript', event.error || event.message));
    window.addEventListener('unhandledrejection', event => recordError('Promesse', event.reason));

    // Les écrans sont rendus dynamiquement : une vérification légère suffit à
    // réafficher les aides sans toucher aux données ni aux fonctions existantes.
    setInterval(() => {
      updateVersionLabels();
      installDurationHelpers();
      if ($('#clairModal')?.classList.contains('open')) enhanceCourseModal();
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
