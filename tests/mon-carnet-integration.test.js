'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SERVICE_WORKER_PATH = path.join(ROOT, 'sw.js');
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
const SERVICE_WORKER = fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');

function assertSource(pattern, source, message) {
  assert.match(source, pattern, message);
}

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (!/\bsrc\s*=/i.test(match[1])) scripts.push(match[2]);
  }
  return scripts;
}

test('IndexedDB conserve son nom, sa version et ses trois stores historiques', () => {
  assertSource(
    /const\s+DB_NAME\s*=\s*['"]mon-carnet-cuisine-v1['"]/,
    INDEX,
    'Le nom de la base utilisée sur les appareils ne doit jamais changer.'
  );
  assertSource(/const\s+DB_VERSION\s*=\s*1\s*;/, INDEX);
  assertSource(/indexedDB\.open\s*\(\s*DB_NAME\s*,\s*DB_VERSION\s*\)/, INDEX);

  const stores = [...INDEX.matchAll(/createObjectStore\s*\(\s*['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .sort();
  assert.deepEqual(stores, ['plans', 'recipes', 'settings']);
  assert.doesNotMatch(INDEX, /deleteObjectStore\s*\(/);
});

test('les menus restent dans settings et traversent export et restauration', () => {
  assertSource(/savedMenus\s*:\s*\[\s*\]/, INDEX, 'Les anciennes sauvegardes doivent obtenir une liste vide.');
  assertSource(
    /put\s*\(\s*['"]settings['"]\s*,\s*\{\s*key\s*:\s*['"]savedMenus['"]\s*,\s*value\s*:\s*settings\.savedMenus\s*\}\s*\)/,
    INDEX,
    'Un menu enregistré doit être persisté dans le store settings.'
  );
  assertSource(
    /const\s+payload\s*=\s*\{[\s\S]{0,400}\brecipes\b[\s\S]{0,200}\bplans\b[\s\S]{0,200}\bsettings\s*:\s*exportedSettings[\s\S]{0,100}\}/,
    INDEX,
    'La sauvegarde doit inclure settings, qui contient savedMenus.'
  );
  assertSource(
    /const\s+restoredSettings\s*=\s*\{[\s\S]{0,350}\.\.\.\s*\(\s*data\.settings\s*\|\|\s*\{\s*\}\s*\)[\s\S]{0,100}\}/,
    INDEX,
    'La restauration doit reprendre les réglages du fichier.'
  );
  assertSource(
    /if\s*\(\s*!Array\.isArray\s*\(\s*restoredSettings\.savedMenus\s*\)\s*\)\s*restoredSettings\.savedMenus\s*=\s*\[\s*\]/,
    INDEX,
    'Une sauvegarde V2.1.5 sans menus doit rester importable.'
  );
  assertSource(
    /Object\.entries\s*\(\s*nextSettings\s*\)[\s\S]{0,160}settingsStore\.put\s*\(/,
    INDEX,
    'Tous les réglages restaurés, menus compris, doivent être réécrits dans IndexedDB.'
  );
});

test('fixture synthétique de 105 recettes : photos et favoris survivent au JSON de sauvegarde', () => {
  // Cette fixture vérifie le format de sauvegarde sans prétendre remplacer une
  // sauvegarde réelle de l'appareil, qui n'est pas présente dans le dépôt.
  const recipes = Array.from({ length: 105 }, (_, index) => ({
    id: `recipe-${String(index + 1).padStart(3, '0')}`,
    title: `Recette ${index + 1}`,
    photo: index % 3 === 0
      ? `data:image/jpeg;base64,PHOTO_SYNTHETIQUE_${String(index + 1).padStart(3, '0')}`
      : '',
    favorite: index % 4 === 0,
    ingredients: [`${index + 1} g d'ingrédient`],
    steps: ['Préparer sans modifier la photo ni le favori.']
  }));
  const payload = {
    app: 'Mon carnet de cuisine',
    version: '2.1.6-test',
    recipes,
    plans: [{ id: '2026-07-29-lunch', recipeId: 'recipe-001', persons: 3 }],
    settings: {
      savedMenus: [{
        id: 'menu-1',
        name: 'Menu synthétique',
        recipeIds: ['recipe-001', 'recipe-002']
      }]
    }
  };

  const restored = JSON.parse(JSON.stringify(payload));
  assert.equal(restored.recipes.length, 105);
  assert.deepEqual(
    restored.recipes.map(recipe => ({
      id: recipe.id,
      photo: recipe.photo,
      favorite: recipe.favorite
    })),
    recipes.map(recipe => ({
      id: recipe.id,
      photo: recipe.photo,
      favorite: recipe.favorite
    }))
  );
  assert.deepEqual(restored.plans, payload.plans);
  assert.deepEqual(restored.settings.savedMenus, payload.settings.savedMenus);

  assertSource(/const\s+payload\s*=\s*\{[\s\S]{0,400}\brecipes\b/, INDEX);
  assertSource(/for\s*\(\s*const\s+recipe\s+of\s+data\.recipes\s*\)\s*recipesStore\.put\s*\(\s*recipe\s*\)/, INDEX);
  assertSource(/photo\s*:\s*currentPhoto/, INDEX);
  assertSource(/favorite\s*:\s*existing\s*\?\s*!!existing\.favorite\s*:\s*false/, INDEX);
});

test('le service worker ne fait que du cache et ne réécrit jamais le HTML', () => {
  const eventTypes = [...SERVICE_WORKER.matchAll(/self\.addEventListener\s*\(\s*['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .sort();
  assert.deepEqual(eventTypes, ['activate', 'fetch', 'install']);
  assertSource(/\bcaches\.open\s*\(/, SERVICE_WORKER);
  assertSource(/\bcaches\.match\s*\(/, SERVICE_WORKER);
  assertSource(/\bcache\.put\s*\(/, SERVICE_WORKER);

  const forbidden = [
    [/\bhtml\s*\.replace\s*\(/i, 'html.replace'],
    [/replace\s*\(\s*['"`][^'"`]*<\/body>/i, 'injection avant </body>'],
    [/\bresponse\s*\.text\s*\(/i, 'lecture du HTML en texte'],
    [/\bnew\s+Response\s*\(/i, 'fabrication d’une réponse HTML'],
    [/\bDOMParser\b/i, 'analyse/réécriture du DOM'],
    [/\binnerHTML\b/i, 'injection HTML']
  ];
  forbidden.forEach(([pattern, label]) => {
    assert.doesNotMatch(SERVICE_WORKER, pattern, `Le service worker contient une opération interdite : ${label}.`);
  });
});

test('Menus, Favoris et Demander à Chat ont chacun un accès visible et raccordé', () => {
  assertSource(/id=["']openFavoritesBtn["'][^>]*>\s*Mes favoris\s*</, INDEX);
  assertSource(/id=["']view-menus["'][^>]*data-view=["']menus["']/, INDEX);
  assertSource(/data-go=["']menus["'][^>]*>\s*Mes menus\s*</, INDEX);
  assertSource(/id=["']askChatBtn["'][^>]*>[\s\S]{0,60}Demander à Chat\s*</, INDEX);

  assertSource(
    /\$\(\s*['"]#openFavoritesBtn['"]\s*\)\.addEventListener\s*\(\s*['"]click['"]/,
    INDEX
  );
  assertSource(
    /\$\(\s*['"]#askChatBtn['"]\s*\)\.addEventListener\s*\(\s*['"]click['"]/,
    INDEX
  );
  assertSource(/function\s+saveMenu\s*\(/, INDEX);
  assertSource(/function\s+renderMenus\s*\(/, INDEX);
});

test('la liste réellement envoyée utilise le cœur testé et conserve les quantités absentes', () => {
  assertSource(
    /function\s+buildClairReviewRowsFromPlans\s*\([^)]*\)[\s\S]{0,900}MonCarnetCore[\s\S]{0,1200}consolidateIngredientSet\s*\(/,
    INDEX,
    'Le moteur testé doit être celui utilisé pour construire la liste visible.'
  );
  assertSource(
    /item\.exactQuantity\s*!==\s*null[\s\S]{0,160}item\.exactQuantity\s*!==\s*undefined[\s\S]{0,160}item\.exactQuantity\s*!==\s*['"]{2}/,
    INDEX,
    'Une quantité absente ne doit jamais devenir zéro dans le contrat.'
  );
  assertSource(/monCarnet\.clairCourses\.transfer\.v1:/, INDEX);
  assertSource(/contentFingerprint/, INDEX);
});

test('le code JavaScript inline de index.html est syntaxiquement valide', () => {
  const scripts = inlineScripts(INDEX);
  assert.ok(scripts.length > 0, 'Aucun script inline trouvé dans index.html.');
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `index.inline-${index + 1}.js` }),
      `Le script inline n°${index + 1} doit être valide.`
    );
  });
});

test('la restauration est atomique et les transferts temporaires expirent', () => {
  assert.match(INDEX, /db\.transaction\(\['recipes', 'plans', 'settings'\], 'readwrite'\)/);
  assert.match(INDEX, /replaceBackupStoresAtomically/);
  assert.doesNotMatch(INDEX, /await clearStore\('recipes'\); await clearStore\('plans'\); await clearStore\('settings'\);\s*for \(const r of data\.recipes\)/);
  assert.match(INDEX, /expiresAt:\s*now \+ 30 \* 60 \* 1000/);
  assert.match(INDEX, /stored\?\.expiresAt/);
});

test('le lien vers Clair Courses contient un secours JSON et nettoie les anciens transferts', () => {
  assert.match(INDEX, /target\.searchParams\.set\('transfer', token\);[\s\S]{0,220}target\.hash = `mcjson=/);
  assert.match(INDEX, /const\s+isRawContract\s*=\s*!!\(stored[\s\S]{0,180}stored\.schemaVersion[\s\S]{0,100}stored\.importId/);
  assert.match(INDEX, /now - sentAt > 30 \* 60 \* 1000/);
});

