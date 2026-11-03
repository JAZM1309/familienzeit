// Eingabe wie "2 Liter Milch" zerlegen und eine passende Kategorie vorschlagen

export const CATEGORIES = [
  ['obst', 'Obst & Gemüse', '🥕'],
  ['milch', 'Milchprodukte', '🧀'],
  ['fleisch', 'Fleisch & Wurst', '🥩'],
  ['brot', 'Brot & Backwaren', '🥖'],
  ['getraenke', 'Getränke', '🧃'],
  ['tiefkuehl', 'Tiefkühlprodukte', '🧊'],
  ['suess', 'Süßigkeiten & Snacks', '🍫'],
  ['haushalt', 'Haushalt & Drogerie', '🧻'],
  ['sonstiges', 'Sonstiges', '🛒'],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));

const UNITS = ['kg', 'g', 'mg', 'ml', 'l', 'liter', 'stück', 'stk', 'pck', 'packung', 'packungen', 'päckchen', 'dose', 'dosen',
  'flasche', 'flaschen', 'becher', 'bund', 'glas', 'gläser', 'tüte', 'tüten', 'beutel', 'kasten', 'kiste', 'netz', 'el', 'tl',
  'prise', 'scheiben', 'rolle', 'rollen', 'x'];

const NUM = '(\\d+(?:[.,]\\d+)?|½|¼|¾)';
const RE = new RegExp(`^${NUM}\\s*(${UNITS.join('|')})?\\.?\\s+(.+)$`, 'i');

export function parseItem(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = t.match(RE);
  if (!m) return { name: t, quantity: null, unit: null };
  let unit = m[2] || null;
  if (unit && unit.toLowerCase() === 'x') unit = null;
  if (unit && unit.toLowerCase() === 'liter') unit = 'Liter';
  return { name: m[3].trim(), quantity: m[1], unit };
}

export function itemLabel(i) {
  return [i.quantity, i.unit, i.name].filter(Boolean).join(' ');
}

const WORDS = {
  obst: 'obst gemüse apfel äpfel banane birne orange mandarine zitrone limette traube trauben erdbeere erdbeeren beeren himbeeren heidelbeeren kiwi mango ananas melone pfirsich nektarine pflaume tomate tomaten gurke salat eisbergsalat rucola paprika zwiebel zwiebeln knoblauch kartoffel kartoffeln möhre möhren karotte karotten brokkoli blumenkohl zucchini aubergine pilze champignons spinat lauch porree avocado kohl radieschen sellerie ingwer petersilie schnittlauch basilikum kräuter mais kürbis rote-bete',
  milch: 'milch joghurt quark käse butter sahne schmand frischkäse mozzarella parmesan gouda feta eier ei margarine kefir buttermilch pudding schlagsahne creme-fraiche skyr',
  fleisch: 'fleisch hack hackfleisch hähnchen huhn hühnchen pute rind schwein schinken salami wurst würstchen speck aufschnitt lachs fisch garnelen bratwurst schnitzel steak leberwurst frikadellen gyros',
  brot: 'brot brötchen toast toastbrot baguette croissant croissants laugen brezel brezeln kuchen semmel knäckebrot zwieback wraps tortilla',
  getraenke: 'wasser mineralwasser sprudel saft apfelsaft orangensaft cola limo limonade bier wein sekt kaffee tee eistee schorle kakao smoothie fanta sprite',
  tiefkuehl: 'tiefkühl tk pizza eis pommes fischstäbchen tiefkühlgemüse rahmspinat',
  suess: 'schokolade schoko chips gummibärchen gummibären keks kekse bonbons süßigkeiten nutella riegel popcorn lakritz salzstangen',
  haushalt: 'klopapier toilettenpapier küchenrolle spülmittel spültabs tabs spülmaschinentabs waschmittel weichspüler zahnpasta zahnbürste shampoo duschgel seife deo müllbeutel taschentücher windeln schwamm schwämme putzmittel reiniger alufolie frischhaltefolie backpapier batterien creme rasierer tampons binden wattepads',
  sonstiges: 'reis nudeln spaghetti mehl zucker salz öl essig ketchup senf mayo gewürze müsli haferflocken cornflakes marmelade honig nüsse brühe linsen bohnen tomatenmark passierte-tomaten',
};
const KEYWORDS = Object.entries(WORDS).flatMap(([cat, s]) => s.split(' ').map((w) => [w.replace('-', ' '), cat]));

// Längster passender Begriff gewinnt ("Eisbergsalat" → Obst & Gemüse, "Reis" → Sonstiges)
export function suggestCategory(name, history = {}) {
  const n = name.trim().toLowerCase();
  if (history[n]) return history[n];
  const words = n.split(/[\s,/-]+/).filter(Boolean);
  let best = null;
  let bestLen = 0;
  for (const [kw, cat] of KEYWORDS) {
    const hit = kw.includes(' ')
      ? n.includes(kw)
      : words.some((w) => w === kw || w.startsWith(kw) || (kw.length >= 3 && w.endsWith(kw)));
    if (hit && kw.length > bestLen) { best = cat; bestLen = kw.length; }
  }
  return best || 'sonstiges';
}
