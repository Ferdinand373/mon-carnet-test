(() => {
  'use strict';

  const DB_NAME = 'mon-carnet-cuisine-v1';
  const DB_VERSION = 1;
  const state = {
    category: 'all',
    device: 'all',
    season: 'all',
    moment: 'all',
    favoriteOnly: false,
    query: ''
  };
  let renderTicket = 0;

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
    if (candidateToken.length >= 3 && queryToken.startsWith(candidateToken) && candidateToken.length >= queryToken.length - 1) return true;
    if (queryToken.length >= 5 && candidateToken.length >= 5 && editDistanceAtMostOne(queryToken, candidateToken)) return true;
    return false;
  }

  function fieldMatch(queryToken, text) {
    const normalized = searchableText(text);
    const words = normalized.split(' ').filter(Boolean);
    const compact = normalized.replace(/\s+/g, '');
    const queryCompact = queryToken.replace(/\s+/g, '');
    if (queryCompact.length >= 3 && compact.includes(queryCompact)) return true;
    return words.some(word => tokenMatches(queryToken, word));
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
    const text = searchableText(`${recipe.title || ''} ${recipe.type || ''} ${recipe.category || ''} ${recipe.device || ''}`);
    if (/repas du soir/.test(text)) return true;
    const light = /salade|soupe|veloute|potage|tartine|bruschetta|croque|omelette|oeuf|quiche|flan sale|galette|wrap|poisson|cabillaud|saumon|bar|thon|sardine|maquereau|moule|crevette|legume|vegetar|halloumi/.test(text);
    const heavy = /bourguignon|cassoulet|choucroute|jarret|epaule|souris d agneau|ragout|cote de boeuf/.test(text);
    return light && !heavy;
  }

  function recipeScore(recipe, query) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return { matched: true, score: 0 };

    const fields = [
      { name: 'title', value: recipe.title, weight: 52 },
      { name: 'ingredients', value: recipe.ingredients, weight: 26 },
      { name: 'device', value: recipe.device, weight: 24 },
      { name: 'type', value: recipe.type, weight: 22 },
      { name: 'category', value: categoryFor(recipe), weight: 20 },
      { name: 'source', value: recipe.source, weight: 12 },
      { name: 'season', value: recipe.season, weight: 12 },
      { name: 'notes', value: recipe.notes, weight: 8 },
      { name: 'steps', value: recipe.steps, weight: 4 }
    ];

    let score = 0;
    for (const token of queryTokens) {
      let best = 0;
      for (const field of fields) {
        if (!fieldMatch(token, field.value || '')) continue;
        const normalized = searchableText(field.value || '');
        let bonus = 0;
        if (normalized === token) bonus += 18;
        else if (normalized.startsWith(`${token} `) || normalized.startsWith(token)) bonus += 10;
        if (field.name === 'title' && normalized.includes(token)) bonus += 10;
        best = Math.max(best, field.weight + bonus);
      }
      if (!best) return { matched: false, score: 0 };
      score += best;
    }

    const normalizedQuery = searchableText(query);
    const title = searchableText(recipe.title || '');
    const ingredients = searchableText(recipe.ingredients || '');
    if (title === normalizedQuery) score += 180;
    else if (title.startsWith(normalizedQuery)) score += 110;
    else if (title.includes(normalizedQuery)) score += 75;
    if (ingredients.includes(normalizedQuery)) score += 28;
    if (recipe.favorite) score += 2;
    return { matched: true, score };
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

  function readRecipes() {
    return new Promise((resolve, reject) => {
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
          all.onsuccess = () => resolve(all.result || []);
          all.onerror = () => reject(all.error || new Error('Lecture impossible'));
          transaction.oncomplete = () => database.close();
          transaction.onabort = () => database.close();
        } catch (error) {
          database.close();
          reject(error);
        }
      };
    });
  }

  function syncStateFromUi() {
    state.query = $('#recipeSearch')?.value?.trim() || '';
    state.category = $('#categoryFilterRow .chip.active')?.dataset.categoryFilter || state.category;
    state.device = $('#deviceFilterRow .chip.active')?.dataset.deviceFilter || state.device;
    state.season = $('#seasonFilterRow .chip.active')?.dataset.seasonFilter || state.season;
    state.moment = $('#momentFilterRow .chip.active')?.dataset.momentFilter || state.moment;
    state.favoriteOnly = $('#favoriteFilterBtn')?.classList.contains('active') || false;
  }

  function ensureStatusElement() {
    const toolbar = $('.toolbar');
    if (!toolbar) return null;
    let status = $('#enhancedSearchStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'enhancedSearchStatus';
      status.setAttribute('aria-live', 'polite');
      status.style.cssText = 'grid-column:1/-1;margin:-2px 2px 0;color:var(--muted);font-size:12px;line-height:1.4;';
      toolbar.appendChild(status);
    }
    return status;
  }

  function cardHtml(recipe) {
    const category = categoryFor(recipe);
    const total = recipeDuration(recipe);
    const meta = total ? formatDuration(total) : escapeHtml(recipe.type || '');
    return `<article class="recipe-card" data-recipe-id="${escapeHtml(recipe.id)}">
      <div class="recipe-image">${recipe.photo ? `<img src="${escapeHtml(recipe.photo)}" alt="${escapeHtml(recipe.title)}">` : `<div class="recipe-placeholder">${iconFor(recipe)}</div>`}${recipe.favorite ? '<div class="fav-badge">♥</div>' : ''}</div>
      <div class="recipe-body"><h4>${escapeHtml(recipe.title)}</h4><div class="tags"><span class="tag">${escapeHtml(category)}</span><span class="tag">${escapeHtml(recipe.season || '')}</span><span class="tag">${escapeHtml(recipe.device || '')}</span></div><div class="recipe-meta"><span>${meta}</span><span>${Math.max(1, Number(recipe.persons) || 1)} pers.</span></div></div>
    </article>`;
  }

  async function renderEnhancedSearch() {
    const grid = $('#recipeGrid');
    const search = $('#recipeSearch');
    if (!grid || !search) return;
    const ticket = ++renderTicket;
    syncStateFromUi();
    try {
      const recipes = await readRecipes();
      if (ticket !== renderTicket) return;
      const ranked = recipes
        .map(recipe => ({ recipe, ...recipeScore(recipe, state.query) }))
        .filter(item => item.matched)
        .filter(({ recipe }) => state.category === 'all' || categoryFor(recipe) === state.category)
        .filter(({ recipe }) => state.device === 'all' || canonicalDevice(recipe.device) === state.device)
        .filter(({ recipe }) => state.season === 'all' || recipe.season === state.season)
        .filter(({ recipe }) => !state.favoriteOnly || !!recipe.favorite)
        .filter(({ recipe }) => state.moment === 'all' || isDinnerRecipe(recipe))
        .sort((a, b) => {
          if (state.query && b.score !== a.score) return b.score - a.score;
          return String(b.recipe.updatedAt || '').localeCompare(String(a.recipe.updatedAt || ''));
        });

      const status = ensureStatusElement();
      if (status) {
        const count = ranked.length;
        status.textContent = state.query
          ? `${count} recette${count > 1 ? 's' : ''} trouvée${count > 1 ? 's' : ''} · tous les mots sont recherchés dans le titre, les ingrédients et les informations de la recette.`
          : `${count} recette${count > 1 ? 's' : ''} · recherche par titre, ingrédient, appareil, saison ou origine.`;
      }

      if (!ranked.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><strong>Aucune recette trouvée</strong>Essayez moins de mots ou vérifiez les filtres sélectionnés.</div>`;
        return;
      }
      grid.innerHTML = ranked.map(item => cardHtml(item.recipe)).join('');
    } catch (error) {
      console.warn('Recherche améliorée indisponible', error);
    }
  }

  function activateChip(rowSelector, chip) {
    $$(".chip", $(rowSelector)).forEach(item => item.classList.toggle('active', item === chip));
  }

  function captureEvents() {
    const search = $('#recipeSearch');
    if (search) {
      search.addEventListener('input', event => {
        event.stopImmediatePropagation();
        state.query = search.value.trim();
        renderEnhancedSearch();
      }, true);
    }

    const filters = [
      ['#categoryFilterRow', 'categoryFilter', 'category'],
      ['#deviceFilterRow', 'deviceFilter', 'device'],
      ['#seasonFilterRow', 'seasonFilter', 'season'],
      ['#momentFilterRow', 'momentFilter', 'moment']
    ];
    for (const [rowSelector, dataKey, stateKey] of filters) {
      const row = $(rowSelector);
      if (!row) continue;
      row.addEventListener('click', event => {
        const chip = event.target.closest(`[data-${dataKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`);
        if (!chip) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        state[stateKey] = chip.dataset[dataKey];
        activateChip(rowSelector, chip);
        renderEnhancedSearch();
      }, true);
    }

    const favorite = $('#favoriteFilterBtn');
    if (favorite) {
      favorite.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.favoriteOnly = !state.favoriteOnly;
        favorite.classList.toggle('active', state.favoriteOnly);
        favorite.setAttribute('aria-pressed', String(state.favoriteOnly));
        favorite.textContent = state.favoriteOnly ? '♥ Favorites seulement' : '♡ Favorites seulement';
        renderEnhancedSearch();
      }, true);
    }

    const clear = $('#clearFiltersBtn');
    if (clear) {
      clear.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.category = 'all';
        state.device = 'all';
        state.season = 'all';
        state.moment = 'all';
        state.favoriteOnly = false;
        state.query = '';
        if (search) search.value = '';
        $$('[data-category-filter]').forEach(item => item.classList.toggle('active', item.dataset.categoryFilter === 'all'));
        $$('[data-device-filter]').forEach(item => item.classList.toggle('active', item.dataset.deviceFilter === 'all'));
        $$('[data-season-filter]').forEach(item => item.classList.toggle('active', item.dataset.seasonFilter === 'all'));
        $$('[data-moment-filter]').forEach(item => item.classList.toggle('active', item.dataset.momentFilter === 'all'));
        if (favorite) {
          favorite.classList.remove('active');
          favorite.setAttribute('aria-pressed', 'false');
          favorite.textContent = '♡ Favorites seulement';
        }
        renderEnhancedSearch();
      }, true);
    }
  }

  function watchRecipeView() {
    const view = $('#view-recipes');
    if (!view) return;
    const observer = new MutationObserver(() => {
      if (view.classList.contains('active')) window.setTimeout(renderEnhancedSearch, 0);
    });
    observer.observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  function start() {
    const search = $('#recipeSearch');
    const grid = $('#recipeGrid');
    if (!search || !grid) {
      window.setTimeout(start, 100);
      return;
    }
    search.placeholder = 'Ex. poulet air fryer, saumon citron, crème…';
    captureEvents();
    watchRecipeView();
    if ($('#view-recipes')?.classList.contains('active')) renderEnhancedSearch();
    window.__monCarnetEnhancedSearch = { render: renderEnhancedSearch, version: '1.0.0' };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
