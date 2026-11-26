/** Every weapon model builder, by weapon id (fists has none). One file per gun so each can be worked on alone. */
import type { WeaponId } from '../weapons';
import type { Kit, Built } from './kit';
import { build as knife } from './knife';
import { build as bat } from './bat';
import { build as compact } from './compact';
import { build as pistol } from './pistol';
import { build as heavyPistol } from './heavyPistol';
import { build as machinePistol } from './machinePistol';
import { build as revolver } from './revolver';
import { build as compactSmg } from './compactSmg';
import { build as smg } from './smg';
import { build as sawnoff } from './sawnoff';
import { build as shotgun } from './shotgun';
import { build as autoShotgun } from './autoShotgun';
import { build as carbine } from './carbine';
import { build as rifle } from './rifle';
import { build as battleRifle } from './battleRifle';
import { build as marksman } from './marksman';
import { build as sniper } from './sniper';
import { build as lmg } from './lmg';
import { build as grenadeLauncher } from './grenadeLauncher';
import { build as rpg } from './rpg';
import { build as grenade } from './grenade';
import { build as molotov } from './molotov';

export const BUILDERS: Partial<Record<WeaponId, (k: Kit) => Built>> = { knife, bat, compact, pistol, heavyPistol, machinePistol, revolver, compactSmg, smg, sawnoff, shotgun, autoShotgun, carbine, rifle, battleRifle, marksman, sniper, lmg, grenadeLauncher, rpg, grenade, molotov };
