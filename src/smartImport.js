// Heuristic column detection for the "intelligent" spreadsheet import.
// Deliberately rule-based, no AI: every guess is shown to the user for
// confirmation before anything is imported (see SmartImportModal.jsx), so
// an imperfect guess here never silently corrupts data — it's just a
// starting point the user can override per column.

export const FIELD_TYPES = [
  'name', 'category', 'brand', 'identifier', 'condition', 'quantity',
  'purchasePrice', 'value', 'notes', 'ignore'
];

const HEADER_KEYWORDS = {
  name: ['name', 'artikel', 'bezeichnung', 'titel', 'title', 'item', 'produkt'],
  category: ['kategorie', 'category', 'genre', 'sparte'],
  brand: ['marke', 'hersteller', 'brand', 'manufacturer'],
  identifier: ['isbn', 'ean', 'artikelnummer', 'nummer', 'sku', 'barcode', 'upc'],
  condition: ['zustand', 'condition', 'state', 'qualität'],
  quantity: ['menge', 'anzahl', 'stück', 'stueck', 'qty', 'quantity'],
  purchasePrice: ['kaufpreis', 'einkaufspreis', 'kaufwert', 'purchase price', 'bought', 'ek preis'],
  value: ['wert', 'marktwert', 'value', 'geschätzter wert', 'aktueller wert', 'verkaufswert'],
  notes: ['notiz', 'notizen', 'bemerkung', 'note', 'comment', 'kommentar']
};

const CONDITION_WORDS = {
  mint: ['neu', 'mint', 'ovp', 'new', 'sealed'],
  nearMint: ['fast neu', 'wie neu', 'near mint', 'nearmint'],
  excellent: ['sehr gut', 'excellent', 'hervorragend'],
  good: ['gut', 'good'],
  played: ['bespielt', 'gebraucht', 'played', 'used', 'akzeptabel'],
  poor: ['schlecht', 'defekt', 'poor', 'beschädigt', 'beschaedigt', 'damaged']
};

const MONEY_RE = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*(€|eur)?$/i;
const INT_RE = /^\d+$/;

function looksNumericish(str) {
  const s = (str || '').trim();
  return MONEY_RE.test(s) || INT_RE.test(s);
}

function matchConditionWord(str) {
  const s = (str || '').trim().toLowerCase();
  if (!s) return null;
  for (const [key, words] of Object.entries(CONDITION_WORDS)) {
    if (words.some((w) => s === w || s.includes(w))) return key;
  }
  return null;
}

function headerMatches(header, type) {
  const h = (header || '').trim().toLowerCase();
  if (!h) return false;
  return (HEADER_KEYWORDS[type] || []).some((kw) => h.includes(kw));
}

// Converts both German (1.249,90) and international (1,249.90) formatted
// numbers. Ambiguous single-separator cases assume the German convention
// (a comma followed by exactly two digits is a decimal separator).
export function parseLocaleNumber(raw) {
  // Strip currency symbols/whitespace first — "35,00 €" must not let the
  // trailing " €" hide the ",00" decimal pattern from the checks below.
  let str = (raw || '').trim().replace(/[€$£\s]/g, '');
  if (!str) return null;
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    str = lastComma > lastDot ? str.replace(/\./g, '').replace(',', '.') : str.replace(/,/g, '');
  } else if (hasComma) {
    str = /,\d{2}$/.test(str) ? str.replace(',', '.') : str.replace(/,/g, '');
  }
  str = str.replace(/[^\d.-]/g, '');
  const n = parseFloat(str);
  return Number.isNaN(n) ? null : n;
}

export function guessHasHeader(rows) {
  if (rows.length < 2) return false;
  const header = rows[0];
  const sample = rows.slice(1, Math.min(rows.length, 6));
  const matchesKeyword = header.some((h) =>
    Object.keys(HEADER_KEYWORDS).some((type) => headerMatches(h, type))
  );
  if (matchesKeyword) return true;

  const headerNumericCount = header.filter(looksNumericish).length;
  const sampleNumericAvg = sample.reduce((sum, r) => sum + r.filter(looksNumericish).length, 0) / sample.length;
  return headerNumericCount === 0 && sampleNumericAvg > 0;
}

// Returns one entry per column: { index, header, type, confidence, needsPriceClarification }
export function detectColumns(rows, hasHeader) {
  const header = hasHeader ? rows[0] : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const colCount = Math.max(0, ...rows.map((r) => r.length));

  const columns = [];
  const claimed = new Set();

  for (let col = 0; col < colCount; col++) {
    const values = dataRows.map((r) => (r[col] || '').trim()).filter(Boolean);
    const total = values.length;
    const headerLabel = hasHeader ? (header[col] || '').trim() : '';
    if (total === 0) {
      columns.push({ index: col, header: headerLabel, type: 'ignore', confidence: 'none', values });
      continue;
    }

    const moneyCount = values.filter((v) => MONEY_RE.test(v)).length;
    const intCount = values.filter((v) => INT_RE.test(v)).length;
    const conditionCount = values.filter((v) => matchConditionWord(v)).length;
    const leadingZero = values.some((v) => /^0\d+$/.test(v));
    const uniqueRatio = new Set(values.map((v) => v.toLowerCase())).size / total;
    const avgLen = values.reduce((sum, v) => sum + v.length, 0) / total;
    const avgIntValue = intCount > 0 ? values.filter((v) => INT_RE.test(v)).reduce((s, v) => s + Number(v), 0) / intCount : 0;

    let type = null;
    let confidence = 'none';

    if (headerMatches(headerLabel, 'identifier') || (leadingZero && intCount / total > 0.5)) {
      type = 'identifier'; confidence = headerMatches(headerLabel, 'identifier') ? 'high' : 'medium';
    } else if (headerMatches(headerLabel, 'quantity') || (intCount / total > 0.7 && avgIntValue < 1000 && !leadingZero && avgIntValue > 0)) {
      type = 'quantity'; confidence = headerMatches(headerLabel, 'quantity') ? 'high' : 'medium';
    } else if (conditionCount / total > 0.5) {
      type = 'condition'; confidence = headerMatches(headerLabel, 'condition') ? 'high' : 'medium';
    } else if (moneyCount / total > 0.5 || headerMatches(headerLabel, 'purchasePrice') || headerMatches(headerLabel, 'value')) {
      if (headerMatches(headerLabel, 'purchasePrice')) { type = 'purchasePrice'; confidence = 'high'; }
      else if (headerMatches(headerLabel, 'value')) { type = 'value'; confidence = 'high'; }
      else { type = 'price_ambiguous'; confidence = 'medium'; }
    } else if (headerMatches(headerLabel, 'category')) {
      type = 'category'; confidence = 'high';
    } else if (headerMatches(headerLabel, 'brand')) {
      type = 'brand'; confidence = 'high';
    } else if (headerMatches(headerLabel, 'notes')) {
      type = 'notes'; confidence = 'high';
    } else if (headerMatches(headerLabel, 'name')) {
      type = 'name'; confidence = 'high';
    } else if (!claimed.has('category') && uniqueRatio < 0.4 && total > 3 && avgLen < 40) {
      type = 'category'; confidence = 'low';
    }

    columns.push({ index: col, header: headerLabel, type: type || 'ignore', confidence: type ? confidence : 'none', values });
    if (type && type !== 'price_ambiguous') claimed.add(type);
  }

  // Exactly one "name" column: pick the most text-like unclaimed column if
  // none was matched by header keyword above.
  if (!columns.some((c) => c.type === 'name')) {
    let best = null;
    for (const col of columns) {
      if (col.type !== 'ignore') continue;
      const total = col.values.length;
      if (total === 0) continue;
      const uniqueRatio = new Set(col.values.map((v) => v.toLowerCase())).size / total;
      const avgLen = col.values.reduce((sum, v) => sum + v.length, 0) / total;
      const numericRatio = col.values.filter(looksNumericish).length / total;
      const score = uniqueRatio * Math.min(avgLen, 40) * (1 - numericRatio);
      if (!best || score > best.score) best = { col, score };
    }
    if (best && best.score > 0) {
      best.col.type = 'name';
      best.col.confidence = 'medium';
    }
  }

  return columns;
}

export function needsPriceClarification(columns) {
  return columns.some((c) => c.type === 'price_ambiguous');
}

// Builds item drafts from confirmed column mapping. `priceMeaning` resolves
// any 'price_ambiguous' column to 'purchasePrice' or 'value'.
export function buildItemDrafts(rows, hasHeader, columns, priceMeaning, existingItems) {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const byType = {};
  columns.forEach((c) => {
    let type = c.type;
    if (type === 'price_ambiguous') type = priceMeaning || 'value';
    if (type && type !== 'ignore') byType[type] = c.index;
  });

  const existingKeys = new Set((existingItems || []).map((i) => `${(i.name || '').toLowerCase()}|${(i.category || '').toLowerCase()}`));
  const seenInFile = new Map();

  return dataRows.map((row, rowIndex) => {
    const get = (type) => (byType[type] !== undefined ? (row[byType[type]] || '').trim() : '');
    const name = get('name');
    const category = get('category');
    const conditionRaw = get('condition');
    const condition = matchConditionWord(conditionRaw) || '';
    const quantityRaw = get('quantity');
    const quantity = INT_RE.test(quantityRaw) ? Number(quantityRaw) : 1;
    const purchasePrice = parseLocaleNumber(get('purchasePrice'));
    const value = parseLocaleNumber(get('value'));
    const identifier = get('identifier');
    const brand = get('brand');
    const notes = get('notes');

    const issues = [];
    if (!name) issues.push('missingName');
    if (quantityRaw && !INT_RE.test(quantityRaw)) issues.push('invalidQuantity');
    if (get('purchasePrice') && purchasePrice === null) issues.push('invalidPurchasePrice');
    if (get('value') && value === null) issues.push('invalidValue');

    const key = name ? `${name.toLowerCase()}|${(category || 'sonstiges').toLowerCase()}` : null;
    const isDuplicateOfExisting = !!key && existingKeys.has(key);
    let isDuplicateInFile = false;
    if (key) {
      if (seenInFile.has(key)) isDuplicateInFile = true;
      else seenInFile.set(key, true);
    }

    return {
      rowIndex,
      name,
      category: category || 'Sonstiges',
      condition,
      quantity,
      purchasePrice,
      value,
      notes,
      catalogInfo: { brand: brand || '', ean: identifier || '', isbn: '', manufacturerNumber: '', releaseYear: '' },
      issues,
      isDuplicate: isDuplicateOfExisting || isDuplicateInFile,
      duplicateSource: isDuplicateOfExisting ? 'existing' : (isDuplicateInFile ? 'file' : null),
      excluded: issues.includes('missingName')
    };
  });
}

// A stable signature for "this file has the same column structure as one
// we've seen before" — used to offer a previously confirmed mapping again
// (see SmartImportModal's saved-mapping banner). Column order and header
// text must match; content is irrelevant.
export function mappingSignature(rows, hasHeader) {
  if (!hasHeader) return `noheader:${(rows[0] || []).length}`;
  return `header:${(rows[0] || []).map((h) => (h || '').trim().toLowerCase()).join('|')}`;
}
