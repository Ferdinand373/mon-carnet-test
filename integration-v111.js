(() => {
  'use strict';

  if (window.__monCarnetCoursesV111) return;
  window.__monCarnetCoursesV111 = true;

  const STORAGE_KEY = 'mon-carnet-integration-v1-courses';
  const PRODUCTS_STORAGE_KEY = 'mon-carnet-integration-v1-products';
  const STATE_VERSION = 104;
  const AISLES = [
    'Fruits et légumes',
    'Boucherie et charcuterie',
    'Boulangerie',
    'Poissonnerie et fruits de mer',
    'Crémerie',
    'Surgelés',
    'Conserves',
    'Épicerie salée',
    'Épicerie sucrée et petit-déjeuner',
    'Eau',
    'Boissons sans alcool',
    'Alcool',
    'Hygiène',
    'Produits ménagers'
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const fold = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9½¼¾\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        version: Number(parsed.version) || 0
      };
    } catch (_) {
      return { items: [], version: 0 };
    }
  }

  const state = loadState();


  function cleanProductText(value, maxLength = 160) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function mapProductAisle(value, name = '') {
    const aisle = fold(value);
    if (/fruit|legume/.test(aisle)) return 'Fruits et légumes';
    if (/boucher|charcut/.test(aisle)) return 'Boucherie et charcuterie';
    if (/boulanger/.test(aisle)) return 'Boulangerie';
    if (/poisson/.test(aisle)) return 'Poissonnerie et fruits de mer';
    if (/cremer|laitier/.test(aisle)) return 'Crémerie';
    if (/surgele/.test(aisle)) return 'Surgelés';
    if (/conserve/.test(aisle)) return 'Conserves';
    if (/eau/.test(aisle)) return 'Eau';
    if (/alcool/.test(aisle)) return 'Alcool';
    if (/boisson/.test(aisle)) return /\beau\b/.test(fold(name)) ? 'Eau' : classify(name);
    if (/hygiene/.test(aisle)) return 'Hygiène';
    if (/maison|menager/.test(aisle)) return 'Produits ménagers';
    if (/epicerie/.test(aisle)) return classify(name);
    return classify(name);
  }

  function normaliseProduct(raw, origin = 'clair') {
    if (!raw) return null;
    const source = typeof raw === 'string' ? { name: raw } : raw;
    if (!source || typeof source !== 'object') return null;
    const name = cleanProductText(source.name ?? source.nom ?? source.label ?? source.article ?? source.text);
    if (!name) return null;
    const quantity = cleanProductText(source.quantity ?? source.quantite ?? source.qty, 60);
    const aisle = mapProductAisle(source.aisle ?? source.rayon ?? source.category, name);
    const stable = `${origin}|${fold(quantity)}|${fold(name)}`.replace(/[^a-z0-9| -]/g, '');
    return {
      id: cleanProductText(source.id, 120) || stable.replace(/[|\s]+/g, '-'),
      name,
      quantity,
      aisle,
      origin
    };
  }

  function loadCustomProducts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRODUCTS_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(item => normaliseProduct(item, 'carnet')).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  let customProducts = loadCustomProducts();
  let selectedProductIds = new Set();

  function saveCustomProducts() {
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(customProducts.map(({ id, name, quantity, aisle }) => ({ id, name, quantity, aisle }))));
  }

  function productArraysFromPayload(payload) {
    if (Array.isArray(payload)) return [payload];
    if (!payload || typeof payload !== 'object') return [];
    const base = payload.state || payload.data || payload;
    if (!base || typeof base !== 'object') return [];
    return ['products', 'produits', 'favorites', 'favourites', 'habituels', 'favoris']
      .map(key => base[key])
      .filter(Array.isArray);
  }

  function readClairProducts() {
    const arrays = [];
    const readKey = key => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        arrays.push(...productArraysFromPayload(parsed));
      } catch (_) {}
    };

    readKey('clairCourses.state');
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || '';
      if (key === 'clairCourses.state' || key === STORAGE_KEY || key === PRODUCTS_STORAGE_KEY) continue;
      if (!/^claircourses/i.test(key)) continue;
      if (!/(favorite|favori|habituel|product|produit)/i.test(key)) continue;
      readKey(key);
    }

    const seen = new Set();
    const products = [];
    arrays.flat().forEach(raw => {
      const product = normaliseProduct(raw, 'clair');
      if (!product) return;
      const key = `${fold(product.quantity)}|${fold(product.name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      products.push(product);
    });
    return products;
  }

  function allProducts() {
    const merged = [];
    const seen = new Set();
    [...readClairProducts(), ...customProducts].forEach(product => {
      const key = `${fold(product.quantity)}|${fold(product.name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(product);
    });
    return merged.sort((a, b) => {
      const aisle = AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle);
      return aisle || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
  }

  function saveState() {
    state.version = STATE_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, version: state.version }));
    updateBadge();
  }

  function numberFromText(text) {
    const value = fold(text);
    const fraction = value.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    if (value.includes('½')) return 0.5;
    if (value.includes('¼')) return 0.25;
    if (value.includes('¾')) return 0.75;
    const match = value.match(/\b\d+(?:[.,]\d+)?\b/);
    return match ? Number(match[0].replace(',', '.')) : 1;
  }

  function classify(text) {
    const t = fold(text);
    if (/surgel|glace|frites/.test(t)) return 'Surgelés';
    if (/eau plate|eau gazeuse|bouteille d eau|pack d eau|\beau\b/.test(t)) return 'Eau';
    if (/vin|biere|cidre|rhum|cognac|calvados|whisky|vodka|porto|aperitif|alcool/.test(t)) return 'Alcool';
    if (/jus de fruit|soda|sirop|limonade|cola|tonic/.test(t)) return 'Boissons sans alcool';
    if (/lessive|liquide vaisselle|essuie tout|sac poubelle|nettoyant|javel|produit menager|eponges?/.test(t)) return 'Produits ménagers';
    if (/shampoing|savon|dentifrice|deodorant|papier toilette|gel douche|hygiene|mouchoirs?/.test(t)) return 'Hygiène';
    if (/pain|baguette|brioche|viennoiser|pain de mie/.test(t)) return 'Boulangerie';
    if (/saumon|cabillaud|thon frais|poisson|crevette|moule|huitre|coquille saint jacques|crabe|homard|araignee de mer/.test(t)) return 'Poissonnerie et fruits de mer';
    if (/poulet|boeuf|porc|veau|agneau|dinde|canard|jambon|lardon|saucisse|steak|escalope|viande|charcuterie|bacon/.test(t)) return 'Boucherie et charcuterie';
    if (/lait|beurre|creme|oeuf|fromage|yaourt|mascarpone|mozzarella|parmesan|pate feuilletee|pate brisee/.test(t)) return 'Crémerie';
    if (/en boite|conserve|tomates pelees|mais|petits pois|haricots|pois chiches|macedoine|fruits au sirop|sardines|maquereaux|thon au naturel/.test(t)) return 'Conserves';
    if (/sucre|chocolat|confiture|miel|cafe|the|cereale|biscuit|levure chimique|vanille|cacao/.test(t)) return 'Épicerie sucrée et petit-déjeuner';
    if (/citron|pomme|poire|orange|carotte|oignon|ail|salade|pomme de terre|champignon|tomate|courgette|aubergine|poireau|celeri|persil|basilic|ciboulette|echalote|legume|fruit/.test(t)) return 'Fruits et légumes';
    return 'Épicerie salée';
  }

  function canonicalProduct(rawText) {
    const t = fold(rawText);
    const rules = [
      [/\bcitrons?\b/, ['citron', 'Citrons']],
      [/\beau\b/, ['eau', 'Eau']],
      [/\bcafe\b/, ['cafe', 'Café']],
      [/papier aluminium/, ['papier-aluminium', 'Papier aluminium']],
      [/sacs?[- ]?poubelles?/, ['sacs-poubelle', 'Sacs-poubelle']],
      [/\boeufs?\b/, ['oeufs', 'Œufs']],
      [/\bcapres?\b/, ['capres', 'Câpres']],
      [/\bketchup\b/, ['ketchup', 'Ketchup']],
      [/\bfond de veau\b/, ['fond-de-veau', 'Fond de veau']],
      [/\bcreme (fraiche|liquide|epaisse)\b/, ['creme-fraiche', 'Crème fraîche']],
      [/\bbeurre\b/, ['beurre', 'Beurre']],
      [/\bescalopes? de poulet\b|\bpoulet.*escalopes?\b/, ['escalopes-poulet', 'Escalopes de poulet']],
      [/\bcuisses? de poulet\b/, ['cuisses-poulet', 'Cuisses de poulet']],
      [/\bpommes? de terre\b/, ['pommes-de-terre', 'Pommes de terre']],
      [/\bpoulet\b/, ['poulet', 'Poulet']],
      [/\boignons?\b/, ['oignons', 'Oignons']],
      [/\bail\b/, ['ail', 'Ail']],
      [/tomate/, ['tomates', 'Tomates']],
      [/carotte/, ['carottes', 'Carottes']],
      [/pain/, ['pain', 'Pain']],
      [/lait/, ['lait', 'Lait']],
      [/farine/, ['farine', 'Farine']],
      [/sucre/, ['sucre', 'Sucre']],
      [/sel/, ['sel', 'Sel']],
      [/poivre/, ['poivre', 'Poivre']],
      [/huile/, ['huile', 'Huile']],
      [/moutarde/, ['moutarde', 'Moutarde']],
      [/riz/, ['riz', 'Riz']],
      [/pates?\b/, ['pates', 'Pâtes']]
    ];
    for (const [pattern, result] of rules) {
      if (pattern.test(t)) return { key: result[0], name: result[1] };
    }

    let name = t
      .replace(/^\d+(?:[.,]\d+)?\s*(kg|g|mg|l|cl|ml|pieces?|tranches?|boites?|pots?|bouteilles?|sachets?)?\s*(de|d)?\s*/, '')
      .replace(/\b(un|une|des|du|de la|de l)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) name = t || 'article';
    return {
      key: name.replace(/\s+/g, '-'),
      name: name.charAt(0).toUpperCase() + name.slice(1)
    };
  }

  function buyingQuantity(rawText, productKey) {
    const t = fold(rawText);
    const value = numberFromText(rawText);

    if (productKey === 'citron') return { quantity: Math.max(1, value), unit: 'pièce(s)' };
    if (productKey === 'oeufs') return { quantity: Math.max(1, value), unit: 'pièce(s)' };
    if (productKey === 'cuisses-poulet' || productKey === 'escalopes-poulet') {
      return { quantity: Math.max(1, value), unit: 'pièce(s)' };
    }
    if (productKey === 'ail' && /\bgousses?\b/.test(t)) {
      return { quantity: Math.max(1, value), unit: 'gousse(s)' };
    }
    if (productKey === 'capres') return { quantity: 1, unit: 'pot' };
    if (productKey === 'ketchup') return { quantity: 1, unit: 'flacon' };
    if (productKey === 'fond-de-veau') return { quantity: 1, unit: 'boîte' };
    if (productKey === 'creme-fraiche') return { quantity: 1, unit: 'pot' };
    if (productKey === 'beurre' && /\b(g|gramme)/.test(t)) return { quantity: 1, unit: 'plaquette' };

    const unitMatch = t.match(/\b(kg|g|mg|l|cl|ml|piece|pieces|gousse|gousses|tranche|tranches|boite|boites|pot|pots|bouteille|bouteilles|sachet|sachets|paquet|paquets|rouleau|rouleaux|flacon|flacons|plaquette|plaquettes|barquette|barquettes|bidon|bidons|tube|tubes)\b/);
    const units = {
      piece: 'pièce(s)', pieces: 'pièce(s)', gousse: 'gousse(s)', gousses: 'gousse(s)', tranche: 'tranche(s)', tranches: 'tranche(s)',
      boite: 'boîte(s)', boites: 'boîte(s)', pot: 'pot(s)', pots: 'pot(s)',
      bouteille: 'bouteille(s)', bouteilles: 'bouteille(s)', sachet: 'sachet(s)', sachets: 'sachet(s)',
      paquet: 'paquet(s)', paquets: 'paquet(s)', rouleau: 'rouleau(x)', rouleaux: 'rouleau(x)',
      flacon: 'flacon(s)', flacons: 'flacon(s)', plaquette: 'plaquette(s)', plaquettes: 'plaquette(s)',
      barquette: 'barquette(s)', barquettes: 'barquette(s)', bidon: 'bidon(s)', bidons: 'bidon(s)', tube: 'tube(s)', tubes: 'tube(s)'
    };
    const unit = unitMatch ? (units[unitMatch[1]] || unitMatch[1]) : 'article';
    return { quantity: Math.max(value || 1, 0.01), unit };
  }

  function readCurrentRecipeName() {
    const title = $('#detailContent .detail-sheet h2') || $('#detailContent h2') || $('#clairTitle');
    return title?.textContent?.trim() || 'Recette';
  }

  function addCourseItem(rawText, source) {
    const raw = String(rawText || '').trim();
    if (!raw) return { added: false, duplicate: false };

    const product = canonicalProduct(raw);
    const buying = buyingQuantity(raw, product.key);
    const aisle = classify(raw);
    const signature = `${fold(source)}|${product.key}|${fold(raw)}`;

    if (state.items.some(item => item.contributions?.some(c => c.signature === signature))) {
      return { added: false, duplicate: true };
    }

    let item = state.items.find(candidate => candidate.key === product.key && candidate.unit === buying.unit);
    if (!item) {
      item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        key: product.key,
        name: product.name,
        quantity: 0,
        unit: buying.unit,
        aisle,
        checked: false,
        contributions: []
      };
      state.items.push(item);
    }

    item.quantity = Number((item.quantity + buying.quantity).toFixed(2));
    item.aisle = aisle;
    item.checked = false;
    item.contributions.push({ source, raw, quantity: buying.quantity, unit: buying.unit, signature });
    return { added: true, duplicate: false };
  }

  function migrateStateV104() {
    if ((state.version || 0) >= STATE_VERSION) return;

    const legacy = state.items.flatMap(item => {
      const contributions = Array.isArray(item.contributions) && item.contributions.length
        ? item.contributions
        : [{
            source: 'Liste existante',
            raw: `${item.quantity || 1} ${item.unit || ''} ${item.name || 'article'}`.trim(),
            signature: `legacy|${item.id || Math.random()}`
          }];
      return contributions.map(contribution => ({
        source: contribution.source || 'Liste existante',
        raw: contribution.raw || `${item.quantity || 1} ${item.unit || ''} ${item.name || 'article'}`.trim(),
        signature: contribution.signature,
        preferredAisle: contribution.source === 'Ajout manuel' ? item.aisle : null,
        checked: Boolean(item.checked)
      }));
    });

    if (!legacy.length) {
      state.version = STATE_VERSION;
      saveState();
      return;
    }

    state.items = [];
    const seen = new Set();
    legacy.forEach(entry => {
      const raw = String(entry.raw || '').trim();
      if (!raw) return;
      const product = canonicalProduct(raw);
      const buying = buyingQuantity(raw, product.key);
      const signature = entry.signature || `${fold(entry.source)}|${product.key}|${fold(raw)}`;
      if (seen.has(signature)) return;
      seen.add(signature);

      let item = state.items.find(candidate => candidate.key === product.key && candidate.unit === buying.unit);
      if (!item) {
        item = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          key: product.key,
          name: product.name,
          quantity: 0,
          unit: buying.unit,
          aisle: entry.preferredAisle || classify(raw),
          checked: entry.checked,
          contributions: []
        };
        state.items.push(item);
      }

      item.quantity = Number((item.quantity + buying.quantity).toFixed(2));
      item.checked = item.checked && entry.checked;
      item.contributions.push({
        source: entry.source,
        raw,
        quantity: buying.quantity,
        unit: buying.unit,
        signature
      });
    });

    state.version = STATE_VERSION;
    saveState();
  }

  function isNonIngredientLine(rawText) {
    const text = fold(rawText).replace(/\s+/g, ' ').trim();
    if (!text) return true;

    if (/^(ingredients?|preparation|temps|duree|ustensiles?|materiel|difficulte|niveau|cout|budget)\s*:?$/.test(text)) {
      return true;
    }

    if (/^(temps(?: total| de preparation| de cuisson| de repos)?|duree(?: totale?)?|total|preparation|cuisson|repos|marinade)\s*:?\s*(?:environ\s*)?\d+(?:[.,]\d+)?\s*(?:h|heure|heures|min|minute|minutes)(?:\s*\d+\s*(?:min|minute|minutes))?$/.test(text)) {
      return true;
    }

    if (/^\d+(?:[.,]\d+)?\s*(?:h|heure|heures|min|minute|minutes)$/.test(text)) {
      return true;
    }

    if (/^(?:pour\s+)?\d+\s+personnes?$/.test(text)) return true;
    return false;
  }

  function reviewTextForInput(input) {
    const index = input?.dataset?.clairReviewIndex;
    if (index == null) return '';
    const choice = $(`[data-clair-choice-index="${index}"]`);
    const text = $(`#clairItemText${index}`);
    return (choice?.value || text?.textContent || '').trim();
  }

  function scheduleClairReviewCleanup() {
    [0, 40, 120, 280, 600].forEach(delay => {
      window.setTimeout(cleanClairReview, delay);
    });
  }

  function cleanClairReview() {
    const copy = $('#copyClairBtn');
    if (copy) {
      copy.hidden = true;
      copy.style.setProperty('display', 'none', 'important');
    }

    const inputs = $$('[data-clair-review-index]');
    if (!inputs.length) return;

    let checkedInvalid = null;
    inputs.forEach(input => {
      const invalid = isNonIngredientLine(reviewTextForInput(input));
      const row = input.closest('.clair-review-item');
      if (row) {
        if (invalid) row.dataset.mcNonIngredient = '1';
        else delete row.dataset.mcNonIngredient;
        row.setAttribute('aria-hidden', invalid ? 'true' : 'false');
      }
      if (invalid && input.checked && !checkedInvalid) checkedInvalid = input;
    });

    /* Décoche une ligne parasite à la fois : l'application recalcule alors
       correctement le compteur, puis cette fonction recommence sur la liste neuve. */
    if (checkedInvalid) {
      window.setTimeout(() => {
        if (document.contains(checkedInvalid) && checkedInvalid.checked) {
          checkedInvalid.click();
        }
        scheduleClairReviewCleanup();
      }, 0);
    }
  }

  function selectedReviewTexts() {
    return $$('[data-clair-review-index]:checked').map(input => reviewTextForInput(input))
      .filter(text => text && !isNonIngredientLine(text));
  }

  function toast(message) {
    let node = $('#mcCoursesToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'mcCoursesToast';
      node.className = 'mc-courses-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), 2300);
  }

  function formatQuantity(quantity) {
    return Number.isInteger(quantity) ? String(quantity) : String(quantity).replace('.', ',');
  }


  function rawForProduct(product) {
    if (product.quantity) return `${product.quantity} ${product.name}`.trim();
    const name = fold(product.name);
    if (/^eau$/.test(name)) return '1 bouteille d’eau';
    if (/^lait$/.test(name)) return '1 bouteille de lait';
    if (/^beurre$/.test(name)) return '1 plaquette de beurre';
    if (/^cafe$/.test(name)) return '1 paquet de café';
    if (/^pain$/.test(name)) return '1 pain';
    if (/papier aluminium/.test(name)) return '1 rouleau de papier aluminium';
    if (/sac.*poubelle/.test(name)) return '1 paquet de sacs-poubelle';
    if (/papier toilette/.test(name)) return '1 paquet de papier toilette';
    if (/liquide vaisselle/.test(name)) return '1 flacon de liquide vaisselle';
    if (/lessive/.test(name)) return '1 bidon de lessive';
    return `1 ${product.name}`;
  }

  function productCourseSignature(product) {
    const raw = rawForProduct(product);
    const canonical = canonicalProduct(raw);
    return `${fold('Mes produits')}|${canonical.key}|${fold(raw)}`;
  }

  function isProductInCourses(product) {
    const signature = productCourseSignature(product);
    return state.items.some(item => item.contributions?.some(contribution => contribution.signature === signature));
  }

  function updateProductsAddButton() {
    const button = $('#mcAddSelectedProducts');
    if (!button) return;
    button.disabled = selectedProductIds.size === 0;
    button.textContent = selectedProductIds.size
      ? `Ajouter la sélection (${selectedProductIds.size})`
      : 'Ajouter la sélection';
  }

  function renderProducts() {
    const host = $('#mcProductsList');
    if (!host) return;
    const products = allProducts();
    selectedProductIds = new Set([...selectedProductIds].filter(id => products.some(product => product.id === id && !isProductInCourses(product))));

    if (!products.length) {
      host.innerHTML = '<div class="empty-state"><strong>Aucun produit habituel retrouvé</strong><p>Ajoutez votre premier produit ci-dessous.</p></div>';
      updateProductsAddButton();
      return;
    }

    host.innerHTML = AISLES.map(aisle => {
      const aisleProducts = products.filter(product => product.aisle === aisle);
      if (!aisleProducts.length) return '';
      return `<section class="mc-product-rayon">
        <h3>${escapeHtml(aisle)}</h3>
        <div class="mc-products-grid">${aisleProducts.map(product => {
          const present = isProductInCourses(product);
          return `<div class="mc-product-row ${present ? 'present' : ''}">
            <label>
              <input type="checkbox" data-product-select="${escapeHtml(product.id)}" ${selectedProductIds.has(product.id) ? 'checked' : ''} ${present ? 'disabled' : ''}>
              <span><strong>${escapeHtml(product.name)}</strong>${product.quantity ? `<small>${escapeHtml(product.quantity)}</small>` : ''}${present ? '<small>Déjà dans Mes courses</small>' : ''}</span>
            </label>
            ${product.origin === 'carnet' ? `<button type="button" class="mc-product-remove" data-product-remove="${escapeHtml(product.id)}" aria-label="Supprimer ${escapeHtml(product.name)}">×</button>` : ''}
          </div>`;
        }).join('')}</div>
      </section>`;
    }).join('');

    $$('[data-product-select]', host).forEach(input => input.addEventListener('change', () => {
      if (input.checked) selectedProductIds.add(input.dataset.productSelect);
      else selectedProductIds.delete(input.dataset.productSelect);
      updateProductsAddButton();
    }));

    $$('[data-product-remove]', host).forEach(button => button.addEventListener('click', () => {
      customProducts = customProducts.filter(product => product.id !== button.dataset.productRemove);
      selectedProductIds.delete(button.dataset.productRemove);
      saveCustomProducts();
      renderProducts();
      toast('Produit habituel supprimé');
    }));
    updateProductsAddButton();
  }

  function openProducts(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const panel = $('#mc-products-panel');
    if (!panel) return;
    selectedProductIds.clear();
    renderProducts();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => panel.scrollTo({ top: 0, behavior: 'auto' }));
  }

  function closeProducts(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const panel = $('#mc-products-panel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  function addSelectedProducts() {
    const products = allProducts().filter(product => selectedProductIds.has(product.id));
    if (!products.length) {
      toast('Aucun produit sélectionné');
      return;
    }
    let added = 0;
    let duplicates = 0;
    products.forEach(product => {
      const result = addCourseItem(rawForProduct(product), 'Mes produits');
      if (result.added) added += 1;
      if (result.duplicate) duplicates += 1;
    });
    saveState();
    renderCourses();
    selectedProductIds.clear();
    closeProducts();
    if (added && duplicates) toast(`${added} ajouté(s), ${duplicates} déjà présent(s)`);
    else if (added) toast(`${added} produit(s) ajouté(s) aux courses`);
    else toast('Ces produits sont déjà dans les courses');
  }

  function addCustomProduct() {
    const nameInput = $('#mcProductName');
    const quantityInput = $('#mcProductQuantity');
    const aisleSelect = $('#mcProductAisle');
    const name = cleanProductText(nameInput?.value);
    if (!name) return;
    const quantity = cleanProductText(quantityInput?.value, 60);
    const candidate = normaliseProduct({
      id: `carnet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      quantity,
      aisle: aisleSelect?.value || classify(name)
    }, 'carnet');
    if (!candidate) return;
    if (allProducts().some(product => fold(product.name) === fold(candidate.name) && fold(product.quantity) === fold(candidate.quantity))) {
      toast('Ce produit existe déjà');
      return;
    }
    customProducts.push(candidate);
    saveCustomProducts();
    if (nameInput) nameInput.value = '';
    if (quantityInput) quantityInput.value = '';
    renderProducts();
    toast('Produit habituel ajouté');
  }

  function quantityStep(item) {
    const unit = fold(item?.unit);
    if (unit === 'g' || /gramme/.test(unit)) return 50;
    if (unit === 'kg') return 0.1;
    if (unit === 'mg') return 100;
    if (unit === 'ml') return 50;
    if (unit === 'cl') return 10;
    if (unit === 'l') return 0.5;
    return 1;
  }

  function normaliseCourseQuantity(value, item) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    const step = quantityStep(item);
    if (!Number.isFinite(parsed) || parsed <= 0) return Number(item.quantity) || step;
    return Number(Math.max(step, parsed).toFixed(2));
  }

  function setCourseQuantity(itemId, value) {
    const item = state.items.find(candidate => candidate.id === itemId);
    if (!item) return;
    const next = normaliseCourseQuantity(value, item);
    if (next === item.quantity) {
      renderCourses();
      return;
    }
    item.quantity = next;
    item.quantityAdjusted = true;
    item.checked = false;
    saveState();
    renderCourses();
    toast(`Quantité de ${item.name} modifiée`);
  }

  function nudgeCourseQuantity(itemId, direction) {
    const item = state.items.find(candidate => candidate.id === itemId);
    if (!item) return;
    const step = quantityStep(item);
    const current = Number(item.quantity) || step;
    setCourseQuantity(itemId, Number((current + (direction * step)).toFixed(2)));
  }

  function removeCourseContribution(itemId, contributionIndex) {
    const item = state.items.find(candidate => candidate.id === itemId);
    if (!item || !Array.isArray(item.contributions)) return;
    const index = Number(contributionIndex);
    if (!Number.isInteger(index) || index < 0 || index >= item.contributions.length) return;

    const removed = item.contributions.splice(index, 1)[0];
    if (!item.contributions.length) {
      state.items = state.items.filter(candidate => candidate.id !== itemId);
      saveState();
      renderCourses();
      toast(`${item.name} retiré des courses`);
      return;
    }

    if (item.quantityAdjusted) {
      const removedQuantity = Number(removed?.quantity) || 0;
      item.quantity = Number(Math.max(quantityStep(item), (Number(item.quantity) || 0) - removedQuantity).toFixed(2));
    } else {
      item.quantity = Number(item.contributions.reduce((sum, contribution) => sum + (Number(contribution.quantity) || 0), 0).toFixed(2));
    }
    item.checked = false;
    saveState();
    renderCourses();
    toast(`Origine retirée : ${removed?.source || item.name}`);
  }

  function renderCourses() {
    const host = $('#mcCoursesList');
    if (!host) return;

    if (!state.items.length) {
      host.innerHTML = '<div class="empty-state"><strong>La liste est vide</strong><p>Depuis une recette, touchez « Ajouter aux courses », puis gardez uniquement ce qu’il faut acheter.</p></div>';
      updateBadge();
      return;
    }

    host.innerHTML = AISLES.map(aisle => {
      const items = state.items.filter(item => item.aisle === aisle);
      if (!items.length) return '';
      return `<section class="mc-course-rayon">
        <h3>${escapeHtml(aisle)}</h3>
        <div class="mc-course-items">${items.map(item => `
          <article class="mc-course-item ${item.checked ? 'done' : ''}" data-course-id="${escapeHtml(item.id)}">
            <div class="mc-course-top">
              <label class="mc-course-main">
                <input type="checkbox" data-course-check="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''}>
                <span><strong>${escapeHtml(item.name)}</strong>
                <small>${item.contributions.length > 1 ? `${item.contributions.length} origines regroupées` : escapeHtml(item.contributions[0]?.source || '')}</small></span>
              </label>
              <div class="mc-quantity-control" aria-label="Modifier la quantité de ${escapeHtml(item.name)}">
                <button type="button" data-course-minus="${escapeHtml(item.id)}" aria-label="Diminuer ${escapeHtml(item.name)}">−</button>
                <input type="text" inputmode="decimal" data-course-quantity="${escapeHtml(item.id)}" value="${escapeHtml(formatQuantity(item.quantity))}" aria-label="Quantité de ${escapeHtml(item.name)}">
                <span>${escapeHtml(item.unit)}</span>
                <button type="button" data-course-plus="${escapeHtml(item.id)}" aria-label="Augmenter ${escapeHtml(item.name)}">+</button>
              </div>
            </div>
            <details>
              <summary>Détail</summary>
              ${item.contributions.map((c, contributionIndex) => `<div class="mc-course-origin">
                <p><strong>${escapeHtml(c.source)}</strong> : ${escapeHtml(c.raw)}</p>
                <button type="button" data-course-origin-remove="${escapeHtml(item.id)}" data-course-origin-index="${contributionIndex}" aria-label="Retirer cette recette de ${escapeHtml(item.name)}">×</button>
              </div>`).join('')}
              ${item.quantityAdjusted ? `<p class="mc-course-adjusted">Quantité ajustée manuellement : ${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)}</p>` : ''}
            </details>
          </article>`).join('')}</div>
      </section>`;
    }).join('');

    $$('[data-course-check]', host).forEach(input => input.addEventListener('change', () => {
      const item = state.items.find(candidate => candidate.id === input.dataset.courseCheck);
      if (!item) return;
      item.checked = input.checked;
      saveState();
      renderCourses();
    }));
    $$('[data-course-minus]', host).forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      nudgeCourseQuantity(button.dataset.courseMinus, -1);
    }));
    $$('[data-course-plus]', host).forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      nudgeCourseQuantity(button.dataset.coursePlus, 1);
    }));
    $$('[data-course-origin-remove]', host).forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      removeCourseContribution(button.dataset.courseOriginRemove, button.dataset.courseOriginIndex);
    }));
    $$('[data-course-quantity]', host).forEach(input => {
      input.addEventListener('focus', () => input.select());
      input.addEventListener('change', () => setCourseQuantity(input.dataset.courseQuantity, input.value));
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.blur();
      });
    });
    updateBadge();
  }

  function updateBadge() {
    const badge = $('#mcCoursesBadge');
    if (!badge) return;
    const count = state.items.filter(item => !item.checked).length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
  }

  function openCourses(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    injectView();
    const panel = $('#mc-courses-panel');
    if (!panel) {
      toast('La page Courses n’est pas encore prête. Rechargez la page.');
      return;
    }

    renderCourses();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('mc-courses-open');
    document.body.classList.add('mc-courses-open');
    window.requestAnimationFrame(() => panel.scrollTo({ top: 0, behavior: 'auto' }));
  }

  function closeCourses(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    closeProducts();
    const panel = $('#mc-courses-panel');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    document.documentElement.classList.remove('mc-courses-open');
    document.body.classList.remove('mc-courses-open');
  }

  function addSelectedRecipeItems(event) {
    const button = event.target.closest('#openClairBtn');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const selected = selectedReviewTexts();
    if (!selected.length) {
      toast('Aucun produit sélectionné');
      return;
    }

    const source = readCurrentRecipeName();
    let added = 0;
    let duplicates = 0;
    selected.forEach(text => {
      const result = addCourseItem(text, source);
      if (result.added) added += 1;
      if (result.duplicate) duplicates += 1;
    });
    saveState();
    renderCourses();

    const close = $('#clairModal [data-close-modal]');
    if (close) close.click();
    if (added && duplicates) toast(`${added} ajouté(s), ${duplicates} déjà présent(s)`);
    else if (added) toast(`${added} produit(s) ajouté(s) aux courses`);
    else toast('Ces produits sont déjà dans les courses');
  }

  function addManualItem() {
    const input = $('#mcManualProduct');
    const select = $('#mcManualAisle');
    const raw = input?.value?.trim();
    if (!raw) return;

    const product = canonicalProduct(raw);
    const buying = buyingQuantity(raw, product.key);
    const key = product.key;
    let item = state.items.find(candidate => candidate.key === key && candidate.unit === buying.unit);
    if (!item) {
      item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        key,
        name: product.name,
        quantity: 0,
        unit: buying.unit,
        aisle: select?.value || classify(raw),
        checked: false,
        contributions: []
      };
      state.items.push(item);
    }
    item.quantity = Number((item.quantity + buying.quantity).toFixed(2));
    item.aisle = select?.value || item.aisle;
    item.checked = false;
    item.contributions.push({
      source: 'Ajout manuel', raw, quantity: buying.quantity, unit: buying.unit,
      signature: `manuel|${Date.now()}|${fold(raw)}`
    });
    input.value = '';
    saveState();
    renderCourses();
    toast('Article ajouté');
  }

  function injectStyles() {
    if ($('#mcCoursesStyles')) return;
    const style = document.createElement('style');
    style.id = 'mcCoursesStyles';
    style.textContent = `
      html{scrollbar-gutter:stable}
      html.mc-courses-open,body.mc-courses-open{overflow:hidden}
      #copyClairBtn{display:none!important}
      .clair-review-item[data-mc-non-ingredient="1"]{display:none!important}
      .mc-courses-button{position:relative;text-decoration:none}
      .mc-courses-overlay{position:fixed;inset:0;width:100%;height:100dvh;z-index:5000;display:none;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:var(--paper);color:var(--ink)}
      .mc-courses-overlay.open{display:block}
      .mc-courses-shell{max-width:1120px;margin:0 auto;padding:calc(18px + var(--safe-top)) 18px calc(110px + var(--safe-bottom))}
      .mc-courses-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 -4px 18px;padding:8px 4px 12px;background:rgba(246,241,232,.96);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
      .mc-courses-head h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:30px;font-weight:500}
      .mc-courses-head p{margin:4px 0 0;color:var(--muted);font-size:14px}
      .mc-courses-badge{position:absolute;right:-3px;top:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--copper);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center}
      .mc-courses-badge[hidden]{display:none}
      .mc-course-rayon{margin:22px 0}.mc-course-rayon h3{margin:0 0 10px;font-family:Georgia,"Times New Roman",serif;font-size:22px;font-weight:500}
      .mc-course-items{display:grid;gap:9px}.mc-course-item{padding:13px 14px;border:1px solid var(--line);border-radius:16px;background:var(--card-solid)}
      .mc-course-item.done{opacity:.56}.mc-course-item.done strong{text-decoration:line-through}
      .mc-course-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
      .mc-course-main{display:flex;align-items:flex-start;gap:11px;cursor:pointer;min-width:0;flex:1}.mc-course-main input{width:21px;height:21px;margin:1px 0 0;accent-color:var(--forest)}
      .mc-course-main span{min-width:0}.mc-course-main strong{display:block;font-size:16px;line-height:1.25}.mc-course-main small{display:block;margin-top:4px;color:var(--muted)}
      .mc-quantity-control{display:flex;align-items:center;gap:6px;flex:0 0 auto}.mc-quantity-control button{width:38px;height:38px;border:1px solid var(--line);border-radius:11px;background:var(--paper);color:var(--forest);font-size:23px;font-weight:700;line-height:1}.mc-quantity-control input{width:58px;height:38px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);text-align:center;font-weight:800;font-size:15px}.mc-quantity-control span{max-width:92px;color:var(--muted);font-size:13px;line-height:1.15}
      .mc-course-item details{margin:8px 0 0 32px}.mc-course-item summary{cursor:pointer;color:var(--forest);font-size:13px;font-weight:700}.mc-course-item details p{margin:0;font-size:13px}.mc-course-origin{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-top:7px;padding:8px 9px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.45)}.mc-course-origin p{min-width:0;overflow-wrap:anywhere}.mc-course-origin button{width:32px;height:32px;flex:0 0 32px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--copper);font-size:20px;line-height:1;cursor:pointer}.mc-course-adjusted{color:var(--copper);font-weight:700}
      .mc-course-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.mc-course-manual{margin-top:24px;padding:16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.55)}
      .mc-course-manual-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.6fr) auto;gap:8px}.mc-course-manual input,.mc-course-manual select{width:100%;min-height:46px;border:1px solid var(--line);border-radius:13px;background:var(--card-solid);padding:10px 12px;color:var(--ink)}
      .mc-products-overlay{position:fixed;inset:0;z-index:5100;display:none;overflow-y:auto;overflow-x:hidden;background:var(--paper);color:var(--ink)}
      .mc-products-overlay.open{display:block}.mc-products-shell{max-width:760px;margin:0 auto;padding:calc(18px + var(--safe-top)) 18px calc(110px + var(--safe-bottom))}
      .mc-products-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 -4px 18px;padding:8px 4px 12px;background:rgba(246,241,232,.96);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
      .mc-products-head h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:30px;font-weight:500}.mc-products-head p{margin:4px 0 0;color:var(--muted);font-size:14px}
      .mc-products-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.mc-products-actions .btn:disabled{opacity:.45}
      .mc-product-rayon{margin:20px 0}.mc-product-rayon h3{margin:0 0 9px;font-family:Georgia,"Times New Roman",serif;font-size:21px;font-weight:500}
      .mc-products-grid{display:grid;gap:8px}.mc-product-row{display:grid;grid-template-columns:minmax(0,1fr) 42px;align-items:center;gap:6px;padding:10px 11px;border:1px solid var(--line);border-radius:14px;background:var(--card-solid)}
      .mc-product-row label{display:flex;align-items:center;gap:11px;min-width:0;cursor:pointer}.mc-product-row input{width:22px;height:22px;margin:0;accent-color:var(--forest)}
      .mc-product-row span{min-width:0}.mc-product-row strong{display:block;overflow-wrap:anywhere}.mc-product-row small{display:block;margin-top:3px;color:var(--muted);font-size:12px}.mc-product-row.present{opacity:.58}
      .mc-product-remove{width:38px;height:38px;border:0;border-radius:999px;background:transparent;color:var(--muted);font-size:22px}
      .mc-product-create{margin-top:26px;padding:16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.55)}.mc-product-create h3{margin:0 0 12px}
      .mc-product-create-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(120px,.45fr) minmax(180px,.65fr) auto;gap:8px}.mc-product-create input,.mc-product-create select{width:100%;min-height:46px;border:1px solid var(--line);border-radius:13px;background:var(--card-solid);padding:10px 12px;color:var(--ink)}
      .mc-courses-toast{position:fixed;left:50%;bottom:calc(92px + var(--safe-bottom));z-index:1000;max-width:calc(100% - 30px);transform:translate(-50%,18px);opacity:0;pointer-events:none;padding:11px 15px;border-radius:14px;background:var(--forest);color:#fff;font-weight:700;box-shadow:var(--shadow);transition:.2s ease}.mc-courses-toast.show{opacity:1;transform:translate(-50%,0)}
      @media(max-width:680px){.mc-course-manual-grid,.mc-product-create-grid{grid-template-columns:1fr}.mc-course-manual-grid .btn,.mc-product-create-grid .btn{width:100%}.mc-products-actions .btn{flex:1 1 100%}.mc-course-top{display:block}.mc-quantity-control{margin:10px 0 0 32px}.mc-quantity-control input{width:64px}}
    `;
    document.head.appendChild(style);
  }

  function injectView() {
    if ($('#mc-courses-panel')) return;
    const section = document.createElement('section');
    section.className = 'mc-courses-overlay';
    section.id = 'mc-courses-panel';
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-modal', 'true');
    section.setAttribute('aria-hidden', 'true');
    section.setAttribute('aria-labelledby', 'mcCoursesTitle');
    section.innerHTML = `
      <div class="mc-courses-shell">
        <div class="mc-courses-head">
          <div><h2 id="mcCoursesTitle">Mes courses</h2><p>Classées dans l’ordre du magasin, sans doublons.</p></div>
          <button class="icon-btn" id="mcCloseCourses" type="button" aria-label="Fermer les courses">×</button>
        </div>
        <div class="mc-course-actions">
          <button class="btn btn-primary" id="mcOpenProducts" type="button">Mes produits</button>
          <button class="btn btn-light" id="mcRemoveChecked" type="button">Supprimer les articles cochés</button>
          <button class="btn btn-light" id="mcClearCourses" type="button">Vider la liste</button>
        </div>
        <div id="mcCoursesList"></div>
        <div class="mc-course-manual">
          <h3>Ajouter un article</h3>
          <div class="mc-course-manual-grid">
            <input id="mcManualProduct" type="text" placeholder="Exemple : 2 bouteilles d’eau" aria-label="Article à ajouter">
            <select id="mcManualAisle" aria-label="Rayon">${AISLES.map(aisle => `<option>${escapeHtml(aisle)}</option>`).join('')}</select>
            <button class="btn btn-primary" id="mcManualAdd" type="button">Ajouter</button>
          </div>
        </div>
      </div>
      <section class="mc-products-overlay" id="mc-products-panel" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="mcProductsTitle">
        <div class="mc-products-shell">
          <div class="mc-products-head">
            <div><h2 id="mcProductsTitle">Mes produits</h2><p>Vos achats habituels, prêts à rejoindre la liste.</p></div>
            <button class="icon-btn" id="mcCloseProducts" type="button" aria-label="Fermer Mes produits">×</button>
          </div>
          <div class="mc-products-actions">
            <button class="btn btn-light" id="mcSelectAllProducts" type="button">Tout sélectionner</button>
            <button class="btn btn-primary" id="mcAddSelectedProducts" type="button" disabled>Ajouter la sélection</button>
          </div>
          <div id="mcProductsList"></div>
          <div class="mc-product-create">
            <h3>Ajouter un produit habituel</h3>
            <div class="mc-product-create-grid">
              <input id="mcProductName" type="text" placeholder="Exemple : papier toilette" aria-label="Nom du produit habituel">
              <input id="mcProductQuantity" type="text" placeholder="Quantité (facultatif)" aria-label="Quantité habituelle">
              <select id="mcProductAisle" aria-label="Rayon du produit">${AISLES.map(aisle => `<option>${escapeHtml(aisle)}</option>`).join('')}</select>
              <button class="btn btn-primary" id="mcProductCreate" type="button">Ajouter</button>
            </div>
          </div>
        </div>
      </section>`;
    document.body.appendChild(section);

    $('#mcCloseCourses').addEventListener('click', closeCourses, true);
    $('#mcOpenProducts').addEventListener('click', openProducts);
    $('#mcCloseProducts').addEventListener('click', closeProducts);
    $('#mcAddSelectedProducts').addEventListener('click', addSelectedProducts);
    $('#mcProductCreate').addEventListener('click', addCustomProduct);
    $('#mcProductName').addEventListener('keydown', event => { if (event.key === 'Enter') addCustomProduct(); });
    $('#mcProductQuantity').addEventListener('keydown', event => { if (event.key === 'Enter') addCustomProduct(); });
    $('#mcSelectAllProducts').addEventListener('click', () => {
      const available = allProducts().filter(product => !isProductInCourses(product));
      const allSelected = available.length > 0 && available.every(product => selectedProductIds.has(product.id));
      selectedProductIds = allSelected ? new Set() : new Set(available.map(product => product.id));
      renderProducts();
    });
    $('#mcManualAdd').addEventListener('click', addManualItem);
    $('#mcManualProduct').addEventListener('keydown', event => {
      if (event.key === 'Enter') addManualItem();
    });
    $('#mcRemoveChecked').addEventListener('click', () => {
      const before = state.items.length;
      state.items = state.items.filter(item => !item.checked);
      if (state.items.length === before) {
        toast('Aucun article coché');
        return;
      }
      saveState();
      renderCourses();
      toast('Articles cochés supprimés');
    });
    $('#mcClearCourses').addEventListener('click', () => {
      if (!state.items.length) return;
      if (!window.confirm('Vider toute la liste de courses ?')) return;
      state.items = [];
      saveState();
      renderCourses();
      toast('Liste vidée');
    });
  }

  function injectHeaderButton() {
    if ($('#mcOpenCourses')) return;
    const host = $('.topbar-actions') || $('.topbar');
    if (!host) return;
    const button = document.createElement('a');
    button.id = 'mcOpenCourses';
    button.className = 'icon-btn mc-courses-button';
    button.href = '#mc-courses-panel';
    button.setAttribute('aria-label', 'Ouvrir mes courses');
    button.innerHTML = '<span aria-hidden="true">🛒</span><span class="mc-courses-badge" id="mcCoursesBadge" hidden>0</span>';
    button.addEventListener('click', openCourses, true);
    host.appendChild(button);
    updateBadge();
  }

  function setTextIfChanged(element, text) {
    if (!element || element.textContent.trim() === text) return;
    element.textContent = text;
  }

  function adaptExistingInterface() {
    setTextIfChanged($('#detailClairBtn'), 'Ajouter aux courses');
    setTextIfChanged($('#clairTitle'), 'Ajouter aux courses');
    setTextIfChanged($('#clairModal .modal-head p'), 'Décochez ce que vous avez déjà à la maison.');
    setTextIfChanged($('#openClairBtn'), 'Ajouter aux courses');

    const copy = $('#copyClairBtn');
    if (copy) {
      copy.hidden = true;
      copy.style.setProperty('display', 'none', 'important');
    }

    cleanClairReview();

    setTextIfChanged(
      $('#scalingNote'),
      'Seuls les produits cochés seront ajoutés. Les recettes restent inchangées.'
    );
  }

  function initialise() {
    migrateStateV104();
    injectStyles();
    injectView();
    injectHeaderButton();
    adaptExistingInterface();
    renderCourses();

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('#mcOpenCourses')) openCourses(event);
    }, true);
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('#mcCloseCourses')) closeCourses(event);
    }, true);
    document.addEventListener('click', addSelectedRecipeItems, true);
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('#detailClairBtn, [data-open-clair], #clairModal')) {
        scheduleClairReviewCleanup();
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if ($('#mc-products-panel')?.classList.contains('open')) closeProducts(event);
      else if ($('#mc-courses-panel')?.classList.contains('open')) closeCourses(event);
    });
    let refreshPending = false;
    const observer = new MutationObserver(() => {
      if (refreshPending) return;
      refreshPending = true;
      window.requestAnimationFrame(() => {
        refreshPending = false;
        observer.disconnect();
        injectView();
        injectHeaderButton();
        adaptExistingInterface();
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.setInterval(() => {
      const modal = $('#clairModal');
      if (!modal) return;
      const visible = modal.classList.contains('open')
        || modal.getAttribute('aria-hidden') === 'false'
        || window.getComputedStyle(modal).display !== 'none';
      if (visible) cleanClairReview();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
