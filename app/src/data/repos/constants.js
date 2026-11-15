/** data/repos/constants.js — domain vocabulary shared by the repositories. */

/** Products sold at the pump (spec §2). */
export const PRODUCTS = Object.freeze(['Petrol', 'XP', 'Diesel']);

/** What a nozzle is used for. Editable: which nozzles test is still open (OQ-5). */
export const USES = Object.freeze(['Sales', 'TestingOnly']);

/** Sheet a nozzle is written on: Motor Spirit, High Speed Diesel, XP. */
export const SHEETS = Object.freeze(['MS', 'HSD', 'XP']);

/** Operator name limit (spec §5: about 12 people, free text). */
export const MAX_OPERATOR_NAME_LENGTH = 40;

/**
 * The 10 default nozzles from the brief §3.
 *
 * Ids are deterministic (`nz-ms1`) rather than generated, so seeding is idempotent
 * on every device and re-running it can never create a second copy of a nozzle.
 * The two TestingOnly nozzles are PLACEHOLDERS — the brief flags that the 741xxx
 * nozzle shows real sales, so `use` must stay editable (OQ-5).
 */
export const DEFAULT_NOZZLES = Object.freeze([
  { id: 'nz-ms1', label: 'MS1', product: 'Petrol', use: 'Sales', sheet: 'MS' },
  { id: 'nz-ms2', label: 'MS2', product: 'Petrol', use: 'Sales', sheet: 'MS' },
  { id: 'nz-ms3', label: 'MS3', product: 'Petrol', use: 'Sales', sheet: 'MS' },
  { id: 'nz-ms5', label: 'MS5', product: 'Petrol', use: 'TestingOnly', sheet: 'MS' },
  { id: 'nz-ms6', label: 'MS6', product: 'Petrol', use: 'TestingOnly', sheet: 'MS' },
  { id: 'nz-xp1', label: 'XP1', product: 'XP', use: 'Sales', sheet: 'XP' },
  { id: 'nz-hsd1', label: 'HSD1', product: 'Diesel', use: 'Sales', sheet: 'HSD' },
  { id: 'nz-hsd2', label: 'HSD2', product: 'Diesel', use: 'Sales', sheet: 'HSD' },
  { id: 'nz-hsd3', label: 'HSD3', product: 'Diesel', use: 'Sales', sheet: 'HSD' },
  { id: 'nz-hsd4', label: 'HSD4', product: 'Diesel', use: 'Sales', sheet: 'HSD' },
]);
