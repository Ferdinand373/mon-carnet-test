(() => {
  'use strict';

  if (window.__monCarnetProductsV255) return;
  window.__monCarnetProductsV255 = true;

  const COURSES_KEY = 'mon-carnet-integration-v1-courses';
  const CUSTOM_PRODUCTS_KEY = 'mon-carnet-integration-v1-products';
  const HIDDEN_PRODUCTS_KEY = 'clairCourses.mcHiddenItems';
  const STATE_VERSION = 104;

  const fold = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function loadHiddenProducts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HIDDEN_PRODUCTS_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch (_) {
      return new Set();
    }
  }

  const hiddenProducts = loadHiddenProducts();

  function saveHiddenProducts() {
    localStorage.setItem(HIDDEN_PRODUCTS_KEY, JSON.stringify([...hiddenProducts]));
  }

  function productInfo(row) {
    if (!row) return null;
    const name = row.querySelector('strong')?.textContent?.trim() || '';
    if (!name) return null;
    const smalls = [...row.querySelectorAll('small')]
      .map(node => node.textContent.trim())
      .filter(text => text && !/^déjà dans/i.test(text));
    const quantity = smalls[0] || '';
    const aisle = row.closest('.mc-product-rayon')?.querySelector('h3')?.textContent?.trim() || classifyName(name);
    return {
      id: row.querySelector('[data-product-select]')?.dataset.productSelect || '',
      name,
      quantity,
      aisle,
      signature: `${fold(name)}|${fold(quantity)}`
    };
  }

  function classifyName(value) {
    const text = fold(value);
    if (/pain|baguette|brioche|viennoiser/.test(text)) return 'Boulangerie';
    if (/chorizo|jambon|lardon|saucisse|bacon|charcuterie|poulet|boeuf|porc|veau|agneau|dinde|canard|steak|escalope|viande/.test(text)) return 'Boucherie et charcuterie';
    if (/saumon|cabillaud|thon frais|poisson|crevette|moule|huitre|coquille saint jacques|crabe|homard/.test(text)) return 'Poissonnerie et fruits de mer';
    if (/lait|beurre|creme|oeuf|fromage|yaourt|mascarpone|mozzarella|parmesan/.test(text)) return 'Crémerie';
    if (/citron|pomme|poire|orange|carotte|oignon|ail|salade|pomme de terre|champignon|tomate|courgette|aubergine|poireau|celeri|persil|basilic|ciboulette|echalote|legume|fruit/.test(text)) return 'Fruits et légumes';
    if (/surgel|glace|frites/.test(text)) return 'Surgelés';
    if (/conserve|en boite|tomates pelees|mais|petits pois|haricots|pois chiches|macedoine|sardines|maquereaux|thon au naturel/.test(text)) return 'Conserves';
    if (/sucre|chocolat|confiture|miel|cafe|the|cereale|biscuit|vanille|cacao/.test(text)) return 'Épicerie sucrée et petit-déjeuner';
    if (/eau/.test(text)) return 'Eau';
    if (/jus|soda|sirop|limonade|cola|tonic/.test(text)) return 'Boissons sans alcool';
    if (/vin|biere|cidre|rhum|cognac|calvados|whisky|vodka|porto|aperitif|alcool/.test(text)) return 'Alcool';
    if (/shampoing|savon|dentifrice|deodorant|papier toilette|gel douche|mouchoir/.test(text)) return 'Hygiène';
    if (/lessive|liquide vaisselle|essuie tout|sac poubelle|nettoyant|javel|eponge/.test(text)) return 'Produits ménagers';
    return 'Épicerie salée';
  }

  function showToast(message) {
    let node = document.getElementById('mcCoursesToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'mcCoursesToast';
      node.className = 'mc-courses-toast';
      node.setAttribute('role', 'status');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._v255Timer);
    node._v255Timer = window.setTimeout(() => node.classList.remove('show'), 2200);
  }

  function hideSectionWhenEmpty(row) {
    const section = row?.closest('.mc-product-rayon');
    if (!section) return;
    const visibleRows = [...section.querySelectorAll('.mc-product-row')]
      .some(candidate => candidate.style.display !== 'none');
    section.style.display = visibleRows ? '' : 'none';
  }

  function hideImportedProduct(row) {
    const info = productInfo(row);
    if (!info) return;
    const checkbox = row.querySelector('[data-product-select]');
    if (checkbox?.checked) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    hiddenProducts.add(info.signature);
    saveHiddenProducts();
    row.style.display = 'none';
    hideSectionWhenEmpty(row);
    showToast(`${info.name} supprimé de Mes produits`);
  }

  function enhanceProductRows() {
    const panel = document.getElementById('mc-products-panel');
    if (!panel) return;

    panel.querySelectorAll('.mc-product-row').forEach(row => {
      const info = productInfo(row);
      if (!info) return;
      if (hiddenProducts.has(info.signature)) {
        row.style.display = 'none';
        hideSectionWhenEmpty(row);
        return;
      }
      row.style.display = '';
      const existingRemove = row.querySelector('.mc-product-remove');
      if (existingRemove || row.dataset.v255DeleteReady === '1') return;
      row.dataset.v255DeleteReady = '1';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mc-product-remove mc-product-remove-v255';
      button.setAttribute('aria-label', `Supprimer ${info.name}`);
      button.textContent = '×';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        hideImportedProduct(row);
      });
      row.appendChild(button);
    });
  }

  function updateAutomaticAisle() {
    const nameInput = document.getElementById('mcProductName');
    const aisleSelect = document.getElementById('mcProductAisle');
    if (!nameInput || !aisleSelect) return;
    if (aisleSelect.dataset.v255Manual === '1') return;
    const name = nameInput.value.trim();
    if (name) aisleSelect.value = classifyName(name);
  }

  function prepareCreateCard() {
    const nameInput = document.getElementById('mcProductName');
    const quantityInput = document.getElementById('mcProductQuantity');
    const aisleSelect = document.getElementById('mcProductAisle');
    const createButton = document.getElementById('mcProductCreate');
    if (!nameInput || !quantityInput || !aisleSelect || !createButton) return;

    const card = nameInput.closest('.mc-product-create');
    const title = card?.querySelector('h3');
    if (title && title.textContent.trim() !== 'Ajouter un produit') title.textContent = 'Ajouter un produit';
    if (nameInput.placeholder !== 'Exemple : pain grillé') nameInput.placeholder = 'Exemple : pain grillé';
    if (quantityInput.placeholder !== 'Quantité (facultatif)') quantityInput.placeholder = 'Quantité (facultatif)';
    if (createButton.textContent.trim() !== 'Ajouter') createButton.textContent = 'Ajouter';

    if (nameInput.dataset.v255Ready !== '1') {
      nameInput.dataset.v255Ready = '1';
      aisleSelect.dataset.v255Manual = '0';
      nameInput.addEventListener('input', updateAutomaticAisle);
      aisleSelect.addEventListener('change', () => {
        aisleSelect.dataset.v255Manual = '1';
      });
      createButton.addEventListener('click', () => {
        window.setTimeout(() => {
          aisleSelect.dataset.v255Manual = '0';
          enhanceProductRows();
        }, 0);
      }, true);
    }
  }

  function exactNameRequired(name) {
    const value = fold(name);
    return /\bpain\b/.test(value) && value !== 'pain';
  }

  function parseBuying(quantityText) {
    const text = fold(quantityText);
    const number = text.match(/\d+(?:[.,]\d+)?/);
    const quantity = number ? Number(number[0].replace(',', '.')) : 1;
    const unitRules = [
      [/\bkg\b/, 'kg'], [/\bmg\b/, 'mg'], [/\bg\b/, 'g'], [/\bcl\b/, 'cl'], [/\bml\b/, 'ml'], [/\bl\b/, 'l'],
      [/bouteille/, 'bouteille(s)'], [/paquet/, 'paquet(s)'], [/sachet/, 'sachet(s)'], [/tranche/, 'tranche(s)'],
      [/boite/, 'boîte(s)'], [/pot/, 'pot(s)'], [/rouleau/, 'rouleau(x)'], [/flacon/, 'flacon(s)'],
      [/barquette/, 'barquette(s)'], [/piece/, 'pièce(s)']
    ];
    const unit = unitRules.find(([pattern]) => pattern.test(text))?.[1] || 'article';
    return { quantity: Math.max(quantity || 1, 0.01), unit };
  }

  function addExactProducts(rows) {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(COURSES_KEY) || '{}');
    } catch (_) {
      parsed = {};
    }
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    let added = 0;

    rows.forEach(row => {
      const info = productInfo(row);
      if (!info) return;
      const key = fold(info.name).replace(/\s+/g, '-');
      const raw = info.quantity ? `${info.quantity} ${info.name}` : `1 ${info.name}`;
      const buying = parseBuying(info.quantity);
      const signature = `mes produits|${key}|${fold(raw)}`;
      if (items.some(item => item.contributions?.some(contribution => contribution.signature === signature))) return;

      let item = items.find(candidate => candidate.key === key && candidate.unit === buying.unit);
      if (!item) {
        item = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          key,
          name: info.name,
          quantity: 0,
          unit: buying.unit,
          aisle: info.aisle || classifyName(info.name),
          checked: false,
          contributions: []
        };
        items.push(item);
      }
      item.quantity = Number(((Number(item.quantity) || 0) + buying.quantity).toFixed(2));
      item.aisle = info.aisle || item.aisle;
      item.checked = false;
      item.contributions.push({
        source: 'Mes produits',
        raw,
        quantity: buying.quantity,
        unit: buying.unit,
        signature
      });
      added += 1;
    });

    localStorage.setItem(COURSES_KEY, JSON.stringify({
      items,
      version: Math.max(Number(parsed.version) || 0, STATE_VERSION)
    }));
    return added;
  }

  function selectedVisibleRows() {
    return [...document.querySelectorAll('#mcProductsList .mc-product-row')]
      .filter(row => row.style.display !== 'none' && row.querySelector('[data-product-select]:checked'));
  }

  function interceptExactProducts(event) {
    const button = event.target.closest?.('#mcAddSelectedProducts');
    if (!button) return;
    const selectedRows = selectedVisibleRows();
    const exactRows = selectedRows.filter(row => exactNameRequired(productInfo(row)?.name || ''));
    if (!exactRows.length) return;

    exactRows.forEach(row => {
      const checkbox = row.querySelector('[data-product-select]');
      if (!checkbox) return;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const remaining = selectedRows.length - exactRows.length;
    if (!remaining) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.setTimeout(() => {
      const added = addExactProducts(exactRows);
      if (added) window.location.reload();
      else showToast('Ce produit est déjà dans Mes courses');
    }, remaining ? 80 : 0);
  }

  function interceptSelectAll(event) {
    const button = event.target.closest?.('#mcSelectAllProducts');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const inputs = [...document.querySelectorAll('#mcProductsList .mc-product-row')]
      .filter(row => row.style.display !== 'none')
      .map(row => row.querySelector('[data-product-select]:not(:disabled)'))
      .filter(Boolean);
    const allSelected = inputs.length > 0 && inputs.every(input => input.checked);
    inputs.forEach(input => {
      const next = !allSelected;
      if (input.checked === next) return;
      input.checked = next;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    button.textContent = allSelected ? 'Tout sélectionner' : 'Tout désélectionner';
  }

  function updateVersionLabels() {
    if (document.title !== 'Mon Carnet V2.5.5 TEST') document.title = 'Mon Carnet V2.5.5 TEST';
    const brand = document.querySelector('.brand small');
    if (brand && brand.textContent.trim() !== 'VERSION · V2.5.5 TEST') {
      brand.textContent = 'VERSION · V2.5.5 TEST';
    }
  }

  function initialise() {
    updateVersionLabels();
    prepareCreateCard();
    enhanceProductRows();

    document.addEventListener('click', interceptExactProducts, true);
    document.addEventListener('click', interceptSelectAll, true);
    document.addEventListener('click', event => {
      if (event.target.closest?.('#mcOpenProducts')) {
        window.setTimeout(() => {
          prepareCreateCard();
          enhanceProductRows();
        }, 0);
      }
    }, true);

    const observer = new MutationObserver(() => {
      updateVersionLabels();
      prepareCreateCard();
      enhanceProductRows();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
