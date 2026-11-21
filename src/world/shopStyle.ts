/** Interior look behind a shopfront window, chosen from the sign brand so the window matches the name above it.
 *  Styles (facadeShader shopWall): 0 convenience 1 gas 2 liquor 3 jewelry 4 pawn 5 bank 6 clothing 7 barber 8 diner 9 electronics 10 office 11 laundromat */
import { BRANDS } from '../render/materials';

const BY_NAME: Record<string, number> = {
  'TIDEWATER ARMS': 4, 'GLOW GARAGE': 1, 'JUNIPER COFFEE': 8, "SAL'S NOODLES": 8, 'KESTREL MART': 0, 'NEON LAGOON': 8, 'PIER 9 FISH': 8,
  'HALYARD HOTEL': 10, 'COBALT CINEMA': 10, 'BASIL & BRINE': 8, 'SUNDIAL BOOKS': 6, 'MERIDIAN BANK': 5, 'FIZZWELL SODA': 0, 'ORBIT LAUNDRY': 11,
  'SALT & SAGE': 8, 'COASTLINE FM': 9, 'DOUBLE DOWN PAWN': 4, 'HOT PLATE DINER': 8, 'BRASS KEY LOCKS': 4, 'VELVET NAILS': 7, 'MOTOR CITY TIRES': 1,
  'CHECK CASHING': 5, 'TAQUERIA SOL': 8, 'PIXEL ARCADE': 9, 'GOLDLEAF JEWELERS': 3, 'HARBOR LIQUOR': 2, 'SUDS & DUDS': 11, 'IRONWORKS GYM': 10,
  'DRAGON WOK': 8, 'FRESH CUTS': 7, 'QUICK FIX PHONES': 9, 'PALM TREE MOTEL': 10,
};
export function shopStyleOfBrand(brand: number): number { return BY_NAME[BRANDS[brand]?.name ?? ''] ?? 0; }
