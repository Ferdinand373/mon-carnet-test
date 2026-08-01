(() => {
  'use strict';

  if (window.__monCarnetCoursesV1) return;
  window.__monCarnetCoursesV1 = true;

  const STORAGE_KEY = 'mon-carnet-integration-v1-courses';
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
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    } catch (_) {
      return { items: [] };
    }
  }

  const state = loadState();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
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
      [/citron/, ['citron', 'Citrons']],
      [/oeuf/, ['oeufs', 'Œufs']],
      [/capres?/, ['capres', 'Câpres']],
      [/ketchup/, ['ketchup', 'Ketchup']],
      [/fond de veau/, ['fond-de-veau', 'Fond de veau']],
      [/creme fraiche|creme liquide|creme epaisse/, ['creme-fraiche', 'Crème fraîche']],
      [/beurre/, ['beurre', 'Beurre']],
      [/escalope.*poulet|poulet.*escalope/, ['escalopes-poulet', 'Escalopes de poulet']],
      [/poulet/, ['poulet', 'Poulet']],
      [/oignon/, ['oignons', 'Oignons']],
      [/ail/, ['ail', 'Ail']],
      [/pomme de terre/, ['pommes-de-terre', 'Pommes de terre']],
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
    if (productKey === 'capres') return { quantity: 1, unit: 'pot' };
    if (productKey === 'ketchup') return { quantity: 1, unit: 'flacon' };
    if (productKey === 'fond-de-veau') return { quantity: 1, unit: 'boîte' };
    if (productKey === 'creme-fraiche') return { quantity: 1, unit: 'pot' };
    if (productKey === 'beurre' && /\b(g|gramme)/.test(t)) return { quantity: 1, unit: 'plaquette' };

    const unitMatch = t.match(/\b(kg|g|mg|l|cl|ml|piece|pieces|tranche|tranches|boite|boites|pot|pots|bouteille|bouteilles|sachet|sachets)\b/);
    const units = {
      piece: 'pièce(s)', pieces: 'pièce(s)', tranche: 'tranche(s)', tranches: 'tranche(s)',
      boite: 'boîte(s)', boites: 'boîte(s)', pot: 'pot(s)', pots: 'pot(s)',
      bouteille: 'bouteille(s)', bouteilles: 'bouteille(s)', sachet: 'sachet(s)', sachets: 'sachet(s)'
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

  function selectedReviewTexts() {
    return $$('[data-clair-review-index]:checked').map(input => {
      const index = input.dataset.clairReviewIndex;
      const choice = $(`[data-clair-choice-index="${index}"]`);
      const text = $(`#clairItemText${index}`);
      return (choice?.value || text?.textContent || '').trim();
    }).filter(Boolean);
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
            <label class="mc-course-main">
              <input type="checkbox" data-course-check="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''}>
              <span><strong>${escapeHtml(item.name)} — ${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)}</strong>
              <small>${item.contributions.length > 1 ? `${item.contributions.length} origines regroupées` : escapeHtml(item.contributions[0]?.source || '')}</small></span>
            </label>
            <details>
              <summary>Détail</summary>
              ${item.contributions.map(c => `<p>${escapeHtml(c.source)} : ${escapeHtml(c.raw)}</p>`).join('')}
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
    updateBadge();
  }

  function updateBadge() {
    const badge = $('#mcCoursesBadge');
    if (!badge) return;
    const count = state.items.filter(item => !item.checked).length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
  }

  function openCourses() {
    document.body.classList.remove('recipe-open');
    $$('.view').forEach(view => view.classList.remove('active'));
    $$('.nav-btn').forEach(button => button.classList.remove('active'));
    const view = $('#view-courses');
    if (view) view.classList.add('active');
    renderCourses();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      .mc-courses-button{position:relative}
      .mc-courses-badge{position:absolute;right:-3px;top:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--copper);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center}
      .mc-courses-badge[hidden]{display:none}
      .mc-course-rayon{margin:22px 0}.mc-course-rayon h3{margin:0 0 10px;font-family:Georgia,"Times New Roman",serif;font-size:22px;font-weight:500}
      .mc-course-items{display:grid;gap:9px}.mc-course-item{padding:13px 14px;border:1px solid var(--line);border-radius:16px;background:var(--card-solid)}
      .mc-course-item.done{opacity:.56}.mc-course-item.done strong{text-decoration:line-through}
      .mc-course-main{display:flex;align-items:flex-start;gap:11px;cursor:pointer}.mc-course-main input{width:21px;height:21px;margin:1px 0 0;accent-color:var(--forest)}
      .mc-course-main span{min-width:0}.mc-course-main strong{display:block;font-size:16px;line-height:1.25}.mc-course-main small{display:block;margin-top:4px;color:var(--muted)}
      .mc-course-item details{margin:8px 0 0 32px}.mc-course-item summary{cursor:pointer;color:var(--forest);font-size:13px;font-weight:700}.mc-course-item details p{margin:5px 0 0;font-size:13px}
      .mc-course-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.mc-course-manual{margin-top:24px;padding:16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.55)}
      .mc-course-manual-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.6fr) auto;gap:8px}.mc-course-manual input,.mc-course-manual select{width:100%;min-height:46px;border:1px solid var(--line);border-radius:13px;background:var(--card-solid);padding:10px 12px;color:var(--ink)}
      .mc-courses-toast{position:fixed;left:50%;bottom:calc(92px + var(--safe-bottom));z-index:1000;max-width:calc(100% - 30px);transform:translate(-50%,18px);opacity:0;pointer-events:none;padding:11px 15px;border-radius:14px;background:var(--forest);color:#fff;font-weight:700;box-shadow:var(--shadow);transition:.2s ease}.mc-courses-toast.show{opacity:1;transform:translate(-50%,0)}
      @media(max-width:680px){.mc-course-manual-grid{grid-template-columns:1fr}.mc-course-manual-grid .btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function injectView() {
    if ($('#view-courses')) return;
    const main = $('main');
    if (!main) return;
    const section = document.createElement('section');
    section.className = 'view';
    section.id = 'view-courses';
    section.dataset.view = 'courses';
    section.innerHTML = `
      <div class="section-head">
        <div><h2>Mes courses</h2><p>Classées dans l’ordre du magasin, sans doublons.</p></div>
      </div>
      <div class="mc-course-actions">
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
      </div>`;
    main.appendChild(section);

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
    const button = document.createElement('button');
    button.id = 'mcOpenCourses';
    button.type = 'button';
    button.className = 'icon-btn mc-courses-button';
    button.setAttribute('aria-label', 'Ouvrir mes courses');
    button.innerHTML = '<span aria-hidden="true">🛒</span><span class="mc-courses-badge" id="mcCoursesBadge" hidden>0</span>';
    button.addEventListener('click', openCourses);
    host.appendChild(button);
    updateBadge();
  }

  function adaptExistingInterface() {
    const detail = $('#detailClairBtn');
    if (detail && detail.textContent.trim() !== 'Ajouter aux courses') {
      detail.textContent = 'Ajouter aux courses';
    }
    const modalTitle = $('#clairTitle');
    if (modalTitle) modalTitle.textContent = 'Ajouter aux courses';
    const modalIntro = $('#clairModal .modal-head p');
    if (modalIntro) modalIntro.textContent = 'Décochez ce que vous avez déjà à la maison.';
    const open = $('#openClairBtn');
    if (open) open.textContent = 'Ajouter aux courses';
    const copy = $('#copyClairBtn');
    if (copy) copy.hidden = true;
    const note = $('#scalingNote');
    if (note) note.textContent = 'Seuls les produits cochés seront ajoutés. Les recettes restent inchangées.';
  }

  function initialise() {
    injectStyles();
    injectView();
    injectHeaderButton();
    adaptExistingInterface();
    renderCourses();

    document.addEventListener('click', addSelectedRecipeItems, true);
    const observer = new MutationObserver(() => {
      injectView();
      injectHeaderButton();
      adaptExistingInterface();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
