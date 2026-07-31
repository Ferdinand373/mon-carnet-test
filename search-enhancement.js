(() => {
  'use strict';

  const DB_NAME = 'mon-carnet-cuisine-v1';
  const DB_VERSION = 1;
  const MAX_RESULTS = 50;
  const PHOTO_RESULT_LIMIT = 20;
  const PHOTO_CONCURRENCY = 2;
  const MIN_QUERY_LENGTH = 2;
  const INPUT_DELAY_MS = 120;

  let recipeIndexPromise = null;
  let renderTicket = 0;
  let inputTimer = 0;
  let searchSessionActive = false;
  let gridWriteInProgress = false;
  let photoDbPromise = null;
  let photoObserver = null;
  let photoQueue = [];
  let activePhotoLoads = 0;
  let photoGeneration = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value = '') => String(value).replace(/[&<>\'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
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
    if (['Entrée', 'Plat', 'Accompagnement', 'Dessert', 'Apéritif'].includes(current)) {
      return current;
    }

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

    if (prep || marinade || cook) {
      return prep + cook + (marinade > 0 && marinade < 60 ? marinade : 0);
    }

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

  function buildIndexEntry(recipe = {}) {
    const category = categoryFor(recipe);

    const fields = [
      { name: 'title', text: searchableText(recipe.title), weight: 52 },
      { name: 'ingredients', text: searchableText(recipe.ingredients), weight: 26 },
      { name: 'device', text: searchableText(recipe.device), weight: 24 },
      { name: 'type', text: searchableText(recipe.type), weight: 22 },
      { name: 'category', text: searchableText(category), weight: 20 },
      { name: 'source', text: searchableText(recipe.source), weight: 12 },
      { name: 'season', text: searchableText(recipe.season), weight: 12 },
      { name: 'notes', text: searchableText(recipe.notes), weight: 8 }
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
      hasPhoto: !!recipe.photo,
      fields
    };
  }

  function scheduleIdle(callback) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout: 120 });
      return;
    }

    window.setTimeout(() => callback({
      didTimeout: true,
      timeRemaining: () => 0
    }), 0);
  }

  function buildIndexInSmallBatches(recipes) {
    return new Promise(resolve => {
      const result = [];
      let position = 0;

      const work = deadline => {
        let processed = 0;

        while (
          position < recipes.length &&
          (processed < 10 || deadline.timeRemaining() > 4)
        ) {
          result.push(buildIndexEntry(recipes[position]));
          position += 1;
          processed += 1;
        }

        if (position < recipes.length) {
          scheduleIdle(work);
        } else {
          resolve(result);
        }
      };

      scheduleIdle(work);
    });
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
            const recipes = all.result || [];
            buildIndexInSmallBatches(recipes)
              .then(resolve)
              .catch(reject);
          };

          all.onerror = () => reject(all.error || new Error('Lecture impossible'));
          transaction.oncomplete = () => database.close();
          transaction.onabort = () => database.close();
        } catch (error) {
          database.close();
          reject(error);
        }
      };
    }).catch(error => {
      recipeIndexPromise = null;
      throw error;
    });

    return recipeIndexPromise;
  }

  function fieldMatches(token, field) {
    const compactToken = token.replace(/\s+/g, '');

    if (compactToken.length >= 3 && field.compact.includes(compactToken)) {
      return true;
    }

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

  function cancelPhotoLoading() {
    photoGeneration += 1;
    photoQueue = [];

    if (photoObserver) {
      photoObserver.disconnect();
      photoObserver = null;
    }
  }

  function openPhotoDb() {
    if (photoDbPromise) return photoDbPromise;

    photoDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error || new Error('Photos indisponibles'));
      request.onsuccess = () => {
        const database = request.result;

        database.onversionchange = () => {
          database.close();
          photoDbPromise = null;
        };

        resolve(database);
      };
    }).catch(error => {
      photoDbPromise = null;
      throw error;
    });

    return photoDbPromise;
  }

  async function readRecipePhoto(recipeId) {
    const database = await openPhotoDb();

    return new Promise((resolve, reject) => {
      try {
        const transaction = database.transaction('recipes', 'readonly');
        const request = transaction.objectStore('recipes').get(recipeId);

        request.onsuccess = () => resolve(request.result?.photo || '');
        request.onerror = () => reject(request.error || new Error('Photo illisible'));
      } catch (error) {
        reject(error);
      }
    });
  }

  function finishPhotoLoad(task, photo) {
    const { image, generation } = task;

    if (
      !photo ||
      generation !== photoGeneration ||
      !image.isConnected
    ) return;

    const placeholder = image.parentElement?.querySelector('[data-photo-placeholder]');

    image.onload = () => {
      if (
        generation !== photoGeneration ||
        !image.isConnected
      ) return;

      image.hidden = false;
      if (placeholder) placeholder.hidden = true;
    };

    image.onerror = () => {
      image.removeAttribute('src');
      image.hidden = true;
      if (placeholder) placeholder.hidden = false;
    };

    image.src = photo;
  }

  function pumpPhotoQueue() {
    while (activePhotoLoads < PHOTO_CONCURRENCY && photoQueue.length) {
      const task = photoQueue.shift();

      if (
        !task ||
        task.generation !== photoGeneration ||
        !task.image.isConnected
      ) continue;

      activePhotoLoads += 1;

      readRecipePhoto(task.recipeId)
        .then(photo => finishPhotoLoad(task, photo))
        .catch(error => console.warn('Photo de recherche non chargée', error))
        .finally(() => {
          activePhotoLoads -= 1;
          pumpPhotoQueue();
        });
    }
  }

  function enqueuePhoto(image, generation) {
    if (
      !image ||
      image.dataset.photoQueued === '1' ||
      generation !== photoGeneration
    ) return;

    image.dataset.photoQueued = '1';

    photoQueue.push({
      image,
      recipeId: image.dataset.photoId,
      generation
    });

    pumpPhotoQueue();
  }

  function hydrateVisiblePhotos() {
    const images = $$('#recipeGrid img[data-photo-id]');
    if (!images.length) return;

    const generation = photoGeneration;

    if (!('IntersectionObserver' in window)) {
      images.slice(0, 6).forEach(image => enqueuePhoto(image, generation));
      return;
    }

    photoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        photoObserver?.unobserve(entry.target);
        enqueuePhoto(entry.target, generation);
      });
    }, {
      rootMargin: '260px 0px',
      threshold: 0.01
    });

    images.forEach(image => photoObserver.observe(image));
  }

  function writeGrid(html) {
    const grid = $('#recipeGrid');
    if (!grid) return;

    cancelPhotoLoading();
    gridWriteInProgress = true;
    grid.innerHTML = html;

    window.queueMicrotask(() => {
      gridWriteInProgress = false;
    });
  }

  function showSearchPrompt(message = 'Tapez au moins 2 lettres pour rechercher dans les 270 recettes.') {
    const status = ensureStatusElement();
    if (status) status.textContent = message;

    writeGrid(
      '<div class="empty-state" style="grid-column:1/-1">' +
      '<strong>Recherche prête</strong>' +
      'Écrivez un plat, un ingrédient ou un appareil.' +
      '</div>'
    );
  }

  function cardHtml(entry, resultIndex) {
    const meta = entry.duration ? formatDuration(entry.duration) : escapeHtml(entry.type);
    const mayLoadPhoto = entry.hasPhoto && resultIndex < PHOTO_RESULT_LIMIT;
    const visual = mayLoadPhoto
      ? `<img data-photo-id="${escapeHtml(entry.id)}" alt="${escapeHtml(entry.title)}" loading="lazy" decoding="async" hidden>
         <div class="recipe-placeholder" data-photo-placeholder>${entry.icon}</div>`
      : `<div class="recipe-placeholder">${entry.icon}</div>`;

    return `<article class="recipe-card" data-recipe-id="${escapeHtml(entry.id)}">
      <div class="recipe-image">
        ${visual}
        ${entry.favorite ? '<div class="fav-badge">♥</div>' : ''}
      </div>
      <div class="recipe-body">
        <h4>${escapeHtml(entry.title)}</h4>
        <div class="tags">
          <span class="tag">${escapeHtml(entry.category)}</span>
          <span class="tag">${escapeHtml(entry.season)}</span>
          <span class="tag">${escapeHtml(entry.device)}</span>
        </div>
        <div class="recipe-meta">
          <span>${meta}</span>
          <span>${entry.persons} pers.</span>
        </div>
      </div>
    </article>`;
  }

  async function renderEnhancedSearch() {
    const search = $('#recipeSearch');
    if (!search) return;

    const rawQuery = search.value.trim();
    const status = ensureStatusElement();

    if (!rawQuery) {
      showSearchPrompt();
      return;
    }

    const normalizedQuery = searchableText(rawQuery);

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      showSearchPrompt('Tapez encore une lettre pour lancer la recherche.');
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
        .map(entry => ({
          entry,
          ...recipeScore(entry, queryTokens, normalizedQuery)
        }))
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
        writeGrid(
          '<div class="empty-state" style="grid-column:1/-1">' +
          '<strong>Aucune recette trouvée</strong>' +
          'Essayez moins de mots ou vérifiez les filtres.' +
          '</div>'
        );
        return;
      }

      writeGrid(shown.map((item, index) => cardHtml(item.entry, index)).join(''));
      hydrateVisiblePhotos();
    } catch (error) {
      console.warn('Recherche rapide indisponible', error);
      if (status) status.textContent = 'La recherche est momentanément indisponible.';
    }
  }

  function scheduleSearch() {
    window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(renderEnhancedSearch, INPUT_DELAY_MS);
  }

  function activateChip(rowSelector, chip) {
    $$('.chip', $(rowSelector)).forEach(item => {
      item.classList.toggle('active', item === chip);
    });
  }

  function resetFiltersUi() {
    $$('[data-category-filter]').forEach(item => {
      item.classList.toggle('active', item.dataset.categoryFilter === 'all');
    });

    $$('[data-device-filter]').forEach(item => {
      item.classList.toggle('active', item.dataset.deviceFilter === 'all');
    });

    $$('[data-season-filter]').forEach(item => {
      item.classList.toggle('active', item.dataset.seasonFilter === 'all');
    });

    $$('[data-moment-filter]').forEach(item => {
      item.classList.toggle('active', item.dataset.momentFilter === 'all');
    });

    const favorite = $('#favoriteFilterBtn');
    if (favorite) {
      favorite.classList.remove('active');
      favorite.setAttribute('aria-pressed', 'false');
      favorite.textContent = '♡ Favorites seulement';
    }
  }

  function showRecipesViewFast() {
    document.body.classList.remove('recipe-open');

    $$('.view').forEach(view => {
      view.classList.toggle('active', view.dataset.view === 'recipes');
    });

    $$('.nav-btn').forEach(button => {
      button.classList.toggle('active', button.hasAttribute('data-open-search'));
    });

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openSearchFast(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    searchSessionActive = true;
    showRecipesViewFast();

    const search = $('#recipeSearch');

    if (!search?.value.trim()) {
      showSearchPrompt();
    } else {
      scheduleSearch();
    }

    window.setTimeout(() => {
      if (!search) return;
      search.focus({ preventScroll: true });
      search.scrollIntoView({ behavior: 'auto', block: 'center' });
    }, 25);
  }

  function returnToSearchFast(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    showRecipesViewFast();

    const query = $('#recipeSearch')?.value?.trim() || '';
    if (query) scheduleSearch();
    else showSearchPrompt();
  }

  function captureNavigation() {
    document.addEventListener('click', event => {
      const searchTrigger = event.target.closest('[data-open-search]');

      if (searchTrigger) {
        openSearchFast(event);
        return;
      }

      const detailBack = event.target.closest('#detailBackBtn');

      if (detailBack && searchSessionActive) {
        returnToSearchFast(event);
        return;
      }

      const otherNavigation = event.target.closest('[data-go]');

      if (otherNavigation && otherNavigation.dataset.go !== 'recipes') {
        searchSessionActive = false;
      }
    }, true);
  }

  function captureSearchInput() {
    const search = $('#recipeSearch');
    if (!search) return;

    search.addEventListener('input', event => {
      event.stopImmediatePropagation();
      window.clearTimeout(inputTimer);

      const query = search.value.trim();

      if (!query) {
        showSearchPrompt();
        return;
      }

      scheduleSearch();
    }, true);
  }

  function captureFilters() {
    const definitions = [
      ['#categoryFilterRow', 'categoryFilter'],
      ['#deviceFilterRow', 'deviceFilter'],
      ['#seasonFilterRow', 'seasonFilter'],
      ['#momentFilterRow', 'momentFilter']
    ];

    definitions.forEach(([rowSelector, dataKey]) => {
      const row = $(rowSelector);
      if (!row) return;

      row.addEventListener('click', event => {
        const attribute = dataKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        const chip = event.target.closest(`[data-${attribute}]`);
        if (!chip) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        activateChip(rowSelector, chip);

        const query = $('#recipeSearch')?.value?.trim() || '';
        if (query) scheduleSearch();
        else showSearchPrompt();
      }, true);
    });

    const favorite = $('#favoriteFilterBtn');

    if (favorite) {
      favorite.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const active = !favorite.classList.contains('active');
        favorite.classList.toggle('active', active);
        favorite.setAttribute('aria-pressed', String(active));
        favorite.textContent = active ? '♥ Favorites seulement' : '♡ Favorites seulement';

        const query = $('#recipeSearch')?.value?.trim() || '';
        if (query) scheduleSearch();
        else showSearchPrompt();
      }, true);
    }

    const clear = $('#clearFiltersBtn');

    if (clear) {
      clear.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const search = $('#recipeSearch');
        if (search) search.value = '';

        resetFiltersUi();
        showSearchPrompt();

        $('#categoryFilterRow')?.scrollTo({ left: 0, behavior: 'auto' });
        $('#deviceFilterRow')?.scrollTo({ left: 0, behavior: 'auto' });
        $('#seasonFilterRow')?.scrollTo({ left: 0, behavior: 'auto' });
        $('#momentFilterRow')?.scrollTo({ left: 0, behavior: 'auto' });
      }, true);
    }
  }

  function keepHiddenGridLight() {
    const grid = $('#recipeGrid');
    const view = $('#view-recipes');
    if (!grid || !view) return;

    const observer = new MutationObserver(() => {
      if (gridWriteInProgress) return;

      const query = $('#recipeSearch')?.value?.trim() || '';

      if (!view.classList.contains('active') && !query && grid.children.length > 12) {
        window.requestAnimationFrame(() => {
          if (!gridWriteInProgress) showSearchPrompt();
        });
      }
    });

    observer.observe(grid, { childList: true });
  }

  function prewarmSearchIndex() {
    window.setTimeout(() => {
      scheduleIdle(() => {
        readRecipeIndex().catch(error => {
          console.warn('Préparation de la recherche différée', error);
        });
      });
    }, 250);
  }

  function start() {
    const versionLabel = document.querySelector('.brand small');
    if (versionLabel) versionLabel.textContent = 'VERSION · TEST IPHONE 4 PHOTOS';
    document.title = 'Mon carnet de cuisine — Test iPhone avec photos';

    const search = $('#recipeSearch');
    const grid = $('#recipeGrid');

    if (!search || !grid) {
      window.setTimeout(start, 100);
      return;
    }

    search.placeholder = 'Ex. poulet moutarde, air fryer, citron…';

    captureNavigation();
    captureSearchInput();
    captureFilters();
    keepHiddenGridLight();
    showSearchPrompt();
    prewarmSearchIndex();

    window.__monCarnetEnhancedSearch = {
      render: renderEnhancedSearch,
      resetIndex: () => {
        recipeIndexPromise = null;
        prewarmSearchIndex();
      },
      version: '1.0.4-iphone-photos'
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
