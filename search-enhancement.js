(() => {
  'use strict';

  const DB_NAME = 'mon-carnet-cuisine-v1';
  const DB_VERSION = 1;
  const MAX_RESULTS = 50;
  const MIN_QUERY_LENGTH = 2;
  const INPUT_DELAY_MS = 320;

  let recipeIndexPromise = null;
  let renderTicket = 0;
  let inputTimer = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value = '') => String(value).replace(/[&<>\'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function foldText(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[œŒ]/g, 'oe')
      .replace(/[æÆ]/g, 'ae')
      .replace(/[’']/g, ' ')
      .toLowerCase();
  }

  function searchableText(value = '') {
    return foldText(value)
      .replace(/air\s*fryer/g, 'air fryer airfryer')
      .replace(/micro\s*-?\s*ondes?/g, 'micro ondes microondes')
      .replace(/barbecue|weber/g, match => `${match} grill`)
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(value = '') {
    return searchableText(value).split(' ').filter(Boolean);
  }

  function singularToken(token = '') {
    if (token.length <= 3) return token;
    if (token.endsWith('aux') && token.length > 5) return `${token.slice(0, -3)}al`;
    if (token.endsWith('eaux') && token.length > 6) return token.slice(0, -1);
    if (/[sx]$/.test(token)) return token.slice(0, -1);
    return token;
  }

  function editDistanceAtMostOne(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i += 1;
        j += 1;
        continue;
      }
      edits += 1;
      if (edits > 1) return false;
      if (a.length > b.length) i += 1;
      else if (b.length > a.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
    if (i < a.length || j < b.length) edits += 1;
    return edits <= 1;
  }

  function tokenMatches(queryToken, candidateToken) {
    if (!queryToken || !candidateToken) return false;
    if (queryToken === candidateToken) return true;
    if (singularToken(queryToken) === singularToken(candidateToken)) return true;
    if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) return true;
    if (
      candidateToken.length >= 3 &&
      queryToken.startsWith(candidateToken) &&
      candidateToken.length >= queryToken.length - 1
    ) return true;
    if (
      queryToken.length >= 5 &&
      candidateToken.length >= 5 &&
      editDistanceAtMostOne(queryToken, candidateToken)
    ) return true;
    return false;
  }

  function categoryFor(recipe = {}) {
    const current = String(recipe.category || '').trim();
    if (['Entrée', 'Plat', 'Accompagnement', 'Dessert', 'Apéritif'].includes(current)) return current;
    const text = searchableText(`${recipe.type || ''} ${recipe.title || ''}`);
    if (/dessert|gateau|tarte|clafoutis|crepe|cake sucre|mousse|flan|glace/.test(text)) return 'Dessert';
    if (/aperitif|apero|amuse bouche|tapas|toast|tartinade/.test(text)) return 'Apéritif';
    if (/accompagnement|garniture/.test(text)) return 'Accompagnement';
    if (/entree/.test(text)) return 'Entrée';
    return 'Plat';
  }

  function canonicalDevice(value = '') {
    const normalized = searchableText(value);
    if (/air fryer|airfryer/.test(normalized)) return 'Airfryer';
    if (/plancha/.test(normalized)) return 'Plancha';
    if (/barbecue|weber|grill/.test(normalized)) return 'Barbecue';
    if (/plaque|poele|casserole/.test(normalized)) return 'Plaque';
    if (/cocotte|mijot/.test(normalized)) return 'Cocotte';
    if (/micro ondes|microondes/.test(normalized)) return 'Micro-ondes';
    if (/sans cuisson|cru/.test(normalized)) return 'Sans cuisson';
    if (/four/.test(normalized)) return 'Four';
    return String(value || '');
  }

  function isDinnerRecipe(recipe = {}) {
    const text = searchableText(
      `${recipe.title || ''} ${recipe.type || ''} ${recipe.category || ''} ${recipe.device || ''}`
    );
    if (/repas du soir/.test(text)) return true;
    const light = /salade|soupe|veloute|potage|tartine|bruschetta|croque|omelette|oeuf|quiche|flan sale|galette|wrap|poisson|cabillaud|saumon|bar|thon|sardine|maquereau|moule|crevette|legume|vegetar|halloumi/.test(text);
    const heavy = /bourguignon|cassoulet|choucroute|jarret|epaule|souris d agneau|ragout|cote de boeuf/.test(text);
    return light && !heavy;
  }

  function formatDuration(minutes = 0) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (!total) return '';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (!hours) return `${mins} min`;
    return mins ? `${hours} h ${String(mins).padStart(2, '0')}` : `${hours} h`;
  }

  function recipeDuration(recipe = {}) {
    const prep = Math.max(0, Number(recipe.prepDuration) || 0);
    const marinade = Math.max(0, Number(recipe.marinadeDuration) || 0);
    const cook = Math.max(0, Number(recipe.cookDuration) || 0);
    if (prep || marinade || cook) return prep + cook + (marinade > 0 && marinade < 60 ? marinade : 0);
    return Math.max(0, Number(recipe.duration) || 0);
  }

  function iconFor(recipe = {}) {
    const text = searchableText(`${recipe.type || ''} ${recipe.device || ''}`);
    if (text.includes('poisson')) return '🐟';
    if (text.includes('dessert')) return '🍰';
    if (text.includes('salade') || text.includes('vegetarien')) return '🥗';
    if (text.includes('mijot')) return '🍲';
    if (text.includes('airfryer') || text.includes('air fryer')) return '♨';
    if (text.includes('plancha') || text.includes('barbecue')) return '🔥';
    return '🍽️';
  }

  function buildIndex(recipe = {}) {
    const category = categoryFor(recipe);
    const fields = [
      { name: 'title', text: searchableText(recipe.title), weight: 52 },
      { name: 'ingredients', text: searchableText(recipe.ingredients), weight: 26 },
      { name: 'device', text: searchableText(recipe.device), weight: 24 },
      { name: 'type', text: searchableText(recipe.type), weight: 22 },
      { name: 'category', text: searchableText(category), weight: 20 },
      { name: 'source', text: searchableText(recipe.source), weight: 12 },
      { name: 'season', text: searchableText(recipe.season), weight: 12 },
      { name: 'notes', text: searchableText(recipe.notes), weight: 8 },
      { name: 'steps', text: searchableText(recipe.steps), weight: 4 }
    ].map(field => ({
      ...field,
      words: field.text.split(' ').filter(Boolean),
      compact: field.text.replace(/\s+/g, '')
    }));

    return {
      id: recipe.id,
      title: String(recipe.title || ''),
      category,
      season: String(recipe.season || ''),
      device: String(recipe.device || ''),
      canonicalDevice: canonicalDevice(recipe.device),
      type: String(recipe.type || ''),
      persons: Math.max(1, Number(recipe.persons) || 1),
      favorite: !!recipe.favorite,
      duration: recipeDuration(recipe),
      updatedAt: String(recipe.updatedAt || ''),
      dinner: isDinnerRecipe(recipe),
      icon: iconFor(recipe),
      fields
    };
  }

  function readRecipeIndex() {
    if (recipeIndexPromise) return recipeIndexPromise;

    recipeIndexPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB indisponible'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error('Stockage indisponible'));
      request.onsuccess = () => {
        const database = request.result;
        try {
          const transaction = database.transaction('recipes', 'readonly');
          const all = transaction.objectStore('recipes').getAll();

          all.onsuccess = () => {
            const lightweightIndex = (all.result || []).map(buildIndex);
            resolve(lightweightIndex);
          };
          all.onerror = () => reject(all.error || new Error('Lecture impossible'));
          transaction.oncomplete = () => database.close();
          transaction.onabort = () => database.close();
        } catch (error) {
          database.close();
          reject(error);
        }
      };
    });

    return recipeIndexPromise;
  }

  function fieldMatches(token, field) {
    const compactToken = token.replace(/\s+/g, '');
    if (compactToken.length >= 3 && field.compact.includes(compactToken)) return true;
    return field.words.some(word => tokenMatches(token, word));
  }

  function recipeScore(entry, queryTokens, normalizedQuery) {
    let score = 0;

    for (const token of queryTokens) {
      let best = 0;
      for (const field of entry.fields) {
        if (!fieldMatches(token, field)) continue;
        let bonus = 0;
        if (field.text === token) bonus += 18;
        else if (field.text.startsWith(token)) bonus += 10;
        if (field.name === 'title' && field.text.includes(token)) bonus += 10;
        best = Math.max(best, field.weight + bonus);
      }
      if (!best) return { matched: false, score: 0 };
      score += best;
    }

    const title = entry.fields[0].text;
    const ingredients = entry.fields[1].text;
    if (title === normalizedQuery) score += 180;
    else if (title.startsWith(normalizedQuery)) score += 110;
    else if (title.includes(normalizedQuery)) score += 75;
    if (ingredients.includes(normalizedQuery)) score += 28;
    if (entry.favorite) score += 2;
    return { matched: true, score };
  }

  function currentFilters() {
    return {
      category: $('#categoryFilterRow .chip.active')?.dataset.categoryFilter || 'all',
      device: $('#deviceFilterRow .chip.active')?.dataset.deviceFilter || 'all',
      season: $('#seasonFilterRow .chip.active')?.dataset.seasonFilter || 'all',
      moment: $('#momentFilterRow .chip.active')?.dataset.momentFilter || 'all',
      favoriteOnly: $('#favoriteFilterBtn')?.classList.contains('active') || false
    };
  }

  function ensureStatusElement() {
    const toolbar = $('.toolbar');
    if (!toolbar) return null;
    let status = $('#enhancedSearchStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'enhancedSearchStatus';
      status.setAttribute('aria-live', 'polite');
      status.style.cssText =
        'grid-column:1/-1;margin:-2px 2px 0;color:var(--muted);font-size:12px;line-height:1.4;';
      toolbar.appendChild(status);
    }
    return status;
  }

  function cardHtml(entry) {
    const meta = entry.duration ? formatDuration(entry.duration) : escapeHtml(entry.type);
    return `<article class="recipe-card" data-recipe-id="${escapeHtml(entry.id)}">
      <div class="recipe-image">
        <div class="recipe-placeholder">${entry.icon}</div>
        ${entry.favorite ? '<div class="fav-badge">♥</div>' : ''}
      </div>
      <div class="recipe-body">
        <h4>${escapeHtml(entry.title)}</h4>
        <div class="tags">
          <span class="tag">${escapeHtml(entry.category)}</span>
          <span class="tag">${escapeHtml(entry.season)}</span>
          <span class="tag">${escapeHtml(entry.device)}</span>
        </div>
        <div class="recipe-meta"><span>${meta}</span><span>${entry.persons} pers.</span></div>
      </div>
    </article>`;
  }

  async function renderEnhancedSearch() {
    const grid = $('#recipeGrid');
    const search = $('#recipeSearch');
    if (!grid || !search) return;

    const rawQuery = search.value.trim();
    const status = ensureStatusElement();

    if (!rawQuery) {
      if (status) status.textContent = '';
      return;
    }

    const normalizedQuery = searchableText(rawQuery);
    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      if (status) status.textContent = 'Tapez au moins 2 lettres pour lancer la recherche.';
      return;
    }

    const ticket = ++renderTicket;
    if (status) status.textContent = 'Recherche en cours…';

    try {
      const index = await readRecipeIndex();
      if (ticket !== renderTicket) return;

      const queryTokens = tokenize(rawQuery);
      const filters = currentFilters();

      const ranked = index
        .map(entry => ({ entry, ...recipeScore(entry, queryTokens, normalizedQuery) }))
        .filter(item => item.matched)
        .filter(({ entry }) => filters.category === 'all' || entry.category === filters.category)
        .filter(({ entry }) => filters.device === 'all' || entry.canonicalDevice === filters.device)
        .filter(({ entry }) => filters.season === 'all' || entry.season === filters.season)
        .filter(({ entry }) => !filters.favoriteOnly || entry.favorite)
        .filter(({ entry }) => filters.moment === 'all' || entry.dinner)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
        });

      const shown = ranked.slice(0, MAX_RESULTS);
      if (status) {
        const total = ranked.length;
        status.textContent = total > MAX_RESULTS
          ? `${MAX_RESULTS} premiers résultats sur ${total} · affinez la recherche.`
          : `${total} recette${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}.`;
      }

      if (!shown.length) {
        grid.innerHTML =
          '<div class="empty-state" style="grid-column:1/-1"><strong>Aucune recette trouvée</strong>Essayez moins de mots ou vérifiez les filtres.</div>';
        return;
      }

      grid.innerHTML = shown.map(item => cardHtml(item.entry)).join('');
    } catch (error) {
      console.warn('Recherche allégée indisponible', error);
      if (status) status.textContent = 'La recherche est momentanément indisponible.';
    }
  }

  function scheduleSearch() {
    window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(renderEnhancedSearch, INPUT_DELAY_MS);
  }

  function captureSearchInput() {
    const search = $('#recipeSearch');
    if (!search) return;

    search.addEventListener('input', event => {
      const query = search.value.trim();

      if (!query) {
        window.clearTimeout(inputTimer);
        const status = ensureStatusElement();
        if (status) status.textContent = '';
        return;
      }

      event.stopImmediatePropagation();
      scheduleSearch();
    }, true);
  }

  function followOriginalFilters() {
    const selectors = [
      '#categoryFilterRow',
      '#deviceFilterRow',
      '#seasonFilterRow',
      '#momentFilterRow',
      '#favoriteFilterBtn',
      '#clearFiltersBtn'
    ];

    selectors.forEach(selector => {
      const element = $(selector);
      if (!element) return;
      element.addEventListener('click', () => {
        const query = $('#recipeSearch')?.value?.trim() || '';
        if (query) scheduleSearch();
      });
    });
  }

  function watchRecipeView() {
    const view = $('#view-recipes');
    if (!view) return;
    const observer = new MutationObserver(() => {
      const query = $('#recipeSearch')?.value?.trim() || '';
      if (view.classList.contains('active') && query) scheduleSearch();
    });
    observer.observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  function start() {
    const versionLabel = document.querySelector('.brand small');
    if (versionLabel) versionLabel.textContent = 'VERSION · TEST IPHONE 2';
    document.title = 'Mon carnet de cuisine — Test recherche iPhone 2';

    const search = $('#recipeSearch');
    const grid = $('#recipeGrid');
    if (!search || !grid) {
      window.setTimeout(start, 100);
      return;
    }

    search.placeholder = 'Ex. poulet moutarde, air fryer, citron…';
    captureSearchInput();
    followOriginalFilters();
    watchRecipeView();

    window.__monCarnetEnhancedSearch = {
      render: renderEnhancedSearch,
      resetIndex: () => { recipeIndexPromise = null; },
      version: '1.0.2-iphone'
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
