import type { MapMarkKind, MapShape, MapStampKind } from '../../../shared/types'
import { isClosedShape } from '../../../shared/types'
import type { Point } from './worldMap'

/**
 * F-12 part 4: the map's marks — stamps and labels — and where names go.
 * Pure, like the rest of the map's maths.
 *
 * The stamps are drawn the way an engraved map draws them: an outline in
 * ink over paper, shaded with ink lines rather than a tint, so they are two
 * colours in every palette. Each is shown in a STAMP_W × STAMP_H box whose
 * middle is the point the writer clicked.
 */

/** The art is drawn on a 24 × 20 grid and shown half as large again: at
 *  the grid's own size a mountain was a speck beside its name. */
export const STAMP_SCALE = 1.5
export const STAMP_W = 24 * STAMP_SCALE
export const STAMP_H = 20 * STAMP_SCALE

/** What each mark is called, to the writer and to a screen reader. */
export const MARK_NAME: Record<MapMarkKind, string> = {
  mountain: 'Mountain',
  hills: 'Hills',
  mesa: 'Mesa',
  cliffs: 'Cliffs',
  volcano: 'Volcano',
  dunes: 'Dunes',
  cave: 'Cave',
  forest: 'Woods',
  pine: 'Pines',
  marsh: 'Marsh',
  waterfall: 'Waterfall',
  rocks: 'Rocks',
  ship: 'Ship',
  lighthouse: 'Lighthouse',
  town: 'Town',
  city: 'City',
  castle: 'Castle',
  tower: 'Tower',
  ruins: 'Ruins',
  oak: 'Oak',
  deadtree: 'Dead tree',
  rainforest: 'Rainforest',
  highgrass: 'High grass',
  cactus: 'Cactus',
  seastacks: 'Sea stacks',
  boilingsea: 'Boiling sea',
  oasis: 'Oasis',
  wreck: 'Wreck',
  encampment: 'Encampment',
  cabin: 'Log cabin',
  westerntown: 'Western town',
  metropolis: 'Metropolis',
  cathedral: 'Cathedral',
  ziggurat: 'Ziggurat',
  cyberspire: 'Cyberspire',
  hangingcitadel: 'Hanging citadel',
  ruinedarch: 'Ruined arch',
  ruinedtower: 'Ruined tower',
  ruinedcity: 'Ruined city',
  buriedstatue: 'Buried statue',
  effigy: 'Giant effigy',
  battlefield: 'Battlefield',
  cemetery: 'Cemetery',
  graveyard: 'Graveyard',
  label: 'Label'
}

/**
 * A stamp's art: `body` is outlined in ink and filled with paper (so a stamp
 * over the sea or a road is not see-through); `lines` is ink only, the
 * shading and detail; `solid` is filled with ink.
 */
export interface StampArt {
  body: string
  lines: string
  solid?: string
}

export const STAMP_ART: Record<MapStampKind, StampArt> = {
  // Two peaks, the near one hachured down its shadowed flank.
  mountain: {
    body: 'M 11 18 L 17 7 L 23 18 Z M 1 18 L 9 3 L 17 18 Z',
    lines: 'M 9 3 L 11 18 M 10.5 7 L 13 18 M 12 10.5 L 15 18 M 18.5 10 L 20 18'
  },
  // Two soft humps with a stroke of shade under each crest.
  hills: {
    body: 'M 1 17 Q 7 7 13 17 Z M 9 17 Q 16 5 23 17 Z',
    lines: 'M 9 13 Q 10 15 11 17 M 18 11 Q 19.5 14 20.5 17'
  },
  // A table of rock: a flat top, steep sides, its strata ruled across and
  // its shadowed flank hatched.
  mesa: {
    body: 'M 1 18 L 4.5 8.5 L 6 6.5 H 18 L 19.5 8.5 L 23 18 Z',
    lines:
      'M 5 10.5 H 11 M 13 10.5 H 19 M 3.5 14 H 8 M 10 14 H 20.5 ' +
      'M 19.5 8.5 L 20 12 M 20.5 11 L 21.5 15.5 M 21.5 13 L 22.3 17'
  },
  // An escarpment: the edge ruled, its face hanging below in ink teeth.
  cliffs: {
    body: '',
    lines: 'M 1 6 H 23',
    solid:
      'M 1.5 6 H 4 L 2.8 13 Z M 5 6 H 7.5 L 6.3 16 Z M 8.5 6 H 11 L 9.8 11.5 Z ' +
      'M 12 6 H 14.5 L 13.3 15 Z M 15.5 6 H 18 L 16.8 12 Z M 19 6 H 21.5 L 20.3 16.5 Z'
  },
  // A cone with its top cut off, the crater's lip showing, smoke rising.
  volcano: {
    body: 'M 1 18 L 9 7 Q 12 8.5 15 7 L 23 18 Z',
    lines:
      'M 9 7 Q 12 5.5 15 7 M 15 7 L 17 18 M 16.5 10 L 19 18 M 18 12.5 L 20.5 18 ' +
      'M 11 4.5 Q 10 2.5 11.5 1 M 13 4.5 Q 14 2.5 13 0.5',
    solid: 'M 11.3 8 L 12.7 8 L 13.2 12 L 12 10.5 L 11 13 Z'
  },
  // Wind-cut crests, each with its slip face shaded.
  dunes: {
    body: '',
    lines: 'M 1 15 Q 6 8 11 15 M 8 11 Q 13 4.5 19 11 M 14 18 Q 18.5 12.5 23 18',
    // Each crest's steep slip face in solid ink, as a sand sea is engraved.
    solid:
      'M 6 11.4 Q 8.8 12.2 11 15 H 8.4 Q 7.6 12.9 6 11.4 Z ' +
      'M 13.5 7.75 Q 16.5 8.6 19 11 H 16.2 Q 15.4 9 13.5 7.75 Z ' +
      'M 18.5 15.2 Q 21 16 23 18 H 20.8 Q 20 16.3 18.5 15.2 Z'
  },
  // A hill with a dark mouth in it.
  cave: {
    body: 'M 1 18 Q 12 1 23 18 Z',
    lines: 'M 16.5 9 L 17.5 11 M 18 11.5 L 19 13.5 M 19.5 14 L 20.2 15.6',
    solid: 'M 8 18 Q 12 9 16 18 Z'
  },
  // Broadleaf woods: one canopy of rounded crowns standing on short, thick
  // trunks. Three round crowns on thin stems, the first drawing, read as
  // three little people; a wood is a mass, not a row of lollipops.
  forest: {
    body:
      'M 2 14 Q 0.5 10 4 8.5 Q 4.5 4.5 8.5 5 Q 10.5 1.5 14.5 3 Q 18.5 2 19.5 6 ' +
      'Q 23.5 7 22.5 11 Q 23.5 14.5 20 15 Q 17 16.5 14 15 Q 11 16.5 8 15 Q 4.5 16 2 14 Z',
    lines:
      'M 6 15.5 V 18 M 7.5 15.5 V 18 M 15.5 15.5 V 18 M 17 15.5 V 18 M 3 18 H 21 ' +
      'M 9 9 Q 10.5 7.5 12.5 8.5 M 14.5 7 Q 16.5 5.5 18 7 M 17 11 Q 19 10 20.5 11.5 ' +
      'M 5 11 Q 6.5 10 8 11'
  },
  // Pines: tiered firs, one tall between two short.
  pine: {
    body:
      'M 12 1.5 L 9.5 6 H 10.8 L 8.5 10 H 10 L 7.5 14.5 H 16.5 L 14 10 H 15.5 L 13.2 6 H 14.5 Z ' +
      'M 4.5 7.5 L 1.5 16 H 7.5 Z M 19.5 7.5 L 16.5 16 H 22.5 Z',
    lines:
      'M 12 14.5 V 18 M 4.5 16 V 18 M 19.5 16 V 18 M 1 18 H 23 M 12 4 L 13 6 M 12 8 L 13.5 10 M 12 12 L 14 14.5'
  },
  // Reed tufts over broken water lines.
  marsh: {
    body: '',
    lines:
      'M 5 13 V 7 M 3 13 L 4 9 M 7 13 L 6 9 ' +
      'M 13 12 V 5 M 11 12 L 12 8 M 15 12 L 14 8 ' +
      'M 20 13 V 8 M 18 13 L 19 10 M 22 13 L 21 10 ' +
      'M 1 15 H 9 M 11 15 H 17 M 19 15 H 24 M 4 18 H 12 M 14 18 H 21'
  },
  // Water falling from a rock lip into a spray of ripples.
  waterfall: {
    // A river narrowing between its banks and pouring over a cliff — the
    // cliff drawn as the cliffs stamp draws one, in ink teeth — into spray.
    body: '',
    lines:
      'M 8.5 0.8 Q 10 2.5 9 4 M 15.5 0.8 Q 14 2.5 15 4 M 1 4 H 23 ' +
      'M 10 4.5 V 13 M 12 4.5 V 14.5 M 14 4.5 V 13 ' +
      'M 6 16 Q 12 13.2 18 16 M 3.5 18.5 Q 12 15.8 20.5 18.5',
    solid:
      'M 1 4 H 8.5 L 7 13.5 L 5 9 L 3 12.5 L 1.5 8 Z M 15.5 4 H 23 L 22.5 8 L 21 12.5 L 19 9 L 17 13.5 Z'
  },
  // Rocks breaking the water.
  rocks: {
    body:
      'M 2.5 16 L 4.5 10.5 L 8.5 9.5 L 10.5 13.5 L 9.5 16 Z M 12.5 16 L 14.5 11.5 L 18 11.5 L 20 16 Z ' +
      'M 7.5 18.5 L 8.5 16.5 L 11.5 16.5 L 12.5 18.5 Z',
    lines: 'M 8.5 9.5 L 7.5 15.5 M 18 11.5 L 17 15.5 M 0.5 17 H 2.5 M 20 17 H 23.5 M 13 19 H 16'
  },
  // A sailing ship on the swell.
  ship: {
    body: 'M 3 13 H 21 L 18.5 16.5 H 5.5 Z M 12.5 2.5 L 19.5 11 H 12.5 Z M 11.5 3.5 L 5.5 11 H 11.5 Z',
    lines: 'M 12 1 V 13 M 1 18.5 Q 4 17 7 18.5 Q 10 17 13 18.5 Q 16 17 19 18.5 Q 22 17 24 18.5',
    solid: 'M 12 1 L 15 1.8 L 12 2.6 Z'
  },
  // A banded lighthouse throwing its light both ways.
  lighthouse: {
    body: 'M 9 18 L 10.5 7 H 13.5 L 15 18 Z M 10 4 H 14 V 7 H 10 Z',
    lines:
      'M 15.5 4.5 L 19.5 3 M 15.5 6 L 19.5 7.5 M 8.5 4.5 L 4.5 3 M 8.5 6 L 4.5 7.5 M 6 18 H 18',
    solid:
      'M 9.5 4 L 12 1.5 L 14.5 4 Z M 10.25 10 H 13.75 L 14 12 H 10 Z M 9.75 14 H 14.25 L 14.5 16 H 9.5 Z'
  },
  // Two houses and a church spire.
  town: {
    body: 'M 2 18 V 11 L 6 7 L 10 11 V 18 Z M 10 18 V 9 L 14 5 L 18 9 V 18 Z M 18 18 V 10 H 22 V 18 Z',
    lines: 'M 20 10 V 3 M 18.5 4.5 H 21.5',
    solid: 'M 5 14 H 7 V 18 H 5 Z M 13 12 H 15 V 14 H 13 Z'
  },
  // A crowd of roofs and towers inside a wall.
  city: {
    body:
      'M 1 18 V 11 H 5 V 18 Z M 5 18 V 6 H 9 V 18 Z M 9 18 V 12 L 12 9 L 15 12 V 18 Z ' +
      'M 15 18 V 4 H 18.5 V 18 Z M 18.5 18 V 10.5 H 23 V 18 Z',
    lines: 'M 16.75 4 V 0.8 M 0.5 18 H 23.5',
    solid:
      'M 6.3 8 H 7.7 V 9.5 H 6.3 Z M 6.3 12 H 7.7 V 13.5 H 6.3 Z M 16.1 6.5 H 17.4 V 8 H 16.1 Z ' +
      'M 16.1 11 H 17.4 V 12.5 H 16.1 Z M 11.2 14.5 H 12.8 V 18 H 11.2 Z M 2.3 13 H 3.7 V 14.5 H 2.3 Z ' +
      'M 20 12.5 H 21.5 V 14 H 20 Z'
  },
  // A walled keep between two crenellated towers, its gate dark.
  castle: {
    body:
      'M 2 18 V 6 H 3 V 4 H 4.5 V 6 H 5 V 4 H 6.5 V 6 H 7 V 10 H 8.5 V 8.5 H 10 V 10 H 11 V 8.5 ' +
      'H 13 V 10 H 14 V 8.5 H 15.5 V 10 H 17 V 6 H 17.5 V 4 H 19 V 6 H 19.5 V 4 H 21 V 6 H 22 V 18 Z',
    lines: 'M 4.5 4 V 0.8 M 7 10 V 18 M 17 10 V 18',
    solid:
      'M 4.5 0.8 L 7.5 1.6 L 4.5 2.4 Z M 10.5 18 V 14 Q 12 12 13.5 14 V 18 Z ' +
      'M 4 8.5 H 5 V 10.5 H 4 Z M 19 8.5 H 20 V 10.5 H 19 Z'
  },
  // A lone round tower, crenellated, a window and a door.
  tower: {
    body: 'M 9 18 L 9.5 6 H 8.5 V 3 H 10 V 4.5 H 11.25 V 3 H 12.75 V 4.5 H 14 V 3 H 15.5 V 6 H 14.5 L 15 18 Z',
    lines: 'M 5.5 18 H 18.5 M 9.5 6 H 14.5',
    solid: 'M 11.4 8.5 H 12.6 V 10.8 H 11.4 Z M 11 18 V 15.5 Q 12 14 13 15.5 V 18 Z'
  },
  // Broken walls and a snapped column among the rubble.
  ruins: {
    body:
      'M 3 18 V 9 L 4.5 7.5 L 5.5 9.5 L 6.5 8.5 V 18 Z M 10 18 V 12 H 12 L 13 13.5 L 14 12.5 V 18 Z ' +
      'M 17 18 V 5.5 H 19.5 L 20 8 L 19 9 L 19.8 11 V 18 Z',
    lines:
      'M 0.5 18 H 23.5 M 7 18 L 8 16.5 L 9 18 M 14.8 18 L 15.6 16.6 L 16.4 18 ' +
      'M 3 12 H 6.5 M 3 15 H 6.5 M 18.2 5.5 V 18 M 10 15 H 14 M 21 18 L 21.8 17 L 22.6 18',
    solid: ''
  },
  // A single great oak: one round crown on a thick trunk.
  oak: {
    body: 'M 12 2 Q 17 1.5 19 5 Q 22.5 6.5 21 10 Q 21.5 13.5 17 13.5 Q 14 15 12 14 Q 9.5 15 7 13.5 Q 2.5 13 3 9.5 Q 1.5 6 5 5 Q 7 1.5 12 2 Z M 10.5 13.8 L 10 17 L 8.5 18.3 H 15.5 L 14 17 L 13.5 13.8 Z',
    lines:
      'M 7 8 Q 8.5 6.5 10.5 7.5 M 13 5.5 Q 15 4.5 16.5 6 M 15 10 Q 17 9 18.5 10.5 M 6 11 Q 7.5 10 9 11 M 12 14.5 V 17.5 M 5 18.3 H 19'
  },
  // A dead tree: a bare, forked trunk and its twigs.
  deadtree: {
    body: 'M 10.5 18 L 11 12 L 8 8 L 8.8 7.4 L 11.5 10.4 L 11.6 6 L 12.6 6 L 12.6 10 L 15.5 6.4 L 16.3 7.1 L 13.2 11.6 L 13.5 18 Z',
    lines:
      'M 8.4 7.7 L 6 6.4 M 8.2 7.8 L 7.5 5 M 12.1 6 L 11 3.5 M 12.1 6 L 13.5 3 M 15.9 6.8 L 18.5 5.4 M 15.9 6.8 L 16.5 4 M 6 6.4 L 4.5 6.8 M 13.5 3 L 14.6 2.4 M 7 18.3 H 17 M 10.5 18 L 9 18.6 M 13.5 18 L 15 18.6'
  },
  // Rainforest: tall trunks under a broad, spreading canopy, vines hanging from it and big leaves crowding the floor.
  rainforest: {
    body: 'M 1 7 Q 4 3.5 8 5 Q 11 1.5 15 3.5 Q 19 1.5 23 6 Q 21 9 17 8.5 Q 13 10 9 8.5 Q 5 10 1 7 Z M 5.5 8.8 L 5 18 H 6.6 L 6.8 9.2 Z M 15.2 9 L 15 18 H 16.6 L 16.8 8.7 Z',
    lines:
      'M 3 7.5 Q 5 6 7 7 M 10 5 Q 12 3.8 14 5 M 17 6 Q 19 4.8 21 6.4 M 9.5 8.6 Q 10 11.5 9.2 14 M 12.5 9.4 V 12.5 M 20 8.4 Q 20.6 11 20 13 M 1 18.4 H 23',
    solid:
      'M 2 18 Q 1 14.5 4.2 13 Q 3.6 15.6 2.8 18 Z M 4.4 18 Q 7 14 9.8 14.8 Q 7.4 15.8 5.8 18 Z M 11 18 Q 11.4 14.4 14 13.6 Q 12.8 15.8 12.4 18 Z M 18 18 Q 18.8 14.6 22 14.2 Q 20 15.8 19.4 18 Z'
  },
  // High grass: tall tufts of blades, bending.
  highgrass: {
    body: '',
    lines:
      'M 4 18 Q 3.6 12 1.8 7.5 M 4 18 Q 4.6 12.5 6.5 9 M 4.6 18 Q 5.5 14 4.2 11 M 12 18 Q 11.5 10 9.5 4.5 M 12 18 Q 12.6 11 14.8 6.5 M 12.6 18 Q 13.2 13 12.2 9 M 11.6 18 Q 10.6 14 8.5 11 M 19.5 18 Q 19 12.5 17.4 9 M 19.5 18 Q 20.2 13 22.2 10 M 20 18 Q 20.6 15 20 12.5 M 1 18.4 H 23'
  },
  // A saguaro: a ribbed stem with two arms, and a small one beside it.
  cactus: {
    body: 'M 10 18 V 5 Q 12 3 14 5 V 18 Z M 10 12.5 H 7.5 Q 5.8 12.5 5.8 10.5 V 7.8 Q 6.9 6.6 8 7.8 V 10.3 H 10 Z M 14 10.5 H 16.2 V 6.3 Q 17.2 5.2 18.2 6.3 V 9.5 Q 18.2 12.5 16 12.5 H 14 Z M 19.6 18 V 15.6 Q 20.5 14.6 21.4 15.6 V 18 Z',
    lines: 'M 12 5 V 18 M 6.9 8.4 V 11 M 17.2 6.8 V 11 M 20.5 15.4 V 18 M 3 18 H 22'
  },
  // Sea stacks: needles of rock standing out of the sea, shaded on one side.
  seastacks: {
    body: 'M 3 16 L 4.5 6 L 5.5 4 L 6.5 7 L 7.5 16 Z M 10 16 L 11.5 2 L 13 5 L 14.5 16 Z M 17 16 L 18 9 L 19.5 8 L 20.5 16 Z',
    lines:
      'M 6 8 L 7 15 M 5.8 11 L 6.6 15 M 12.8 5 L 14 15 M 12.5 9 L 13.4 15 M 19.6 9 L 20.2 15 M 1 16.3 H 23 M 2 18.5 Q 5 17.5 8 18.5 M 11 18.5 Q 14 17.5 17 18.5 M 18 19.5 H 22'
  },
  // A boiling sea: heaving waves, bubbles breaking, steam rising.
  boilingsea: {
    body: 'M 8 12 A 1 1 0 1 1 10 12 A 1 1 0 1 1 8 12 Z M 14.7 11.4 A 0.8 0.8 0 1 1 16.3 11.4 A 0.8 0.8 0 1 1 14.7 11.4 Z M 3.3 12.6 A 0.7 0.7 0 1 1 4.7 12.6 A 0.7 0.7 0 1 1 3.3 12.6 Z M 19.6 12 A 0.9 0.9 0 1 1 21.4 12 A 0.9 0.9 0 1 1 19.6 12 Z',
    lines:
      'M 1 15 Q 4 12.5 7 15 Q 10 12.5 13 15 Q 16 12.5 19 15 Q 21 13 23 15 M 1 18.5 Q 4 16.5 7 18.5 Q 10 16.5 13 18.5 Q 16 16.5 19 18.5 Q 21 17 23 18.5 M 6 10 Q 5 8 6.5 6.5 Q 8 5 6.5 3 M 12 9.5 Q 11 7.5 12.5 6 Q 14 4.5 12.5 2.5 M 18 10 Q 17 8 18.5 6.5 Q 20 5 18.5 3'
  },
  // An oasis: a pool among the dunes, two palms over it.
  oasis: {
    body: 'M 4 16 Q 12 12.6 20 16 Q 12 19.4 4 16 Z',
    lines:
      'M 8 16 H 11 M 13 16.8 H 16 M 9 14.4 Q 8.5 9 10 5 M 15 14.2 Q 16 9.5 14.5 6.5 M 1 18.5 Q 6 17 12 18.6 Q 18 17.2 23 18.5',
    solid:
      'M 10 5 Q 7 4 5 6 Q 7.5 4.8 10 5.4 Z M 10 5 Q 13 3.5 15 5.5 Q 12.5 4.6 10 5.4 Z M 10 5 Q 9 2 7 1.5 Q 9.5 2.8 10.3 5 Z M 14.5 6.5 Q 12 5.6 10.5 7.4 Q 12.4 6.3 14.5 6.9 Z M 14.5 6.5 Q 17.5 5.2 19 7.4 Q 16.8 6.3 14.5 6.9 Z M 14.5 6.5 Q 15.5 3.8 17.5 3.4 Q 15.6 4.6 14.8 6.6 Z'
  },
  // A wreck: a hull on the shore, whole at the bow, broken open at the stern where its ribs stand bare; the mast snapped.
  wreck: {
    body: 'M 1.5 12 Q 3 17.5 10 17.5 H 13 L 14 15.5 L 13 14 L 12 15 L 11.2 13.4 L 10.2 14.2 Q 6 13.5 1.5 12 Z',
    lines:
      'M 3 14.4 Q 6 15.4 10.6 15.6 M 14 17.6 Q 16.6 15 16.1 11.4 M 16.5 17.9 Q 19.1 15 18.7 11.8 M 19 18 Q 21.6 15.5 21.3 12.6 M 12.6 17.7 Q 17 18.3 21.5 18 M 6.8 13.4 L 4.4 6 M 4.4 6 L 6.2 5.6 M 0.5 18.6 H 23.5',
    solid: 'M 4.2 15.6 H 5.2 V 16.4 H 4.2 Z M 7.2 16 H 8.2 V 16.8 H 7.2 Z'
  },
  // An encampment: two tents and a fire.
  encampment: {
    body: 'M 2 17 L 7 9 L 12 17 Z M 12 17 L 16 11 L 20 17 Z',
    lines: 'M 7 9 V 17 M 16 11 V 17 M 7 9 L 7.6 7.4 M 16 11 L 16.5 9.6 M 1 17 H 23',
    solid:
      'M 6 17 L 7 13.5 L 8 17 Z M 15.2 17 L 16 14.2 L 16.8 17 Z M 21 17 Q 20.5 15.5 21.5 14 Q 21.8 15.5 22.6 15 Q 22.6 16.5 22 17 Z'
  },
  // A log cabin: logs laid along it, smoke from the chimney.
  cabin: {
    body: 'M 16 7.7 V 4.5 H 18 V 9 Z M 4 18 V 11 H 20 V 18 Z M 3 11 L 12 5 L 21 11 Z',
    lines:
      'M 4 13 H 20 M 4 15 H 20 M 4 17 H 9.5 M 14.5 17 H 20 M 17 4 Q 16 2.5 17.5 1.5 Q 19 0.8 18 0',
    solid: 'M 10.5 18 V 13.5 H 13.5 V 18 Z M 6 12 H 8 V 13 H 6 Z M 16 12 H 18 V 13 H 16 Z'
  },
  // A western town: false-fronted stores along a boardwalk.
  westerntown: {
    body: 'M 1 18 V 9 H 3 V 7.5 H 6 V 9 H 8 V 18 Z M 8 18 V 11 H 14 V 18 Z M 14 18 V 8 H 16 V 6.5 H 19 V 8 H 21 V 18 Z',
    lines: 'M 0.5 18 H 23.5 M 8 13 H 14 M 21 18 V 12 H 23 V 18',
    solid:
      'M 3.5 18 V 14.5 H 5.5 V 18 Z M 16.5 18 V 14 H 18.5 V 18 Z M 9.5 14.5 H 10.8 V 16 H 9.5 Z M 11.6 14.5 H 12.9 V 16 H 11.6 Z M 2 10 H 7 V 11 H 2 Z M 15 9.2 H 20 V 10.2 H 15 Z'
  },
  // A metropolis: towers crowded close, lit window over window.
  metropolis: {
    body: 'M 1 18 V 10 H 4 V 18 Z M 4 18 V 5 L 5.5 3.5 L 7 5 V 18 Z M 7 18 V 8 H 10 V 18 Z M 10 18 V 2.5 H 11 V 1 H 12 V 2.5 H 13 V 18 Z M 13 18 V 6 H 15.5 V 4 H 17 V 18 Z M 17 18 V 9 H 20 V 18 Z M 20 18 V 11.5 H 23 V 18 Z',
    lines: 'M 0.5 18 H 23.5 M 11.5 1 V 0',
    solid:
      'M 2 12 H 3 V 13 H 2 Z M 2 14.5 H 3 V 15.5 H 2 Z M 5 7 H 6 V 8 H 5 Z M 5 10 H 6 V 11 H 5 Z M 5 13 H 6 V 14 H 5 Z M 8 10 H 9 V 11 H 8 Z M 8 13 H 9 V 14 H 8 Z M 11 5 H 12 V 6 H 11 Z M 11 8 H 12 V 9 H 11 Z M 11 11 H 12 V 12 H 11 Z M 11 14 H 12 V 15 H 11 Z M 14 8 H 15 V 9 H 14 Z M 14 11 H 15 V 12 H 14 Z M 18 11 H 19 V 12 H 18 Z M 18 14 H 19 V 15 H 18 Z M 21 13.5 H 22 V 14.5 H 21 Z'
  },
  // A cathedral: twin spired towers, the nave between them, a rose window.
  cathedral: {
    body: 'M 4 18 V 7 L 6 2 L 8 7 V 18 Z M 16 18 V 7 L 18 2 L 20 7 V 18 Z M 8 18 V 10 L 12 6 L 16 10 V 18 Z',
    lines: 'M 4 7 H 8 M 16 7 H 20 M 2 18 H 22 M 6 2 V 0.6 M 18 2 V 0.6',
    solid:
      'M 12 8.6 L 13.2 9.8 L 12 11 L 10.8 9.8 Z M 11 18 V 15 Q 12 13.5 13 15 V 18 Z M 5.6 10 H 6.4 V 12.5 H 5.6 Z M 17.6 10 H 18.4 V 12.5 H 17.6 Z'
  },
  // A ziggurat: a stepped temple, a stair up its face, a shrine on top.
  ziggurat: {
    body: 'M 10 7 V 4 H 14 V 7 Z M 2 18 V 14.5 H 5 V 11 H 8 V 7 H 16 V 11 H 19 V 14.5 H 22 V 18 Z',
    lines:
      'M 11 18 V 7 M 13 18 V 7 M 11 16.5 H 13 M 11 15 H 13 M 11 13.5 H 13 M 11 12 H 13 M 11 10.5 H 13 M 11 9 H 13 M 5 14.5 H 8 M 16 14.5 H 19 M 8 11 H 10 M 14 11 H 16',
    solid: 'M 11.4 5 H 12.6 V 7 H 11.4 Z'
  },
  // A cyberspire: a needle tower over the city, a sky deck, a light at the top.
  cyberspire: {
    body: 'M 1.5 18 V 13 H 5 V 18 Z M 19 18 V 11.5 H 22.5 V 18 Z M 7 18 L 9 15 H 15 L 17 18 Z M 10 15 L 11 6 L 12 1.5 L 13 6 L 14 15 Z M 8.5 7.5 L 9.5 6 H 14.5 L 15.5 7.5 Z',
    lines:
      'M 12 1.5 V 0 M 10.6 10 H 13.4 M 10.3 12.5 H 13.7 M 0.5 18 H 23.5 M 3.2 13 V 11.5 M 20.8 11.5 V 9.5',
    solid:
      'M 11.6 8.3 H 12.4 V 9.3 H 11.6 Z M 2.4 14.5 H 3.4 V 15.5 H 2.4 Z M 20 13 H 21 V 14 H 20 Z M 20 15.5 H 21 V 16.5 H 20 Z M 11.5 0 H 12.5 V 1 H 11.5 Z'
  },
  // A hanging citadel: the castle upside down, hung from the rock above it.
  hangingcitadel: {
    body: 'M 2 2 V 14 H 3 V 16 H 4.5 V 14 H 5 V 16 H 6.5 V 14 H 7 V 10 H 8.5 V 11.5 H 10 V 10 H 11 V 11.5 H 13 V 10 H 14 V 11.5 H 15.5 V 10 H 17 V 14 H 17.5 V 16 H 19 V 14 H 19.5 V 16 H 21 V 14 H 22 V 2 Z',
    lines: 'M 4.5 16 V 19.2 M 7 10 V 2 M 17 10 V 2 M 0.5 2 H 23.5',
    solid:
      'M 0.5 0 H 23.5 V 2 H 21 L 20 3 L 19 2 H 5 L 4 3 L 3 2 H 0.5 Z M 4.5 19.2 L 7.5 18.4 L 4.5 17.6 Z M 10.5 2 V 6 Q 12 8 13.5 6 V 2 Z M 4 11.5 H 5 V 9.5 H 4 Z M 19 11.5 H 20 V 9.5 H 19 Z'
  },
  // A ruined arch: half of it still springing from its pier, broken at the crown; the far pier a stump, a block fallen.
  ruinedarch: {
    body: 'M 2.5 18 V 9 Q 2.5 2 11 2 L 13.4 3 L 12.6 4.4 L 13.2 5.6 Q 12 5.4 11 5.4 Q 6 5.4 6 9 V 18 Z M 17 18 V 11.5 L 18.2 10.4 L 19.2 11.8 L 20.5 11 V 18 Z M 11 18 V 15.6 H 14.4 V 18 Z',
    lines:
      'M 3.4 5.4 L 6.4 7.2 M 6.4 2.8 L 7.8 5.6 M 10 2 V 5.4 M 4.2 9 V 18 M 18.8 12.4 V 18 M 0.5 18 H 23.5'
  },
  // A ruined tower: a round tower broken off jagged, cracked down its face.
  ruinedtower: {
    body: 'M 8 18 L 8.6 6 L 10 4 L 11 6 L 12.5 3 L 14 5.5 L 15.2 4.5 L 15.4 9 L 16 18 Z',
    lines: 'M 8.4 10 H 15.6 M 8.2 14 H 15.8 M 5 18 H 19 M 12.5 3 L 13 7 L 12 9',
    solid:
      'M 10.8 18 V 15.8 Q 12 14.6 13.2 15.8 V 18 Z M 16.5 18 L 17.5 16.8 L 18.6 18 Z M 10.4 11 H 11.4 V 12.6 H 10.4 Z'
  },
  // A ruined city: a skyline of broken towers and empty windows.
  ruinedcity: {
    body: 'M 1 18 V 12 L 2.5 11 L 3.5 12.5 L 5 11.5 V 18 Z M 5 18 V 6 H 7.5 L 8.5 8 L 7.6 9 L 9 10.5 V 18 Z M 9 18 V 13 L 11 12 L 12 13.5 L 13 13 V 18 Z M 13 18 V 4 H 15 L 16 6.5 L 15.2 7.5 L 16.5 9 V 18 Z M 16.5 18 V 11 L 18 10 L 19.5 11.5 L 21 10.5 L 23 12 V 18 Z',
    lines: 'M 0.5 18 H 23.5 M 6.3 10 V 18 M 14.2 8.5 V 18',
    solid:
      'M 6.8 11 H 8 V 12.5 H 6.8 Z M 14.8 10 H 16 V 11.5 H 14.8 Z M 18.5 13 H 19.7 V 14.5 H 18.5 Z M 2.3 14 H 3.5 V 15.5 H 2.3 Z M 10.4 15 H 11.6 V 16.5 H 10.4 Z'
  },
  // A buried statue: a colossal head sunk to the lip in sand.
  buriedstatue: {
    body: 'M 6.3 15.2 V 9 Q 6 3.5 12 3.5 Q 18 3.5 17.7 9 V 14.4 Q 15 13.5 12 15.5 Q 9 14 6.3 15.2 Z',
    lines:
      'M 1 18 Q 4 15.5 6.3 15.2 M 17.7 14.4 Q 20 15 23 18 M 8 8 Q 9.3 7 10.6 8 M 13.4 8 Q 14.7 7 16 8 M 12 8.5 V 11.5 L 11 12 M 10 13.2 Q 12 13.9 14 13.2 M 15.5 4.4 L 14.5 6.5 L 15.2 7.5 M 2.5 18.8 Q 6 17.6 9 18.8 M 14 18.8 Q 18 17.6 21 18.8',
    solid: 'M 8.8 9 H 10.2 V 10 H 8.8 Z M 13.8 9 H 15.2 V 10 H 13.8 Z'
  },
  // A giant effigy: a towering wicker figure, arms raised, a fire at its feet.
  effigy: {
    body: 'M 10.6 4.4 A 1.4 1.4 0 1 1 13.4 4.4 A 1.4 1.4 0 1 1 10.6 4.4 Z M 10.4 6.8 H 13.6 L 13.4 12 H 10.6 Z M 10.4 7.6 L 6.4 2.8 L 7.4 2.1 L 11 6.4 Z M 13.6 7.6 L 17.6 2.8 L 16.6 2.1 L 13 6.4 Z M 10.6 12 L 9.6 16.6 H 10.8 L 12 13 L 13.2 16.6 H 14.4 L 13.4 12 Z',
    lines:
      'M 10.7 7.6 L 13.3 10.6 M 13.3 7.6 L 10.7 10.6 M 10.5 9.2 H 13.5 M 7 17.4 H 17 M 8 18.6 H 16',
    solid:
      'M 8 17.4 Q 7.4 15.8 8.4 14.6 Q 8.9 15.8 9.5 15.3 Q 9.8 16.6 9.2 17.4 Z M 14.8 17.4 Q 14.4 16.2 15.2 15 Q 15.8 16.2 16.2 15.7 Q 16.4 16.9 15.8 17.4 Z'
  },
  // A battlefield: two swords crossed and left standing, arrows in the ground.
  battlefield: {
    body: '',
    lines:
      'M 4.5 16 L 14 4 M 19.5 16 L 10 4 M 5.8 12.4 L 8.6 14.6 M 18.2 12.4 L 15.4 14.6 M 1 18 H 23 M 2 18 L 3.2 14.4 M 21.8 18 L 22.6 14.8 M 11.4 18 L 12 15.2 M 8 18 L 7.6 16 M 16.4 18 L 16.8 16.2',
    solid:
      'M 3.2 15.8 H 4.6 V 17.2 H 3.2 Z M 19.4 15.8 H 20.8 V 17.2 H 19.4 Z M 3 14.4 L 3.4 13.4 L 3.8 14.6 Z M 22.5 14.8 L 22.9 13.8 L 23.2 15 Z'
  },
  // A cemetery: kept rows of crosses and headstones behind a fence.
  cemetery: {
    body: 'M 3 14 V 10.5 Q 4.5 9 6 10.5 V 14 Z M 15 14 V 10.5 Q 16.5 9 18 10.5 V 14 Z',
    lines:
      'M 10.5 14 V 8 M 9 9.7 H 12 M 20.8 14 V 9.5 M 19.6 10.8 H 22 M 1 18 H 23 M 1 16 H 23 M 2 15 V 18.6 M 6 15 V 18.6 M 10 15 V 18.6 M 14 15 V 18.6 M 18 15 V 18.6 M 22 15 V 18.6 M 1 14 H 23'
  },
  // A graveyard: old stones leaning every way over sunken mounds, a cross among them.
  graveyard: {
    body: 'M 3 17 L 3.8 11 Q 5.2 10 6.4 11.4 L 6 17 Z M 10 17 L 9.6 12.5 Q 10.8 11.6 12 12.4 L 12.6 17 Z M 17 17 L 18 9.5 Q 19.6 8.9 20.6 10.3 L 19.8 17 Z',
    lines:
      'M 1 17.5 Q 4 16.5 7 17.5 M 8.5 18 Q 11 16.8 14 18 M 15.5 17.8 Q 19 16.6 23 17.6 M 4.4 13 L 5.6 13.2 M 18.6 12 L 19.8 12.2 M 10.4 14 L 11.6 14 M 14.8 9 V 14.5 M 13.6 10.4 H 16',
    solid: 'M 7.6 15.6 L 8.2 14.2 L 8.8 15.6 Z'
  }
}

/** The palette's groups, in order: how a writer looks for a stamp. */
export const STAMP_GROUPS: { name: string; kinds: MapStampKind[] }[] = [
  { name: 'Land', kinds: ['mountain', 'hills', 'mesa', 'cliffs', 'volcano', 'dunes', 'cave'] },
  {
    name: 'Trees and plants',
    kinds: ['forest', 'pine', 'oak', 'deadtree', 'rainforest', 'highgrass', 'cactus', 'marsh']
  },
  {
    name: 'Water',
    kinds: ['waterfall', 'rocks', 'seastacks', 'boilingsea', 'oasis', 'ship', 'wreck', 'lighthouse']
  },
  {
    name: 'Settlements',
    kinds: [
      'encampment',
      'cabin',
      'town',
      'westerntown',
      'city',
      'metropolis',
      'castle',
      'tower',
      'cathedral',
      'ziggurat',
      'cyberspire',
      'hangingcitadel'
    ]
  },
  {
    name: 'Ruins and relics',
    kinds: [
      'ruins',
      'ruinedarch',
      'ruinedtower',
      'ruinedcity',
      'buriedstatue',
      'effigy',
      'battlefield',
      'cemetery',
      'graveyard'
    ]
  }
]

/** The kinds that are stamps, in the palette's order. */
export const STAMP_ORDER: MapStampKind[] = STAMP_GROUPS.flatMap((g) => g.kinds)

export const isStamp = (kind: MapMarkKind): kind is MapStampKind => kind !== 'label'

/** Where a stamp's name sits: centred just under the stamp. */
export function stampNameAt(at: Point, size = 1): Point {
  return { x: at.x, y: at.y + (STAMP_H * size) / 2 + 2 }
}

/**
 * Where a shape's name goes. An outline is named at its middle (the centroid
 * of its area, so a long crescent of coast is named inside the land rather
 * than at the average of its points, which can fall in the sea). A line is
 * named halfway along it.
 */
export function labelAnchor(shape: Pick<MapShape, 'kind' | 'points'>): Point {
  const pts = shape.points
  if (pts.length === 0) return { x: 0, y: 0 }
  if (isClosedShape(shape.kind) && pts.length > 2) {
    let area = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const cross = a.x * b.y - b.x * a.y
      area += cross
      cx += (a.x + b.x) * cross
      cy += (a.y + b.y) * cross
    }
    // A shape with no area (every point on one line) has no centroid.
    if (Math.abs(area) > 1e-9)
      return { x: Math.round(cx / (3 * area)), y: Math.round(cy / (3 * area)) }
    return average(pts)
  }
  return alongHalfway(pts)
}

function average(pts: Point[]): Point {
  const sum = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
  return { x: Math.round(sum.x / pts.length), y: Math.round(sum.y / pts.length) }
}

/** The point halfway along a line, by its length, not by its points. */
function alongHalfway(pts: Point[]): Point {
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  const total = lengths.reduce((s, l) => s + l, 0)
  if (total === 0) return { ...pts[0] }
  let left = total / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : left / lengths[i]
      const a = pts[i]
      const b = pts[i + 1]
      return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }
    }
    left -= lengths[i]
  }
  return { ...pts[pts.length - 1] }
}

/** What a mark is, for a screen reader. */
export function describeMark(kind: MapMarkKind, name?: string): string {
  if (kind === 'label') return `Label “${name ?? ''}”`
  return name ? `${MARK_NAME[kind]}, “${name}”` : MARK_NAME[kind]
}
