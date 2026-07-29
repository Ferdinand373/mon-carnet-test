(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonCarnetCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const TRANSPORT_KEY_PREFIX = 'monCarnet.clairCourses.transfer.v1:';

  const DEFAULT_RESERVE_PRODUCTS = [
    'sel', 'poivre', 'eau', 'huile', 'huile d olive', 'huile de tournesol',
    'vinaigre', 'paprika', 'sauce soja', 'mirin', 'cannelle', 'anis etoile',
    'badiane', 'cassonade', 'sucre', 'sucre roux', 'farine', 'cumin',
    'curry', 'muscade', 'piment', 'curcuma', 'gingembre en poudre', 'epices'
  ];

  function cleanSpaces(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function foldText(value) {
    return cleanSpaces(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[’‘`]/g, "'")
      .replace(/[–—−]/g, '-')
      .toLowerCase();
  }

  function normalizeKitchenUnits(value) {
    let text = String(value == null ? '' : value);
    const teaspoon = [
      /\bcuill(?:e|è)res?\s*(?:à|a)\s*caf(?:é|e)(?=\s|$|[,;:.)\]])/gi,
      /\bc\s*\.?\s*(?:à|a)\s*caf(?:é|e)(?=\s|$|[,;:.)\]])/gi,
      /\b(?:cac|càc|c\s*\.?\s*(?:à|a)\s*\.?\s*c\s*\.?)(?=\s|$|[,;:)\]])/gi
    ];
    const tablespoon = [
      /\bcuill(?:e|è)res?\s*(?:à|a)\s*soupe(?=\s|$|[,;:.)\]])/gi,
      /\bc\s*\.?\s*(?:à|a)\s*soupe(?=\s|$|[,;:.)\]])/gi,
      /\b(?:cas|càs|c\s*\.?\s*(?:à|a)\s*\.?\s*s\s*\.?)(?=\s|$|[,;:)\]])/gi
    ];
    teaspoon.forEach(pattern => { text = text.replace(pattern, 'c. à c.'); });
    tablespoon.forEach(pattern => { text = text.replace(pattern, 'c. à s.'); });
    return text;
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (!total) return '';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (!hours) return `${mins} min`;
    return mins ? `${hours} h ${String(mins).padStart(2, '0')}` : `${hours} h`;
  }

  function parseDurationValue(value) {
    const text = foldText(value).replace(/\s+/g, ' ').trim();
    if (!text) return 0;
    let match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|heures?)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:min|mn|minutes?)?)?$/);
    if (match) {
      const hours = Number(match[1].replace(',', '.'));
      const mins = Number((match[2] || '0').replace(',', '.'));
      return Math.round(hours * 60 + mins);
    }
    match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:min|mn|minutes?)$/);
    return match ? Math.round(Number(match[1].replace(',', '.'))) : 0;
  }

  const DURATION_LABELS = [
    { key: 'prepDuration', kind: 'preparation', pattern: '(?:temps\\s+de\\s+preparation|duree\\s+de\\s+preparation|preparation)' },
    { key: 'cookDuration', kind: 'cuisson', pattern: '(?:temps\\s+de\\s+cuisson|duree\\s+de\\s+cuisson|cuisson)' },
    { key: 'marinadeDuration', kind: 'marinade', pattern: '(?:temps\\s+de\\s+marinade|duree\\s+de\\s+marinade|marinade)' },
    { key: 'duration', kind: 'total', pattern: '(?:duree\\s+de\\s+la\\s+recette|temps\\s+de\\s+la\\s+recette|duree\\s+totale|temps\\s+total|total)' }
  ];
  const DURATION_VALUE_SOURCE = '(\\d+(?:[.,]\\d+)?\\s*(?:h|heures?)(?:\\s*\\d+(?:[.,]\\d+)?\\s*(?:min|mn|minutes?)?)?|\\d+(?:[.,]\\d+)?\\s*(?:min|mn|minutes?))';

  function parseDurationMetadataLine(line) {
    const text = foldText(line).replace(/\s+/g, ' ').trim();
    for (const definition of DURATION_LABELS) {
      const regex = new RegExp(`^${definition.pattern}(?:\\s*:\\s*|\\s*-\\s*|\\s+)${DURATION_VALUE_SOURCE}$`, 'i');
      const match = text.match(regex);
      if (!match) continue;
      const minutes = parseDurationValue(match[1]);
      if (minutes > 0) return { key: definition.key, kind: definition.kind, minutes };
    }
    return null;
  }

  function isDurationSectionTitle(line) {
    return /^(?:temps|durees?|temps\s+de\s+la\s+recette)$/.test(foldText(line).replace(/[:：]$/, '').trim());
  }

  function parseDurationMetadata(value) {
    const sourceLines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
    const result = {
      prepDuration: 0,
      cookDuration: 0,
      marinadeDuration: 0,
      duration: 0,
      metadataLines: [],
      sectionTitleLines: [],
      remainingLines: []
    };
    sourceLines.forEach((line, index) => {
      if (isDurationSectionTitle(line)) {
        result.sectionTitleLines.push({ index, line });
        return;
      }
      const metadata = parseDurationMetadataLine(line);
      if (metadata) {
        result[metadata.key] = metadata.minutes;
        result.metadataLines.push({ index, line, ...metadata });
        return;
      }
      result.remainingLines.push(line);
    });
    result.cleanedText = result.remainingLines.join('\n');
    return result;
  }

  function isIngredientHeading(line) {
    const text = foldText(line).replace(/[:：]$/, '').trim();
    if (!text) return false;
    return /^(?:ingredients?|pour\s+(?:le|la|les)\b.*|farce|sauce|garniture|accompagnement|legumes?\s+rotis?|pour\s+le\s+service)$/.test(text);
  }

  function isPreparationSectionHeading(line) {
    const text = foldText(line).replace(/[:：]$/, '').trim();
    if (!text) return false;
    return /^(?:preparation(?:\s+des?\b.*)?|etapes?(?:\s+de\b.*)?|instructions?|cuisson(?:\s+des?\b.*)?|methode|realisation|dressage|finition)$/.test(text);
  }

  function isManifestProcedure(line) {
    const text = foldText(line)
      .replace(/^[\s•·*–—-]+/, '')
      .replace(/^\d+\s*[.)-]\s*/, '')
      .trim();
    if (!text) return false;
    const action = /(?:eplucher|peler|laver|rincer|essuyer|egoutter|secher|couper|decouper|tailler|trancher|emincer|hacher|ciseler|ecraser|raper|presser|zester|denoyauter|epiner|retirer|enlever|inciser|entailler|melanger|fouetter|battre|ajouter|incorporer|verser|mettre|deposer|disposer|repartir|recouvrir|badigeonner|assaisonner|saler|poivrer|saupoudrer|arroser|faire\s+(?:chauffer|fondre|revenir|dorer|cuire)|prechauffer|chauffer|fondre|revenir|dorer|saisir|griller|cuire|enfourner|laisser|reserver|retourner|remuer|servir|garnir|former|rouler|plier|fermer|ouvrir)/;
    if (new RegExp(`^${action.source}\\b`).test(text)) return true;
    const withoutLeadingPronoun = text.replace(/^(?:(?:les?|la|on)\s+|l[' ]\s*)/, '');
    if (withoutLeadingPronoun !== text && new RegExp(`^${action.source}\\b`).test(withoutLeadingPronoun)) return true;
    if (/^(?:lorsque|lorsqu|quand|une\s+fois|pendant\s+ce\s+temps|ensuite)\b/.test(text) && action.test(text)) return true;
    if (/\b(?:a\s+mi[- ]cuisson|servir\s+immediatement|reserver\s+au\s+chaud|jusqu[' ]?a\s+ce\s+que)\b/.test(text)) return true;
    if (/\bpuis\b/.test(text) && action.test(text)) return true;
    if (/\b\d{2,3}\s*°\s*c\b/.test(text)) return true;
    const duration = /\b\d+(?:[.,]\d+)?\s*(?:minutes?|min|mn|heures?|h)\b/.test(text);
    if (duration && (action.test(text) || /\b(?:cuisson|four|airfryer|plancha|poele|panier)\b/.test(text))) return true;
    return text.split(/\s+/).length >= 9 && action.test(text) && /[,.;!?]|\b(?:pour|puis|jusqu|afin\s+de)\b/.test(text);
  }

  function auditIngredientLines(value) {
    const sourceLines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
    const entries = [];
    let afterPreparationHeading = false;
    sourceLines.forEach((line, index) => {
      const trimmed = cleanSpaces(line);
      if (!trimmed) {
        entries.push({ index, line, suspicious: false, reason: 'blank', suggestedDestination: 'ignore' });
        return;
      }
      if (isIngredientHeading(trimmed)) {
        afterPreparationHeading = false;
        entries.push({ index, line, suspicious: false, reason: 'ingredient-heading', suggestedDestination: 'ingredients' });
        return;
      }
      const duration = parseDurationMetadataLine(trimmed);
      if (duration) {
        entries.push({
          index, line, suspicious: true, reason: 'duration-metadata',
          suggestedDestination: 'metadata', durationKind: duration.kind, minutes: duration.minutes
        });
        return;
      }
      if (isDurationSectionTitle(trimmed)) {
        entries.push({ index, line, suspicious: true, reason: 'duration-section-heading', suggestedDestination: 'metadata' });
        return;
      }
      if (isPreparationSectionHeading(trimmed)) {
        afterPreparationHeading = true;
        entries.push({ index, line, suspicious: true, reason: 'preparation-section-heading', suggestedDestination: 'steps' });
        return;
      }
      if (afterPreparationHeading) {
        entries.push({ index, line, suspicious: true, reason: 'after-preparation-heading', suggestedDestination: 'steps' });
        return;
      }
      if (isManifestProcedure(trimmed)) {
        entries.push({ index, line, suspicious: true, reason: 'procedural-line', suggestedDestination: 'steps' });
        return;
      }
      entries.push({ index, line, suspicious: false, reason: 'ingredient', suggestedDestination: 'ingredients' });
    });
    return {
      lines: entries,
      suspiciousLines: entries.filter(entry => entry.suspicious),
      cleanLines: entries
        .filter(entry => !entry.suspicious && entry.reason === 'ingredient')
        .map(entry => entry.line),
      hasSuspicious: entries.some(entry => entry.suspicious)
    };
  }

  function numberFromToken(token) {
    const text = String(token || '').trim();
    if (/^\d+\s*\/\s*\d+$/.test(text)) {
      const parts = text.split('/').map(Number);
      return parts[1] ? parts[0] / parts[1] : 0;
    }
    return Number(text.replace(',', '.')) || 0;
  }

  function normalizeFractionCharacters(value) {
    return String(value || '')
      .replace(/½/g, '1/2')
      .replace(/¼/g, '1/4')
      .replace(/¾/g, '3/4')
      .replace(/⅓/g, '1/3')
      .replace(/⅔/g, '2/3')
      .replace(/⅛/g, '1/8');
  }

  function canonicalUnit(unit) {
    const text = foldText(unit).replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (text === 'kg' || text === 'g' || text === 'mg' || text === 'l' || text === 'cl' || text === 'ml') return text;
    if (/^c a c$/.test(text)) return 'c. à c.';
    if (/^c a s$/.test(text)) return 'c. à s.';
    if (/^gousse/.test(text)) return 'gousse';
    if (/^boca/.test(text)) return 'bocal';
    if (/^barquette/.test(text)) return 'barquette';
    if (/^tete/.test(text)) return 'tête';
    if (/^botte/.test(text)) return 'botte';
    if (/^pot/.test(text)) return 'pot';
    if (/^bouquet/.test(text)) return 'bouquet';
    if (/^branche/.test(text)) return 'branche';
    if (/^feuille/.test(text)) return 'feuille';
    if (/^filet/.test(text)) return 'filet';
    if (/^pave/.test(text)) return 'pavé';
    if (/^boite/.test(text)) return 'boîte';
    if (/^paquet/.test(text)) return 'paquet';
    if (/^sachet/.test(text)) return 'sachet';
    if (/^bouteille/.test(text)) return 'bouteille';
    if (/^tranche/.test(text)) return 'tranche';
    if (/^(?:piece|unite)/.test(text)) return 'unité';
    return '';
  }

  function removePreparationQualifiers(value) {
    return foldText(value)
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\bfinement\s+hachees?\b/g, ' ')
      .replace(/\b(?:egouttees?|rinces?|hachees?|eminces?|coupes?|pelees?|denoyautees?|rapees?)\b/g, ' ')
      .replace(/\bpour\s+servir\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function genericSingular(value) {
    const aliases = new Map([
      ['oeufs', 'oeuf'], ['oeuf', 'oeuf'],
      ['tomates', 'tomate'], ['tomate', 'tomate'],
      ['courgettes', 'courgette'], ['courgette', 'courgette'],
      ['carottes', 'carotte'], ['carotte', 'carotte'],
      ['oignons', 'oignon'], ['oignon', 'oignon'],
      ['echalotes', 'echalote'], ['echalote', 'echalote'],
      ['poivrons', 'poivron'], ['poivron', 'poivron'],
      ['aubergines', 'aubergine'], ['aubergine', 'aubergine'],
      ['citrons', 'citron'], ['citron', 'citron'],
      ['pommes de terre', 'pomme de terre'], ['pomme de terre', 'pomme de terre'],
      ['filets de poulet', 'filet de poulet'], ['filet de poulet', 'filet de poulet'],
      ['paves de saumon', 'pave de saumon'], ['pave de saumon', 'pave de saumon'],
      ['boites de tomates', 'boite de tomates'], ['boite de tomates', 'boite de tomates'],
      ['paquets de pates', 'paquet de pates'], ['paquet de pates', 'paquet de pates'],
      ['branches de celeri', 'branche de celeri'], ['branche de celeri', 'branche de celeri']
    ]);
    return aliases.get(value) || value;
  }

  function normalizeProduct(value) {
    const original = cleanSpaces(String(value == null ? '' : value)
      .replace(/^[\s,;:·•*–—-]+/, '')
      .replace(/^(?:de|du|des)\s+/i, '')
      .replace(/^d[’']\s*/i, '')
      .replace(/^(?:un\s+peu|quelques?)\s+(?:de|d[’'])?\s*/i, ''));
    let key = removePreparationQualifiers(original)
      .replace(/\bau\s+vinaigre\b/g, ' ')
      .replace(/\bpetites?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (/\bcapres?\b/.test(key)) return { productKey: 'capre', displayName: 'câpres', normalizedName: key };
    if (/\bcornichons?\b/.test(key)) return { productKey: 'cornichon', displayName: 'cornichons', normalizedName: key };
    if (/\btomates?\s+cerises?\b/.test(key)) return { productKey: 'tomate cerise', displayName: 'tomates cerises', normalizedName: key };
    if (/\btomates?\s+(?:pelees?|concassees?|entieres?)\b/.test(key)) return { productKey: 'tomate', displayName: original || 'tomates pelées', normalizedName: key };
    if (/\byaourts?\s+grecs?\b/.test(key)) return { productKey: 'yaourt grec', displayName: 'yaourt grec', normalizedName: key };
    if (/^(?:gousses?\s+d[' ]?)?ail$/.test(key) || key === 'ail') return { productKey: 'ail', displayName: 'ail', normalizedName: key };
    if (/\bradis\b/.test(key)) return { productKey: 'radis', displayName: 'radis', normalizedName: key };
    if (/\bpommes?\s+de\s+terre\b/.test(key)) return { productKey: 'pomme de terre', displayName: original || 'pommes de terre', normalizedName: key };
    if (/\boeufs?\b/.test(key)) return { productKey: 'oeuf', displayName: 'œufs', normalizedName: key };
    if (/\bcourgettes?\b/.test(key)) return { productKey: 'courgette', displayName: 'courgettes', normalizedName: key };
    if (/\bcitrons?\s+verts?\b/.test(key)) return { productKey: 'citron vert', displayName: 'citron vert', normalizedName: key };
    if (/\bcitrons?\s+jaunes?\b/.test(key)) return { productKey: 'citron jaune', displayName: 'citron jaune', normalizedName: key };
    if (/^citrons?$/.test(key)) return { productKey: 'citron jaune', displayName: 'citron', normalizedName: key };
    if (/\bcremes?\s+liquides?\b/.test(key)) return { productKey: 'creme liquide', displayName: 'crème liquide', normalizedName: key };
    if (/\bcremes?\s+epaisses?\b/.test(key)) return { productKey: 'creme epaisse', displayName: 'crème épaisse', normalizedName: key };
    if (/\bpersil\s+surgele\b/.test(key)) return { productKey: 'persil surgele', displayName: 'persil surgelé', normalizedName: key };
    if (/\bpersil\s+frais\b/.test(key)) return { productKey: 'persil frais', displayName: 'persil frais', normalizedName: key };
    if (/\bthon\s+en\s+boite\b/.test(key)) return { productKey: 'thon en boite', displayName: 'thon en boîte', normalizedName: key };
    if (/\bthon\s+frais\b/.test(key)) return { productKey: 'thon frais', displayName: 'thon frais', normalizedName: key };
    if (/\bpate\s+brisee\b/.test(key)) return { productKey: 'pate brisee', displayName: 'pâte brisée', normalizedName: key };
    if (/\bpate\s+feuilletee\b/.test(key)) return { productKey: 'pate feuilletee', displayName: 'pâte feuilletée', normalizedName: key };
    if (/^panko$/.test(key) || /\bchapelure\s+panko\b/.test(key)) return { productKey: 'chapelure panko', displayName: 'chapelure panko', normalizedName: key };
    if (/\bhuile\s+d[' ]olive\b/.test(key)) return { productKey: 'huile d olive', displayName: 'huile d’olive', normalizedName: key };
    if (/\bhuile\s+de\s+tournesol\b/.test(key)) return { productKey: 'huile de tournesol', displayName: 'huile de tournesol', normalizedName: key };

    key = genericSingular(key);
    return {
      productKey: key,
      displayName: original || key,
      normalizedName: key
    };
  }

  function expandAlternative(primary, alternative) {
    const folded = foldText(alternative);
    if (folded === 'panko') return 'chapelure panko';
    if (!folded.includes(' ')) {
      const base = foldText(primary).split(' ')[0];
      if (['creme', 'persil', 'chapelure'].includes(base)) return `${base} ${alternative}`;
    }
    return alternative;
  }

  function splitProductChoices(productText) {
    const parts = cleanSpaces(productText).split(/\s+ou\s+/i).filter(Boolean);
    if (parts.length < 2) return [productText];
    return parts.map((part, index) => index ? expandAlternative(parts[0], part) : part);
  }

  function parseIngredientLine(line, sourceData) {
    const rawText = cleanSpaces(String(line == null ? '' : line).replace(/^[\s•·*–—-]+/, ''));
    if (!rawText || isIngredientHeading(rawText)) return null;
    const normalizedLine = normalizeKitchenUnits(normalizeFractionCharacters(rawText));
    const quantityMatch = normalizedLine.match(/^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*(.*)$/);
    let exactQuantity = null;
    let exactUnit = '';
    let productText = normalizedLine;
    if (quantityMatch) {
      exactQuantity = numberFromToken(quantityMatch[1]);
      let rest = cleanSpaces(quantityMatch[2]);
      const protectedProduct = /^filets?\s+mignons?\b/i.test(rest);
      const unitMatch = protectedProduct ? null : rest.match(/^(?:(?:petit|petite|grand|grande)\s+)?(kg|mg|g|cl|ml|l|c\.\s*à\s*c\.|c\.\s*à\s*s\.|gousses?|bocaux?|bocals?|barquettes?|têtes?|tetes?|bottes?|pots?|bouquets?|branches?|feuilles?|filets?|pavés?|paves?|boîtes?|boites?|paquets?|sachets?|bouteilles?|tranches?|pièces?|pieces?|unités?|unites?)(?=\s|$)\s*(.*)$/i);
      if (unitMatch) {
        exactUnit = canonicalUnit(unitMatch[1]);
        productText = cleanSpaces(unitMatch[2]).replace(/^(?:de|du|des)\s+/i, '').replace(/^d[’']\s*/i, '');
      } else {
        exactUnit = 'unité';
        productText = rest;
      }
    }
    const choices = splitProductChoices(productText).map(normalizeProduct).filter(item => item.productKey);
    const product = choices[0] || normalizeProduct(productText);
    if (!product.productKey) return null;
    const source = {
      recipeId: sourceData && sourceData.recipeId ? String(sourceData.recipeId) : '',
      recipeTitle: sourceData && sourceData.recipeTitle ? String(sourceData.recipeTitle) : '',
      rawText: rawText
    };
    return {
      productKey: product.productKey,
      displayName: product.displayName,
      exactQuantity,
      exactUnit,
      rawText,
      sources: [source],
      choices: choices.length > 1
        ? choices.map(choice => ({ productKey: choice.productKey, displayName: choice.displayName }))
        : []
    };
  }

  function toBaseQuantity(quantity, unit) {
    if (quantity == null || !Number.isFinite(Number(quantity))) return { quantity: null, unit: '', family: 'unspecified' };
    const value = Number(quantity);
    if (unit === 'kg') return { quantity: value * 1000, unit: 'g', family: 'mass' };
    if (unit === 'mg') return { quantity: value / 1000, unit: 'g', family: 'mass' };
    if (unit === 'g') return { quantity: value, unit: 'g', family: 'mass' };
    if (unit === 'l') return { quantity: value * 1000, unit: 'ml', family: 'volume' };
    if (unit === 'cl') return { quantity: value * 10, unit: 'ml', family: 'volume' };
    if (unit === 'ml') return { quantity: value, unit: 'ml', family: 'volume' };
    return { quantity: value, unit: unit || 'unité', family: unit || 'unité' };
  }

  function roundQuantity(value) {
    if (value == null) return null;
    return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
  }

  function choosePreciseDisplay(current, candidate) {
    if (!current) return candidate || '';
    if (!candidate) return current;
    const currentFolded = foldText(current);
    const candidateFolded = foldText(candidate);
    if (candidateFolded.includes(currentFolded) && candidateFolded.length > currentFolded.length) return candidate;
    return current;
  }

  function aisleForProduct(productKey, exactUnit, displayName) {
    const key = foldText(`${productKey || ''} ${displayName || ''}`);
    const unit = canonicalUnit(exactUnit);
    if (unit === 'boîte' || /\b(?:en boite|conserve|tomates? pelees?|tomates? concassees?)\b/.test(key)) return 'Conserves';
    if (/\b(?:poulet|boeuf|porc|veau|agneau|canard|saucisse|steak|viande)\b/.test(key)) return 'Boucherie';
    if (/\b(?:oeuf|oeufs)\b/.test(key)) return 'Crèmerie';
    if (/capre|cornichon|huile|vinaigre|farine|sucre|epice|paprika|riz|pates?/.test(key)) return 'Épicerie';
    if (/tomate|ail|radis|pomme de terre|courgette|carotte|celeri|oignon|echalote|poivron|aubergine|citron|persil frais/.test(key)) return 'Fruits et légumes';
    if (/yaourt|creme|beurre|lait|fromage/.test(key)) return 'Produits laitiers';
    if (/poisson|saumon|cabillaud|thon frais|crevette/.test(key)) return 'Poissonnerie';
    return '';
  }

  function formatNumber(value) {
    const rounded = roundQuantity(value);
    if (rounded == null) return '';
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  }

  const UNIT_LABELS = {
    'gousse': ['gousse', 'gousses'],
    'tête': ['tête', 'têtes'],
    'botte': ['botte', 'bottes'],
    'bocal': ['bocal', 'bocaux'],
    'barquette': ['barquette', 'barquettes'],
    'pot': ['pot', 'pots'],
    'bouquet': ['bouquet', 'bouquets'],
    'branche': ['branche', 'branches'],
    'feuille': ['feuille', 'feuilles'],
    'filet': ['filet', 'filets'],
    'pavé': ['pavé', 'pavés'],
    'boîte': ['boîte', 'boîtes'],
    'paquet': ['paquet', 'paquets'],
    'sachet': ['sachet', 'sachets'],
    'bouteille': ['bouteille', 'bouteilles'],
    'tranche': ['tranche', 'tranches']
  };

  function inflectProductName(value, quantity) {
    const source = cleanSpaces(value);
    const folded = foldText(source);
    const singular = Number(quantity) === 1;
    const pairs = [
      ['courgette', 'courgettes'], ['oeuf', 'oeufs'], ['tomate', 'tomates'],
      ['tomate cerise', 'tomates cerises'], ['carotte', 'carottes'],
      ['oignon', 'oignons'], ['echalote', 'echalotes'], ['poivron', 'poivrons'],
      ['aubergine', 'aubergines'], ['citron', 'citrons'], ['radis', 'radis']
    ];
    for (const [one, many] of pairs) {
      if (folded === one || folded === many) {
        const target = singular ? one : many;
        if (target === 'oeuf') return 'œuf';
        if (target === 'oeufs') return 'œufs';
        return target;
      }
    }
    return source;
  }

  function exactPurchaseLabel(item) {
    const quantity = item.exactQuantity;
    const unit = canonicalUnit(item.exactUnit);
    const name = inflectProductName(item.displayName, quantity);
    if (quantity == null) return name;
    const joiner = /^[aeiouhàâäéèêëîïôöùûü]/i.test(name) ? 'd’' : 'de ';
    if (unit === 'g' && quantity >= 1000 && quantity % 1000 === 0) return `${formatNumber(quantity / 1000)} kg ${joiner}${name}`;
    if (unit === 'ml' && quantity >= 1000 && quantity % 1000 === 0) return `${formatNumber(quantity / 1000)} l ${joiner}${name}`;
    if (unit === 'unité') return `${formatNumber(quantity)} ${name}`;
    const labels = UNIT_LABELS[unit];
    if (labels) {
      const unitLabel = Number(quantity) > 1 ? labels[1] : labels[0];
      return `${formatNumber(quantity)} ${unitLabel} ${joiner}${name}`;
    }
    return `${formatNumber(quantity)} ${unit} ${joiner}${name}`;
  }

  const PACKAGING_RULES = {
    capre: {
      units: { g: 60 },
      label: count => count === 1 ? '1 petit bocal de câpres' : `${count} petits bocaux de câpres`
    },
    cornichon: {
      units: { 'unité': 20, g: 370 },
      label: count => count === 1 ? '1 petit bocal de cornichons' : `${count} petits bocaux de cornichons`
    },
    'tomate cerise': {
      units: { g: 250, 'unité': 15 },
      label: count => count === 1 ? '1 barquette de tomates cerises' : `${count} barquettes de tomates cerises`
    },
    ail: {
      units: { gousse: 8 },
      label: count => count === 1 ? '1 tête d’ail' : `${count} têtes d’ail`
    },
    radis: {
      units: { 'unité': 12 },
      label: count => count === 1 ? '1 botte de radis' : `${count} bottes de radis`
    },
    'yaourt grec': {
      units: { g: 125 },
      label: count => count === 1 ? '1 pot de yaourt grec' : `${count} pots de yaourt grec`
    },
    courgette: {
      units: { filet: 1 },
      label: count => count === 1 ? '1 filet de 4/5 courgettes' : `${count} filets de 4/5 courgettes`
    }
  };

  function applyPackaging(item) {
    const result = { ...item, anomalies: Array.isArray(item.anomalies) ? [...item.anomalies] : [] };
    const rule = PACKAGING_RULES[result.productKey];
    const capacity = rule && rule.units[result.exactUnit];
    if (capacity && Number(result.exactQuantity) > 0) {
      const packages = Math.max(1, Math.ceil((Number(result.exactQuantity) - 1e-9) / capacity));
      result.purchaseLabel = rule.label(packages);
      result.packaging = { count: packages, capacity, capacityUnit: result.exactUnit };
      return result;
    }
    result.purchaseLabel = exactPurchaseLabel(result);
    return result;
  }

  function isReserveProduct(item, reserveProducts) {
    const configured = Array.isArray(reserveProducts) ? reserveProducts : DEFAULT_RESERVE_PRODUCTS;
    const keys = new Set(configured.map(value => normalizeProduct(value).productKey || foldText(value)));
    if (keys.has(item.productKey)) return true;
    const productWords = new Set(foldText(item.productKey).split(/\s+(?:et|ou)\s+/).map(value => normalizeProduct(value).productKey));
    if (productWords.size > 1 && [...productWords].every(key => keys.has(key))) return true;
    if ((item.exactUnit === 'c. à c.' || item.exactUnit === 'c. à s.') && /\b(?:seche|moulu|poudre|epice)\b/.test(foldText(item.displayName))) return true;
    if (item.exactUnit === 'bouquet' && /\bfrais\b/.test(foldText(item.displayName))) return false;
    return false;
  }

  function inputBlocks(entries) {
    if (typeof entries === 'string') return [{ line: entries }];
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => typeof entry === 'string' ? { line: entry } : (entry || {}));
  }

  function collectIngredientCandidates(entries) {
    const candidates = [];
    const audit = [];
    inputBlocks(entries).forEach(block => {
      const text = block.line != null ? block.line : (block.text != null ? block.text : block.rawText);
      if (text == null) return;
      const report = auditIngredientLines(text);
      report.suspiciousLines.forEach(item => audit.push({
        ...item,
        recipeId: block.recipeId || '',
        recipeTitle: block.recipeTitle || ''
      }));
      report.cleanLines.forEach(line => {
        const parsed = parseIngredientLine(line, block);
        if (parsed) candidates.push(parsed);
      });
    });
    return { candidates, audit };
  }

  function consolidateIngredientSet(entries, options) {
    const opts = options || {};
    const collected = collectIngredientCandidates(entries);
    const groups = new Map();
    collected.candidates.forEach(candidate => {
      const base = toBaseQuantity(candidate.exactQuantity, candidate.exactUnit);
      const groupKey = `${candidate.productKey}\u0000${base.family}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          productKey: candidate.productKey,
          displayName: candidate.displayName,
          exactQuantity: base.quantity,
          exactUnit: base.unit,
          aisle: aisleForProduct(candidate.productKey, base.unit, candidate.displayName),
          sources: [],
          choices: [],
          anomalies: []
        };
        groups.set(groupKey, group);
      } else if (base.quantity != null) {
        group.exactQuantity = (group.exactQuantity == null ? 0 : group.exactQuantity) + base.quantity;
      }
      group.displayName = choosePreciseDisplay(group.displayName, candidate.displayName);
      group.sources.push(...candidate.sources);
      candidate.choices.forEach(choice => {
        if (!group.choices.some(existing => existing.productKey === choice.productKey)) group.choices.push(choice);
      });
    });

    const groupsByProduct = new Map();
    groups.forEach(group => {
      if (!groupsByProduct.has(group.productKey)) groupsByProduct.set(group.productKey, []);
      groupsByProduct.get(group.productKey).push(group);
    });
    groupsByProduct.forEach(productGroups => {
      if (productGroups.length < 2) return;
      const units = productGroups.map(group => group.exactUnit || 'sans unité').join(', ');
      productGroups.forEach(group => group.anomalies.push({
        code: 'incompatible-units',
        message: `Quantités incompatibles à vérifier : ${units}`
      }));
    });

    const items = [...groups.values()].map(group => {
      group.exactQuantity = roundQuantity(group.exactQuantity);
      const packaged = applyPackaging(group);
      packaged.isReserve = isReserveProduct(packaged, opts.reserveProducts);
      return packaged;
    }).sort((left, right) =>
      String(left.displayName).localeCompare(String(right.displayName), 'fr') ||
      String(left.exactUnit).localeCompare(String(right.exactUnit), 'fr')
    );
    return { items, audit: collected.audit };
  }

  function consolidateIngredients(entries, options) {
    return consolidateIngredientSet(entries, options).items;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function sha256(value) {
    const ascii = unescape(encodeURIComponent(String(value)));
    const words = [];
    const bitLength = ascii.length * 8;
    for (let index = 0; index < ascii.length; index += 1) {
      words[index >> 2] |= ascii.charCodeAt(index) << (24 - (index % 4) * 8);
    }
    words[bitLength >> 5] |= 0x80 << (24 - bitLength % 32);
    words[((bitLength + 64 >> 9) << 4) + 15] = bitLength;
    const constants = [];
    const initial = [];
    let candidate = 2;
    while (constants.length < 64) {
      let prime = true;
      for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
        if (candidate % divisor === 0) { prime = false; break; }
      }
      if (prime) {
        if (initial.length < 8) initial.push((Math.pow(candidate, 0.5) * 0x100000000) | 0);
        constants.push((Math.pow(candidate, 1 / 3) * 0x100000000) | 0);
      }
      candidate += 1;
    }
    const hash = initial.slice();
    for (let offset = 0; offset < words.length; offset += 16) {
      const schedule = new Array(64);
      for (let index = 0; index < 64; index += 1) {
        if (index < 16) schedule[index] = words[offset + index] | 0;
        else {
          const x = schedule[index - 15];
          const y = schedule[index - 2];
          const sigma0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          const sigma1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) | 0;
        }
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choice + constants[index] + schedule[index]) | 0;
        const sum0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }
    return hash.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function normalizedFingerprintItems(items) {
    return (Array.isArray(items) ? items : []).map(item => ({
      productKey: String(item.productKey || ''),
      displayName: String(item.displayName || ''),
      exactQuantity: item.exactQuantity == null ? null : roundQuantity(item.exactQuantity),
      exactUnit: String(item.exactUnit || ''),
      purchaseLabel: String(item.purchaseLabel || ''),
      aisle: String(item.aisle || ''),
      selected: item.selected !== false,
      isReserve: Boolean(item.isReserve),
      choices: Array.isArray(item.choices)
        ? item.choices.map(choice => ({ productKey: choice.productKey || '', displayName: choice.displayName || '' }))
          .sort((a, b) => a.productKey.localeCompare(b.productKey))
        : []
    })).sort((left, right) =>
      left.productKey.localeCompare(right.productKey) ||
      left.exactUnit.localeCompare(right.exactUnit) ||
      left.purchaseLabel.localeCompare(right.purchaseLabel)
    );
  }

  function fingerprintContractContent(contract) {
    const content = {
      schemaVersion: SCHEMA_VERSION,
      sourceType: contract.sourceType,
      sourceKey: contract.sourceKey,
      items: normalizedFingerprintItems(contract.items)
    };
    return `sha256:${sha256(stableStringify(content))}`;
  }

  function defaultImportId(now) {
    const timestamp = new Date(now || Date.now()).getTime().toString(36);
    const random = Math.random().toString(36).slice(2, 12);
    return `mc-${timestamp}-${random}`;
  }

  function buildTransferContract(input, environment) {
    const data = input || {};
    const env = environment || {};
    if (!['recipe', 'planner', 'menu'].includes(data.sourceType)) throw new Error('sourceType invalide');
    if (!data.sourceKey) throw new Error('sourceKey obligatoire');
    const sentAt = data.sentAt || env.sentAt || new Date(env.now || Date.now()).toISOString();
    const importId = data.importId || env.importId || (typeof env.idFactory === 'function' ? env.idFactory() : defaultImportId(env.now));
    const contract = {
      schemaVersion: SCHEMA_VERSION,
      importId,
      sourceType: data.sourceType,
      sourceKey: String(data.sourceKey),
      sourceLabel: String(data.sourceLabel || ''),
      sentAt,
      items: (Array.isArray(data.items) ? data.items : []).map(item => ({
        productKey: String(item.productKey || ''),
        displayName: String(item.displayName || ''),
        exactQuantity: item.exactQuantity == null ? null : roundQuantity(item.exactQuantity),
        exactUnit: String(item.exactUnit || ''),
        purchaseLabel: String(item.purchaseLabel || ''),
        aisle: String(item.aisle || ''),
        selected: item.selected !== false,
        isReserve: Boolean(item.isReserve),
        exactNeeds: Array.isArray(item.exactNeeds) ? item.exactNeeds.map(need => ({ ...need })) : [],
        sources: Array.isArray(item.sources) ? item.sources.map(source => ({ ...source })) : [],
        choices: Array.isArray(item.choices) ? item.choices.map(choice => ({ ...choice })) : [],
        anomalies: Array.isArray(item.anomalies) ? item.anomalies.map(anomaly => ({ ...anomaly })) : []
      }))
    };
    contract.contentFingerprint = fingerprintContractContent(contract);
    return contract;
  }

  function legacyTextFromContract(contract) {
    return (contract.items || []).map(item => item.purchaseLabel || exactPurchaseLabel(item)).filter(Boolean).join('\n');
  }

  function buildTransportDescriptor(contract, options) {
    const opts = options || {};
    const token = String(opts.token || contract.importId);
    if (!token) throw new Error('Jeton de transport obligatoire');
    const configured = String(opts.baseUrl || 'https://ferdinand373.github.io/clair-courses/')
      .replace(/[?#].*$/, '')
      .replace(/(?:index\.html|import\.html)$/i, '')
      .replace(/\/?$/, '/');
    const importPage = `${configured}import.html`;
    const json = JSON.stringify(contract);
    const createdAt = Number(opts.now) || Date.now();
    const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : 30 * 60 * 1000;
    const storageEnvelope = {
      createdAt,
      expiresAt: createdAt + ttlMs,
      payload: contract
    };
    const legacyText = opts.legacyText == null ? legacyTextFromContract(contract) : String(opts.legacyText);
    return {
      token,
      storageKey: `${TRANSPORT_KEY_PREFIX}${token}`,
      storageValue: JSON.stringify(storageEnvelope),
      primaryUrl: `${importPage}?transfer=${encodeURIComponent(token)}`,
      jsonFallbackUrl: `${importPage}#mcjson=${encodeURIComponent(json)}`,
      legacyUrl: `${importPage}#mc=${encodeURIComponent(legacyText)}`
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    TRANSPORT_KEY_PREFIX,
    DEFAULT_RESERVE_PRODUCTS: Object.freeze([...DEFAULT_RESERVE_PRODUCTS]),
    PACKAGING_RULES,
    foldText,
    normalizeKitchenUnits,
    formatDuration,
    parseDurationValue,
    parseDurationMetadataLine,
    parseDurationMetadata,
    auditIngredientLines,
    isIngredientHeading,
    isManifestProcedure,
    normalizeProduct,
    parseIngredientLine,
    applyPackaging,
    isReserveProduct,
    collectIngredientCandidates,
    consolidateIngredientSet,
    consolidateIngredients,
    stableStringify,
    sha256,
    fingerprintContractContent,
    buildTransferContract,
    legacyTextFromContract,
    buildTransportDescriptor
  });
});
