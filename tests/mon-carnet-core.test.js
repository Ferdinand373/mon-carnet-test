'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../mon-carnet-core.js');

test('normalise toutes les variantes de cuillères sans modifier le sens', () => {
  const source = [
    '1 cac de persil',
    '1 càc de paprika',
    '1 c à c de cumin',
    '1 c.à.c. de curry',
    '1 cuillère à café de sel',
    '2 cas d’huile',
    '2 càs de vinaigre',
    '2 c à s de sauce soja',
    '2 c.à.s. de mirin',
    '2 cuillères à soupe de crème'
  ].join('\n');
  const normalized = Core.normalizeKitchenUnits(source);
  assert.equal((normalized.match(/c\. à c\./g) || []).length, 5);
  assert.equal((normalized.match(/c\. à s\./g) || []).length, 5);
});

test('affiche les durées enregistrées en minutes sous une forme naturelle', () => {
  assert.equal(Core.formatDuration(10), '10 min');
  assert.equal(Core.formatDuration(60), '1 h');
  assert.equal(Core.formatDuration(65), '1 h 05');
  assert.equal(Core.formatDuration(95), '1 h 35');
  assert.equal(Core.formatDuration(125), '2 h 05');
});

test('parse strictement les métadonnées de durée et conserve les consignes', () => {
  const source = `Temps
Préparation : 15 min
Cuisson – 1 h 10
Total : 1 h 25

Ingrédients
1 poulet
20 cl de crème
2 minces tranches de jambon

Préparation
Cuire le poulet pendant 1 h 10.`;
  const parsed = Core.parseDurationMetadata(source);
  assert.equal(parsed.prepDuration, 15);
  assert.equal(parsed.cookDuration, 70);
  assert.equal(parsed.duration, 85);
  assert.equal(parsed.metadataLines.length, 3);
  assert.ok(parsed.cleanedText.includes('20 cl de crème'));
  assert.ok(parsed.cleanedText.includes('2 minces tranches de jambon'));
  assert.ok(parsed.cleanedText.includes('Cuire le poulet pendant 1 h 10.'));
  assert.equal(Core.parseDurationMetadataLine('20 cl de crème'), null);
  assert.equal(Core.parseDurationMetadataLine('Cuire pendant 20 minutes.'), null);
});

test('accepte toutes les variantes documentées de métadonnées', () => {
  const variants = [
    ['Préparation 15 min', 'prepDuration', 15],
    ['Temps de préparation - 15 min', 'prepDuration', 15],
    ['Durée de préparation — 15 minutes', 'prepDuration', 15],
    ['Cuisson : 40 min', 'cookDuration', 40],
    ['Temps de cuisson 30 mn', 'cookDuration', 30],
    ['Marinade : 2 h', 'marinadeDuration', 120],
    ['Durée de marinade – 1 h 30', 'marinadeDuration', 90],
    ['Temps total : 1 h 25', 'duration', 85],
    ['Durée de la recette 2 h 05', 'duration', 125]
  ];
  variants.forEach(([line, key, expected]) => {
    const parsed = Core.parseDurationMetadata(line);
    assert.equal(parsed[key], expected, line);
  });
});

test('audit sans corriger automatiquement les lignes suspectes', () => {
  const report = Core.auditIngredientLines(`1 poulet
Préparation : 15 min
Préparation des frites
Éplucher et laver les pommes de terre.
Les déposer dans le panier et faire cuire 20 minutes à 190 °C.`);
  assert.equal(report.cleanLines.length, 1);
  assert.equal(report.cleanLines[0], '1 poulet');
  assert.deepEqual(
    report.suspiciousLines.map(item => item.reason),
    ['duration-metadata', 'preparation-section-heading', 'after-preparation-heading', 'after-preparation-heading']
  );
  assert.ok(report.suspiciousLines.every(item => ['metadata', 'steps'].includes(item.suggestedDestination)));
  assert.equal(Core.isManifestProcedure('Les rincer à l’eau froide.'), true);
  assert.equal(Core.isManifestProcedure('Les déposer dans le panier et cuire 20 minutes.'), true);
});

test('normalise les produits sans confondre les variantes achetées', () => {
  assert.equal(Core.normalizeProduct('petites câpres égouttées').productKey, 'capre');
  assert.equal(Core.normalizeProduct('câpres rincées au vinaigre').productKey, 'capre');
  assert.equal(Core.normalizeProduct('œufs').productKey, 'oeuf');
  assert.equal(Core.normalizeProduct('pommes de terre').productKey, 'pomme de terre');
  assert.equal(Core.normalizeProduct('citron').productKey, 'citron jaune');
  assert.equal(Core.normalizeProduct('citron vert').productKey, 'citron vert');
  assert.notEqual(Core.normalizeProduct('crème liquide').productKey, Core.normalizeProduct('crème épaisse').productKey);
  assert.notEqual(Core.normalizeProduct('persil frais').productKey, Core.normalizeProduct('persil surgelé').productKey);
  assert.notEqual(Core.normalizeProduct('pâte brisée').productKey, Core.normalizeProduct('pâte feuilletée').productKey);
});

test('TEST A — 15 g de câpres restent exacts et deviennent un petit bocal', () => {
  const original = '15 g de câpres égouttées';
  const [item] = Core.consolidateIngredients([{ line: original, recipeId: 'r1', recipeTitle: 'Sauce tartare' }]);
  assert.equal(original, '15 g de câpres égouttées');
  assert.equal(item.productKey, 'capre');
  assert.equal(item.exactQuantity, 15);
  assert.equal(item.exactUnit, 'g');
  assert.equal(item.purchaseLabel, '1 petit bocal de câpres');
  assert.equal(item.sources[0].rawText, original);
});

test('TEST B — deux recettes avec des câpres produisent une seule ligne', () => {
  const items = Core.consolidateIngredients([
    { line: '15 g de câpres', recipeId: 'r1', recipeTitle: 'Recette 1' },
    { line: '20 g de câpres rincées', recipeId: 'r2', recipeTitle: 'Recette 2' }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].exactQuantity, 35);
  assert.equal(items[0].exactUnit, 'g');
  assert.equal(items[0].purchaseLabel, '1 petit bocal de câpres');
  assert.equal(items[0].sources.length, 2);
});

test('additionne seulement les unités compatibles', () => {
  const potatoes = Core.consolidateIngredients([
    { line: '200 g de pommes de terre', recipeId: 'r1' },
    { line: '300 g de pommes de terre', recipeId: 'r2' }
  ]);
  assert.equal(potatoes.length, 1);
  assert.equal(potatoes[0].exactQuantity, 500);
  assert.equal(potatoes[0].exactUnit, 'g');

  const tomatoes = Core.consolidateIngredients(['2 tomates', '300 g de tomates']);
  assert.equal(tomatoes.length, 2);
  assert.ok(tomatoes.every(item => item.anomalies.some(anomaly => anomaly.code === 'incompatible-units')));
  assert.ok(tomatoes.every(item => !item.purchaseLabel.includes('+')));
});

test('applique les conditionnements centralisés après consolidation', () => {
  const fixtures = [
    ['5 cornichons', '1 petit bocal de cornichons'],
    ['250 g de tomates cerises', '1 barquette de tomates cerises'],
    ["2 gousses d'ail", '1 tête d’ail'],
    ['8 radis', '1 botte de radis'],
    ['100 g de yaourt grec', '1 pot de yaourt grec']
  ];
  fixtures.forEach(([line, purchaseLabel]) => {
    const [item] = Core.consolidateIngredients([line]);
    assert.equal(item.purchaseLabel, purchaseLabel, line);
  });
});

test('les produits de réserve restent visibles et sont signalés', () => {
  const items = Core.consolidateIngredients([
    '1 c. à c. de paprika',
    '1 c. à s. d’huile d’olive',
    'Sel et poivre',
    '1 bouquet de persil frais',
    '2 courgettes'
  ]);
  const byKey = Object.fromEntries(items.map(item => [item.productKey, item]));
  assert.equal(byKey.paprika.isReserve, true);
  assert.equal(byKey['huile d olive'].isReserve, true);
  assert.equal(byKey['sel et poivre'].isReserve, true);
  assert.equal(byKey['persil frais'].isReserve, false);
  assert.equal(byKey.courgette.isReserve, false);
  assert.equal(byKey['huile d olive'].purchaseLabel, '1 c. à s. d’huile d’olive');
});

test('conserve le libellé d’achat le plus précis', () => {
  const [item] = Core.consolidateIngredients([
    '500 g de pommes de terre grenaille',
    '500 g de pommes de terre'
  ]);
  assert.equal(item.productKey, 'pomme de terre');
  assert.equal(item.exactQuantity, 1000);
  assert.equal(item.purchaseLabel, '1 kg de pommes de terre grenaille');
});

test('aucune phrase de préparation ne rejoint la consolidation', () => {
  const result = Core.consolidateIngredientSet([{
    recipeId: 'r1',
    recipeTitle: 'Frites',
    line: `600 g de pommes de terre
1 c. à s. d’huile
Préparation des frites
Éplucher et laver les pommes de terre, puis les couper.
Les rincer à l’eau froide pour retirer l’excès d’amidon.
Les déposer dans le panier et faire cuire 20 minutes.
Lorsqu’elles sont bien dorées, les retirer.`
  }]);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => !/eplucher|rincer|cuire|dorees/i.test(item.purchaseLabel)));
  assert.equal(result.audit.length, 5);
});

test('conserve un choix de produit structuré', () => {
  const [item] = Core.consolidateIngredients(['75 g de yaourt grec ou mayonnaise']);
  assert.equal(item.productKey, 'yaourt grec');
  assert.deepEqual(item.choices.map(choice => choice.productKey), ['yaourt grec', 'mayonnaise']);
});

test('génère un contrat v1 dont l’empreinte ne dépend ni de l’ordre ni de l’envoi', () => {
  assert.equal(Core.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const items = Core.consolidateIngredients(['300 g de pommes de terre', '2 courgettes']);
  const first = Core.buildTransferContract({
    importId: 'import-a',
    sourceType: 'planner',
    sourceKey: 'planner:2026-07-29:2026-07-30:abc',
    sourceLabel: 'Repas des 29 et 30 juillet',
    sentAt: '2026-07-29T10:00:00.000Z',
    items
  });
  const second = Core.buildTransferContract({
    importId: 'import-b',
    sourceType: 'planner',
    sourceKey: first.sourceKey,
    sourceLabel: first.sourceLabel,
    sentAt: '2026-07-29T11:00:00.000Z',
    items: [...items].reverse()
  });
  assert.equal(first.schemaVersion, 1);
  assert.notEqual(first.importId, second.importId);
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.match(first.contentFingerprint, /^sha256:[0-9a-f]{64}$/);
  const withDifferentSelection = Core.buildTransferContract({
    importId: 'import-c',
    sourceType: 'planner',
    sourceKey: first.sourceKey,
    sourceLabel: first.sourceLabel,
    sentAt: '2026-07-29T12:00:00.000Z',
    items: items.map((item, index) => ({ ...item, selected: index !== 0 }))
  });
  assert.notEqual(first.contentFingerprint, withDifferentSelection.contentFingerprint);
});

test('utilise exactement la convention de transport convenue', () => {
  const contract = Core.buildTransferContract({
    importId: 'abc-123',
    sourceType: 'recipe',
    sourceKey: 'recipe:r1:3',
    sourceLabel: 'Magret pour 3 personnes',
    sentAt: '2026-07-29T10:00:00.000Z',
    items: Core.consolidateIngredients(['2 magrets de canard'])
  });
  const descriptor = Core.buildTransportDescriptor(contract, {
    baseUrl: 'https://ferdinand373.github.io/clair-courses/'
  });
  assert.equal(Core.TRANSPORT_KEY_PREFIX, 'monCarnet.clairCourses.transfer.v1:');
  assert.equal(descriptor.storageKey, 'monCarnet.clairCourses.transfer.v1:abc-123');
  assert.equal(descriptor.primaryUrl, 'https://ferdinand373.github.io/clair-courses/import.html?transfer=abc-123');
  assert.ok(descriptor.jsonFallbackUrl.startsWith('https://ferdinand373.github.io/clair-courses/import.html#mcjson='));
  assert.ok(descriptor.legacyUrl.startsWith('https://ferdinand373.github.io/clair-courses/import.html#mc='));
  const stored = JSON.parse(descriptor.storageValue);
  assert.deepEqual(stored.payload, contract);
  assert.ok(stored.expiresAt > stored.createdAt);
  assert.equal(stored.expiresAt - stored.createdAt, 30 * 60 * 1000);
});

test('corrige les conditionnements, pluriels et rayons relevés par audit', () => {
  const [courgettes] = Core.consolidateIngredients(['1 filet de courgettes']);
  assert.equal(courgettes.productKey, 'courgette');
  assert.equal(courgettes.exactUnit, 'filet');
  assert.equal(courgettes.purchaseLabel, '1 filet de 4/5 courgettes');

  const fixtures = [
    [['1 filet de poulet', '2 filets de poulet'], '3 filets de poulet', 'Boucherie'],
    [['1 pavé de saumon', '2 pavés de saumon'], '3 pavés de saumon', 'Poissonnerie'],
    [['1 boîte de tomates pelées', '2 boîtes de tomates pelées'], '3 boîtes de tomates pelées', 'Conserves'],
    [['1 paquet de pâtes', '2 paquets de pâtes'], '3 paquets de pâtes', 'Épicerie'],
    [['1 branche de céleri', '2 branches de céleri'], '3 branches de céleri', 'Fruits et légumes']
  ];
  fixtures.forEach(([lines, expected, aisle]) => {
    const items = Core.consolidateIngredients(lines);
    assert.equal(items.length, 1, lines.join(' + '));
    assert.equal(items[0].purchaseLabel, expected, lines.join(' + '));
    assert.equal(items[0].aisle, aisle, lines.join(' + '));
  });

  assert.equal(Core.consolidateIngredients(['1 œuf'])[0].purchaseLabel, '1 œuf');
  assert.equal(Core.consolidateIngredients(['2 œufs'])[0].purchaseLabel, '2 œufs');
  assert.equal(Core.consolidateIngredients(['2 œufs'])[0].aisle, 'Crèmerie');
  assert.equal(Core.consolidateIngredients(['500 g de bœuf'])[0].aisle, 'Boucherie');
});
