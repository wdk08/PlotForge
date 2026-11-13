// Dimensions are width × depth in centimeters. Symbols share construction where the objects do.
export const FURNITURE_CATEGORIES = {
  bedroom: ['Bedroom', '▤'], living: ['Living Room', '▰'], bathroom: ['Bathroom', '◒'],
  kitchen: ['Kitchen & Dining', '▦'], office: ['Office', '▣'], laundry: ['Laundry', '◎'],
  outdoor: ['Outdoor', '☀'], misc: ['Miscellaneous', '◇'], my: ['My Furniture', '★'],
};
const catalog = {
  bedroom: [
    ['twin', 'Twin bed', 99, 191, 'bed', 1], ['twin-xl', 'Twin XL bed', 99, 203, 'bed', 1],
    ['full', 'Full bed', 137, 191, 'bed', 2], ['queen', 'Queen bed', 152, 203, 'bed', 2],
    ['king', 'King bed', 193, 203, 'bed', 2], ['cal-king', 'California King bed', 183, 213, 'bed', 2],
    ['bunk', 'Bunk bed', 107, 205, 'bed', 'bunk'], ['crib', 'Crib', 76, 142, 'bed', 'crib'],
    ['nightstand', 'Nightstand', 48, 43, 'drawers', 1], ['dresser', 'Dresser', 145, 50, 'drawers', 3],
    ['wardrobe', 'Wardrobe', 150, 62, 'cabinet', 'wardrobe'], ['vanity', 'Vanity', 110, 48, 'desk', 'vanity'],
    ['bedroom-desk', 'Bedroom desk', 105, 56, 'desk'], ['chest', 'Chest of drawers', 85, 49, 'drawers', 4],
  ],
  living: [
    ['sofa', 'Sofa', 215, 92, 'seat', 3], ['loveseat', 'Loveseat', 155, 88, 'seat', 2],
    ['sectional', 'Sectional sofa', 280, 205, 'seat', 'sectional'], ['armchair', 'Armchair', 85, 86, 'seat', 1],
    ['recliner', 'Recliner', 90, 110, 'seat', 'recliner'], ['coffee-table', 'Coffee table', 112, 58, 'table', 'oval'],
    ['side-table', 'Side table', 48, 48, 'table', 'round'], ['tv-stand', 'TV stand', 155, 42, 'cabinet', 'tv'],
    ['bookshelf', 'Bookshelf', 90, 33, 'cabinet', 'books'], ['entertainment', 'Entertainment center', 230, 54, 'cabinet', 'media'],
    ['fireplace', 'Fireplace', 130, 55, 'fire'], ['ottoman', 'Ottoman', 68, 58, 'seat', 'ottoman'],
  ],
  bathroom: [
    ['toilet', 'Toilet', 39, 70, 'toilet'], ['pedestal', 'Pedestal sink', 54, 47, 'basin', 'pedestal'],
    ['wall-sink', 'Wall-mounted sink', 55, 42, 'basin', 'wall'], ['single-vanity', 'Single vanity', 81, 54, 'basin', 'single'],
    ['double-vanity', 'Double vanity', 152, 55, 'basin', 'double'], ['bathtub', 'Bathtub', 76, 152, 'bath'],
    ['corner-bath', 'Corner bathtub', 137, 137, 'bath', 'corner'], ['shower', 'Walk-in shower', 95, 125, 'bath', 'shower'],
    ['shower-tub', 'Shower/tub combination', 82, 152, 'bath', 'combo'], ['bath-cabinet', 'Bathroom cabinet', 60, 35, 'cabinet'],
    ['mirror', 'Mirror', 75, 8, 'mirror'], ['towel-rack', 'Towel rack', 67, 18, 'rack'],
  ],
  kitchen: [
    ['fridge', 'Refrigerator', 91, 79, 'appliance', 'fridge'], ['stove', 'Stove', 76, 66, 'appliance', 'stove'],
    ['oven', 'Oven', 76, 62, 'appliance', 'oven'], ['dishwasher', 'Dishwasher', 61, 61, 'appliance', 'dishwasher'],
    ['kitchen-sink', 'Kitchen sink', 84, 55, 'basin', 'double'], ['island', 'Kitchen island', 183, 95, 'counter', 'island'],
    ['countertop', 'Countertop', 122, 64, 'counter'], ['upper-cabinet', 'Upper cabinets', 91, 33, 'cabinet', 'upper'],
    ['lower-cabinet', 'Lower cabinets', 91, 62, 'cabinet'], ['microwave', 'Microwave', 52, 41, 'appliance', 'microwave'],
    ['round-dining', 'Dining table (round)', 120, 120, 'table', 'round'], ['rect-dining', 'Dining table (rectangular)', 180, 95, 'table'],
    ['dining-chair', 'Dining chair', 47, 52, 'chair'], ['bar-stool', 'Bar stool', 41, 41, 'chair', 'stool'],
  ],
  office: [
    ['office-desk', 'Office desk', 153, 74, 'desk'], ['corner-desk', 'Corner desk', 175, 155, 'desk', 'corner'],
    ['office-chair', 'Office chair', 64, 65, 'chair', 'office'], ['filing', 'Filing cabinet', 46, 63, 'drawers', 3],
    ['office-books', 'Bookshelf', 95, 35, 'cabinet', 'books'], ['conference', 'Conference table', 280, 115, 'table', 'oval'],
    ['workstation', 'Computer workstation', 132, 74, 'desk', 'computer'],
  ],
  laundry: [
    ['washer', 'Washing machine', 69, 76, 'appliance', 'washer'], ['dryer', 'Dryer', 69, 78, 'appliance', 'dryer'],
    ['stacked-laundry', 'Stacked washer/dryer', 69, 82, 'appliance', 'stacked'], ['laundry-sink', 'Laundry sink', 64, 60, 'basin', 'utility'],
    ['laundry-cabinet', 'Storage cabinet', 84, 50, 'cabinet'], ['ironing-board', 'Ironing board', 40, 130, 'ironing'],
  ],
  outdoor: [
    ['patio-table', 'Patio table', 107, 107, 'table', 'patio'], ['outdoor-chair', 'Outdoor chair', 59, 61, 'chair', 'slats'],
    ['bench', 'Bench', 145, 52, 'chair', 'slats'], ['grill', 'Grill', 135, 63, 'appliance', 'grill'],
    ['fire-pit', 'Fire pit', 91, 91, 'fire', 'pit'], ['lounger', 'Lounge chair', 67, 195, 'chair', 'lounge'],
    ['planter', 'Planter', 82, 47, 'planter'], ['outdoor-sofa', 'Outdoor sofa', 190, 82, 'seat', 2],
  ],
  misc: [
    ['shelves', 'Storage shelves', 122, 45, 'cabinet', 'shelves'], ['closet', 'Closet', 183, 66, 'cabinet', 'wardrobe'],
    ['piano', 'Piano', 155, 160, 'piano'], ['pool', 'Pool table', 244, 137, 'pool'], ['exercise', 'Exercise equipment', 88, 178, 'exercise'],
    ['table', 'Generic table', 145, 85, 'table'], ['chair', 'Generic chair', 48, 49, 'chair'],
  ],
};
export const FURNITURE = Object.fromEntries(Object.entries(catalog).flatMap(([category, entries]) =>
  entries.map(([id, name, w, h, symbol, detail]) => [id, { id, name, w, h, symbol, detail, category }])));
const legacy = {
  bed: ['Bed', 150, 200, 'bed', 2], couch: ['Couch', 205, 88, 'seat', 2],
  desk: ['Desk', 132, 62, 'desk'], cabinet: ['Cabinet', 100, 48, 'cabinet'], sink: ['Sink', 55, 48, 'basin', 'utility'],
};
export function furnitureDefinition(id) {
  if (Object.hasOwn(FURNITURE, id)) return FURNITURE[id];
  if (!Object.hasOwn(legacy, id)) return;
  const [name, w, h, symbol, detail] = legacy[id];
  return { id, name, w, h, symbol, detail };
}
