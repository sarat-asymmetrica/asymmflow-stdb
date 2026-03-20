type WordCase = 'sentence' | 'upper';

const ONES_SENTENCE = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS_SENTENCE = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function wordSets(wordCase: WordCase) {
  if (wordCase === 'upper') {
    return {
      ones: ONES_SENTENCE.map((word) => word.toUpperCase()),
      tens: TENS_SENTENCE.map((word) => word.toUpperCase()),
    };
  }

  return {
    ones: ONES_SENTENCE,
    tens: TENS_SENTENCE,
  };
}

function threeDigitsToWords(value: number, wordCase: WordCase): string {
  const { ones, tens } = wordSets(wordCase);

  if (value === 0) return '';
  if (value < 20) return ones[value];

  if (value < 100) {
    const tensWord = tens[Math.floor(value / 10)];
    const onesWord = ones[value % 10];
    return onesWord ? `${tensWord}-${onesWord}` : tensWord;
  }

  const hundredsWord = ones[Math.floor(value / 100)];
  const remainder = value % 100;
  return remainder === 0
    ? `${hundredsWord} ${wordCase === 'upper' ? 'HUNDRED' : 'hundred'}`
    : `${hundredsWord} ${wordCase === 'upper' ? 'HUNDRED' : 'hundred'} ${threeDigitsToWords(remainder, wordCase)}`;
}

function wholeNumberToWords(value: number, wordCase: WordCase): string {
  if (value === 0) {
    return wordCase === 'upper' ? 'ZERO' : 'zero';
  }

  const parts: string[] = [];
  const billions = Math.floor(value / 1_000_000_000);
  const millions = Math.floor((value % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;

  if (billions) parts.push(`${threeDigitsToWords(billions, wordCase)} ${wordCase === 'upper' ? 'BILLION' : 'billion'}`);
  if (millions) parts.push(`${threeDigitsToWords(millions, wordCase)} ${wordCase === 'upper' ? 'MILLION' : 'million'}`);
  if (thousands) parts.push(`${threeDigitsToWords(thousands, wordCase)} ${wordCase === 'upper' ? 'THOUSAND' : 'thousand'}`);
  if (remainder) parts.push(threeDigitsToWords(remainder, wordCase));

  return parts.join(' ');
}

export function filsToBahrainiWords(
  fils: bigint,
  options?: {
    wordCase?: WordCase;
    wrapInParens?: boolean;
    includeOnlySuffix?: boolean;
  },
): string {
  const wordCase = options?.wordCase ?? 'sentence';
  const abs = fils < 0n ? -fils : fils;
  const dinars = Number(abs / 1000n);
  const filsPart = Number(abs % 1000n);
  const dinarLabelSingular = wordCase === 'upper' ? 'BAHRAINI DINAR' : 'Bahraini Dinar';
  const dinarLabelPlural = wordCase === 'upper' ? 'BAHRAINI DINARS' : 'Bahraini Dinars';
  const filsLabel = wordCase === 'upper' ? 'FILS' : 'fils';
  const onlyLabel = wordCase === 'upper' ? 'ONLY' : 'only';

  const segments: string[] = [];
  if (dinars > 0) {
    const label = dinars === 1 ? dinarLabelSingular : dinarLabelPlural;
    const words = wholeNumberToWords(dinars, wordCase);
    segments.push(`${wordCase === 'upper' ? words : capitalize(words)} ${label}`);
  }

  if (filsPart > 0) {
    const words = threeDigitsToWords(filsPart, wordCase);
    segments.push(`${wordCase === 'upper' ? words : capitalize(words)} ${filsLabel}`);
  }

  if (segments.length === 0) {
    segments.push(`${wordCase === 'upper' ? 'ZERO' : 'Zero'} ${dinarLabelPlural}`);
  }

  let text = segments.join(' and ');
  if (options?.includeOnlySuffix) {
    text = `${text} ${onlyLabel}`;
  }
  if (options?.wrapInParens) {
    text = `(${text})`;
  }

  return text;
}
