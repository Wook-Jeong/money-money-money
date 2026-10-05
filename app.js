'use strict';

const REMOTE_DATA_URLS = [
  'https://smok95.github.io/lotto/results/all.json',
  'https://papaya5rhw1984.github.io/lotto-data/all.json'
];

const STORAGE_KEYS = {
  DATA: 'mmm_lotto_data_v1',
  RESULTS: 'mmm_last_results_v1'
};

const METHOD_ORDER = ['hot', 'hotCold', 'recent100', 'balanced', 'random'];
const METHOD_LABELS = {
  hot: 'Hot',
  hotCold: 'Hot + Cold',
  recent100: 'Recent 100',
  balanced: 'Balanced',
  random: 'Random'
};

const HOT_MIN_COUNT = 8;
const COLD_MAX_COUNT = 5;

let lottoData = [];
let currentResults = [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const statusEl = $('#data-status');
const selectedCountEl = $('#selected-count');
const generateButton = $('#generate-button');
const resultListEl = $('#result-list');
const emptyResultEl = $('#empty-result');
const gameTemplate = $('#game-template');
const resetButton = $('#reset-button');

function normalizeData(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => ({
      round: Number(item.draw_no ?? item.round),
      date: item.date ?? item.draw_date ?? '',
      numbers: (item.numbers ?? item.winning_numbers ?? []).map(Number),
      bonus: Number(item.bonus_no ?? item.bonus ?? item.bonus_number ?? 0)
    }))
    .filter((item) =>
      Number.isInteger(item.round) &&
      item.round > 0 &&
      item.numbers.length === 6 &&
      item.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 45)
    )
    .sort((a, b) => a.round - b.round);
}

function trimForStorage(data) {
  // 생성 알고리즘은 최근 100회만 필요합니다. 여유 있게 120회만 저장합니다.
  return data.slice(-120);
}

function loadCachedData() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.DATA) || '[]');
    return normalizeData(raw);
  } catch {
    return [];
  }
}

function saveCachedData(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(trimForStorage(data)));
  } catch {
    // 저장 실패가 앱 사용 자체를 막지 않도록 조용히 무시합니다.
  }
}

async function fetchRemoteData() {
  let lastError = null;

  for (const url of REMOTE_DATA_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const normalized = normalizeData(await response.json());
      if (normalized.length < 100) throw new Error('최근 100회 데이터가 부족합니다.');

      return normalized;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('원격 데이터를 불러오지 못했습니다.');
}

async function initializeData() {
  const cached = loadCachedData();
  if (cached.length >= 100) {
    lottoData = cached;
    updateStatus();
  }

  try {
    const remote = await fetchRemoteData();
    const remoteLatest = remote.at(-1)?.round ?? 0;
    const localLatest = lottoData.at(-1)?.round ?? 0;

    if (remoteLatest >= localLatest) {
      lottoData = trimForStorage(remote);
      saveCachedData(lottoData);
      updateStatus();
    }
  } catch (error) {
    if (lottoData.length >= 100) {
      updateStatus();
      return;
    }

    statusEl.textContent = '데이터를 불러오지 못했습니다';
    generateButton.disabled = true;
    console.error(error);
  }
}

function updateStatus() {
  const latest = lottoData.at(-1);
  statusEl.textContent = latest ? `${latest.round}회 까지 업데이트됨` : '데이터 확인 중...';
}

function recentDraws(count) {
  return lottoData.slice(-count);
}

function frequencyMap(count) {
  const counts = Array(46).fill(0);
  for (const draw of recentDraws(count)) {
    for (const number of draw.numbers) counts[number] += 1;
  }
  return counts;
}

function getHotColdPools() {
  const counts = frequencyMap(50);
  const numbers = Array.from({ length: 45 }, (_, index) => index + 1);

  const desc = [...numbers].sort((a, b) => counts[b] - counts[a] || a - b);
  const asc = [...numbers].sort((a, b) => counts[a] - counts[b] || a - b);

  const hot = numbers.filter((n) => counts[n] >= HOT_MIN_COUNT);
  for (const n of desc) {
    if (hot.length >= 4) break;
    if (!hot.includes(n)) hot.push(n);
  }

  const hotSet = new Set(hot);
  const cold = numbers.filter((n) => counts[n] <= COLD_MAX_COUNT && !hotSet.has(n));
  for (const n of asc) {
    if (cold.length >= 3) break;
    if (!hotSet.has(n) && !cold.includes(n)) cold.push(n);
  }

  return { counts, hot, cold };
}

function randomInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;

  if (globalThis.crypto?.getRandomValues) {
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value;
    do {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sample(items, count) {
  if (items.length < count) throw new Error('후보 번호가 부족합니다.');
  return shuffle(items).slice(0, count);
}

function weightedSampleWithoutReplacement(items, weightFn, count) {
  const pool = [...items];
  const picked = [];

  while (picked.length < count && pool.length > 0) {
    const weights = pool.map((item) => Math.max(0.0001, Number(weightFn(item)) || 0));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = (randomInt(1_000_000) / 1_000_000) * total;
    let index = pool.length - 1;

    for (let i = 0; i < pool.length; i += 1) {
      cursor -= weights[i];
      if (cursor <= 0) {
        index = i;
        break;
      }
    }

    picked.push(pool[index]);
    pool.splice(index, 1);
  }

  return picked;
}

function sortedNumbers(numbers) {
  return [...numbers].sort((a, b) => a - b);
}

function signature(numbers) {
  return sortedNumbers(numbers).join('-');
}

function generateHot() {
  const { hot } = getHotColdPools();
  const hotSet = new Set(hot);
  const others = Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => !hotSet.has(n));

  const fromHot = sample(hot, 4);
  const fromOthers = sample(others, 2);
  const numbers = sortedNumbers([...fromHot, ...fromOthers]);

  return {
    method: 'hot',
    numbers,
    detail: {
      hot: sortedNumbers(fromHot),
      other: sortedNumbers(fromOthers)
    }
  };
}

function generateHotCold() {
  const { hot, cold } = getHotColdPools();
  const fromHot = sample(hot, 3);
  const fromCold = sample(cold, 3);
  const numbers = sortedNumbers([...fromHot, ...fromCold]);

  return {
    method: 'hotCold',
    numbers,
    detail: {
      hot: sortedNumbers(fromHot),
      cold: sortedNumbers(fromCold)
    }
  };
}

function generateRecent100() {
  const counts = frequencyMap(100);
  const all = Array.from({ length: 45 }, (_, i) => i + 1);

  // +1 보정으로 최근 100회에서 적게 나온 번호도 선택 가능성을 유지합니다.
  const picked = weightedSampleWithoutReplacement(all, (n) => counts[n] + 1, 6);
  const numbers = sortedNumbers(picked);

  return {
    method: 'recent100',
    numbers,
    detail: {
      counts: Object.fromEntries(numbers.map((n) => [n, counts[n]]))
    }
  };
}

function maxBandCount(numbers) {
  const bands = [0, 0, 0, 0, 0];
  for (const n of numbers) {
    if (n <= 10) bands[0] += 1;
    else if (n <= 20) bands[1] += 1;
    else if (n <= 30) bands[2] += 1;
    else if (n <= 40) bands[3] += 1;
    else bands[4] += 1;
  }
  return Math.max(...bands);
}

function longestConsecutiveRun(numbers) {
  const sorted = sortedNumbers(numbers);
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}

function balancedStats(numbers) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const low = numbers.filter((n) => n <= 22).length;
  const sum = numbers.reduce((total, n) => total + n, 0);
  const run = longestConsecutiveRun(numbers);

  return {
    odd,
    even: 6 - odd,
    low,
    high: 6 - low,
    sum,
    maxBand: maxBandCount(numbers),
    run
  };
}

function isBalanced(numbers) {
  const stats = balancedStats(numbers);
  return (
    stats.odd === 3 &&
    stats.low === 3 &&
    stats.sum >= 100 &&
    stats.sum <= 180 &&
    stats.maxBand <= 3 &&
    stats.run <= 2
  );
}

function generateBalanced() {
  const all = Array.from({ length: 45 }, (_, i) => i + 1);

  for (let attempt = 0; attempt < 20000; attempt += 1) {
    const numbers = sortedNumbers(sample(all, 6));
    if (!isBalanced(numbers)) continue;

    return {
      method: 'balanced',
      numbers,
      detail: balancedStats(numbers)
    };
  }

  throw new Error('Balanced 번호 생성에 실패했습니다.');
}

function generateRandom() {
  const all = Array.from({ length: 45 }, (_, i) => i + 1);
  return {
    method: 'random',
    numbers: sortedNumbers(sample(all, 6)),
    detail: {}
  };
}

function generateByMethod(method) {
  switch (method) {
    case 'hot': return generateHot();
    case 'hotCold': return generateHotCold();
    case 'recent100': return generateRecent100();
    case 'balanced': return generateBalanced();
    case 'random': return generateRandom();
    default: throw new Error(`알 수 없는 생성 방식: ${method}`);
  }
}

function uniqueGame(method, forbiddenSignatures = new Set()) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const game = generateByMethod(method);
    if (!forbiddenSignatures.has(signature(game.numbers))) return game;
  }
  throw new Error('중복되지 않는 번호를 만들지 못했습니다.');
}

function checkedMethods() {
  return $$('input[name="method"]:checked').map((input) => input.value);
}

function updateSelectionUI() {
  const count = checkedMethods().length;
  selectedCountEl.textContent = `선택된 게임: ${count}게임`;

  const dataReady = lottoData.length >= 100;
  generateButton.disabled = count === 0 || !dataReady;
  generateButton.textContent = count === 0 ? '게임을 선택해주세요' : `${count} 게임 번호 생성`;
}

function saveResults() {
  try {
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(currentResults));
  } catch {
    // 저장 실패는 번호 생성 기능을 막지 않습니다.
  }
}

function loadResults() {
  try {
    const results = JSON.parse(localStorage.getItem(STORAGE_KEYS.RESULTS) || '[]');
    if (!Array.isArray(results)) return [];

    return results.filter((game) =>
      METHOD_ORDER.includes(game.method) &&
      Array.isArray(game.numbers) &&
      game.numbers.length === 6
    );
  } catch {
    return [];
  }
}

function setCheckboxesFromResults(results) {
  const methods = new Set(results.map((game) => game.method));
  $$('input[name="method"]').forEach((input) => {
    input.checked = methods.has(input.value);
  });
}

function formatNumbers(numbers) {
  return numbers.map((n) => String(n).padStart(2, '0')).join('  ');
}

function detailRows(game) {
  switch (game.method) {
    case 'hot':
      return [
        ['기준', '최근 50회'],
        ['Hot 번호', formatNumbers(game.detail.hot || [])],
        ['그 외 번호', formatNumbers(game.detail.other || [])]
      ];

    case 'hotCold':
      return [
        ['기준', '최근 50회'],
        ['Hot 번호', formatNumbers(game.detail.hot || [])],
        ['Cold 번호', formatNumbers(game.detail.cold || [])]
      ];

    case 'recent100': {
      const text = game.numbers
        .map((n) => `${String(n).padStart(2, '0')}(${game.detail.counts?.[n] ?? '-'}회)`)
        .join(' · ');
      return [
        ['기준', '최근 100회'],
        ['출현 횟수', text],
        ['방식', '출현 횟수 + 1 가중 추출']
      ];
    }

    case 'balanced': {
      const d = game.detail;
      const consecutive = d.run <= 1 ? '없음' : '2연속 허용 범위';
      return [
        ['홀짝', `${d.odd} : ${d.even}`],
        ['저 / 고', `${d.low} : ${d.high}`],
        ['번호 합계', String(d.sum)],
        ['번호대', `한 구간 최대 ${d.maxBand}개`],
        ['연속번호', consecutive]
      ];
    }

    case 'random':
      return [['방식', '1~45에서 중복 없이 균등 무작위 추출']];

    default:
      return [];
  }
}

function renderResults() {
  resultListEl.innerHTML = '';
  emptyResultEl.hidden = currentResults.length > 0;

  currentResults.forEach((game, index) => {
    const fragment = gameTemplate.content.cloneNode(true);
    const card = $('.game-card', fragment);
    const title = $('.game-title', fragment);
    const numberRow = $('.number-row', fragment);
    const refreshButton = $('.refresh-button', fragment);
    const detailContent = $('.detail-content', fragment);

    title.textContent = `GAME ${index + 1} · ${METHOD_LABELS[game.method]}`;

    game.numbers.forEach((number) => {
      const span = document.createElement('span');
      span.className = 'lotto-number';
      span.textContent = String(number).padStart(2, '0');
      numberRow.appendChild(span);
    });

    detailRows(game).forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'detail-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'detail-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.textContent = value;

      row.append(labelEl, valueEl);
      detailContent.appendChild(row);
    });

    refreshButton.addEventListener('click', () => refreshGame(index));
    card.dataset.index = String(index);
    resultListEl.appendChild(fragment);
  });
}

function generateSelectedGames() {
  if (lottoData.length < 100) return;

  const methods = checkedMethods();
  const signatures = new Set();
  const next = [];

  try {
    for (const method of methods) {
      const game = uniqueGame(method, signatures);
      signatures.add(signature(game.numbers));
      next.push(game);
    }

    currentResults = next;
    saveResults();
    renderResults();

    if (window.matchMedia('(max-width: 760px)').matches && currentResults.length > 0) {
      $('#result-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    console.error(error);
    alert('번호를 생성하는 중 문제가 발생했습니다. 다시 시도해주세요.');
  }
}

function refreshGame(index) {
  const current = currentResults[index];
  if (!current) return;

  const forbidden = new Set(
    currentResults.map((game) => signature(game.numbers))
  );

  try {
    const replacement = uniqueGame(current.method, forbidden);
    currentResults[index] = replacement;
    saveResults();
    renderResults();
  } catch (error) {
    console.error(error);
    alert('새 번호를 만드는 중 문제가 발생했습니다. 다시 시도해주세요.');
  }
}


function resetAppState() {
  // 로또 데이터 캐시는 유지하고, 사용자가 만든 게임 상태만 초기화합니다.
  $$('input[name="method"]').forEach((input) => {
    input.checked = false;
  });

  currentResults = [];

  try {
    localStorage.removeItem(STORAGE_KEYS.RESULTS);
  } catch {
    // 저장소 접근 실패가 초기화 자체를 막지 않도록 조용히 무시합니다.
  }

  renderResults();
  updateSelectionUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.warn('Service Worker 등록 실패:', error);
      });
    });
  }
}

async function boot() {
  currentResults = loadResults();
  setCheckboxesFromResults(currentResults);
  renderResults();
  updateSelectionUI();

  $$('input[name="method"]').forEach((input) => {
    input.addEventListener('change', updateSelectionUI);
  });

  generateButton.addEventListener('click', generateSelectedGames);
  resetButton.addEventListener('click', resetAppState);

  await initializeData();
  updateSelectionUI();
  registerServiceWorker();
}

boot();
