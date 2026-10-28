// What the voxel world is, said the same way everywhere agents read about it. Agents from game studios
// (level designers, playtesters) otherwise plan it as a level to play: routes, navigation, playtests.

/** For instructions: what the world is and when a build is done. */
export const DIORAMA = 'The voxel world is a diorama: a miniature scene around the Station that people look at from above and at an angle, like a model railway or a museum diorama. Nobody walks through it or plays it: there is no player, no navigation, collision, walkable routes or playtesting, and desks and team platforms need no paths or connections to them. A build is done when it looks right in world_look: in proportion, in the world\'s style, nothing floating or sunk, and readable from the Station\'s view.';

/** For a tool description or a heading: the short form. */
export const DIORAMA_SHORT = 'a diorama to look at (nobody walks through it or plays it: no navigation, routes or playtesting; a build is done when it looks right in world_look)';

/** The order a scene is built in: big to small, so each layer has something to stand on and fit. */
export const BUILD_ORDER = 'Build big to small: first the shape of the terrain (the ground, hills, water, paths: a few large objects at a coarse voxel size), then the buildings and other large objects on it, then the props (trees, lamps, people, signs: prefabs, placed as copies). Don\'t start on props while the terrain or the buildings they stand on or by are still missing, and look at each layer with world_look before the next.';
