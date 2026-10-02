/**
 * Seasonality and regional intelligence.
 *
 * The engine never hard-codes "you must eat guava". It scores candidates by
 * (in season) x (regional) x (affordable) and lets substitutions fall out of
 * the ranking, so a fruit that is unavailable or expensive simply loses.
 */

import type { Food, FoodKey, RegionId, SeasonId } from './types/index';
import { FOODS, getFood } from './data/foods';

export type Month = number; // 0 = January

/** Seasons as they are felt in north India, which is where most users are. */
export function seasonForMonth(month: Month): SeasonId {
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'summer';
  if (month <= 6) return 'monsoon';
  return 'post-monsoon';
}

export function seasonForDate(date: Date, tz: string): SeasonId {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).formatToParts(
    date,
  );
  const raw = parts.find((p) => p.type === 'month')?.value;
  return seasonForMonth(raw ? Number(raw) - 1 : 0);
}

export const SEASON_LABELS: Record<SeasonId, string> = {
  winter: 'Winter',
  summer: 'Summer',
  monsoon: 'Monsoon',
  'post-monsoon': 'Post-monsoon',
  'all-year': 'All year',
};

export function isInSeason(food: Food, season: SeasonId): boolean {
  return food.seasons.includes('all-year') || food.seasons.includes(season);
}

/** Full list of candidate foods for a category, filtered by season. */
export function seasonalCandidates(
  category: Food['category'],
  season: SeasonId,
  includeOffSeason = false,
): readonly Food[] {
  return FOODS.filter((f) => f.category === category && (includeOffSeason || isInSeason(f, season)));
}

// ---------------------------------------------------------------------------
// Regional price index
// ---------------------------------------------------------------------------

/**
 * Multiplier applied to the national base price. Metro markets cost more;
 * eastern interior states less. Values are intentionally coarse.
 */
export const REGION_PRICE_INDEX: Record<RegionId, number> = {
  bihar: 0.88,
  jharkhand: 0.9,
  up: 0.93,
  mp: 0.93,
  assam: 0.98,
  odisha: 0.95,
  wb: 0.97,
  'himachal': 1.05,
  'jammu-kashmir': 1.08,
  rajasthan: 1.0,
  'metro-south': 1.12,
  maharashtra: 1.08,
  gujarat: 1.05,
  karnataka: 1.08,
  'ap-telangana': 1.06,
  tn: 1.07,
  kerala: 1.15,
  'north-delhi': 1.1,
  'metro-west': 1.1,
  other: 1.0,
};

export function regionMultiplier(region: RegionId): number {
  return REGION_PRICE_INDEX[region] ?? 1;
}

export interface RegionalProfile {
  readonly id: RegionId;
  readonly label: string;
  readonly states: readonly string[];
  readonly cities: readonly string[];
  /** Common, cheap, locally-available produce the plan can lean on. */
  readonly localProduce: readonly FoodKey[];
}

/**
 * A pragmatic subset: the spec asks for Bihar-friendly choices by default, so
 * Bihar leads the list and every other region is listed after it.
 */
export const REGIONS: readonly RegionalProfile[] = [
  {
    id: 'bihar',
    label: 'Bihar',
    states: ['Bihar'],
    cities: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Ara', 'Begusarai', 'Chapra'],
    localProduce: ['rice', 'atta', 'dal-mix', 'chana', 'soy-chunks', 'gourd', 'bottle-gourd', 'potato', 'spinach', 'guava', 'banana', 'peanut'],
  },
  {
    id: 'jharkhand',
    label: 'Jharkhand',
    states: ['Jharkhand'],
    cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh'],
    localProduce: ['rice', 'atta', 'dal-mix', 'chana', 'pumpkin', 'potato', 'cabbage', 'banana', 'papaya'],
  },
  {
    id: 'up',
    label: 'Uttar Pradesh',
    states: ['Uttar Pradesh'],
    cities: ['Lucknow', 'Kanpur', 'Varanasi', 'Agra', 'Prayagraj', 'Gorakhpur', 'Noida', 'Ghaziabad'],
    localProduce: ['atta', 'dal-mix', 'chana', 'potato', 'spinach', 'gourd', 'bottle-gourd', 'banana', 'amla', 'peanut', 'curd'],
  },
  {
    id: 'mp',
    label: 'Madhya Pradesh',
    states: ['Madhya Pradesh'],
    cities: ['Bhopal', 'Indore', 'Gwalior', 'Jabalpur', 'Ujjain'],
    localProduce: ['atta', 'dal-mix', 'chana', 'soy-chunks', 'bottle-gourd', 'brinjal', 'banana', 'guava'],
  },
  {
    id: 'rajasthan',
    label: 'Rajasthan',
    states: ['Rajasthan'],
    cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
    localProduce: ['atta', 'dal-mix', 'chana', 'gourd', 'bottle-gourd', 'radish', 'banana'],
  },
  {
    id: 'maharashtra',
    label: 'Maharashtra',
    states: ['Maharashtra'],
    cities: ['Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad'],
    localProduce: ['rice', 'atta', 'dal-mix', 'soy-chunks', 'brinjal', 'cucumber', 'banana', 'papaya'],
  },
  {
    id: 'gujarat',
    label: 'Gujarat',
    states: ['Gujarat'],
    cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar'],
    localProduce: ['atta', 'dal-mix', 'chana', 'sattu', 'bottle-gourd', 'banana', 'papaya'],
  },
  {
    id: 'wb',
    label: 'West Bengal',
    states: ['West Bengal'],
    cities: ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri', 'Asansol'],
    localProduce: ['rice', 'atta', 'dal-mix', 'chana', 'potato', 'brinjal', 'pomelo', 'banana'],
  },
  {
    id: 'odisha',
    label: 'Odisha',
    states: ['Odisha'],
    cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Puri', 'Sambalpur'],
    localProduce: ['rice', 'dal-mix', 'chana', 'brinjal', 'bottle-gourd', 'pomelo', 'banana'],
  },
  {
    id: 'karnataka',
    label: 'Karnataka',
    states: ['Karnataka'],
    cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Davanagere'],
    localProduce: ['rice', 'ragi', 'dal-mix', 'banana', 'papaya', 'tomato', 'curd'],
  },
  {
    id: 'tn',
    label: 'Tamil Nadu',
    states: ['Tamil Nadu'],
    cities: ['Chennai', 'Coimbatore', 'Madurai', 'Trichy', 'Salem'],
    localProduce: ['rice', 'ragi', 'dal-mix', 'banana', 'tomato', 'curd', 'cucumber'],
  },
  {
    id: 'kerala',
    label: 'Kerala',
    states: ['Kerala'],
    cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam'],
    localProduce: ['rice', 'dal-mix', 'cucumber', 'bottle-gourd', 'banana', 'papaya', 'spinach'],
  },
  {
    id: 'ap-telangana',
    label: 'Andhra Pradesh / Telangana',
    states: ['Andhra Pradesh', 'Telangana'],
    cities: ['Hyderabad', 'Visakhapatnam', 'Vijayawada', 'Warangal', 'Guntur'],
    localProduce: ['rice', 'dal-mix', 'chana', 'brinjal', 'tomato', 'banana', 'mango'],
  },
  {
    id: 'assam',
    label: 'Assam',
    states: ['Assam'],
    cities: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Tezpur'],
    localProduce: ['rice', 'atta', 'dal-mix', 'bottle-gourd', 'cabbage', 'banana', 'pomelo'],
  },
  {
    id: 'himachal',
    label: 'Himachal Pradesh',
    states: ['Himachal Pradesh'],
    cities: ['Shimla', 'Dharamshala', 'Mandi', 'Solan', 'Kullu'],
    localProduce: ['atta', 'apple', 'curd', 'milk', 'spinach', 'potato', 'beans'],
  },
  {
    id: 'jammu-kashmir',
    label: 'Jammu & Kashmir',
    states: ['Jammu & Kashmir', 'Ladakh'],
    cities: ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Leh'],
    localProduce: ['atta', 'rice', 'milk', 'curd', 'spinach', 'potato', 'beans'],
  },
  {
    id: 'north-delhi',
    label: 'Delhi NCR',
    states: ['Delhi'],
    cities: ['Delhi', 'Dwarka', 'Rohini', 'Saket', 'Janakpuri'],
    localProduce: ['atta', 'dal-mix', 'chana', 'soy-chunks', 'spinach', 'banana', 'guava'],
  },
  {
    id: 'metro-south',
    label: 'South metros',
    states: ['Telangana', 'Tamil Nadu', 'Karnataka', 'Kerala'],
    cities: ['Hyderabad', 'Bengaluru', 'Chennai', 'Kochi', 'Coimbatore'],
    localProduce: ['rice', 'ragi', 'dal-mix', 'curd', 'banana', 'tomato'],
  },
  {
    id: 'metro-west',
    label: 'West metros',
    states: ['Maharashtra', 'Gujarat'],
    cities: ['Mumbai', 'Pune', 'Ahmedabad', 'Surat', 'Nashik'],
    localProduce: ['rice', 'atta', 'dal-mix', 'soy-chunks', 'banana', 'tomato', 'cucumber'],
  },
  {
    id: 'other',
    label: 'Somewhere else',
    states: [],
    cities: [],
    localProduce: ['rice', 'atta', 'dal-mix', 'chana', 'soy-chunks', 'potato', 'banana'],
  },
];

export function regionProfile(id: RegionId): RegionalProfile {
  return REGIONS.find((r) => r.id === id) ?? (REGIONS[REGIONS.length - 1] as RegionalProfile);
}

export function cityOptions(region: RegionId): readonly string[] {
  return regionProfile(region).cities;
}

// ---------------------------------------------------------------------------
// Substitution ranking
// ---------------------------------------------------------------------------

export interface SubstituteCandidate {
  readonly key: FoodKey;
  readonly name: string;
  readonly emoji: string;
  readonly pricePerKg: number;
  readonly inSeason: boolean;
  readonly local: boolean;
  readonly reason: string;
  readonly score: number;
}

export interface SubstituteContext {
  readonly season: SeasonId;
  readonly region: RegionId;
  readonly priceMultiplier: number;
  readonly dietAllowed: ReadonlySet<FoodKey>;
  readonly category?: Food['category'];
  readonly maxPricePerKg?: number;
}

/**
 * Rank substitutes for a food. Scores reward: same category, in season, locally
 * common, and cheap. Everything is deterministic — ties break on key order.
 */
export function rankSubstitutes(
  from: FoodKey,
  ctx: SubstituteContext,
  limit = 5,
): readonly SubstituteCandidate[] {
  const origin = getFood(from);
  if (!origin) return [];

  const pool = FOODS.filter(
    (f) =>
      f.key !== from &&
      ctx.dietAllowed.has(f.key) &&
      (!ctx.category || f.category === ctx.category || f.category === origin.category),
  );

  const localProduce = new Set(regionProfile(ctx.region).localProduce);

  const scored: SubstituteCandidate[] = pool.map((f) => {
    const pricePerKg = f.price.typicalPrice * ctx.priceMultiplier;
    const inSeason = isInSeason(f, ctx.season);
    const local = localProduce.has(f.key);
    const explicitlyListed = origin.substitutes.includes(f.key);

    let score = 0;
    if (explicitlyListed) score += 40;
    if (f.category === origin.category) score += 30;
    if (inSeason) score += 25;
    if (local) score += 22;
    score -= Math.min(30, pricePerKg / 6);
    if (f.dietTag === origin.dietTag) score += 8;

    const priceNote = ctx.maxPricePerKg
      ? pricePerKg <= ctx.maxPricePerKg
        ? `about ₹${Math.round(pricePerKg)}/kg`
        : `about ₹${Math.round(pricePerKg)}/kg — pricier than ${origin.name}`
      : `about ₹${Math.round(pricePerKg)}/kg`;

    const reasonParts: string[] = [];
    if (local) reasonParts.push('common in your area');
    if (inSeason && f.seasons.length < 4) reasonParts.push(`in season`);
    reasonParts.push(priceNote);
    if (f.category === origin.category) reasonParts.push('same food group');

    return {
      key: f.key,
      name: f.name,
      emoji: f.emoji,
      pricePerKg: Math.round(pricePerKg),
      inSeason,
      local,
      reason: reasonParts.join(' \u00b7 '),
      score,
    };
  });

  return scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit);
}

/** Human note about what is cheap and plentiful right now in the user's region. */
export function seasonSnapshot(
  season: SeasonId,
  region: RegionId,
): { readonly label: string; readonly items: readonly Food[] } {
  const localProduce = new Set(regionProfile(region).localProduce);
  const cheap = FOODS.filter(
    (f) =>
      isInSeason(f, season) &&
      f.category !== 'beverage' &&
      f.price.typicalPrice * regionMultiplier(region) <= 70,
  );
  const sorted = [...cheap].sort((a, b) => {
    const aLocal = localProduce.has(a.key) ? 1 : 0;
    const bLocal = localProduce.has(b.key) ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    return a.price.typicalPrice - b.price.typicalPrice;
  });
  return { label: SEASON_LABELS[season] ?? 'This season', items: sorted.slice(0, 8) };
}

/** Monsoon adds a food-hygiene emphasis that other seasons do not need. */
export function seasonSafetyNote(season: SeasonId): string | null {
  if (season !== 'monsoon') return null;
  return 'In monsoon months, wash greens and vegetables thoroughly under running water, cut them only just before cooking, and keep cooked food covered. Eat dal, rice and sabzi freshly made rather than kept warm for long.';
}

export function seasonSafetyHint(season: SeasonId): string | null {
  if (season === 'summer') {
    return 'In hot months, drink water regularly through the day even before you feel thirsty, and keep cut fruit covered in the heat.';
  }
  if (season === 'winter') {
    return 'In winter, include some warm meals and at least one cooked vegetable each day.';
  }
  if (season === 'post-monsoon') {
    return 'After the monsoon, fruit and vegetables are usually cheaper and more varied — a good time to widen what you eat.';
  }
  return null;
}

export type { FoodKey as SeasonalFoodKey };
